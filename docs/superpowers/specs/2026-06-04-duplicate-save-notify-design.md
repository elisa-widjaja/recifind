# Duplicate-save detect & notify (design)

Date: 2026-06-04
Status: spec for review (not yet implemented)

## Problem

Saving a recipe the user already has is silent and inconsistent:

- If the same `source_url` is re-saved within 60s, the worker dedups (returns the
  existing recipe at HTTP 200) but the frontend shows the normal "saved!" success
  toast, so the user gets no signal it was a duplicate.
- If the same `source_url` is re-saved after 60s, a second row is created and a
  visible duplicate appears in the collection.

Reported symptom: "Saving duplicate recipes should trigger a snackbar notification.
Right now it's just silent and the duplicate doesn't show up."

## Evidence (live read-only check, prod, 2026-06-04)

- Owner account (`elisa.widjaja@gmail.com`) has 1 real duplicate: the same Instagram
  reel saved **3 days apart** (Dec 5 and Dec 8). Both rows are **empty** (0
  ingredients, 0 steps) - a failed import the user re-tried days later.
- App-wide: **9 duplicate groups, 9 extra rows**.

Two design-shaping facts:
1. Real duplicates happen days apart, not within 60s. A narrow window catches none
   of them, so it would ship a toast that almost never fires while the visible
   duplicate stays. **Rejected** in favor of unbounded server-side detection.
2. The one real duplicate found is the **failed-import-retry** case. A blunt "block
   all duplicates" would have prevented the user's second enrichment attempt. So the
   detection must treat an empty existing row as a refresh target, not a dead end.

## Chosen approach: B - server-detected duplicate, with empty-row refresh

Detect duplicates by an unbounded `(user_id, source_url)` match in `handleCreateRecipe`.
Never create a second row. Return the existing recipe with a `duplicate: true` flag so
clients can show the right message. When the existing row is empty, use the re-save to
heal it (backfill carried content and/or re-trigger enrichment) instead of dead-ending.

### Worker: `handleCreateRecipe` (`apps/worker/src/index.ts`, ~line 2469)

Replace the 60s-bounded dedup block with an unbounded lookup:

```
if (recipe.sourceUrl) {
  const dupe = await env.DB.prepare(
    `SELECT id FROM recipes WHERE user_id = ? AND source_url = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(user.userId, recipe.sourceUrl).first() as { id: string } | null;

  if (dupe) {
    const existing = await loadRecipe(env, user.userId, dupe.id);
    const existingEmpty = existing.ingredients.length === 0 && existing.steps.length === 0;
    const incomingHasContent = recipe.ingredients.length > 0 || recipe.steps.length > 0;

    if (existingEmpty && incomingHasContent) {
      // Failed-import retry where the re-save carries content: backfill the
      // existing row's ingredients/steps (and title/image if the old row lacks
      // them) rather than leaving it empty. Then return it as a duplicate.
      const refreshed = await backfillEmptyRecipe(env, user.userId, dupe.id, recipe);
      return json({ recipe: refreshed, duplicate: true }, 200);
    }

    if (existingEmpty && recipe.sourceUrl) {
      // Failed-import retry where the re-save is also empty: give enrichment
      // another shot on the EXISTING id (preserves today's after-60s retry path).
      ctx.waitUntil(
        enrichAfterSave(env, user.userId, dupe.id, recipe.sourceUrl, recipe.title)
          .catch(err => console.error('[enrichAfterSave] failed', { recipeId: dupe.id, err: String(err) }))
      );
      return json({ recipe: existing, duplicate: true }, 200);
    }

    // Existing row already has content -> pure dedup, no write.
    return json({ recipe: existing, duplicate: true }, 200);
  }
}
```

Notes:
- `DEDUP_WINDOW_MS` and the `created_at >= ?` bound are removed.
- The lookup is the same single indexed read as today, minus the time bound. No new
  external calls, no new latency, no `fetchOgImage`-style slow path.
- `backfillEmptyRecipe` is a small new helper: `UPDATE recipes SET ingredients=?,
  steps=?, title=COALESCE(NULLIF(title,''), ?), image_url=COALESCE(NULLIF(image_url,''), ?),
  updated_at=? WHERE id=? AND user_id=?`, only filling fields the old row lacks, then
  returns `loadRecipe(...)`. It does not overwrite a non-empty title/image.
- Fresh-save path (no match) is unchanged: insert + existing `enrichAfterSave` kickoff,
  now also returns `duplicate: false`.

### Existing 9 duplicate rows

Out of scope for this change. Cleaning historical duplicates means deleting rows
(destructive) and is a separate, optional follow-up. This change stops new duplicates
and heals empty rows on the next save attempt; it does not retroactively merge the 9.
Flagged here so it is a conscious decision, not silent truncation.

### Frontend (`apps/recipe-ui/src/App.jsx`)

Three save paths read `response.recipe` today; each also gets the `duplicate` flag.
When `duplicate === true`, show an info toast instead of the success toast. All three
already merge the returned recipe into `recipes` by id, so the existing recipe surfaces
(fixes "the duplicate doesn't show up").

- `handleSavePublicRecipe` (~2570): branch the `setSnackbarState` message/severity on
  the flag.
- `handleSaveSharedRecipe` (~4674): same; it currently shows no toast on success, so
  add the duplicate toast only.
- `handleAddRecipeSubmit` (~5143): `resetFormState(message)` hardcodes
  `severity: 'success'`. Add an optional severity arg (default 'success') and pass
  'info' + the duplicate message when the flag is set. The background-enrich block is
  unchanged.

Copy (no em dashes): **"Recipe already in your collection"**, severity `info`.

### Native iOS Share Extension (`apps/ios/.../ShareFormView.swift`)

`WorkerClient.createRecipe` already returns `statusCode`. A duplicate is HTTP 200 (fresh
is 201). When `result.statusCode == 200`, show **"Already in your collection"** instead
of "Recipe saved!". (Optionally also branch on a decoded `duplicate` flag for clarity,
but statusCode is sufficient and already captured.)

## Response contract

`POST /recipes` response body gains `duplicate: boolean`. Fresh save: `false` (HTTP 201).
Duplicate: `true` (HTTP 200). Existing fields unchanged; clients that ignore the flag keep
working.

## Smoke test before shipping (protect-import-flow rule)

`handleCreateRecipe` is the import save entry point, so before deploying the worker:

1. Parse a real reel via `/recipes/parse` (or the auto-enrich path) and confirm
   ingredients/steps come back.
2. Save it fresh, confirm 201 + enrichment populates the row.
3. Re-save the same URL, confirm 200 + `duplicate: true` + no second row.
4. Re-save an intentionally-empty import, confirm it re-triggers enrichment on the
   existing id rather than dead-ending.

## Tests (worker unit)

Add to the create-recipe / dedup tests:
- duplicate with content existing -> 200, `duplicate: true`, no insert.
- duplicate where existing is empty and incoming has content -> backfill, 200,
  `duplicate: true`, ingredients/steps present.
- duplicate where existing is empty and incoming is empty -> re-enrich kicked on
  existing id, 200, `duplicate: true`.
- no match -> 201, `duplicate: false`, insert happens.

## Non-goals / known limits

- **Exact-URL match only.** Saves whose `source_url` differs only by tracking params
  (e.g. `?igsh=...`) will not match. URL normalization is deliberately out of scope to
  limit risk; can be a follow-up if real dups slip through.
- No retroactive merge of the 9 existing duplicate rows (see above).
