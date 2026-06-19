# Self-Healing Facebook Caption Enrichment — Design

**Date:** 2026-06-18
**Status:** Approved design, pending spec review
**Scope:** Option A (server-only, ships via worker deploy; no iOS change, no schema migration)

## Goal

Two outcomes, sharing one mechanism (the existing per-URL caption cache):

1. **Prevent the failure:** a Facebook import that loses its ingredients/steps when the synchronous enrich times out should **auto-recover** them shortly after save.
2. **One-click re-enrich:** admin/owner re-enrich should reuse the cached caption (no manual paste) and clean up obviously-broken titles.

All changes are in `apps/worker/src/index.ts` (+ a shared helper in `apps/worker/src/brokenDigest.ts`).

## Root cause (verified)

For Facebook, the iOS Share Extension sends the recovered caption to `POST /recipes/enrich` (`handleEnrichRecipe`, ~line 2935). That call has a **10s wall-clock timeout on the iOS side** (`WorkerClient.enrichRecipe`); on any timeout/error it returns `nil`, and `ShareFormView.save()` then creates the recipe **bare** (no ingredients/steps). The caption is **never persisted**:

- The `recipes` table has **no caption column**, and `POST /recipes` is not given the caption.
- The FB branch of `runEnrichmentChain` (~line 6609) short-circuits to `captionProvided` and **never writes the caption cache** (the cache at `caption:${sourceUrl}`, 7-day TTL, is only populated by the Instagram/TikTok `captionExtract` strategy, ~line 6387).
- The post-save `enrichAfterSave` (~line 6656) runs `structuredHtml`/`captionExtract`/`youtubeVideo`/`textInference` — all of which fail for Facebook (datacenter IP is walled) — and does **not** pass `captionProvided` or any caption.

Net: once the synchronous enrich fails, the FB recipe text is gone and nothing can recover it.

## The fix (three changes)

### 1. Cache the Facebook caption (in the FB branch of `runEnrichmentChain`)

In the `if (/facebook\.com|fb\.watch/i.test(resolvedUrl))` branch, when a non-empty provided caption is present (apply the existing `>= 50 chars` guard used by `captionExtract`), write it to the caption cache **before** calling `captionProvided`:

```
await env.AI_PICKS_CACHE?.put(`caption:${resolvedUrl}`, cap, { expirationTtl: 7*24*60*60 })  // best-effort try/catch
```

Centralizing it here means **every** caller that reaches the FB branch with a caption populates the cache: the synchronous `/recipes/enrich`, and a re-enrich where an admin pastes a caption (so the next heal/re-enrich is free). Caching happens even when the subsequent extraction returns empty, so a Gemini failure still leaves the caption recoverable.

**Key consistency (correctness-critical):** the cache key must be `caption:${resolvedUrl}` using the `resolveSourceUrl()` output, identical to what `captionExtract`, `enrichAfterSave`, and `handleReEnrichRecipe` use, so writes and reads line up.

### 2. Auto-heal: `enrichAfterSave` reads the cached caption for Facebook

`enrichAfterSave` already fires via `ctx.waitUntil` right after `POST /recipes` creates a bare recipe, and already has the recipe's `title` + `sourceUrl` and a preserve-on-empty guard. Change it to:

- After `resolveSourceUrl`, best-effort read `caption:${resolvedUrl}` from `AI_PICKS_CACHE`.
- Pass the `captionProvided` strategy into `runChain` and pass the cached caption as `providedCaption`.

Because the FB branch of `runEnrichmentChain` is the only place `providedCaption` is consumed, **non-Facebook behavior is unchanged** (the cached caption is ignored for non-FB URLs). For Facebook, the caption cached in step 1 (seconds earlier, during the failed synchronous enrich) is still present → `captionProvided` extracts the recipe → the existing `enrichAfterSave` UPDATE writes ingredients/steps. The bare import heals itself.

Apply the **title cleanup** (see below) in the same UPDATE.

### 3. One-click re-enrich + title cleanup (`handleReEnrichRecipe`)

Used by both owner re-enrich and admin re-enrich (`handleAdminReEnrichRecipe` delegates to it).

