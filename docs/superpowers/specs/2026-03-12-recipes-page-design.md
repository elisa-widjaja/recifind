# Recipes Page — Design Spec
**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Extract the logged-in recipe collection (search bar + recipe grid) from the monolithic `App.jsx` into a dedicated `RecipesPage` view. The logged-in home view becomes the discovery feed (`FriendSections`) only. Users navigate to their recipe collection via hamburger menu → "🍳 Recipes".

---

## Architecture

### View State

Add `currentView: 'home' | 'recipes'` to App.jsx state (default: `'home'`).

The logged-in root conditionally renders:
- `'home'` → `<FriendSections />` (discovery feed)
- `'recipes'` → `<RecipesPage />` (search + recipe grid)

All existing dialogs (recipe detail, add recipe), the floating FAB, the drawer, and auth flows remain in App.jsx and are unaffected by view state.

### New File

`apps/recipe-ui/src/RecipesPage.jsx`

Contains only a specific subset of the JSX currently in App.jsx:
- Search bar with ingredient suggestions dropdown
- Add Recipe inline button
- Results count label
- Loading spinner state
- Empty state ("No recipes found")
- Recipe card grid

**Extraction boundary:** Starts after the desktop meal-type chip row (excluded — search-only per design decision). Ends at the `<Box ref={sentinelRef} />` load-more sentinel (inclusive, ~line 4288). The share `<Menu>` and recipe detail `<Dialog>` that follow in the file remain in App.jsx.

**The desktop meal-type chip row** (currently ~lines 3972–4045 in App.jsx) is removed from the Recipes page entirely — users filter by meal type via the drawer only.

No state or handler logic moves — this is a pure JSX extraction.

---

## Navigation

### To Recipes page
- Hamburger menu → "🍳 Recipes" button (drawer profile header): sets `currentView = 'recipes'` and closes the drawer.
- Selecting a meal type chip in the drawer while on home: sets `currentView = 'recipes'` (auto-navigate to show filtered results).

### Back to Home
- Tapping the "ReciFind" app title in the top bar sets `currentView = 'home'`. No new drawer items needed.

---

## Pre-extraction required in App.jsx

Before extracting JSX to RecipesPage, two inline handlers must be promoted to named functions in App.jsx so they can be passed as props:

1. **`handleShare(recipe, anchorPosition)`** — the share onClick is currently a large inline async function inside a `map()` callback, closing over many reactive values (`supabase`, `session`, `accessToken`, `API_BASE_URL`, etc.). It must be extracted as a `const handleShare = (recipe, anchorPosition) => { ... }` defined **inside the component body** in App.jsx (not at module scope), so it retains access to reactive state. `recipe` must be passed as a parameter rather than captured from the map closure.

2. **`handleVideoThumbnailClick(event, recipe)`** — already exists as a named function in App.jsx. No extraction needed — just pass it as a prop.

The `handleShare` extraction is the first implementation step before any JSX moves.

---

## RecipesPage Props Interface

| Prop | Type | Purpose |
|------|------|---------|
| `displayedRecipes` | array | Paginated recipe list to render |
| `filteredRecipes` | array | Full filtered list (for result count) |
| `isLoading` | bool | Show loading spinner |
| `ingredientInput` | string | Controlled search input value |
| `setIngredientInput` | fn | Update search input |
| `suggestions` | array | Ingredient autocomplete suggestions |
| `setSuggestions` | fn | Clear/update suggestions |
| `selectedMealType` | string\|null | Active meal type filter (for display) |
| `showFavoritesOnly` | bool | Active favorites filter (for display) |
| `handleOpenRecipe` | fn | Opens recipe detail dialog |
| `toggleFavorite` | fn | Toggles heart/favorite on a recipe |
| `handleShare` | fn(recipe, anchorPosition) | Opens share menu (must be pre-extracted, see above) |
| `handleVideoThumbnailClick` | fn(event, recipe) | Play-button overlay click (must be pre-extracted, see above) |
| `onAddRecipe` | fn | Opens add recipe dialog/drawer |
| `addRecipeBtnRef` | ref | Ref on inline Add button (triggers FAB visibility) |
| `session` | object\|null | Auth session (gates favorite/share actions) |

---

## Interaction Behaviors (Preserved)

All existing behaviors remain unchanged:

- **Search:** Typing triggers ingredient suggestions after 3 chars; clear button resets; mobile auto-scrolls input into view on focus.
- **Recipe cards:** Tap opens detail dialog; heart toggles favorite; share icon opens share menu.
- **Add recipe:** Inline button on RecipesPage calls `onAddRecipe`; mobile FAB appears when user scrolls past the inline button (existing `addRecipeBtnRef` mechanism). After a recipe is successfully saved, `currentView` is set to `'recipes'` so the user lands on their collection and can see the new recipe.
- **Meal type filter:** Drawer chips filter recipes on the Recipes page. If user picks a chip while on home, auto-navigate to Recipes (`currentView = 'recipes'`).
- **Favorites filter:** Drawer favorites toggle filters the recipe grid. If user toggles favorites while on home, auto-navigate to Recipes (`currentView = 'recipes'`) so the filtered results are visible.
- **Pagination:** Load-more / infinite scroll unchanged.
- **Empty states:** Loading spinner and "No recipes found" render identically.

---

## View State Lifecycle

- **Default on login:** `currentView` defaults to `'home'`.
- **On auth state change (login/logout):** `currentView` resets to `'home'`. This prevents a returning user from landing on a stale filtered recipes view after re-authentication.
- **WelcomeModal / OnboardingFlow:** These render over any view and are unaffected by `currentView`.

---

## What Does NOT Change

- **Public landing page (`PublicLanding.jsx`) — zero changes.** The logged-out view and all its sections remain exactly as-is:
  - Trending Now
  - Discover new recipes
  - Auto-play recipe Shorts
  - Editor's Picks
  - Trending in Health & Nutrition
  - Cook with Friends
  The `{!session && isAuthChecked && <PublicLanding />}` conditional in App.jsx is untouched.
- Drawer menu structure and all drawer items (kept exactly as-is, except the "🍳 Recipes" button gets an `onClick`)
- Recipe detail dialog
- Add recipe dialog/drawer
- Floating Add Recipe FAB
- FriendSections component
- All state management and filtering logic in App.jsx
- Auth flows, WelcomeModal, OnboardingFlow
