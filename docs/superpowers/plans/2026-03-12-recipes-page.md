# Recipes Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the logged-in recipe collection into a dedicated `RecipesPage` view, reachable via hamburger menu → "🍳 Recipes", while home becomes FriendSections-only.

**Architecture:** Add `currentView: 'home' | 'recipes'` state to App.jsx. Extract recipe collection JSX (search bar + recipe grid) from App.jsx into `RecipesPage.jsx`, passing all state/handlers as props. First extract the inline share handler to a named function so it can be prop-passed.

**Tech Stack:** React 18, MUI v5, Vite. All work is in `apps/recipe-ui/src/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-12-recipes-page-design.md`

---

## Chunk 1: Handler prep + view state + navigation wiring

### Task 1: Extract `handleShare` to a named component-body function

This is a mechanical refactor. The inline share `onClick` in the recipe card (inside a `.map()`) closes over many reactive values. It must become a named `const` inside the App component so it can be passed as a prop to RecipesPage.

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:4305-4350`

- [ ] **Step 1.1: Read the current inline share handler**

  Open `apps/recipe-ui/src/App.jsx` and read lines 4301–4355.

  The share `IconButton`'s `onClick` is currently a large `async (e) => { ... }` inline function. It needs to become a named function `handleShare(recipe, anchorPosition)` defined in the component body.

- [ ] **Step 1.2: Add the named `handleShare` function above the `return` statement**

  Find this comment in App.jsx (around line 3498, just before `return (`):
  ```
  resetFormState(`Added "${newRecipe.title}".`);
  };
  ```

  After that closing `};`, add the following. Note: `resetFormState` is defined *inside* `handleAddRecipe`, so this `};` closes `handleAddRecipe`, not `resetFormState`. Place `handleShare` immediately after it, still before `return (`.
  ```jsx
  const handleShare = async (recipe, anchorPosition) => {
    try {
      const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token;
      if (!accessToken) {
        setIsAuthDialogOpen(true);
        return;
      }
      let recipeId = recipe.id;
      // Starter recipes have synthetic IDs like "recipe-0". Save to account first.
      if (typeof recipeId === 'string' && recipeId.startsWith('recipe-')) {
        const payload = await buildApiRecipePayload(recipe);
        const saveRes = await callRecipesApi('/recipes', { method: 'POST', body: JSON.stringify(payload) }, accessToken);
        const savedRecipe = normalizeRecipeFromApi(saveRes?.recipe);
        if (!savedRecipe?.id) throw new Error('Failed to save recipe');
        recipeId = savedRecipe.id;
        setRecipes((prev) => {
          const updated = prev.map((r) => r.id === recipe.id ? savedRecipe : r);
          saveRecipesToCache(updated, session?.user?.id || null, serverVersionRef.current);
          return updated;
        });
      }
      if (API_BASE_URL) {
        const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipeId)}/share`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          }
        });
        if (response.ok) {
          const { token } = await response.json();
          const shareUrl = `${window.location.origin}?share=${token}`;
          setShareMenuState({ anchorPosition, url: shareUrl, title: recipe.title });
          return;
        }
      }
      setSnackbarState({ open: true, message: 'Unable to share this recipe', severity: 'error' });
    } catch (error) {
      console.error('Error sharing:', error);
      setSnackbarState({ open: true, message: 'Failed to share', severity: 'error' });
    }
  };
  ```

- [ ] **Step 1.3: Replace the inline onClick with a call to `handleShare`**

  Find the share `IconButton`'s `onClick` in the recipe card map (lines 4301–4354). Replace the entire inline `async (e) => { ... }` with:
  ```jsx
  onClick={(e) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorPosition = { top: rect.bottom, left: rect.right };
    handleShare(recipe, anchorPosition);
  }}
  ```

- [ ] **Step 1.4: Verify the app still builds and share works**

  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -20
  ```
  Expected: no errors. If errors, check the extraction — likely a missing variable reference.

- [ ] **Step 1.5: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/App.jsx
  git commit -m "refactor: extract handleShare to named component-body function"
  ```

---

### Task 2: Add `currentView` state

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:952`

- [ ] **Step 2.1: Add `currentView` state**

  Find the line (around 952):
  ```jsx
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  ```
  Add directly below it:
  ```jsx
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'recipes'
  ```

- [ ] **Step 2.2: Reset `currentView` on auth state change**

  Find the `onAuthStateChange` handler (around line 1250):
  ```jsx
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
    if (window.gtag) {
  ```
  Add `setCurrentView('home');` after `setSession(session);`:
  ```jsx
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
    setCurrentView('home');
    if (window.gtag) {
  ```

- [ ] **Step 2.3: Verify build still passes**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -20
  ```
  Expected: no errors.

- [ ] **Step 2.4: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/App.jsx
  git commit -m "feat: add currentView state with auth-change reset"
  ```

---

### Task 3: Wire up navigation triggers

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (4 locations)

- [ ] **Step 3.1: Make "ReciFind" title navigate home**

  Find (around line 3515):
  ```jsx
  <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
    ReciFind
  </Typography>
  ```
  Replace with:
  ```jsx
  <Typography
    variant="h6"
    component="div"
    onClick={() => setCurrentView('home')}
    sx={{ flexGrow: 1, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}
  >
    ReciFind
  </Typography>
  ```

- [ ] **Step 3.2: Update "🍳 Recipes" drawer button to navigate to recipes view**

  Find the drawer button (around line 3709):
  ```jsx
  <Box
    component="button"
    onClick={() => {
      setShowFavoritesOnly(false);
      setSelectedMealType(null);
      setMobileFilterDrawerOpen(false);
    }}
  ```
  Replace the `onClick` with:
  ```jsx
  onClick={() => {
    setCurrentView('recipes');
    setMobileFilterDrawerOpen(false);
  }}
  ```
  Note: the previous `setShowFavoritesOnly(false)` and `setSelectedMealType(null)` calls are intentionally removed — existing filter state is preserved when navigating to the Recipes view. Do not add them back.

- [ ] **Step 3.3: Auto-navigate to recipes when meal type chip is selected**

  Find `handleMealTypeSelect` (around line 2121):
  ```jsx
  const handleMealTypeSelect = (value) => {
    setSelectedMealType((prev) => (prev === value ? '' : value));
  };
  ```
  Replace with:
  ```jsx
  const handleMealTypeSelect = (value) => {
    setSelectedMealType((prev) => (prev === value ? '' : value));
    setCurrentView('recipes');
  };
  ```

- [ ] **Step 3.4: Auto-navigate to recipes when favorites is toggled**

  Find the favorites toggle in the drawer (around line 3797):
  ```jsx
  onClick={() => {
    setShowFavoritesOnly((prev) => !prev);
    setTimeout(() => setMobileFilterDrawerOpen(false), 300);
  }}
  ```
  Replace with:
  ```jsx
  onClick={() => {
    setShowFavoritesOnly((prev) => !prev);
    setCurrentView('recipes');
    setTimeout(() => setMobileFilterDrawerOpen(false), 300);
  }}
  ```

- [ ] **Step 3.5: Navigate to recipes after a recipe is successfully saved**

  Find `resetFormState` (around line 3412):
  ```jsx
  const resetFormState = (message) => {
    setSelectedMealType('');
    setIngredientInput('');
  ```
  Add `setCurrentView('recipes');` at the top of `resetFormState`:
  ```jsx
  const resetFormState = (message) => {
    setCurrentView('recipes');
    setSelectedMealType('');
    setIngredientInput('');
  ```

- [ ] **Step 3.6: Build to verify no errors**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -20
  ```
  Expected: no errors.

- [ ] **Step 3.7: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/App.jsx
  git commit -m "feat: wire navigation triggers for recipes/home view switching"
  ```

---

## Chunk 2: RecipesPage component + App.jsx wiring

### Task 4: Create `RecipesPage.jsx`

Extract the recipe collection JSX from App.jsx into a new component. This is a pure JSX extraction — all state and logic stay in App.jsx.

**Files:**
- Create: `apps/recipe-ui/src/RecipesPage.jsx`
- Modify: `apps/recipe-ui/src/App.jsx` (imports + render)

The JSX to extract is split across two regions in App.jsx:
- **Region A:** `<Stack spacing={{ xs: 2, sm: 3 }}>` at line 3972, minus the desktop meal-type chip row (lines 4046–4094), closing at line 4141 (`</Stack>`).
- **Region B:** The recipe grid conditional at lines 4143–4363 plus the sentinel `<Box ref={sentinelRef} sx={{ height: 1 }} />` at line 4364.

These two regions are sequential siblings inside the outer `<Stack spacing={1.5}>`.

- [ ] **Step 4.1: Create `RecipesPage.jsx`**

  Create `apps/recipe-ui/src/RecipesPage.jsx` with this structure. The component receives all data/handlers as props:

  ```jsx
  import React from 'react';
  import {
    Box, Stack, TextField, InputAdornment, IconButton, Paper, List,
    ListItemButton, ListItemText, Button, Typography, CircularProgress,
    Card, CardActionArea
  } from '@mui/material';
  import SearchIcon from '@mui/icons-material/Search';
  import ClearIcon from '@mui/icons-material/Clear';
  import AddIcon from '@mui/icons-material/Add';
  import AccessTimeIcon from '@mui/icons-material/AccessTime';
  import FavoriteIcon from '@mui/icons-material/Favorite';
  import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
  import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
  import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
  import PlayArrowIcon from '@mui/icons-material/PlayArrow';
  import { formatDuration } from './utils/videoEmbed';

  export default function RecipesPage({
    displayedRecipes,
    filteredRecipes,
    ingredientInput,
    setIngredientInput,
    ingredientInputKeyCount,
    showIngredientSuggestions,
    filteredIngredientSuggestions,
    ingredientSuggestionFormatter,
    handleIngredientInputChange,
    handleIngredientSuggestionClick,
    setIngredientInputFocused,
    setIngredientInputKeyCount,
    normalizedIngredients,
    resultsLabel,
    isMobile,
    searchBarRef,
    handleOpenRecipe,
    toggleFavorite,
    handleShare,
    handleVideoThumbnailClick,
    onAddRecipe,
    addRecipeBtnRef,
    session,
    favorites,
    openAuthDialog,
    remoteState,
    resolveRecipeImageUrl,
    buildEmbedUrl,
    createImageFallbackHandler,
    RecipeThumbnail,
    sentinelRef,
  }) {
    return (
      <Stack spacing={1.5}>
        {/* Search bar + Add Recipe button + results label */}
        <Stack spacing={{ xs: 2, sm: 3 }}>
          <Box sx={{ position: 'relative' }}>
            <TextField
              inputRef={searchBarRef}
              placeholder="Search by ingredients"
              value={ingredientInput}
              onChange={handleIngredientInputChange}
              onFocus={() => {
                setIngredientInputFocused(true);
                setIngredientInputKeyCount(0);
                if (isMobile && searchBarRef.current) {
                  setTimeout(() => {
                    const el = searchBarRef.current?.closest('.MuiTextField-root');
                    if (el) {
                      const top = el.getBoundingClientRect().top + window.scrollY - 16;
                      window.scrollTo({ top, behavior: 'smooth' });
                    }
                  }, 100);
                }
              }}
              onBlur={() => setIngredientInputFocused(false)}
              fullWidth
              sx={{
                '& .MuiOutlinedInput-root': { height: { xs: '50px', sm: '54px' }, borderRadius: '999px' }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                endAdornment: ingredientInput ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Clear ingredient search"
                      edge="end"
                      size="small"
                      onClick={() => setIngredientInput('')}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }}
            />
            {ingredientInputKeyCount >= 3 && showIngredientSuggestions && (
              <Paper
                elevation={3}
                sx={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  mt: 1,
                  zIndex: 5,
                  maxHeight: 240,
                  overflowY: 'auto'
                }}
              >
                <List dense disablePadding>
                  {filteredIngredientSuggestions.map((suggestion) => (
                    <ListItemButton
                      key={suggestion}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleIngredientSuggestionClick(suggestion)}
                    >
                      <ListItemText primary={ingredientSuggestionFormatter(suggestion)} />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>
            )}
          </Box>

          {/* Mobile Add Recipe button */}
          <Box ref={addRecipeBtnRef} sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center' }}>
            <Button
              onClick={onAddRecipe}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.125rem',
                height: '2.5rem',
                px: '14px',
                fontSize: '0.875rem',
                fontWeight: 500,
                lineHeight: 1.5,
                whiteSpace: 'nowrap',
                backgroundColor: 'primary.main',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                transition: 'all 150ms ease',
                flexShrink: 0,
                textTransform: 'none',
                '&:hover': {
                  backgroundColor: 'primary.dark'
                }
              }}
              startIcon={<AddIcon />}
            >
              Add Recipe
            </Button>
          </Box>

          {/* Results label */}
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexGrow: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {resultsLabel}
                </Typography>
              </Stack>
            </Stack>
            {normalizedIngredients.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                Showing recipes that include any of the ingredients you entered.
              </Typography>
            )}
          </Stack>
        </Stack>

        {/* Recipe grid */}
        {remoteState.status === 'loading' && filteredRecipes.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 8,
              gap: 2
            }}
          >
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading recipes…
            </Typography>
          </Box>
        ) : filteredRecipes.length === 0 ? (
          <Box
            sx={{
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              backgroundColor: 'background.paper'
            }}
          >
            <Typography variant="h6" gutterBottom>
              No recipes found.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try switching to <strong>Match any</strong>, remove filters, or adjust your search terms.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: '10px', sm: '14px' },
              maxWidth: 600,
              mx: 'auto'
            }}
          >
            {displayedRecipes.map((recipe) => {
              const displayImageUrl = resolveRecipeImageUrl(recipe.title, recipe.imageUrl);
              return (
                <Card
                  key={recipe.id}
                  elevation={0}
                  sx={{
                    display: 'flex',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: 1, borderColor: 'divider',
                    backgroundColor: 'background.paper',
                    transition: 'box-shadow 200ms ease',
                    '&:hover': {
                      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
                    }
                  }}
                >
                  <CardActionArea
                    onClick={() => handleOpenRecipe(recipe)}
                    sx={{
                      display: 'flex',
                      alignItems: 'stretch',
                      pt: '8px',
                      pb: '8px',
                      pl: '8px',
                      pr: 1.5,
                      gap: '12px',
                      '&:hover .MuiCardActionArea-focusHighlight': {
                        opacity: 0
                      }
                    }}
                  >
                    <Box
                      role={buildEmbedUrl(recipe.sourceUrl) ? 'button' : undefined}
                      aria-label={buildEmbedUrl(recipe.sourceUrl) ? `Play ${recipe.title} video` : undefined}
                      onClick={buildEmbedUrl(recipe.sourceUrl) ? (event) => handleVideoThumbnailClick(event, recipe) : undefined}
                      sx={{
                        position: 'relative',
                        width: 90,
                        height: 90,
                        flexShrink: 0,
                        cursor: buildEmbedUrl(recipe.sourceUrl) ? 'pointer' : 'default',
                        overflow: 'hidden',
                        borderRadius: '6px'
                      }}
                    >
                      <RecipeThumbnail
                        src={displayImageUrl}
                        alt={recipe.title || 'Recipe preview'}
                        onError={createImageFallbackHandler(recipe.title)}
                      />
                      {buildEmbedUrl(recipe.sourceUrl) && (
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.2)'
                          }}
                        >
                          <PlayArrowIcon sx={{ fontSize: 36, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
                        </Box>
                      )}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <Typography
                        variant="subtitle1"
                        component="div"
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.8125rem',
                          lineHeight: 1.4,
                          textTransform: 'uppercase',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {recipe.title}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {recipe.durationMinutes ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="caption" color="text.secondary">
                              {formatDuration(recipe.durationMinutes)}
                            </Typography>
                          </Box>
                        ) : <Box />}
                        <Box sx={{ flexGrow: 1 }} />
                        <IconButton
                          size="small"
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (!session) { openAuthDialog(); return; }
                            toggleFavorite(recipe.id);
                          }}
                          aria-label={session && favorites.has(recipe.id) ? 'Unsave recipe' : 'Save recipe'}
                          sx={{ p: 0.5, mr: '9px' }}
                        >
                          {!session
                            ? <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
                            : favorites.has(recipe.id)
                              ? <FavoriteIcon sx={{ fontSize: 18, color: '#e53935' }} />
                              : <FavoriteBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />}
                        </IconButton>
                        <IconButton
                          size="small"
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const anchorPosition = { top: rect.bottom, left: rect.right };
                            handleShare(recipe, anchorPosition);
                          }}
                          sx={{ p: 0.5 }}
                          aria-label="Share recipe"
                        >
                          <IosShareOutlinedIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
                        </IconButton>
                      </Box>
                    </Box>
                  </CardActionArea>
                </Card>
              );
            })}
          </Box>
        )}
        <Box ref={sentinelRef} sx={{ height: 1 }} />
      </Stack>
    );
  }
  ```

- [ ] **Step 4.2: Build to verify the new file has no syntax errors**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -20
  ```
  Expected: no errors (RecipesPage is not yet used, that's fine).

- [ ] **Step 4.3: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/RecipesPage.jsx
  git commit -m "feat: add RecipesPage component (not yet wired)"
  ```

---

### Task 5: Wire RecipesPage into App.jsx

Replace the old recipe collection JSX in App.jsx with conditional rendering. The old desktop meal-type chip row is also removed here (it was excluded from the design).

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 5.1: Import RecipesPage at the top of App.jsx**

  Find the existing import block (near the top of App.jsx). After the last local import (e.g. `import FriendSections from './FriendSections';`), add:
  ```jsx
  import RecipesPage from './RecipesPage';
  ```

- [ ] **Step 5.2: Replace the recipe collection region with conditional rendering**

  In App.jsx, find the logged-in container (around line 3960–3970):
  ```jsx
          <Stack spacing={1.5}>
            {session && (
              <FriendSections
                accessToken={accessToken}
                onOpenRecipe={handleOpenRecipeDetails}
                onSaveRecipe={handleOpenRecipeDetails}
                onInviteFriend={() => setIsFriendsDialogOpen(true)}
                darkMode={darkMode}
              />
            )}
            <Stack spacing={{ xs: 2, sm: 3 }}>
  ```

  Replace this entire block — starting from `<Stack spacing={1.5}>` and ending at `<Box ref={sentinelRef} sx={{ height: 1 }} />` (line 4364, inclusive) — with the following. This replaces the FriendSections + old recipe collection with conditional rendering:

  ```jsx
          <Stack spacing={1.5}>
            {currentView === 'home' && session && (
              <FriendSections
                accessToken={accessToken}
                onOpenRecipe={handleOpenRecipeDetails}
                onSaveRecipe={handleOpenRecipeDetails}
                onInviteFriend={() => setIsFriendsDialogOpen(true)}
                darkMode={darkMode}
              />
            )}
            {currentView === 'recipes' && (
              <RecipesPage
                displayedRecipes={displayedRecipes}
                filteredRecipes={filteredRecipes}
                ingredientInput={ingredientInput}
                setIngredientInput={setIngredientInput}
                ingredientInputKeyCount={ingredientInputKeyCount}
                showIngredientSuggestions={showIngredientSuggestions}
                filteredIngredientSuggestions={filteredIngredientSuggestions}
                ingredientSuggestionFormatter={ingredientSuggestionFormatter}
                handleIngredientInputChange={handleIngredientInputChange}
                handleIngredientSuggestionClick={handleIngredientSuggestionSelect}
                setIngredientInputFocused={setIngredientInputFocused}
                setIngredientInputKeyCount={setIngredientInputKeyCount}
                normalizedIngredients={normalizedIngredients}
                resultsLabel={resultsLabel}
                isMobile={isMobile}
                searchBarRef={searchBarRef}
                handleOpenRecipe={handleOpenRecipeDetails}
                toggleFavorite={toggleFavorite}
                handleShare={handleShare}
                handleVideoThumbnailClick={handleVideoThumbnailClick}
                onAddRecipe={openAddDialog}
                addRecipeBtnRef={addRecipeBtnRef}
                session={session}
                favorites={favorites}
                openAuthDialog={openAuthDialog}
                remoteState={remoteState}
                resolveRecipeImageUrl={resolveRecipeImageUrl}
                buildEmbedUrl={buildEmbedUrl}
                createImageFallbackHandler={createImageFallbackHandler}
                RecipeThumbnail={RecipeThumbnail}
                sentinelRef={sentinelRef}
              />
            )}
  ```

  Note: the `</Stack>` that closes the outer `<Stack spacing={1.5}>` at line 4365, the `</Box>` at 4366, and `</Container>)}` at 4367 all remain as-is.

  **Verify variable names match App.jsx exactly:**
  - `handleIngredientSuggestionSelect` is the function name in App.jsx (check with grep if unsure)
  - `openAuthDialog` — verify this function name in App.jsx
  - `showIngredientSuggestions`, `filteredIngredientSuggestions`, `ingredientSuggestionFormatter` — verify these exist in App.jsx

  To verify variable names and that `addRecipeBtnRef` is only used on the button:
  ```bash
  grep -n "handleIngredientSuggestionSelect\|openAuthDialog\|showIngredientSuggestions\|filteredIngredientSuggestions\|ingredientSuggestionFormatter\|ingredientInputKeyCount" /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui/src/App.jsx | head -20
  grep -n "addRecipeBtnRef" /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui/src/App.jsx
  ```
  `addRecipeBtnRef` should appear only on the button `<Box>` in the recipe collection area and the `useEffect` for the FAB observer — confirming it is safe to move the DOM attachment into RecipesPage.

- [ ] **Step 5.3: Build and verify**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -30
  ```
  Expected: no errors. If there are undefined variable errors, they'll name which prop is wrong — fix by finding the correct variable name in App.jsx.

