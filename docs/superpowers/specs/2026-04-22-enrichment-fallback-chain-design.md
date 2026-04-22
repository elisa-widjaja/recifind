# Recipe Enrichment Fallback Chain — Design

**Date:** 2026-04-22
**Scope:** Worker (`apps/worker/src/index.ts`). No frontend changes.

## Goal

Replace the single-path enrichment pipeline with an explicit fallback chain that prefers verbatim extraction from real recipe content (caption text, YouTube video transcript) over Gemini inference from title alone. Add worker-side logging so future enrichment failures can be diagnosed without re-running them live.

## Non-goals

- TikTok/Instagram audio transcription. Downloading video bytes from those platforms is scraping-dependent and fragile; deferred to a follow-up spec. This release only uses YouTube video understanding because Gemini can fetch YouTube URLs directly.
- Persistent telemetry (D1 table for enrichment events). Start with `console.log` viewable via `wrangler tail`; promote to D1 only if a querying use-case emerges.
- Frontend changes. The response shape is unchanged; existing `pendingEnrichRef` post-save PATCH flow at [`App.jsx:3934`](apps/recipe-ui/src/App.jsx#L3934) continues to work.
- Top-comment fetching. Comments on TikTok/Instagram/YouTube often contain the recipe, but their APIs are auth-gated or rate-limited; deferred.
- Re-enriching recipes already saved with inferred data. Only new saves benefit.

## Background

Today, [`handleEnrichRecipe`](apps/worker/src/index.ts#L1874) fetches the rendered page text via `r.jina.ai`, falls back to oEmbed captions for social platforms when the proxy fails, and hands whatever text it got to Gemini via [`buildGeminiPrompt`](apps/worker/src/index.ts#L4265). The existing prompt frames Gemini as a "culinary expert and recipe parser," so Gemini is *allowed* — even nudged — to infer ingredients from the title when the source text is weak. For well-captioned recipes that behavior is fine, but for reels where only the title/caption is available, Gemini hallucinates plausible-looking ingredients that don't match the actual recipe.

## Architecture

One endpoint (`POST /recipes/enrich`) runs three strategies in sequence, stopping at the first that returns non-empty ingredients or steps. Each strategy is a pure async function with the same signature, so the orchestrator is a simple fall-through loop.

```
handleEnrichRecipe(sourceUrl, title):
    resolvedUrl = resolveSourceUrl(sourceUrl)           // already exists
    result = await captionExtract(resolvedUrl, title)
    if result is empty:
        result = await youtubeVideo(resolvedUrl, title) // skips if not YouTube
    if result is empty:
        result = await textInference(resolvedUrl, title) // today's pipeline
    log summary
    return result
```

"Empty" means `result.ingredients.length === 0 && result.steps.length === 0`.

Each strategy returns the full enrichment shape (`{ title, imageUrl, mealTypes, ingredients, steps, durationMinutes, notes }`). The orchestrator merges image URL and title from whichever strategy populated them (first-non-empty wins per field). The response shape is unchanged from today.

## Strategy 1 — captionExtract

**Purpose:** Use the oEmbed caption as-is when the creator wrote the recipe in the post description.

**Input:** `resolvedUrl`, `title`.

**Logic:**
1. Call a new helper `fetchOembedCaption(url)` that extracts the caption for TikTok/Instagram/YouTube via their oEmbed endpoints. The host-dispatch logic already exists inline in [`fetchRawRecipeText`](apps/worker/src/index.ts#L3987); factor it out into the helper so the caption path can reuse it. For non-TikTok/Instagram/YouTube URLs, return `null`.
2. If the caption is `null`, empty, or shorter than 50 characters, return empty result. Too short to contain a real recipe.
3. Build a **strict extract-only prompt** (new `buildExtractOnlyPrompt` function):

    ```
    You are extracting a recipe from a social-media caption. Extract ONLY
    what is explicitly present. DO NOT invent ingredients, quantities, or
    steps.

    Rules:
    - If the caption lists ingredients (bullet points, numbered, or
      comma-separated after "Ingredients:"), extract each one verbatim.
    - If the caption describes steps (numbered, "Step 1:", "Method:",
      etc.), extract each step verbatim. Preserve the creator's voice.
    - Minor normalization is OK: "tbs" -> "tbsp", "1c" -> "1 cup".
    - If the caption does NOT contain explicit ingredients OR explicit
      steps, return empty arrays. DO NOT guess from the title or general
      culinary knowledge.

    Return JSON matching this schema:
    { "ingredients": [], "steps": [], "mealTypes": [],
      "durationMinutes": null | number, "notes": "", "title": "" }

    Caption:
    <captionText>
    ```

4. Call `callGemini(env, prompt)` (existing helper, no changes).
5. Parse response with `parseGeminiRecipeJson` (existing helper).
6. Return parsed result. Orchestrator falls through when `ingredients` and `steps` are both empty.

**Logging:** `console.log('[enrich]', { strategy: 'caption-extract', url: resolvedUrl, captionLength, outcome: 'extracted' | 'empty' | 'error', duration_ms })`.

## Strategy 2 — youtubeVideo

**Purpose:** Use Gemini 2.5 Flash's native YouTube-URL support to extract the recipe from the video's audio and visuals.

**Input:** `resolvedUrl`, `title`.

**Gate:** runs only if `new URL(resolvedUrl).hostname` matches `www.youtube.com`, `youtube.com`, `youtu.be`, or `m.youtube.com`. The existing `resolveSourceUrl` already expands `youtu.be` → `youtube.com/watch?...`. For `youtube.com/shorts/<id>` the URL is used as-is. For non-YouTube URLs this strategy returns empty immediately (no Gemini call, no cost).

**Logic:**
1. Build a video-oriented extract-only prompt (adapt the caption prompt: "You are watching a cooking video. Extract the ingredients the chef shows or says, and the steps they follow. Extract only what is demonstrated or spoken. If the video has no explicit ingredient list or steps, return empty arrays. Minor normalization of units and spelling is allowed.").
2. Extend `callGemini` to accept an optional third argument: `options: { videoUrl?: string; timeoutMs?: number }`. When `videoUrl` is present, construct the multi-part request body:

    ```json
    {
      "contents": [{
        "parts": [
          { "fileData": { "fileUri": "<videoUrl>", "mimeType": "video/*" } },
          { "text": "<videoExtractOnlyPrompt>" }
        ]
      }]
    }
    ```

    When `videoUrl` is absent, `callGemini` behaves exactly as today (backwards-compatible). The existing `callGemini` test at [`gemini.test.ts`](apps/worker/src/gemini.test.ts) continues to pass.

3. Apply a 30s timeout via `AbortController`. If exceeded, return empty (orchestrator falls through).
4. Parse response with `parseGeminiRecipeJson`.
5. Return parsed result.

**Logging:** `console.log('[enrich]', { strategy: 'youtube-video', url: resolvedUrl, outcome: 'extracted' | 'empty' | 'timeout' | 'error', duration_ms })`.

**Cost note:** Gemini video calls consume roughly 5-10x the quota of text calls. Only runs when Strategy 1 is empty and the URL is YouTube, so the common TikTok/Instagram path is unaffected.

## Strategy 3 — textInference (existing pipeline, minus og:image)

**Purpose:** Fallback for everything else. Today's behavior, preserved for the text side.

**Input:** `resolvedUrl`, `title`.

**Logic:**
1. `fetchRawRecipeText(resolvedUrl)` — unchanged from today.
2. If no text and no title, return empty (do NOT throw; orchestrator decides whether this is a terminal empty or just one strategy's empty).
3. Build existing `buildGeminiPrompt` (the "culinary expert" prompt that allows inference).
4. `callGemini` → `parseGeminiRecipeJson`.
5. Return result.

**Note:** `fetchOgImage` is hoisted out of this strategy into the orchestrator (see Image Handling section), so this strategy no longer fetches the image itself.

**Logging:** `console.log('[enrich]', { strategy: 'text-inference', url: resolvedUrl, rawTextLength, outcome: 'extracted' | 'empty' | 'error', duration_ms })`.

## Image handling

Today, `fetchOgImage` runs in parallel with `fetchRawRecipeText` inside `handleEnrichRecipe`, so the og:image is always fetched regardless of whether Gemini succeeds. The new design preserves that guarantee — we do NOT let image fetching become conditional on strategy fall-through.

The orchestrator fires `fetchOgImage(resolvedUrl)` in parallel with the strategy chain (`Promise.all([runStrategies(), fetchOgImage(resolvedUrl)])`). Final `imageUrl` is `ogImage ?? winningStrategyResult.imageUrl ?? ''`, preserving today's "og:image takes priority over Gemini's imageUrl" behavior from [`index.ts:1926`](apps/worker/src/index.ts#L1926).

Individual strategies may still populate `imageUrl` in their result (Strategy 2 could; Strategy 1 likely won't). Those are used only as fallbacks when og:image fetch returned null.

## Orchestrator

```ts
async function handleEnrichRecipe(request, env) {
    // ... existing validation ...
    const resolvedUrl = await resolveSourceUrl(sourceUrl);

    const startedAt = Date.now();

    // og:image fetch runs in parallel with the strategy chain so it's never
    // blocked by (and never blocks) strategy fall-through.
    const [result, winningStrategy, ogImage] = await (async () => {
      const ogImagePromise = fetchOgImage(resolvedUrl);
      let res = await captionExtract(env, resolvedUrl, title);
      let winner = isEmpty(res) ? null : 'caption-extract';
      if (isEmpty(res)) {
        res = await youtubeVideo(env, resolvedUrl, title);
        if (!isEmpty(res)) winner = 'youtube-video';
      }
      if (isEmpty(res)) {
        res = await textInference(env, resolvedUrl, title);
        if (!isEmpty(res)) winner = 'text-inference';
      }
      const ogi = await ogImagePromise;
      return [res, winner, ogi];
    })();

    console.log('[enrich]', {
      url: resolvedUrl,
      winningStrategy: winningStrategy ?? 'none',
      total_duration_ms: Date.now() - startedAt,
      ingredients_count: result.ingredients.length,
      steps_count: result.steps.length,
    });

    return json({ enriched: {
      ...result,
      sourceUrl, // return the original input (today's behavior), not resolvedUrl
      imageUrl: ogImage ?? result.imageUrl ?? '',
    }});
}

const isEmpty = (r) => r.ingredients.length === 0 && r.steps.length === 0;
```

**If all three strategies return empty:** the response has empty ingredients/steps arrays. Frontend treats that the same as it does today (`pendingEnrichRef` PATCH either skips the update or PATCHes an empty delta). No new error path.

**Error handling within strategies:** each strategy catches its own errors and returns empty on failure (logging the error). The orchestrator never throws because of a strategy failure; it only throws if input validation fails (400) or the env is misconfigured (503).

## Response shape

Unchanged. `{ enriched: { title, sourceUrl, imageUrl, mealTypes, ingredients, steps, durationMinutes, notes } }`. No new fields for provenance — we log the winning strategy server-side only. If a future UX need arises for "ingredients extracted from video" badging, we add a `source` field then.

## Frontend impact

Zero. The existing enrichment `useEffect` at [`App.jsx:3593`](apps/recipe-ui/src/App.jsx#L3593) continues to call `/recipes/enrich` and consume the same response shape. Users will see better ingredients appear for YouTube cooking videos and for captioned reels; for TikTok/Instagram reels without ingredients in the caption, behavior matches today (Gemini infers from title).

## Testing

- **Unit tests** (`apps/worker/src/enrich.test.ts`, new file):
  - `captionExtract` returns empty when caption is `null`, empty, or < 50 chars (no Gemini call).
  - `captionExtract` extracts verbatim when caption contains "Ingredients:\n- ...".
  - `captionExtract` returns empty when caption is just a title with no structure (mocked Gemini returns empty arrays).
  - `youtubeVideo` returns empty immediately for non-YouTube URLs (no Gemini call).
  - `youtubeVideo` sends the correct multi-part body for a YouTube URL (mocked fetch).
  - `youtubeVideo` returns empty on 30s timeout.
  - `textInference` is unchanged behaviorally — existing tests for the text path continue to pass.
  - Orchestrator: caption wins → skips video + inference. Caption empty + YouTube → video wins. Caption empty + non-YouTube → falls through to text inference.
- **`callGemini` contract**: existing `gemini.test.ts` stays green; new test asserts the multi-part body shape when `videoUrl` option is passed.
- **Manual end-to-end** (after deploy to `api-dev.recifriend.com`):
  1. TikTok reel with "Ingredients:" in caption → `[enrich] { winningStrategy: 'caption-extract' }` in `wrangler tail`, ingredients match caption.
  2. Instagram reel with no caption recipe → falls to `text-inference`, matches today's (imperfect) behavior.
  3. YouTube cooking video (3-10 min) → `{ winningStrategy: 'youtube-video' }`, ingredients look complete.
  4. YouTube Short (< 60s) → same as above.
  5. Non-recipe URL (e.g., news article) → `{ winningStrategy: 'text-inference' or 'none' }`, no crash.
  6. Private/deleted video → strategy errors gracefully, orchestrator returns empty result, frontend shows no ingredients (acceptable).

## Files changed

- **Modify** `apps/worker/src/index.ts`:
  - Extract `fetchOembedCaption(url)` helper from `fetchRawRecipeText` (refactor without behavior change).
  - Add `buildExtractOnlyPrompt(captionText)` and `buildVideoExtractOnlyPrompt()` functions.
  - Add `captionExtract(env, url, title)`, `youtubeVideo(env, url, title)`, `textInference(env, url, title)` strategy functions.
  - Extend `callGemini(env, prompt, options?)` to accept `{ videoUrl, timeoutMs }`; default behavior unchanged.
  - Rewrite `handleEnrichRecipe` body to use the orchestrator pattern described above.
- **New** `apps/worker/src/enrich.test.ts`: unit tests for each strategy + the orchestrator fall-through logic.

No frontend changes. No schema changes. No new env vars or secrets.

## Rollout

1. Deploy to dev worker (`api-dev.recifriend.com`) via `npx wrangler deploy --env dev`.
2. Manually verify the six scenarios above via `wrangler tail --env dev` + iOS/web testing.
3. If results look clean, deploy to prod (`npx wrangler deploy`) — same command, no `--env` flag.

No migration, no flag-gating needed. Worst case (all strategies fail) matches today's behavior (empty or inferred ingredients).
