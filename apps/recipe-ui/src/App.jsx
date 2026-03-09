import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
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
  ListItemIcon,
  Switch,
  FormControlLabel,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Badge,
  Tab,
  Tabs,
  Avatar,
  ListItem,
  ListItemAvatar,
  CssBaseline,
  Skeleton,
  createTheme,
  ThemeProvider
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ClearIcon from '@mui/icons-material/Clear';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import PeopleIcon from '@mui/icons-material/People';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SmsIcon from '@mui/icons-material/Sms';
import CheckIcon from '@mui/icons-material/Check';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import SoupKitchenOutlinedIcon from '@mui/icons-material/SoupKitchenOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import { createClient } from '@supabase/supabase-js';
import recipesData from '../recipes.json';
import recipesFromPdfData from '../recipes_from_pdf.json';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');
const DEV_API_TOKEN = import.meta.env.VITE_RECIPES_API_TOKEN || '';

// Log version on load to bust cache
console.log('ReciFind v2024.12.02.1');

// localStorage cache key for recipes
const RECIPES_CACHE_KEY = 'recifind-recipes-cache-v2';

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

// Capture accept_friend and invite_token URL params immediately at module load time.
{
  const _url = new URL(window.location.href);
  const _acceptId = _url.searchParams.get('accept_friend');
  if (_acceptId) {
    sessionStorage.setItem('pending_accept_friend', _acceptId);
    _url.searchParams.delete('accept_friend');
    window.history.replaceState({}, '', _url.toString());
  }
  const _inviteToken = _url.searchParams.get('invite_token');
  if (_inviteToken) {
    sessionStorage.setItem('pending_invite_token', _inviteToken);
    _url.searchParams.delete('invite_token');
    window.history.replaceState({}, '', _url.toString());
  }
  const _openInvite = _url.searchParams.get('invite');
  if (_openInvite) {
    sessionStorage.setItem('pending_open_invite', _openInvite);
    sessionStorage.setItem('invite_entry', '1');
    _url.searchParams.delete('invite');
    window.history.replaceState({}, '', _url.toString());
  }
  const _shareToken = _url.searchParams.get('share');
  if (_shareToken) {
    sessionStorage.setItem('pending_share_token', _shareToken);
    // Don't delete from URL — the share useEffect needs it to open the recipe dialog
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
    notes: recipe.notes || '',
    sharedWithFriends: Boolean(recipe.sharedWithFriends)
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
  durationMinutes: '',
  sharedWithFriends: true
};

function validateRecipesPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.recipes)) {
    throw new Error("That file isn’t valid. Expected an object with a `recipes` array.");
  }

  return payload.recipes.filter((recipe) => {
    return Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 &&
           Array.isArray(recipe.steps) && recipe.steps.length > 0;
  }).map((recipe, index) => {
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

const STARTER_RECIPE_TITLES = new Set([
  // Dinner
  'Beef and Guiness Stew',
  'Loco moco',
  'Galbi tang',
  // Lunch
  'Watermelon salad',
  'Broccoli cheddar soup',
  'Honey lime chicken bowl',
  // Breakfast
  'Blueberry cream pancake',
  'Banana Bread',
  'Swiss croissant bake',
  // Dessert
  'Pear puff pastry',
  'Berry yogurt bake'
]);

const STARTER_RECIPES = INITIAL_RECIPES.filter((r) => STARTER_RECIPE_TITLES.has(r.title));

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

function formatDuration(minutes) {
  if (!minutes || minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

function getRecipeCredit(sourceUrl, oembedAuthor) {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, '');
    if (host.includes('instagram.com') || host.includes('tiktok.com')) {
      if (oembedAuthor) {
        return { label: oembedAuthor, prefix: 'Recipe by' };
      }
      const platform = host.includes('instagram.com') ? 'Instagram' : 'TikTok';
      return { label: platform, prefix: 'Recipe from' };
    }
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      return { label: 'YouTube', prefix: 'Recipe from' };
    }
    return { label: host, prefix: 'Recipe from' };
  } catch {
    return null;
  }
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

function RecipeThumbnail({ src, alt, onError }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <Skeleton variant="rectangular" animation="wave" sx={{ width: '100%', height: '100%' }} />
        </Box>
      )}
      <Box
        component="img"
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={(e) => { setLoaded(true); onError(e); }}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: loaded ? 1 : 0
        }}
      />
    </>
  );
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

const trackEvent = (name, params = {}) => {
  if (window.gtag) window.gtag('event', name, params);
};

