import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Stack, TextField, InputAdornment, IconButton, Paper, List, Drawer, Divider,
  ListItemButton, ListItemText, Button, Typography, CircularProgress,
} from '@mui/material';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import CloseIcon from '@mui/icons-material/Close';

// Simplified "Tune" icon: 3 thin horizontal sliders with small handle dots.
// Lighter visual weight than MUI's TuneIcon, which adds tick marks around
// each handle.
function SimpleTuneIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <line x1="4" y1="4"  x2="20" y2="4" />
      <circle cx="15" cy="4"  r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="9"  cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="20" x2="20" y2="20" />
      <circle cx="13" cy="20" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
import AddIcon from '@mui/icons-material/Add';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RecipeListCard from './components/RecipeListCard';
import RecipeThumbnail from './components/RecipeThumbnail';

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
  sentinelRef,
  availableMealTypes = [],
  selectedMealType = '',
  onMealTypeSelect = () => {},
  availableCuisines = [],
  selectedCuisine = '',
  onCuisineSelect = () => {},
  showFavoritesOnly = false,
  onToggleFavoritesOnly = () => {},
  MEAL_TYPE_LABELS = {},
  MEAL_TYPE_ICONS = {},
  CUISINE_LABELS = {},
  CUISINE_ICONS = {},
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const filterChipsRef = useRef(null);
  // Read the latest selectedMealType inside an effect that only depends on
  // `filterDrawerOpen`. Without this, changing selection while the drawer is
  // open would re-trigger the scroll-into-view and visibly nudge the chip.
  const selectedMealTypeRef = useRef(selectedMealType);
  selectedMealTypeRef.current = selectedMealType;

  // Center the selected chip into view whenever the drawer transitions open
  // (matches the old hamburger filter behavior). Custom RAF easing because
  // browser-native `behavior: 'smooth'` runs ~250ms regardless of distance.
  useEffect(() => {
    if (!filterDrawerOpen) return;
    const sel = selectedMealTypeRef.current;
    if (!sel) return;
    let rafId = null;
    const startDelay = 350;
    const scrollDuration = 700;

    const timer = setTimeout(() => {
      const container = filterChipsRef.current;
      if (!container) return;
      const selected = container.querySelector('[aria-pressed="true"]');
      if (!selected) return;
      const startLeft = container.scrollLeft;
      const targetLeft = selected.offsetLeft - container.offsetWidth / 2 + selected.offsetWidth / 2;
      const distance = targetLeft - startLeft;
      const startTime = performance.now();
      const step = (now) => {
        const t = Math.min((now - startTime) / scrollDuration, 1);
        // ease-in-out cubic
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        container.scrollLeft = startLeft + distance * eased;
        if (t < 1) rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }, startDelay);

    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [filterDrawerOpen]);

  useEffect(() => {
    if (totalRecipes !== 0) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    // Empty-state suggestions ("Recipes you might like") come from the same
    // weekly-rotated Editor's Picks pool for everyone — logged-in new users
    // and logged-out guests alike see the curator's current 7 favorites.
    fetch(`${API_BASE_URL}/public/editors-pick`)
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
              title={recipe.title}
              fontSize={32}
            />
            {hasVideo && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                <PlayArrowIcon sx={{ fontSize: 20, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
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

        {/* Mobile Add Recipe button — visual match to the floating FAB Add
            Recipe pill (App.jsx) so the inline + scrolled-FAB versions feel
            like the same button at different anchors. */}
        <Box ref={addRecipeBtnRef} sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center' }}>
          <Button
            onClick={onAddRecipe}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '2.75rem',
              px: '18px',
              fontSize: '0.875rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              backgroundColor: 'primary.main',
              color: '#ffffff',
              borderRadius: '999px',
              border: 'none',
              textTransform: 'none',
              flexShrink: 0,
              transition: 'all 150ms ease',
              '&:hover': { backgroundColor: 'primary.dark' },
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
          (() => {
            const hasActiveFilters = Boolean(
              selectedMealType || selectedCuisine || showFavoritesOnly || normalizedIngredients.length > 0
            );
            const clearAllFilters = () => {
              if (selectedMealType) onMealTypeSelect('');
              if (selectedCuisine) onCuisineSelect('');
              if (showFavoritesOnly) onToggleFavoritesOnly();
              if (normalizedIngredients.length > 0) setIngredientInput('');
            };
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">
                  {filteredRecipes.length === 1 ? '1 result' : `${filteredRecipes.length} results`}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {hasActiveFilters && (
                    <Box
                      component="button"
                      onClick={clearAllFilters}
                      sx={(theme) => ({
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 400,
                        // Dark-mode primary is #5F60FF which falls just under
                        // WCAG AA contrast on #121212 at this size. Use
                        // primary.light (auto-derived brighter shade) so the
                        // link clears the threshold; light mode keeps the
                        // standard primary purple.
                        color: theme.palette.mode === 'dark'
                          ? theme.palette.primary.light
                          : theme.palette.primary.main,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                        WebkitTapHighlightColor: 'transparent',
                        '&:focus': { outline: 'none' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: 2 },
                      })}
                    >
                      Clear filters
                    </Box>
                  )}
                  <IconButton
                    size="small"
                    aria-label="Filters"
                    onClick={() => setFilterDrawerOpen(true)}
                    sx={{
                      color: hasActiveFilters ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    <SimpleTuneIcon size={20} />
                  </IconButton>
                </Box>
              </Box>
            );
          })()
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

      {/* Filter bottom-sheet — owns meal-type chips + favorites toggle.
          Matches the AddFriendDrawer / ShareSheet template (16px corners,
          near-black bg in dark, iOS X-close top-left). */}
      <Drawer
        anchor="bottom"
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        PaperProps={{
          sx: (theme) => ({
            borderRadius: '16px 16px 0 0',
            paddingBottom: 'env(safe-area-inset-bottom)',
            bgcolor: theme.palette.mode === 'dark' ? '#212328' : 'background.paper',
            ...(theme.palette.mode === 'dark' ? { backgroundImage: 'none' } : null),
          }),
        }}
      >
        {/* Header: iOS X-close top-LEFT, "Filters" title centered.
            X at left:16, top:20 → vertical center y=38; header pt:26 lands
            the title's center at the same y. */}
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', px: '24px', pt: '26px', pb: '16px', flexShrink: 0 }}>
          <Box sx={{ position: 'absolute', left: '16px', top: '20px' }}>
            <Box
              component="button"
              aria-label="Close filters"
              onClick={() => setFilterDrawerOpen(false)}
              sx={(theme) => ({
                width: 36, height: 36, borderRadius: '50%',
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                color: '#8a8a8a',
                border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background-color 150ms ease, transform 150ms ease',
                '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
                '&:active': { transform: 'scale(0.92)' },
              })}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </Box>
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: 16 }}>Filters</Typography>
        </Box>

        <Box sx={{ px: 2, py: 2 }}>
          <Typography component="div" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Meal type
          </Typography>
          <Box
            ref={filterChipsRef}
            sx={{
              display: 'flex', flexWrap: 'nowrap', overflowX: 'auto',
              gap: 1, mt: 1,
              mx: -2, px: 2,
              '&::-webkit-scrollbar': { display: 'none' },
              scrollbarWidth: 'none',
              maskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
            }}
          >
            {availableMealTypes.map((type) => {
              const label = MEAL_TYPE_LABELS[type] || type.replace(/^\w/, (c) => c.toUpperCase());
              const icon = MEAL_TYPE_ICONS[type];
              const selected = selectedMealType === type;
              return (
                <Box
                  key={type}
                  component="button"
                  role="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onMealTypeSelect(type);
                    // Auto-dismiss the drawer after tap. Held a bit longer so
                    // the user can see the chip flip to selected state before
                    // the panel slides away.
                    setTimeout(() => setFilterDrawerOpen(false), 750);
                  }}
                  sx={(theme) => ({
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    height: 36, px: 1.5, border: 'none', borderRadius: '999px',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                    whiteSpace: 'nowrap', flexShrink: 0,
                    ...(selected
                      ? { bgcolor: 'primary.main', color: '#fff' }
                      : {
                          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                          color: 'text.primary',
                        }),
                  })}
                >
                  {icon && (
                    <Box component="span" sx={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, bgcolor: selected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)' }}>
                      {icon}
                    </Box>
                  )}
                  {label}
                </Box>
              );
            })}
          </Box>
        </Box>

        {availableCuisines.length > 0 && (
          <>
            <Divider sx={{ mx: 2 }} />

            <Box sx={{ px: 2, py: 2 }}>
              <Typography component="div" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Cuisine
              </Typography>
              {/* Same horizontally-scrolling chip group treatment as Meal type;
                  only renders when at least one of the user's recipes has a
                  cuisine tag, so the section is hidden for brand-new users. */}
              <Box
                sx={{
                  display: 'flex', flexWrap: 'nowrap', overflowX: 'auto',
                  gap: 1, mt: 1,
                  mx: -2, px: 2,
                  '&::-webkit-scrollbar': { display: 'none' },
                  scrollbarWidth: 'none',
                  maskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
                }}
              >
                {availableCuisines.map((c) => {
                  const label = CUISINE_LABELS[c] || c.replace(/^\w/, (ch) => ch.toUpperCase());
                  const selected = selectedCuisine === c;
                  return (
                    <Box
                      key={c}
                      component="button"
                      role="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onCuisineSelect(c);
                        setTimeout(() => setFilterDrawerOpen(false), 750);
                      }}
                      sx={(theme) => ({
                        display: 'inline-flex', alignItems: 'center',
                        height: 36, px: 1.75, border: 'none', borderRadius: '999px',
                        cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                        whiteSpace: 'nowrap', flexShrink: 0,
                        ...(selected
                          ? { bgcolor: 'primary.main', color: '#fff' }
                          : {
                              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                              color: 'text.primary',
                            }),
                      })}
                    >
                      {label}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </>
        )}

        <Divider sx={{ mx: 2 }} />

        <Box sx={{ px: 2, py: 2 }}>
          <Typography component="div" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Show
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Box
              component="button"
              role="button"
              aria-label="Favorites"
              aria-pressed={showFavoritesOnly}
              onClick={onToggleFavoritesOnly}
              sx={(theme) => ({
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                height: 36, px: 1.5, border: 'none', borderRadius: '999px',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                ...(showFavoritesOnly
                  ? { bgcolor: 'primary.main', color: '#fff' }
                  : {
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                      color: 'text.primary',
                    }),
              })}
            >
              {showFavoritesOnly ? <FavoriteIcon sx={{ fontSize: 18 }} /> : <FavoriteBorderIcon sx={{ fontSize: 18 }} />}
              Favorites
            </Box>
          </Box>
        </Box>
      </Drawer>
    </Stack>
  );
}
