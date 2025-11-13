import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ClearIcon from '@mui/icons-material/Clear';
import recipesData from '../recipes.json';
import recipesFromPdfData from '../recipes_from_pdf.json';

const MEAL_TYPE_LABELS = {
  breakfast: 'Breakfast',
  brunch: 'Brunch',
  lunch: 'Lunch',
  dinner: 'Dinner',
  dessert: 'Dessert',
  appetizer: 'Appetizer'
};

const MEAL_TYPE_ORDER = ['breakfast', 'brunch', 'lunch', 'dinner', 'dessert', 'appetizer'];
const NEW_RECIPE_TEMPLATE = {
  title: '',
  sourceUrl: '',
  imageUrl: '',
  mealTypes: '',
  ingredients: '',
  steps: '',
  durationMinutes: ''
};

function validateRecipesPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.recipes)) {
    throw new Error("That file isn’t valid. Expected an object with a `recipes` array.");
  }

  return payload.recipes.map((recipe, index) => {
    if (!recipe || typeof recipe !== 'object') {
      throw new Error(`Recipe at index ${index} is not a valid object.`);
    }

    const normalizedTitle =
      typeof recipe.title === 'string' && recipe.title.trim()
        ? recipe.title.trim()
        : 'Untitled recipe';

    const mealTypes = Array.isArray(recipe.mealTypes)
      ? recipe.mealTypes
          .filter((type) => typeof type === 'string' && type.toLowerCase() !== 'snack')
          .map((type) => type.trim())
      : [];

    return {
      id: recipe.id ?? `recipe-${index}`,
      title: normalizedTitle,
      sourceUrl: recipe.sourceUrl ?? '',
      imageUrl: resolveRecipeImageUrl(normalizedTitle, recipe.imageUrl),
      mealTypes,
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
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    return '';
  }
}

function normalizeUrlForLookup(sourceUrl) {
  if (!sourceUrl) {
    return '';
  }
  try {
    const url = new URL(sourceUrl);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (error) {
    return sourceUrl.trim();
  }
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function escapeSvgText(value) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return match;
    }
  });
}

function generatePlaceholderImage(title) {
  const safeTitle = title.trim();
  if (!safeTitle) {
    return '';
  }

  const palettes = [
    ['#FF9A8B', '#FF6A88'],
    ['#A18CD1', '#FBC2EB'],
    ['#5EE7DF', '#B490CA'],
    ['#F6D365', '#FDA085'],
    ['#84FAB0', '#8FD3F4'],
    ['#C2FFD8', '#465EFB']
  ];

  const lowercaseTitle = safeTitle.toLowerCase();
  const hash = hashString(lowercaseTitle);
  const [start, end] = palettes[hash % palettes.length];

  const initials = lowercaseTitle
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#gradient)" />
      <text
        x="50%"
        y="50%"
        dominant-baseline="middle"
        text-anchor="middle"
        fill="rgba(255, 255, 255, 0.9)"
        font-family="Inter, Arial, sans-serif"
        font-weight="700"
        font-size="140"
        letter-spacing="6"
      >
        ${escapeSvgText(initials || safeTitle.slice(0, 3).toUpperCase())}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function resolveRecipeImageUrl(title, imageUrl) {
  const candidate = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (candidate) {
    return candidate;
  }

  const safeTitle = typeof title === 'string' ? title.trim() : '';
  if (!safeTitle) {
    return '';
  }

  return generatePlaceholderImage(safeTitle);
}

function createImageFallbackHandler(title) {
  const safeTitle = title?.trim() || '';
  return (event) => {
    const target = event.currentTarget;
    if (!target || target.dataset.fallbackApplied === 'true') {
      return;
    }

    target.dataset.fallbackApplied = 'true';
    target.onerror = null;

    const placeholder = generatePlaceholderImage(safeTitle || 'Recipe');
    if (placeholder) {
      target.src = placeholder;
      target.alt = safeTitle || 'Recipe preview';
    } else {
      target.removeAttribute('src');
      target.alt = safeTitle ? `${safeTitle} image unavailable` : 'Recipe preview unavailable';
    }
  };
}

const SOURCE_PROXY_PREFIX = 'https://r.jina.ai/';
const SOURCE_PARSE_CACHE = new Map();

function buildProxyFetchUrl(sourceUrl) {
  if (!sourceUrl) {
    return '';
  }
  try {
    const normalized = new URL(sourceUrl.trim());
    return `${SOURCE_PROXY_PREFIX}${normalized.toString()}`;
  } catch (error) {
    return '';
  }
}

function findRecipeNode(candidate) {
  if (!candidate) {
    return null;
  }
  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      const found = findRecipeNode(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof candidate === 'object') {
    const typeValue = candidate['@type'];
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    if (types.filter(Boolean).some((type) => String(type).toLowerCase() === 'recipe')) {
      return candidate;
    }
    if (candidate['@graph']) {
      return findRecipeNode(candidate['@graph']);
    }
  }
  return null;
}

function normalizeInstructionList(value) {
  const steps = [];
  const pushStep = (text) => {
    if (!text) {
      return;
    }
    const cleaned = text.toString().trim();
    if (cleaned) {
      steps.push(cleaned);
    }
  };

  const handleNode = (node) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(handleNode);
      return;
    }
    if (typeof node === 'string') {
      node
        .split(/\r?\n/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .forEach(pushStep);
      return;
    }
    if (typeof node === 'object') {
      if (Array.isArray(node.itemListElement)) {
        handleNode(node.itemListElement);
        return;
      }
      pushStep(node.text || node.description || node.name);
    }
  };

  handleNode(value);
  return steps;
}

