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
  InputBase,
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
import MenuIcon from '@mui/icons-material/Menu';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import PeopleIcon from '@mui/icons-material/People';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import CheckIcon from '@mui/icons-material/Check';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import SoupKitchenOutlinedIcon from '@mui/icons-material/SoupKitchenOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import { supabase } from './supabaseClient';
// === [rebrand] ===
import { migrateLegacyStorage } from './lib/migrateLegacyStorage';
// === [/rebrand] ===
import PublicLanding from './components/PublicLanding';
import WelcomeModal from './components/WelcomeModal';
import OnboardingFlow from './components/OnboardingFlow';
import FriendSections from './components/FriendSections';
import StatsTiles from './components/StatsTiles';
import RecipeListCard from './components/RecipeListCard';
import RecipesPage from './RecipesPage';
// === [S04] Friend picker wiring ===
import { FriendPicker } from './components/FriendPicker';
import { ShareSheet } from './components/ShareSheet';
import { shareRecipe } from './lib/shareRecipe';
// === [/S04] ===
// === [S09] Capacitor auth ===
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { createDispatcher } from './lib/deepLinkDispatch';
// === [/S09] ===
// === [S11] Push client ===
import { ensureRegistered, getCurrentApnsToken, onNotificationTap, hasPromptedForPermission } from './lib/pushClient';
import { NotificationSoftPrompt } from './components/NotificationSoftPrompt';
// === [/S11] ===
import { formatDuration } from './utils/videoEmbed';
import recipesData from '../recipes.json';
import recipesFromPdfData from '../recipes_from_pdf.json';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');
const DEV_API_TOKEN = import.meta.env.VITE_RECIPES_API_TOKEN || '';
// Outbound share URLs always point at the production site so iMessage/Twitter/etc.
// hit the Pages Functions OG-tag middleware and render rich link previews —
// the dev tunnel only runs Vite (no middleware), so previews fail there.
const SHARE_PUBLIC_URL = 'https://recifriend.com';

// Log version on load to bust cache
console.log('ReciFriend v2024.12.02.1');

// localStorage cache key for recipes
const RECIPES_CACHE_KEY = 'recifriend-recipes-cache-v2';

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

// Supabase client is initialized in ./supabaseClient.js (PKCE + Capacitor storage)

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

function normalizeMealTypeValue(type) {
  const t = type.trim().toLowerCase();
  if (t === 'side' || t === 'side dish') return 'sides';
  if (t === 'snack') return 'snacks';
  return t;
}

function normalizeRecipeMealTypes(recipe) {
  if (!Array.isArray(recipe.mealTypes)) return recipe;
  const normalized = [...new Set(recipe.mealTypes.filter((t) => typeof t === 'string' && t.trim()).map(normalizeMealTypeValue))];
  return { ...recipe, mealTypes: normalized };
}

function normalizeRecipeFromApi(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  let result = recipe;
  if (API_BASE_URL && recipe.imagePath && (!recipe.imageUrl || recipe.imageUrl.startsWith('/'))) {
    result = { ...result, imageUrl: `${API_BASE_URL}${recipe.imagePath}` };
  }
  return normalizeRecipeMealTypes(result);
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
  appetizer: 'Appetizers',
  sides: 'Sides',
  snacks: 'Snacks',
};

const MEAL_TYPE_ICONS = {
  breakfast: '🥐',
  lunch: '🍔',
  dinner: '🍚',
  dessert: '🍪',
  appetizer: '🧀',
  sides: '🥑',
  snacks: '🍿',
};

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'dessert', 'appetizer', 'sides', 'snacks'];
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
      ? [...new Set(recipe.mealTypes.filter((type) => typeof type === 'string' && type.trim()).map(normalizeMealTypeValue))]
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

function BoppingFruitsIllustration() {
  return <img src="/friends-empty.png" width="260" alt="friends" style={{ display: 'block', marginTop: 20 }} />;
}

