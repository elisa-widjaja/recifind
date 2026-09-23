# Picked for you: save-based recipe recommendations

**Date:** 2026-09-22
**Status:** Approved in conversation, awaiting spec review

## Goal

Help users who already have a saving habit discover recipes they are likely
to save, driven by their own taste rather than editorial curation. Success
is a user saving a recipe from the new shelf.

## Scope

- A new shelf, "Picked for you", on the Discover page directly above
  Editor's Picks. Editor's Picks stays and moves down one slot.
- Signed-in users with **5 or more** non-hidden saved recipes. Everyone else
  sees Discover exactly as today.
- Web (Cloudflare Pages) now. The iOS app bundles the frontend, so the
  shelf reaches the App Store with the next build (1.1.5 / 39+). Worker
  changes land immediately for both.

### Why 5

Prod distribution on 2026-09-22 (78 users with at least one recipe):
16 have 1, 9 have 2, 11 have 3 to 4, 8 have 5 to 9, 9 have 10 to 19,
13 have 20 to 49, 12 have 50+. Five covers 54% of users. Metadata coverage
is thin (ingredients 75%, meal types 43%, cuisines 13%, custom tags 2%), so
at 3 saves the profile is often two usable recipes and picks feel random.
Five also matches the existing "fewer than 5 recipes" empty-state boundary
on the recipes page, so one rule applies across the app.

## Non-goals

- Collaborative filtering ("people who saved this also saved"). Only 111
  source URLs are saved by more than one user today. Revisit when overlap
  grows.
- Gemini-ranked picks. Cost per user and no explainability.
- Per-card reasons. One reason line per shelf.
- Cache invalidation on unsave or hide. See Freshness.

## Architecture

Three units, each testable alone:

1. **`recommend.ts` (worker, pure):** taste profile + scoring + reason.
   No I/O. Exported for vitest.
2. **Route + cache (worker, `index.ts`):** `GET /recipes/picked-for-you`,
   KV-cached per user, invalidated on save.
3. **Shelf (frontend, `DiscoverPage.jsx`):** fetch when signed in, render
   above Editor's Picks.

## 1. Scoring

### Inputs

- **User saves:** `SELECT source_url, cuisines, meal_types, ingredients,
  creator, is_food FROM recipes WHERE user_id = ? AND hidden_at IS NULL`.
  The 5-save threshold counts all of these; profile building skips rows
  with `is_food = 0` (see Non-recipe filter).
- **Candidate pool:** `SELECT id, user_id, title, source_url, image_url,
  meal_types, custom_tags, duration_minutes, ingredients, steps, cuisines,
  creator, created_at FROM recipes WHERE user_id != ? AND
  shared_with_friends = 1 AND hidden_at IS NULL AND (is_food IS NULL OR
  is_food = 1) AND (provenance IS NULL OR provenance != 'title-only')`.
  About 1,000 rows today; the non-recipe filter below cuts it to roughly
  550.

### Non-recipe filter

Users save links that are not recipes (workout reels, travel clips,
memes). Only 234 rows carry a Gemini `is_food` verdict, so the filter is
layered and every layer must pass:

1. `is_food` is not 0 (Gemini said "not food"). SQL.
2. `provenance` is not `title-only`. Those rows were saved when Gemini
   never saw the content, so nothing verified they are recipes. SQL.
3. `isRecommendableRow(row)` in JS: the existing `isCleanDiscoveryTitle`
   check, a non-empty `image_url`, **at least 3 ingredients and at least
   2 steps**. A non-recipe that slipped past Gemini almost never has a
   structured ingredient list and method. This is stricter than
   `isCleanDiscoveryRow`, which accepts one of each.

Measured on prod 2026-09-22: 1,299 shared rows from other users, 277
title-only, 306 with zero ingredients, 547 pass all layers.

The same rule applies on the profile side: the user's own saves with
`is_food = 0` are skipped when building the taste profile, so a saved
workout video contributes nothing. Title-only saves still contribute
their cuisines and creator (those fields are filled from the title), but
have no ingredients to add.

### Taste profile

Built from the user's saves:

- `cuisines`: count per lowercase cuisine key.
- `mealTypes`: count per lowercase meal type.
- `creators`: count per creator string (exact, trimmed). Null skipped.
- `keywords`: count per ingredient keyword, top 30 kept.

