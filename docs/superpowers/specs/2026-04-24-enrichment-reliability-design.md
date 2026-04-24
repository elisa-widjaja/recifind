# Enrichment Reliability — Design

**Date:** 2026-04-24
**Scope:** Worker ([apps/worker/src/index.ts](apps/worker/src/index.ts)), one D1 migration, and [apps/recipe-ui/src/App.jsx](apps/recipe-ui/src/App.jsx).

## Goal

Stop producing enriched content from nothing. When enrichment falls back to Gemini inference on real source text, surface that to the user as an "AI-inferred" chip. When enrichment returns empty, show an actionable empty state instead of silently leaving the user with a blank recipe. Give every recipe a manual re-enrich escape hatch for after-the-fact correction.

## Non-goals

- Adding a new Instagram data source (Apify, ScrapingBee, rotating-UA scraping, Gemini video byte-upload). That's a separate spec; this one is strictly about stopping the hallucination and labeling the existing inference path.
- Retroactive relabeling of rows saved before this change. Legacy rows stay `provenance = NULL`.
- A scheduled server-side retry cron. We use client-side silent retry on open instead.
- Strengthening [`buildExtractOnlyPrompt`](apps/worker/src/index.ts#L4125) beyond what it already covers. The existing prompt already recognizes "Method:", "For the sauce", "For the <component>", multi-language headings, and emoji-numbered steps. If specific captions fail to extract, address them in a follow-up.
- Rate-limiting the re-enrich endpoint. Low abuse risk at current scale.

## Background

Today, [`textInference`](apps/worker/src/index.ts#L4286) runs two passes: a strict verbatim-extract prompt, then a fall-through "culinary expert" prompt that's allowed to infer. When `fetchRawRecipeText` returns null (Instagram reel, r.jina.ai rate-limited, oEmbed caption empty), `textInference` falls back to the synthetic string `Recipe: ${title}` and still runs pass-2, which hallucinates plausible-looking ingredients from the title alone. Observed: a cucumber-tea-sandwiches reel produced honeydew + prosciutto.

The existing error-page heuristic at [index.ts:4311](apps/worker/src/index.ts#L4311) catches `rawText` bodies shorter than 500 chars that match `HTTP ERROR \d{3}|Too Many Requests|Target URL returned error`, but it does not catch the title-only fallback path — because `rawText` is null there, not an error page.

## Three outcomes

Every recipe save produces exactly one of these three outcomes. The architecture stores which one on the row so the UI can render accordingly.

| Outcome | When | `provenance` | UI |
|---|---|---|---|
| Extracted | `captionExtract`, `youtubeVideo`, or `textInference` pass-1 (strict prompt) produced content | `'extracted'` | No chip, no banner. |
| Inferred | `textInference` pass-2 ran against real body text (≥ 500 chars, not an error page) and produced content | `'inferred'` | Tappable "AI-inferred" chip at the bottom of the recipe detail, above "View Source". On tap: helper copy "We couldn't read the full recipe. Please verify with the source." |
| Empty | All strategies returned empty, including the new strict gate that skips pass-2 when there is no substantive source text | `NULL` | Inline message above the ingredients area: "We couldn't read this recipe. **Enhance with AI** or refer to the source." "Enhance with AI" triggers the re-enrich endpoint, matching the edit-mode Auto-fill affordance at [App.jsx:5425](apps/recipe-ui/src/App.jsx#L5425). |

## Data model

One migration, one new column, no constraints beyond the application's enum of allowed values.

**`apps/worker/migrations/0011_add_recipes_provenance.sql`:**

```sql
ALTER TABLE recipes ADD COLUMN provenance TEXT;
-- values: 'extracted' | 'inferred' | NULL
-- NULL covers: legacy rows (pre-migration), rows where all strategies returned empty,
-- rows created by the manual Add-Recipe flow with no source URL, and rows the user
-- has since edited manually (see "PATCH behavior" below).
```

No CHECK constraint — application-level validation is enough, and leaving the column constraint-free simplifies future additions like `'user-edited'` if we ever want that.

## Worker changes

### W1 — Hallucination gate in `textInference`

The core fix. Rewrite the head of [`textInference`](apps/worker/src/index.ts#L4286) so that the strategy returns `EMPTY_ENRICHMENT` without calling Gemini whenever the source text is not substantive.

**Gate rule — applies to the whole strategy (both passes):** `textInference` makes any Gemini call only when all of:
- `rawText` is non-null, AND
- `rawText.length >= 500`, AND
- `rawText` does not match the existing error-page heuristic (`/HTTP ERROR \d{3}|Too Many Requests|Target URL returned error/i`).

If any of those fail, `textInference` returns `EMPTY_ENRICHMENT` with `provenance: null` immediately. Neither pass-1 (strict extract) nor pass-2 (inference) runs. This is what prevents the title-only hallucination and also spares a Gemini call on short error-page bodies.

**Title-only fallback removed.** Today's line `const textForGemini = rawText || (title ? \`Recipe: ${title}\` : null);` is deleted; the strategy uses `rawText` only, and the gate handles the null case.

When the gate passes, the two-pass structure is unchanged: pass-1 strict-extract runs first; if it returns empty, pass-2 inference runs. Pass-1 success → `provenance: 'extracted'`. Pass-2 success → `provenance: 'inferred'`.

**Logging:** add `reason: 'no-raw-text' | 'too-short' | 'fetch-error'` to the existing `[enrich]` log line when the gate rejects input.

### W2 — Provenance propagation

Add `provenance: 'extracted' | 'inferred' | null` to the `EnrichmentResult` type at [index.ts:4105](apps/worker/src/index.ts#L4105) and to `EMPTY_ENRICHMENT`. Each strategy populates it:

- `captionExtract` — `'extracted'` on non-empty result, `null` on empty.
- `youtubeVideo` — `'extracted'` on non-empty, `null` on empty.
- `textInference` pass-1 non-empty → `'extracted'`.
- `textInference` pass-2 non-empty → `'inferred'`.
- All empty → `null`.

`parsedToEnrichmentResult` does not set `provenance` (Gemini doesn't return it); the strategy sets it after parse. `runEnrichmentChain` returns it through unchanged.

### W3 — `enrichAfterSave` persists provenance

Extend the `UPDATE` at [index.ts:4425](apps/worker/src/index.ts#L4425) to include `provenance = ?`. The B1 "silent no-op when empty" guard at [index.ts:4420](apps/worker/src/index.ts#L4420) is preserved — if `result.ingredients` and `result.steps` are both empty, no UPDATE fires and the row keeps `provenance = NULL` from the initial insert.

### W4 — `handleEnrichRecipe` sync endpoint returns provenance

The sync `/recipes/enrich` endpoint (the one the web Add-Recipe drawer polls during drafting, not to be confused with `enrichAfterSave`) returns the `enriched` object. Add `provenance` inside it. The web save flow includes the field in the `POST /recipes` body so `handleCreateRecipe` can persist it directly.

### W5 — `handleCreateRecipe` accepts provenance

Extend the create handler to accept `provenance` in the request body, validate it is one of `'extracted' | 'inferred' | null`, and insert it. Defaults to `NULL` when absent (preserves today's behavior for the share-extension path which saves first and enriches after).

### W6 — `handleUpdateRecipe` clears provenance on content edits

When a `PATCH /recipes/:id` body modifies any of `ingredients`, `steps`, or `notes`, set `provenance = NULL` in the same `UPDATE`. Rationale: once the user has touched the content, it's no longer "AI-inferred" — they've taken ownership. The chip disappears automatically. PATCHes that only change `title`, `image_url`, `meal_types`, `duration_minutes`, `is_public`, etc. leave `provenance` untouched.

### W7 — `POST /recipes/:id/re-enrich`

New endpoint. JWT-gated (not public).

**Flow:**
1. Load `recipes` row by id. 404 if missing.
2. Assert `row.user_id === authUserId`. 401 if not.
3. If `row.source_url` is empty, return 400 `{ error: 'source_url required for re-enrich' }`.
4. Run `runEnrichmentChain(env, row.source_url, row.title, { captionExtract, youtubeVideo, textInference })`.
5. **Preserve-on-empty:** if the chain returns empty (ingredients and steps both empty), do NOT overwrite existing content. Return `{ recipe: existingRow }` unchanged. This prevents a user from clicking re-enrich during a rate-limit and losing a recipe that previously had inferred content.
6. Otherwise, `UPDATE` the row with the new ingredients/steps/meal_types/duration_minutes/notes/provenance and `updated_at`. `image_url` is not touched (same policy as `enrichAfterSave`).
7. Return `{ recipe: refreshedRow }`.

**Concurrency:** no explicit locking. If a silent-retry from one client and a menu-triggered re-enrich from another fire at the same time, they'll both run the chain and one UPDATE will win. Acceptable; both writes produce valid content.

### W8 — Silent retry infrastructure (none)

Per design decision β: no cron, no server-side scheduled retry. The worker side of this is just the `/recipes/:id/re-enrich` endpoint above; retry behavior lives entirely in the frontend. Option α (cron every 5 min) was considered and rejected because r.jina.ai rate-limit windows often run hours, not minutes, so the 5-min window wouldn't reliably hit a different state.

## Frontend changes

All in [apps/recipe-ui/src/App.jsx](apps/recipe-ui/src/App.jsx). The recipe model (state shape, sync payloads, create/update bodies) threads `provenance` through alongside the existing fields. No new components file — keep colocated with the recipe detail dialog.

### F1 — Carry `provenance` through the recipe model

- `syncRecipesFromApi` (and whichever mapper shapes the row into frontend form) includes `provenance`.
- The draft shape in the Add-Recipe drawer stores `provenance` when `/recipes/enrich` returns it, then passes it on the `POST /recipes` body.
- `activeRecipe` / `activeRecipeDraft` carry it into the detail dialog.

### F2 — "AI-inferred" chip at the bottom of the recipe detail

Render when `activeRecipe.provenance === 'inferred'`. Positioned above the "View Source" link.

- MUI `<Chip>`, size="small", variant="outlined", color muted (e.g., warning.light tone), icon `<AutoAwesomeIcon>`, label "AI-inferred".
- Tappable. Local `useState` toggle; when open, a small `<Typography variant="caption">` renders below the chip with the copy: `We couldn't read the full recipe. Please verify with the source.` Tap again to collapse. Resets to collapsed when the dialog closes.
- Hidden for all other provenance values, including `null`.

### F3 — Empty-state inline message above ingredients

Render when `activeRecipe.provenance === null && ingredients.length === 0 && steps.length === 0 && source_url`. Positioned in place of (or above) the empty ingredients list in the recipe detail.

- Copy: `We couldn't read this recipe. Enhance with AI or refer to the source.`
- "Enhance with AI" is an inline `Typography component="button"` styled identically to the edit-mode Auto-fill affordance at [App.jsx:5425](apps/recipe-ui/src/App.jsx#L5425) — `AutoAwesomeIcon`, `gap: 0.5`, `color: primary.main`, hover underline. During an in-flight call, the icon swaps to `<CircularProgress size={16} />` and the button is disabled.
- Tap calls `POST /recipes/:id/re-enrich`. On success the recipe updates in place via the same mechanism used elsewhere for recipe updates (local state + any sync hooks). On failure the button re-enables; no toast (user can retry).
- Suppressed when `source_url` is empty — those are manual recipes the user intentionally saved title-only; leaving them alone is correct.

### F4 — "Re-enrich with AI" menu item

New item in the recipe detail overflow menu (the three-dot menu on the recipe detail dialog owner layout). Always visible when `source_url` is set, regardless of current provenance — this is the user's manual override for recipes they suspect are hallucinated.

- Label: `Re-enrich with AI` with `<AutoAwesomeIcon>` icon.
- Tap closes the menu, fires `POST /recipes/:id/re-enrich`, shows a loading snackbar/toast `Refreshing recipe…` while in flight.
- On success: recipe updates in place; dismiss the loading toast; show a `Recipe refreshed` success toast.
- On failure: dismiss the loading toast; show an error toast `Couldn't refresh recipe. Try again later.`
- No confirmation dialog — user can edit the recipe back to its old content if they dislike the new version. The preserve-on-empty worker rule (W7 step 5) prevents accidental content loss.

### F5 — Silent retry on open (Option β)

`useEffect` scoped to the recipe detail dialog. When the dialog transitions to open with a recipe meeting all of:

- `provenance === null`, AND
- `ingredients.length === 0 && steps.length === 0`, AND
- `source_url` is truthy, AND
- `createdAt` is within the last 24 hours,

fire `POST /recipes/:id/re-enrich` silently in the background. While the request is in flight, render a subtle `<CircularProgress size={16} />` with the caption `Checking for ingredients…` in place of the F3 empty-state message. On success the recipe updates and F3 disappears naturally (because ingredients are now populated or provenance is now `'inferred'`). On failure fall through to F3 — "Enhance with AI" is still there as a manual fallback.

Eligibility is window-gated. Recipes older than 24h never auto-retry; the user must use F4 ("Re-enrich with AI" menu item). This is the implicit stop condition — no per-row attempt counter persisted to D1.

**Session-level debounce.** A module-level `Set<recipeId>` tracks which recipes have already triggered a silent retry during the current app session. If the user dismisses and reopens the same still-empty recipe, the retry does not fire a second time in the same session — the F3 empty-state message renders immediately so the user sees "Enhance with AI" without a prior spinner. The set resets on page reload. This prevents rapid open/close/open loops from spamming `/recipes/:id/re-enrich`.

## Testing

### Worker unit tests (extend [apps/worker/src/enrich.test.ts](apps/worker/src/enrich.test.ts))

- Gate — pass-2 skipped when `rawText` is `null`. No Gemini call. Returns `EMPTY_ENRICHMENT` with `provenance: null`.
- Gate — pass-2 skipped when `rawText` < 500 chars. Same assertions.
- Gate — pass-2 skipped when `rawText` matches error-page heuristic. Same assertions.
- Gate — pass-1 runs when `rawText` is substantive. Pass-1 success tagged `'extracted'`.
- Gate — pass-2 runs and tags `'inferred'` when pass-1 empty and `rawText` is substantive.
- Strategy provenance — `captionExtract` success tags `'extracted'`, empty tags `null`. Same for `youtubeVideo`.
- `enrichAfterSave` UPDATE includes `provenance` binding. No UPDATE fires when all strategies empty.
- Existing `gemini.test.ts` multi-part body tests continue to pass (no `callGemini` signature change).

### Worker integration test (new [apps/worker/src/re-enrich.test.ts](apps/worker/src/re-enrich.test.ts))

- 404 for non-existent recipe id.
- 401 for recipe owned by another user.
- 400 for recipe with no `source_url`.
- Non-empty chain result → UPDATE fires, new provenance persisted, response includes refreshed row.
- Empty chain result → preserve-on-empty: no UPDATE, existing row returned unchanged.
- Asserts `image_url` is not modified on a successful re-enrich.

### Manual E2E on `api-dev.recifriend.com`

1. Instagram reel with ingredients in caption → `winningStrategy: 'caption-extract'`, `provenance='extracted'`, no chip.
2. Instagram reel where r.jina.ai rate-limits and oEmbed caption is title only → all strategies empty, `provenance=null`, empty ingredients. Detail view shows the F3 empty-state message. Tap "Enhance with AI" → re-enrich runs; either populates or stays empty with button re-enabled.
3. Food blog URL with body text but no structured recipe → `textInference` pass-1 empty, pass-2 inferred, `provenance='inferred'`. Chip renders at the bottom; tap reveals the caveat copy.
4. YouTube cooking video → video strategy wins, `provenance='extracted'`.
5. Save an Instagram reel during a rate-limit window so it lands empty. Wait for the window to clear (or retry after a short break), reopen the recipe — F5 silent retry fires, brief "Checking for ingredients…" spinner, then ingredients populate.
6. Manual re-enrich: on an extracted recipe, use the F4 overflow menu item. Toast shows "Refreshing recipe…", then "Recipe refreshed". Content is replaced.
7. Edit-flow provenance clearing: edit an inferred recipe's ingredients via the edit drawer, save, reopen → chip is gone (`provenance` cleared by W6).

### Manual regression checks

- Web-drawer Add flow still works end-to-end; `provenance` flows sync → create → detail correctly.
- Share-extension save path unaffected: save fires, `enrichAfterSave` runs async, `provenance` lands on the row within seconds.
- Existing recipes (pre-migration) with `provenance = NULL` and non-empty ingredients continue to render with no chip and no empty-state message.

## Rollout

1. Apply migration to dev D1: `npx wrangler d1 execute recipes-db --env dev --file apps/worker/migrations/0011_add_recipes_provenance.sql`.
2. Deploy worker to dev: `cd apps/worker && npx wrangler deploy --env dev`.
3. Manually verify scenarios 1–4 above against `api-dev.recifriend.com` via `wrangler tail --env dev`.
4. Apply migration to prod: `npx wrangler d1 execute recipes-db --file apps/worker/migrations/0011_add_recipes_provenance.sql`.
5. Deploy worker to prod: `cd apps/worker && npx wrangler deploy`.
6. Deploy frontend: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`.
7. Run scenarios 5–7 on production (smoke-level).

No feature flag. Rollback: revert the worker + frontend commits and redeploy. The new column is harmless if unread.

## Files changed

**New:**
- `apps/worker/migrations/0011_add_recipes_provenance.sql`.
- `apps/worker/src/re-enrich.test.ts`.

**Modified:**
- [apps/worker/src/index.ts](apps/worker/src/index.ts):
  - `EnrichmentResult` type + `EMPTY_ENRICHMENT` — add `provenance`.
  - `captionExtract`, `youtubeVideo`, `textInference` — tag provenance on success paths.
  - `textInference` — new gate (W1), remove title-only fallback.
  - `runEnrichmentChain` — unchanged signature; provenance flows through `EnrichmentResult`.
  - `enrichAfterSave` — UPDATE binds `provenance`.
  - `handleEnrichRecipe` — response `enriched` includes `provenance`.
  - `handleCreateRecipe` — accept and persist `provenance` from request body.
  - `handleUpdateRecipe` — clear `provenance` when `ingredients`, `steps`, or `notes` change.
  - `handleReEnrichRecipe` — new handler. Wire to `POST /recipes/:id/re-enrich`.
- [apps/worker/src/enrich.test.ts](apps/worker/src/enrich.test.ts) — new gate tests + provenance assertions.
- [apps/recipe-ui/src/App.jsx](apps/recipe-ui/src/App.jsx):
  - Recipe model — thread `provenance` through sync, create body, detail state.
  - Recipe detail dialog — F2 chip, F3 empty-state message, F4 overflow menu item, F5 silent-retry effect.
