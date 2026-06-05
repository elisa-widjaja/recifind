# Import flow enhancement: Facebook reels + reliable blog content parsing

Date: 2026-05-29
Status: Design approved, pending spec review

## Summary

Two related improvements to the recipe import flow, shipped together behind a
dev-first, approval-gated rollout:

1. **Blog content fix.** Sharing a whitelisted recipe-blog link from the iOS
   share sheet into ReciFriend saves only the title + thumbnail, never the
   ingredients/steps. The Auto-fill ("Enhance with AI") button on those recipes
   also returns nothing. Pasting the same URL into the in-app Add Recipe URL
   field works. Root cause diagnosed below; fix is a new structured-HTML
   strategy added to the enrichment chain.

2. **Facebook reels (fb.watch).** Facebook links are rejected today because
   `facebook.com` / `fb.watch` are not on the source-host allowlist. Add them
   and handle them exactly like Instagram: title + thumbnail reliably, caption
   content (ingredients/steps) best-effort, without changing the
   Instagram/TikTok/YouTube/blog flows.

Both changes are **worker-only** and additive. No frontend code change is
required.

## Background: the two extraction paths

The app has two different content extractors that do not share logic:

| | `/recipes/parse` (fast path) | `/recipes/enrich` (Gemini path) |
|---|---|---|
| Reads blog JSON-LD (`recipeIngredient` / `recipeInstructions`)? | Yes (`extractRecipeDetailsFromHtml` -> `extractRecipeNodeFromJsonLd`) | No |
| Strategies | JSON-LD, then og/twitter meta tags | `captionExtract` (IG/TikTok/YT only), `youtubeVideo` (YT only), `textInference` (r.jina.ai -> Gemini) |
| Used by | Add Recipe URL-field auto-parse effect | server `enrichAfterSave`, the Auto-fill button, the admin re-enrich endpoint |

Verified empirically: `POST https://api.recifriend.com/recipes/parse` for
`https://www.allrecipes.com/rotisserie-chicken-mushroom-soup-recipe-11946422`
returns all 12 ingredients and 4 steps. The parse path is healthy.

### Why iOS share of a blog loses the content

1. The iOS share-sheet pre-fills the Add Recipe drawer with title + thumbnail
   and sets `addRecipeSource = 'share-extension'` (one-tap save layout).
2. The parse effect (`App.jsx`, the `useEffect` keyed on
   `newRecipeForm.sourceUrl`) *would* fill ingredients/steps from JSON-LD, but
   the one-tap layout lets the user save before parse finishes.
3. The recipe saves empty, so the server runs `enrichAfterSave` via
   `ctx.waitUntil`. That uses the **enrich chain**, which has no JSON-LD
   reader. For a blog, `captionExtract` and `youtubeVideo` bail immediately and
   only `textInference` (via the rate-limited `r.jina.ai`) can work, so it
   usually returns empty. The frontend silent-refetch at t+6s/t+18s then finds
   nothing.
4. The Auto-fill button hits the same enrich chain, so it fails the same way.

Manual paste works only because the user waits for the JSON-LD parse to fill
the form before saving.

## Decisions (from brainstorming)

- Repro path is the **iOS share sheet** (Safari -> share -> ReciFriend), not the
  in-app URL field.
- Facebook is treated **like Instagram**: title + thumbnail reliable, content
  best-effort. Must not break the IG / TikTok / YouTube / blog flows.
- Revert mechanism is **Cloudflare instant rollback** (`wrangler rollback`); no
  feature flag, no git revert needed because the change is additive.
- Rollout is **dev-first and approval-gated**: implement, test in dev + Xcode
  on-device, get explicit approval, then deploy to prod.

## Design

### 1. Blog content fix: `structuredHtml` enrichment strategy

Add a new strategy to `ChainStrategies` and `runEnrichmentChain`, ordered
**first**:

```
structuredHtml -> captionExtract -> youtubeVideo -> textInference -> title-only fallback
```

`structuredHtml(env, url, title)`:

- If the host is Instagram / TikTok / YouTube, return `EMPTY_ENRICHMENT`
  immediately, **without** calling `fetchRecipeHtml`. This keeps social-platform
  enrichment byte-for-byte identical (same latency, same winning strategy).
- Otherwise: `fetchRecipeHtml(url)` -> `extractRecipeDetailsFromHtml(html, url)`.
  If the result has ingredients **or** steps, return them with
  `provenance: 'extracted'`. Otherwise return empty so the chain falls through
  to the existing strategies.

Reuses the exact functions the parse path already uses
(`fetchRecipeHtml`, `extractRecipeDetailsFromHtml`), so blog extraction in
enrich becomes as reliable as in parse.

Wire it into the three chain-building call sites through the existing
`strategies` object: `/recipes/enrich` (`handleEnrichRecipe`),
`enrichAfterSave`, and the re-enrich path. The orchestrator logic
(`runEnrichmentChain` ordering, title-only fallback) is otherwise unchanged.

Net effect: AllRecipes, Fresh Off The Grid, NYT Cooking, and Google Docs get
reliable ingredients+steps on iOS share-save (via `enrichAfterSave` + the
existing silent-refetch) and on the Auto-fill button. No frontend change needed.

