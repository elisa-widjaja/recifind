# Duplicate-save "View" action (design) — option A

Date: 2026-06-04
Status: spec for review (not yet implemented)
Follows: `docs/superpowers/specs/2026-06-04-duplicate-save-notify-design.md` (duplicate detection + toast, shipped to dev worker)

## Problem

Duplicate detection now prevents a second row and shows "Recipe already in your
collection". But on a duplicate save the existing recipe keeps its ORIGINAL
`created_at`, and the collection list is ordered `created_at DESC`
(`index.ts:1274`). So:

- Within 60s, the recipe appears at the top only because the web handler
  optimistically prepends it to the in-memory `recipes` array. Session-only.
- On a real reload, or via the Share Extension (which never touches React
  state), the list re-fetches by `created_at` and the deduped recipe sorts back
  to its old position, often out of viewport. The user re-saved (a clear "I want
  this now" signal), is told they already have it, lands on the list, and cannot
  see it.

The toast is a dead-end: it answers "you have it" but not "where is it".

## Goal

Give the user an immediate, timing-independent way to see the existing recipe on
a duplicate save, without changing list ordering or `created_at` semantics (that
would be option B — explicitly out of scope).

## Approach A: actionable feedback that opens the recipe

On a duplicate, the feedback gains a way to open that recipe's detail view
directly, so position in the list stops mattering.

This splits into two independently shippable parts:

- **Part 1 (web)** — ships with the next Pages deploy.
- **Part 2 (native Share Extension)** — ships with the next TestFlight/App Store
  build (28+). Lower-certainty (iOS extension API), so it is separable; Part 1
  stands on its own.

---

## Part 1 — Web: "View" action on the duplicate toast

### Snackbar gains an optional action

`snackbarState` (`App.jsx:1706`) gets an optional `action` field:
`{ label: string, onClick: () => void }`.

Render (`App.jsx:7777` `<Alert>`): add an `action` prop:

```jsx
action={
  snackbarState.action
    ? (
      <Button
        color="inherit"
        size="small"
        onClick={() => { snackbarState.action.onClick(); handleSnackbarClose(); }}
      >
        {snackbarState.action.label}
      </Button>
    )
    : undefined
}
```

Notes:
- MUI `<Alert>` replaces its default close (X) with the `action` node when
  `action` is set. That is acceptable: the Snackbar still auto-hides and
  dismisses on clickaway via `handleSnackbarClose`. Only the duplicate toast sets
  `action`; every other toast keeps its X unchanged.
- `Button` must already be imported in `App.jsx` (verify; it is used widely).
- Because the toast now needs a tap, give duplicate toasts a longer duration so
  "View" is reachable: set `duration: 6000` on the duplicate toasts (currently
  2000 for public/shared). 6s matches the existing friend-connect read time.

### The three save handlers set the action

Each duplicate branch already has the saved recipe object. Add the action:

- `handleSavePublicRecipe` (~`App.jsx:2597`): duplicate branch becomes
  ```jsx
  { open: true, message: 'Recipe already in your collection', severity: 'info',
    duration: 6000, action: { label: 'View', onClick: () => handleOpenRecipeDetails(saved) } }
  ```
- `handleSaveSharedRecipe` (~`App.jsx:4715`): the `if (duplicate)` toast gains
  `duration: 6000, action: { label: 'View', onClick: () => handleOpenRecipeDetails(savedRecipe) }`.
- `handleAddRecipeSubmit` / `resetFormState` (~`App.jsx:5220`, `:5317`): the
  duplicate path calls `resetFormState('Recipe already in your collection', 'info')`,
  which navigates to the recipes list. Extend `resetFormState` to accept an
  optional `action` (third param, default undefined) and pass it into
  `setSnackbarState`. The duplicate call passes
  `{ label: 'View', onClick: () => handleOpenRecipeDetails(savedRecipe) }` and a
  6000ms duration. The non-duplicate `Saved`/`Added` calls pass nothing
  (unchanged).

`handleOpenRecipeDetails(recipe)` (`App.jsx:3788`) accepts a full recipe object
and sets `activeRecipe`/`activeRecipeDraft`; the saved/savedRecipe objects from
the API are full normalized recipes, so no extra fetch is needed.

### Consistency

Because all three paths set the same actionable toast on `duplicate === true`,
the experience is identical for the within-60s case and the days-later case. The
incidental "prepended to the in-memory list" behavior is now backed by an
explicit, reliable "View".

### Out of scope (Part 1)

- No change to list ordering, `created_at`, or `updated_at` for sorting.
- No auto-navigation. Tapping "View" is deliberate; auto-opening the detail would
  be disruptive in a browse context (discover feed) where the user may want to
  keep scrolling. Considered and rejected.

---

## Part 2 — Native Share Extension: "Open in ReciFriend"

When a share-extension save returns HTTP 200 (duplicate), the saved-state view
already shows "Already in your collection". Add an action that opens the recipe
in the app.

### Mechanism

- `WorkerClient.createRecipe` already returns `CreateRecipeResult(recipeId,
  statusCode)`. The worker response JSON is `{ recipe: { id, userId, ... },
  duplicate }`. Extend the response parse to also capture `recipe.userId` into
  `CreateRecipeResult` (new `ownerId: String?`), so the deep link can include
  `?user=` for a reliable owner-aware resolve.
- On the duplicate saved state, render a button "Open in ReciFriend" (exact
  copy, no em dash). On tap:
  ```swift
  if let url = URL(string: "recifriend://recipes/\(recipeId)?user=\(ownerId)") {
      extensionContext?.open(url) { _ in
          self.extensionContext?.completeRequest(returningItems: nil)
      }
  }
  ```
  Use the same `recifriend://recipes/{id}?user={owner}` form that
  `buildRecipeAppDeepLink` produces and the build-20+ deep-link parser resolves
  to the recipe DETAIL view.

### Verification required before relying on it (feasibility gate)

1. Confirm `NSExtensionContext.open(_:completionHandler:)` actually launches the
   containing app via the registered `recifriend://` scheme from a Share
   Extension on a current iOS build. (This is the standard documented path for an
   extension to open its host app, but behavior has historically varied; verify
   on-device.)
2. Confirm the app's deep-link parser, when opened via
   `recifriend://recipes/{id}?user={ownerId}` for the user's OWN recipe,
   navigates to that recipe's detail (the existing flow is exercised for shared
   links; confirm it also resolves an own-collection recipe).

