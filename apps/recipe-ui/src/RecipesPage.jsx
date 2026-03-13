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