Ingredient keyword normalization (`ingredientKeywords(line)`):

- Lowercase, strip anything in parentheses, strip leading quantities and
  units (numbers, fractions, `tbsp`, `tsp`, `cup(s)`, `g`, `kg`, `ml`,
  `oz`, `lb`, `clove(s)`, `pinch`, `to taste`, and similar).
- Split on non-letters, drop tokens under 3 characters.
- Drop a pantry stoplist: salt, pepper, oil, olive, water, sugar, butter,
  flour, garlic, onion, egg, eggs, milk, black, white, fresh, ground,
  chopped, minced, sliced, diced, large, small, medium, optional, taste,
  cup, cups, and the unit words above. (Stoplist lives in `recommend.ts`
  so tests pin it.)
- What survives is a set per ingredient line; a recipe's keyword set is
  the union across its lines.

### Score per candidate

```
score = 4 * creatorMatch
      + 3 * sum(profile.cuisines[c] for c in candidate.cuisines)
      + 1 * min(6, sum(profile.keywords[k] for k in candidate.keywords))
      + 1 * sum(profile.mealTypes[m] for m in candidate.mealTypes)
```

- `creatorMatch` is 1 if the candidate's creator is in the profile, else 0.
- Cuisine and meal-type sums use the profile counts, so a user with 8
  Japanese saves weighs Japanese more than a user with 1.
- Keyword overlap is capped at 6 so long ingredient lists cannot dominate.
- Candidates with score 0 are dropped. If fewer than 3 candidates score
  above 0, return an empty result (the shelf hides rather than showing
  filler).

### Exclusions, before scoring

- Any candidate whose `normalizeSourceUrlForDedup(source_url)` matches one
  of the user's saves.
- This week's Editor's Picks ids (call `getEditorsPick` and exclude), so a
  recipe never appears twice on the page.
- Duplicate copies of one normalized source URL collapse to the copy with
  the highest score (ties: newest).

### Ordering

Sort by score descending. Ties break on `fnv1a32(`${dayIndex}:${id}`)`
where `dayIndex = floor(now / 86400000)`, so equal-score items rotate daily
and the result is deterministic for a given day (testable). Take the top
**7**, the same count as Editor's Picks so the two shelves look alike.

### Reason line

Pick the strongest signal, in this order:

