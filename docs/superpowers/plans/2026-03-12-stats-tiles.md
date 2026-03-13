# Stats Tiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-tile stats banner (recipe count + friend count) at the top of the logged-in home feed with gradient styling and pill/text-link CTAs.

**Architecture:** A new self-contained `StatsTiles` component fetches `GET /friends` on mount and accepts `recipeCount` as a prop from App.jsx. It renders two gradient tiles side by side. App.jsx imports and renders it above `FriendSections` in the home view.

**Tech Stack:** React, MUI (Box, Typography, Stack), Cloudflare Worker API (`GET /friends`)

**Spec:** `docs/superpowers/specs/2026-03-12-stats-tiles-design.md`

---

## Chunk 1: StatsTiles component

### Task 1: Create `StatsTiles.jsx`

**Files:**
- Create: `apps/recipe-ui/src/components/StatsTiles.jsx`

**Context:** The app uses MUI. `GET /friends` returns `{ friends: [{ friendId, friendEmail, friendName }] }`. The API base URL comes from `import.meta.env.VITE_RECIPES_API_BASE_URL`. Both tiles always render in dark gradient style regardless of app theme. The component renders immediately (no null return on load — the friends tile shows `--` while fetching).

- [ ] **Step 1: Create the component file**

Create `apps/recipe-ui/src/components/StatsTiles.jsx` with this exact content:

```jsx
import { useState, useEffect } from 'react';
import { Box, Typography, Stack } from '@mui/material';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

export default function StatsTiles({ recipeCount, accessToken, onAddRecipe, onViewRecipes, onOpenFriends }) {
  const [friendCount, setFriendCount] = useState(null); // null = loading/error, number = resolved

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_BASE_URL}/friends`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setFriendCount((data.friends || []).length))
      .catch(() => setFriendCount(null)); // null = error, show '--'
  }, [accessToken]);

  const recipesEmpty = recipeCount === 0;
  const friendsEmpty = friendCount === 0;
  const friendDisplay = friendCount === null ? '--' : friendCount;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', mb: 1 }}>
      {/* Tile 1 — Recipes */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #1e1b4b, #1a1a2e)',
          border: '1px solid #3730a3',
          borderRadius: '14px',
          p: 2,
        }}
      >
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#818cf8', letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          RECIPES
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1, mb: 0.25 }}>
          {recipeCount}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#a5b4fc', mb: 1.75 }}>
          {recipesEmpty ? "You don't have any saved recipes yet" : 'saved recipes'}
        </Typography>
        <Stack spacing={1}>
          <Box
            component="button"
            onClick={onAddRecipe}
            sx={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              py: '8px',
              px: '12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            + Add Recipe
          </Box>
          {!recipesEmpty && (
            <Typography
              component="button"
              onClick={onViewRecipes}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                color: '#818cf8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textAlign: 'center',
              }}
            >
              View recipes
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Tile 2 — Friends */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #064e3b, #0a1f18)',
          border: '1px solid #065f46',
          borderRadius: '14px',
          p: 2,
        }}
      >
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#34d399', letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          FRIENDS
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1, mb: 0.25 }}>
          {friendDisplay}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#6ee7b7', mb: 1.75 }}>
          {friendsEmpty ? "You're not connected with any friends yet" : 'friends'}
        </Typography>
        <Stack spacing={1}>
          <Box
            component="button"
            onClick={onOpenFriends}
            sx={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              py: '8px',
              px: '12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            + Add Friends
          </Box>
          {!friendsEmpty && (
            <Typography
              component="button"
              onClick={onOpenFriends}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                color: '#34d399',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textAlign: 'center',
              }}
            >
              View friends
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify the file exists**

```bash
ls apps/recipe-ui/src/components/StatsTiles.jsx
```
Expected: file listed with no error.

---

## Chunk 2: Wire into App.jsx

### Task 2: Import and render StatsTiles in App.jsx

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:97` (import line, after FriendSections import)
- Modify: `apps/recipe-ui/src/App.jsx:4016-4024` (home view render block)

- [ ] **Step 1: Add the import**

In `apps/recipe-ui/src/App.jsx`, find line 97:
```js
import FriendSections from './components/FriendSections';
```
Add the import directly after it:
```js
import StatsTiles from './components/StatsTiles';
```

- [ ] **Step 2: Update the home view render block**

Find this block (around line 4016):
```jsx
{currentView === 'home' && session && (
  <FriendSections
    accessToken={accessToken}
    onOpenRecipe={handleOpenRecipeDetails}
    onSaveRecipe={handleOpenRecipeDetails}
    onInviteFriend={() => setIsFriendsDialogOpen(true)}
    darkMode={darkMode}
  />
)}
```

Replace with:
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
    <FriendSections
      accessToken={accessToken}
      onOpenRecipe={handleOpenRecipeDetails}
      onSaveRecipe={handleOpenRecipeDetails}
      onInviteFriend={() => setIsFriendsDialogOpen(true)}
      darkMode={darkMode}
    />
  </>
)}
```

- [ ] **Step 3: Start the dev server and verify visually**

```bash
cd apps/recipe-ui && npm run dev
```

Open the app in browser, log in, and verify:
- Two tiles appear at the top of the home feed
- Recipes tile: purple gradient, shows recipe count, `+ Add Recipe` pill, `View recipes` text link (hidden if count is 0)
- Friends tile: green gradient, shows `--` briefly then friend count, `+ Add Friends` pill, `View friends` text link (hidden if count is 0)
- `+ Add Recipe` opens the add recipe dialog
- `View recipes` navigates to the recipes view
- `+ Add Friends` and `View friends` open the friends dialog
- Empty state messages appear correctly when counts are 0
- **Error state:** In DevTools → Network, block the `/friends` request and reload; friends tile shows `--` with both CTAs visible and no empty-state message

- [ ] **Step 4: Commit**

```bash
git add apps/recipe-ui/src/components/StatsTiles.jsx apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): add stats tiles banner to logged-in home feed"
```