function collectMicrodataList(doc, selectors) {
  const items = new Set();
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((element) => {
      const text = element.textContent?.trim();
      if (text) {
        text
          .split(/\r?\n/)
          .map((segment) => segment.trim())
          .filter(Boolean)
          .forEach((segment) => items.add(segment));
      }
    });
  });
  return Array.from(items);
}

function extractRecipeFromJsonLd(doc) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return null;
  }
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const rawContent = script.textContent?.trim();
    if (!rawContent) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawContent);
      const recipeNode = findRecipeNode(parsed);
      if (!recipeNode) {
        continue;
      }
      const title = (recipeNode.name || recipeNode.headline || '').toString().trim();
      const ingredients = Array.isArray(recipeNode.recipeIngredient)
        ? recipeNode.recipeIngredient.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : [];
      const steps = normalizeInstructionList(
        recipeNode.recipeInstructions || recipeNode.instructions || recipeNode.recipeDirections
      );

      return {
        title,
        ingredients,
        steps
      };
    } catch (error) {
      // Ignore malformed JSON blocks.
    }
  }
  return null;
}

function extractRecipeFromHtml(html) {
  if (!html || typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const fromStructuredData = extractRecipeFromJsonLd(doc);
  if (fromStructuredData) {
    return fromStructuredData;
  }

  const fallbackTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent ||
    '';
  const ingredients = collectMicrodataList(doc, ['[itemprop="recipeIngredient"]', '[itemprop="ingredients"]']);
  const steps = collectMicrodataList(doc, [
    '[itemprop="recipeInstructions"]',
    '[itemprop="recipeStep"]',
    '[itemprop="instructions"]'
  ]);

  if (!fallbackTitle && ingredients.length === 0 && steps.length === 0) {
    return null;
  }

  return {
    title: fallbackTitle.trim(),
    ingredients,
    steps
  };
}

async function fetchRecipeDetailsFromSource(sourceUrl, { signal } = {}) {
  const cacheKey = normalizeUrlForLookup(sourceUrl);
  if (cacheKey && SOURCE_PARSE_CACHE.has(cacheKey)) {
    return SOURCE_PARSE_CACHE.get(cacheKey);
  }

  const proxiedUrl = buildProxyFetchUrl(sourceUrl);
  if (!proxiedUrl) {
    return null;
  }

  const fetchPromise = fetch(proxiedUrl, {
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((html) => extractRecipeFromHtml(html))
    .catch((error) => {
      console.error('Failed to parse recipe details from source URL.', error);
      return null;
    });

  if (cacheKey) {
    SOURCE_PARSE_CACHE.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}

const PREFILL_RECIPES_LOOKUP = (() => {
  const map = new Map();

  const addRecipes = (recipes) => {
    recipes.forEach((recipe) => {
      if (!recipe || !recipe.sourceUrl) {
        return;
      }

      const canonical = normalizeUrlForLookup(recipe.sourceUrl);
      if (canonical && !map.has(canonical)) {
        map.set(canonical, recipe);
      }

      const embedUrl = buildEmbedUrl(recipe.sourceUrl);
      if (embedUrl) {
        const embedKey = normalizeUrlForLookup(embedUrl);
        if (embedKey && !map.has(embedKey)) {
          map.set(embedKey, recipe);
        }
      }
    });
  };

  addRecipes(INITIAL_RECIPES);

  try {
    const pdfRecipes = validateRecipesPayload(recipesFromPdfData);
    addRecipes(pdfRecipes);
  } catch (error) {
    console.error('Unable to prepare additional recipes for prefill.', error);
  }

  return map;
})();

function App() {
  const [recipes, setRecipes] = useState(INITIAL_RECIPES);
  const [selectedMealType, setSelectedMealType] = useState('');
  const [ingredientInput, setIngredientInput] = useState('');
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [activeRecipeDraft, setActiveRecipeDraft] = useState(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newRecipeForm, setNewRecipeForm] = useState(() => ({ ...NEW_RECIPE_TEMPLATE }));
  const [newRecipeErrors, setNewRecipeErrors] = useState({});
  const [newRecipePrefillInfo, setNewRecipePrefillInfo] = useState({
    matched: false,
    hasIngredients: false,
    hasSteps: false
  });
  const [sourceParseState, setSourceParseState] = useState({ status: 'idle', message: '' });
  const [ingredientInputFocused, setIngredientInputFocused] = useState(false);
  const [ingredientInputKeyCount, setIngredientInputKeyCount] = useState(0);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [snackbarState, setSnackbarState] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const sentinelRef = useRef(null);
  const RESULTS_PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);

  const normalizedIngredients = useMemo(() => {
    const uniqueTokens = new Set();
    ingredientInput
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => {
        segment
          .split(/\s+/)
          .map((token) => token.trim().toLowerCase())
          .filter(Boolean)
          .forEach((token) => uniqueTokens.add(token));
      });
    return Array.from(uniqueTokens);
  }, [ingredientInput]);

  const normalizedIngredientsKey = normalizedIngredients.join('|');

  const ingredientSuggestions = useMemo(() => {
    const counts = new Map();
    recipes.forEach((recipe) => {
      recipe.ingredients.forEach((ingredientLine) => {
        ingredientLine
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((token) => token.trim())
          .filter((token) => token.length > 2 && isNaN(Number(token)))
          .forEach((token) => {
            counts.set(token, (counts.get(token) || 0) + 1);
          });
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([token]) => token);
  }, [recipes]);

  const activeIngredientToken = ingredientInput
    .split(',')
    .pop()
    ?.trim()
    .toLowerCase();

  const filteredIngredientSuggestions = useMemo(() => {
    if (!ingredientSuggestions.length) {
      return [];
    }
    const limit = 8;
    if (!activeIngredientToken) {
      return ingredientSuggestions.slice(0, limit);
    }
    return ingredientSuggestions
      .filter((suggestion) => suggestion.startsWith(activeIngredientToken))
      .slice(0, limit);
  }, [ingredientSuggestions, activeIngredientToken]);

  const availableMealTypes = useMemo(() => getUniqueMealTypes(recipes), [recipes]);

  const filteredRecipes = useMemo(() => {
    const scored = recipes
      .map((recipe, index, array) => {
        if (selectedMealType) {
          const matchesMealType = recipe.mealTypes.some(
            (type) => type.toLowerCase() === selectedMealType.toLowerCase()
          );
          if (!matchesMealType) {
            return null;
          }
        }

        let ingredientScore = 0;
        if (normalizedIngredients.length > 0) {
          const haystack = `${recipe.title} ${recipe.ingredients.join(' ')} ${
            recipe.steps ? recipe.steps.join(' ') : ''
          }`.toLowerCase();

          normalizedIngredients.forEach((term) => {
            if (term && haystack.includes(term)) {
              ingredientScore += term.length;
            }
          });

          if (ingredientScore === 0) {
            return null;
          }
        }

        const recencyScore = array.length - index;
        const score = ingredientScore + (selectedMealType ? 1 : 0);
        return { recipe, score, recencyScore };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.recencyScore - a.recencyScore;
      })
      .map((entry) => entry.recipe);

    return scored;
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

  const shouldRequireIngredients = newRecipePrefillInfo.hasIngredients;
  const shouldRequireSteps = newRecipePrefillInfo.hasSteps;

  const ingredientSuggestionFormatter = useCallback(
    (value) => value.replace(/\b\w/g, (char) => char.toUpperCase()),
    []
  );

  const handleIngredientInputChange = useCallback((event) => {
    const { value } = event.target;
    setIngredientInput(value);
    setIngredientInputKeyCount((prev) => prev + 1);
  }, []);

  const handleIngredientSuggestionSelect = useCallback((suggestion) => {
    if (!suggestion) {
      return;
    }
    setIngredientInput((prev) => {
      if (!prev.trim()) {
        return suggestion;
      }
      const segments = prev.split(',');
      segments[segments.length - 1] = suggestion;
      return segments
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join(', ');
    });
    setIngredientInputKeyCount((prev) => Math.max(prev, 3));
  }, []);

  const showIngredientSuggestions = ingredientInputFocused && filteredIngredientSuggestions.length > 0;

  const ingredientsHelperText =
    newRecipeErrors.ingredients ||
    (shouldRequireIngredients
      ? 'We split on new lines first, then commas.'
      : 'Optional. Separate ingredients with new lines or commas.');

  const stepsHelperText =
    newRecipeErrors.steps ||
    (shouldRequireSteps ? 'Separate steps with new lines.' : 'Optional instructions. Separate steps with new lines.');

  const activeRecipeView = activeRecipeDraft;

  const activeRecipeImageUrl = useMemo(() => {
    if (!activeRecipeView) {
      return '';
    }
    return resolveRecipeImageUrl(activeRecipeView.title, activeRecipeView.imageUrl);
  }, [activeRecipeView]);

  const newRecipePreviewImageUrl = useMemo(
    () => resolveRecipeImageUrl(newRecipeForm.title, newRecipeForm.imageUrl),
    [newRecipeForm.title, newRecipeForm.imageUrl]
  );

  const resultsLabel = filteredRecipes.length === 1 ? '1 result' : `${filteredRecipes.length} results`;

  const handleMealTypeSelect = (value) => {
    setSelectedMealType((prev) => (prev === value ? '' : value));
  };

  const handleSnackbarClose = () => {
    setSnackbarState((prev) => ({ ...prev, open: false }));
  };

  const handleOpenRecipeDetails = useCallback((recipe) => {
    if (!recipe) {
      return;
    }
    setActiveRecipe(recipe);
    setIsDeleteConfirmOpen(false);
    setActiveRecipeDraft({
      ...recipe,
      ingredients: Array.isArray(recipe.ingredients) ? [...recipe.ingredients] : [],
      steps: Array.isArray(recipe.steps) ? [...recipe.steps] : []
    });
  }, []);

  const handleVideoThumbnailClick = (event, recipe) => {
    event.preventDefault();
    event.stopPropagation();

    const normalizedUrl = buildEmbedUrl(recipe.sourceUrl);
    const targetUrl = normalizedUrl || recipe.sourceUrl;

    if (targetUrl) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
      setSnackbarState({
        open: true,
        message: 'This recipe does not have a valid video link.',
        severity: 'info'
      });
    }
  };

  const openDeleteConfirm = () => {
    setIsDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setIsDeleteConfirmOpen(false);
  };

  const handleDeleteRecipe = () => {
    if (!activeRecipe) {
      return;
    }

    const deletedTitle = activeRecipe.title;
    const deletedId = activeRecipe.id;

    setRecipes((prev) => prev.filter((recipe) => recipe.id !== deletedId));
    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
    setSnackbarState({
      open: true,
      message: `Deleted "${deletedTitle}".`,
      severity: 'info'
    });
  };

  const handleSaveActiveRecipe = () => {
    if (!activeRecipe || !activeRecipeDraft) {
      closeDialog();
      return;
    }

    setRecipes((prev) =>
      prev.map((recipe) => (recipe.id === activeRecipe.id ? { ...recipe, ...activeRecipeDraft } : recipe))
    );

    setSnackbarState({
      open: true,
      message: `Saved "${activeRecipeDraft.title}".`,
      severity: 'success'
    });

    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
  };

  const closeDialog = () => {
    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
  };

  const openAddDialog = () => {
    setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
    setNewRecipeErrors({});
    setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
    setIsAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    setIsAddDialogOpen(false);
  };

  const handleNewRecipeChange = (field) => (event) => {
    const value = event.target.value;
    setNewRecipeForm((prev) => ({
      ...prev,
      [field]: field === 'durationMinutes' ? value.replace(/[^\d]/g, '') : value
    }));
  };

  useEffect(() => {
    const sourceUrl = newRecipeForm.sourceUrl.trim();
    if (!sourceUrl) {
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      return;
    }

    const candidateKeys = new Set([normalizeUrlForLookup(sourceUrl)]);
    const embedCandidate = buildEmbedUrl(sourceUrl);
    if (embedCandidate) {
      candidateKeys.add(normalizeUrlForLookup(embedCandidate));
    }

    let matchedRecipe = null;
    for (const key of candidateKeys) {
      if (key && PREFILL_RECIPES_LOOKUP.has(key)) {
        matchedRecipe = PREFILL_RECIPES_LOOKUP.get(key);
        break;
      }
    }

    if (!matchedRecipe) {
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      return;
    }

    const ingredientsAvailable =
      Array.isArray(matchedRecipe.ingredients) && matchedRecipe.ingredients.filter(Boolean).length > 0;
    const stepsAvailable =
      Array.isArray(matchedRecipe.steps) && matchedRecipe.steps.filter((step) => typeof step === 'string' && step.trim())
        .length > 0;

    setNewRecipePrefillInfo({
      matched: true,
      hasIngredients: ingredientsAvailable,
      hasSteps: stepsAvailable
    });

    const fallbackImage =
      matchedRecipe.imageUrl || (matchedRecipe.title ? generatePlaceholderImage(matchedRecipe.title) : '');

    let patchedTitle = false;
    let patchedIngredients = false;
    let patchedSteps = false;
    let patchedImage = false;
    let patchedDuration = false;

    setNewRecipeForm((prev) => {
      let changed = false;
      const next = { ...prev };

      if (!prev.title && matchedRecipe.title) {
        next.title = matchedRecipe.title;
        changed = true;
        patchedTitle = true;
      }

      if (!prev.ingredients && Array.isArray(matchedRecipe.ingredients) && matchedRecipe.ingredients.length > 0) {
        next.ingredients = matchedRecipe.ingredients.join('\n');
        changed = true;
        patchedIngredients = true;
      }

      if (!prev.mealTypes && Array.isArray(matchedRecipe.mealTypes) && matchedRecipe.mealTypes.length > 0) {
        next.mealTypes = matchedRecipe.mealTypes.join(', ');
        changed = true;
      }

      if (!prev.steps && Array.isArray(matchedRecipe.steps) && matchedRecipe.steps.length > 0) {
        next.steps = matchedRecipe.steps.join('\n');
        changed = true;
        patchedSteps = true;
      }

      if (!prev.durationMinutes && matchedRecipe.durationMinutes) {
        next.durationMinutes = String(matchedRecipe.durationMinutes);
        changed = true;
        patchedDuration = true;
      }

      if (!prev.imageUrl && fallbackImage) {
        next.imageUrl = fallbackImage;
        changed = true;
        patchedImage = true;
      }

      return changed ? next : prev;
    });

    if (patchedTitle || patchedIngredients || patchedSteps || patchedImage || patchedDuration) {
      setNewRecipeErrors((prev) => {
        if (!prev || Object.keys(prev).length === 0) {
          return prev;
        }
        const next = { ...prev };
        let updated = false;

        if (patchedTitle && next.title) {
          delete next.title;
          updated = true;
        }

        if (patchedIngredients && next.ingredients) {
          delete next.ingredients;
          updated = true;
        }

        if (patchedSteps && next.steps) {
          delete next.steps;
          updated = true;
        }

        if (patchedImage && next.imageUrl) {
          delete next.imageUrl;
          updated = true;
        }

        if (patchedDuration && next.durationMinutes) {
          delete next.durationMinutes;
          updated = true;
        }

        return updated ? next : prev;
      });
    }
  }, [newRecipeForm.sourceUrl]);

  useEffect(() => {
    const sourceUrl = newRecipeForm.sourceUrl.trim();
    if (!sourceUrl) {
      setSourceParseState({ status: 'idle', message: '' });
      return;
    }

    const urlError = validateUrl(sourceUrl, { required: true });
    if (urlError) {
      setSourceParseState({ status: 'idle', message: '' });
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    setSourceParseState({ status: 'loading', message: 'Parsing recipe details…' });

    fetchRecipeDetailsFromSource(sourceUrl, { signal: controller.signal })
      .then((result) => {
        if (!isActive) {
          return;
        }
        if (!result) {
          setSourceParseState({ status: 'error', message: 'Unable to parse recipe details from that link.' });
          return;
        }

        setSourceParseState({ status: 'success', message: 'Recipe details parsed from source link.' });

        setNewRecipeForm((prev) => {
          const next = { ...prev };
          let changed = false;

          if (!next.title && result.title) {
            next.title = result.title;
            changed = true;
          }

          if (!next.ingredients && Array.isArray(result.ingredients) && result.ingredients.length > 0) {
            next.ingredients = result.ingredients.join('\n');
            changed = true;
          }

          if (!next.steps && Array.isArray(result.steps) && result.steps.length > 0) {
            next.steps = result.steps.join('\n');
            changed = true;
          }

          return changed ? next : prev;
        });

        setNewRecipeErrors((prev) => {
          if (!prev || Object.keys(prev).length === 0) {
            return prev;
          }
          const next = { ...prev };
          let updated = false;

          if (result.title && next.title) {
            delete next.title;
            updated = true;
          }

          if (result.ingredients?.length && next.ingredients) {
            delete next.ingredients;
            updated = true;
          }

          if (result.steps?.length && next.steps) {
            delete next.steps;
            updated = true;
          }

          return updated ? next : prev;
        });

        setNewRecipePrefillInfo((prev) => ({
          matched: prev.matched || Boolean(result.title),
          hasIngredients: prev.hasIngredients || Boolean(result.ingredients?.length),
          hasSteps: prev.hasSteps || Boolean(result.steps?.length)
        }));
      })
      .catch((error) => {
        if (!isActive && error?.name === 'AbortError') {
          return;
        }
        console.error('Unable to parse recipe from URL.', error);
        if (isActive) {
          setSourceParseState({ status: 'error', message: 'Unable to parse recipe details from that link.' });
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [newRecipeForm.sourceUrl]);

  const handleGenerateImage = () => {
    const title = newRecipeForm.title.trim();
    if (!title) {
      setNewRecipeErrors((prev) => ({
        ...prev,
        title: prev?.title || 'Add a title before generating an image.'
      }));
      return;
    }

    const generated = generatePlaceholderImage(title);
    if (!generated) {
      return;
    }

    setNewRecipeForm((prev) => ({
      ...prev,
      imageUrl: generated
    }));

    setNewRecipeErrors((prev) => {
      if (!prev || !prev.imageUrl) {
        return prev;
      }
      const next = { ...prev };
      delete next.imageUrl;
      return next;
    });
  };

  function validateUrl(rawValue, { required } = { required: false }) {
    const value = rawValue.trim();
    if (!value) {
      return required ? 'This field is required.' : '';
    }
    if (value.startsWith('data:')) {
      return '';
    }
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'Use http or https links.';
      }
      return '';
    } catch (error) {
      return 'Enter a valid URL.';
    }
  }

  const parseList = (value, { allowComma = true } = {}) =>
    value
      .split(/\r?\n/)
      .flatMap((segment) => (allowComma ? segment.split(',') : [segment]))
      .map((item) => item.trim())
      .filter(Boolean);

  const handleAddRecipeSubmit = (event) => {
    event.preventDefault();
    const errors = {};

    const title = newRecipeForm.title.trim();
    if (!title) {
      errors.title = 'Title is required.';
    }

    const sourceUrlError = validateUrl(newRecipeForm.sourceUrl.trim(), { required: true });
    if (sourceUrlError) {
      errors.sourceUrl = sourceUrlError;
    }

    const imageUrlError = validateUrl(newRecipeForm.imageUrl.trim());
    if (imageUrlError) {
      errors.imageUrl = imageUrlError;
    }

    const ingredients = parseList(newRecipeForm.ingredients);
    if (shouldRequireIngredients && ingredients.length === 0) {
      errors.ingredients = 'Add at least one ingredient or clear the source URL.';
    }

    const mealTypes = Array.from(
      new Set(
        parseList(newRecipeForm.mealTypes)
          .map((type) => type.toLowerCase())
          .filter((type) => type && type !== 'snack')
      )
    );

    const steps = parseList(newRecipeForm.steps, { allowComma: false });

    let durationMinutes = null;
    if (newRecipeForm.durationMinutes) {
      const parsedMinutes = Number(newRecipeForm.durationMinutes);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
        errors.durationMinutes = 'Enter a positive number.';
      } else {
        durationMinutes = parsedMinutes;
      }
    }

    if (Object.keys(errors).length > 0) {
      setNewRecipeErrors(errors);
      return;
    }

    const resolvedImageUrl = resolveRecipeImageUrl(title, newRecipeForm.imageUrl);

    const newRecipe = {
      id: `recipe-${Date.now()}`,
      title,
      sourceUrl: newRecipeForm.sourceUrl.trim(),
      imageUrl: resolvedImageUrl,
      mealTypes,
      ingredients,
      steps: steps.length > 0 ? steps : null,
      durationMinutes
    };

    setRecipes((prev) => [newRecipe, ...prev]);
    setSelectedMealType('');
    setIngredientInput('');
    setVisibleCount(RESULTS_PAGE_SIZE);
    setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
    setNewRecipeErrors({});
    setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
    setIsAddDialogOpen(false);
    setSnackbarState({
      open: true,
      message: `Added "${newRecipe.title}".`,
      severity: 'success'
    });
  };

  return (
    <>
      <AppBar position="static" color="inherit" elevation={0}>
        <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            ReciFind
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button color="secondary" variant="outlined" onClick={openAddDialog}>
              Add recipe
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" disableGutters>
        <Box
          sx={{
            px: { xs: 2, sm: 3, md: 4 },
            py: { xs: 3, md: 4 }
          }}
        >
          <Stack spacing={3}>
            <Stack spacing={3}>
              <Box sx={{ position: 'relative' }}>
                <TextField
                  label="Search by ingredients"
                  placeholder="e.g., chicken, garlic, spinach"
                  value={ingredientInput}
                  onChange={handleIngredientInputChange}
                  onFocus={() => {
                    setIngredientInputFocused(true);
                    setIngredientInputKeyCount(0);
                  }}
                  onBlur={() => setIngredientInputFocused(false)}
                  fullWidth
                  InputProps={{
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
                          onClick={() => handleIngredientSuggestionSelect(suggestion)}
                        >
                          <ListItemText primary={ingredientSuggestionFormatter(suggestion)} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Paper>
                )}
              </Box>

              {availableMealTypes.length > 0 && (
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
              )}

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
                  Try switching to <strong>Match any</strong>, remove filters, or adjust your search terms.
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  width: '100%',
                  display: 'grid',
                  justifyItems: 'stretch',
                  justifyContent: 'center',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    md: 'repeat(3, minmax(0, 1fr))',
                    lg: 'repeat(4, minmax(0, 1fr))'
                  },
                  gap: { xs: 1.5, sm: 2, md: 3 }
                }}
              >
                {displayedRecipes.map((recipe) => {
                  const displayImageUrl = resolveRecipeImageUrl(recipe.title, recipe.imageUrl);
                  return (
                    <Card
                      key={recipe.id}
                      elevation={1}
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 2,
                        overflow: 'hidden'
                      }}
                    >
                      <CardActionArea
                        onClick={() => handleOpenRecipeDetails(recipe)}
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          width: '100%'
                        }}
                      >
                        <Box
                          role="button"
                          aria-label={`Play ${recipe.title} video`}
                          onClick={(event) => handleVideoThumbnailClick(event, recipe)}
                          sx={{
                            position: 'relative',
                            width: '100%',
                            aspectRatio: '4 / 3',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            borderTopLeftRadius: 8,
                            borderTopRightRadius: 8,
                            '&:hover .play-overlay': { opacity: 1 }
                          }}
                        >
                          <Box
                            component="img"
                            src={displayImageUrl}
                            alt={recipe.title || 'Recipe preview'}
                            onError={createImageFallbackHandler(recipe.title)}
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
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
                  );
                })}
              </Box>
            )}
            <Box ref={sentinelRef} sx={{ height: 1 }} />
          </Stack>
        </Box>
      </Container>

      <Dialog
        open={Boolean(activeRecipeView)}
        onClose={closeDialog}
        fullWidth
        maxWidth="md"
        aria-labelledby="recipe-dialog-title"
      >
        {activeRecipeView && (
          <>
            <DialogTitle id="recipe-dialog-title" sx={{ display: 'flex', alignItems: 'center', pr: 6 }}>
              <Box sx={{ flexGrow: 1 }}>
                <TextField
                  label="Title"
                  value={activeRecipeView.title}
                  onChange={(event) => {
                    const value = event.target.value;
                    setActiveRecipeDraft((prev) => (prev ? { ...prev, title: value } : prev));
                  }}
                  fullWidth
                  margin="dense"
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                  {activeRecipeView.mealTypes.map((type) => (
                    <Chip key={type} label={MEAL_TYPE_LABELS[type] || type} size="small" variant="outlined" />
                  ))}
                  {activeRecipeView.durationMinutes ? (
                    <Chip
                      icon={<AccessTimeIcon fontSize="small" />}
                      label={`${activeRecipeView.durationMinutes} min`}
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
              {activeRecipeImageUrl && (
                <Box
                  role="button"
                  aria-label={`Open ${activeRecipeView.title} on Instagram`}
                  tabIndex={0}
                  onClick={(event) => handleVideoThumbnailClick(event, activeRecipeView)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      handleVideoThumbnailClick(event, activeRecipeView);
                    }
                  }}
                  sx={{
                    position: 'relative',
                    width: '100%',
                    borderRadius: 2,
                    overflow: 'hidden',
                    height: { xs: 200, md: 280 },
                    mb: 3,
                    cursor: 'pointer',
                    '&:hover .dialog-play-overlay': { opacity: 1 }
                  }}
                >
                  <Box
                    component="img"
                    src={activeRecipeImageUrl}
                    alt={activeRecipeView.title}
                    onError={createImageFallbackHandler(activeRecipeView.title)}
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  <Box
                    className="dialog-play-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      color: 'common.white',
                      background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.55) 100%)',
                      opacity: 0,
                      transition: 'opacity 200ms ease'
                    }}
                  >
                    <PlayCircleOutlineIcon fontSize="large" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Open on Instagram
                    </Typography>
                  </Box>
                </Box>
              )}

              <Stack spacing={3}>
                <Box>
                  <TextField
                    label="Ingredients"
                    value={activeRecipeView.ingredients.join('\n')}
                    onChange={(event) => {
                      const updated = event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, ingredients: updated } : prev));
                    }}
                    multiline
                    minRows={4}
                    fullWidth
                    helperText="One ingredient per line."
                  />
                </Box>

                <Box>
                  <TextField
                    label="Steps"
                    value={(activeRecipeView.steps || []).join('\n')}
                    onChange={(event) => {
                      const updated = event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, steps: updated } : prev));
                    }}
                    multiline
                    minRows={4}
                    fullWidth
                    helperText="Separate each step with a new line."
                  />
                </Box>

                {activeRecipeView.sourceUrl && (
                  <Box>
                    <Link href={activeRecipeView.sourceUrl} target="_blank" rel="noopener" underline="hover">
                      View source
                    </Link>
                  </Box>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'flex-end', gap: 1 }}>
              <Button
                onClick={openDeleteConfirm}
                color="error"
                startIcon={<DeleteOutlineIcon />}
                variant="outlined"
              >
                Delete
              </Button>
              <Button variant="contained" color="primary" onClick={handleSaveActiveRecipe} disabled={!activeRecipeDraft}>
                Save
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog
        open={isDeleteConfirmOpen}
        onClose={closeDeleteConfirm}
        aria-labelledby="delete-recipe-dialog-title"
      >
        <DialogTitle id="delete-recipe-dialog-title">Delete recipe?</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Are you sure you want to delete{' '}
            <Typography component="span" variant="body1" sx={{ fontWeight: 600 }}>
              {activeRecipeDraft?.title || activeRecipe?.title || 'this recipe'}
            </Typography>
            ? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteConfirm}>Cancel</Button>
          <Button onClick={handleDeleteRecipe} variant="contained" color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isAddDialogOpen}
        onClose={closeAddDialog}
        fullWidth
        maxWidth="sm"
        aria-labelledby="add-recipe-dialog-title"
        component="form"
        onSubmit={handleAddRecipeSubmit}
      >
        <DialogTitle id="add-recipe-dialog-title">Add recipe</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Source URL"
            value={newRecipeForm.sourceUrl}
            onChange={handleNewRecipeChange('sourceUrl')}
            required
            fullWidth
            placeholder="https://example.com/recipe"
            error={Boolean(newRecipeErrors.sourceUrl)}
            helperText={
              newRecipeErrors.sourceUrl ||
              sourceParseState.message ||
              'Link to the original recipe or video.'
            }
          />
          <TextField
            label="Title"
            value={newRecipeForm.title}
            onChange={handleNewRecipeChange('title')}
            required
            fullWidth
            error={Boolean(newRecipeErrors.title)}
            helperText={newRecipeErrors.title}
          />
          <Stack spacing={1}>
            <TextField
              label="Image URL"
              value={newRecipeForm.imageUrl}
              onChange={handleNewRecipeChange('imageUrl')}
              fullWidth
              placeholder="https://example.com/photo.jpg"
              error={Boolean(newRecipeErrors.imageUrl)}
              helperText={
                newRecipeErrors.imageUrl || 'Optional preview image. Use Generate to create a placeholder.'
              }
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Button type="button" size="small" onClick={handleGenerateImage}>
                      Generate
                    </Button>
                  </InputAdornment>
                )
              }}
            />
            {newRecipePreviewImageUrl ? (
              <Box
                sx={{
                  width: '100%',
                  height: 180,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden'
                }}
              >
                <Box
                  component="img"
                  src={newRecipePreviewImageUrl}
                  alt={newRecipeForm.title ? `${newRecipeForm.title} preview` : 'Recipe preview'}
                  onError={createImageFallbackHandler(newRecipeForm.title)}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Box>
            ) : null}
          </Stack>
          <TextField
            label="Meal types"
            value={newRecipeForm.mealTypes}
            onChange={handleNewRecipeChange('mealTypes')}
            fullWidth
            placeholder="e.g., breakfast, dinner"
            helperText="Comma-separated list. Use breakfast, lunch, dinner, dessert, etc."
          />
          <TextField
            label="Ingredients"
            value={newRecipeForm.ingredients}
            onChange={handleNewRecipeChange('ingredients')}
            required={shouldRequireIngredients}
            fullWidth
            multiline
            minRows={3}
            placeholder="One ingredient per line or comma-separated."
            error={Boolean(newRecipeErrors.ingredients)}
            helperText={ingredientsHelperText}
          />
          <TextField
            label="Steps"
            value={newRecipeForm.steps}
            onChange={handleNewRecipeChange('steps')}
            fullWidth
            multiline
            minRows={3}
            placeholder={shouldRequireSteps ? 'Separate steps with new lines.' : 'Optional instructions. Separate steps with new lines.'}
            error={Boolean(newRecipeErrors.steps)}
            helperText={stepsHelperText}
          />
          <TextField
            label="Duration (minutes)"
            value={newRecipeForm.durationMinutes}
            onChange={handleNewRecipeChange('durationMinutes')}
            fullWidth
            inputMode="numeric"
            placeholder="e.g., 25"
            error={Boolean(newRecipeErrors.durationMinutes)}
            helperText={newRecipeErrors.durationMinutes}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save recipe
          </Button>
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