### Graceful fallback

If `open` returns failure (or Part 2 is deferred), the existing "Already in your
collection" text remains — already an improvement over the old "Recipe saved!".
The button simply would not appear or would no-op to dismiss. No regression.

### Ships separately

Part 2 rides the next TestFlight/App Store build (MARKETING_VERSION 1.0.8+,
CFBundleVersion 28+ per project memory), not the web deploy. Part 1 ships first
and independently.

---

## Test plan

Web (no JS unit harness; manual against dev worker / dev frontend already
running):
1. Save a public/discover card you already have → toast "Recipe already in your
   collection" with a "View" button; tapping View opens the recipe detail.
2. Save a shared recipe you already have → same.
3. Add-form: paste a URL already in your collection → navigates to recipes list +
   actionable toast; View opens detail.
4. Confirm a FRESH save still shows the success toast with NO action button and
   normal duration.
5. Confirm the toast's "View" is reachable (6s) and that non-duplicate toasts
   still show their close X unchanged.

Native (Part 2, on-device, next build):
6. Share a reel already in your collection → "Already in your collection" +
   "Open in ReciFriend"; tap opens the recipe detail in the app.
7. Feasibility gate (above) passes; if not, fall back to text-only.

## Non-goals

- Option B (recency bump / resurfacing re-saved recipes to the top via a
  separate `last_saved_at`) is explicitly deferred; it is a product decision that
  touches the friend/discovery feeds and deserves its own brainstorm.