- **Cached-caption fallback:** compute `effectiveCaption = pastedCaption || cachedCaption` where `cachedCaption` is a best-effort read of `caption:${resolvedUrl}`. A pasted caption still wins; an empty paste now falls back to the cache instead of no-opping.
- **Title cleanup:** after a non-empty extraction, if the recipe's current title `looksLikeBrokenTitle()` and the extraction returned a non-empty `title`, include `title = <extracted title>` in the UPDATE. Otherwise leave the title unchanged. (The Gemini extract already returns a `title` field — schema at `buildExtractOnlyPrompt`, mapped in `parsedToEnrichmentResult`.)
- Keep the existing **preserve-on-empty** guard (empty ingredients AND steps → return existing unchanged, no write).

### Shared helper: `looksLikeBrokenTitle`

In `apps/worker/src/brokenDigest.ts` (next to `isGenericFacebookTitle`), exported:

```ts
export function looksLikeBrokenTitle(title: string): boolean {
  const t = String(title ?? '');
  return isGenericFacebookTitle(t) || /\n/.test(t) || t.trim().length > 80;
}
```

Catches the generic FB placeholders (`Facebook Reel`, `Redirecting…`, etc.) and the raw caption-dump titles (multi-line or very long), while leaving clean/user-edited titles alone.

## Data flow (auto-heal)

```
iOS save
  → POST /recipes/enrich  (Facebook + caption)
       runEnrichmentChain FB branch:
         cache caption:{resolvedUrl}   ← step 1 (early, survives a Gemini timeout)
         captionProvided → ingredients/steps (returned if it finishes in time)
     (iOS 10s timeout → returns nil to the app)
  → POST /recipes  (bare recipe, no ingredients)
       create row + ctx.waitUntil(enrichAfterSave)
  → enrichAfterSave (Facebook)         ← step 2
       read caption:{resolvedUrl} → captionProvided → UPDATE ingredients/steps (+ title cleanup)
```

Re-enrich flow (step 3): pasted caption wins; otherwise read `caption:{resolvedUrl}`; extract; UPDATE ingredients/steps and, when the title looks broken, the title too.

## Error handling

- All cache reads/writes are best-effort `try/catch` (existing pattern); a cache miss/failure degrades to current behavior (no heal / manual paste), never an error.
- `enrichAfterSave` stays wrapped in its existing `.catch`; preserve-on-empty applies in both `enrichAfterSave` and `handleReEnrichRecipe`.
- No new failure path is introduced for non-Facebook imports.

## Testing (vitest, mock KV + DB)

- **Cache write:** `runEnrichmentChain` on a Facebook URL with a provided caption writes `caption:${resolvedUrl}` (and still does so when extraction returns empty).
- **Auto-heal:** `enrichAfterSave` on a Facebook recipe with a cached caption runs `captionProvided` and UPDATEs ingredients/steps; with no cached caption it no-ops (current behavior); a non-Facebook recipe is unaffected.
- **Re-enrich fallback:** `handleReEnrichRecipe` with no pasted caption uses the cached caption; a pasted caption overrides the cache.
- **Title cleanup:** `looksLikeBrokenTitle` true for `Facebook Reel`, `Redirecting…`, a multi-line caption dump, and an 80+ char title; false for `Korean Shrimp Pancake (Padakjeon)` and other clean titles. Re-enrich replaces a broken title with the extracted dish name and leaves a clean title untouched.
- **Preserve-on-empty:** an empty extraction makes no write in either path.

## Out of scope

- Durable `caption` column / iOS passing the caption to `POST /recipes` (Option B) — would also recover recipes older than the 7-day cache, but needs a migration + an app build.
- Non-Facebook platforms (already cache + can refetch).
- Recovering recipes whose caption cache has already expired (>7 days since last import/enrich).

## Cost

Negligible: one extra KV write on the FB enrich path and one KV read in `enrichAfterSave`/re-enrich. The auto-heal Gemini extraction only runs for a **bare Facebook recipe that has a cached caption** — exactly the imports worth healing — and replaces the synchronous extraction that just failed rather than adding a steady-state call.
