import React, { useEffect, useState } from 'react';
import {
  Box, Stack, TextField, InputAdornment, IconButton, Paper, List,
  ListItemButton, ListItemText, Button, Typography, CircularProgress,
} from '@mui/material';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import AddIcon from '@mui/icons-material/Add';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RecipeListCard from './components/RecipeListCard';

export default function RecipesPage({
  displayedRecipes,
  filteredRecipes,
  totalRecipes,
  accessToken,
  onSaveSuggestion,
  onOpenSuggestion,
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
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (totalRecipes !== 0 || !accessToken) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    fetch(`${API_BASE_URL}/recipes/for-you`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setSuggestions(d?.recipes || []); })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setSuggestionsLoading(false); });
    return () => { cancelled = true; };
  }, [totalRecipes, accessToken]);

  const renderRecipeCard = (recipe, isSuggestion = false) => {
    const displayImageUrl = resolveRecipeImageUrl(recipe.title, recipe.imageUrl);
    const hasVideo = Boolean(buildEmbedUrl(recipe.sourceUrl));
    return (
      <RecipeListCard
        key={recipe.id}
        recipe={recipe}
        onOpen={isSuggestion && onOpenSuggestion ? onOpenSuggestion : handleOpenRecipe}
        onSave={() => {
          if (!session) { openAuthDialog(); return; }
          if (isSuggestion && onSaveSuggestion) { onSaveSuggestion(recipe); return; }
          toggleFavorite(recipe.id);
        }}
        onShare={(_, e) => handleShare(recipe, e)}
        saveIcon={
          !session || isSuggestion
            ? <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
            : favorites.has(recipe.id)
              ? <FavoriteIcon sx={{ fontSize: 18, color: '#e53935' }} />
              : <FavoriteBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
        }
        thumbnail={
          <Box
            role={hasVideo ? 'button' : undefined}
            aria-label={hasVideo ? `Play ${recipe.title} video` : undefined}
            onClick={hasVideo ? (event) => handleVideoThumbnailClick(event, recipe) : undefined}
            sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0, cursor: hasVideo ? 'pointer' : 'default', overflow: 'hidden', borderRadius: '6px' }}
          >
            <RecipeThumbnail
              src={displayImageUrl}
              alt={recipe.title || 'Recipe preview'}
              onError={createImageFallbackHandler(recipe.title)}
            />
            {hasVideo && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                <PlayArrowIcon sx={{ fontSize: 36, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
              </Box>
            )}
          </Box>
        }
        cardSx={{
          borderRadius: '8px',
          backgroundColor: 'background.paper',
          transition: 'box-shadow 200ms ease',
          '&:hover': { boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)' },
        }}
      />
    );
  };

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
                    const probe = document.createElement('div');
                    probe.style.cssText = 'position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top)';
                    document.body.appendChild(probe);
                    const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
                    document.body.removeChild(probe);
                    const top = el.getBoundingClientRect().top + window.scrollY - 16 - safeTop;
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

        {totalRecipes === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            You haven&rsquo;t saved any recipes yet
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {filteredRecipes.length === 1 ? '1 result' : `${filteredRecipes.length} results`}
          </Typography>
        )}

        {normalizedIngredients.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Showing recipes that include any of the ingredients you entered.
          </Typography>
        )}
      </Stack>

      {/* Recipe grid */}
      {remoteState.status === 'loading' && filteredRecipes.length === 0 && totalRecipes === 0 ? (
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
      ) : totalRecipes === 0 ? (
        <Stack spacing={1} sx={{ mt: 6 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary', mb: 1 }}>
            Recipes you might like
          </Typography>
          {suggestionsLoading && suggestions.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
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
              {suggestions.map((recipe) => renderRecipeCard(recipe, true))}
            </Box>
          )}
        </Stack>
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
          {displayedRecipes.map((recipe) => renderRecipeCard(recipe))}
        </Box>
      )}
      <Box ref={sentinelRef} sx={{ height: 1 }} />
    </Stack>
  );
}
