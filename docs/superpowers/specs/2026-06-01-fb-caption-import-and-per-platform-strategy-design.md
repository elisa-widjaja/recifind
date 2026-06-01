# Facebook full-caption import + per-platform import strategy & regression dataset

Date: 2026-06-01
Status: Design approved, pending spec review

## Summary

Three related deliverables for the recipe-import pipeline, sequenced so the
regression net lands before any behavior change:

1. **FB full-caption import.** When a Facebook reel's creator wrote the recipe
   in the caption, import the real ingredients/steps, not just a title +
   thumbnail. The worker is login-walled by FB from datacenter IPs, so the iOS
   Share Extension fetches the **full** caption on-device (residential IP) and
   hands it to the worker, which runs the **existing** Gemini caption-extraction.
   Same content behavior as Instagram/TikTok: recipe when the caption has one,
   title + thumbnail otherwise.
2. **A documented per-platform import strategy** (FB / IG / TikTok / YouTube /
   recipe blogs) as a living reference doc, capturing where title, image, and
   content come from for each platform, the fallback chain, and known ceilings.
3. **Per-platform regression dataset** (deterministic fixtures, Gemini mocked)
   that pins current behavior so the FB change cannot regress it, plus a
   designed-but-deferred Gemini quality **eval set**.

Hard constraint: **must not regress current import behavior** for any platform.

## Key decisions (from brainstorming)

- **Datasets: both, fixtures-first.** A deterministic regression net first; a
  real-Gemini quality eval set as a deferred phase 2.
- **FB-only code change (minimal blast radius).** IG/TikTok/YouTube/blog code
  paths are untouched. The device->worker caption contract is *designed* to be
  extensible to other platforms later, but only FB consults it in this spec.
- **Regression net pins the deterministic layer with Gemini mocked.** Real-Gemini
  quality lives only in the eval set.
- **FB full-caption extraction = `og:description`-anchored** (Approach 1). The
  truncated `og:description` is a prefix of the full caption; anchor on it,
  read the full string out of the page's inline JSON, unescape. No dependence
  on FB-specific JSON keys (which FB churns); falls back to the truncated
  `og:description`. Rejected: known-key JSON parsing (brittle) and
  longest-text-node heuristics (error-prone).
- **Swift extractor is tested natively (hybrid).** Add an iOS XCTest target for
  the Swift `extractFullCaption`; keep `vitest` fixtures for all worker-side
  parsing. Rejected a TS-only proxy of the Swift code: Swift `NSRegularExpression`
  and JS regex differ, and the stripper dual-copy already drifted this session
  (Swift missed the case-insensitivity the TS copy had).

## Design

### Section A: FB full-caption import (the feature)

Data flow (FB shares only):

1. **Device** (`DeviceMetadataFetcher`, residential IP) fetches the reel HTML
   (already does), and extracts: title (existing), `og:image` (existing, now
   entity-decoded), and **NEW** the full caption via `extractFullCaption`.
2. **Share extension** (`ShareFormView.save`) passes the full caption to the
   worker on the existing enrich call.
3. **`WorkerClient.enrichRecipe`** gains an optional `caption: String?`, added to
   the POST body.
4. **Worker `handleEnrichRecipe`** reads `body.caption` (string, trimmed, capped
   at 10 KB to bound Gemini cost).
5. **`runEnrichmentChain`** gains an optional `providedCaption`. The FB branch
   (currently always title-only) becomes:
   - FB **with** a usable provided caption -> run the existing
     `callGeminiExtract(buildExtractOnlyPrompt(caption))` (the same path
     `captionExtract` uses for IG/TikTok). Provenance `extracted` when it yields
     ingredients/steps, else `title-only`.
   - FB **without** a caption (device login-walled / rate-limited) -> title-only,
     exactly as today.

`providedCaption` is consulted **only for FB hosts** in this spec, so non-FB
enrichment is byte-for-byte identical.

`extractFullCaption(html:, ogDescriptionPrefix:)` (Swift, pure function): take
the first ~40 chars of the decoded `og:description` as an anchor, find it in the
raw HTML, walk out to the enclosing JSON string boundary, unescape (`\n`,
`\uXXXX`, `\/`, HTML entities), return it. If the anchor isn't found or the
result is no longer than the `og:description`, fall back to the
`og:description`. The defensive `looksLikeEngagementNoise` gate stays as the
backstop for stats-only captions.

### Section B: Per-platform import strategy (`docs/import-platform-strategy.md`)

Living reference doc with this matrix:

| Platform | Title / Image | Content (ingredients/steps) | Fetched where | Fallback chain | Known ceiling |
|---|---|---|---|---|---|
| Recipe blogs (AllRecipes, NYT Cooking, Fresh Off The Grid, Google Docs, Pinterest) | og/twitter meta | JSON-LD (`recipeIngredient`/`recipeInstructions`) via `extractRecipeDetailsFromHtml` | Worker | `structuredHtml` -> `textInference` -> title-only | reliable |
| Instagram | og:description caption -> `extractInstagramRecipeTitle`; device fallback | caption -> Gemini (`captionExtract`) | Worker (caption); device (title/image fallback) | `captionExtract` -> `textInference` -> title-only | datacenter rate-limiting; caption-less -> title-only |
| TikTok | og caption -> `extractTikTokRecipeTitle`; device fallback | caption -> Gemini | Worker (caption); device fallback | `captionExtract` -> `textInference` -> title-only | caption-less -> title-only |
| YouTube | og meta | Gemini video understanding (`youtubeVideo`) | Worker (Gemini reads video URL) | `youtubeVideo` -> `textInference` -> title-only | non-cooking -> title-only |
| Facebook (NEW) | device caption -> dish-name extract; `og:image` entity-decoded | device full caption -> Gemini, only when provided | Device (residential); worker login-walled | device caption -> Gemini -> title-only / "Facebook Reel" placeholder | login-wall/rate-limit inconsistency; recipe-in-video (no caption) -> title-only |

