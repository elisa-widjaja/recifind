# Stats Tiles — Design Spec
**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Add a two-tile stats banner at the top of the logged-in home feed. Tiles show recipe count and friend count with gradient styling, pill CTAs, and text-link secondaries. Designed to feel like a modern social app dashboard.

---

## Visual Design

Two equal-width tiles side by side, separated by a small gap (10px).

**Tile 1 — Recipes** (purple gradient)
- Background: `linear-gradient(135deg, #1e1b4b, #1a1a2e)`, border `1px solid #3730a3`, border-radius `14px`
- Label: `RECIPES` — `10px`, `font-weight 700`, `#818cf8`, `letter-spacing 0.8px`, `text-transform uppercase`
- Count: large bold number — `28px`, `font-weight 800`, `#fff`
- Subtext: `saved recipes` — `12px`, `#a5b4fc`
- Primary CTA (pill, filled `#6366f1`): `+ Add Recipe` — calls `onAddRecipe`
- Secondary CTA (text link, `#818cf8`, underlined): `View recipes` — calls `onViewRecipes`
- Empty state: subtext becomes `You don't have any saved recipes yet`; `View recipes` link is hidden

**Tile 2 — Friends** (green gradient)
- Background: `linear-gradient(135deg, #064e3b, #0a1f18)`, border `1px solid #065f46`, border-radius `14px`
- Label: `FRIENDS` — same sizing as above, `#34d399`
- Count: large bold number — `28px`, `font-weight 800`, `#fff`
- Subtext: `friends` — `12px`, `#6ee7b7`
- Primary CTA (pill, filled `#10b981`): `+ Add Friends` — calls `onOpenFriends`
- Secondary CTA (text link, `#34d399`, underlined): `View friends` — calls `onOpenFriends`
- Empty state: subtext becomes `You're not connected with any friends yet`; `View friends` link is hidden

**Theme note:** The gradient tiles always render in their dark gradient style regardless of the app's light/dark mode setting. This is a deliberate product decision — the tiles are designed as "social dashboard cards" with a fixed dark aesthetic that works as an accent against both light and dark app backgrounds.

---

## Component

**New file:** `apps/recipe-ui/src/components/StatsTiles.jsx`

**Props:**
```js
StatsTiles({
  recipeCount,      // number — userProfile?.recipeCount ?? recipes.length from App.jsx (never null)
  accessToken,      // string — for fetching friend count
  onAddRecipe,      // () => void — opens Add Recipe dialog
  onViewRecipes,    // () => void — setCurrentView('recipes')
  onOpenFriends,    // () => void — setIsFriendsDialogOpen(true)
})
```

**Friend count data:** `StatsTiles` fetches `GET /friends` on mount (same self-contained pattern as `FriendSections`). Friend count is derived from `response.friends.length`. This is an intentional independent fetch — it keeps the component self-contained without requiring App.jsx to eagerly load friends on every home view render.

**Loading state:** While the friend count is loading, the friends tile renders with `--` as the count placeholder and both CTAs visible. This reserves the full tile height immediately (no layout shift) while the fetch is in flight. Recipe count renders immediately from the passed prop.

**Error state (friend fetch):** If `GET /friends` fails (network error or non-200), the friends tile renders with `--` as the count and treats the state as non-empty (both CTAs remain visible, no empty-state message shown). No toast, spinner, or retry UI is required — the permanent `--` display on failure is acceptable for this tile.

**Empty state logic:**
- Recipes tile: empty when `recipeCount === 0`. Note: `recipeCount` is `userProfile?.recipeCount ?? recipes.length`. During the brief window before `userProfile` loads, `recipes.length` is used — if it is `0`, the empty state may flash momentarily for users who have recipes. This is acceptable given the short load time.
- Friends tile: empty when `friendCount === 0` (fetch resolved successfully with an empty array).

**`onOpenFriends`:** Both `+ Add Friends` and `View friends` call `onOpenFriends`, which opens the Friends dialog to its default tab. Note: because `StatsTiles` is conditionally rendered inside `{currentView === 'home' && session}`, it unmounts and remounts on every home↔recipes navigation, firing a fresh `GET /friends` fetch each time. This is intentional and acceptable — the endpoint is lightweight and the same pattern is used by `FriendSections`. The distinction between adding and viewing is handled inside that dialog. No `fetchFriends()` call is needed here — `StatsTiles` already fetches `/friends` on mount, and the Friends dialog manages its own data loading.

---

## Integration in App.jsx

Render `StatsTiles` at the top of the home view, above `FriendSections`:

```jsx
{currentView === 'home' && session && (
  <>
    <StatsTiles
      recipeCount={userProfile?.recipeCount ?? recipes.length}
      accessToken={accessToken}
      onAddRecipe={openAddDialog}
      onViewRecipes={() => setCurrentView('recipes')}
      onOpenFriends={() => setIsFriendsDialogOpen(true)}
    />
    <FriendSections ... />
  </>
)}
```

---

## What Does NOT Change

- `FriendSections.jsx` — untouched
- Worker — no new endpoints needed (`GET /friends` already exists)
- Friends dialog internals
- Recipe count fetching logic — reuses existing `userProfile?.recipeCount ?? recipes.length`