### 2. Facebook reels (fb.watch)

Four isolated, additive worker changes mirroring existing Instagram handling:

1. **Allowlist** (`ALLOWED_SOURCE_HOSTS`): add `facebook.com` and `fb.watch`.
2. **Redirect resolution** (`resolveSourceUrl`): add `fb.watch` and the
   `facebook.com/share/r/...` short form to the `needsResolve` set so they
   expand to the canonical `facebook.com/reel/...` or `/watch` URL before fetch
   and cache-keying. The existing post-resolution allowlist re-check still
   applies. (`fbclid` is already stripped by the tracking-param list.)
3. **Caption extraction** (`fetchOembedCaption`): add an `isFacebook` branch
   that reads `og:description` from the public Facebook HTML with the same
   Safari User-Agent and retry loop Instagram uses. Returns the caption when
   Facebook serves it, `null` when login-walled.
4. **Title cleanup** (`extractRecipeDetailsFromHtml`): when the host is Facebook
   and `og:title` is missing or generic, fall back to the `og:description`
   caption and run it through a title extractor (reuse the IG/TikTok
   emoji/sentence logic). Facebook has no usable oEmbed, so it goes through the
   HTML path like Instagram; no new TikTok-style oEmbed branch is added.

Facebook is host-gated everywhere, so the IG / TikTok / YouTube / blog branches
are never entered for a Facebook URL and vice-versa.

## Test plan

### Worker unit tests (vitest, `apps/worker`)

- `structuredHtml` strategy:
  - blog HTML with JSON-LD -> returns ingredients+steps, `provenance:'extracted'`.
  - IG / TikTok / YouTube host -> returns empty and does **not** call
    `fetchRecipeHtml` (assert the injected fetcher is not invoked).
  - blog HTML with no JSON-LD -> empty (falls through).
- `runEnrichmentChain`:
  - blog URL -> `structuredHtml` wins.
  - IG / TikTok URLs -> identical winning strategy and result as before
    (regression).
- `isAllowedSourceHost`: `facebook.com`, `www.facebook.com`, `fb.watch` pass;
  `facebook.com.evil.com` still rejected.
- `resolveSourceUrl`: `fb.watch/xxx` is flagged for resolution; mocked HEAD
  redirect -> canonical URL.
- `fetchOembedCaption`: Facebook HTML with `og:description` -> caption;
  login-wall HTML -> null.

### Regression (must stay green)

Full existing suites: `enrich.test.ts`, `create-recipe.test.ts`,
`public.test.ts`, `gemini.test.ts`, etc. `cd apps/worker && npm test`.

### Pre-deploy smoke test (protect-import-flow rule)

Parse + enrich before any worker ship:

- `POST /recipes/parse` for an IG reel, a TikTok, the AllRecipes repro URL, and
  a `fb.watch` reel -> none regress, blog returns full content.
- `POST /recipes/enrich` (with `DEV_API_KEY`) for the AllRecipes URL ->
  ingredients+steps now returned (the bug fix); for an IG reel -> unchanged.

### Manual on-device (Phase C gate)

- iOS share the AllRecipes URL -> ingredients+steps appear (immediately or
  within the existing t+6s/t+18s silent refetch).
- iOS share a `fb.watch` reel -> accepted, title+thumbnail land, caption content
  best-effort.
- Regression: iOS share one IG reel + one TikTok -> still work as today.

## Rollout (dev-first, approval-gated)

**Phase A - Implement + tests.** Sections 1-2 implemented; all vitest green
locally (unit + regression).

**Phase B - Deploy to dev only.**
- Worker -> dev: `cd apps/worker && npx wrangler deploy --env dev`
  (`recipes-worker-dev` on `api-dev.recifriend.com`; prod worker untouched).
- Frontend dev: Vite + cloudflared tunnel (`dev.recifriend.com`) pointed at the
  dev API.

**Phase C - Manual verification (the gate).**
- Web/dev: share-simulated + paste flows against dev API.
- Xcode/iOS: run the app build pointed at dev; real on-device share-sheet test
  of the AllRecipes URL and a `fb.watch` reel, plus an IG + TikTok regression
  share.
- Explicit user approval required here. Nothing goes to prod until approved.

**Phase D - Prod deploy + revert.** Only after approval.
- Record the current live prod worker deployment ID:
  `npx wrangler deployments list`.
- Confirm a clean `git status` baseline (deploy ships the working tree).
- `cd apps/worker && npx wrangler deploy`.
- Run the pre-deploy smoke test against prod.
- Hard stop if anything is unexpected:
  `cd apps/worker && npx wrangler rollback [previous-deployment-id]` reverts the
  previous version in seconds. Frontend is untouched, so nothing to roll back
  there.

Because the change is purely additive (one new strategy gated to skip social
hosts, plus allowlist entries), any partial failure degrades to today's
behavior rather than breaking existing flows; instant rollback is the explicit
hard stop.

## Out of scope

- Reliable Facebook ingredient/step extraction beyond best-effort caption
  reading (would require video transcription or a residential proxy).
- Frontend changes to the one-tap share-save timing (the server-side enrich fix
  plus the existing silent-refetch already make blog content appear).
- Adding new whitelisted blog domains beyond those already on the allowlist.
