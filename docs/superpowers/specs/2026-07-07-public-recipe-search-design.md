# Public Recipe Search — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation planning

## Summary

Add a search bar to the Discover tab that lets anyone search all public recipes
in D1. Matching spans title, ingredients, and tags, with title matches ranked
first. Results replace the discovery shelves while a query is active. The feature
is contained in one new public worker endpoint plus changes to a single frontend
component.

## Context

- Public recipes live in D1 `recipes`, gated on `shared_with_friends = 1 AND
  hidden_at IS NULL`. Current count: 1,314 total rows, 1,112 public.
- Existing public feed endpoints (`/public/discover`, `/public/trending-recipes`,
  `/public/editors-pick`) share `DISCOVER_SELECT`, `mapDiscoverRow`, and the
  quality-filter helpers `isCleanDiscoveryRow` / `isBrokenDiscoverRow` in
  `apps/worker/src/index.ts`.
- The Discover tab renders `apps/recipe-ui/src/components/DiscoverPage.jsx`, which
  fetches each feed on mount and renders shelves of `RecipeListCard` /
  `RecipeShelf`.

## Cost analysis

A search is a leading-wildcard `LIKE`, which forces a full table scan regardless
of how many columns it matches — D1 bills by rows read, so matching title +
ingredients + tags costs the same ~1,314-row scan as title alone. Against the
free-tier limit of 5M rows read/day that is ~3,800 searches/day before
approaching the cap. No index or migration is needed. Ingredient matching adds
CPU per query (JSON blob per row), not billing.

## Decisions

- **Match fields:** title + ingredients + tags (`custom_tags`, `meal_types`),
  title matches ranked first.
- **Recipe set (middle ground):** any public recipe that passes
  `isBrokenDiscoverRow` — has an image and a non-broken/non-generic title. Does
  NOT require clean noun-phrase titles or structured ingredients/steps. Maximizes
  recall while guaranteeing no imageless broken cards.
- **Trigger:** live / as-you-type, debounced ~300ms.
- **Display:** results replace the shelves while a query is active; clearing the
  box restores the shelves.

## Backend — `GET /public/search?q=<term>`

New public handler in `apps/worker/src/index.ts`, alongside the other `/public/*`
routes. Returns `{ recipes: DiscoverRecipe[] }` using `DISCOVER_SELECT` columns
and `mapDiscoverRow`, so the frontend consumes results exactly like the shelf
feeds.

Query logic:

1. Sanitize `q`: trim, cap length (~60 chars), escape LIKE wildcards (`%`, `_`,
   `\`) and use an `ESCAPE '\'` clause so input like `50%` does not blow up the
   match.
2. Guard: if `q` is under 2 chars after trim, return `{ recipes: [] }` without
   touching D1.
3. One SQL query gated on `shared_with_friends = 1 AND hidden_at IS NULL`,
   matching `title OR ingredients OR custom_tags OR meal_types` with
   `LIKE '%term%' ESCAPE '\'`. SQLite `LIKE` is case-insensitive for ASCII.
4. Rank in SQL: `CASE WHEN title LIKE ? THEN 0 ELSE 1 END AS rank`, then
   `ORDER BY rank, created_at DESC`. Title hits sort above ingredient-only hits;
   ties break by newest.
5. `LIMIT 60` from SQL, then apply `isBrokenDiscoverRow` filter in JS, then slice
   to the top 30 for the response.

Cost: one ~1,314-row scan, single-digit ms.

## Frontend — `apps/recipe-ui/src/components/DiscoverPage.jsx`

Fully contained in this component (plus the file's existing `fetchJson`). No
`App.jsx` changes.

**Search bar:** MUI `TextField` pinned at the top of `DiscoverPage`, above the
shelves. Search-icon `InputAdornment`, a clear (✕) button that appears once there
is text, placeholder "Search recipes". Matches the existing MUI theme (rounded,
card surface color).

**State + fetching:**
- New state: `query` (raw input), `results`, `searching` (in-flight), `searched`
  (whether a query has run, to distinguish empty state from no-results).
- Debounced effect (~300ms) on `query`. Under 2 chars → clear results, do not
  fetch. Otherwise `GET /public/search?q=...`.
- Cancellation: track the latest request (ref / `AbortController`) so a slow
  response for "chick" cannot overwrite results for "chicken". Reuses the
  `cancelled` pattern already in this file's effects.

**Display (replace shelves while active):**
- `const isSearching = query.trim().length >= 2;`
- When `isSearching`, hide the Trending / Community / Editor's / AI shelves and
  render a single vertical results region instead. Clearing restores the shelves
  exactly as before.
- Results render as a vertical `Stack` of the existing `RecipeListCard`, so tap-
  to-open, save, and share behave identically.
- Region states:
  - Loading: reuse the existing `ListSkeleton` in this file.
  - Results: the list.
  - No results: centered "No recipes found for "<term>"" message (plain copy, no
    em dash).

**Wiring:** reuse `DiscoverPage`'s existing props — `onOpenRecipe`,
`onSaveRecipe`, `onShareRecipe`, `accessToken` — passed into each
`RecipeListCard`. Zero new plumbing in `App.jsx`.

## Error handling

**Backend:**
- Handler uses `return await handler()` inside the async try/catch so any D1
  failure surfaces as JSON with CORS headers (never a bare 1101).
- Bad/empty input is handled gracefully, not as an error: missing `q`,
  whitespace-only, or under 2 chars → `200 { recipes: [] }`.
- Per-row `JSON.parse` in the map step is wrapped so one malformed
  `ingredients` / `meal_types` row is skipped rather than 500-ing the whole
  search.

**Frontend:**
- `fetchJson` already returns `null` on a non-ok response. On `null` or a thrown
  fetch (offline), set results to empty and show the no-results state; `searching`
  always clears in a `finally`.
- The stale-response guard doubles as the correctness protection so results never
  show the wrong query's data.
- Clearing the box mid-flight cancels and restores shelves cleanly.

## Testing

**Worker (vitest, `apps/worker`):**
- Match on title, on ingredient, on tag — and title match ranks above
  ingredient-only match.
- `shared_with_friends = 0` and `hidden_at` rows are excluded.
- Broken rows (no image) are filtered out (middle-ground bar).
- Wildcard input (`50%`, `_`) is escaped and returns sane results, not a match
  explosion.
- Under-2-char and empty `q` return `[]` without a DB hit.
- Respects the 30-result cap.

**Manual smoke (post-deploy):** load the Discover tab, type a known term, confirm
results replace shelves, tap a result opens it, save works, clearing restores
shelves. Confirm the existing `/public/*` feeds are untouched.

No e2e additions unless requested.

## Out of scope

- FTS5 full-text index (only worth it if ingredient search becomes a scale
  problem; LIKE is fine at ~1,300 rows).
- Search history, autocomplete/suggestions, filters (cuisine/diet/time facets).
- Searching private or friends-only recipes.