Cross-cutting invariants documented: the allowlist gate, `isFacebookLinkShim`
security guard, `og:image` re-hosting to Supabase, device-first precedence for
FB vs worker-first for everyone else.

### Section C: Regression dataset + eval set

**Phase 1 - deterministic regression net** (`apps/worker/src/fixtures/import/` +
`import-fixtures.test.ts`; iOS XCTest target). Real captured inputs paired with
exact deterministic outputs, no network/Gemini:

- Blogs: saved trimmed `.html` -> `extractRecipeDetailsFromHtml` ->
  `{title, imageUrl, ingredients, steps}`.
- IG / TikTok: saved caption string -> `extractInstagram/TikTokRecipeTitle` ->
  title; saved og HTML -> `fetchOembedCaption` (fetch mocked) -> caption.
- YouTube: saved page -> title / video-id / `og:image`.
- FB: saved reel HTML -> `extractFullCaption` -> full caption; `og:description`
  samples -> `stripFacebookEngagementPrefix` / `looksLikeEngagementNoise`.
- Cross-cutting: per-platform URL forms -> `resolveSourceUrl` /
  `isAllowedSourceHost` / `isFacebookLinkShim`.

**Gemini-mocked wiring tests** (extend `enrich.test.ts`): FB + provided caption
-> Gemini-extract path runs (mocked) -> provenance `extracted`; FB + no caption
-> title-only; IG/TikTok/blog -> unchanged (regression assertions).

**Swift coverage (hybrid):** an iOS XCTest target tests the real
`extractFullCaption` (and the stripper/noise helpers) against FB HTML fixtures.
Worker-side parsing stays in `vitest` (runs in CI automatically). FB HTML
fixtures are shared/copied between the two suites.

**Phase 2 - eval set (deferred, designed not built):** a labeled set of real
captions/URLs per platform with hand-labeled expected ingredients/steps, run by
a standalone `npm run eval:import` against real Gemini, reporting per-platform
precision/recall. Not in CI (cost + non-determinism); run manually when tuning
prompts. Size-capped with a documented Gemini call count.

## Testing & verification (no-regression guarantee)

1. Capture the net **before** changing behavior: Phase 1 fixtures pin current
   output for all five platforms.
2. FB-only code change: IG/TikTok/YouTube/blog fixtures must stay green
   unchanged; any accidental regression fails the suite.
3. Worker suite green: `cd apps/worker && npm test` (the 4 known pre-existing
   `public.test.ts` / `friends-suggestions.test.ts` mock failures excepted).
4. iOS XCTest green (run in Xcode / `xcodebuild` on a Mac; not in the worker CI).
5. Pre-deploy smoke test (protect-import-flow): live `parse` + `enrich` for an IG
   reel, a TikTok, the AllRecipes URL, and an FB reel.
6. **Manual on-device Xcode test (the gate):** real share-sheet on a device - FB
   reel *with* a written caption -> ingredients/steps appear; FB reel *without* a
   caption -> title-only / "Facebook Reel"; one IG reel + one TikTok -> unchanged.
   Explicit approval here before prod.

## Rollout (dev-first, approval-gated)

- **Phase 1 - Safety net (no behavior change).** Strategy doc + worker `vitest`
  fixtures + iOS XCTest target with current-behavior fixtures. Land + commit
  first.
- **Phase 2 - FB feature.** Swift `extractFullCaption` (+ XCTest fixtures),
  `WorkerClient`/`ShareFormView` caption plumbing, worker `caption` param +
  `providedCaption` in `runEnrichmentChain` (reverse the title-only short-circuit
  to caption-driven), + FB fixtures / wiring tests. Deploy worker to dev; test in
  Xcode against dev.
- **Phase 3 - Eval set (deferred).** Built when tuning quality.
- **Release:** native change ships in build 27 / 1.0.7 (already bumped). Final
  cleanup removes the temp diagnostics (`os_log`/`fbCaptureLog`/clipboard) and
  reverts `WorkerClient` to `api.recifriend.com`. Worker change is additive ->
  rollback = `wrangler rollback`.

## Out of scope

- Video/audio transcription for FB/IG (the recipe-in-video case stays title-only).
- Moving IG/TikTok caption fetching on-device (designed-for but separate spec).
- Residential proxies / third-party scraping APIs.
- Any change to the YouTube Gemini-video path or the blog JSON-LD path.

## Current state carried in from the prior FB session (working tree)

Already implemented + on dev (uncommitted iOS, committed worker `84da3e5` + an
uncommitted "Facebook" copy edit):
- Worker: FB allowlisted, `stripFacebookEngagementPrefix`, FB title-only
  short-circuit in `runEnrichmentChain` (Phase 2 reverses this to caption-driven),
  broadened stripper regex, deployed to dev.
- iOS: on-device FB fetch + device-first precedence, `og:image` entity-decode
  fix, defensive `looksLikeEngagementNoise` gate, temp diagnostics
  (`os_log`/`fbCaptureLog`/clipboard), `WorkerClient` pointed at dev.
