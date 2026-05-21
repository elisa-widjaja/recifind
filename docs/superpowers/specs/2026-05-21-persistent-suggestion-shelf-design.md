# Persistent "Recipes you might like" Shelf — Design

**Date:** 2026-05-21
**Status:** Design complete, awaiting implementation plan

## Summary

Today the "Recipes you might like" shelf (editor's picks) renders only as the empty state when a user has zero recipes — it vanishes the moment they save their first recipe. This change keeps the shelf alive through the new-user window so discovery continues past the first save, and lets users clear cards one at a time (via an X or by saving) until they graduate.

Frontend-only change. No worker, no schema, no Gemini, no recipe-import code touched.

## Visibility logic

The shelf renders on the Recipes page when **all** of these hold:

1. The user has **fewer than 5 saved recipes** (`totalRecipes < 5`).
2. There is **at least one un-dismissed suggestion** in the current editor's-picks set.
3. The user is **not** actively searching or filtering — no ingredient search text, and no active meal-type / cuisine / tag / favorites filter.

Placement: **below** the user's own recipe list.
- 0 recipes → their list is empty, so the shelf is effectively the whole page (today's empty-state behavior, plus X buttons).
- 1–4 recipes → their collection renders first, then the shelf below it with a divider/spacing so it reads as a distinct section.
- 5+ recipes → no shelf (graduated).

If a user's recipe count later drops below 5 (deletions), the shelf reappears — acceptable edge case, not specially handled.

## Dismissal mechanics

A single localStorage-backed dismissal set drives card removal, avoiding any fuzzy matching between a suggestion and the owned copy created when it's saved.

- **localStorage key:** `recifriend-dismissed-suggestions` — a JSON array of **editor's-pick recipe ids** the user has cleared.
- The shelf renders editor's-pick recipes whose id is **not** in the dismissed set.

**Three dismissal triggers**, each adding the pick's id to the set:

1. **X button** on the card.
2. **Save** via the card's inline save button (performs the normal save AND records the dismissal).
3. **Save from the recipe-detail view** when the opened recipe is a suggestion — i.e. the user taps a suggestion card, the detail dialog opens, and they save there. The opened suggestion's editor's-pick id is carried into the detail-view save handler so this records the same dismissal.

Rationale for id-based dismissal rather than matching saved recipes by sourceUrl/title: saving a suggestion creates a new owned recipe row with a *different* id, so the owned copy can't be cheaply matched back to the original pick. Recording the original pick's id at the moment of save (or X) is exact.

**Weekly rotation:** next week's editor's picks carry new ids, absent from the dismissed set, so they appear fresh. Old dismissed ids linger harmlessly in localStorage (small strings; not pruned).

## UI

- **Shelf header:** "Recipes you might like" — same copy and styling as today. At 1–4 recipes it sits below the user's collection with top spacing/divider marking it as a distinct section.
- **X button:** small circular button pinned to the top-right corner of each suggestion card. Translucent dark backdrop (`rgba(0,0,0,0.5)`) with a white `CloseIcon` (~24px button, ~16-18px icon) so it's legible over both photo thumbnails and gradient placeholders. `onClick` calls `stopPropagation` so dismissing doesn't also open the recipe detail.
- The existing inline save button (bookmark/heart) stays; it now also records a dismissal on save.
- **Optimistic removal:** the card disappears from the shelf the instant X or Save is tapped — the localStorage write is synchronous, and the rendered list filters on the in-memory dismissed set which updates immediately via React state.

## Data flow

- Editor's picks come from the existing `GET /public/editors-pick` fetch already in `RecipesPage.jsx` (currently gated behind `totalRecipes === 0`; the gate changes to `totalRecipes < 5`).
- The dismissed set is held in React state (initialized from localStorage on mount) so the UI updates immediately and persists across reloads.
- Saving a suggestion uses the existing `onSaveSuggestion` path; we layer the dismissal-recording on top.

## Components / files touched

- `apps/recipe-ui/src/RecipesPage.jsx`
  - Change the editor's-picks fetch gate from `totalRecipes === 0` to `totalRecipes < 5`.
  - Add dismissed-set state (init from localStorage `recifriend-dismissed-suggestions`).
  - Filter the rendered suggestions by the dismissed set.
  - Render the shelf below the user's recipe list (not only as empty state), hidden during active search/filter.
  - Add the corner X button to suggestion cards (likely a prop/variant on the existing suggestion card render).
  - Record dismissal on X and on inline save.
- `apps/recipe-ui/src/App.jsx`
  - Carry the opened suggestion's id into the recipe-detail save handler so a save-from-detail of a suggestion records the dismissal.
  - Pass any needed props (e.g. active search/filter state, a dismissal callback) into `RecipesPage` if not already available there.
- `apps/recipe-ui/src/components/RecipeListCard.jsx` — add an optional `onDismiss` prop. When provided, render a small top-right corner X (translucent dark circle + white CloseIcon) that calls `onDismiss` with `stopPropagation`. When absent (the default for the user's own recipes and all other usages), nothing changes. `RecipesPage.renderRecipeCard` passes `onDismiss` only for the suggestion variant (`isSuggestion === true`).

A small localStorage helper (get/add dismissed id) lives inline in `RecipesPage.jsx`; keep it tiny.

## Edge cases

| Case | Behavior |
|---|---|
| 0 recipes | Shelf is the page (their list empty), now with X buttons on cards. |
| All suggestions dismissed, still < 5 saved | Shelf hidden until next weekly editor's-picks rotation brings new ids. |
| Logged-out guest | Shelf shows (public editor's picks); X works via localStorage; Save prompts auth as today. |
| Active search/filter | Shelf hidden; reappears when cleared. |
| `/public/editors-pick` fetch fails | Shelf doesn't render (no error UI), as today. |
| Recipe count drops below 5 via deletions | Shelf reappears (un-dismissed picks only). |
| Save from detail view of a non-suggestion recipe | No dismissal recorded (only suggestions carry the pick id). |

## Out of scope (v1)

- Server-side / cross-device dismissal sync.
- "Undo dismiss" affordance.
- Pruning old dismissed ids from localStorage.
- Re-fetching fresh suggestions mid-session when the shelf empties (waits for next load / next week's rotation).
- Any change to how editor's picks are curated or rotated.

## Testing

Frontend-only; manual on dev tunnel + Xcode:
- New account / 0 recipes → shelf shows with X on each card.
- Dismiss a card via X → it disappears, stays gone after reload.
- Save a card via inline save → it disappears from shelf and lands in collection.
- Open a suggestion → save from detail view → it disappears from shelf.
- Save/dismiss until 5 saved recipes → shelf hides (graduated).
- Dismiss all 7 cards while < 5 saved → shelf hidden (no cards left).
- Type an ingredient search / apply a filter → shelf hides; clear → shelf returns.
- Logged-out guest → shelf shows; X works; Save prompts auth.

No automated test file required (the existing UI test surface doesn't cover `RecipesPage` suggestion rendering), but run the full UI suite to confirm no regressions.

## Decisions confirmed

- Visibility: `< 5 saved recipes` AND ≥1 un-dismissed suggestion AND not searching/filtering.
- Placement: below the user's own recipes.
- Dismissal persistence: **localStorage** (per-device), id-based set.
- Dismissal triggers: X, inline save, and save-from-detail of a suggestion.
- Hide during active search/filter: yes.
- Frontend-only — no worker / schema / Gemini / import-flow changes.