1. Cuisines with 2+ saves: "Based on your Japanese and Korean saves"
   (top 2, display-cased, joined with "and"; single: "Based on your
   Japanese saves").
2. A creator with 2+ saves: "Because you save recipes from {creator}".
3. Top keyword with 3+ saves: "Because you save a lot of chicken recipes".
4. Fallback: "Based on what you've saved".

No em dashes in any copy.

### Threshold

Fewer than 5 non-hidden saves returns `{ eligible: false, recipes: [],
reason: null }` without querying the pool.

## 2. Endpoint and cache

### Route

`GET /recipes/picked-for-you`, requires auth (401 without). Handler follows
the `return await (async () => { ... })()` rule.

Response:

```json
{ "eligible": true, "reason": "Based on your Japanese saves",
  "recipes": [ /* same shape as /public/editors-pick items */ ] }
```

Recipe item shape matches `getEditorsPick` exactly (`id, userId, title,
sourceUrl, imageUrl, mealTypes, customTags, durationMinutes, ingredients,
steps`) so `RecipeListCard` and the existing open/save/share handlers work
unchanged.

### Removal

The unused `GET /recipes/for-you` route and `getRecipesForUser` are
deleted. The UI never called them, and two recommendation paths would
drift. `getRecommendedRecipes` (nudge emails) is untouched.

### Cache

- Namespace: existing `AI_PICKS_CACHE` KV binding.
- Key: `picked:v1:{userId}`. Bump `v1` when scoring changes.
- Value: the full response JSON plus `computedAt`.
- `expirationTtl: 86400` (24 hours).
- Read before computing; on miss, compute, `put`, return.
- Ineligible results are cached too (short-circuits the saves count query
  on repeat visits), and the save invalidation below clears them once the
  user crosses the threshold.

### Invalidation

In `handleCreateRecipe`, after a successful `INSERT INTO recipes` (not on
the dedup early-return), `ctx.waitUntil(env.AI_PICKS_CACHE.delete(key))`.
Failure to delete is logged and swallowed; the entry expires anyway.

### Freshness

Recomputed at most once per day per user and immediately after a save.
Unsave and hide do not invalidate; a user who drops below 5 keeps the
shelf until the entry expires. Accepted.

## 3. Frontend

`apps/recipe-ui/src/components/DiscoverPage.jsx`:

- New props: `savedCount` (number, from App: `recipes.length`).
- New state: `picked`, `pickedReason`, `pickedLoaded`.
- On mount, when `accessToken` is present, `fetchJson('/recipes/picked-for-you', accessToken)`.
  Signed out: `pickedLoaded = true`, empty.
- Render, placed between "From the Community" and Editor's Picks:

```
{accessToken && (!pickedLoaded ? savedCount >= 5 : picked.length > 0) && (
  <Box>
    <SectionLabel>Picked for you</SectionLabel>
    {pickedLoaded && pickedReason && <Typography variant="body2" color="text.secondary">{pickedReason}</Typography>}
    {pickedLoaded ? <Stack spacing={1}>{picked.map(... RecipeListCard ...)}</Stack> : <ListSkeleton count={7} />}
  </Box>
)}
```

  The skeleton shows only when the user is known to be at or above the
  threshold, so users under 5 never see a shelf flash and collapse.
- `App.jsx`: pass `savedCount={recipes.length}` to `DiscoverPage`.
- Search mode still replaces the whole stack; no change.
- Pull-to-refresh already remounts `DiscoverPage`, which refetches (KV hit).

## 4. Error handling

- Worker: any thrown error in the route propagates through the existing
  try/catch to a JSON error with CORS headers. KV failures on read fall
  through to compute; KV failures on write are swallowed.
- Frontend: `fetchJson` returns null on non-2xx, which becomes an empty
  shelf. No error UI.

## 5. Testing

Worker (`apps/worker/src/recommend.test.ts`, vitest):

- `ingredientKeywords`: strips quantities and units, drops stoplist,
  keeps "chicken", "gochujang", "thighs".
- `buildProfile`: counts cuisines, meal types, creators, keywords; top-30
  cap.
- `scoreCandidates`: creator beats cuisine beats keywords; keyword cap at
  6; zero-score dropped; fewer than 3 positives returns empty.
- Exclusions: own source URL (with tracking params), Editor's Picks ids,
  duplicate URLs collapse.
- Non-recipe filter: `isRecommendableRow` rejects `is_food = 0`, 2
  ingredients, 1 step, missing image, caption-style title; accepts a row
  with 3 ingredients and 2 steps. Profile skips `is_food = 0` saves.
- Result size: never more than 7.
- Determinism: same day same order; different day different tie order.
- `reasonFor`: each branch and the fallback.
- Threshold: 4 saves ineligible, 5 eligible.

Worker route test (pattern from `friends-suggestions.test.ts`, mocked D1
and KV): cache hit skips D1; miss computes and puts; save handler deletes
the key.

Frontend (`DiscoverPage.test.jsx`):

- Signed in with data: "Picked for you" renders before "Editor's Picks"
  in DOM order, reason line present.
- Signed out: no "Picked for you", no request to the route.
- Signed in, `savedCount` 3, loading: no skeleton for the shelf.

Manual before deploy:

- Deploy worker to dev (`npx wrangler deploy --env dev`), open
  dev.recifriend.com with the admin account (50+ saves) and a test account
  under 5.
- Run the recipe-import smoke test (parse + enrich) since the worker
  changes.
- `git status` before any deploy.

## 6. Free-tier quota

| Resource | Per recompute | Daily worst case today |
|---|---|---|
| D1 rows read | ~1,000 pool + user's saves + 7 picks | ~50 users x ~1,100 = ~55k of 5M |
| KV writes | 1 put; plus 1 delete per save | well under 1,000 |
| KV reads | 1 per Discover visit | well under 100k |

No new D1 index needed: the pool query is a full scan of shared rows,
same as the existing discovery queries, run once per user per day.

## Files touched

- `apps/worker/src/recommend.ts` (new), `apps/worker/src/recommend.test.ts` (new)
- `apps/worker/src/index.ts`: route, cache, invalidation, remove `for-you`
- `apps/recipe-ui/src/components/DiscoverPage.jsx`, `DiscoverPage.test.jsx`
- `apps/recipe-ui/src/App.jsx`: `savedCount` prop
