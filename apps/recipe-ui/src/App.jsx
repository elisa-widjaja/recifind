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
  CircularProgress,
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
  Typography,
  Menu,
  MenuItem,
  ListItemIcon
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ClearIcon from '@mui/icons-material/Clear';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { createClient } from '@supabase/supabase-js';
import recipesData from '../recipes.json';
import recipesFromPdfData from '../recipes_from_pdf.json';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');
const DEV_API_TOKEN = import.meta.env.VITE_RECIPES_API_TOKEN || '';

// Log version on load to bust cache
console.log('ReciFind v2024.12.02.1');

// localStorage cache key for recipes
const RECIPES_CACHE_KEY = 'recifind-recipes-cache';

function loadRecipesFromCache(userId) {
  try {
    const cached = localStorage.getItem(RECIPES_CACHE_KEY);
    if (!cached) return null;
    const data = JSON.parse(cached);
    // Only return cache if it matches the current user (or no user for anonymous)
    if (data.userId === userId) {
      return {
        recipes: data.recipes,
        version: data.version ?? 0
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function saveRecipesToCache(recipes, userId, version = 0) {
  try {
    localStorage.setItem(RECIPES_CACHE_KEY, JSON.stringify({
      userId,
      recipes,
      version,
      timestamp: Date.now()
    }));
  } catch (error) {
    // Ignore storage errors
  }
}

function clearRecipesCache() {
  try {
    localStorage.removeItem(RECIPES_CACHE_KEY);
  } catch (error) {
    // Ignore
  }
}

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        storageKey: 'recifind-auth',
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

async function callRecipesApi(path, init = {}, token = null) {
  if (!API_BASE_URL) {
    throw new Error('Recipes API base URL is not configured.');
  }
  const endpoint = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const headers = new Headers(init.headers || undefined);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Use session token if provided, otherwise fall back to DEV_API_TOKEN
  const authToken = token || DEV_API_TOKEN;
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const response = await fetch(endpoint, { ...init, headers });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = null;
    }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.error ? payload.error : 'Request failed.';
    throw new Error(message);
  }
  return payload;
}

function normalizeRecipeFromApi(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  if (API_BASE_URL && recipe.imagePath && (!recipe.imageUrl || recipe.imageUrl.startsWith('/'))) {
    return {
      ...recipe,
      imageUrl: `${API_BASE_URL}${recipe.imagePath}`
    };
  }
  return recipe;
}

async function createPreviewImagePayloadFromUrl(imageValue) {
  if (typeof imageValue !== 'string') {
    return null;
  }
  const trimmed = imageValue.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('data:')) {
    return { dataUrl: trimmed };
  }
  // For relative paths, fetch the image and convert to base64
  if (trimmed.startsWith('/')) {
    try {
      const response = await fetch(trimmed);
      if (!response.ok) {
        console.warn('Failed to fetch local image:', trimmed);
        return null;
      }
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({ dataUrl: reader.result });
        };
        reader.onerror = () => {
          console.warn('Failed to read image as data URL:', trimmed);
          resolve(null);
        };
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('Error fetching local image:', error);
      return null;
    }
  }
  return { url: trimmed };
}

async function buildApiRecipePayload(recipe, { includePreviewImage = false } = {}) {
  if (!recipe) {
    return {};
  }
  const mealTypes = Array.isArray(recipe.mealTypes) ? recipe.mealTypes : [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const payload = {
    title: recipe.title || '',
    sourceUrl: recipe.sourceUrl || '',
    imageUrl: recipe.imageUrl || '',
    mealTypes,
    ingredients,
    steps,
    durationMinutes:
      typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes) && recipe.durationMinutes > 0
        ? Math.round(recipe.durationMinutes)
        : null,
    notes: recipe.notes || ''
  };
  if (includePreviewImage) {
    const previewPayload = await createPreviewImagePayloadFromUrl(payload.imageUrl);
    if (previewPayload) {
      payload.previewImage = previewPayload;
    }
  }
  return payload;
}

const MEAL_TYPE_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  dessert: 'Dessert',
  appetizer: 'Appetizer'
};

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'dessert', 'appetizer'];
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

      // Extract image from JSON-LD
      let imageUrl = '';
      if (recipeNode.image) {
        if (typeof recipeNode.image === 'string') {
          imageUrl = recipeNode.image;
        } else if (Array.isArray(recipeNode.image) && recipeNode.image.length > 0) {
          imageUrl = typeof recipeNode.image[0] === 'string' ? recipeNode.image[0] : recipeNode.image[0]?.url || '';
        } else if (recipeNode.image.url) {
          imageUrl = recipeNode.image.url;
        }
      }

      return {
        title,
        ingredients,
        steps,
        imageUrl
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
  const fallbackImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
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
    steps,
    imageUrl: fallbackImage.trim()
  };
}

