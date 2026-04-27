# iOS Share-Extension Add Recipe Drawer — Design

**Date:** 2026-04-22
**Scope:** Frontend (`apps/recipe-ui/src/App.jsx`). iOS-only. Web unchanged.

## Goal

When a user taps Share → ReciFriend on a reel (TikTok, Instagram, YouTube), they should land directly on a minimal Add Recipe drawer that shows the recipe as a square thumbnail + plain-text title, with one-tap save. No URL field, no title text field — the user taps Save.

## Non-goals

- Any change to the web experience (desktop or mobile web) — the existing drawer renders byte-for-byte unchanged.
- Any change to the iOS "+" FAB entry point — tapping "+" inside the iOS app still opens the current form with the URL field.
- Any change to the iOS Share Extension itself (`apps/ios/ios/App/ShareExtension/ShareViewController.swift`) — the existing `recifriend://add-recipe?url=...` deep link is sufficient.
- Any change to Gemini enrichment or the worker — the existing `/recipes/enrich` endpoint and `useEffect` auto-run logic stay as-is.

## Entry-point detection

A new piece of state, `addRecipeSource: 'share-extension' | 'manual' | null`, is set alongside the existing `isAddDialogOpen`:

- `onAddRecipe(url)` in the deep-link dispatcher ([App.jsx:1370](apps/recipe-ui/src/App.jsx#L1370)) sets it to `'share-extension'`.
- Every other call site (`openAddDialog()` from the "+" FAB and elsewhere) sets it to `'manual'`.
- `closeAddDialog()` resets it to `null`.

The drawer body branches:

```js
const useIosShareLayout = isMobile && addRecipeSource === 'share-extension';
```

Only when `useIosShareLayout` is true does the new layout render. All other combinations (web desktop Dialog, web mobile Drawer, iOS "+" FAB Drawer) render the existing form.

## Layout (new iOS share layout)

Drawer body, top to bottom:

1. **Drag handle** — unchanged (existing 36×4 pill).
2. **Header** — `Typography variant="h6" fontWeight={600}` "Add recipe". No URL field.
3. **Recipe preview row** — horizontal flex, `gap: 2` (16px), `alignItems: center`:
   - **Thumbnail (left):** 96×96px square, 8px border-radius, `object-fit: cover`. Sourced from `newRecipeForm.imageUrl`.
     - Loading → `<Skeleton variant="rectangular" width={96} height={96} />`
     - Missing (no `imageUrl` after parse) OR runtime load error (`<img onError>`) → neutral gray `Box` same dimensions, small recipe-icon glyph centered. A local `imageLoadFailed` boolean flips the render to the gray box if `onError` fires.
   - **Title + edit (right):** column, flex-grow, min-width 0 (for ellipsis):
     - Default: `Typography variant="subtitle1" fontWeight={600}` with 2-line clamp + ellipsis, then a small "Edit" link below (`Typography component="button" variant="caption"`, primary color, underline on hover, `type="button"`).
     - Loading → `<Skeleton variant="text" width="90%" />` + `<Skeleton variant="text" width="60%" />`, no Edit link.
     - Editing → compact `TextField` size="small" (see Edit-title interaction), no Edit link.
4. **"Make it public" checkbox** — unchanged from current drawer (`newRecipeForm.sharedWithFriends`).
5. **Actions** — unchanged layout: `Button type="submit" variant="contained"` "Save recipe" (disabled while title skeleton is showing — i.e., during `loading` state), then the Cancel text link.

All hidden fields (ingredients, steps, meal types, duration, imageUrl) still live in `newRecipeForm` and get submitted with Save. They are populated by the existing enrichment `useEffect`.

## Data flow & loading states

The existing enrichment `useEffect` at [App.jsx:3593](apps/recipe-ui/src/App.jsx#L3593) already does two-stage parsing (local og:/JSON-LD parse first, Gemini enrich second) and writes into `newRecipeForm`. No changes to that effect.

Four derived UI states drive the new layout:

| State | Condition | Thumbnail | Title | Save button |
|---|---|---|---|---|
| **loading** | `sourceParseState.status === 'loading'` AND no title yet | Skeleton | Skeleton + line | **Disabled** |
| **partial** | Title present, image still missing (rare) | Skeleton or gray placeholder | Plain text + Edit link | Enabled |
| **ready** | Title + image present | Image | Plain text + Edit link | Enabled |
| **error** | `sourceParseState.status === 'error'` AND no title | Gray placeholder | "Untitled recipe" + Edit link; small error caption: "Couldn't fetch recipe details. Edit title to save." | Enabled |

**On Save (`handleAddRecipeSubmit`):** no changes needed. The existing `pendingEnrichRef.current` already handles in-flight Gemini enrichment continuing after save — the recipe saves with whatever the form has, and a follow-up PATCH flushes enriched ingredients/steps when the promise resolves.

**On Cancel (`closeAddDialog`):** existing behavior, plus reset `addRecipeSource` to `null` so the next drawer open has to set it explicitly.

## Edit-title interaction

New local state: `isEditingTitle: boolean` (defaults to `false`).

**Default (not editing):**
- Title renders as plain `Typography`.
- An "Edit" link is below the title (as described in Layout).
- Tap "Edit" → `setIsEditingTitle(true)`.

**Editing:**
- Title area swaps to a compact `TextField size="small" autoFocus`, pre-filled with `newRecipeForm.title`.
- On focus, the input selects all text.
- `onChange` → `setNewRecipeForm((prev) => ({ ...prev, title: e.target.value }))` (same pattern as existing `handleNewRecipeChange`).
- `onBlur` OR pressing Enter → `setIsEditingTitle(false)`. Whitespace is trimmed. If empty, the title falls back to "Untitled recipe".
- Pressing Escape → revert to the title value at the start of editing, `setIsEditingTitle(false)`.
- The "Edit" link is hidden while editing.

The Edit link is only tappable in `ready`, `partial`, and `error` states — never during `loading` (there is no title yet to edit).

## State cleanup

When `closeAddDialog` runs (Save success, Cancel, or drawer dismissed via swipe-down):
- Reset `addRecipeSource` to `null`.
- Reset `isEditingTitle` to `false`.
- Existing `NEW_RECIPE_TEMPLATE` reset of `newRecipeForm` is unchanged.

## Accessibility

- The thumbnail `<img>` has `alt={newRecipeForm.title || 'Recipe thumbnail'}`.
- The "Edit" link is a `<button type="button">` with visible focus ring — not a `<span>`.
- The editing `TextField` has `aria-label="Recipe title"`.

## Testing

- **Unit (Vitest)**: Not practical — the logic lives in `App.jsx` alongside the existing drawer. Rely on existing smoke coverage.
- **Manual on device** (primary verification):
  1. Share a TikTok recipe → ReciFriend. Drawer opens with skeletons, resolves to thumbnail + title within ~2s. Save saves correctly.
  2. Tap "Edit" on the title → field appears → type a new title → tap outside → plain text updates.
  3. Share a URL that Gemini cannot parse (e.g., a non-recipe page) → drawer shows placeholder thumbnail + "Untitled recipe" with error caption. User edits title, taps Save, recipe saves.
  4. Tap "+" FAB inside iOS app → existing form with URL field appears (unchanged behavior).
  5. On web desktop and web mobile → Add Recipe still shows the existing form (unchanged).
- **Regression**: manually save 1 recipe from web mobile and 1 from iOS "+" FAB after the change to confirm no behavior change on those paths.

## Files changed

- `apps/recipe-ui/src/App.jsx` — all changes live here. New state (`addRecipeSource`, `isEditingTitle`), branched drawer body, new layout JSX, plumbing through `onAddRecipe` and `openAddDialog`.

No worker changes. No iOS Swift changes. No schema changes.