- [ ] **Step 5.4: Smoke-test in dev**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run dev
  ```
  Check:
  - Logged-out → public landing page (all sections present, no change)
  - Logged-in → home shows FriendSections only (no recipe list)
  - Hamburger menu → "🍳 Recipes" → navigates to recipe list page
  - Search bar works, typing shows suggestions
  - Recipe cards open on tap
  - Heart/favorite icon works
  - Share icon opens share menu
  - Add Recipe button (mobile) visible, opens dialog
  - After saving a recipe, lands on Recipes page
  - "ReciFind" title click → back to home
  - Meal type chip in drawer → navigates to Recipes page with filter applied

- [ ] **Step 5.5: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/App.jsx
  git commit -m "feat: wire RecipesPage into App — home=FriendSections, recipes=RecipesPage"
  ```

---

### Task 6: Clean up — remove old recipe collection JSX from App.jsx

After Task 5, the old recipe collection JSX (lines 3972–4364 of the *original* App.jsx) is no longer rendered. It was replaced by the conditional in Task 5.2. Verify it was fully removed as part of the replacement. If any dead JSX remains (the old `<Stack spacing={{ xs: 2, sm: 3 }}>` block and recipe grid), delete it now.

- [ ] **Step 6.1: Verify no dead JSX remains**

  After the replacement in Task 5.2, there should be no second copy of the recipe collection. Check:
  ```bash
  grep -n "Search by ingredients" /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui/src/App.jsx
  ```
  Expected: 0 matches (the search field now lives only in RecipesPage.jsx).

  If matches are found, the old block wasn't fully removed — delete from the first `<Stack spacing={{ xs: 2, sm: 3 }}>` to `<Box ref={sentinelRef} sx={{ height: 1 }} />` in App.jsx.

- [ ] **Step 6.2: Final build**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
  npm run build 2>&1 | tail -20
  ```
  Expected: no errors.

- [ ] **Step 6.3: Commit**
  ```bash
  cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
  git add apps/recipe-ui/src/App.jsx
  git commit -m "chore: remove dead recipe collection JSX from App.jsx"
  ```

---

## Notes for implementer

- **Working directory:** All frontend work is in `.worktrees/discovery-feeds/apps/recipe-ui/`
- **Dev server:** `cd .worktrees/discovery-feeds/apps/recipe-ui && npm run dev -- --host`
- **No worker changes** — this feature is frontend-only
- **PublicLanding.jsx is untouched** — do not modify it
- **`handleIngredientSuggestionSelect`** — this is the function name in App.jsx for ingredient suggestion click. Pass it as `handleIngredientSuggestionClick` prop to RecipesPage (RecipesPage calls `handleIngredientSuggestionClick(suggestion)`)
- **`RecipeThumbnail`** — this is a component defined inside App.jsx (around line 599). Pass it as a prop to RecipesPage since RecipesPage can't import it directly. Alternatively, move it to its own file if you prefer, but passing as prop is simpler.