async function fetchRecipeDetailsFromSource(sourceUrl, { signal, token } = {}) {
  if (!API_BASE_URL || !sourceUrl) {
    return null;
  }
  const response = await callRecipesApi('/recipes/parse', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl }),
    signal
  }, token);
  const parsed = response?.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients.filter((item) => typeof item === 'string' && item.trim()) : [];
  const steps = Array.isArray(parsed.steps) ? parsed.steps.filter((step) => typeof step === 'string' && step.trim()) : [];
  const mealTypes = Array.isArray(parsed.mealTypes) ? parsed.mealTypes.filter((type) => typeof type === 'string' && type.trim()) : [];
  const durationMinutes =
    typeof parsed.durationMinutes === 'number' && Number.isFinite(parsed.durationMinutes)
      ? Math.max(0, Math.round(parsed.durationMinutes))
      : null;
  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
    ingredients,
    steps,
    mealTypes,
    durationMinutes,
    imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl.trim() : ''
  };
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

// Load cache for initial render (before auth is known)
function loadInitialCache() {
  try {
    const cached = localStorage.getItem(RECIPES_CACHE_KEY);
    if (!cached) return null;
    const data = JSON.parse(cached);
    if (data.recipes && Array.isArray(data.recipes)) {
      return {
        recipes: data.recipes,
        version: data.version ?? 0,
        userId: data.userId
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function App() {
  // Use window width directly for reliable mobile detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 600;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 600);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isRemoteEnabled = Boolean(API_BASE_URL);
  // Don't load cache yet - wait for auth to determine which user's cache to use
  const [recipes, setRecipes] = useState(() => {
    if (!isRemoteEnabled) return INITIAL_RECIPES;
    return []; // Start empty, will load after auth check
  });
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
  const [isActiveRecipeEnhancing, setIsActiveRecipeEnhancing] = useState(false);
  const [isNewRecipeEnhancing, setIsNewRecipeEnhancing] = useState(false);
  const [ingredientInputFocused, setIngredientInputFocused] = useState(false);
  const [ingredientInputKeyCount, setIngredientInputKeyCount] = useState(0);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [snackbarState, setSnackbarState] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const sentinelRef = useRef(null);
  const lastParseResultRef = useRef({ url: '', status: '' });
  const RESULTS_PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [remoteState, setRemoteState] = useState(() => ({
    status: isRemoteEnabled ? 'loading' : 'disabled',
    message: ''
  }));
  const [hasNewRecipes, setHasNewRecipes] = useState(false);

  // Auth state
  const [session, setSession] = useState(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [accountMenuAnchor, setAccountMenuAnchor] = useState(null);

  // Get access token from session
  const accessToken = session?.access_token || null;

  // Initialize auth state on mount
  useEffect(() => {
    if (!supabase) {
      setIsAuthChecked(true);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthChecked(true);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSendMagicLink = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setAuthError('Authentication is not configured.');
      return;
    }

    const email = authEmail.trim();
    if (!email) {
      setAuthError('Please enter your email address.');
      return;
    }

    setIsAuthLoading(true);
    setAuthError('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin
        }
      });

      if (error) throw error;

      setIsAuthDialogOpen(false);
      setAuthEmail('');
      setSnackbarState({
        open: true,
        message: 'Check your email for a magic link to sign in.',
        severity: 'success'
      });
    } catch (error) {
      setAuthError(error.message || 'Failed to send magic link.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;

    setAccountMenuAnchor(null);
    clearRecipesCache();
    setRecipes([]);
    setHasNewRecipes(false);
    pendingRecipesRef.current = null;
    await supabase.auth.signOut();
    setSnackbarState({
      open: true,
      message: 'Logged out.',
      severity: 'info'
    });
  };

  const handleAccountMenuOpen = (event) => {
    setAccountMenuAnchor(event.currentTarget);
  };

  const handleAccountMenuClose = () => {
    setAccountMenuAnchor(null);
  };

  const handleCopyUserId = () => {
    const userId = session?.user?.id;
    if (userId) {
      navigator.clipboard.writeText(userId);
      setSnackbarState({
        open: true,
        message: 'User ID copied to clipboard.',
        severity: 'success'
      });
    }
    setAccountMenuAnchor(null);
  };

  const openAuthDialog = () => {
    setAuthEmail('');
    setAuthError('');
    setIsAuthDialogOpen(true);
  };

  const closeAuthDialog = () => {
    setIsAuthDialogOpen(false);
    setAuthEmail('');
    setAuthError('');
  };

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

        const createdAt = recipe.createdAt ? new Date(recipe.createdAt).getTime() : 0;
        const score = ingredientScore + (selectedMealType ? 1 : 0);
        return { recipe, score, createdAt };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.createdAt - a.createdAt;
      })
      .map((entry) => entry.recipe);

    return scored;
  }, [recipes, selectedMealType, normalizedIngredients]);

  const pendingRecipesRef = useRef(null);

  const fetchAllRecipes = useCallback(async () => {
    const response = await callRecipesApi('/recipes', {}, accessToken);
    return Array.isArray(response?.recipes)
      ? response.recipes.map((recipe) => normalizeRecipeFromApi(recipe)).filter(Boolean)
      : [];
  }, [accessToken]);

  const serverVersionRef = useRef(0);

  const syncRecipesFromApi = useCallback(async ({ forceUpdate = false } = {}) => {
    if (!isRemoteEnabled) {
      return;
    }

    const userId = session?.user?.id || null;

    // If not logged in, show default recipes
    if (!userId) {
      setRecipes(INITIAL_RECIPES);
      setRemoteState({ status: 'disabled', message: '' });
      return;
    }

    // If not forcing update, check if we can use cached data
    if (!forceUpdate) {
      const cached = loadRecipesFromCache(userId);

      if (cached && cached.recipes.length > 0) {
        // Show cached recipes immediately
        setRecipes(cached.recipes);
        setRemoteState({ status: 'checking', message: '' });

        // Do lightweight version check instead of fetching all recipes
        try {
          const metaResponse = await callRecipesApi('/recipes/count', {}, accessToken);
          const serverVersion = metaResponse?.version ?? 0;
          serverVersionRef.current = serverVersion;

          if (serverVersion !== cached.version) {
            // Version differs - fetch and auto-apply to sync cache
            const normalized = await fetchAllRecipes();
            setRecipes(normalized);
            saveRecipesToCache(normalized, userId, serverVersion);
            setRemoteState({ status: 'success', message: '' });
          } else {
            // Same version - cache is up to date
            setRemoteState({ status: 'success', message: '' });
          }
        } catch (error) {
          console.error(error);
          setRemoteState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to check for updates.'
          });
        }
        return;
      } else {
        setRemoteState({ status: 'loading', message: '' });
      }
    } else {
      setRemoteState({ status: 'loading', message: '' });
      setHasNewRecipes(false);
    }

    // No cache or forced update - fetch all recipes
    try {
      // Get current version first
      const metaResponse = await callRecipesApi('/recipes/count', {}, accessToken);
      const serverVersion = metaResponse?.version ?? 0;
      serverVersionRef.current = serverVersion;

      const normalized = await fetchAllRecipes();
      setRecipes(normalized);
      saveRecipesToCache(normalized, userId, serverVersion);
      pendingRecipesRef.current = null;
      setHasNewRecipes(false);
      setRemoteState({
        status: 'success',
        message:
          normalized.length === 1
            ? 'Loaded 1 recipe.'
            : `Loaded ${normalized.length} recipes.`
      });
    } catch (error) {
      console.error(error);
      setRemoteState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to sync recipes.'
      });
    }
  }, [isRemoteEnabled, accessToken, session, fetchAllRecipes]);

  const applyPendingRecipes = useCallback(() => {
    if (pendingRecipesRef.current) {
      const userId = session?.user?.id || null;
      const { recipes: newRecipes, version } = pendingRecipesRef.current;
      setRecipes(newRecipes);
      saveRecipesToCache(newRecipes, userId, version);
      setHasNewRecipes(false);
      setRemoteState({
        status: 'success',
        message: `Loaded ${newRecipes.length} recipes.`
      });
      pendingRecipesRef.current = null;
    }
  }, [session]);

  useEffect(() => {
    if (!isRemoteEnabled) {
      return;
    }
    // Wait for auth to be checked before syncing to avoid flicker
    if (!isAuthChecked) {
      return;
    }
    syncRecipesFromApi();
  }, [isRemoteEnabled, isAuthChecked, syncRecipesFromApi]);

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
  const remoteStatusMessage =
    remoteState.status === 'loading'
      ? 'Syncing recipes…'
      : remoteState.status === 'success' || remoteState.status === 'error'
      ? remoteState.message
      : '';
  const remoteStatusColor = remoteState.status === 'error' ? 'error' : 'text.secondary';

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

  const handleDeleteRecipe = async () => {
    if (!activeRecipe) {
      return;
    }

    const deletedTitle = activeRecipe.title;
    const deletedId = activeRecipe.id;

    if (isRemoteEnabled) {
      try {
        await callRecipesApi(`/recipes/${encodeURIComponent(deletedId)}`, { method: 'DELETE' }, accessToken);
      } catch (error) {
        console.error(error);
        setSnackbarState({
          open: true,
          message: error instanceof Error ? error.message : 'Unable to delete recipe.',
          severity: 'error'
        });
        return;
      }
    }

    setRecipes((prev) => {
      const updated = prev.filter((recipe) => recipe.id !== deletedId);
      const userId = session?.user?.id || null;
      saveRecipesToCache(updated, userId, serverVersionRef.current);
      return updated;
    });
    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
    setSnackbarState({
      open: true,
      message: `Deleted "${deletedTitle}".`,
      severity: 'info'
    });
  };

  const handleSaveActiveRecipe = async () => {
    if (!activeRecipe || !activeRecipeDraft) {
      closeDialog();
      return;
    }

    const normalizedIngredients = Array.isArray(activeRecipeDraft.ingredients)
      ? activeRecipeDraft.ingredients
      : [];
    const normalizedSteps = Array.isArray(activeRecipeDraft.steps) ? activeRecipeDraft.steps : [];
    const updatedRecipe = {
      ...activeRecipe,
      ...activeRecipeDraft,
      ingredients: normalizedIngredients,
      steps: normalizedSteps
    };

    if (isRemoteEnabled) {
      try {
        const payload = await buildApiRecipePayload(updatedRecipe);
        const response = await callRecipesApi(`/recipes/${encodeURIComponent(activeRecipe.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        }, accessToken);
        const savedRecipe = normalizeRecipeFromApi(response?.recipe) || updatedRecipe;
        setRecipes((prev) => {
          const updated = prev.map((recipe) => (recipe.id === activeRecipe.id ? savedRecipe : recipe));
          const userId = session?.user?.id || null;
          saveRecipesToCache(updated, userId, serverVersionRef.current);
          return updated;
        });
      } catch (error) {
        console.error(error);
        setSnackbarState({
          open: true,
          message: error instanceof Error ? error.message : 'Unable to save recipe.',
          severity: 'error'
        });
        return;
      }
    } else {
      setRecipes((prev) => {
        const updated = prev.map((recipe) => (recipe.id === activeRecipe.id ? updatedRecipe : recipe));
        const userId = session?.user?.id || null;
        saveRecipesToCache(updated, userId, serverVersionRef.current);
        return updated;
      });
    }

    setSnackbarState({
      open: true,
      message: `Saved "${activeRecipeDraft.title}".`,
      severity: 'success'
    });

    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
  };

  const handleEnhanceActiveRecipe = useCallback(async () => {
    if (!activeRecipeDraft) {
      return;
    }
    const sourceUrl = activeRecipeDraft.sourceUrl?.trim();
    if (!sourceUrl) {
      setSnackbarState({
        open: true,
        message: 'Add a source URL before enhancing with AI.',
        severity: 'warning'
      });
      return;
    }
    if (!isRemoteEnabled) {
      setSnackbarState({
        open: true,
        message: 'Connect to your workspace to enhance recipes with AI.',
        severity: 'info'
      });
      return;
    }

    setIsActiveRecipeEnhancing(true);
    try {
      const response = await callRecipesApi('/recipes/enrich', {
        method: 'POST',
        body: JSON.stringify({ sourceUrl, title: activeRecipeDraft.title })
      }, accessToken);
      const enriched = response?.enriched;
      if (!enriched) {
        throw new Error('Unable to enhance this recipe right now.');
      }

      setActiveRecipeDraft((prev) => {
        if (!prev) {
          return prev;
        }
        const next = { ...prev };
        let changed = false;

        if ((!next.title || !next.title.trim()) && enriched.title) {
          next.title = enriched.title;
          changed = true;
        }

        if (Array.isArray(enriched.ingredients) && enriched.ingredients.length > 0) {
          if (!Array.isArray(next.ingredients) || next.ingredients.length === 0) {
            next.ingredients = [...enriched.ingredients];
            changed = true;
          }
        }

        if (Array.isArray(enriched.steps) && enriched.steps.length > 0) {
          if (!Array.isArray(next.steps) || next.steps.length === 0) {
            next.steps = [...enriched.steps];
            changed = true;
          }
        }

        if (Array.isArray(enriched.mealTypes) && enriched.mealTypes.length > 0) {
          if (!Array.isArray(next.mealTypes) || next.mealTypes.length === 0) {
            next.mealTypes = [...enriched.mealTypes];
            changed = true;
          }
        }

        if (!next.durationMinutes && typeof enriched.durationMinutes === 'number') {
          next.durationMinutes = enriched.durationMinutes;
          changed = true;
        }

        // Update image if missing or using placeholder SVG
        const hasPlaceholderImage = next.imageUrl && next.imageUrl.startsWith('data:image/svg');
        if ((!next.imageUrl || !next.imageUrl.trim() || hasPlaceholderImage) && enriched.imageUrl) {
          next.imageUrl = enriched.imageUrl;
          changed = true;
        }

        if ((!next.notes || !next.notes.trim()) && enriched.notes) {
          next.notes = enriched.notes;
          changed = true;
        }

        return changed ? next : prev;
      });

      setSnackbarState({
        open: true,
        message: 'AI suggestions added. Review and save to keep changes.',
        severity: 'info'
      });
    } catch (error) {
      console.error('Unable to enhance recipe with AI.', error);
      setSnackbarState({
        open: true,
        message: error instanceof Error ? error.message : 'Unable to enhance this recipe.',
        severity: 'error'
      });
    } finally {
      setIsActiveRecipeEnhancing(false);
    }
  }, [activeRecipeDraft, isRemoteEnabled]);

  const handleEnhanceNewRecipe = async () => {
    if (!isRemoteEnabled) {
      setSnackbarState({
        open: true,
        message: 'Connect to your workspace to enhance recipes.',
        severity: 'info'
      });
      return;
    }

    const sourceUrl = newRecipeForm.sourceUrl.trim();
    const title = newRecipeForm.title.trim();
    const sourceError = validateUrl(sourceUrl, { required: true });
    if (sourceError) {
      setNewRecipeErrors((prev) => ({ ...prev, sourceUrl: sourceError }));
      setSourceParseState({ status: 'error', message: sourceError });
      return;
    }

    setIsNewRecipeEnhancing(true);
    try {
      const response = await callRecipesApi('/recipes/enrich', {
        method: 'POST',
        body: JSON.stringify({ sourceUrl, title })
      }, accessToken);
      const result = response?.enriched;
      if (!result) {
        throw new Error('Unable to enhance this recipe right now.');
      }

      const patchedFlags = {
        title: false,
        ingredients: false,
        steps: false,
        mealTypes: false,
        durationMinutes: false,
        imageUrl: false
      };

      setNewRecipeForm((prev) => {
        const next = { ...prev };

        if ((!next.title || !next.title.trim()) && result.title) {
          next.title = result.title;
          patchedFlags.title = true;
        }

        if (
          (!next.ingredients || !next.ingredients.trim()) &&
          Array.isArray(result.ingredients) &&
          result.ingredients.length > 0
        ) {
          next.ingredients = result.ingredients.join('\n');
          patchedFlags.ingredients = true;
        }

        if ((!next.steps || !next.steps.trim()) && Array.isArray(result.steps) && result.steps.length > 0) {
          next.steps = result.steps.join('\n');
          patchedFlags.steps = true;
        }

        if (
          (!next.mealTypes || !next.mealTypes.trim()) &&
          Array.isArray(result.mealTypes) &&
          result.mealTypes.length > 0
        ) {
          next.mealTypes = result.mealTypes.join(', ');
          patchedFlags.mealTypes = true;
        }

        if (
          !next.durationMinutes &&
          typeof result.durationMinutes === 'number' &&
          Number.isFinite(result.durationMinutes) &&
          result.durationMinutes > 0
        ) {
          next.durationMinutes = String(result.durationMinutes);
          patchedFlags.durationMinutes = true;
        }

        if ((!next.imageUrl || !next.imageUrl.trim()) && result.imageUrl) {
          next.imageUrl = result.imageUrl;
          patchedFlags.imageUrl = true;
        }

        return next;
      });

      setNewRecipeErrors((prev) => {
        if (!prev || Object.keys(prev).length === 0) {
          return prev;
        }
        const next = { ...prev };
        if (patchedFlags.title) {
          delete next.title;
        }
        if (patchedFlags.ingredients) {
          delete next.ingredients;
        }
        if (patchedFlags.steps) {
          delete next.steps;
        }
        if (patchedFlags.mealTypes) {
          delete next.mealTypes;
        }
        if (patchedFlags.durationMinutes) {
          delete next.durationMinutes;
        }
        if (patchedFlags.imageUrl) {
          delete next.imageUrl;
        }
        return Object.keys(next).length === 0 ? {} : next;
      });

      setSourceParseState({ status: 'success', message: 'Recipe enhanced.' });
      setNewRecipePrefillInfo((prev) => ({
        matched: true,
        hasIngredients: prev.hasIngredients || Boolean(result.ingredients?.length),
        hasSteps: prev.hasSteps || Boolean(result.steps?.length)
      }));
      setSnackbarState({
        open: true,
        message: 'Enhancement applied. Review before saving.',
        severity: 'success'
      });
    } catch (error) {
      console.error('Unable to enhance recipe with AI.', error);
      setSnackbarState({
        open: true,
        message: error instanceof Error ? error.message : 'Unable to enhance this recipe.',
        severity: 'error'
      });
    } finally {
      setIsNewRecipeEnhancing(false);
    }
  };

  const closeDialog = () => {
    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
  };

  const openAddDialog = () => {
    // Require authentication to add recipes
    console.log('openAddDialog check:', { supabase: !!supabase, DEV_API_TOKEN: !!DEV_API_TOKEN, isAuthChecked, hasSession: !!session });
    if (supabase && !DEV_API_TOKEN) {
      if (!isAuthChecked || !session) {
        console.log('Redirecting to auth dialog');
        openAuthDialog();
        return;
      }
    }
    setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
    setNewRecipeErrors({});
    setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
    setSourceParseState({ status: 'idle', message: '' });
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

    // Convert relative image paths to full URLs
    let prefillImageUrl = matchedRecipe.imageUrl || '';
    if (prefillImageUrl && prefillImageUrl.startsWith('/')) {
      prefillImageUrl = `${window.location.origin}${prefillImageUrl}`;
    }

    let patchedTitle = false;
    let patchedIngredients = false;
    let patchedSteps = false;
    let patchedDuration = false;
    let patchedImage = false;

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

      if (!prev.imageUrl && prefillImageUrl) {
        next.imageUrl = prefillImageUrl;
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

    if (!isRemoteEnabled) {
      setSourceParseState({ status: 'idle', message: '' });
      return;
    }

    // Skip parsing if not authenticated
    if (!accessToken) {
      setSourceParseState({ status: 'idle', message: '' });
      return;
    }

    if (lastParseResultRef.current.url === sourceUrl && lastParseResultRef.current.status === 'success') {
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    setSourceParseState({ status: 'loading', message: 'Parsing recipe details…' });

    fetchRecipeDetailsFromSource(sourceUrl, { signal: controller.signal, token: accessToken })
      .then((localResult) => {
        if (!isActive) {
          return;
        }

        if (!localResult) {
          lastParseResultRef.current = { url: sourceUrl, status: 'error' };
          setSourceParseState({
            status: 'error',
            message: 'Unable to parse recipe from that link. Save now and enhance later.'
          });
          return;
        }

        lastParseResultRef.current = { url: sourceUrl, status: 'success' };

        setNewRecipeForm((prev) => {
          const next = { ...prev };
          let changed = false;

          if (!next.title && localResult.title) {
            next.title = localResult.title;
            changed = true;
          }
          if (localResult.imageUrl) {
            next.imageUrl = localResult.imageUrl;
            changed = true;
          }
          if ((!next.ingredients || !next.ingredients.trim()) && localResult.ingredients.length > 0) {
            next.ingredients = localResult.ingredients.join('\n');
            changed = true;
          }
          if ((!next.steps || !next.steps.trim()) && localResult.steps.length > 0) {
            next.steps = localResult.steps.join('\n');
            changed = true;
          }
          if ((!next.mealTypes || !next.mealTypes.trim()) && localResult.mealTypes.length > 0) {
            next.mealTypes = localResult.mealTypes.join(', ');
            changed = true;
          }
          if (!next.durationMinutes && typeof localResult.durationMinutes === 'number') {
            next.durationMinutes = String(localResult.durationMinutes);
            changed = true;
          }

          return changed ? next : prev;
        });

        setNewRecipeErrors((prev) => {
          if (!prev || Object.keys(prev).length === 0) {
            return prev;
          }
          return {};
        });

        const hasIngredients = Array.isArray(localResult.ingredients) && localResult.ingredients.length > 0;
        const hasSteps = Array.isArray(localResult.steps) && localResult.steps.length > 0;

        setNewRecipePrefillInfo((prev) => {
          const nextInfo = {
            matched:
              prev.matched ||
              Boolean(localResult.title || localResult.imageUrl || hasIngredients || hasSteps),
            hasIngredients: prev.hasIngredients || hasIngredients,
            hasSteps: prev.hasSteps || hasSteps
          };
          if (
            nextInfo.matched === prev.matched &&
            nextInfo.hasIngredients === prev.hasIngredients &&
            nextInfo.hasSteps === prev.hasSteps
          ) {
            return prev;
          }
          return nextInfo;
        });

        if (hasIngredients || hasSteps) {
          setSourceParseState({ status: 'success', message: 'Recipe details parsed from source.' });
        } else if (localResult.title || localResult.imageUrl) {
          setSourceParseState({
            status: 'success',
            message: 'Recipe title and preview parsed. Add details manually or enhance later.'
          });
        } else {
          setSourceParseState({
            status: 'error',
            message: 'Unable to parse recipe from that link. Save now and enhance later.'
          });
        }
      })
      .catch((error) => {
        if (!isActive && error?.name === 'AbortError') {
          return;
        }
        console.error('Unable to parse recipe from URL.', error);
        if (isActive) {
          lastParseResultRef.current = { url: sourceUrl, status: 'error' };
          setSourceParseState({
            status: 'error',
            message: error?.message || 'Unable to parse recipe from that link. Save now and enhance later.'
          });
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [newRecipeForm.sourceUrl, isRemoteEnabled, accessToken]);

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

  const handleAddRecipeSubmit = async (event) => {
    event.preventDefault();

    // Check if user is authenticated
    if (supabase && !DEV_API_TOKEN && !session) {
      closeAddDialog();
      openAuthDialog();
      return;
    }

    const errors = {};

    const title = newRecipeForm.title.trim();
    if (!title) {
      errors.title = 'Title is required.';
    }

    const sourceUrlError = validateUrl(newRecipeForm.sourceUrl.trim(), { required: true });
    if (sourceUrlError) {
      errors.sourceUrl = sourceUrlError;
    }

    if (Object.keys(errors).length > 0) {
      setNewRecipeErrors(errors);
      return;
    }

    const sourceUrl = newRecipeForm.sourceUrl.trim();
    const imageUrl = newRecipeForm.imageUrl?.trim() || '';
    const mealTypes = newRecipeForm.mealTypes
      ? newRecipeForm.mealTypes.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const ingredients = newRecipeForm.ingredients
      ? newRecipeForm.ingredients.split('\n').map((i) => i.trim()).filter(Boolean)
      : [];
    const steps = newRecipeForm.steps
      ? newRecipeForm.steps.split('\n').map((s) => s.trim()).filter(Boolean)
      : [];
    const durationMinutes = newRecipeForm.durationMinutes
      ? parseInt(newRecipeForm.durationMinutes, 10) || null
      : null;

    const newRecipe = {
      id: `recipe-${Date.now()}`,
      title,
      sourceUrl,
      imageUrl,
      mealTypes,
      ingredients,
      steps: steps.length > 0 ? steps : null,
      durationMinutes
    };

    const resetFormState = (message) => {
      setSelectedMealType('');
      setIngredientInput('');
      setVisibleCount(RESULTS_PAGE_SIZE);
      setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
      setNewRecipeErrors({});
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      setIsAddDialogOpen(false);
      setSnackbarState({
        open: true,
        message,
        severity: 'success'
      });
    };

    if (isRemoteEnabled) {
      try {
        // Save the recipe with all parsed data
        const payload = await buildApiRecipePayload(newRecipe, { includePreviewImage: Boolean(imageUrl) });
        const response = await callRecipesApi('/recipes', {
          method: 'POST',
          body: JSON.stringify(payload)
        }, accessToken);
        const savedRecipe = normalizeRecipeFromApi(response?.recipe) || newRecipe;
        setRecipes((prev) => {
          const updated = [savedRecipe, ...prev.filter((recipe) => recipe.id !== savedRecipe.id)];
          const userId = session?.user?.id || null;
          saveRecipesToCache(updated, userId, serverVersionRef.current);
          return updated;
        });
        resetFormState(`Saved "${savedRecipe.title}".`);
        return;
      } catch (error) {
        console.error(error);
        setSnackbarState({
          open: true,
          message: error instanceof Error ? error.message : 'Unable to save recipe.',
          severity: 'error'
        });
        return;
      }
    }

    setRecipes((prev) => {
      const updated = [newRecipe, ...prev];
      const userId = session?.user?.id || null;
      saveRecipesToCache(updated, userId, serverVersionRef.current);
      return updated;
    });
    resetFormState(`Added "${newRecipe.title}".`);
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
            {supabase && (
              session ? (
                <>
                  <Tooltip title="Account">
                    <IconButton onClick={handleAccountMenuOpen} color="inherit">
                      <AccountCircleIcon />
                    </IconButton>
                  </Tooltip>
                  <Menu
                    anchorEl={accountMenuAnchor}
                    open={Boolean(accountMenuAnchor)}
                    onClose={handleAccountMenuClose}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  >
                    <Box sx={{ px: 2, py: 1.5, minWidth: 220 }}>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                        Email
                      </Typography>
                      <Typography variant="body2" noWrap>
                        {session.user?.email || 'Unknown'}
                      </Typography>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1.5, mb: 0.5 }}>
                        User ID
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {session.user?.id || 'Unknown'}
                      </Typography>
                    </Box>
                    <Divider />
                    <MenuItem onClick={handleCopyUserId}>
                      <ListItemIcon>
                        <ContentCopyIcon fontSize="small" />
                      </ListItemIcon>
                      Copy User ID
                    </MenuItem>
                    <MenuItem onClick={handleLogout}>
                      <ListItemIcon>
                        <LogoutIcon fontSize="small" />
                      </ListItemIcon>
                      Logout
                    </MenuItem>
                  </Menu>
                </>
              ) : (
                <Button color="primary" variant="text" onClick={openAuthDialog}>
                  Login
                </Button>
              )
            )}
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
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexGrow: 1 }}>
                  <Typography variant="body1" color="text.secondary">
                    {resultsLabel}
                  </Typography>
                  {isRemoteEnabled && (
                    <Tooltip title={hasNewRecipes ? 'Load new recipes' : 'Refresh recipes'}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (hasNewRecipes) {
                            applyPendingRecipes();
                          } else {
                            syncRecipesFromApi({ forceUpdate: true });
                          }
                        }}
                        disabled={remoteState.status === 'loading'}
                        sx={{
                          opacity: hasNewRecipes ? 1 : 0.6,
                          '&:hover': { opacity: 1 },
                          p: 0.5,
                          animation: hasNewRecipes ? 'pulse 1.5s ease-in-out infinite' : 'none',
                          '@keyframes pulse': {
                            '0%, 100%': {
                              transform: 'scale(1)',
                              color: 'inherit'
                            },
                            '50%': {
                              transform: 'scale(1.2)',
                              color: 'primary.main'
                            }
                          }
                        }}
                      >
                        <RefreshIcon
                          fontSize="small"
                          color={hasNewRecipes ? 'primary' : 'inherit'}
                          sx={{
                            animation: remoteState.status === 'loading' || remoteState.status === 'checking'
                              ? 'spin 1s linear infinite'
                              : 'none',
                            '@keyframes spin': {
                              '0%': { transform: 'rotate(0deg)' },
                              '100%': { transform: 'rotate(360deg)' }
                            }
                          }}
                        />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                {normalizedIngredients.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Showing recipes that include any of the ingredients you entered.
                  </Typography>
                )}
              </Stack>
            </Stack>

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
                          {recipe.mealTypes.length > 0 && (
                            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                              {recipe.mealTypes.map((type) => (
                                <Chip key={type} label={MEAL_TYPE_LABELS[type] || type} size="small" variant="outlined" />
                              ))}
                            </Stack>
                          )}
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
        fullScreen={isMobile}
        fullWidth={!isMobile}
        maxWidth={isMobile ? false : 'md'}
        aria-labelledby="recipe-dialog-title"
        slotProps={{
          backdrop: isMobile ? { sx: { backgroundColor: 'transparent' } } : {}
        }}
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
                  {MEAL_TYPE_ORDER.map((type) => {
                    const isSelected = activeRecipeView.mealTypes.includes(type);
                    return (
                      <Chip
                        key={type}
                        label={MEAL_TYPE_LABELS[type] || type}
                        size="small"
                        variant={isSelected ? 'filled' : 'outlined'}
                        color={isSelected ? 'primary' : 'default'}
                        onClick={() => {
                          setActiveRecipeDraft((prev) => {
                            if (!prev) return prev;
                            const currentTypes = prev.mealTypes || [];
                            const newTypes = isSelected
                              ? currentTypes.filter((t) => t !== type)
                              : [...currentTypes, type];
                            return { ...prev, mealTypes: newTypes };
                          });
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                    );
                  })}
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
                      const updated = event.target.value.split(/\r?\n/);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, ingredients: updated } : prev));
                    }}
                    onBlur={(event) => {
                      const cleaned = event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, ingredients: cleaned } : prev));
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
                      const updated = event.target.value.split(/\r?\n/);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, steps: updated } : prev));
                    }}
                    onBlur={(event) => {
                      const cleaned = event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      setActiveRecipeDraft((prev) => (prev ? { ...prev, steps: cleaned } : prev));
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
              {isRemoteEnabled && activeRecipeDraft?.sourceUrl && (
                <Button
                  onClick={handleEnhanceActiveRecipe}
                  variant="outlined"
                  color="secondary"
                  startIcon={
                    isActiveRecipeEnhancing ? (
                      <CircularProgress size={18} />
                    ) : (
                      <AutoAwesomeIcon fontSize="small" />
                    )
                  }
                  disabled={isActiveRecipeEnhancing}
                >
                  Enhance
                </Button>
              )}
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
        fullScreen={isMobile}
        fullWidth={!isMobile}
        maxWidth={isMobile ? false : 'sm'}
        aria-labelledby="add-recipe-dialog-title"
        component="form"
        onSubmit={handleAddRecipeSubmit}
        slotProps={{
          backdrop: isMobile ? { sx: { backgroundColor: 'transparent' } } : {}
        }}
      >
        <DialogTitle id="add-recipe-dialog-title">Add recipe</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
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
          {sourceParseState.status === 'loading' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {sourceParseState.message || 'Parsing recipe details...'}
              </Typography>
            </Box>
          )}
          {newRecipeForm.imageUrl && newRecipeForm.imageUrl.trim() && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box
                component="img"
                src={newRecipeForm.imageUrl}
                alt="Recipe preview"
                sx={{
                  maxWidth: '100%',
                  maxHeight: 200,
                  borderRadius: 1,
                  objectFit: 'cover'
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </Box>
          )}
          {newRecipeForm.mealTypes && newRecipeForm.mealTypes.trim() && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {newRecipeForm.mealTypes.split(',').map((type) => type.trim()).filter(Boolean).map((type) => (
                <Chip
                  key={type}
                  label={type.charAt(0).toUpperCase() + type.slice(1)}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
          )}
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

      <Dialog
        open={isAuthDialogOpen}
        onClose={closeAuthDialog}
        fullWidth
        maxWidth="xs"
        aria-labelledby="auth-dialog-title"
      >
        <DialogTitle id="auth-dialog-title">
          Sign in
        </DialogTitle>
        <DialogContent>
          <Box
            component="form"
            onSubmit={handleSendMagicLink}
            sx={{ pt: 1 }}
          >
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Enter your email and we'll send you a magic link to sign in.
              </Typography>
              {authError && (
                <Alert severity="error" onClose={() => setAuthError('')}>
                  {authError}
                </Alert>
              )}
              <TextField
                label="Email"
                type="email"
                value={authEmail}
                onChange={(e) => {
                  setAuthEmail(e.target.value);
                  setAuthError('');
                }}
                required
                fullWidth
                autoFocus
                placeholder="you@example.com"
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={isAuthLoading}
                startIcon={isAuthLoading ? <CircularProgress size={18} /> : null}
              >
                Send Magic Link
              </Button>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAuthDialog}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default App;
