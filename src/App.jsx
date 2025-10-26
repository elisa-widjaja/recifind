import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Divider,
  FormControl,
  Grid,
  IconButton,
  Link,
  Snackbar,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import recipesData from '../recipes.json';

const MEAL_TYPE_LABELS = {
  breakfast: 'Breakfast',
  brunch: 'Brunch',
  lunch: 'Lunch',
  dinner: 'Dinner',
  dessert: 'Dessert',
  snack: 'Snack'
};

const MEAL_TYPE_ORDER = ['breakfast', 'brunch', 'lunch', 'dinner', 'dessert', 'snack'];

function validateRecipesPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.recipes)) {
    throw new Error("That file isn’t valid. Expected an object with a `recipes` array.");
  }

  return payload.recipes.map((recipe, index) => {
    if (!recipe || typeof recipe !== 'object') {
      throw new Error(`Recipe at index ${index} is not a valid object.`);
    }

    return {
      id: recipe.id ?? `recipe-${index}`,
      title: recipe.title ?? 'Untitled recipe',
      sourceUrl: recipe.sourceUrl ?? '',
      imageUrl: recipe.imageUrl ?? '',
      mealTypes: Array.isArray(recipe.mealTypes) ? recipe.mealTypes : [],
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      steps: Array.isArray(recipe.steps) ? recipe.steps : null,
      durationMinutes:
        typeof recipe.durationMinutes === 'number' && recipe.durationMinutes > 0
          ? recipe.durationMinutes
          : null
    };
  });
}

const INITIAL_RECIPES = (() => {
  try {
    return validateRecipesPayload(recipesData);
  } catch (error) {
    console.error(error);
    return [];
  }
})();

function getUniqueMealTypes(recipes) {
  const types = new Set();
  recipes.forEach((recipe) => {
    recipe.mealTypes.forEach((type) => {
      types.add(type);
    });
  });
  const ordered = MEAL_TYPE_ORDER.filter((type) => types.has(type));
  const extras = Array.from(types).filter((type) => !MEAL_TYPE_ORDER.includes(type));
  return [...ordered, ...extras];
}

function buildEmbedUrl(sourceUrl) {
  if (!sourceUrl) {
    return '';
  }
  try {
    const url = new URL(sourceUrl);
    url.search = '';
    if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return `${url.origin}${url.pathname}embed/?autoplay=1`;
  } catch (error) {
    return '';
  }
}