let searchDebounceTimer = null;

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

  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [mobileFilterDrawerOpen, setMobileFilterDrawerOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem('recifind-favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const toggleFavorite = useCallback((recipeId) => {
    setFavorites((prev) => {
      const wasFavorited = prev.has(recipeId);
      const next = new Set(prev);
      if (wasFavorited) next.delete(recipeId); else next.add(recipeId);
      localStorage.setItem('recifind-favorites', JSON.stringify([...next]));
      trackEvent('favorite', { recipe_id: recipeId, action: wasFavorited ? 'remove' : 'add' });
      return next;
    });
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
  const [isSharedRecipeView, setIsSharedRecipeView] = useState(false);
  const [savedSharedRecipeIds, setSavedSharedRecipeIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('saved_shared_recipe_ids') || '[]')); }
    catch { return new Set(); }
  });
  const [sharedRecipeOwnerId, setSharedRecipeOwnerId] = useState(null);
  const [oembedAuthor, setOembedAuthor] = useState(null);
  const oembedCacheRef = useRef(new Map());
  const [cookMode, setCookMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [recipeMenuAnchor, setRecipeMenuAnchor] = useState(null);
  const [isStickyStuck, setIsStickyStuck] = useState(false);
  const scrollHandlerRef = useRef(null);
  const dialogContentRef = useCallback((node) => {
    // Cleanup previous listener
    if (scrollHandlerRef.current) {
      scrollHandlerRef.current.el.removeEventListener('scroll', scrollHandlerRef.current.fn);
      scrollHandlerRef.current = null;
    }
    if (node) {
      const handleScroll = () => {
        setIsStickyStuck(node.scrollTop > 10);
      };
      node.addEventListener('scroll', handleScroll, { passive: true });
      scrollHandlerRef.current = { el: node, fn: handleScroll };
      // Reset on mount
      handleScroll();
    }
  }, []);
  const wakeLockRef = useRef(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(null);
  const [feedbackFrequency, setFeedbackFrequency] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  // Track visits and decide whether to show the feedback widget.
  // Logic: hide after submission; re-show after 3 visits within a 14-day window.
  // Widget only appears after 15 seconds of active browsing/interaction.
  const feedbackEligible = (() => {
    try {
      const now = Date.now();
      const visits = JSON.parse(localStorage.getItem('feedback_visits') || '[]');
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
      const recentVisits = visits.filter(t => t > fourteenDaysAgo);
      if (!recentVisits.length || now - recentVisits[recentVisits.length - 1] > 30 * 60 * 1000) {
        recentVisits.push(now);
      }
      localStorage.setItem('feedback_visits', JSON.stringify(recentVisits));

      const submittedAt = localStorage.getItem('feedback_submitted_at');
      if (!submittedAt) return true;

      const visitsAfterSubmission = recentVisits.filter(t => t > Number(submittedAt));
      return visitsAfterSubmission.length >= 3;
    } catch {
      return true;
    }
  })();

  const [showFeedbackWidget, setShowFeedbackWidget] = useState(false);

  useEffect(() => {
    if (!feedbackEligible) return;
    let activeMs = 0;
    let lastActivity = Date.now();

    const onActivity = () => { lastActivity = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'touchmove'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivity < 2000) activeMs += 500;
      if (activeMs >= 15000) {
        setShowFeedbackWidget(true);
        clearInterval(interval);
        events.forEach(e => window.removeEventListener(e, onActivity));
      }
    }, 500);

    return () => {
      clearInterval(interval);
      events.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [feedbackEligible]);

  const handleSubmitFeedback = async () => {
    if (!feedbackFrequency) return;
    setFeedbackSubmitting(true);
    try {
      await fetch(`${API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Usefulness: ${feedbackRating}/5\nFrequency: ${feedbackFrequency}${feedbackMessage.trim() ? `\n\nComments: ${feedbackMessage.trim()}` : ''}`,
          senderEmail: feedbackEmail
        })
      });
      setFeedbackDone(true);
      setFeedbackRating(null);
      setFeedbackFrequency('');
      setFeedbackMessage('');
      setFeedbackEmail('');
      try {
        localStorage.setItem('feedback_submitted_at', String(Date.now()));
        // Reset visit counter so the 3-visit window starts fresh
        localStorage.setItem('feedback_visits', JSON.stringify([Date.now()]));
      } catch { /* ignore */ }
      setShowFeedbackWidget(false);
    } catch {
      // silently ignore
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const [snackbarState, setSnackbarState] = useState({
    open: false,
    message: '',
    severity: 'success',
    anchorOrigin: { vertical: 'bottom', horizontal: 'center' }
  });
  const [shareMenuState, setShareMenuState] = useState(null); // { anchorEl, url, title }
  const sentinelRef = useRef(null);
  const searchBarRef = useRef(null);
  const lastParseResultRef = useRef({ url: '', status: '' });
  const RESULTS_PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [remoteState, setRemoteState] = useState(() => ({
    status: isRemoteEnabled ? 'loading' : 'disabled',
    message: ''
  }));
  const [hasNewRecipes, setHasNewRecipes] = useState(false);

  // Install prompt state
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isIosSafari = isIos && !window.navigator.standalone;
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const deferredInstallPrompt = useRef(null);
  const isPwaInstalled = () =>
    localStorage.getItem('recifind-pwa-used') ||
    document.cookie.includes('recifind-pwa-installed=1');

  // Auth state
  const [session, setSession] = useState(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    () => !!(
      sessionStorage.getItem('pending_open_invite') ||
      sessionStorage.getItem('pending_invite_token') ||
      sessionStorage.getItem('pending_accept_friend')
    )
  );
  const [authEmail, setAuthEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [accountMenuAnchor, setAccountMenuAnchor] = useState(null);

  // Friends state
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isFriendsDialogOpen, setIsFriendsDialogOpen] = useState(false);
  const [friendsTab, setFriendsTab] = useState(0);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [openInviteLink, setOpenInviteLink] = useState(null);
  const [openInviteLinkLoading, setOpenInviteLinkLoading] = useState(false);
  const [openInviteLinkLoaded, setOpenInviteLinkLoaded] = useState(false);
  const [openInviteRegenerateOpen, setOpenInviteRegenerateOpen] = useState(false);
  const [openInviteDeactivate, setOpenInviteDeactivate] = useState(false);
  const [addFriendEmail, setAddFriendEmail] = useState('');
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [friendRecipes, setFriendRecipes] = useState([]);
  const [friendRecipesLoading, setFriendRecipesLoading] = useState(false);
  const [visibleRecipeCount, setVisibleRecipeCount] = useState(7);
  const friendRecipesSentinelRef = useRef(null);
  const [friendRecipeSearchOpen, setFriendRecipeSearchOpen] = useState(false);
  const [friendRecipeSearchQuery, setFriendRecipeSearchQuery] = useState('');
  const [friendsDrawerExpanded, setFriendsDrawerExpanded] = useState(false);
  const drawerTouchStartY = useRef(null);
  const [friendConfirm, setFriendConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });
  const drawerScrollRef = useRef(null);

  // Profile state
  const [userProfile, setUserProfile] = useState(null);
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('recifind-dark-mode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: darkMode ? '#5F60FF' : '#6200EA' },
      ...(darkMode ? { divider: 'rgba(255, 255, 255, 0.13)' } : { background: { default: '#fafafa' } }),
    },
    ...(darkMode ? { components: {
      MuiLink: { defaultProps: { color: 'inherit' }, styleOverrides: { root: { color: '#fff' } } },
    } } : {}),
  }), [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('recifind-dark-mode', String(next));
      return next;
    });
  };

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
      if (window.gtag && session?.user?.id) {
        window.gtag('config', 'G-W2LEPNDMF0', { user_id: session.user.id });
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (window.gtag) {
        window.gtag('config', 'G-W2LEPNDMF0', { user_id: session?.user?.id ?? undefined });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Profile API functions ─────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await callRecipesApi('/profile', {}, accessToken);
      if (res) setUserProfile(res);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  }, [accessToken]);

  const updateDisplayName = async (name) => {
    try {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name })
      }, accessToken);
      setUserProfile(prev => prev ? { ...prev, displayName: name } : prev);
      setIsEditNameOpen(false);
      setSnackbarState({ open: true, message: 'Display name updated.', severity: 'success' });
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to update name.', severity: 'error' });
    }
  };

  // ── Friends API functions ──────────────────────────────────────────

  const fetchFriends = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await callRecipesApi('/friends', {}, accessToken);
      setFriends(response?.friends ?? []);
    } catch (error) {
      console.error('Error fetching friends:', error);
    }
  }, [accessToken]);

  const fetchFriendRequests = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [incomingRes, sentRes, invitesRes] = await Promise.all([
        callRecipesApi('/friends/requests', {}, accessToken),
        callRecipesApi('/friends/requests/sent', {}, accessToken),
        callRecipesApi('/friends/invites/sent', {}, accessToken),
      ]);
      setFriendRequests(incomingRes?.requests ?? []);
      setSentRequests(sentRes?.sent ?? []);
      setSentInvites(invitesRes?.invites ?? []);
    } catch (error) {
      console.error('Error fetching friend requests:', error);
    }
  }, [accessToken]);

  const fetchNotifications = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await callRecipesApi('/friends/notifications', {}, accessToken);
      setUnreadNotificationCount(response?.unreadCount ?? 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  }, [accessToken]);

  const sendFriendRequest = async (email) => {
    setAddFriendLoading(true);
    try {
      const res = await callRecipesApi('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ email })
      }, accessToken);
      trackEvent('send_friend_request');
      const message = res?.invited ? 'Invite sent! They\'ll get an email to join ReciFind.' : 'Friend request sent!';
      setSnackbarState({ open: true, message, severity: 'success' });
      setAddFriendEmail('');
      setIsAddFriendOpen(false);
      await fetchFriendRequests();
    } catch (error) {
      const msg = error.message || '';
      const isAlreadyFriends = msg.includes('already friends');
      const isPending = msg.includes('already sent') || msg.includes('already sent you');
      const isAlreadyInvited = msg.includes('already invited');
      setSnackbarState({
        open: true,
        message: isAlreadyFriends ? 'Already connected.' : isPending ? 'Request sent. Pending acceptance.' : isAlreadyInvited ? 'Invite already sent to this person.' : msg || 'Failed to send friend request',
        severity: isAlreadyFriends || isPending || isAlreadyInvited ? 'info' : 'error'
      });
    } finally {
      setAddFriendLoading(false);
    }
  };


  const generateOpenInviteUrl = async () => {
    const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token;
    if (!accessToken) { openAuthDialog(); return null; }
    const res = await callRecipesApi('/friends/open-invite', { method: 'POST' }, accessToken);
    if (!res?.token) return null;
    return `${window.location.origin}?invite=${res.token}`;
  };

  const handleInviteByText = async () => {
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (contacts.length > 0 && contacts[0].tel?.length > 0) {
        const phone = contacts[0].tel[0];
        const name = contacts[0].name?.[0] ? ` ${contacts[0].name[0]}` : '';
        const msg = encodeURIComponent(`Hey${name}! Join me on ReciFind to share recipes: https://recifind.elisawidjaja.com`);
        window.open(`sms:${phone}?body=${msg}`);
      }
    } catch (err) {
      console.error('Contact picker error:', err);
    }
  };

  const acceptFriendRequest = async (fromUserId) => {
    try {
      await callRecipesApi(`/friends/requests/${encodeURIComponent(fromUserId)}/accept`, {
        method: 'POST'
      }, accessToken);
      trackEvent('accept_friend_request');
      setSnackbarState({ open: true, message: 'Friend request accepted!', severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
      await fetchFriendRequests();
      await fetchFriends();
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to accept request', severity: 'error' });
    }
  };

  const declineFriendRequest = async (fromUserId) => {
    try {
      await callRecipesApi(`/friends/requests/${encodeURIComponent(fromUserId)}/decline`, {
        method: 'DELETE'
      }, accessToken);
      setSnackbarState({ open: true, message: 'Friend request declined', severity: 'info' });
      await fetchFriendRequests();
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to decline request', severity: 'error' });
    }
  };

  const cancelSentFriendRequest = async (toUserId) => {
    try {
      await callRecipesApi(`/friends/requests/sent/${encodeURIComponent(toUserId)}/cancel`, {
        method: 'DELETE'
      }, accessToken);
      setSnackbarState({ open: true, message: 'Friend request cancelled', severity: 'info' });
      await fetchFriendRequests();
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to cancel request', severity: 'error' });
    }
  };

  const cancelInvite = async (inviteId) => {
    try {
      await callRecipesApi(`/friends/invites/${encodeURIComponent(inviteId)}`, {
        method: 'DELETE'
      }, accessToken);
      setSnackbarState({ open: true, message: 'Invite cancelled', severity: 'info' });
      await fetchFriendRequests();
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to cancel invite', severity: 'error' });
    }
  };

  const removeFriend = async (friendId) => {
    try {
      await callRecipesApi(`/friends/${encodeURIComponent(friendId)}`, {
        method: 'DELETE'
      }, accessToken);
      setSnackbarState({ open: true, message: 'Friend removed', severity: 'info' });
      await fetchFriends();
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to remove friend', severity: 'error' });
    }
  };

  const fetchFriendRecipes = async (friend) => {
    trackEvent('view_friend_recipes', { friend_name: friend.friendName || '' });
    setSelectedFriend(friend);
    setVisibleRecipeCount(7);
    setFriendRecipesLoading(true);
    try {
      const response = await callRecipesApi(
        `/friends/${encodeURIComponent(friend.friendId)}/recipes`,
        {},
        accessToken
      );
      setFriendRecipes(response?.recipes ?? []);
    } catch (error) {
      setSnackbarState({ open: true, message: 'Failed to load recipes', severity: 'error' });
      setFriendRecipes([]);
    } finally {
      setFriendRecipesLoading(false);
    }
  };

  // Fetch profile + friends data on login and poll for new requests
  useEffect(() => {
    if (!session?.user?.id || !accessToken) return;

    fetchProfile();
    fetchFriends();
    fetchFriendRequests();
    fetchNotifications();

    const pollInterval = setInterval(() => {
      fetchFriendRequests();
      fetchNotifications();
    }, 300000); // 5 minutes to stay within KV list() daily limits

    return () => clearInterval(pollInterval);
  }, [session?.user?.id, accessToken, fetchProfile, fetchFriends, fetchFriendRequests, fetchNotifications]);

  // Lazy-load more friend recipes when sentinel scrolls into view
  useEffect(() => {
    const sentinel = friendRecipesSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleRecipeCount((prev) => prev + 7);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleRecipeCount, friendRecipes.length]);

  const filteredFriendRecipes = useMemo(() => {
    const query = friendRecipeSearchQuery.trim();
    if (!query) return friendRecipes;
    const tokens = query
      .split(',')
      .flatMap((seg) => seg.trim().split(/\s+/))
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return friendRecipes;
    return friendRecipes
      .map((recipe) => {
        const haystack = `${recipe.title} ${(recipe.ingredients || []).join(' ')} ${(recipe.steps || []).join(' ')}`.toLowerCase();
        const score = tokens.reduce((sum, t) => (haystack.includes(t) ? sum + t.length : sum), 0);
        return score > 0 ? { recipe, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((e) => e.recipe);
  }, [friendRecipes, friendRecipeSearchQuery]);

  // ── End friends API functions ─────────────────────────────────────

  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setAuthError('Authentication is not configured.');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const pendingId = sessionStorage.getItem('pending_accept_friend');
      const pendingInvite = sessionStorage.getItem('pending_invite_token');
      const pendingOpenInvite = sessionStorage.getItem('pending_open_invite');
      const pendingShareToken = sessionStorage.getItem('pending_share_token');
      const pendingSaveShare = sessionStorage.getItem('pending_save_share');
      const redirectTo = pendingId
        ? `${window.location.origin}?accept_friend=${encodeURIComponent(pendingId)}`
        : pendingInvite
          ? `${window.location.origin}?invite_token=${encodeURIComponent(pendingInvite)}`
          : pendingOpenInvite
            ? `${window.location.origin}?invite=${encodeURIComponent(pendingOpenInvite)}`
            : (pendingShareToken && pendingSaveShare)
              ? `${window.location.origin}?share=${encodeURIComponent(pendingShareToken)}`
              : window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (error) {
      setAuthError(error.message || 'Failed to sign in with Google.');
    } finally {
      setIsAuthLoading(false);
    }
  };

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
      const pendingId = sessionStorage.getItem('pending_accept_friend');
      const pendingInvite = sessionStorage.getItem('pending_invite_token');
      const pendingOpenInvite = sessionStorage.getItem('pending_open_invite');
      const pendingShareToken = sessionStorage.getItem('pending_share_token');
      const pendingSaveShare = sessionStorage.getItem('pending_save_share');
      const emailRedirectTo = pendingId
        ? `${window.location.origin}?accept_friend=${encodeURIComponent(pendingId)}`
        : pendingInvite
          ? `${window.location.origin}?invite_token=${encodeURIComponent(pendingInvite)}`
          : pendingOpenInvite
            ? `${window.location.origin}?invite=${encodeURIComponent(pendingOpenInvite)}`
            : (pendingShareToken && pendingSaveShare)
              ? `${window.location.origin}?share=${encodeURIComponent(pendingShareToken)}`
              : window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo }
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
        if (showFavoritesOnly && !favorites.has(recipe.id)) {
          return null;
        }

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
  }, [recipes, selectedMealType, normalizedIngredients, showFavoritesOnly, favorites]);

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
      setRecipes(INITIAL_RECIPES.filter((r) => r.imageUrl && !r.imageUrl.startsWith('data:')));
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
      const existingTitles = new Set(normalized.map((r) => r.title));
      const missingStarters = STARTER_RECIPES.filter((r) => !existingTitles.has(r.title));
      const recipesToShow = [...normalized, ...missingStarters];
      setRecipes(recipesToShow);
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

  // Capture Chrome/Android install prompt
  useEffect(() => {
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifind-install-banner-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    let timer;
    const handler = (e) => {
      e.preventDefault();
      deferredInstallPrompt.current = e;
      timer = setTimeout(() => {
        if (!sessionStorage.getItem('invite_entry')) {
          setShowInstallBanner(true);
        }
      }, 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timer);
    };
  }, []);


  // Show install banner on iOS as soon as auth check completes (no login required)
  useEffect(() => {
    if (!isAuthChecked) return;
    if (!isIosSafari) return;
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifind-install-banner-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    if (sessionStorage.getItem('invite_entry')) return;
    const timer = setTimeout(() => setShowInstallBanner(true), 3000);
    return () => clearTimeout(timer);
  }, [isAuthChecked, session]);

  // Handle Web Share Target: open add dialog pre-filled with shared URL
  useEffect(() => {
    if (!isAuthChecked) return;
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get('url') || params.get('text');
    if (!sharedUrl) return;
    // Clean the URL so refreshing doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);
    setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE, sourceUrl: sharedUrl });
    setNewRecipeErrors({});
    setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
    setSourceParseState({ status: 'idle', message: '' });
    setIsAddDialogOpen(true);
  }, [isAuthChecked]);

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

  // Cleanup scroll listener on unmount
  useEffect(() => {
    return () => {
      if (scrollHandlerRef.current) {
        scrollHandlerRef.current.el.removeEventListener('scroll', scrollHandlerRef.current.fn);
        scrollHandlerRef.current = null;
      }
    };
  }, []);

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
    clearTimeout(searchDebounceTimer);
    if (value.trim()) {
      searchDebounceTimer = setTimeout(() => {
        trackEvent('search', { search_term: value.trim() });
      }, 800);
    }
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

  // For shared recipes, use activeRecipe directly (read-only); for own recipes, use the editable draft
  const activeRecipeView = isSharedRecipeView ? activeRecipe : activeRecipeDraft;

  const hasUnsavedChanges = useMemo(() => {
    if (!activeRecipe || !activeRecipeDraft) return false;
    return (
      activeRecipeDraft.title !== activeRecipe.title ||
      activeRecipeDraft.sourceUrl !== activeRecipe.sourceUrl ||
      activeRecipeDraft.notes !== activeRecipe.notes ||
      activeRecipeDraft.durationMinutes !== activeRecipe.durationMinutes ||
      JSON.stringify(activeRecipeDraft.ingredients) !== JSON.stringify(activeRecipe.ingredients) ||
      JSON.stringify(activeRecipeDraft.steps) !== JSON.stringify(activeRecipe.steps) ||
      JSON.stringify(activeRecipeDraft.mealTypes) !== JSON.stringify(activeRecipe.mealTypes)
    );
  }, [activeRecipe, activeRecipeDraft]);

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

  const handleOpenRecipeDetails = useCallback((recipe, updateUrl = true) => {
    if (!recipe) {
      return;
    }
    setActiveRecipe(recipe);
    setIsEditMode(false);
    trackEvent('view_recipe', { recipe_title: recipe.title });
    setIsDeleteConfirmOpen(false);
    setActiveRecipeDraft({
      ...recipe,
      ingredients: Array.isArray(recipe.ingredients) ? [...recipe.ingredients] : [],
      steps: Array.isArray(recipe.steps) ? [...recipe.steps] : []
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('recipe', recipe.id);
      if (session?.user?.id) {
        url.searchParams.set('user', session.user.id);
      }
      window.history.pushState({}, '', url.toString());
    }
  }, [session]);

  // Handle URL parameters to open recipe modal on page load
  useEffect(() => {
    const url = new URL(window.location.href);
    const shareToken = url.searchParams.get('share');
    const recipeId = url.searchParams.get('recipe');
    const sharedUserId = url.searchParams.get('user');

    if (activeRecipe) return;

    // Handle share token URLs (preferred method for shared recipes)
    if (shareToken) {
      const fetchSharedRecipe = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/public/share/${encodeURIComponent(shareToken)}`);
          if (!response.ok) {
            setSnackbarState({ open: true, message: 'Recipe not found or link expired', severity: 'error' });
            return;
          }
          const recipe = await response.json();
          if (recipe && recipe.title) {
            setIsSharedRecipeView(true);
            setSharedRecipeOwnerId(null);
            setActiveRecipe(recipe);
            setActiveRecipeDraft(null);
          }
        } catch (error) {
          console.error('Error fetching shared recipe:', error);
          setSnackbarState({ open: true, message: 'Failed to load shared recipe', severity: 'error' });
        }
      };
      fetchSharedRecipe();
      return;
    }

    // Handle legacy recipe/user URLs (for backwards compatibility)
    if (!recipeId) return;

    const currentUserId = session?.user?.id;
    if (!sharedUserId || sharedUserId === currentUserId) {
      // Own recipe - find in local recipes
      if (recipes.length === 0) return;
      const recipe = recipes.find((r) => r.id === recipeId);
      if (recipe) {
        setIsSharedRecipeView(false);
        setSharedRecipeOwnerId(null);
        handleOpenRecipeDetails(recipe, false);
      }
    } else {
      // Shared recipe from another user (legacy URL format)
      const fetchSharedRecipe = async () => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/public/recipe/${encodeURIComponent(sharedUserId)}/${encodeURIComponent(recipeId)}`
          );
          if (!response.ok) {
            setSnackbarState({ open: true, message: 'Recipe not found or no longer available', severity: 'error' });
            return;
          }
          const recipe = await response.json();
          if (recipe && recipe.title) {
            setIsSharedRecipeView(true);
            setSharedRecipeOwnerId(sharedUserId);
            setActiveRecipe(recipe);
            setActiveRecipeDraft(null);
          }
        } catch (error) {
          console.error('Error fetching shared recipe:', error);
          setSnackbarState({ open: true, message: 'Failed to load shared recipe', severity: 'error' });
        }
      };
      fetchSharedRecipe();
    }
  }, [recipes, activeRecipe, handleOpenRecipeDetails, session]);

  // Fetch oEmbed author for Instagram/TikTok recipes when dialog opens
  useEffect(() => {
    const sourceUrl = activeRecipe?.sourceUrl;
    if (!sourceUrl) { setOembedAuthor(null); return; }
    try {
      const host = new URL(sourceUrl).hostname;
      if (!host.includes('instagram.com') && !host.includes('tiktok.com')) {
        setOembedAuthor(null);
        return;
      }
    } catch { setOembedAuthor(null); return; }
    const cached = oembedCacheRef.current.get(sourceUrl);
    if (cached !== undefined) { setOembedAuthor(cached); return; }
    setOembedAuthor(null);
    fetch(`${API_BASE_URL}/public/oembed-author?url=${encodeURIComponent(sourceUrl)}`)
      .then((res) => res.ok ? res.json() : { author: null })
      .then(({ author }) => {
        oembedCacheRef.current.set(sourceUrl, author);
        setOembedAuthor(author);
      })
      .catch(() => {});
  }, [activeRecipe?.sourceUrl]);

  // Handle pending friend request accept (URL param captured at module load)
  useEffect(() => {
    if (!isAuthChecked) return;

    const pendingId = sessionStorage.getItem('pending_accept_friend');
    const pendingInviteCheck = sessionStorage.getItem('pending_invite_token');

    if (!accessToken) {
      const pendingOpenInviteCheck = sessionStorage.getItem('pending_open_invite');
      if (pendingInviteCheck || pendingId || pendingOpenInviteCheck) {
        setIsAuthDialogOpen(true);
      }
      return;
    }

    if (pendingId) {
      sessionStorage.removeItem('pending_accept_friend');
      callRecipesApi(`/friends/requests/${encodeURIComponent(pendingId)}/accept`, {
        method: 'POST'
      }, accessToken).then(() => {
        trackEvent('accept_friend_request');
        setIsAuthDialogOpen(false);
        setSnackbarState({ open: true, message: 'Friend request accepted!', severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
        fetchFriendRequests();
        fetchFriends();
      }).catch(() => {
        setSnackbarState({ open: true, message: 'Could not accept the friend request. It may have been cancelled.', severity: 'error' });
      });
    }

    const pendingInviteToken = sessionStorage.getItem('pending_invite_token');
    if (pendingInviteToken) {
      sessionStorage.removeItem('pending_invite_token');
      callRecipesApi('/friends/accept-invite', { method: 'POST', body: JSON.stringify({ token: pendingInviteToken }) }, accessToken)
        .then(() => {
          setIsAuthDialogOpen(false);
          setSnackbarState({ open: true, message: "You're now connected with your friend on ReciFind!", severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
          fetchFriends();
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifind-install-banner-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 3000);
          }
        })
        .catch(() => {
          setSnackbarState({ open: true, message: 'Could not process invite. It may have already been used.', severity: 'error' });
        });
    }

    // Handle open invite (token-based, no email required)
    const pendingOpenInviteToken = sessionStorage.getItem('pending_open_invite');
    if (pendingOpenInviteToken) {
      sessionStorage.removeItem('pending_open_invite');
      setIsAuthDialogOpen(false);
      callRecipesApi('/friends/accept-open-invite', {
        method: 'POST',
        body: JSON.stringify({ token: pendingOpenInviteToken })
      }, accessToken)
        .then((result) => {
          setIsAuthDialogOpen(false);
          if (result?.message === 'Connected!') {
            const name = result?.inviterName;
            setSnackbarState({
              open: true,
              message: name ? `You're now connected with ${name}!` : "You're now connected with your friend on ReciFind!",
              severity: 'success',
              anchorOrigin: { vertical: 'top', horizontal: 'center' }
            });
            fetchFriends();
          }
        })
        .catch((err) => {
          console.error('Error accepting open invite:', err);
          setSnackbarState({ open: true, message: 'Could not process invite. It may have already been used.', severity: 'error' });
        });
    }

    // Handle pending shared recipe save (user clicked "Save to my recipes" before login)
    const pendingShareToken = sessionStorage.getItem('pending_share_token');
    const pendingSaveShare = sessionStorage.getItem('pending_save_share');
    if (pendingShareToken && pendingSaveShare) {
      sessionStorage.removeItem('pending_share_token');
      sessionStorage.removeItem('pending_save_share');
      fetch(`${API_BASE_URL}/public/share/${encodeURIComponent(pendingShareToken)}`)
        .then((res) => {
          if (!res.ok) throw new Error('Recipe not found');
          return res.json();
        })
        .then((recipe) => {
          if (!recipe || !recipe.title) throw new Error('Invalid recipe data');
          const newRecipe = {
            title: recipe.title,
            sourceUrl: recipe.sourceUrl || '',
            imageUrl: recipe.imageUrl || '',
            mealTypes: recipe.mealTypes || [],
            ingredients: recipe.ingredients || [],
            steps: recipe.steps || null,
            durationMinutes: recipe.durationMinutes || null,
            notes: recipe.notes || ''
          };
          return fetch(`${API_BASE_URL}/recipes`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify(newRecipe)
          }).then((saveRes) => {
            if (!saveRes.ok) throw new Error('Failed to save recipe');
            return saveRes.json().then(({ recipe: savedRecipe }) => {
              setRecipes((prev) => {
                const updated = [savedRecipe, ...prev.filter((r) => r.id !== savedRecipe.id)];
                const userId = session?.user?.id || null;
                saveRecipesToCache(updated, userId, serverVersionRef.current);
                return updated;
              });
              setSavedSharedRecipeIds((prev) => {
                const next = new Set(prev);
                next.add(recipe.id);
                try { localStorage.setItem('saved_shared_recipe_ids', JSON.stringify([...next])); } catch {}
                return next;
              });
              setIsAuthDialogOpen(false);
              setSnackbarState({
                open: true,
                message: `"${recipe.title}" saved to your recipes!`,
                severity: 'success',
                anchorOrigin: { vertical: 'top', horizontal: 'center' }
              });
            });
          });
        })
        .catch((err) => {
          console.error('Error auto-saving shared recipe after login:', err);
          setSnackbarState({
            open: true,
            message: 'Could not save the shared recipe. Please try again from the share link.',
            severity: 'error'
          });
        });
    }

    // Server-side fallback: check for any pending invites matching this user's email
    // Works even if the invite_token was lost during OAuth redirect
    callRecipesApi('/friends/check-invites', { method: 'POST' }, accessToken)
      .then((res) => {
        if (res?.connected?.length > 0) {
          setSnackbarState({ open: true, message: `You're now connected with ${res.connected.join(', ')}!`, severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
          fetchFriends();
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifind-install-banner-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 3000);
          }
        }
      })
      .catch(() => { /* silent - best effort */ });
  }, [accessToken, isAuthChecked]);

  const handleVideoThumbnailClick = (event, recipe) => {
    event.preventDefault();
    event.stopPropagation();

    const normalizedUrl = buildEmbedUrl(recipe.sourceUrl);
    const targetUrl = normalizedUrl || recipe.sourceUrl;

    if (targetUrl) {
      if (isMobile) {
        // On mobile, navigate in the same tab so the back button
        // returns to ReciFind with the recipe modal open
        window.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
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

    trackEvent('delete_recipe', { recipe_title: deletedTitle });
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

    setActiveRecipe(updatedRecipe);
    setActiveRecipeDraft(updatedRecipe);
    setIsEditMode(false);
  };

  const handleToggleSharedWithFriends = async () => {
    if (!activeRecipe || !activeRecipeDraft) return;
    const newValue = !activeRecipeDraft.sharedWithFriends;
    trackEvent('make_public', { action: newValue ? 'public' : 'private' });
    setActiveRecipeDraft(prev => prev ? { ...prev, sharedWithFriends: newValue } : prev);
    // Auto-save just the sharedWithFriends field
    if (isRemoteEnabled) {
      try {
        const payload = await buildApiRecipePayload({ ...activeRecipeDraft, sharedWithFriends: newValue });
        const response = await callRecipesApi(`/recipes/${encodeURIComponent(activeRecipe.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        }, accessToken);
        const savedRecipe = normalizeRecipeFromApi(response?.recipe) || { ...activeRecipe, sharedWithFriends: newValue };
        setActiveRecipe(savedRecipe);
        setActiveRecipeDraft(savedRecipe);
        setRecipes(prev => {
          const updated = prev.map(r => r.id === activeRecipe.id ? savedRecipe : r);
          const userId = session?.user?.id || null;
          saveRecipesToCache(updated, userId, serverVersionRef.current);
          return updated;
        });
      } catch (error) {
        // Revert on failure
        setActiveRecipeDraft(prev => prev ? { ...prev, sharedWithFriends: !newValue } : prev);
        setSnackbarState({ open: true, message: 'Failed to update sharing', severity: 'error' });
      }
    }
  };

  const handleEnhanceActiveRecipe = useCallback(async () => {
    trackEvent('autofill_click', { context: 'edit_recipe' });
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
    trackEvent('autofill_click', { context: 'new_recipe' });
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
    sessionStorage.removeItem('pending_save_share');
    setActiveRecipe(null);
    setActiveRecipeDraft(null);
    setIsDeleteConfirmOpen(false);
    setIsSharedRecipeView(false);
    setSharedRecipeOwnerId(null);
    setRecipeMenuAnchor(null);
    // Release wake lock when closing modal
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
    setCookMode(false);
    setIsEditMode(false);
    setIsStickyStuck(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has('recipe') || url.searchParams.has('user') || url.searchParams.has('share')) {
      url.searchParams.delete('recipe');
      url.searchParams.delete('user');
      url.searchParams.delete('share');
      window.history.pushState({}, '', url.toString());
    }
  };

  const toggleCookMode = async () => {
    if (cookMode) {
      // Turn off cook mode
      trackEvent('cook_mode', { action: 'off' });
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      setCookMode(false);
      setSnackbarState({ open: true, message: 'Cook mode off — screen will dim normally', severity: 'info' });
    } else {
      trackEvent('cook_mode', { action: 'on' });
      // Turn on cook mode
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
            setCookMode(false);
          });
          setCookMode(true);
          setSnackbarState({ open: true, message: 'Cook mode on — screen will stay awake', severity: 'success' });
        } else {
          setSnackbarState({ open: true, message: 'Cook mode is not supported on this device', severity: 'warning' });
        }
      } catch (err) {
        console.error('Wake Lock error:', err);
        setSnackbarState({ open: true, message: 'Could not enable cook mode', severity: 'error' });
      }
    }
  };

  // Save a shared recipe to the current user's account
  const handleSaveSharedRecipe = async () => {
    if (!activeRecipe || !isSharedRecipeView) return;
    if (!session?.user?.id) {
      const pendingToken = sessionStorage.getItem('pending_share_token');
      if (pendingToken) {
        sessionStorage.setItem('pending_save_share', 'true');
      }
      setIsAuthDialogOpen(true);
      return;
    }

    try {
      const newRecipe = {
        title: activeRecipe.title,
        sourceUrl: activeRecipe.sourceUrl || '',
        imageUrl: activeRecipe.imageUrl || '',
        mealTypes: activeRecipe.mealTypes || [],
        ingredients: activeRecipe.ingredients || [],
        steps: activeRecipe.steps || null,
        durationMinutes: activeRecipe.durationMinutes || null,
        notes: activeRecipe.notes || ''
      };

      const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token;
      const response = await fetch(`${API_BASE_URL}/recipes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify(newRecipe)
      });

      if (!response.ok) {
        throw new Error('Failed to save recipe');
      }

      const { recipe: savedRecipe } = await response.json();
      setRecipes((prev) => {
        const updated = [savedRecipe, ...prev.filter((r) => r.id !== savedRecipe.id)];
        const userId = session?.user?.id || null;
        saveRecipesToCache(updated, userId, serverVersionRef.current);
        return updated;
      });

      setSavedSharedRecipeIds((prev) => {
        const next = new Set(prev);
        next.add(activeRecipe.id);
        try { localStorage.setItem('saved_shared_recipe_ids', JSON.stringify([...next])); } catch {}
        return next;
      });
    } catch (error) {
      console.error('Error saving shared recipe:', error);
      setSnackbarState({
        open: true,
        message: 'Failed to save recipe. Please try again.',
        severity: 'error'
      });
    }
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

    (async () => {
      // Step 1: fast parse — og: tags, structured data, no Gemini
      let localResult = null;
      try {
        localResult = await fetchRecipeDetailsFromSource(sourceUrl, { signal: controller.signal, token: accessToken });
      } catch (error) {
        if (!isActive || error?.name === 'AbortError') return;
        console.error('Unable to parse recipe from URL.', error);
      }

      if (!isActive) return;

      // Populate form with whatever parse returned
      if (localResult) {
        setNewRecipeForm((prev) => {
          const next = { ...prev };
          let changed = false;
          if (!next.title && localResult.title) { next.title = localResult.title; changed = true; }
          if (localResult.imageUrl) { next.imageUrl = localResult.imageUrl; changed = true; }
          if ((!next.ingredients || !next.ingredients.trim()) && localResult.ingredients.length > 0) {
            next.ingredients = localResult.ingredients.join('\n'); changed = true;
          }
          if ((!next.steps || !next.steps.trim()) && localResult.steps.length > 0) {
            next.steps = localResult.steps.join('\n'); changed = true;
          }
          if ((!next.mealTypes || !next.mealTypes.trim()) && localResult.mealTypes.length > 0) {
            next.mealTypes = localResult.mealTypes.join(', '); changed = true;
          }
          if (!next.durationMinutes && typeof localResult.durationMinutes === 'number') {
            next.durationMinutes = String(localResult.durationMinutes); changed = true;
          }
          return changed ? next : prev;
        });
        setNewRecipeErrors((prev) => (prev && Object.keys(prev).length > 0 ? {} : prev));
      }

      const hasIngredients = Array.isArray(localResult?.ingredients) && localResult.ingredients.length > 0;
      const hasSteps = Array.isArray(localResult?.steps) && localResult.steps.length > 0;

      setNewRecipePrefillInfo((prev) => {
        const nextInfo = {
          matched: prev.matched || Boolean(localResult?.title || localResult?.imageUrl || hasIngredients || hasSteps),
          hasIngredients: prev.hasIngredients || hasIngredients,
          hasSteps: prev.hasSteps || hasSteps
        };
        if (nextInfo.matched === prev.matched && nextInfo.hasIngredients === prev.hasIngredients && nextInfo.hasSteps === prev.hasSteps) {
          return prev;
        }
        return nextInfo;
      });

      // If parse already got ingredients/steps, we're done
      if (hasIngredients || hasSteps) {
        lastParseResultRef.current = { url: sourceUrl, status: 'success' };
        setSourceParseState({ status: 'success', message: 'Recipe details parsed from source.' });
        return;
      }

      // Step 2: no ingredients/steps from parse — fetch from Gemini immediately
      setSourceParseState({ status: 'loading', message: 'Fetching ingredients and steps with AI…' });

      try {
        const enrichTitle = localResult?.title || newRecipeForm.title.trim() || '';
        const enrichResponse = await callRecipesApi('/recipes/enrich', {
          method: 'POST',
          body: JSON.stringify({ sourceUrl, title: enrichTitle })
        }, accessToken);

        if (!isActive) return;

        const enriched = enrichResponse?.enriched;
        if (enriched) {
          setNewRecipeForm((prev) => {
            const next = { ...prev };
            let changed = false;
            if ((!next.title || !next.title.trim()) && enriched.title) { next.title = enriched.title; changed = true; }
            if ((!next.imageUrl || next.imageUrl.startsWith('data:image/svg')) && enriched.imageUrl) { next.imageUrl = enriched.imageUrl; changed = true; }
            if ((!next.ingredients || !next.ingredients.trim()) && Array.isArray(enriched.ingredients) && enriched.ingredients.length > 0) {
              next.ingredients = enriched.ingredients.join('\n'); changed = true;
            }
            if ((!next.steps || !next.steps.trim()) && Array.isArray(enriched.steps) && enriched.steps.length > 0) {
              next.steps = enriched.steps.join('\n'); changed = true;
            }
            if ((!next.mealTypes || !next.mealTypes.trim()) && Array.isArray(enriched.mealTypes) && enriched.mealTypes.length > 0) {
              next.mealTypes = enriched.mealTypes.join(', '); changed = true;
            }
            if (!next.durationMinutes && enriched.durationMinutes) {
              next.durationMinutes = String(enriched.durationMinutes); changed = true;
            }
            return changed ? next : prev;
          });

          const enrichedHasIngredients = Array.isArray(enriched.ingredients) && enriched.ingredients.length > 0;
          const enrichedHasSteps = Array.isArray(enriched.steps) && enriched.steps.length > 0;
          setNewRecipePrefillInfo((prev) => ({
            matched: prev.matched || Boolean(enriched.title || enriched.imageUrl || enrichedHasIngredients || enrichedHasSteps),
            hasIngredients: prev.hasIngredients || enrichedHasIngredients,
            hasSteps: prev.hasSteps || enrichedHasSteps
          }));

          lastParseResultRef.current = { url: sourceUrl, status: 'success' };
          setSourceParseState({
            status: 'success',
            message: enrichedHasIngredients || enrichedHasSteps
              ? 'Recipe details filled in with AI.'
              : 'Recipe title and preview parsed. Add details manually or enhance later.'
          });
        } else {
          lastParseResultRef.current = { url: sourceUrl, status: localResult ? 'success' : 'error' };
          setSourceParseState(
            localResult?.title || localResult?.imageUrl
              ? { status: 'success', message: 'Recipe title and preview parsed. Add details manually or enhance later.' }
              : { status: 'error', message: 'Unable to parse recipe from that link. Keep trying! Save now and enhance later.' }
          );
        }
      } catch (err) {
        if (!isActive) return;
        console.error('Auto-enrichment failed:', err);
        lastParseResultRef.current = { url: sourceUrl, status: localResult ? 'success' : 'error' };
        setSourceParseState(
          localResult?.title || localResult?.imageUrl
            ? { status: 'success', message: 'Recipe title and preview parsed. Add details manually or enhance later.' }
            : { status: 'error', message: 'Unable to parse recipe from that link. Keep trying! Save now and enhance later.' }
        );
      }
    })();

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
      durationMinutes,
      sharedWithFriends: newRecipeForm.sharedWithFriends ? 1 : 0
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
        trackEvent('add_recipe', { recipe_title: savedRecipe.title });
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
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', paddingTop: 'env(safe-area-inset-top)' }}>
        <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: { xs: '50px', sm: 'calc(64px - 16px)' } }}>
          <IconButton
            onClick={() => setMobileFilterDrawerOpen(true)}
            sx={{ display: { xs: 'flex', sm: 'none' }, mr: -1 }}
            aria-label="Open filters"
          >
            <FilterListIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
            ReciFind
          </Typography>
          <Stack direction="row" spacing="6px" alignItems="center">
            <Button
              onClick={openAddDialog}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
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
                borderRadius: '0.375rem',
                border: 'none',
                transition: 'all 150ms ease',
                flexShrink: 0,
                textTransform: 'none',
                '&:hover': {
                  backgroundColor: 'primary.dark'
                },
                '&:focus-visible': {
                  boxShadow: '0 0 0 3px rgba(181, 181, 181, 0.5)'
                },
                '&:disabled': {
                  pointerEvents: 'none',
                  opacity: 0.5
                }
              }}
              startIcon={<AddIcon />}
            >
              Add Recipe
            </Button>
            {supabase && (
              session ? (
                <>
                  <Tooltip title="Friends">
                    <IconButton
                      onClick={() => {
                        setIsFriendsDialogOpen(true);
                        fetchFriends();
                        fetchFriendRequests();
                      }}
                      color="inherit"
                    >
                      <Badge badgeContent={friendRequests.length} color="error" overlap="circular">
                        <PeopleIcon />
                      </Badge>
                    </IconButton>
                  </Tooltip>
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
                    <Box sx={{ px: 2, pt: 2, pb: 1.5, minWidth: 240 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Avatar sx={{ bgcolor: 'primary.main', width: 40, height: 40 }}>
                          {(userProfile?.displayName || session.user?.email || 'U').charAt(0).toUpperCase()}
                        </Avatar>
                        <IconButton size="small" onClick={() => { setAccountMenuAnchor(null); setEditNameValue(userProfile?.displayName || ''); setIsEditNameOpen(true); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Typography variant="subtitle1" fontWeight="bold" noWrap>
                        {userProfile?.displayName || session.user?.email?.split('@')[0] || 'User'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {session.user?.email || 'Unknown'}
                      </Typography>
                    </Box>
                    <Divider />
                    <MenuItem disabled sx={{ opacity: '1 !important', pt: 1, pb: 0.25 }}>
                      {userProfile?.recipeCount ?? recipes.length} recipes
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={handleCopyUserId}>
                      <ListItemIcon>
                        <ContentCopyIcon fontSize="small" />
                      </ListItemIcon>
                      Copy user ID
                    </MenuItem>
                    <MenuItem onClick={toggleDarkMode}>
                      <ListItemIcon>
                        <DarkModeOutlinedIcon fontSize="small" />
                      </ListItemIcon>
                      Dark mode
                      <Switch size="small" checked={darkMode} sx={{ ml: 'auto' }} />
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={handleLogout}>
                      <ListItemIcon>
                        <LogoutIcon fontSize="small" />
                      </ListItemIcon>
                      Logout
                    </MenuItem>
                  </Menu>
                </>
              ) : (
                <Button color={darkMode ? 'inherit' : 'primary'} variant="text" onClick={openAuthDialog}>
                  Login
                </Button>
              )
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="left"
        open={mobileFilterDrawerOpen}
        onClose={() => setMobileFilterDrawerOpen(false)}
      >
        <Box sx={{ width: 260, p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Filter by meal type
          </Typography>
          <Stack spacing={1}>
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
                  onClick={() => {
                    handleMealTypeSelect(type);
                    setMobileFilterDrawerOpen(false);
                  }}
                  aria-pressed={selected}
                  sx={{
                    height: 44,
                    fontWeight: 500,
                    ...(!selected && {
                      backgroundColor: 'background.paper',
                      borderColor: 'divider'
                    })
                  }}
                />
              );
            })}
          </Stack>
        </Box>
      </Drawer>

      <Container maxWidth="lg" disableGutters>
        <Box
          sx={{
            px: { xs: 2, sm: 3, md: 4 },
            pt: { xs: 2, md: 'calc(32px - 10px)' }, pb: { xs: 3, md: 4 }
          }}
        >
          <Stack spacing={1.5}>
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
                    '& .MuiOutlinedInput-root': { height: '54px', borderRadius: '6px' }
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
                <Box sx={{
                  display: { xs: 'none', sm: 'flex' },
                  flexWrap: 'wrap',
                  gap: 1,
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                  pl: 0,
                  ml: 0
                }}>
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
                        sx={{
                          height: 44,
                          fontWeight: 500,
                          ...(!selected && {
                            backgroundColor: 'background.paper',
                            borderColor: 'divider'
                          })
                        }}
                      />
                    );
                  })}
                </Box>
              )}

              <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center' }}>
                <Button
                  onClick={openAddDialog}
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
                    borderRadius: '0.375rem',
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

              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexGrow: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {resultsLabel}
                    </Typography>
                  </Stack>
                  {favorites.size > 0 && (
                    <Chip
                      icon={<FavoriteIcon sx={{ fontSize: 16 }} />}
                      label="Favorites"
                      variant="outlined"
                      color="default"
                      onClick={() => setShowFavoritesOnly((prev) => !prev)}
                      clickable
                      sx={{ px: 1, py: 0.5, '& .MuiChip-icon': showFavoritesOnly ? { color: '#E53935' } : {} }}
                    />
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
                        onClick={() => handleOpenRecipeDetails(recipe)}
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
                          role="button"
                          aria-label={`Play ${recipe.title} video`}
                          onClick={(event) => handleVideoThumbnailClick(event, recipe)}
                          sx={{
                            position: 'relative',
                            width: 90,
                            height: 90,
                            flexShrink: 0,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            borderRadius: '6px'
                          }}
                        >
                          <RecipeThumbnail
                            src={displayImageUrl}
                            alt={recipe.title || 'Recipe preview'}
                            onError={createImageFallbackHandler(recipe.title)}
                          />
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
                              {session && favorites.has(recipe.id)
                                ? <BookmarkIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                                : <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />}
                            </IconButton>
                            <IconButton
                              size="small"
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const anchorEl = e.currentTarget;
                                try {
                                  const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token;
                                  if (!accessToken) {
                                    setIsAuthDialogOpen(true);
                                    return;
                                  }
                                  if (API_BASE_URL) {
                                    const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipe.id)}/share`, {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${accessToken}`
                                      }
                                    });
                                    if (response.ok) {
                                      const { token } = await response.json();
                                      const shareUrl = `${window.location.origin}?share=${token}`;
                                      setShareMenuState({ anchorEl, url: shareUrl, title: recipe.title });
                                      return;
                                    }
                                  }
                                  setSnackbarState({ open: true, message: 'Unable to share this recipe', severity: 'error' });
                                } catch (error) {
                                  console.error('Error sharing:', error);
                                  setSnackbarState({ open: true, message: 'Failed to share', severity: 'error' });
                                }
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
        </Box>
      </Container>

      <Menu
        anchorEl={shareMenuState?.anchorEl}
        open={Boolean(shareMenuState)}
        onClose={() => setShareMenuState(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={async () => {
          const { url, title } = shareMenuState;
          setShareMenuState(null);
          if (navigator.share) {
            try {
              await navigator.share({ title, text: `Check out this recipe on ReciFind: ${title}`, url });
              trackEvent('share_recipe', { method: 'native_share' });
              return;
            } catch (err) {
              if (err.name === 'AbortError') return;
            }
          }
          try {
            await navigator.clipboard.writeText(url);
            trackEvent('share_recipe', { method: 'clipboard' });
            setSnackbarState({ open: true, message: 'Link copied to clipboard', severity: 'success' });
          } catch {}
        }}>
          <ListItemIcon><IosShareOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Share</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          const { url, title } = shareMenuState;
          setShareMenuState(null);
          const subject = encodeURIComponent(`Check out this recipe: ${title}`);
          const body = encodeURIComponent(`Check out this recipe on ReciFind: ${title}\n\n${url}`);
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
          trackEvent('share_recipe', { method: 'email' });
        }}>
          <ListItemIcon><EmailOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Email</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(activeRecipeView)}
        onClose={closeDialog}
        fullScreen={isMobile}
        fullWidth={!isMobile}
        maxWidth={isMobile ? false : 'md'}
        aria-labelledby="recipe-dialog-title"
        data-testid="recipe-detail-dialog"
        slotProps={{
          backdrop: isMobile ? { sx: { backgroundColor: 'transparent' } } : {}
        }}
        sx={isMobile ? {
          '& .MuiDialog-paper': {
            display: 'flex',
            flexDirection: 'column'
          }
        } : {}}
      >
        {activeRecipeView && (
          <>
            {!isMobile && (
              <DialogTitle id="recipe-dialog-title" sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {isEditMode && !isSharedRecipeView ? (
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
                  ) : (
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 700, fontSize: '1.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
                    >
                      {activeRecipeView.title || 'Untitled'}
                    </Typography>
                  )}
                  {!isSharedRecipeView && session && !isEditMode && (
                    <IconButton size="small" onClick={(e) => setRecipeMenuAnchor(e.currentTarget)} aria-label="Recipe options">
                      <MoreVertIcon fontSize="small" sx={{ color: '#9E9E9E' }} />
                    </IconButton>
                  )}
                  <IconButton aria-label="Close recipe details" edge="end" onClick={closeDialog} sx={{ flexShrink: 0 }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
                {isEditMode && !isSharedRecipeView && activeRecipeView.title && (
                  <Typography
                    component="button"
                    type="button"
                    onClick={() => setActiveRecipeDraft((prev) => (prev ? { ...prev, title: '' } : prev))}
                    sx={{ background: 'none', border: 'none', cursor: 'pointer', color: 'text.secondary', fontSize: '0.875rem', p: 0, mt: 0.5, textDecoration: 'underline', display: 'block', width: 'fit-content', ml: 'auto', '&:hover': { color: 'text.primary' } }}
                  >
                    Clear text
                  </Typography>
                )}
                {!isEditMode && activeRecipeView.durationMinutes ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(activeRecipeView.durationMinutes)}
                    </Typography>
                  </Box>
                ) : null}
              </DialogTitle>
            )}

            <DialogContent
              ref={dialogContentRef}
              dividers={!isMobile}
              sx={isMobile ? {
                p: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'auto',
                WebkitOverflowScrolling: 'touch',
                ...(darkMode ? { backgroundColor: '#121212' } : {})
              } : { ...(darkMode ? { backgroundColor: '#121212' } : {}) }}
            >

              {/* Thumbnail + cook mode wrapper — sticky on mobile */}
              <Box sx={isMobile ? {
                position: 'sticky',
                top: 0,
                zIndex: 2,
                flexShrink: 0,
                backgroundColor: 'background.paper',
                display: 'flex',
                flexDirection: isStickyStuck ? 'row' : 'column',
                alignItems: isStickyStuck ? 'center' : 'stretch',
                transition: 'all 250ms ease',
                ...(isStickyStuck ? { px: 2, py: 1.5, gap: 2, borderBottom: darkMode ? '1px solid rgba(255, 255, 255, 0.13)' : '1px solid #E5E5E5' } : {})
              } : {}}>
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
                      flexShrink: 0,
                      width: isMobile && isStickyStuck ? 64 : '100%',
                      borderRadius: isMobile && isStickyStuck ? 1.5 : (isMobile ? 0 : 2),
                      overflow: 'hidden',
                      height: isMobile && isStickyStuck ? 64 : { xs: 190, md: 250 },
                      cursor: 'pointer',
                      transition: 'all 250ms ease',
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
                        display: isStickyStuck ? 'none' : 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        color: 'common.white',
                        background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.55) 100%)',
                        opacity: 0,
                        transition: 'opacity 200ms ease'
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        View source
                      </Typography>
                    </Box>
                    {/* Close button overlay on thumbnail — hidden when stuck */}
                    {isMobile && !isStickyStuck && (
                      <IconButton
                        aria-label="Close recipe details"
                        onClick={(e) => { e.stopPropagation(); closeDialog(); }}
                        sx={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          backgroundColor: 'rgba(0, 0, 0, 0.7)',
                          borderRadius: 0,
                          p: 0.5,
                          color: 'white',
                          '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.8)' }
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 22 }} />
                      </IconButton>
                    )}
                  </Box>
                )}

                {'wakeLock' in navigator && (
                  <Box sx={{ display: 'flex', alignItems: 'center', py: isStickyStuck ? 0 : 1.5, ml: 0, px: isMobile && !isStickyStuck ? 3 : 0, minWidth: 0, flexShrink: 1 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={cookMode}
                          onChange={toggleCookMode}
                          color="primary"
                          sx={{
                            width: 50,
                            height: 30,
                            padding: 0,
                            '& .MuiSwitch-switchBase': {
                              padding: '4px',
                              '&.Mui-checked': {
                                transform: 'translateX(20px)'
                              }
                            },
                            '& .MuiSwitch-thumb': {
                              width: 22,
                              height: 22,
                              backgroundColor: darkMode ? 'rgba(255, 255, 255, 0.4)' : '#BDBDBD'
                            },
                            '& .MuiSwitch-switchBase.Mui-checked .MuiSwitch-thumb': {
                              backgroundColor: 'primary.main'
                            },
                            '& .MuiSwitch-track': {
                              borderRadius: 16,
                              opacity: '1 !important',
                              backgroundColor: darkMode ? 'rgba(255, 255, 255, 0.2)' : '#E0E0E0'
                            },
                            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                              backgroundColor: darkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(103, 58, 183, 0.2)'
                            }
                          }}
                        />
                      }
                      label={
                        <Typography variant="body1" color={darkMode ? 'white' : (cookMode ? 'primary' : 'text.secondary')} sx={{ fontWeight: 500, fontSize: '0.9375rem', whiteSpace: 'nowrap' }}>
                          Cook mode
                        </Typography>
                      }
                      sx={{ ml: 0, gap: isStickyStuck ? 1 : 1.5 }}
                    />
                    {isMobile && !isStickyStuck && !isSharedRecipeView && session && !isEditMode && (
                      <IconButton onClick={(e) => setRecipeMenuAnchor(e.currentTarget)} aria-label="Recipe options" sx={{ ml: 'auto', mr: -1 }}>
                        <MoreVertIcon sx={{ color: '#9E9E9E' }} />
                      </IconButton>
                    )}
                  </Box>
                )}

                {/* Close + contextual menu column — visible only when stuck */}
                {isMobile && isStickyStuck && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', alignSelf: 'stretch', ml: 'auto', flexShrink: 0, mt: -1.5, mb: -1.5 }}>
                    <IconButton
                      aria-label="Close recipe details"
                      onClick={closeDialog}
                      size="small"
                      sx={{ p: 0.5, mt: '4px' }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                    {!isSharedRecipeView && session && !isEditMode && (
                      <IconButton
                        onClick={(e) => setRecipeMenuAnchor(e.currentTarget)}
                        aria-label="Recipe options"
                        sx={{ mb: '4px' }}
                      >
                        <MoreVertIcon sx={{ color: '#9E9E9E' }} />
                      </IconButton>
                    )}
                  </Box>
                )}
              </Box>

              {/* Mobile: title + tags below thumbnail */}
              {isMobile && (
                <Box sx={{ px: 3, pt: 2, pb: 1, flexShrink: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isEditMode && !isSharedRecipeView ? (
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
                    ) : (
                      <Typography
                        variant="h6"
                        sx={{ fontWeight: 700, fontSize: '1.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
                      >
                        {activeRecipeView.title || 'Untitled'}
                      </Typography>
                    )}
                  </Box>
                  {isEditMode && !isSharedRecipeView && activeRecipeView.title && (
                    <Typography
                      component="button"
                      type="button"
                      onClick={() => setActiveRecipeDraft((prev) => (prev ? { ...prev, title: '' } : prev))}
                      sx={{ background: 'none', border: 'none', cursor: 'pointer', color: 'text.secondary', fontSize: '0.875rem', p: 0, mt: 0.5, textDecoration: 'underline', display: 'block', width: 'fit-content', ml: 'auto', '&:hover': { color: 'text.primary' } }}
                    >
                      Clear text
                    </Typography>
                  )}
                  {!isEditMode && activeRecipeView.durationMinutes ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                      <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        {formatDuration(activeRecipeView.durationMinutes)}
                      </Typography>
                    </Box>
                  ) : null}
                </Box>
              )}

              <Box sx={isMobile ? { px: 3, pt: '20px' } : { pt: '20px' }}>

              <Stack spacing={3}>
                <Box>
                  {isEditMode && !isSharedRecipeView ? (
                    <>
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
                      {activeRecipeView.ingredients.filter(Boolean).length > 0 && (
                        <Typography
                          component="button"
                          type="button"
                          onClick={() => setActiveRecipeDraft((prev) => (prev ? { ...prev, ingredients: [] } : prev))}
                          sx={{ background: 'none', border: 'none', cursor: 'pointer', color: 'text.secondary', fontSize: '0.875rem', p: 0, mt: 0.5, textDecoration: 'underline', display: 'block', width: 'fit-content', ml: 'auto', '&:hover': { color: 'text.primary' } }}
                        >
                          Clear text
                        </Typography>
                      )}
                    </>
                  ) : (
                    <>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Ingredients
                      </Typography>
                      {activeRecipeView.ingredients.map((item, i) => (
                        <Typography key={i} variant="body1" sx={{ mb: 1 }}>
                          {item}
                        </Typography>
                      ))}
                    </>
                  )}
                </Box>

                <Box sx={{ mt: '0 !important', pt: '20px', pb: '4px' }}>
                  <Divider />
                </Box>

                <Box>
                  {isEditMode && !isSharedRecipeView ? (
                    <>
                      <TextField
                        label="Instructions"
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
                      {(activeRecipeView.steps || []).filter(Boolean).length > 0 && (
                        <Typography
                          component="button"
                          type="button"
                          onClick={() => setActiveRecipeDraft((prev) => (prev ? { ...prev, steps: [] } : prev))}
                          sx={{ background: 'none', border: 'none', cursor: 'pointer', color: 'text.secondary', fontSize: '0.875rem', p: 0, mt: 0.5, textDecoration: 'underline', display: 'block', width: 'fit-content', ml: 'auto', '&:hover': { color: 'text.primary' } }}
                        >
                          Clear text
                        </Typography>
                      )}
                    </>
                  ) : (
                    <>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Instructions
                      </Typography>
                      {(activeRecipeView.steps || []).map((step, i) => {
                        const stepText = step.replace(/^(?:step\s*\d+[:.)\s]+|\d+[:.)\s]+)/i, '').trim();
                        return (
                          <Box key={i} sx={{ mb: 2 }}>
                            <Typography variant="body1" sx={{ fontWeight: 700 }}>
                              Step {i + 1}
                            </Typography>
                            <Typography variant="body1">
                              {stepText}
                            </Typography>
                          </Box>
                        );
                      })}
                    </>
                  )}
                </Box>

                {activeRecipeView.sourceUrl && (
                  <Box>
                    <Link href={activeRecipeView.sourceUrl} target="_blank" rel="noopener" underline="hover">
                      View source
                    </Link>
                    {!isEditMode && (() => {
                      const credit = getRecipeCredit(activeRecipeView?.sourceUrl, oembedAuthor);
                      return credit ? (
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}
                        >
                          {credit.prefix}{' '}
                          <Link href={activeRecipeView.sourceUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'text.secondary' }}>
                            {credit.label}
                          </Link>
                        </Typography>
                      ) : null;
                    })()}
                  </Box>
                )}

                {(isEditMode || (activeRecipeView.mealTypes && activeRecipeView.mealTypes.length > 0)) && (
                  <Box>
                    <Divider sx={{ borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : '#E0E0E0', mb: 3 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Meal types
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {isEditMode ? (
                        MEAL_TYPE_ORDER.map((type) => {
                          const isSelected = activeRecipeView.mealTypes.includes(type);
                          return (
                            <Chip
                              key={type}
                              label={MEAL_TYPE_LABELS[type] || type}
                              size="small"
                              variant={isSelected ? 'filled' : 'outlined'}
                              color={isSelected ? 'primary' : 'default'}
                              onClick={isSharedRecipeView ? undefined : () => {
                                setActiveRecipeDraft((prev) => {
                                  if (!prev) return prev;
                                  const currentTypes = prev.mealTypes || [];
                                  const newTypes = isSelected
                                    ? currentTypes.filter((t) => t !== type)
                                    : [...currentTypes, type];
                                  return { ...prev, mealTypes: newTypes };
                                });
                              }}
                              sx={{ cursor: isSharedRecipeView ? 'default' : 'pointer' }}
                            />
                          );
                        })
                      ) : (
                        activeRecipeView.mealTypes.map((type) => (
                          <Chip
                            key={type}
                            label={MEAL_TYPE_LABELS[type] || type}
                            size="small"
                            variant="filled"
                            color="primary"
                          />
                        ))
                      )}
                    </Box>
                  </Box>
                )}
              </Stack>
              </Box>
            </DialogContent>
            <DialogActions sx={{ justifyContent: (isSharedRecipeView || !session) ? 'center' : 'flex-end', gap: 1, ...(isEditMode && !isSharedRecipeView ? { px: 0 } : {}), ...(isEditMode && !isSharedRecipeView ? (darkMode ? { backgroundColor: '#121212', borderTop: '1px solid rgba(255, 255, 255, 0.13)' } : { backgroundColor: '#fff', borderTop: '1px solid rgba(0, 0, 0, 0.12)' }) : (darkMode ? { backgroundColor: '#121212', borderTop: '1px solid rgba(255, 255, 255, 0.13)' } : {})) }}>
              {isSharedRecipeView ? (
                <>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<IosShareOutlinedIcon />}
                    onClick={async () => {
                      const title = activeRecipe?.title || 'Recipe';
                      const doShare = async (url) => {
                        if (navigator.share) {
                          try { await navigator.share({ title, url }); return; } catch (err) { if (err.name === 'AbortError') return; }
                        }
                        try {
                          await navigator.clipboard.writeText(url);
                          setSnackbarState({ open: true, message: 'Link copied to clipboard', severity: 'success' });
                        } catch { /* ignore */ }
                      };
                      // If opened via a share token URL, share that directly
                      if (window.location.search.includes('share=')) {
                        await doShare(window.location.href);
                        return;
                      }
                      // Friend recipe from drawer — generate a ReciFind share link
                      if (selectedFriend && activeRecipe?.id && API_BASE_URL) {
                        try {
                          const resp = await fetch(
                            `${API_BASE_URL}/friends/${encodeURIComponent(selectedFriend.friendId)}/recipes/${encodeURIComponent(activeRecipe.id)}/share`,
                            { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
                          );
                          if (resp.ok) {
                            const { token } = await resp.json();
                            await doShare(`${window.location.origin}?share=${token}`);
                            return;
                          }
                        } catch { /* fall through */ }
                      }
                      // Fallback: share the source URL if available
                      await doShare(activeRecipe?.sourceUrl || window.location.href);
                    }}
                  >
                    Share
                  </Button>
                  <Button
                    variant={savedSharedRecipeIds.has(activeRecipe?.id) ? 'outlined' : 'contained'}
                    color="primary"
                    onClick={savedSharedRecipeIds.has(activeRecipe?.id) ? undefined : handleSaveSharedRecipe}
                    startIcon={savedSharedRecipeIds.has(activeRecipe?.id) ? <CheckIcon /> : <BookmarkBorderIcon />}
                    sx={savedSharedRecipeIds.has(activeRecipe?.id) ? { pointerEvents: 'none', border: '1px solid #4caf50', color: '#4caf50' } : undefined}
                  >
                    {savedSharedRecipeIds.has(activeRecipe?.id) ? 'Saved' : 'Save'}
                  </Button>
                </>
              ) : !session && !isEditMode ? (
                <>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<IosShareOutlinedIcon />}
                    onClick={openAuthDialog}
                  >
                    Share
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<BookmarkBorderIcon />}
                    onClick={openAuthDialog}
                  >
                    Save
                  </Button>
                </>
              ) : isEditMode ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', px: isMobile ? 3 : 2 }}>
                    {isRemoteEnabled && activeRecipeDraft?.sourceUrl ? (
                      <Typography
                        component="button"
                        onClick={isActiveRecipeEnhancing ? undefined : handleEnhanceActiveRecipe}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.5,
                          background: 'none',
                          border: 'none',
                          cursor: isActiveRecipeEnhancing ? 'default' : 'pointer',
                          color: isActiveRecipeEnhancing ? 'text.disabled' : (darkMode ? '#fff' : 'primary.main'),
                          fontSize: '0.9375rem',
                          fontWeight: 500,
                          p: 0,
                          '&:hover': isActiveRecipeEnhancing ? {} : { textDecoration: 'underline' },
                        }}
                      >
                        {isActiveRecipeEnhancing ? (
                          <CircularProgress size={16} />
                        ) : (
                          <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                        )}
                        Auto-fill
                      </Typography>
                    ) : <Box />}
                    <Typography
                      component="button"
                      onClick={() => { setIsEditMode(false); setActiveRecipeDraft(activeRecipe ? { ...activeRecipe, ingredients: [...(activeRecipe.ingredients || [])], steps: [...(activeRecipe.steps || [])] } : null); }}
                      sx={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'text.primary',
                        fontSize: '0.9375rem',
                        fontWeight: 500,
                        p: 0,
                        textTransform: 'uppercase',
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      Cancel
                    </Typography>
                  <Button
                    variant={hasUnsavedChanges ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={handleSaveActiveRecipe}
                    disabled={!hasUnsavedChanges}
                    sx={{
                      px: 'calc(16px + 2px)',
                      '&.Mui-disabled': {
                        backgroundColor: 'background.paper',
                        borderColor: '#BDBDBD',
                        color: '#BDBDBD'
                      }
                    }}
                  >
                    Save
                  </Button>
                </Box>
              ) : null}
            </DialogActions>
          </>
        )}
      </Dialog>

      <Menu
        anchorEl={recipeMenuAnchor}
        open={Boolean(recipeMenuAnchor)}
        onClose={() => setRecipeMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {activeRecipe && (
          <MenuItem onClick={() => { setRecipeMenuAnchor(null); toggleFavorite(activeRecipe.id); }}>
            <ListItemIcon>
              {favorites.has(activeRecipe.id)
                ? <FavoriteIcon fontSize="small" sx={{ color: '#E53935' }} />
                : <FavoriteBorderIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{activeRecipe && favorites.has(activeRecipe.id) ? 'Unfavorite' : 'Favorite'}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { setRecipeMenuAnchor(null); setIsEditMode(true); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit recipe</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setRecipeMenuAnchor(null); openDeleteConfirm(); }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setRecipeMenuAnchor(null); handleToggleSharedWithFriends(); }}>
          <ListItemIcon>
            {activeRecipeDraft?.sharedWithFriends
              ? <CheckBoxIcon fontSize="small" color="primary" />
              : <CheckBoxOutlineBlankIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>Make public</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog
        open={isDeleteConfirmOpen}
        onClose={closeDeleteConfirm}
        aria-labelledby="delete-recipe-dialog-title"
        data-testid="delete-confirm-dialog"
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
        data-testid="add-recipe-dialog"
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
          <FormControlLabel
            control={
              <Checkbox
                checked={Boolean(newRecipeForm.sharedWithFriends)}
                onChange={(e) => setNewRecipeForm((prev) => ({ ...prev, sharedWithFriends: e.target.checked }))}
                color="primary"
              />
            }
            label="Make it public"
            sx={{ ml: 'calc(-4px - 2px)', mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 0, justifyContent: 'space-between' }}>
          <Box sx={{ px: isMobile ? 3 : 2, display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <Typography
              component="button"
              type="button"
              onClick={closeAddDialog}
              sx={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'text.primary',
                fontSize: '0.9375rem',
                fontWeight: 500,
                p: 0,
                textTransform: 'uppercase',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Cancel
            </Typography>
            <Button type="submit" variant="contained" sx={{ px: 'calc(16px + 2px)' }}>
              Save recipe
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Friends Drawer */}
      <Drawer
        anchor="bottom"
        open={isFriendsDialogOpen}
        data-testid="friends-drawer"
        onClose={() => {
          setIsFriendsDialogOpen(false);
          setSelectedFriend(null);
          setFriendRecipes([]);
          setIsAddFriendOpen(false);
          setAddFriendEmail('');
          setOpenInviteLink(null);
          setOpenInviteLinkLoaded(false);
          setFriendRecipeSearchOpen(false);
          setFriendRecipeSearchQuery('');
          setFriendsDrawerExpanded(false);
        }}
        PaperProps={{
          sx: {
            borderRadius: friendsDrawerExpanded ? 0 : '16px 16px 0 0',
            height: friendsDrawerExpanded ? '100dvh' : 'calc(85dvh + 20px)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'height 0.3s ease, border-radius 0.3s ease',
            paddingBottom: 'env(safe-area-inset-bottom)',
            ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
          }
        }}
      >
        {/* Drag handle — swipe target */}
        <Box
          onTouchStart={(e) => { drawerTouchStartY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            if (drawerTouchStartY.current === null) return;
            const delta = e.changedTouches[0].clientY - drawerTouchStartY.current;
            drawerTouchStartY.current = null;
            if (delta < -40) {
              setFriendsDrawerExpanded(true);
            } else if (delta > 40) {
              if (friendsDrawerExpanded) {
                setFriendsDrawerExpanded(false);
              } else {
                setIsFriendsDialogOpen(false);
                setSelectedFriend(null); setFriendRecipes([]);
                setIsAddFriendOpen(false); setAddFriendEmail('');
                setFriendRecipeSearchOpen(false); setFriendRecipeSearchQuery('');
              }
            }
          }}
          sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 0.5, flexShrink: 0, cursor: 'grab', touchAction: 'none' }}
        >
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: darkMode ? 'rgba(255,255,255,0.3)' : 'grey.300' }} />
        </Box>

        {/* Header */}
        {selectedFriend && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', px: 2, pt: 0.5, pb: 1, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <IconButton onClick={() => { setSelectedFriend(null); setFriendRecipes([]); setFriendRecipeSearchOpen(false); setFriendRecipeSearchQuery(''); }} size="small" edge="start">
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
                <Typography
                  variant="body2"
                  sx={{ cursor: 'pointer', color: 'text.secondary', fontWeight: 'bold', fontSize: '1rem' }}
                  onClick={() => { setSelectedFriend(null); setFriendRecipes([]); setFriendRecipeSearchOpen(false); setFriendRecipeSearchQuery(''); }}
                >
                  Friends
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ pl: 0.5 }}>
                {selectedFriend.friendName}
              </Typography>
            </Box>
          </Box>
        )}


        {/* Scrollable content */}
        <Box
          ref={drawerScrollRef}
          onTouchStart={(e) => { drawerTouchStartY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            if (drawerTouchStartY.current === null) return;
            const delta = e.changedTouches[0].clientY - drawerTouchStartY.current;
            const atTop = drawerScrollRef.current?.scrollTop === 0;
            drawerTouchStartY.current = null;
            if (delta < -40 && atTop) {
              setFriendsDrawerExpanded(true);
            } else if (delta > 60 && atTop) {
              if (friendsDrawerExpanded) {
                setFriendsDrawerExpanded(false);
              } else {
                setIsFriendsDialogOpen(false);
                setSelectedFriend(null); setFriendRecipes([]);
                setIsAddFriendOpen(false); setAddFriendEmail('');
                setFriendRecipeSearchOpen(false); setFriendRecipeSearchQuery('');
                setFriendsDrawerExpanded(false);
              }
            }
          }}
          sx={{ flex: 1, overflowY: 'auto', pt: 0, px: 2, pb: 2, borderTop: '1px solid', borderColor: 'divider' }}
        >
          {selectedFriend ? (
            friendRecipesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : friendRecipes.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                No shared recipes yet
              </Typography>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  {friendRecipeSearchOpen ? (
                    <TextField
                      autoFocus
                      size="small"
                      placeholder="Search recipes..."
                      value={friendRecipeSearchQuery}
                      onChange={(e) => {
                        setFriendRecipeSearchQuery(e.target.value);
                        setVisibleRecipeCount(7);
                      }}
                      InputProps={{
                        endAdornment: friendRecipeSearchQuery ? (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setFriendRecipeSearchQuery('')}>
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ) : null
                      }}
                      sx={{ flex: 1 }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                      {friendRecipes.length} {friendRecipes.length === 1 ? 'recipe' : 'recipes'}
                    </Typography>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => {
                      setFriendRecipeSearchOpen((prev) => !prev);
                      if (friendRecipeSearchOpen) setFriendRecipeSearchQuery('');
                    }}
                    color={friendRecipeSearchOpen ? 'primary' : 'default'}
                  >
                    <SearchIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {filteredFriendRecipes.slice(0, visibleRecipeCount).map((recipe) => (
                    <Card
                      key={recipe.id}
                      elevation={0}
                      sx={{
                        border: 1, borderColor: 'divider',
                        borderRadius: 1,
                        overflow: 'hidden',
                        ...(darkMode && { backgroundColor: 'transparent' })
                      }}
                    >
                      <CardActionArea
                        onClick={() => {
                          setIsSharedRecipeView(true);
                          setActiveRecipe(recipe);
                          setActiveRecipeDraft(null);
                        }}
                        sx={{ display: 'flex', alignItems: 'center' }}
                      >
                        {recipe.imageUrl ? (
                          <Box
                            component="img"
                            src={recipe.imageUrl}
                            alt={recipe.title}
                            sx={{ width: 72, height: 72, objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <Box sx={{ width: 72, height: 72, flexShrink: 0, bgcolor: 'grey.100' }} />
                        )}
                        <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 }, flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="subtitle2"
                            sx={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              lineHeight: 1.4,
                            }}
                          >
                            {recipe.title}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  ))}
                </Box>
                {visibleRecipeCount < filteredFriendRecipes.length && (
                  <Box
                    ref={friendRecipesSentinelRef}
                    sx={{ display: 'flex', justifyContent: 'center', py: 3 }}
                  >
                    <CircularProgress size={24} />
                  </Box>
                )}
                {friendRecipeSearchQuery && filteredFriendRecipes.length === 0 && (
                  <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                    No recipes match &ldquo;{friendRecipeSearchQuery}&rdquo;
                  </Typography>
                )}
              </Box>
            )
          ) : isAddFriendOpen ? (
            <Box sx={{ mt: '24px' }}>
              <Typography variant="h6" sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' }, mb: 2 }}>
                Invite a friend
              </Typography>

              {/* Link display area */}
              {openInviteLinkLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <>
                  <Stack spacing={1.5}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<EmailOutlinedIcon />}
                      onClick={async () => {
                        let token = openInviteLink;
                        if (!token) {
                          setOpenInviteLinkLoading(true);
                          try {
                            const res = await callRecipesApi('/friends/open-invite', { method: 'POST' }, accessToken);
                            token = res?.token || null;
                            if (token) { setOpenInviteLink(token); setOpenInviteLinkLoaded(true); }
                          } finally { setOpenInviteLinkLoading(false); }
                          if (!token) return;
                        }
                        const subject = encodeURIComponent('Join me on ReciFind!');
                        const body = encodeURIComponent(
                          `Hey! I'd love to share recipes with you on ReciFind.\n\nJoin me here: ${window.location.origin}?invite=${token}`
                        );
                        window.location.href = `mailto:?subject=${subject}&body=${body}`;
                        setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
                        trackEvent('invite_friend', { method: 'email' });
                      }}
                    >
                      Invite by Email
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<SmsIcon />}
                      onClick={async () => {
                        let token = openInviteLink;
                        if (!token) {
                          setOpenInviteLinkLoading(true);
                          try {
                            const res = await callRecipesApi('/friends/open-invite', { method: 'POST' }, accessToken);
                            token = res?.token || null;
                            if (token) { setOpenInviteLink(token); setOpenInviteLinkLoaded(true); }
                          } finally { setOpenInviteLinkLoading(false); }
                          if (!token) return;
                        }
                        const inviteUrl = `${window.location.origin}?invite=${token}`;
                        const text = `Hey! I'd love to share recipes with you on ReciFind. Join me here: ${inviteUrl}`;
                        if (navigator.share) {
                          try {
                            await navigator.share({ text, url: inviteUrl });
                            setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
                            trackEvent('invite_friend', { method: 'native_share' });
                            return;
                          } catch (err) {
                            if (err.name === 'AbortError') return;
                          }
                        }
                        window.open(`sms:?body=${encodeURIComponent(text)}`);
                        setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
                        trackEvent('invite_friend', { method: 'sms' });
                      }}
                    >
                      Invite by Text
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<ContentCopyIcon />}
                      onClick={async () => {
                        let token = openInviteLink;
                        if (!token) {
                          setOpenInviteLinkLoading(true);
                          try {
                            const res = await callRecipesApi('/friends/open-invite', { method: 'POST' }, accessToken);
                            token = res?.token || null;
                            if (token) { setOpenInviteLink(token); setOpenInviteLinkLoaded(true); }
                          } catch {
                            setSnackbarState({ open: true, message: 'Could not generate link.', severity: 'error' });
                            return;
                          } finally { setOpenInviteLinkLoading(false); }
                          if (!token) return;
                        }
                        navigator.clipboard.writeText(`${window.location.origin}?invite=${token}`);
                        setSnackbarState({ open: true, message: 'Invite link copied!', severity: 'success' });
                        trackEvent('invite_friend', { method: 'copy_link' });
                      }}
                    >
                      Copy invite link
                    </Button>
                  </Stack>

                  {openInviteLink && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        sx={{ opacity: 0.6, fontSize: '0.75rem' }}
                        onClick={() => setOpenInviteRegenerateOpen(true)}
                      >
                        Generate new link
                      </Button>
                    </Box>
                  )}
                </>
              )}
            </Box>
          ) : friends.length === 0 ? (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                px: 3,
              }}
            >
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 300, mb: 1 }}>
                  Cooking is better with friends
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Tap &ldquo;Add Friend&rdquo; to get started
                </Typography>
              </Box>
              <Box
                sx={{
                  '@keyframes bop': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(8px)' },
                  },
                  animation: 'bop 1.2s ease-in-out infinite',
                  color: 'text.secondary',
                  pb: 1,
                }}
              >
                <ExpandMoreIcon sx={{ fontSize: '2.5rem' }} />
              </Box>
            </Box>
          ) : (
            <List disablePadding>
              {friends.map((friend) => (
                <ListItemButton
                  key={friend.friendId}
                  onClick={() => fetchFriendRecipes(friend)}
                  sx={{ pl: 0 }}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.main' }}>
                      {(friend.friendName || friend.friendEmail || '?')[0].toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={friend.friendName || friend.friendEmail}
                  />
                  <IconButton
                    edge="end"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFriendConfirm({
                        open: true,
                        title: 'Remove friend',
                        message: `Remove ${friend.friendName || friend.friendEmail} from your friends?`,
                        onConfirm: () => removeFriend(friend.friendId)
                      });
                    }}
                    size="small"
                    sx={{ mr: -3 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))}
            </List>
          )}

        </Box>

        {!selectedFriend && (
          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
            <Button
              startIcon={isAddFriendOpen ? <CloseIcon /> : <PersonAddIcon />}
              onClick={() => {
                const opening = !isAddFriendOpen;
                setIsAddFriendOpen(opening);
                setAddFriendEmail('');
                if (opening) {
                  setOpenInviteLinkLoaded(false);
                  setOpenInviteLinkLoading(true);
                  callRecipesApi('/friends/open-invite', {}, accessToken)
                    .then((res) => {
                      setOpenInviteLink(res?.token || null);
                      setOpenInviteLinkLoaded(true);
                    })
                    .catch(() => { setOpenInviteLinkLoaded(true); })
                    .finally(() => setOpenInviteLinkLoading(false));
                } else {
                  setOpenInviteLink(null);
                  setOpenInviteLinkLoaded(false);
                }
              }}
              sx={(theme) => ({
                ...(theme.palette.mode === 'dark' && { color: '#fff' })
              })}
            >
              {isAddFriendOpen ? 'Cancel' : 'Add Friend'}
            </Button>
          </Box>
        )}
      </Drawer>

      <Dialog
        open={openInviteRegenerateOpen}
        onClose={() => { setOpenInviteRegenerateOpen(false); setOpenInviteDeactivate(false); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Regenerate invite link?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Your current link will stop working. Anyone who hasn&apos;t accepted it yet won&apos;t be able to connect.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={openInviteDeactivate}
                onChange={(e) => setOpenInviteDeactivate(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">Deactivate without generating a new link</Typography>
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpenInviteRegenerateOpen(false); setOpenInviteDeactivate(false); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              const deactivate = openInviteDeactivate;
              setOpenInviteRegenerateOpen(false);
              setOpenInviteDeactivate(false);
              setOpenInviteLinkLoading(true);
              try {
                const res = await callRecipesApi('/friends/open-invite/regenerate', {
                  method: 'POST',
                  body: JSON.stringify({ generateNew: !deactivate })
                }, accessToken);
                setOpenInviteLink(res?.token || null);
                setOpenInviteLinkLoaded(true);
                setSnackbarState({
                  open: true,
                  message: deactivate ? 'Invite link deactivated.' : 'Invite link regenerated.',
                  severity: 'success'
                });
              } catch {
                setSnackbarState({ open: true, message: 'Could not regenerate link.', severity: 'error' });
              } finally {
                setOpenInviteLinkLoading(false);
              }
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={friendConfirm.open} onClose={() => setFriendConfirm(s => ({ ...s, open: false }))} maxWidth="xs" fullWidth>
        <DialogTitle>{friendConfirm.title}</DialogTitle>
        <DialogContent>
          <Typography>{friendConfirm.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFriendConfirm(s => ({ ...s, open: false }))} sx={(theme) => ({ ...(theme.palette.mode === 'dark' && { color: '#fff' }) })}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              friendConfirm.onConfirm?.();
              setFriendConfirm(s => ({ ...s, open: false }));
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbarState.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={snackbarState.anchorOrigin}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarState.severity} sx={{ width: '100%' }}>
          {snackbarState.message}
        </Alert>
      </Snackbar>

      <Drawer
        anchor="bottom"
        open={showInstallBanner && isMobile}
        onClose={() => setShowInstallBanner(false)}
        PaperProps={{
          sx: {
            borderRadius: 0,
            px: 2,
            pt: 2,
            pb: 3,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
          }
        }}
      >
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box
            component="img"
            src="/icon-192.png"
            alt="ReciFind"
            sx={{ width: 44, height: 44, borderRadius: 2, flexShrink: 0 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <ArrowForwardIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
            <Typography variant="body1" fontWeight={700}>Add to Home Screen</Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => setShowInstallBanner(false)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {isIos ? (
          /* iOS step-by-step */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {[
              { step: '1', content: <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>Tap the <IosShareOutlinedIcon sx={{ fontSize: 18, color: (theme) => theme.palette.mode === 'dark' ? 'white' : 'primary.main', mx: 0.25 }} /> Share button</Box> },
              { step: '2', content: 'Tap More and scroll down' },
              { step: '3', content: 'Tap Add to Home Screen' },
            ].map(({ step, content }) => (
              <Box key={step} sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Step {step}
                </Typography>
                <Typography variant="body2" color="text.secondary">{content}</Typography>
              </Box>
            ))}
          </Box>
        ) : (
          /* Android/Chrome install button */
          <Button
            fullWidth
            variant="contained"
            disableElevation
            onClick={async () => {
              deferredInstallPrompt.current.prompt();
              const { outcome } = await deferredInstallPrompt.current.userChoice;
              if (outcome === 'accepted') {
                setShowInstallBanner(false);
                localStorage.setItem('recifind-install-banner-dismissed', '1');
              }
            }}
          >
            Install App
          </Button>
        )}

        <Divider sx={{ mt: 2 }} />

        {/* Don't show again */}
        <Box
          sx={{ mt: 1.5, cursor: 'pointer', textAlign: 'center' }}
          onClick={() => {
            setShowInstallBanner(false);
            localStorage.setItem('recifind-install-banner-dismissed', '1');
          }}
        >
          <Typography variant="body2" color="text.secondary">Dismiss and don't show again</Typography>
        </Box>
      </Drawer>

      <Dialog
        open={isEditNameOpen}
        onClose={() => setIsEditNameOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Edit display name</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Display name"
            value={editNameValue}
            onChange={(e) => setEditNameValue(e.target.value)}
            inputProps={{ maxLength: 50 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editNameValue.trim()) {
                updateDisplayName(editNameValue.trim());
              }
            }}
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'flex-end', px: 3, pb: 2 }}>
          <Button color={darkMode ? 'inherit' : 'primary'} onClick={() => setIsEditNameOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!editNameValue.trim()}
            onClick={() => updateDisplayName(editNameValue.trim())}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

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
          <Stack spacing={2} sx={{ pt: 1 }}>
            {authError && (
              <Alert severity="error" onClose={() => setAuthError('')}>
                {authError}
              </Alert>
            )}
            <Button
              variant="outlined"
              fullWidth
              disabled={isAuthLoading}
              onClick={handleGoogleSignIn}
              startIcon={
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
              }
              sx={{
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.95rem',
                py: 1.2,
                borderColor: '#dadce0',
                color: 'text.primary',
                '&:hover': { borderColor: '#dadce0', backgroundColor: '#f8f9fa' }
              }}
            >
              Sign in with Google
            </Button>

            <Divider sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>or</Divider>

            <Box
              component="form"
              onSubmit={handleSendMagicLink}
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Enter your email and we'll send you a magic link to sign in.
                </Typography>
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAuthDialog} sx={(theme) => ({ ...(theme.palette.mode === 'dark' && { color: '#fff' }) })}>Cancel</Button>
        </DialogActions>
      </Dialog>
      {/* Feedback widget */}
      {showFeedbackWidget && <Box sx={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', right: 20, zIndex: 1300 }}>
        <Tooltip title="Send feedback" placement="left">
          <IconButton
            onClick={() => { setFeedbackOpen(true); setFeedbackDone(false); }}
            sx={{
              bgcolor: darkMode ? 'rgba(98,0,234,0.35)' : 'rgba(98,0,234,0.12)',
              color: darkMode ? '#ce93d8' : '#6200EA',
              width: 48,
              height: 48,
              '&:hover': { bgcolor: darkMode ? 'rgba(98,0,234,0.5)' : 'rgba(98,0,234,0.2)' }
            }}
          >
            <FeedbackOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Box>}
      <Dialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1, p: 0, position: 'relative', minHeight: 40 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ pt: 1.5, pb: 1.5, pl: '20px', pr: 5 }}>
            {feedbackDone ? 'Feedback sent' : 'Send feedback'}
          </Typography>
          <IconButton onClick={() => setFeedbackOpen(false)} size="small" sx={{ position: 'absolute', right: 12, top: 8, color: 'text.secondary' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: '20px' }}>
          {feedbackDone ? (
            <Typography sx={{ py: 1, color: darkMode ? '#fff' : 'success.main' }}>Thanks for your feedback!</Typography>
          ) : (
            <Stack spacing={3} sx={{ pt: 0.5 }}>
              {/* Q1: Rating 1–5 as selectable rows */}
              <Box>
                <Typography variant="body2" fontWeight={500} gutterBottom>How useful is this app for you?</Typography>
                <Stack spacing={0.75}>
                  {[
                    [1, "Not useful at all"],
                    [2, "Somewhat useful"],
                    [3, "Useful"],
                    [4, "Very useful"],
                    [5, "Can't live without"],
                  ].map(([num, label]) => {
                    const selected = feedbackRating === num;
                    return (
                      <Box
                        key={num}
                        onClick={() => setFeedbackRating(num)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          px: 1.5,
                          py: 1,
                          borderRadius: 1,
                          cursor: 'pointer',
                          border: '1px solid',
                          borderColor: selected ? 'primary.main' : (darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'),
                          bgcolor: selected ? (darkMode ? 'rgba(98,0,234,0.18)' : 'rgba(98,0,234,0.06)') : 'transparent',
                          '&:hover': { borderColor: 'primary.main', bgcolor: darkMode ? 'rgba(98,0,234,0.12)' : 'rgba(98,0,234,0.04)' },
                          transition: 'all 0.15s',
                        }}
                      >
                        <Box sx={{
                          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: selected ? 'primary.main' : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                          color: selected ? '#fff' : 'text.secondary',
                          fontSize: '0.8rem', fontWeight: 600,
                        }}>
                          {num}
                        </Box>
                        <Typography variant="body2" color={selected ? (darkMode ? '#fff' : 'primary.main') : 'text.primary'} fontWeight={selected ? 500 : 400}>
                          {label}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* Q2: Frequency as selectable rows */}
              <Box>
                <Typography variant="body2" fontWeight={500} gutterBottom>How often will you use it?</Typography>
                <Stack spacing={0.75}>
                  {[
                    ['Daily', 'Every day'],
                    ['Weekly', 'A few times a week'],
                    ['Monthly', 'A few times a month'],
                    ['Rarely', 'Rarely'],
                  ].map(([val, label]) => {
                    const selected = feedbackFrequency === val;
                    return (
                      <Box
                        key={val}
                        onClick={() => setFeedbackFrequency(val)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          px: 1.5,
                          py: 1,
                          borderRadius: 1,
                          cursor: 'pointer',
                          border: '1px solid',
                          borderColor: selected ? 'primary.main' : (darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'),
                          bgcolor: selected ? (darkMode ? 'rgba(98,0,234,0.18)' : 'rgba(98,0,234,0.06)') : 'transparent',
                          '&:hover': { borderColor: 'primary.main', bgcolor: darkMode ? 'rgba(98,0,234,0.12)' : 'rgba(98,0,234,0.04)' },
                          transition: 'all 0.15s',
                        }}
                      >
                        <Box sx={{
                          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: selected ? 'primary.main' : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                          color: selected ? '#fff' : 'text.secondary',
                        }}>
                          <CheckIcon sx={{ fontSize: '0.9rem' }} />
                        </Box>
                        <Typography variant="body2" color={selected ? (darkMode ? '#fff' : 'primary.main') : 'text.primary'} fontWeight={selected ? 500 : 400}>
                          {label}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* Q3: Open text */}
              <Box>
                <Typography variant="body2" fontWeight={500} gutterBottom>Other comments</Typography>
                <TextField
                  multiline
                  rows={3}
                  placeholder="Optional comments..."
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  fullWidth
                  size="small"
                />
              </Box>

              <TextField
                placeholder="Your email (optional)"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                fullWidth
                size="small"
                type="email"
              />
            </Stack>
          )}
        </DialogContent>
        {!feedbackDone && (
          <DialogActions sx={{ justifyContent: 'space-between', px: '20px', pb: 3 }}>
            <Button onClick={() => setFeedbackOpen(false)} sx={{ color: 'text.primary' }}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSubmitFeedback}
              disabled={feedbackSubmitting || !feedbackFrequency || !feedbackRating}
            >
              {feedbackSubmitting ? <CircularProgress size={18} /> : 'Send'}
            </Button>
          </DialogActions>
        )}
      </Dialog>
    </ThemeProvider>
  );
}

export default App;