const AVATAR_COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#06b6d4'];
function getAvatarColor(id) {
  if (!id) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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

  // === [rebrand] ===
  useEffect(() => { migrateLegacyStorage(); }, []);
  // === [/rebrand] ===

  const [showFloatingFab, setShowFloatingFab] = useState(false);
  const [showHomeFab, setShowHomeFab] = useState(false);
  const [cookWithFriendsVisible, setCookWithFriendsVisible] = useState(false);
  const addRecipeBtnRef = useRef(null);
  const statsTilesObserverRef = useRef(null);
  const statsTilesRef = useCallback((node) => {
    if (statsTilesObserverRef.current) {
      statsTilesObserverRef.current.disconnect();
      statsTilesObserverRef.current = null;
    }
    if (!node) { setShowHomeFab(false); return; }
    const observer = new IntersectionObserver(
      ([entry]) => setShowHomeFab(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(node);
    statsTilesObserverRef.current = observer;
  }, []);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [mobileFilterDrawerOpen, setMobileFilterDrawerOpen] = useState(false);
  const mobileFilterChipsRef = useRef(null);
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem('recifriend-favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [currentView, setCurrentView] = useState(() => {
    const saved = sessionStorage.getItem('currentView');
    return saved === 'recipes' ? 'recipes' : 'home';
  }); // 'home' | 'recipes'

  useEffect(() => {
    sessionStorage.setItem('currentView', currentView);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'recipes') {
      setShowFloatingFab(false);
      return;
    }
    const el = addRecipeBtnRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingFab(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentView]);

  const toggleFavorite = useCallback((recipeId) => {
    setFavorites((prev) => {
      const wasFavorited = prev.has(recipeId);
      const next = new Set(prev);
      if (wasFavorited) next.delete(recipeId); else next.add(recipeId);
      localStorage.setItem('recifriend-favorites', JSON.stringify([...next]));
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
  const [isFirstRecipe, setIsFirstRecipe] = useState(false);
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
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [welcomeRecipes, setWelcomeRecipes] = useState([]);
  const [inviterName, setInviterName] = useState(null);

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
  const [shareSheetState, setShareSheetState] = useState(null); // { recipe, anchorPosition }
  const sentinelRef = useRef(null);
  const searchBarRef = useRef(null);
  const lastParseResultRef = useRef({ url: '', status: '' });
  const pendingEnrichRef = useRef(null); // { promise, sourceUrl } — survives form reset so save can patch
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
    // Native Capacitor app = no "Add to Home Screen" prompt needed.
    Capacitor.isNativePlatform() ||
    localStorage.getItem('recifriend-pwa-used') ||
    document.cookie.includes('recifriend-pwa-installed=1');

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
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  // === [S04] Friend picker wiring ===
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRecipeId, setPickerRecipeId] = useState(null);
  // === [/S04] ===
  const [friendRequests, setFriendRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isFriendsDialogOpen, setIsFriendsDialogOpen] = useState(false);
  const [friendsTab, setFriendsTab] = useState(0);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [isInviteSheetOpen, setIsInviteSheetOpen] = useState(false);
  const [inviteSheetUrl, setInviteSheetUrl] = useState(null);
  const [inviteSheetLoading, setInviteSheetLoading] = useState(false);
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
  const inviteAcceptDispatchedRef = useRef(false); // prevents bottom check-invites from racing accept-invite
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
  const [isDrawerEditingName, setIsDrawerEditingName] = useState(false);

  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('recifriend-dark-mode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: darkMode ? '#5F60FF' : '#6200EA' },
      ...(darkMode ? { divider: 'rgba(255, 255, 255, 0.13)' } : { background: { default: '#fafafa' } }),
    },
    components: {
      MuiButton: {
        styleOverrides: {
          containedPrimary: { borderRadius: '999px' },
          containedError: { borderRadius: '999px' },
          containedSecondary: { borderRadius: '999px' },
          outlined: { borderRadius: '999px' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: '16px' },
        },
      },
      ...(darkMode ? {
        MuiLink: { defaultProps: { color: 'inherit' }, styleOverrides: { root: { color: '#fff' } } },
      } : {}),
    },
  }), [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('recifriend-dark-mode', String(next));
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

    // Magic-link fallback: when emailRedirectTo lands on /?token_hash=xxx&type=magiclink
    // (Supabase PKCE magic-link format), detectSessionInUrl doesn't auto-exchange.
    // We verifyOtp manually and then strip the params from the URL.
    const urlParams = new URLSearchParams(window.location.search);
    const tokenHash = urlParams.get('token_hash');
    const magicType = urlParams.get('type');
    if (tokenHash && magicType) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: magicType }).then(({ error }) => {
        if (error) console.warn('Magic link verifyOtp failed:', error.message);
        // Clean the URL regardless so stale params don't persist
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('token_hash');
        cleanUrl.searchParams.delete('type');
        window.history.replaceState({}, '', cleanUrl.toString());
      });
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_IN') {
        setCurrentView('home');
        setIsAuthDialogOpen(false);  // close sign-in dialog (e.g. after native OAuth returns)
        setAuthError('');
        setIsAuthLoading(false);
      }
      if (event === 'SIGNED_OUT') {
        setCurrentView('home');
      }
      if (window.gtag) {
        window.gtag('config', 'G-W2LEPNDMF0', { user_id: session?.user?.id ?? undefined });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // === [S09] Capacitor auth — deep-link dispatcher (hoisted so Story 11 can reference it) ===
  // The dispatcher must be STABLE (same identity for the app's lifetime). Earlier
  // versions recreated it on every `recipes` change, which caused the appUrlOpen
  // listener to re-register and Capacitor to re-flush the retained launch URL —
  // reopening the Add Recipe dialog after save/delete. Instead we read mutable
  // state (recipes) via a ref so dispatchDeepLink never changes identity.
  const handleOpenRecipeDetailsRef = useRef(null);
  const recipesRef = useRef(recipes);
  useEffect(() => { recipesRef.current = recipes; }, [recipes]);

  const dispatchDeepLink = useCallback(async (urlString) => {
    // Magic link URLs (?token_hash=&type=magiclink) bypass the OAuth
    // dispatcher because they need verifyOtp instead of exchangeCodeForSession.
    try {
      const parsed = new URL(urlString);
      const tokenHash = parsed.searchParams.get('token_hash');
      const otpType = parsed.searchParams.get('type');
      if (tokenHash && otpType && supabase) {
        await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
        try { await Browser.close(); } catch { /* ignore */ }
        return;
      }
    } catch { /* not a parseable URL; fall through */ }

    const dispatch = createDispatcher({
      onAuthCallback: async (code) => {
        if (!supabase) return;
        await supabase.auth.exchangeCodeForSession(code);
        try { await Browser.close(); } catch { /* ignore if already closed */ }
      },
      onAddRecipe: (url) => {
        // Pre-fill source URL and open Add Recipe dialog directly (user is already authed on native)
        setNewRecipeForm((prev) => ({ ...prev, sourceUrl: url }));
        setNewRecipeErrors({});
        setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
        setSourceParseState({ status: 'idle', message: '' });
        setIsAddDialogOpen(true);
      },
      onFriendRequests: () => {
        setCurrentView('friend-requests');
      },
      onRecipeDetail: (recipeId) => {
        const recipe = recipesRef.current.find((r) => r.id === recipeId);
        if (recipe) handleOpenRecipeDetailsRef.current?.(recipe);
      },
    });
    return dispatch(urlString);
  }, []);

  // Register appUrlOpen listener exactly once. Never re-subscribe — every
  // re-subscription flushes Capacitor's retained `appUrlOpen` event again
  // (see @capacitor/app iOS: notifyListeners(..., retainUntilConsumed: true)).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listenerHandle;
    let cancelled = false;
    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      dispatchDeepLink(url);
    }).then((handle) => {
      if (cancelled) { handle.remove(); return; }
      listenerHandle = handle;
    });
    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
  }, [dispatchDeepLink]);

  // Handle cold-start deep link (app was killed, opened via link).
  // getLaunchUrl() persists across calls — guard with a ref so the URL
  // fires at most once per app session.
  const launchUrlDispatchedRef = useRef(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (launchUrlDispatchedRef.current) return;
    launchUrlDispatchedRef.current = true;
    (async () => {
      const launch = await CapacitorApp.getLaunchUrl();
      if (launch?.url) dispatchDeepLink(launch.url);
    })();
  }, [dispatchDeepLink]);
  // === [/S09] ===

  // === [S11] Push client ===
  // Soft-prompt-first: friendly snackbar after a meaningful action. Only users
  // who accept the soft prompt see the unrecoverable iOS native permission
  // dialog. Users who dismiss the soft prompt can be re-asked later.
  const [softPromptOpen, setSoftPromptOpen] = useState(false);
  const [softPromptContext, setSoftPromptContext] = useState(null);

  const pushApi = {
    register: ({ apns_token }) =>
      fetch(`${API_BASE_URL}/devices/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apns_token }),
      }).then(r => r.json()),
  };

  async function triggerSoftPromptIfNeeded(context) {
    if (!Capacitor.isNativePlatform()) return;
    if (await hasPromptedForPermission()) return;
    setSoftPromptContext(context);
    setSoftPromptOpen(true);
  }

  async function handleSoftPromptAccept() {
    setSoftPromptOpen(false);
    await ensureRegistered({ api: pushApi, jwt: accessToken });
  }

  // Wire notification taps; silently re-register on sign-in if permission was
  // already granted in a prior session. On a fresh install (never prompted),
  // DO NOT call ensureRegistered — it would fire the native iOS prompt
  // immediately, bypassing our soft prompt. We defer registration until the
  // user accepts the soft prompt in a contextual moment.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let sub;
    (async () => {
      sub = await onNotificationTap((deepLinkUrl) => {
        dispatchDeepLink(deepLinkUrl);
      });
      if (await hasPromptedForPermission()) {
        await ensureRegistered({ api: pushApi, jwt: accessToken });
      }
    })();
    return () => { sub?.remove(); };
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  // === [/S11] ===

  // Show welcome modal once after first sign-in
  useEffect(() => {
    if (!isAuthChecked || !session) return;
    if (new URLSearchParams(window.location.search).get('reset_onboarding') === '1') {
      localStorage.removeItem('onboarding_seen');
    }
    const onboardingSeen = localStorage.getItem('onboarding_seen');
    if (onboardingSeen) return;

    // Fetch welcome recipes: editors-pick as fallback
    fetch(`${API_BASE_URL}/public/editors-pick`)
      .then(r => r.json())
      .then(d => setWelcomeRecipes((d?.recipes || []).slice(0, 3)))
      .catch(() => {});

    setWelcomeOpen(true);
  }, [isAuthChecked, session]);

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
      setIsDrawerEditingName(false);
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
      setFriendsLoaded(true);
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
      const message = res?.invited ? 'Invite sent! They\'ll get an email to join ReciFriend.' : 'Friend request sent!';
      setSnackbarState({ open: true, message, severity: 'success' });
      setAddFriendEmail('');
      setIsAddFriendOpen(false);
      await fetchFriendRequests();
      // === [S11] Push client ===
      triggerSoftPromptIfNeeded('friend-request-sent');
      // === [/S11] ===
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

  const openInviteSheet = async () => {
    setIsInviteSheetOpen(true);
    setInviteSheetUrl(null);
    setInviteSheetLoading(true);
    try {
      const url = await generateOpenInviteUrl();
      setInviteSheetUrl(url);
    } finally {
      setInviteSheetLoading(false);
    }
  };

  const handleSavePublicRecipe = async (recipe) => {
    try {
      const token = (await supabase?.auth.getSession())?.data?.session?.access_token;
      if (!token) { openAuthDialog(); return; }
      const payload = {
        title: recipe.title,
        sourceUrl: recipe.sourceUrl || '',
        imageUrl: recipe.imageUrl || '',
        mealTypes: recipe.mealTypes || [],
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || null,
        durationMinutes: recipe.durationMinutes || null,
        notes: '',
      };
      const res = await fetch(`${API_BASE_URL}/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save');
      const { recipe: saved } = await res.json();
      setRecipes((prev) => {
        const updated = [saved, ...prev.filter((r) => r.id !== saved.id)];
        saveRecipesToCache(updated, session?.user?.id || null, serverVersionRef.current);
        return updated;
      });
      setSnackbarState({ open: true, message: `"${recipe.title}" saved to your collection!`, severity: 'success' });
    } catch {
      setSnackbarState({ open: true, message: 'Failed to save recipe', severity: 'error' });
    }
  };

  const handleSharePublicRecipe = (recipe, event) => {
    const anchorPosition = event?.currentTarget
      ? { top: event.currentTarget.getBoundingClientRect().bottom, left: event.currentTarget.getBoundingClientRect().left }
      : { top: window.innerHeight / 2, left: window.innerWidth / 2 };
    const url = recipe.id && recipe.userId
      ? `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(recipe.id)}&user=${encodeURIComponent(recipe.userId)}`
      : SHARE_PUBLIC_URL;
    setShareMenuState({ anchorPosition, url, title: recipe.title, imageUrl: recipe.imageUrl || '' });
  };

  const handleOpenEditorPickRecipe = (recipe) => {
    const safe = {
      ...recipe,
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      steps: Array.isArray(recipe.steps) ? recipe.steps : [],
    };
    setActiveRecipe(safe);
    setActiveRecipeDraft(safe);
    setIsSharedRecipeView(true);
  };

  const handleInviteByText = async () => {
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (contacts.length > 0 && contacts[0].tel?.length > 0) {
        const phone = contacts[0].tel[0];
        const name = contacts[0].name?.[0] ? ` ${contacts[0].name[0]}` : '';
        const msg = encodeURIComponent(`Hey${name}! Join me on ReciFriend to share recipes: https://recifriend.com`);
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


  const handleWelcomeDismiss = () => {
    setWelcomeOpen(false);
    const onboardingSeen = localStorage.getItem('onboarding_seen');
    if (!onboardingSeen) {
      setOnboardingOpen(true);
    }
  };

  const handleWelcomeSkip = () => {
    setWelcomeOpen(false);
    localStorage.setItem('onboarding_seen', '1');
  };

  const handleOnboardingComplete = async (prefs) => {
    setOnboardingOpen(false);
    localStorage.setItem('onboarding_seen', '1');
    setIsFirstRecipe(true);
    openAddDialog();
    if (accessToken && (prefs.dietaryPrefs?.length || prefs.cookingFor || prefs.cuisinePrefs?.length)) {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ dietaryPrefs: prefs.dietaryPrefs, cookingFor: prefs.cookingFor, cuisinePrefs: prefs.cuisinePrefs })
      }, accessToken);
      // Re-fetch profile so FriendSections gets the new prefs in the same session
      fetchProfile();
    }
  };

  const handleOnboardingSkip = () => {
    setOnboardingOpen(false);
    localStorage.setItem('onboarding_seen', '1');
    setIsFirstRecipe(true);
    openAddDialog();
  };

  const handleOnboardingDismiss = () => {
    setOnboardingOpen(false);
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
      // === [S09] Capacitor auth ===
      if (Capacitor.isNativePlatform()) {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            // Custom scheme so Capacitor Browser auto-closes on callback. Safe
            // from OAuth code interception because native client uses PKCE —
            // even if another app claims recifriend://, they lack the
            // code_verifier stored locally in ReciFriend's Keychain.
            redirectTo: 'recifriend://auth/callback',
            skipBrowserRedirect: true,
          },
        });
        if (error) throw error;
        await Browser.open({ url: data.url, windowName: '_self', presentationStyle: 'popover' });
        return;
      }
      // === [/S09] ===
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

  // === [S09] Capacitor auth ===
  const handleAppleSignIn = async () => {
    if (!supabase) {
      setAuthError('Authentication is not configured.');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: 'recifriend://auth/callback',
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      await Browser.open({ url: data.url });
    } catch (error) {
      setAuthError(error.message || 'Failed to sign in with Apple.');
    } finally {
      setIsAuthLoading(false);
    }
  };
  // === [/S09] ===

  // === [S09] OTP state — mobile uses 6-digit code instead of magic link ===
  const [otpSentToEmail, setOtpSentToEmail] = useState('');  // email that received a code; empty = input email
  const [otpCode, setOtpCode] = useState('');
  // === [/S09] ===

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
      // === [S09] Native uses recifriend:// custom scheme for magic link redirect.
      // Flow: user taps email link in Mail → opens Safari → Safari GETs Supabase's
      // /verify → Supabase 302s to `recifriend://auth/callback?token_hash=…` →
      // Safari detects custom scheme → iOS opens ReciFriend app → app's
      // appUrlOpen listener fires → verifyOtp. Universal Link approach doesn't
      // work because Safari doesn't re-fire Universal Links mid-session.
      const emailBase = Capacitor.isNativePlatform()
        ? 'recifriend://auth/callback'
        : 'https://recifriend.com/auth/callback';
      // === [/S09] ===
      const emailRedirectTo = pendingId
        ? `${emailBase}?accept_friend=${encodeURIComponent(pendingId)}`
        : pendingInvite
          ? `${emailBase}?invite_token=${encodeURIComponent(pendingInvite)}`
          : pendingOpenInvite
            ? `${emailBase}?invite=${encodeURIComponent(pendingOpenInvite)}`
            : (pendingShareToken && pendingSaveShare)
              ? `${emailBase}?share=${encodeURIComponent(pendingShareToken)}`
              : emailBase;
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

  // === [S09] Verify the 6-digit OTP code (mobile only) ===
  const handleVerifyOtpCode = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const code = otpCode.trim();
    if (code.length < 6) {
      setAuthError('Enter the 6-digit code from your email.');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: otpSentToEmail,
        token: code,
        type: 'email',
      });
      if (error) throw error;
      // onAuthStateChange will close the dialog + clear UI
      setOtpSentToEmail('');
      setOtpCode('');
      setAuthEmail('');
    } catch (error) {
      setAuthError(error.message || 'Invalid or expired code.');
    } finally {
      setIsAuthLoading(false);
    }
  };
  // === [/S09] ===

  const handleLogout = async () => {
    if (!supabase) return;

    setAccountMenuAnchor(null);
    // === [S09] Capacitor auth ===
    if (Capacitor.isNativePlatform()) {
      try {
        const jwt = (await supabase.auth.getSession())?.data?.session?.access_token;
        const token = getCurrentApnsToken(); // provided by S11 pushClient
        if (token && jwt) {
          await fetch(`${API_BASE_URL}/devices/register`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ apns_token: token }),
          });
        }
      } catch { /* sign-out should always complete even if deregister fails */ }
    }
    // === [/S09] ===
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

    // Logged-out users see PublicLanding — no recipes loaded here
    if (!userId) {
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
          const serverCount = metaResponse?.count ?? 0;
          serverVersionRef.current = serverVersion;

          // Refetch on version bump OR when the cached list length disagrees with
          // the server meta count — guards against meta/list drift that would
          // otherwise leave the drawer showing a higher count than the list.
          if (serverVersion !== cached.version || serverCount !== cached.recipes.length) {
            const normalized = await fetchAllRecipes();
            setRecipes(normalized);
            saveRecipesToCache(normalized, userId, serverVersion);
            setRemoteState({ status: 'success', message: '' });
          } else {
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
    if (!mobileFilterDrawerOpen || !selectedMealType) return;
    const timer = setTimeout(() => {
      const container = mobileFilterChipsRef.current;
      if (!container) return;
      const selected = container.querySelector('[aria-pressed="true"]');
      if (!selected) return;
      const containerLeft = container.scrollLeft;
      const containerWidth = container.offsetWidth;
      const chipLeft = selected.offsetLeft;
      const chipWidth = selected.offsetWidth;
      container.scrollTo({ left: chipLeft - containerWidth / 2 + chipWidth / 2, behavior: 'smooth' });
    }, 250);
    return () => clearTimeout(timer);
  }, [mobileFilterDrawerOpen, selectedMealType]);

  // Capture Chrome/Android install prompt
  useEffect(() => {
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifriend-install-banner-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    if (onboardingOpen) return;
    let timer;
    const handler = (e) => {
      e.preventDefault();
      deferredInstallPrompt.current = e;
      timer = setTimeout(() => {
        if (!sessionStorage.getItem('invite_entry')) {
          setShowInstallBanner(true);
        }
      }, 30000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timer);
    };
  }, [onboardingOpen]);


  // Show install banner on iOS as soon as auth check completes (no login required)
  useEffect(() => {
    if (!isAuthChecked) return;
    if (!isIosSafari) return;
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifriend-install-banner-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    if (sessionStorage.getItem('invite_entry')) return;
    if (onboardingOpen) return;
    const timer = setTimeout(() => setShowInstallBanner(true), 30000);
    return () => clearTimeout(timer);
  }, [isAuthChecked, session, onboardingOpen]);

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

  // Handle ?add=1 deep link from nudge email
  useEffect(() => {
    if (!isAuthChecked) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('add') !== '1') return;
    window.history.replaceState({}, '', window.location.pathname);
    openAddDialog();
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

  // Fallback for the IntersectionObserver above: on iOS WebView the 1px sentinel
  // occasionally fails to fire, leaving the list stuck at the initial page size.
  // A passive window scroll listener triggers the next page once the user is
  // within 800px of the document bottom.
  useEffect(() => {
    if (visibleCount >= filteredRecipes.length) return undefined;
    const onScroll = () => {
      const scrolled = window.scrollY + window.innerHeight;
      const total = document.documentElement.scrollHeight;
      if (total - scrolled < 800) {
        setVisibleCount((prev) =>
          Math.min(prev + RESULTS_PAGE_SIZE, filteredRecipes.length)
        );
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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

  const handleMealTypeSelect = (value) => {
    setSelectedMealType((prev) => (prev === value ? '' : value));
    setCurrentView('recipes');
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

  // S09 dispatcher references this via ref to avoid temporal dead zone
  useEffect(() => {
    handleOpenRecipeDetailsRef.current = handleOpenRecipeDetails;
  }, [handleOpenRecipeDetails]);

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
    let handledByToken = false;
    console.log('[INVITE DEBUG] pendingInviteToken:', pendingInviteToken, 'inviteAcceptDispatchedRef:', inviteAcceptDispatchedRef.current);
    if (pendingInviteToken) {
      handledByToken = true;
      inviteAcceptDispatchedRef.current = true;
      sessionStorage.removeItem('pending_invite_token');
      console.log('[INVITE DEBUG] calling accept-invite with token:', pendingInviteToken);
      callRecipesApi('/friends/accept-invite', { method: 'POST', body: JSON.stringify({ token: pendingInviteToken }) }, accessToken)
        .then((res) => {
          console.log('[INVITE DEBUG] accept-invite SUCCESS, res:', res);
          setIsAuthDialogOpen(false);
          const name = res?.inviterName;
          setTimeout(() => {
            console.log('[INVITE DEBUG] showing snackbar (accept-invite path), name:', name);
            setSnackbarState({ open: true, message: name ? `You're now connected with ${name}` : "You're now connected!", severity: 'success', duration: 8000, anchorOrigin: { vertical: 'top', horizontal: 'center' } });
          }, 400);
          fetchFriends();
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifriend-install-banner-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 30000);
          }
        })
        .catch((err) => {
          console.log('[INVITE DEBUG] accept-invite FAILED, error:', err?.message);
          // Token-based accept failed (invite may have been consumed already).
          // Fall back to email match — if we just connected, show success instead of error.
          callRecipesApi('/friends/check-invites', { method: 'POST' }, accessToken)
            .then((res) => {
              console.log('[INVITE DEBUG] check-invites fallback, connected:', res?.connected);
              if (res?.connected?.length > 0) {
                setIsAuthDialogOpen(false);
                setTimeout(() => {
                  console.log('[INVITE DEBUG] showing snackbar (check-invites fallback path)');
                  setSnackbarState({ open: true, message: `You're now connected with ${res.connected.join(', ')}`, severity: 'success', duration: 8000, anchorOrigin: { vertical: 'top', horizontal: 'center' } });
                }, 400);
                fetchFriends();
              } else {
                console.log('[INVITE DEBUG] check-invites fallback: no new connections, showing error');
                setSnackbarState({ open: true, message: 'Could not process invite. It may have already been used.', severity: 'error' });
              }
            })
            .catch((err2) => {
              console.log('[INVITE DEBUG] check-invites fallback FAILED:', err2?.message);
              setSnackbarState({ open: true, message: 'Could not process invite. It may have already been used.', severity: 'error' });
            });
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
              message: name ? `You're now connected with ${name}!` : "You're now connected with your friend on ReciFriend!",
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
    // Works even if the invite_token was lost during OAuth redirect.
    // Skip if we already handled via token — avoids a race where check-invites deletes
    // the invite record before accept-invite can claim it, causing a spurious 404 error.
    // Also skip if a token was dispatched earlier this page load (Supabase may fire onAuthStateChange
    // with a refreshed token, re-running this effect after sessionStorage is already cleared).
    console.log('[INVITE DEBUG] bottom check-invites guard — handledByToken:', handledByToken, 'dispatched:', inviteAcceptDispatchedRef.current);
    if (handledByToken || inviteAcceptDispatchedRef.current) return;
    console.log('[INVITE DEBUG] calling bottom check-invites');
    callRecipesApi('/friends/check-invites', { method: 'POST' }, accessToken)
      .then((res) => {
        console.log('[INVITE DEBUG] bottom check-invites, connected:', res?.connected);
        if (res?.connected?.length > 0) {
          setTimeout(() => {
            console.log('[INVITE DEBUG] showing snackbar (bottom check-invites path)');
            setSnackbarState({ open: true, message: `You're now connected with ${res.connected.join(', ')}`, severity: 'success', duration: 8000, anchorOrigin: { vertical: 'top', horizontal: 'center' } });
          }, 400);
          fetchFriends();
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifriend-install-banner-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 30000);
          }
        }
      })
      .catch(() => { /* silent - best effort */ });
  }, [accessToken, isAuthChecked]);

  const handleVideoThumbnailClick = (event, recipe) => {
    event.preventDefault();
    event.stopPropagation();

    const targetUrl = recipe.sourceUrl?.trim();

    if (targetUrl) {
      if (isMobile) {
        // On mobile, navigate in the same tab so the back button
        // returns to ReciFriend with the recipe modal open
        window.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } else {
      setSnackbarState({
        open: true,
        message: 'This recipe does not have a video link.',
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
    if (session) setCurrentView('recipes');
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
    if (session) {
      setCurrentView('recipes');
    }
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
      // Fire-and-forget — log cook event server-side for future activity feed
      if (session && activeRecipe?.id) {
        callRecipesApi(`/recipes/${encodeURIComponent(activeRecipe.id)}/cook`, { method: 'POST' }, accessToken);
      }
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
    setIsFirstRecipe(false);
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
        // No abort signal — we intentionally let this outlive the form so a post-save PATCH can use the result
        const enrichPromise = callRecipesApi('/recipes/enrich', {
          method: 'POST',
          body: JSON.stringify({ sourceUrl, title: enrichTitle })
        }, accessToken);
        pendingEnrichRef.current = { promise: enrichPromise, sourceUrl };
        const enrichResponse = await enrichPromise;

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
      // URL changed without saving — discard stale enrich result
      if (pendingEnrichRef.current?.sourceUrl === sourceUrl) {
        pendingEnrichRef.current = null;
      }
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
      setCurrentView('recipes');
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

        // Background enrichment: if Gemini is still running, let it finish and PATCH the recipe
        const pendingEnrich = pendingEnrichRef.current;
        pendingEnrichRef.current = null;
        const savedHasIngredients = (savedRecipe.ingredients?.length ?? 0) > 0;
        const savedHasSteps = (savedRecipe.steps?.length ?? 0) > 0;
        if (pendingEnrich && pendingEnrich.sourceUrl === savedRecipe.sourceUrl && (!savedHasIngredients || !savedHasSteps)) {
          const savedAccessToken = accessToken;
          pendingEnrich.promise.then(async (enrichResponse) => {
            const enriched = enrichResponse?.enriched;
            if (!enriched) return;
            const enrichedIngredients = Array.isArray(enriched.ingredients) && enriched.ingredients.length > 0 ? enriched.ingredients : null;
            const enrichedSteps = Array.isArray(enriched.steps) && enriched.steps.length > 0 ? enriched.steps : null;
            if (!enrichedIngredients && !enrichedSteps) return;
            const patchRecipe = {
              ...savedRecipe,
              ingredients: savedHasIngredients ? savedRecipe.ingredients : (enrichedIngredients ?? savedRecipe.ingredients ?? []),
              steps: savedHasSteps ? savedRecipe.steps : (enrichedSteps ?? savedRecipe.steps ?? []),
              mealTypes: savedRecipe.mealTypes?.length ? savedRecipe.mealTypes : (enriched.mealTypes ?? []),
              durationMinutes: savedRecipe.durationMinutes ?? enriched.durationMinutes ?? null,
            };
            try {
              const updated = await callRecipesApi(`/recipes/${savedRecipe.id}`, {
                method: 'PUT',
                body: JSON.stringify({ recipe: patchRecipe })
              }, savedAccessToken);
              const updatedRecipe = normalizeRecipeFromApi(updated?.recipe);
              if (updatedRecipe) {
                setRecipes((prev) => prev.map((r) => r.id === updatedRecipe.id ? updatedRecipe : r));
              }
            } catch (err) {
              console.warn('Background enrichment patch failed:', err);
            }
          }).catch(() => {}); // AbortError or network failure — auto-fill button is the fallback
        }

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

  const openShareSheet = (recipe, event) => {
    const anchorPosition = event?.currentTarget
      ? { top: event.currentTarget.getBoundingClientRect().bottom, left: event.currentTarget.getBoundingClientRect().left }
      : { top: window.innerHeight / 2, left: window.innerWidth / 2 };
    if (!session) {
      shareLoggedOutDirect(recipe, anchorPosition);
      return;
    }
    setShareSheetState({ recipe, anchorPosition });
  };

  const shareLoggedOutDirect = async (recipe, anchorPosition) => {
    const url = recipe.id && recipe.userId
      ? `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(recipe.id)}&user=${encodeURIComponent(recipe.userId)}`
      : SHARE_PUBLIC_URL;
    if (navigator.share) {
      try {
        await navigator.share({ title: recipe.title, text: `Check out this recipe on ReciFriend: ${recipe.title}`, url });
        trackEvent('share_recipe', { method: 'native_share' });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    setShareMenuState({ anchorPosition, url, title: recipe.title, imageUrl: recipe.imageUrl || '' });
  };

  const handleShareSheetPickFriends = () => {
    const state = shareSheetState;
    setShareSheetState(null);
    if (state) triggerNativeShare(state.recipe, state.anchorPosition);
  };

  const handleShareSheetPickConnections = () => {
    const state = shareSheetState;
    setShareSheetState(null);
    if (state?.recipe?.id) openSharePicker(state.recipe.id);
  };

  const triggerNativeShare = async (recipe, anchorPosition) => {
    try {
      // Build the share URL synchronously when possible so navigator.share is
      // called inside the user-gesture window. Token URLs require an API
      // round-trip and routinely break the gesture timing on iOS Safari.
      const ownerId = recipe.userId || session?.user?.id || null;
      const recipeId = typeof recipe.id === 'string' && !recipe.id.startsWith('recipe-') ? recipe.id : null;
      const shareUrl = recipeId && ownerId
        ? `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(recipeId)}&user=${encodeURIComponent(ownerId)}`
        : SHARE_PUBLIC_URL;

      if (navigator.share) {
        try {
          await navigator.share({ title: recipe.title, text: `Check out this recipe on ReciFriend: ${recipe.title}`, url: shareUrl });
          trackEvent('share_recipe', { method: 'native_share' });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      setShareMenuState({ anchorPosition, url: shareUrl, title: recipe.title, imageUrl: recipe.imageUrl || '' });
    } catch (error) {
      console.error('Error sharing:', error);
      setSnackbarState({ open: true, message: 'Failed to share', severity: 'error' });
    }
  };

  // === [S04] Friend picker wiring ===
  const openSharePicker = (recipeId) => {
    setPickerRecipeId(recipeId);
    setPickerOpen(true);
  };

  const handlePickerSend = async (recipientUserIds) => {
    setSnackbarState({ open: true, message: 'Sending…', severity: 'info' });
    let result;
    try {
      result = await shareRecipe({ apiBase: API_BASE_URL, jwt: accessToken, recipeId: pickerRecipeId, recipientUserIds });
    } catch (err) {
      console.error('shareRecipe threw:', err);
      const detail = `${err?.name || 'Error'}: ${err?.message || String(err)} | recipe=${pickerRecipeId} | api=${API_BASE_URL} | token=${accessToken ? 'yes' : 'NO'}`;
      setSnackbarState({ open: true, message: detail, severity: 'error' });
      return { ok: false, error: { code: 'EXCEPTION' } };
    }
    try { triggerSoftPromptIfNeeded('recipe-shared'); } catch {}
    if (result?.ok) {
      // Always report the number of friends the user selected, not the DB "changes"
      // count — INSERT OR IGNORE returns 0 for duplicates, which reads as a failure
      // to the user even though every selected friend now has access.
      const count = recipientUserIds.length;
      setSnackbarState({ open: true, message: `Shared with ${count} friend${count === 1 ? '' : 's'}`, severity: 'success' });
    } else {
      const code = result?.error?.code;
      // HttpError responses use { error: "<message>" } instead of { code }; surface either.
      const errMsg = result?.error?.error || result?.error?.message;
      const msg = code === 'RATE_LIMITED'
        ? "You've shared too much recently. Try again later."
        : code === 'NOT_FRIENDS'
          ? "Some of those friends aren't connected with you yet."
          : code === 'FORBIDDEN'
            ? "You can't reshare this recipe — only the owner can."
            : code
              ? `Failed to share (${code}).`
              : `Failed to share${errMsg ? `: ${errMsg}` : ''}.`;
      console.warn('share failed:', result?.error);
      setSnackbarState({ open: true, message: msg, severity: 'error' });
    }
    return result;
  };

  const handlePickerClose = async (action) => {
    setPickerOpen(false);
    if (action === 'copy-link') {
      let shareUrl = null;
      if (API_BASE_URL && accessToken && pickerRecipeId) {
        try {
          const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(pickerRecipeId)}/share-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          });
          if (response.ok) {
            const { token } = await response.json();
            shareUrl = `${SHARE_PUBLIC_URL}?share=${token}`;
          }
        } catch (err) {
          console.error('Share token error:', err);
        }
      }
      // Fallback: query-param URL (no token needed, works without auth)
      if (!shareUrl && pickerRecipeId) {
        const uid = session?.user?.id;
        shareUrl = uid
          ? `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(pickerRecipeId)}&user=${encodeURIComponent(uid)}`
          : `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(pickerRecipeId)}`;
      }
      if (shareUrl) {
        navigator.clipboard.writeText(shareUrl);
      }
    }
  };
  // === [/S04] ===

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', paddingTop: 'env(safe-area-inset-top)' }}>
        <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: { xs: '50px', sm: 'calc(64px - 16px)' } }}>
          <IconButton
            onClick={() => setMobileFilterDrawerOpen(true)}
            sx={{ display: { xs: 'flex', sm: 'none' }, mr: -1 }}
            aria-label="Open menu"
          >
            <Badge badgeContent={0} color="error" overlap="circular">
              <MenuIcon />
            </Badge>
          </IconButton>
          <Typography
            variant="h6"
            component="div"
            onClick={() => setCurrentView('home')}
            sx={{ flexGrow: 1, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}
          >
            ReciFriend
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
                borderRadius: '999px',
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
                <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: '6px' }}>
                  <Tooltip title="Friends">
                    <IconButton
                      onClick={() => {
                        setIsFriendsDialogOpen(true);
                        fetchFriends();
                        fetchFriendRequests();
                      }}
                      color="inherit"
                    >
                      <Badge badgeContent={0} color="error" overlap="circular">
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
                      {recipes.length} recipes
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
                </Box>
              ) : (
                <Button color={darkMode ? 'inherit' : 'primary'} variant="text" onClick={openAuthDialog}>
                  Login
                </Button>
              )
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      {/* Mobile nav drawer — replaces account menu on xs */}
      <Drawer
        anchor="left"
        open={mobileFilterDrawerOpen}
        onClose={() => setMobileFilterDrawerOpen(false)}
        transitionDuration={{ enter: 300, exit: 350 }}
        PaperProps={{
          sx: {
            width: 270,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {})
          }
        }}
      >
        {/* Profile header — logged in only */}
        {session && (
          <>
            <Box sx={{ px: 2.5, pt: 3, pb: 2 }}>
              {/* Avatar + name row */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48, fontSize: '1.25rem', flexShrink: 0 }}>
                  {(userProfile?.displayName || session.user?.email || 'U').charAt(0).toUpperCase()}
                </Avatar>
                {isDrawerEditingName ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                    <InputBase
                      autoFocus
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      inputProps={{ maxLength: 50 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editNameValue.trim()) updateDisplayName(editNameValue.trim());
                        if (e.key === 'Escape') setIsDrawerEditingName(false);
                      }}
                      sx={{
                        flex: 1,
                        fontWeight: 700,
                        fontSize: '1rem',
                        color: 'text.primary',
                        borderBottom: '2px solid',
                        borderColor: 'primary.main',
                        '& input': { p: 0, pb: 0.25 },
                        minWidth: 0,
                      }}
                    />
                    <IconButton
                      size="small"
                      sx={{ p: 0.5, color: 'primary.main' }}
                      onClick={() => { if (editNameValue.trim()) updateDisplayName(editNameValue.trim()); }}
                    >
                      <CheckIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton size="small" sx={{ p: 0.5 }} onClick={() => setIsDrawerEditingName(false)}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                ) : (
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => { setEditNameValue(userProfile?.displayName || ''); setIsDrawerEditingName(true); }}
                  >
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                      {userProfile?.displayName || session.user?.email?.split('@')[0] || 'User'}
                    </Typography>
                    <EditIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                  </Box>
                )}
              </Box>
              {/* Email + recipe count below */}
              <Typography variant="body2" color="text.secondary" noWrap>
                {session.user?.email || ''}
              </Typography>
              <Box
                component="button"
                onClick={() => {
                  setCurrentView('recipes');
                  setMobileFilterDrawerOpen(false);
                }}
                sx={(theme) => ({
                  display: 'flex', alignItems: 'center', width: '100%',
                  mt: 1, px: 0, py: 0.75, gap: 1, border: 'none', bgcolor: 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit', color: 'text.secondary',
                  borderRadius: 1,
                  '&:hover': { color: 'text.primary' },
                })}
              >
                <Typography sx={{ fontSize: 18, lineHeight: 1 }}>🍳</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, textAlign: 'left' }}>Recipes</Typography>
                <Typography variant="body2">{recipes.length}</Typography>
              </Box>
            </Box>
            <Divider />

          </>
        )}

        {/* Filter by meal type — recipes view only */}
        {session && currentView === 'recipes' && <Box sx={{ px: 2.5, pt: 2, pb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5, fontSize: 13, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Filter
          </Typography>
          <Box ref={mobileFilterChipsRef} sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 1, '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none', mx: -2.5, px: 2.5, maskImage: 'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)' }}>
            {availableMealTypes.map((type) => {
              const label = MEAL_TYPE_LABELS[type] || type.replace(/^\w/, (c) => c.toUpperCase());
              const icon = MEAL_TYPE_ICONS[type];
              const selected = selectedMealType === type;
              return (
                <Box
                  key={type}
                  component="button"
                  onClick={() => {
                    handleMealTypeSelect(type);
                    setTimeout(() => setMobileFilterDrawerOpen(false), 400);
                  }}
                  aria-pressed={selected}
                  sx={(theme) => ({
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    height: 36, px: 1.5, border: 'none', borderRadius: '999px',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem',
                    fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                    ...(selected ? {
                      bgcolor: 'primary.main', color: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    } : {
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                      color: 'text.primary',
                      '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)' },
                    }),
                  })}
                >
                  {icon && (
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 22, height: 22, borderRadius: '50%', fontSize: '0.875rem',
                        bgcolor: selected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </Box>
                  )}
                  {label}
                </Box>
              );
            })}
          </Box>
        </Box>}

        {/* Nav shortcuts */}
        {session && (
          <>
            <Divider />
            <Box sx={{ py: 1 }}>
              {/* Favorites */}
              {favorites.size > 0 && (
                <Box
                  component="button"
                  onClick={() => {
                    setShowFavoritesOnly((prev) => !prev);
                    setCurrentView('recipes');
                    setTimeout(() => setMobileFilterDrawerOpen(false), 300);
                  }}
                  sx={(theme) => ({
                    display: 'flex', alignItems: 'center', width: '100%',
                    px: 2.5, py: 1.25, gap: 1.5, border: 'none', bgcolor: 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'text.primary',
                    '&:hover': { bgcolor: theme.palette.action.hover },
                  })}
                >
                  {showFavoritesOnly
                    ? <FavoriteIcon sx={{ fontSize: 22, color: '#E53935' }} />
                    : <FavoriteBorderIcon sx={{ fontSize: 22, color: 'text.secondary' }} />}
                  <Typography variant="body2" fontWeight={500} sx={{ flex: 1, textAlign: 'left' }}>Favorites</Typography>
                  <Typography variant="body2" color="text.secondary">{favorites.size}</Typography>
                </Box>
              )}

              {/* Friends */}
              <Box
                component="button"
                onClick={() => {
                  setMobileFilterDrawerOpen(false);
                  setIsFriendsDialogOpen(true);
                  fetchFriends();
                  fetchFriendRequests();
                }}
                sx={(theme) => ({
                  display: 'flex', alignItems: 'center', width: '100%',
                  px: 2.5, py: 1.25, gap: 1.5, border: 'none', bgcolor: 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit', color: 'text.primary',
                  '&:hover': { bgcolor: theme.palette.action.hover },
                })}
              >
                <Badge badgeContent={0} color="error" overlap="circular">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: darkMode ? 'rgba(255,255,255,0.7)' : '#616161',width:22,height:22,flexShrink:0}}>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </Badge>
                <Typography variant="body2" fontWeight={500} sx={{ flex: 1, textAlign: 'left' }}>Friends</Typography>
                {friends.length > 0 && (
                  <Typography variant="body2" color="text.secondary">{friends.length}</Typography>
                )}
              </Box>

              {/* Invite a friend */}
              <Box
                component="button"
                onClick={() => {
                  setMobileFilterDrawerOpen(false);
                  setIsFriendsDialogOpen(true);
                  setIsAddFriendOpen(true);
                  fetchFriends();
                }}
                sx={(theme) => ({
                  display: 'flex', alignItems: 'center', width: '100%',
                  px: 2.5, py: 1.25, gap: 1.5, border: 'none', bgcolor: 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit', color: 'text.primary',
                  '&:hover': { bgcolor: theme.palette.action.hover },
                })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: darkMode ? 'rgba(255,255,255,0.7)' : '#616161',width:22,height:22,flexShrink:0}}>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <line x1="19" y1="7" x2="19" y2="13"/>
                    <line x1="16" y1="10" x2="22" y2="10"/>
                  </svg>
                <Typography variant="body2" fontWeight={500} sx={{ flex: 1, textAlign: 'left' }}>Invite a friend</Typography>
              </Box>
            </Box>
          </>
        )}

        {/* Settings */}
        <Box>
          {session && <Divider />}
          <Box sx={{ py: 1 }}>
            {/* Dark mode */}
            <Box
              component="button"
              onClick={toggleDarkMode}
              sx={(theme) => ({
                display: 'flex', alignItems: 'center', width: '100%',
                px: 2.5, py: 1.25, gap: 1.5, border: 'none', bgcolor: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', color: 'text.primary',
                '&:hover': { bgcolor: theme.palette.action.hover },
              })}
            >
              <DarkModeOutlinedIcon sx={{ fontSize: 22, color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight={500} sx={{ flex: 1, textAlign: 'left' }}>Dark mode</Typography>
              <Switch size="small" checked={darkMode} sx={{ pointerEvents: 'none' }} />
            </Box>
          </Box>
        </Box>

        {/* Logout / Login — sticky bottom */}
        <Box sx={{ mt: 'auto' }}>
          <Divider />
          {session ? (
            <Box
              component="button"
              onClick={() => { setMobileFilterDrawerOpen(false); handleLogout(); }}
              sx={(theme) => ({
                display: 'flex', alignItems: 'center', width: '100%',
                px: 2.5, py: 1.5, gap: 1.5, border: 'none', bgcolor: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', color: 'text.primary',
                pb: 'max(env(safe-area-inset-bottom), 12px)',
                '&:hover': { bgcolor: theme.palette.action.hover },
              })}
            >
              <LogoutIcon sx={{ fontSize: 22, color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight={500}>Logout</Typography>
            </Box>
          ) : supabase && (
            <Box
              component="button"
              onClick={() => { setMobileFilterDrawerOpen(false); openAuthDialog(); }}
              sx={(theme) => ({
                display: 'flex', alignItems: 'center', width: '100%',
                px: 2.5, py: 1.5, gap: 1.5, border: 'none', bgcolor: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', color: 'primary.main',
                pb: 'max(env(safe-area-inset-bottom), 12px)',
                '&:hover': { bgcolor: theme.palette.action.hover },
              })}
            >
              <AccountCircleIcon sx={{ fontSize: 22 }} />
              <Typography variant="body2" fontWeight={500}>Login</Typography>
            </Box>
          )}
        </Box>
      </Drawer>

      <WelcomeModal
        open={welcomeOpen}
        onDismiss={handleWelcomeDismiss}
        onSkip={handleWelcomeSkip}
        inviterName={inviterName}
        recipes={welcomeRecipes}
      />
      <OnboardingFlow
        open={onboardingOpen}
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
        onDismiss={handleOnboardingDismiss}
      />

      <ShareSheet
        open={Boolean(shareSheetState)}
        onClose={() => setShareSheetState(null)}
        onPickFriends={handleShareSheetPickFriends}
        onPickConnections={handleShareSheetPickConnections}
        darkMode={darkMode}
      />

      {/* === [S04] Friend picker wiring === */}
      <FriendPicker
        open={pickerOpen}
        friends={(friends || []).map(f => ({
          id: f.id ?? f.friendId,
          display_name: f.display_name ?? f.friendName ?? f.friendEmail,
          avatar_url: f.avatar_url ?? f.avatarUrl ?? null,
        }))}
        onClose={handlePickerClose}
        onSend={handlePickerSend}
        darkMode={darkMode}
      />
      {/* === [/S04] === */}

      {/* === [S11] Push client === */}
      <NotificationSoftPrompt
        open={softPromptOpen}
        context={softPromptContext}
        onAccept={handleSoftPromptAccept}
        onDismiss={() => setSoftPromptOpen(false)}
      />
      {/* === [/S11] === */}

      {/* Logged-out: show discovery landing page. Only render after auth is checked to avoid flash. */}
      {!session && isAuthChecked && (
        <PublicLanding
          onJoin={openAuthDialog}
          onOpenRecipe={handleOpenRecipeDetails}
          darkMode={darkMode}
          onCookWithFriendsVisible={setCookWithFriendsVisible}
          onShare={(recipe, event) => openShareSheet(recipe, event)}
        />
      )}

      {(session || !isAuthChecked) && (<Container maxWidth="lg" disableGutters>
        <Box
          sx={{
            px: { xs: 2, sm: 3, md: 4 },
            pt: { xs: 2, md: 'calc(32px - 10px)' }, pb: { xs: 3, md: 4 }
          }}
        >
          <Stack spacing={1.5}>
            {currentView === 'home' && session && (
              <>
                <StatsTiles
                  recipeCount={recipes.length}
                  friendCount={friendsLoaded ? friends.length : null}
                  onAddRecipe={openAddDialog}
                  onViewRecipes={() => setCurrentView('recipes')}
                  onAddFriends={() => { setIsFriendsDialogOpen(true); setIsAddFriendOpen(true); fetchFriends(); }}
                  onViewFriends={() => setIsFriendsDialogOpen(true)}
                />
                <Box ref={statsTilesRef} sx={{ height: 0 }} />
                <Box sx={{ mt: '70px' }}>
                <FriendSections
                  accessToken={accessToken}
                  cookingFor={userProfile?.cookingFor ?? null}
                  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
                  dietaryPrefs={userProfile?.dietaryPrefs ?? null}
                  onOpenRecipe={handleOpenEditorPickRecipe}
                  onSaveRecipe={handleSavePublicRecipe}
                  onShareRecipe={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
                  onInviteFriend={() => setIsFriendsDialogOpen(true)}
                  onOpenFriends={() => setIsFriendsDialogOpen(true)}
                  darkMode={darkMode}
                  onCookWithFriendsVisible={setCookWithFriendsVisible}
                />
                </Box>
              </>
            )}
            {currentView === 'recipes' && (
              <RecipesPage
                displayedRecipes={displayedRecipes}
                filteredRecipes={filteredRecipes}
                totalRecipes={recipes.length}
                accessToken={accessToken}
                onSaveSuggestion={handleSavePublicRecipe}
                onOpenSuggestion={handleOpenEditorPickRecipe}
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
                isMobile={isMobile}
                searchBarRef={searchBarRef}
                handleOpenRecipe={handleOpenRecipeDetails}
                toggleFavorite={toggleFavorite}
                handleShare={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
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
          </Stack>
        </Box>
      </Container>)}

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={shareMenuState?.anchorPosition}
        open={Boolean(shareMenuState)}
        onClose={() => setShareMenuState(null)}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={async () => {
          const { url, title } = shareMenuState;
          setShareMenuState(null);
          if (navigator.share) {
            try {
              await navigator.share({ title, text: `Check out this recipe on ReciFriend: ${title}`, url });
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
          const body = encodeURIComponent(`Check out this recipe on ReciFriend: ${title}\n\n${url}`);
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
          trackEvent('share_recipe', { method: 'email' });
        }}>
          <ListItemIcon><EmailOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Email</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          const { url, title } = shareMenuState;
          setShareMenuState(null);
          const body = encodeURIComponent(`Check out this recipe: ${title}\n\n${url}`);
          window.open(`sms:?body=${body}`);
          trackEvent('share_recipe', { method: 'sms' });
        }}>
          <ListItemIcon><SmsOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Text</ListItemText>
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
            flexDirection: 'column',
            borderRadius: 0,
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            // Dark mode: kill MUI's elevation grey overlay so the safe-area
            // padding blends into the dialog instead of showing as a grey band.
            ...(darkMode ? { backgroundColor: '#121212', backgroundImage: 'none' } : {}),
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
                  <IconButton aria-label="Close recipe details" edge="end" onClick={closeDialog} sx={{ flexShrink: 0, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', borderRadius: '50%', p: 1 }}>
                    <CloseIcon fontSize="small" />
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
                    role={activeRecipeView.sourceUrl ? 'button' : undefined}
                    aria-label={activeRecipeView.sourceUrl ? `Open ${activeRecipeView.title} source` : undefined}
                    tabIndex={activeRecipeView.sourceUrl ? 0 : undefined}
                    onClick={activeRecipeView.sourceUrl ? (event) => handleVideoThumbnailClick(event, activeRecipeView) : undefined}
                    onKeyDown={activeRecipeView.sourceUrl ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        handleVideoThumbnailClick(event, activeRecipeView);
                      }
                    } : undefined}
                    sx={{
                      position: 'relative',
                      flexShrink: 0,
                      width: isMobile && isStickyStuck ? 64 : '100%',
                      borderRadius: isMobile && isStickyStuck ? 1.5 : (isMobile ? 0 : 2),
                      overflow: 'hidden',
                      height: isMobile && isStickyStuck ? 64 : { xs: 190, md: 250 },
                      cursor: activeRecipeView.sourceUrl ? 'pointer' : 'default',
                      transition: 'all 250ms ease',
                      '&:hover .dialog-play-overlay': { opacity: activeRecipeView.sourceUrl ? 1 : 0 }
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
            <DialogActions sx={{ justifyContent: (isSharedRecipeView || !session) ? 'space-between' : 'flex-end', gap: 1, px: (isSharedRecipeView || !session) ? '24px' : (isEditMode && !isSharedRecipeView ? 0 : 1), ...(isEditMode && !isSharedRecipeView ? (darkMode ? { backgroundColor: '#121212', borderTop: '1px solid rgba(255, 255, 255, 0.13)' } : { backgroundColor: '#fff', borderTop: '1px solid rgba(0, 0, 0, 0.12)' }) : (darkMode ? { backgroundColor: '#121212', borderTop: '1px solid rgba(255, 255, 255, 0.13)' } : {})) }}>
              {isSharedRecipeView ? (
                <>
                  {/* === [S04] Friend picker wiring === */}
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<IosShareOutlinedIcon />}
                    sx={{ flex: 1 }}
                    onClick={(e) => openShareSheet(activeRecipe, e)}
                  >
                    Share
                  </Button>
                  {/* === [/S04] === */}
                  <Button
                    variant={savedSharedRecipeIds.has(activeRecipe?.id) ? 'outlined' : 'contained'}
                    color="primary"
                    onClick={savedSharedRecipeIds.has(activeRecipe?.id) ? undefined : handleSaveSharedRecipe}
                    startIcon={savedSharedRecipeIds.has(activeRecipe?.id) ? <CheckIcon /> : <BookmarkBorderIcon />}
                    sx={{ flex: 1, ...(savedSharedRecipeIds.has(activeRecipe?.id) ? { pointerEvents: 'none', border: '1px solid #4caf50', color: '#4caf50' } : {}) }}
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
                    sx={{ flex: 1 }}
                  >
                    Share
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<BookmarkBorderIcon />}
                    onClick={openAuthDialog}
                    sx={{ flex: 1 }}
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
        <DialogActions sx={{ px: '24px' }}>
          <Button onClick={closeDeleteConfirm} sx={(theme) => ({ ...(theme.palette.mode === 'dark' && { color: '#fff' }) })}>Cancel</Button>
          <Button onClick={handleDeleteRecipe} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Recipe — bottom drawer on mobile, centered dialog on desktop */}
      {isMobile ? (
        <Drawer
          anchor="bottom"
          open={isAddDialogOpen}
          onClose={closeAddDialog}
          data-testid="add-recipe-dialog"
          PaperProps={{
            component: 'form',
            onSubmit: handleAddRecipeSubmit,
            sx: {
              borderRadius: '16px 16px 0 0',
              paddingBottom: 'env(safe-area-inset-bottom)',
              ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
            },
          }}
        >
          {/* Drag handle — swipe down to close */}
          <Box
            onTouchStart={(e) => { drawerTouchStartY.current = e.touches[0].clientY; }}
            onTouchEnd={(e) => {
              if (drawerTouchStartY.current === null) return;
              const delta = e.changedTouches[0].clientY - drawerTouchStartY.current;
              drawerTouchStartY.current = null;
              if (delta > 40) closeAddDialog();
            }}
            sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 0.5, flexShrink: 0, cursor: 'grab', touchAction: 'none' }}
          >
            <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: darkMode ? 'rgba(255,255,255,0.3)' : 'grey.300' }} />
          </Box>
          {/* Title */}
          <Box sx={{ px: 3, pt: 1, pb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{isFirstRecipe ? 'Add your first recipe' : 'Add recipe'}</Typography>
          </Box>
          {/* Fields */}
          <Box sx={{ px: 3, pt: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
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
                (isFirstRecipe ? 'Paste an Instagram, TikTok or YouTube link' : 'Link to the original recipe or video.')
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
          </Box>
          {/* Actions */}
          <Box sx={{ px: 3, pb: 2, pt: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Button type="submit" variant="contained" sx={{ px: 4, width: '100%', maxWidth: 280 }}>
              Save recipe
            </Button>
            <Typography
              component="button"
              type="button"
              onClick={closeAddDialog}
              sx={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'text.secondary',
                fontSize: '0.8rem',
                p: 0,
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Cancel
            </Typography>
          </Box>
        </Drawer>
      ) : (
        <Dialog
          open={isAddDialogOpen}
          onClose={closeAddDialog}
          fullWidth
          maxWidth="sm"
          aria-labelledby="add-recipe-dialog-title"
          data-testid="add-recipe-dialog"
          component="form"
          onSubmit={handleAddRecipeSubmit}
        >
          <DialogTitle id="add-recipe-dialog-title">{isFirstRecipe ? 'Add your first recipe' : 'Add recipe'}</DialogTitle>
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
                (isFirstRecipe ? 'Paste an Instagram, TikTok or YouTube link' : 'Link to the original recipe or video.')
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
            <Box sx={{ px: 2, display: 'flex', justifyContent: 'space-between', width: '100%' }}>
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
      )}

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
          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5, pb: 1, flexShrink: 0, cursor: 'grab', touchAction: 'none' }}
        >
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: darkMode ? 'rgba(255,255,255,0.3)' : 'grey.300', mb: 1.5 }} />
          {!selectedFriend && (
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Friends</Typography>
          )}
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
          sx={{ flex: 1, overflowY: 'auto', pt: 0, px: 2, pb: 2 }}
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
                    <RecipeListCard
                      key={recipe.id}
                      recipe={recipe}
                      onOpen={() => {
                        setIsSharedRecipeView(true);
                        setActiveRecipe(recipe);
                        setActiveRecipeDraft(null);
                      }}
                      onSave={() => handleSavePublicRecipe(recipe)}
                      onShare={(r, e) => openShareSheet(r, e)}
                      cardSx={darkMode ? { backgroundColor: 'transparent' } : {}}
                    />
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
            <Box sx={{ pt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
                Share a link with friends to connect
              </Typography>

              {openInviteLinkLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <>
                  {/* Icon tile row */}
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mb: 3 }}>
                    {[
                      {
                        icon: <EmailOutlinedIcon sx={{ fontSize: 26 }} />,
                        label: 'Email',
                        onClick: async () => {
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
                          const subject = encodeURIComponent('Join me on ReciFriend!');
                          const body = encodeURIComponent(`Hey! I'd love to share recipes with you on ReciFriend.\n\nJoin me here: ${window.location.origin}?invite=${token}`);
                          window.location.href = `mailto:?subject=${subject}&body=${body}`;
                          trackEvent('invite_friend', { method: 'email' });
                        },
                      },
                      {
                        icon: <SmsOutlinedIcon sx={{ fontSize: 26 }} />,
                        label: 'Text',
                        onClick: async () => {
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
                          const text = `Hey! I'd love to share recipes with you on ReciFriend. Join me here: ${inviteUrl}`;
                          if (navigator.share) {
                            try {
                              await navigator.share({ text, url: inviteUrl });
                              trackEvent('invite_friend', { method: 'native_share' });
                              return;
                            } catch (err) {
                              if (err.name === 'AbortError') return;
                            }
                          }
                          window.open(`sms:?body=${encodeURIComponent(text)}`);
                          trackEvent('invite_friend', { method: 'sms' });
                        },
                      },
                      {
                        icon: <ContentCopyIcon sx={{ fontSize: 26 }} />,
                        label: 'Copy link',
                        onClick: async () => {
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
                        },
                      },
                    ].map(({ icon, label, onClick }) => (
                      <Box
                        key={label}
                        onClick={onClick}
                        sx={(theme) => ({
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                          width: 88, height: 88, borderRadius: 3, cursor: 'pointer',
                          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                          '&:active': { opacity: 0.7 },
                          transition: 'opacity 0.15s',
                        })}
                      >
                        {icon}
                        <Typography variant="caption" sx={{ fontWeight: 500 }}>{label}</Typography>
                      </Box>
                    ))}
                  </Box>

                  {openInviteLink && (
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        sx={{ opacity: 0.5, fontSize: '0.75rem' }}
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
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', px: 3 }}>
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <BoppingFruitsIllustration />
                <Box sx={{ mt: '30px' }}>
                  <Typography sx={{ fontWeight: 400, fontSize: 20, mb: 0.5, whiteSpace: 'nowrap' }}>
                    Cooking is better with friends
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Tap &ldquo;Add Friend&rdquo; to get started
                  </Typography>
                </Box>
              </Box>
              <Box
                sx={{
                  '@keyframes bopDown': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(8px)' },
                  },
                  animation: 'bopDown 1.2s ease-in-out infinite',
                  color: 'text.secondary',
                  pb: 0.5,
                }}
              >
                <ExpandMoreIcon sx={{ fontSize: '2.5rem' }} />
              </Box>
            </Box>
          ) : (
            <>
              <List disablePadding>
              {friends.map((friend) => (
                <ListItemButton
                  key={friend.friendId}
                  onClick={() => fetchFriendRecipes(friend)}
                  sx={{ pl: 0 }}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: getAvatarColor(friend.friendId) }}>
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
            </>
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
        <DialogActions sx={{ px: '24px' }}>
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
        autoHideDuration={snackbarState.duration ?? 4000}
        onClose={handleSnackbarClose}
        anchorOrigin={snackbarState.anchorOrigin}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarState.severity} sx={{ width: '100%' }}>
          {snackbarState.message}
        </Alert>
      </Snackbar>

      <Drawer
        anchor="bottom"
        open={showInstallBanner && isMobile && !mobileFilterDrawerOpen && !isAddDialogOpen && !isFriendsDialogOpen}
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
            alt="ReciFriend"
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
                localStorage.setItem('recifriend-install-banner-dismissed', '1');
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
            localStorage.setItem('recifriend-install-banner-dismissed', '1');
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

            {/* === [S09] Capacitor auth — Apple sign-in (iOS only) === */}
            {Capacitor.isNativePlatform() && (
              <Button
                variant="contained"
                fullWidth
                disabled={isAuthLoading}
                onClick={handleAppleSignIn}
                sx={{
                  textTransform: 'none',
                  fontWeight: 500,
                  fontSize: '0.95rem',
                  py: 1.2,
                  backgroundColor: '#000',
                  color: '#fff',
                  '&:hover': { backgroundColor: '#222' },
                }}
              >
                Continue with Apple
              </Button>
            )}
            {/* === [/S09] === */}

            <Divider sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>or</Divider>

            {/* === [S09] Native: show OTP code input after email sent === */}
            {otpSentToEmail ? (
              <Box component="form" onSubmit={handleVerifyOtpCode}>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    We sent a 6-digit code to <strong>{otpSentToEmail}</strong>. Enter it below.
                  </Typography>
                  <TextField
                    label="6-digit code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(e) => {
                      setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setAuthError('');
                    }}
                    required
                    fullWidth
                    placeholder="123456"
                    inputProps={{ maxLength: 6, pattern: '[0-9]*' }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    disabled={isAuthLoading || otpCode.length < 6}
                    startIcon={isAuthLoading ? <CircularProgress size={18} /> : null}
                  >
                    Verify code
                  </Button>
                  <Button
                    size="small"
                    onClick={() => { setOtpSentToEmail(''); setOtpCode(''); setAuthError(''); }}
                    disabled={isAuthLoading}
                    sx={{ textTransform: 'none' }}
                  >
                    Use a different email
                  </Button>
                </Stack>
              </Box>
            ) : (
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
            )}
            {/* === [/S09] === */}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAuthDialog} sx={(theme) => ({ ...(theme.palette.mode === 'dark' && { color: '#fff' }) })}>Cancel</Button>
        </DialogActions>
      </Dialog>
      {/* Invite Friends Sheet */}
      <Drawer
        anchor="bottom"
        open={isInviteSheetOpen}
        onClose={() => setIsInviteSheetOpen(false)}
        PaperProps={{ sx: { borderRadius: '16px 16px 0 0', pb: 'env(safe-area-inset-bottom)' } }}
      >
        <Box sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 17, mb: 0.5 }}>Invite Friends</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2.5 }}>
            Share ReciFriend with people you cook with
          </Typography>
          <Stack spacing={1.5}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<EmailOutlinedIcon />}
              disabled={inviteSheetLoading || !inviteSheetUrl}
              onClick={() => {
                const subject = encodeURIComponent('Join me on ReciFriend!');
                const body = encodeURIComponent(`Hey! I'm using ReciFriend to save and share recipes. Join me here: ${inviteSheetUrl}`);
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
              }}
              sx={{ borderRadius: '999px', textTransform: 'none', fontWeight: 700 }}
            >
              Email
            </Button>
            <Button
              fullWidth
              variant="contained"
              startIcon={<SmsOutlinedIcon />}
              disabled={inviteSheetLoading || !inviteSheetUrl}
              onClick={() => {
                const msg = encodeURIComponent(`Hey! I'm using ReciFriend to save and share recipes. Join me: ${inviteSheetUrl}`);
                window.open(`sms:?body=${msg}`);
              }}
              sx={{ borderRadius: '999px', textTransform: 'none', fontWeight: 700 }}
            >
              Text
            </Button>
            <Button
              fullWidth
              variant="outlined"
              startIcon={inviteSheetLoading ? <CircularProgress size={16} /> : <ContentCopyIcon />}
              disabled={inviteSheetLoading || !inviteSheetUrl}
              onClick={() => {
                navigator.clipboard.writeText(inviteSheetUrl);
                setSnackbarState({ open: true, message: 'Invite link copied!', severity: 'success' });
                setIsInviteSheetOpen(false);
                trackEvent('invite_friend', { method: 'copy_link', source: 'stats_tile' });
              }}
              sx={{ borderRadius: '999px', textTransform: 'none', fontWeight: 600 }}
            >
              {inviteSheetLoading ? 'Getting link…' : 'Copy link'}
            </Button>
          </Stack>
        </Box>
      </Drawer>

      {/* Feedback widget */}
      {showFeedbackWidget && !mobileFilterDrawerOpen && !isAddDialogOpen && !isFriendsDialogOpen && !pickerOpen && !shareSheetState && <Box sx={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', right: 20, zIndex: 1300 }}>
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

      {/* Floating FAB — mobile only, slides up when user scrolls down */}
      {isMobile && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home' && !cookWithFriendsVisible) && !isAddDialogOpen && !isFriendsDialogOpen && !mobileFilterDrawerOpen
                : showFloatingFab && !cookWithFriendsVisible;
              return visible ? 'translateX(-50%) translateY(0) scale(1)' : 'translateX(-50%) translateY(20px) scale(0.92)';
            })(),
            opacity: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home' && !cookWithFriendsVisible) && !isAddDialogOpen && !isFriendsDialogOpen && !mobileFilterDrawerOpen
                : showFloatingFab && !cookWithFriendsVisible;
              return visible ? 1 : 0;
            })(),
            transition: 'transform 320ms cubic-bezier(0.34, 1.3, 0.64, 1), opacity 220ms ease',
            willChange: 'transform, opacity',
            pointerEvents: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home' && !cookWithFriendsVisible) && !isAddDialogOpen && !isFriendsDialogOpen && !mobileFilterDrawerOpen
                : showFloatingFab && !cookWithFriendsVisible;
              return visible ? 'auto' : 'none';
            })(),
            zIndex: 1200,
          }}
        >
          {session ? (
            <Button
              onClick={openAddDialog}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
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
                boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                '&:hover': { backgroundColor: 'primary.dark' },
              }}
              startIcon={<AddIcon />}
            >
              Add Recipe
            </Button>
          ) : (
            <Button
              onClick={openAuthDialog}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                height: '2.75rem',
                width: 'calc((100vw - 72px) / 2)',
                fontSize: '0.875rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                backgroundColor: 'primary.main',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                textTransform: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                '&:hover': { backgroundColor: 'primary.dark' },
              }}
            >
              Join Free
            </Button>
          )}
        </Box>
      )}
    </ThemeProvider>
  );
}

export default App;