function App() {
  const [recipes, setRecipes] = useState(INITIAL_RECIPES);
  const [selectedMealType, setSelectedMealType] = useState('');
  const [ingredientInput, setIngredientInput] = useState('');
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [snackbarState, setSnackbarState] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const [videoDialogState, setVideoDialogState] = useState({
    open: false,
    url: '',
    title: '',
    source: ''
  });
  const fileInputRef = useRef(null);
  const sentinelRef = useRef(null);
  const RESULTS_PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);

  const normalizedIngredients = useMemo(() => {
    return ingredientInput
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }, [ingredientInput]);

  const normalizedIngredientsKey = normalizedIngredients.join('|');

  const availableMealTypes = useMemo(() => getUniqueMealTypes(recipes), [recipes]);

  const filteredRecipes = useMemo(() => {
    if (normalizedIngredients.length === 0 && !selectedMealType) {
      return recipes;
    }

    return recipes
      .map((recipe) => {
        let score = 0;

        if (selectedMealType) {
          const matchesMealType = recipe.mealTypes.some(
            (type) => type.toLowerCase() === selectedMealType.toLowerCase()
          );
          if (!matchesMealType) {
            return null;
          }
          score += 1;
        }

        if (normalizedIngredients.length > 0) {
          const haystack = [
            recipe.title,
            recipe.ingredients.join(' '),
            recipe.steps ? recipe.steps.join(' ') : ''
          ]
            .join(' ')
            .toLowerCase();

          normalizedIngredients.forEach((term) => {
            if (!term) {
              return;
            }
            if (haystack.includes(term)) {
              score += term.length;
            }
          });

          if (score === 0) {
            return null;
          }
        }

        return { recipe, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.recipe);
  }, [recipes, selectedMealType, normalizedIngredients]);

  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [selectedMealType, normalizedIngredientsKey, recipes]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return undefined;
    }

    if (visibleCount >= filteredRecipes.length) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(prev + RESULTS_PAGE_SIZE, filteredRecipes.length || RESULTS_PAGE_SIZE)
          );
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredRecipes.length, visibleCount]);

  useEffect(() => {
    if (visibleCount > filteredRecipes.length) {
      setVisibleCount(filteredRecipes.length);
    }
  }, [filteredRecipes.length, visibleCount]);

  const displayedRecipes = useMemo(
    () => filteredRecipes.slice(0, visibleCount),
    [filteredRecipes, visibleCount]
  );

  const resultsLabel = filteredRecipes.length === 1 ? '1 result' : `${filteredRecipes.length} results`;

  const handleMealTypeSelect = (value) => {
    setSelectedMealType((prev) => (prev === value ? '' : value));
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const validated = validateRecipesPayload(parsed);
        setRecipes(validated);
        setSelectedMealType('');
        setVisibleCount(RESULTS_PAGE_SIZE);
        setIngredientInput('');
        setSnackbarState({
          open: true,
          message: `Loaded ${validated.length} recipes from ${file.name}.`,
          severity: 'success'
        });
      } catch (error) {
        console.error(error);
        setSnackbarState({
          open: true,
          message: error.message || "That file isn’t valid. Expected an object with a `recipes` array.",
          severity: 'error'
        });
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setSnackbarState({
        open: true,
        message: 'Unable to read that file. Please try again.',
        severity: 'error'
      });
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleSnackbarClose = () => {
    setSnackbarState((prev) => ({ ...prev, open: false }));
  };

  const handleVideoThumbnailClick = (event, recipe) => {
    event.preventDefault();
    event.stopPropagation();

    const embedUrl = buildEmbedUrl(recipe.sourceUrl);
    if (embedUrl) {
      setVideoDialogState({
        open: true,
        url: embedUrl,
        title: recipe.title,
        source: recipe.sourceUrl
      });
    } else if (recipe.sourceUrl) {
      window.open(recipe.sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const closeVideoDialog = () => {
    setVideoDialogState({
      open: false,
      url: '',
      title: '',
      source: ''
    });
  };

  const closeDialog = () => {
    setActiveRecipe(null);
  };

  return (
    <>
      <AppBar position="static" color="inherit" elevation={0}>
        <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            ReciFind
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              recipes.json
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={handleFileChange}
            />
            <Button
              color="primary"
              variant="contained"
              startIcon={<UploadFileIcon />}
              onClick={handleFileButtonClick}
            >
              Load JSON
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
        <Stack spacing={3}>
          <Stack spacing={3}>
            <FormControl fullWidth>
              <TextField
                label="Search by ingredients"
                placeholder="e.g., chicken, garlic, spinach"
                value={ingredientInput}
                onChange={(event) => setIngredientInput(event.target.value)}
              />
            </FormControl>

            <Stack spacing={2}>
              <Typography variant="subtitle1" color="text.secondary">
                Meal type
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableMealTypes.map((type) => {
                  const label = MEAL_TYPE_LABELS[type] || type.replace(/^\w/, (c) => c.toUpperCase());
                  const selected = selectedMealType === type;
                  return (
                    <Chip
                      key={type}
                      label={label}
                      clickable
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      onClick={() => handleMealTypeSelect(type)}
                      aria-pressed={selected}
                    />
                  );
                })}
              </Box>

            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="center" spacing={1}>
              <Typography variant="body1" color="text.secondary" sx={{ flexGrow: 1 }}>
                {resultsLabel}
              </Typography>
              {normalizedIngredients.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Showing recipes that include any of the ingredients you entered.
                </Typography>
              )}
            </Stack>
          </Stack>

          {filteredRecipes.length === 0 ? (
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
                Try switching to <strong>Match any</strong>, remove filters, or load a different JSON file.
              </Typography>
            </Box>
          ) : (
            <Grid container spacing={{ xs: 2, md: 3 }}>
              {displayedRecipes.map((recipe) => (
                <Grid key={recipe.id} item xs={12} sm={6} md={4} lg={3}>
                  <Card elevation={1} sx={{ height: '100%' }}>
                    <CardActionArea
                      onClick={() => setActiveRecipe(recipe)}
                      sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <Box
                        role="button"
                        aria-label={`Play ${recipe.title} video`}
                        onClick={(event) => handleVideoThumbnailClick(event, recipe)}
                        sx={{
                          position: 'relative',
                          width: '100%',
                          height: 0,
                          pt: '62%',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          borderTopLeftRadius: 8,
                          borderTopRightRadius: 8,
                          '&:hover .play-overlay': { opacity: 1 }
                        }}
                      >
                        {recipe.imageUrl ? (
                          <Box
                            component="img"
                            src={recipe.imageUrl}
                            alt=""
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              backgroundColor: 'grey.200',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Typography variant="body2" color="text.secondary">
                              No image
                            </Typography>
                          </Box>
                        )}
                        <Box
                          className="play-overlay"
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            color: 'common.white',
                            background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.6) 100%)',
                            opacity: 0,
                            transition: 'opacity 200ms ease'
                          }}
                        >
                          <PlayCircleOutlineIcon fontSize="large" />
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            Play video
                          </Typography>
                        </Box>
                      </Box>
                      <CardContent sx={{ flexGrow: 1, width: '100%' }}>
                        <Tooltip title={recipe.title} placement="top">
                          <Typography variant="h6" component="div" noWrap>
                            {recipe.title}
                          </Typography>
                        </Tooltip>
                        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                          {recipe.mealTypes.map((type) => (
                            <Chip key={type} label={MEAL_TYPE_LABELS[type] || type} size="small" variant="outlined" />
                          ))}
                          {recipe.durationMinutes ? (
                            <Chip
                              icon={<AccessTimeIcon fontSize="small" />}
                              label={`${recipe.durationMinutes} min`}
                              size="small"
                              color="secondary"
                            />
                          ) : null}
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
          <Box ref={sentinelRef} sx={{ height: 1 }} />
        </Stack>
      </Container>

      <Dialog
        open={Boolean(activeRecipe)}
        onClose={closeDialog}
        fullWidth
        maxWidth="md"
        aria-labelledby="recipe-dialog-title"
      >
        {activeRecipe && (
          <>
            <DialogTitle id="recipe-dialog-title" sx={{ display: 'flex', alignItems: 'center', pr: 6 }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6">{activeRecipe.title}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                  {activeRecipe.mealTypes.map((type) => (
                    <Chip key={type} label={MEAL_TYPE_LABELS[type] || type} size="small" variant="outlined" />
                  ))}
                  {activeRecipe.durationMinutes ? (
                    <Chip
                      icon={<AccessTimeIcon fontSize="small" />}
                      label={`${activeRecipe.durationMinutes} min`}
                      size="small"
                      color="secondary"
                    />
                  ) : null}
                </Stack>
              </Box>
              <IconButton aria-label="Close recipe details" edge="end" onClick={closeDialog}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>

            <DialogContent dividers>
              {activeRecipe.imageUrl && (
                <Box
                  component="img"
                  src={activeRecipe.imageUrl}
                  alt={activeRecipe.title}
                  sx={{
                    width: '100%',
                    borderRadius: 2,
                    height: { xs: 200, md: 280 },
                    objectFit: 'cover',
                    mb: 3
                  }}
                />
              )}

              <Stack spacing={3}>
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Ingredients
                  </Typography>
                  <Divider />
                  <Box component="ul" sx={{ pl: 2, mt: 1, mb: 0 }}>
                    {activeRecipe.ingredients.map((ingredient) => (
                      <Typography key={ingredient} component="li" variant="body2">
                        {ingredient}
                      </Typography>
                    ))}
                  </Box>
                </Box>

                {activeRecipe.steps && activeRecipe.steps.length > 0 && (
                  <Box>
                    <Typography variant="subtitle1" gutterBottom>
                      Steps
                    </Typography>
                    <Divider />
                    <Box component="ol" sx={{ pl: 2, mt: 1, mb: 0 }}>
                      {activeRecipe.steps.map((step, index) => (
                        <Typography key={index} component="li" variant="body2">
                          {step}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                )}

                {activeRecipe.sourceUrl && (
                  <Box>
                    <Link href={activeRecipe.sourceUrl} target="_blank" rel="noopener" underline="hover">
                      View source
                    </Link>
                  </Box>
                )}
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>

      <Dialog
        open={videoDialogState.open}
        onClose={closeVideoDialog}
        fullWidth
        maxWidth="sm"
        aria-labelledby="video-dialog-title"
      >
        <DialogTitle id="video-dialog-title">{videoDialogState.title}</DialogTitle>
        <DialogContent dividers>
          {videoDialogState.url ? (
            <Box
              component="iframe"
              src={videoDialogState.url}
              title={videoDialogState.title}
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              sx={{
                width: '100%',
                aspectRatio: '9 / 16',
                border: 0,
                borderRadius: 2,
                backgroundColor: 'grey.900'
              }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Video playback is unavailable. You can open the recipe on Instagram instead.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeVideoDialog}>Close</Button>
          {videoDialogState.source ? (
            <Button
              color="primary"
              onClick={() => window.open(videoDialogState.source, '_blank', 'noopener,noreferrer')}
            >
              Open on Instagram
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbarState.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarState.severity} sx={{ width: '100%' }}>
          {snackbarState.message}
        </Alert>
      </Snackbar>
    </>
  );
}

export default App;
