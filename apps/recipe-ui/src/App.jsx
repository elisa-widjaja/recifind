import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Autocomplete,
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
  ListSubheader,
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
import LanguageIcon from '@mui/icons-material/Language';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ClearIcon from '@mui/icons-material/Clear';
import CancelIcon from '@mui/icons-material/Cancel';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import AddIcon from '@mui/icons-material/Add';
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
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import SoupKitchenOutlinedIcon from '@mui/icons-material/SoupKitchenOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import { supabase } from './supabaseClient';
// === [rebrand] ===
import { migrateLegacyStorage } from './lib/migrateLegacyStorage';
// === [/rebrand] ===
import PublicLanding from './components/PublicLanding';
import FriendSections from './components/FriendSections';
import StatsTiles from './components/StatsTiles';
import StatsTilesPreview from './components/StatsTilesPreview';
import StatsTilesDesign1 from './components/StatsTilesDesign1';
import StatsTilesDesign2 from './components/StatsTilesDesign2';
import PullToRefresh from './components/PullToRefresh';
import RecipeListCard from './components/RecipeListCard';
import RecipesPage from './RecipesPage';
import SuggestionsShelf from './components/SuggestionsShelf';
import BottomAppBar from './components/BottomAppBar';
import DiscoverPage from './components/DiscoverPage';
import ProfilePage from './components/ProfilePage';
import OnboardingChecklist from './components/OnboardingChecklist';
import OnboardingDrawer from './components/OnboardingDrawer';
import SettingsDrawer from './components/SettingsDrawer';
import FriendsPage from './components/FriendsPage';
import AddFriendDrawer from './components/AddFriendDrawer';
import SourcesWorkflowRow from './components/SourcesWorkflowRow';
// === [S04] Friend picker wiring ===
import { FriendPicker } from './components/FriendPicker';
import { ShareSheet } from './components/ShareSheet';
import { shareRecipe } from './lib/shareRecipe';
import { buildRecipeShareUrl, buildRecipeAppDeepLink } from './lib/shareUrl';
import { CUISINE_LABELS, CUISINE_ORDER } from './lib/cuisines';
// === [/S04] ===
// === [S09] Capacitor auth ===
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { createDispatcher } from './lib/deepLinkDispatch';
import { readPendingShare, clearPendingShare } from './lib/pendingShare.js';
// === [/S09] ===
// === [S11] Push client ===
import { ensureRegistered, getCurrentApnsToken, onNotificationTap, hasPromptedForPermission } from './lib/pushClient';
import { NotificationSoftPrompt } from './components/NotificationSoftPrompt';
// === [/S11] ===
// === [S12] Shared Keychain JWT ===
import { SharedAuthStore } from './native/SharedAuthStore';
// === [/S12] ===
import { formatDuration } from './utils/videoEmbed';
import { estimateDurationMinutes } from './utils/estimateDuration';
import recipesData from '../recipes.json';
import recipesFromPdfData from '../recipes_from_pdf.json';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');
const DEV_API_TOKEN = import.meta.env.VITE_RECIPES_API_TOKEN || '';
// Canonical shareable recipe link lives in src/lib/shareUrl.js (imported
// at the top of this file) — see there for the query-vs-path-form
// rationale and the build-18 flip note.

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

// Pending OTP email — survives iOS WebView reloads when the user backgrounds
// the app to read the 6-digit code from email. 1-hour TTL.
const PENDING_OTP_KEY = 'recifriend-pending-otp-v1';
const PENDING_OTP_TTL_MS = 60 * 60 * 1000;

function readPendingOtpEmail() {
  try {
    const raw = localStorage.getItem(PENDING_OTP_KEY);
    if (!raw) return '';
    const { email, sentAt } = JSON.parse(raw);
    if (!email || !sentAt || Date.now() - sentAt > PENDING_OTP_TTL_MS) {
      localStorage.removeItem(PENDING_OTP_KEY);
      return '';
    }
    return email;
  } catch {
    try { localStorage.removeItem(PENDING_OTP_KEY); } catch {}
    return '';
  }
}

function writePendingOtpEmail(email) {
  try {
    localStorage.setItem(PENDING_OTP_KEY, JSON.stringify({ email, sentAt: Date.now() }));
  } catch {}
}

function clearPendingOtpEmail() {
  try { localStorage.removeItem(PENDING_OTP_KEY); } catch {}
}

// Profile cache: keyed by Supabase user id so the displayName renders
// instantly on sign-in instead of flashing the email local-part fallback
// while the /profile fetch is in flight. Stale-while-revalidate — fetchProfile
// always overwrites the cache with the canonical server value.
const PROFILE_CACHE_PREFIX = 'recifriend-profile:';

function readCachedProfile(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${PROFILE_CACHE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(userId, profile) {
  if (!userId || !profile) return;
  try {
    localStorage.setItem(`${PROFILE_CACHE_PREFIX}${userId}`, JSON.stringify(profile));
  } catch {
    // Quota / private mode — caching is best-effort, ignore.
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

// Cuisines arrive from the API in lowercase hyphenated form (e.g.
// "middle-eastern"). Normalize legacy variants users may have typed manually
// (e.g. "Italian" → "italian", "japanese cuisine" → "japanese").
function normalizeCuisineValue(type) {
  const t = type.trim().toLowerCase().replace(/\s+/g, '-');
  if (t === 'mideast' || t === 'mid-east' || t === 'middle east') return 'middle-eastern';
  if (t.endsWith('-cuisine')) return t.slice(0, -8);
  return t;
}

function normalizeRecipeCuisines(recipe) {
  if (!Array.isArray(recipe.cuisines)) {
    // Backwards-compat: rows from before migration 0014 won't have cuisines.
    return { ...recipe, cuisines: [] };
  }
  const normalized = [...new Set(recipe.cuisines.filter((t) => typeof t === 'string' && t.trim()).map(normalizeCuisineValue))];
  return { ...recipe, cuisines: normalized };
}

function normalizeRecipeFromApi(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  let result = recipe;
  if (API_BASE_URL && recipe.imagePath && (!recipe.imageUrl || recipe.imageUrl.startsWith('/'))) {
    result = { ...result, imageUrl: `${API_BASE_URL}${recipe.imagePath}` };
  }
  result = normalizeRecipeMealTypes(result);
  result = normalizeRecipeCuisines(result);
  return result;
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
  const cuisines = Array.isArray(recipe.cuisines) ? recipe.cuisines : [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const payload = {
    title: recipe.title || '',
    sourceUrl: recipe.sourceUrl || '',
    imageUrl: recipe.imageUrl || '',
    mealTypes,
    cuisines,
    customTags: Array.isArray(recipe.customTags) ? recipe.customTags : [],
    ingredients,
    steps,
    durationMinutes:
      typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes) && recipe.durationMinutes > 0
        ? Math.round(recipe.durationMinutes)
        : null,
    notes: recipe.notes || '',
    sharedWithFriends: Boolean(recipe.sharedWithFriends),
    provenance:
      recipe.provenance === 'extracted'
        || recipe.provenance === 'inferred'
        || recipe.provenance === 'title-only'
        ? recipe.provenance
        : null,
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

// Cuisine taxonomy — kept tight so the filter chips stay scannable. Values
// match the enum in the worker's Gemini prompt (lowercase, hyphenated).
const NEW_RECIPE_TEMPLATE = {
  title: '',
  sourceUrl: '',
  imageUrl: '',
  mealTypes: '',
  customTags: [],
  ingredients: '',
  steps: '',
  durationMinutes: '',
  sharedWithFriends: true,
  // Carries provenance through from /recipes/parse + /recipes/enrich into
  // POST /recipes so a "title-only" reel (no caption / no structured data)
  // is born with provenance='title-only'. The AI-inferred chip + the edit-
  // mode Auto-fill button both gate on this; without it the row sits at
  // provenance=null until enrichAfterSave catches up server-side and the
  // silent 6s/18s refetch lands.
  provenance: null,
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
      customTags: Array.isArray(recipe.customTags) ? recipe.customTags : [],
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

function getUniqueCuisines(recipes) {
  const types = new Set();
  recipes.forEach((recipe) => {
    (recipe.cuisines || []).forEach((c) => types.add(c));
  });
  const ordered = CUISINE_ORDER.filter((type) => types.has(type));
  const extras = Array.from(types).filter((type) => !CUISINE_ORDER.includes(type));
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

  // First letter/digit of each word. \p{L}/\p{N} with the /u flag skips
  // leading emoji or punctuation AND treats each codepoint as a unit, so
  // emoji-prefixed words don't leak a lone surrogate into the SVG (which
  // would make encodeURIComponent throw "URI malformed" and the fallback
  // crash → original dead src stays → native broken-image icon).
  const initials = (lowercaseTitle
    .split(/\s+/)
    .map((word) => {
      const m = word.match(/\p{L}|\p{N}/u);
      return m ? m[0].toUpperCase() : '';
    })
    .filter(Boolean)
    .join('')
    .slice(0, 3)) || 'REC';

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
        ${escapeSvgText(initials)}
      </text>
    </svg>
  `;

  try {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  } catch (_err) {
    // Defense in depth: should be unreachable now that initials is always
    // ASCII, but a future caller might pass a title with a lone surrogate
    // that slips into the SVG via a different path. Return '' so the
    // calling onError fallback can short-circuit instead of crashing.
    return '';
  }
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

// Downscale a picked avatar file to a 256x256 square data URL before upload.
// Center-crops to a square and re-encodes (WebP, JPEG fallback for older Safari)
// so a multi-MB photo becomes ~10-30KB — keeps Supabase storage/egress small.
// We decode via an <img> element rather than createImageBitmap so the browser
// applies EXIF orientation automatically (phone selfies often arrive rotated).
// Throws on decode failure; callers fall back to a raw upload (worker still caps
// the payload at 5MB).
const AVATAR_SIZE = 256;
function downscaleAvatar(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) {
          reject(new Error('avatar has zero dimensions'));
          return;
        }
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 2d context unavailable'));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        let dataUrl = canvas.toDataURL('image/webp', 0.85);
        // Older Safari can't encode WebP from canvas — it silently returns PNG.
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('failed to decode avatar image'));
    };
    img.src = objectUrl;
  });
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
  // Side-effect: mark onboarding steps done as their corresponding events fire.
  // userId is read from supabase's session in localStorage so this works
  // without React state (trackEvent is module-scope).
  const flagFor = name === 'invite_friend' ? 'invited'
    : name === 'share_recipe' ? 'shared'
    : null;
  if (flagFor) {
    try {
      // storageKey matches supabaseClient.js — custom 'recifriend-auth' instead
      // of the default 'sb-{ref}-auth-token', so don't fall back to the sb- prefix.
      const raw = localStorage.getItem('recifriend-auth');
      const userId = raw ? JSON.parse(raw)?.user?.id : null;
      if (userId) localStorage.setItem(`onboarding_${flagFor}_${userId}`, '1');
    } catch { /* swallow — never block tracking on a parse error */ }
  }
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

function getHomeGreetingMessage(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11)  return "good morning, what's cooking today?";
  if (hour >= 11 && hour < 14) return 'lunch is calling.';
  if (hour >= 14 && hour < 17) return 'planning something for tonight?';
  if (hour >= 17 && hour < 21) return "what's for dinner?";
  return 'craving a midnight snack?';
}


const PENDING_SHARE_TTL_MS = 24 * 60 * 60 * 1000;

// Module-scope dedup of deep-link URLs already dispatched this run. See the
// dispatchDeepLink call site for the why. Module scope (not useRef) so that
// React remounts during HMR / sign-in/out cycles don't reset it and let a
// retained appUrlOpen + a getLaunchUrl re-dispatch the same auth callback,
// which would race exchangeCodeForSession and consume the PKCE verifier
// twice.
const dispatchedDeepLinks = new Set();

// Recipe-detail custom tags input. Owns its `inputValue` so we can commit
// what the user typed even when they leave the field without pressing Enter
// (the default freeSolo Autocomplete drops uncommitted text on blur, which
// silently lost the user's tag).
//
// Layout: the Autocomplete renders ONLY the text input — no chips inside it.
// Committed tags render as a separate chip row below the input, each with a
// delete X. Keeps the input clean and always visible regardless of how many
// tags are present.
function CustomTagsAutocomplete({ availableTags, value, onValueChange, disabled }) {
  const [inputValue, setInputValue] = useState('');
  const atCap = value.length >= 5;

  const commit = (rawArray) => {
    const cleaned = [];
    const seenLower = new Set();
    for (const item of rawArray) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim().slice(0, 30);
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (seenLower.has(lower)) continue;
      seenLower.add(lower);
      cleaned.push(trimmed);
      if (cleaned.length >= 5) break;
    }
    onValueChange(cleaned);
  };

  const removeAt = (index) => {
    onValueChange(value.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Autocomplete
        multiple
        freeSolo
        options={availableTags}
        value={value}
        inputValue={inputValue}
        onInputChange={(_, next, reason) => {
          if (reason !== 'reset') setInputValue(next);
        }}
        onChange={(_, newValue) => {
          commit(newValue);
          setInputValue('');
        }}
        onBlur={() => {
          // Commit any pending input that the user hadn't pressed Enter on.
          const pending = inputValue.trim();
          if (!pending || atCap) {
            setInputValue('');
            return;
          }
          commit([...value, pending]);
          setInputValue('');
        }}
        disabled={disabled}
        // Suppress MUI's default in-input chip rendering. Chips render below
        // the input as a separate row (see <Box> after the Autocomplete).
        renderTags={() => null}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={atCap ? 'Max 5 tags — remove one to add another' : 'Add a tag…'}
            inputProps={{
              ...params.inputProps,
              maxLength: 30,
              disabled: atCap,
            }}
          />
        )}
      />
      {value.length === 0 ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
          Add tags like 'meal prep' or 'camping' to organize and find recipes faster.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          {value.map((tag, i) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              onDelete={disabled ? undefined : () => removeAt(i)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

// Strip recipe deep-link params/path from the current URL without navigating.
// Called on logout: otherwise a stale own-recipe link (?recipe=id&user=me or
// /recipes/id) is left in the URL, and once the session clears the deep-link
// effect re-reads it, can't match the now-inaccessible private recipe via the
// public endpoint, and fires "Recipe not found or no longer available"
// repeatedly.
function clearRecipeDeepLinkFromUrl() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const param of ['recipe', 'user', 'share']) {
      if (url.searchParams.has(param)) { url.searchParams.delete(param); changed = true; }
    }
    if (/^\/recipes\/[^/?#]+\/?$/.test(url.pathname)) { url.pathname = '/'; changed = true; }
    if (changed) window.history.replaceState({}, '', url.toString());
  } catch {
    // best-effort — URL cleanup should never block logout
  }
}

const DISMISSED_SUGGESTIONS_KEY = 'recifriend-dismissed-suggestions';

function readDismissedSuggestions() {
  try {
    const raw = localStorage.getItem(DISMISSED_SUGGESTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissedSuggestions(ids) {
  try {
    localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify(ids));
  } catch {
    // localStorage unavailable (private mode etc.) — dismissal is best-effort.
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
      ([entry]) => {
        // Only show the FAB once the user has scrolled PAST the marker
        // (i.e., it's above the viewport). Without this, a tall first-load
        // page where the marker starts below the viewport would treat
        // "not intersecting" as "scrolled past" and pop the FAB up
        // immediately.
        const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setShowHomeFab(scrolledPast);
      },
      { threshold: 0 }
    );
    observer.observe(node);
    statsTilesObserverRef.current = observer;
  }, []);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const mobileFilterChipsRef = useRef(null);
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem('recifriend-favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // First-time onboarding hosted in a single right-slide drawer (preferences
  // + checklist screens). Replaces the legacy OnboardingFlow Dialog and the
  // GetStartedDialog bridge.
  const [onboardingDrawerOpen, setOnboardingDrawerOpen] = useState(false);
  // FriendsPage initial tab — set when the user navigates to 'friends' so we
  // can route to the Pending tab when the BottomAppBar badge is shown, and
  // to Connections otherwise.
  const [friendsInitialTab, setFriendsInitialTab] = useState('connections');
  // AddFriendDrawer state — separate from the legacy isAddFriendOpen path
  // (which was used inside the old friends drawer; that surface is now
  // page-based and the FAB on FriendsPage opens this drawer instead).
  const [addFriendDrawerOpen, setAddFriendDrawerOpen] = useState(false);
  // Bumped when the user taps "Get started" so OnboardingChecklist remounts
  // and re-reads the now-set onboarding_checklist_collapsed sessionStorage
  // flag (its useState initial only runs once at mount).
  const [checklistKey, setChecklistKey] = useState(0);
  // Bumped by pull-to-refresh on the Discover tab; remounts DiscoverPage so
  // its public feeds refetch (DiscoverPage fetches on mount only).
  const [discoverRefreshKey, setDiscoverRefreshKey] = useState(0);
  const [currentView, setCurrentView] = useState(() => {
    const saved = sessionStorage.getItem('currentView');
    const VALID_VIEWS = ['home', 'recipes', 'friend-requests', 'friends', 'discover', 'profile'];
    return VALID_VIEWS.includes(saved) ? saved : 'home';
  }); // 'home' | 'recipes' | 'friend-requests' | 'friends' | 'discover' | 'profile'

  useEffect(() => {
    sessionStorage.setItem('currentView', currentView);
  }, [currentView]);

  // Reset window scroll when switching views via the bottom nav. Without this,
  // jumping from a deeply-scrolled Home to Recipes would leave Recipes scrolled
  // past its search bar.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'recipes') {
      setShowFloatingFab(false);
      // Clear recipe filters whenever the user leaves the Recipes view. The
      // filter state lives on this never-unmounting root component, so without
      // an explicit reset it survives tab switches (and even logout/login).
      // Resetting on leave — not on enter — keeps handleMealTypeToggle /
      // handleCuisineToggle intact, since those set a filter then navigate INTO
      // recipes (this branch never runs when arriving at recipes).
      setSelectedMealTypes([]);
      setSelectedCuisines([]);
      setSelectedTags([]);
      setShowFavoritesOnly(false);
      setIngredientInput('');
      return;
    }
    // Always start hidden when entering Recipes — the IO callback will flip
    // it true only once the in-page Add Recipe button has scrolled out of
    // view. Without this, a stale ref or a hidden ref-Box (sm+ has the
    // in-page button display:none) could leave showFloatingFab at its prior
    // value and pop the FAB up immediately.
    setShowFloatingFab(false);
    let observer = null;
    let raf = null;
    const attach = () => {
      const el = addRecipeBtnRef.current;
      if (!el) return false;
      observer = new IntersectionObserver(
        ([entry]) => setShowFloatingFab(!entry.isIntersecting),
        { threshold: 0 }
      );
      observer.observe(el);
      return true;
    };
    // The child's ref may not be set on the first commit tick — defer to the
    // next paint and try again if needed.
    if (!attach()) raf = requestAnimationFrame(attach);
    return () => {
      if (observer) observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [currentView]);

  const toggleFavorite = useCallback((recipeId) => {
    let nextFavorited = false;
    setFavorites((prev) => {
      const wasFavorited = prev.has(recipeId);
      nextFavorited = !wasFavorited;
      const next = new Set(prev);
      if (wasFavorited) next.delete(recipeId); else next.add(recipeId);
      localStorage.setItem('recifriend-favorites', JSON.stringify([...next]));
      trackEvent('favorite', { recipe_id: recipeId, action: wasFavorited ? 'remove' : 'add' });
      return next;
    });
    // Mirror to the server so server-side surfaces (Editor's Picks) can read
    // the user's favorite collection. Fire-and-forget — localStorage stays
    // authoritative on the client.
    (async () => {
      try {
        const token = (await supabase?.auth.getSession())?.data?.session?.access_token;
        if (!token) return;
        await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipeId)}/favorite`, {
          method: nextFavorited ? 'POST' : 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Network errors are non-fatal — next bulk sync on cold start will reconcile.
      }
    })();
  }, []);

  const isRemoteEnabled = Boolean(API_BASE_URL);
  // Don't load cache yet - wait for auth to determine which user's cache to use
  const [recipes, setRecipes] = useState(() => {
    if (!isRemoteEnabled) return INITIAL_RECIPES;
    return []; // Start empty, will load after auth check
  });
  const [selectedMealTypes, setSelectedMealTypes] = useState([]);
  const [selectedCuisines, setSelectedCuisines] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [ingredientInput, setIngredientInput] = useState('');
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [activeRecipeDraft, setActiveRecipeDraft] = useState(null);
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState(() => readDismissedSuggestions());

  const dismissSuggestion = useCallback((id) => {
    if (!id) return;
    setDismissedSuggestionIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeDismissedSuggestions(next);
      return next;
    });
  }, []);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addRecipeSource, setAddRecipeSource] = useState(null); // 'share-extension' | 'manual' | null
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const titleInputRef = useRef(null);
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
  // A friend's / public recipe counts as "already in my collection" when I
  // own a recipe with the same normalized source_url, or it's literally my
  // own recipe (same id — e.g. activity feed "X saved your recipe").
  // Derived purely from the live `recipes` collection so the green
  // "Saved ✓" state is consistent across friend-drawer cards and the
  // shared-recipe detail button, and reverts the instant the saved copy is
  // deleted. Recipes with no source_url can only match by id (no false
  // positives across unrelated manual recipes).
  const ownedSourceUrls = useMemo(() => {
    const set = new Set();
    for (const r of recipes) {
      const u = normalizeUrlForLookup(r.sourceUrl);
      if (u) set.add(u);
    }
    return set;
  }, [recipes]);
  const isRecipeAlreadySaved = useCallback((recipe) => {
    if (!recipe) return false;
    if (recipe.id && recipes.some((r) => r.id === recipe.id)) return true;
    const u = normalizeUrlForLookup(recipe.sourceUrl);
    return !!u && ownedSourceUrls.has(u);
  }, [recipes, ownedSourceUrls]);
  const [sharedRecipeOwnerId, setSharedRecipeOwnerId] = useState(null);
  const [oembedAuthor, setOembedAuthor] = useState(null);
  const oembedCacheRef = useRef(new Map());
  const [cookMode, setCookMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [recipeMenuAnchor, setRecipeMenuAnchor] = useState(null);
  const [isInferredCaveatOpen, setIsInferredCaveatOpen] = useState(false);
  const [isStickyStuck, setIsStickyStuck] = useState(false);
  const scrollHandlerRef = useRef(null);
  const dialogContentRef = useCallback((node) => {
    // Cleanup previous listeners
    if (scrollHandlerRef.current) {
      const prev = scrollHandlerRef.current;
      prev.el.removeEventListener('scroll', prev.onScroll);
      prev.el.removeEventListener('touchstart', prev.onTouchStart);
      prev.el.removeEventListener('touchend', prev.onTouchEnd);
      prev.el.removeEventListener('touchcancel', prev.onTouchEnd);
      scrollHandlerRef.current = null;
    }
    if (node) {
      // Why this is touch-aware:
      //
      // The sticky thumbnail toggles between collapsed (64px row) and
      // expanded (190px column) on a 250ms CSS transition. The collapse
      // direction (scroll-down → stick) works fine because the browser's
      // visual-stability adjustment to scrollTop matches the user's intent
      // (they're scrolling down anyway). The EXPAND direction (scroll-up
      // back to top → unstick) is what freezes iOS Safari: the wrapper
      // grows ~126px under an active finger, the browser bumps scrollTop
      // up to compensate, and Safari's gesture handler loses track of the
      // touch — the screen "freezes" until the user lifts and starts a
      // new gesture (which is what an overscroll-pull-down accomplishes).
      //
      // Fix: only resize the wrapper between gestures, never during one.
      //   • Collapse (stick) fires immediately on scroll — fine because
      //     the user is scrolling away from the resized region.
      //   • Expand (unstick) is deferred to touchend — when the finger
      //     lifts, if scrollTop is at the top, play the smooth 250ms
      //     expand. Mouse wheel / programmatic scrolls go through the
      //     immediate path (no touch session to defer to).
      const TRANSITION_LOCK_MS = 300;
      let stuck = false;
      let touching = false;
      let lockUntil = 0;
      const setStuck = (next) => {
        if (next === stuck) return;
        stuck = next;
        setIsStickyStuck(next);
      };
      const triggerExpand = () => {
        setStuck(false);
        lockUntil = performance.now() + TRANSITION_LOCK_MS;
        // After the 250ms grow, snap to 0 so the user lands at the top
        // instead of being shifted by the browser's auto-compensation.
        setTimeout(() => { node.scrollTop = 0; }, TRANSITION_LOCK_MS);
      };
      const onScroll = () => {
        if (performance.now() < lockUntil) return;
        const top = node.scrollTop;
        if (!stuck && top > 80) {
          setStuck(true);
          lockUntil = performance.now() + TRANSITION_LOCK_MS;
        } else if (stuck && top <= 5 && !touching) {
          // Desktop / programmatic path — no active touch to wait for.
          triggerExpand();
        }
      };
      const onTouchStart = () => { touching = true; };
      const onTouchEnd = () => {
        touching = false;
        // Defer-then-fire: only expand if the user released near the top.
        if (stuck && node.scrollTop <= 5) {
          triggerExpand();
        }
      };
      node.addEventListener('scroll', onScroll, { passive: true });
      node.addEventListener('touchstart', onTouchStart, { passive: true });
      node.addEventListener('touchend', onTouchEnd, { passive: true });
      node.addEventListener('touchcancel', onTouchEnd, { passive: true });
      scrollHandlerRef.current = { el: node, onScroll, onTouchStart, onTouchEnd };
      // Reset on mount — at scroll 0, treat as not-stuck
      setIsStickyStuck(false);
    }
  }, []);
  const wakeLockRef = useRef(null);
  // Settings drawer (right-slide). null when closed; one of:
  //   'about' | 'privacy' | 'notifications' | 'feedback'
  const [settingsDrawer, setSettingsDrawer] = useState(null);
  const [feedbackRating, setFeedbackRating] = useState(null);
  const [feedbackFrequency, setFeedbackFrequency] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
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

  useEffect(() => {
    if (!isAddDialogOpen) {
      setImageLoadFailed(false);
    }
  }, [isAddDialogOpen]);

  useEffect(() => {
    setImageLoadFailed(false);
  }, [newRecipeForm.imageUrl]);

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
  const [pendingShare, setPendingShare] = useState(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  // Logged-out users can't be on account-only views (friends/profile). Snap
  // them to Home if they land there via sessionStorage (e.g., signed out
  // while on Profile, then reloaded). Lives here — not next to currentView
  // state above — so it sees session/isAuthChecked after they're declared.
  useEffect(() => {
    if (!isAuthChecked) return;
    if (session) return;
    if (currentView === 'friends' || currentView === 'profile') {
      setCurrentView('home');
    }
  }, [isAuthChecked, session, currentView]);

  // Server-side favorites reconciliation. On sign-in:
  //   1. Push this browser's localStorage favorites to the server (additive —
  //      never wipes server state).
  //   2. Pull the server set and UNION it with local. Local ∪ server ensures
  //      reloading a browser where the server is stale/empty can't drop
  //      favorites the user hearted before server sync existed, and a
  //      browser that's missing entries (different origin / fresh device)
  //      picks them up from the server.
  //   Removes happen exclusively through the per-recipe DELETE endpoint, so
  //   union here is safe (won't resurrect intentionally unhearted recipes
  //   because they were already removed from both sides at the time).
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    (async () => {
      try {
        const token = (await supabase?.auth.getSession())?.data?.session?.access_token;
        if (!token) return;
        const stored = localStorage.getItem('recifriend-favorites');
        let localIds = [];
        try { localIds = stored ? JSON.parse(stored) : []; } catch { localIds = []; }
        if (!Array.isArray(localIds)) localIds = [];
        // Push local → server when local has anything to contribute.
        if (localIds.length > 0) {
          await fetch(`${API_BASE_URL}/recipes/favorites/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ids: localIds }),
          });
        }
        // Pull server → union into local.
        const pullRes = await fetch(`${API_BASE_URL}/recipes/favorites`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!pullRes.ok) return;
        const { ids: serverIds } = await pullRes.json();
        if (!Array.isArray(serverIds)) return;
        const merged = new Set([...localIds, ...serverIds]);
        setFavorites(merged);
        localStorage.setItem('recifriend-favorites', JSON.stringify([...merged]));
      } catch {
        // non-fatal — keep existing localStorage favorites; retry on next sign-in
      }
    })();
  }, [session?.user?.id]);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    () => !!(
      sessionStorage.getItem('pending_open_invite') ||
      sessionStorage.getItem('pending_invite_token') ||
      sessionStorage.getItem('pending_accept_friend') ||
      readPendingOtpEmail()
    )
  );
  const [authEmail, setAuthEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [authDialogReason, setAuthDialogReason] = useState(null);
  // 'signin' (default) | 'join' — controls whether the dialog title reads
  // "Sign in" or "Join Free". The Join Free CTA on the public landing
  // passes mode:'join'; everything else falls back to 'signin'.
  const [authDialogMode, setAuthDialogMode] = useState('signin');
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

  // Theme preference: 'system' (follow OS), 'light', or 'dark'.
  // Migration: previously stored binary at 'recifriend-dark-mode' — fold those
  // explicit choices into 'light'/'dark' so users don't get re-defaulted to
  // System on first launch after upgrade.
  const [themePref, setThemePref] = useState(() => {
    const newPref = localStorage.getItem('recifriend-theme-pref');
    if (newPref === 'system' || newPref === 'light' || newPref === 'dark') return newPref;
    const legacy = localStorage.getItem('recifriend-dark-mode');
    if (legacy !== null) {
      const migrated = legacy === 'true' ? 'dark' : 'light';
      try {
        localStorage.setItem('recifriend-theme-pref', migrated);
        localStorage.removeItem('recifriend-dark-mode');
      } catch {}
      return migrated;
    }
    return 'system';
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  // Track live OS theme changes so 'system' mode follows iOS sunset auto-switch.
  // No-op for explicit 'light'/'dark' since darkMode is computed from themePref.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemPrefersDark(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler); // older Safari
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);
  const darkMode = themePref === 'system' ? systemPrefersDark : themePref === 'dark';
  // Keep the <html>.dark class in sync so index.html's background CSS matches
  // the active MUI theme. Without this, the background stayed black after
  // toggling Dark→Light because the pre-React boot script set .dark and
  // nothing removed it.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
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
      MuiAvatar: {
        styleOverrides: {
          // Suppress the iOS WKWebView long-press image menu (Save to Photos /
          // Copy / Copy Subject / Look Up / Share) on avatar <img>s. Profile
          // pics aren't content meant to be saved — this matches native apps.
          // Recipe images are intentionally left long-press-saveable. CSS-only:
          // no effect on desktop web/Android or on tap handlers.
          img: {
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          },
        },
      },
      ...(darkMode ? {
        MuiLink: { defaultProps: { color: 'inherit' }, styleOverrides: { root: { color: '#fff' } } },
      } : {}),
    },
  }), [darkMode]);

  const updateThemePref = (next) => {
    setThemePref(next);
    try { localStorage.setItem('recifriend-theme-pref', next); } catch {}
  };

  // Get access token from session
  const accessToken = session?.access_token || null;

  // Initialize auth state on mount
  useEffect(() => {
    if (!supabase) {
      setIsAuthChecked(true);
      return;
    }

    // Strip any stale magic-link params from a URL we may have been opened with —
    // we don't honour the link anymore (8-digit code only), but we don't want
    // them lingering in the address bar either.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('token_hash') || urlParams.get('type') === 'magiclink') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('token_hash');
      cleanUrl.searchParams.delete('type');
      window.history.replaceState({}, '', cleanUrl.toString());
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthChecked(true);
      // Mirror on initial restore — onAuthStateChange doesn't always fire
      // INITIAL_SESSION on cold launch with restored auth.
      if (session?.access_token) {
        SharedAuthStore.setJwt(session.access_token);
      }
      // Hydrate userProfile from localStorage so the displayName renders
      // immediately instead of flashing the email-local-part fallback while
      // the /profile fetch round-trips. fetchProfile will overwrite with
      // canonical server data shortly after.
      if (session?.user?.id) {
        const cached = readCachedProfile(session.user.id);
        if (cached) setUserProfile(cached);
      }
      if (window.gtag && session?.user?.id) {
        window.gtag('config', 'G-W2LEPNDMF0', { user_id: session.user.id });
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      // Mirror the Supabase access token into shared iOS Keychain so the
      // share extension can save recipes natively without the main app.
      // Any event delivering a non-null session updates it (INITIAL_SESSION
      // on cold launch, SIGNED_IN on new login, TOKEN_REFRESHED on refresh,
      // USER_UPDATED after profile changes).
      if (session?.access_token) {
        SharedAuthStore.setJwt(session.access_token);
      }

      // Same flash fix as the cold-restore path above — pull the cached
      // profile in synchronously when the session lands, before fetchProfile
      // has a chance to network. Use prev ?? cached so we don't clobber a
      // freshly-fetched profile with a stale cache entry on TOKEN_REFRESHED.
      if (session?.user?.id) {
        const cached = readCachedProfile(session.user.id);
        if (cached) setUserProfile(prev => prev ?? cached);
      }

      if (event === 'SIGNED_IN') {
        // Only redirect to 'home' if the user was actively signing in (dialog
        // open). On cold launch with a restored session Supabase also fires
        // SIGNED_IN, and resetting currentView there clobbers deep-link
        // destinations like /recipes from the share extension's "View on
        // ReciFriend" link.
        setIsAuthDialogOpen(prev => {
          if (prev) setCurrentView('home');
          return false;
        });
        setAuthDialogReason(null);
        setAuthError('');
        setIsAuthLoading(false);
        clearPendingOtpEmail();
        setOtpSentToEmail('');
        setOtpCode('');
      }
      if (event === 'SIGNED_OUT') {
        setCurrentView('home');
        SharedAuthStore.clearJwt();
        setUserProfile(null);
        // Belt-and-suspenders: don't carry the previous user's recipe filters
        // into the next login. setCurrentView('home') above already triggers
        // the leave-Recipes reset, but resetting here too keeps the intent if
        // logout ever stops navigating away.
        setSelectedMealTypes([]);
        setSelectedCuisines([]);
        setSelectedTags([]);
        setShowFavoritesOnly(false);
        setIngredientInput('');
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
  // Friend-accept handler is bound at module load to the latest closure so
  // the deep-link dispatcher (created once) can fire it for accept_friend
  // links arriving via Universal Link / appUrlOpen on already-running app.
  const acceptFriendRequestRef = useRef(null);
  const accessTokenRef = useRef(null);
  // Same ref pattern for the recipe-detail close handler so the share
  // extension's "View on ReciFriend" deep link can dismiss an already-open
  // recipe before navigating to /recipes.
  const closeDialogRef = useRef(null);

  const dispatchDeepLink = useCallback(async (urlString) => {
    // Magic-link sign-in is no longer supported — only the 8-digit code flow.
    // Drop any stale `?token_hash=&type=magiclink` deep links silently so the
    // PKCE / verifyOtp errors that used to leak into a snackbar are gone.
    try {
      const parsed = new URL(urlString);
      if (parsed.searchParams.has('token_hash')) {
        try { await Browser.close(); } catch { /* ignore */ }
        return;
      }
    } catch { /* not a parseable URL; fall through */ }

    // Within-session dedup — scoped to auth callbacks ONLY.
    //
    // The cold-boot path fires the SAME URL twice (Capacitor's appUrlOpen
    // listener AND getLaunchUrl() both flush retained launch URLs). For
    // auth_callback that's fatal: Supabase's exchangeCodeForSession consumes
    // the PKCE code_verifier from storage on first read, so the second
    // invocation throws "PKCE code verifier not found in storage".
    //
    // Navigation URLs (recipes_list, recipe_detail, friend_requests,
    // add_recipe, open_pending_share) are idempotent — re-dispatch is safe
    // and de-duping breaks the share-extension's "View on ReciFriend" flow:
    // the URL is the same `recifriend://recipes` string every share, so the
    // second tap (and onward) within an app run was being silently dropped,
    // leaving the user on whatever view they were on (usually Home).
    //
    // The Set lives at module scope (NOT useRef) so React remounts (HMR,
    // sign-in/out cycles, navigation) don't reset it within a single app run.
    const isAuthCallback = /\/auth\/callback(\b|\/|\?)/.test(urlString);
    if (isAuthCallback) {
      if (dispatchedDeepLinks.has(urlString)) {
        // eslint-disable-next-line no-console
        console.warn('[deeplink] dedup skip — auth callback already dispatched this run');
        return;
      }
      dispatchedDeepLinks.add(urlString);
    }

    const dispatch = createDispatcher({
      onAuthCallback: async (code) => {
        if (!supabase) return;
        // If we already have a session, the OAuth callback is stale (e.g. iOS
        // re-fired a retained launch URL after the app was killed and resumed).
        // Calling exchangeCodeForSession here would throw "PKCE code verifier
        // not found in storage" — surface nothing, since the user is signed in.
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession) {
          try { await Browser.close(); } catch { /* ignore */ }
          return;
        }
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.warn('[deeplink] exchangeCodeForSession failed:', error.message);
          // Swallow PKCE-verifier errors silently — they only happen on stale
          // callbacks where there's nothing the user can do. Surface real
          // errors (network, expired code) so the user knows to retry.
          const isPkceVerifierError = /code verifier|pkce/i.test(error.message);
          if (!isPkceVerifierError) {
            setSnackbarState({
              open: true,
              message: `Sign-in failed: ${error.message}. Try again.`,
              severity: 'error',
            });
          }
        }
        try { await Browser.close(); } catch { /* ignore if already closed */ }
      },
      onAddRecipe: (url, title) => {
        // Route through pendingShare so the session gate in the drain effect
        // handles both logged-in (open drawer) and logged-out (open auth
        // dialog + preserve across OAuth) cases consistently.
        setPendingShare({
          url,
          title: typeof title === 'string' && title.length > 0 ? title : '',
          createdAt: Math.floor(Date.now() / 1000),
        });
      },
      onOpenPendingShare: () => {
        // App Group storage is read on mount; this deep link is just a
        // wake-up ping. If the app was already foregrounded, re-read so
        // an extension fire after the mount effect still drains.
        readPendingShare().then((share) => {
          if (share) setPendingShare(share);
        });
      },
      onFriendRequests: (acceptId) => {
        setCurrentView('friend-requests');
        if (!acceptId) return;
        // Already signed in → accept now. Not signed in → defer via
        // sessionStorage; the existing post-sign-in effect picks it up.
        if (accessTokenRef.current) {
          acceptFriendRequestRef.current?.(acceptId);
        } else {
          sessionStorage.setItem('pending_accept_friend', acceptId);
        }
      },
      onRecipeDetail: (recipeId, ownerId) => {
        const local = recipesRef.current.find((r) => r.id === recipeId);
        if (local) { handleOpenRecipeDetailsRef.current?.(local); return; }
        // Not in my collection — a shared link to someone else's recipe.
        // Fetch it the same way the web cold-load does and open it as a
        // shared-recipe view (Save/Share layout).
        if (!ownerId || !API_BASE_URL) return;
        (async () => {
          try {
            const res = await fetch(`${API_BASE_URL}/public/recipe/${encodeURIComponent(ownerId)}/${encodeURIComponent(recipeId)}`);
            if (!res.ok) {
              setSnackbarState({ open: true, message: 'Recipe not found or no longer available', severity: 'error' });
              return;
            }
            const recipe = await res.json();
            if (recipe && recipe.title) {
              setIsSharedRecipeView(true);
              setSharedRecipeOwnerId(ownerId);
              setActiveRecipe(recipe);
              setActiveRecipeDraft(null);
            }
          } catch (err) {
            console.error('Error fetching shared recipe (deep link):', err);
            setSnackbarState({ open: true, message: 'Failed to load shared recipe', severity: 'error' });
          }
        })();
      },
      onRecipesList: () => {
        // If a recipe detail is already open (user was browsing a recipe
        // before sharing from social media), dismiss it so the View on
        // ReciFriend tap lands them on the collection page cleanly instead
        // of behind the existing dialog.
        closeDialogRef.current?.();
        setCurrentView('recipes');
      },
    });
    return dispatch(urlString);
  }, []);

  // Drain App Group on mount — picks up any share the extension wrote before
  // the app launched (cold-start / was backgrounded).
  useEffect(() => {
    let cancelled = false;
    readPendingShare().then((share) => {
      if (cancelled || !share) return;
      setPendingShare(share);
    });
    return () => { cancelled = true; };
  }, []);

  // Gate pendingShare on session: logged in → pre-fill Add Recipe drawer,
  // logged out → open auth dialog with a contextual subtitle.
  useEffect(() => {
    if (!pendingShare) return;

    const ageMs = Date.now() - pendingShare.createdAt * 1000;
    if (ageMs > PENDING_SHARE_TTL_MS) {
      clearPendingShare();
      setPendingShare(null);
      return;
    }

    if (session) {
      setNewRecipeForm((prev) => ({
        ...prev,
        sourceUrl: pendingShare.url,
        title: pendingShare.title || prev.title || '',
        // Carry the share-sheet's preview thumbnail through so the Add
        // Recipe drawer renders the same image the user just saw,
        // instead of falling back to the title-letter placeholder.
        imageUrl: pendingShare.imageUrl || prev.imageUrl || '',
      }));
      setNewRecipeErrors({});
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      setSourceParseState({ status: 'idle', message: '' });
      setAddRecipeSource('share-extension');
      setIsAddDialogOpen(true);
      clearPendingShare();
      setPendingShare(null);
    } else if (isAuthChecked) {
      openAuthDialog({
        reason: pendingShare.title
          ? `Sign in to save "${pendingShare.title}"`
          : 'Sign in to save your recipe',
      });
    }
  // openAuthDialog is re-created every render (not wrapped in useCallback)
  // but only calls stable setters, so omitting it from deps is safe. The
  // effect closure is always fresh via the listed deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare, session, isAuthChecked]);

  // iOS launch with no session → auto-open the login dialog so logged-out
  // users see the auth surface immediately. They can dismiss to land on the
  // public homepage and still re-open via the header "Login" link. Only
  // fires once per session (the local flag prevents the dialog from popping
  // back up after the user dismisses it). Persisted via sessionStorage so it
  // survives in-session navigations away (e.g. tapping the About / Privacy
  // links → static HTML pages → browser back) — useRef alone would reset on
  // every React re-mount and re-trigger the dialog on return.
  const autoOpenedAuthRef = useRef(false);
  useEffect(() => {
    if (autoOpenedAuthRef.current) return;
    if (!isAuthChecked) return;
    if (session) return;
    if (!Capacitor.isNativePlatform()) return;
    // Defer to the share/invite handlers above — if either of those is
    // about to open the dialog with a meaningful reason, don't double-fire.
    if (pendingShare) return;
    try {
      if (sessionStorage.getItem('autoOpenedAuthOnce') === '1') {
        autoOpenedAuthRef.current = true;
        return;
      }
      sessionStorage.setItem('autoOpenedAuthOnce', '1');
    } catch {
      // Storage access can throw in some embedded contexts — fall through
      // to the original ref-only behavior.
    }
    autoOpenedAuthRef.current = true;
    setIsAuthDialogOpen(true);
  }, [isAuthChecked, session, pendingShare]);

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
  // getLaunchUrl() persists at the native level across app launches — iOS
  // keeps returning the last-used deep link URL on every cold start, so
  // de-dupe across sessions via Preferences. Also guard within a session
  // with a ref so a re-render can't re-fire the dispatch.
  const launchUrlDispatchedRef = useRef(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (launchUrlDispatchedRef.current) return;
    launchUrlDispatchedRef.current = true;
    (async () => {
      const launch = await CapacitorApp.getLaunchUrl();
      if (!launch?.url) return;
      const { value: lastConsumed } = await Preferences.get({ key: 'lastConsumedLaunchUrl' });
      if (lastConsumed === launch.url) return;
      await Preferences.set({ key: 'lastConsumedLaunchUrl', value: launch.url });
      dispatchDeepLink(launch.url);
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
    // Read accessToken via ref so this closure always uses the latest token —
    // the bare `accessToken` const is captured per-render and may be stale (or
    // null on first render), causing the POST to send `Bearer null` and 401
    // silently. Also check `res.ok` so a 401/4xx surfaces instead of being
    // swallowed by `.then(r => r.json())`.
    register: async ({ apns_token }) => {
      const jwt = accessTokenRef.current;
      if (!jwt) throw new Error('no accessToken at /devices/register');
      const res = await fetch(`${API_BASE_URL}/devices/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apns_token }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
        throw new Error(`/devices/register ${res.status}${detail ? ` ${detail}` : ''}`);
      }
      return await res.json();
    },
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

  // Show welcome modal once after first sign-in.
  // Source of truth is the server (profiles.onboarding_seen) — localStorage
  // is a per-device cache so we don't flash the modal on every subsequent
  // load. iOS app reinstalls wipe localStorage but the server flag persists.
  useEffect(() => {
    if (!isAuthChecked || !session) return;
    if (new URLSearchParams(window.location.search).get('reset_onboarding') === '1') {
      localStorage.removeItem('onboarding_seen');
    }
    if (localStorage.getItem('onboarding_seen')) return;
    // Wait for profile to load before deciding — server flag wins over cold cache
    if (!userProfile) return;
    if (userProfile.onboardingSeen) {
      localStorage.setItem('onboarding_seen', '1');
      return;
    }

    // Welcome content lives inside OnboardingDrawer's first screen now —
    // no separate WelcomeModal Dialog.
    setOnboardingDrawerOpen(true);
  }, [isAuthChecked, session, userProfile]);

  // ── Profile API functions ─────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await callRecipesApi('/profile', {}, accessToken);
      if (res) {
        setUserProfile(res);
        if (session?.user?.id) writeCachedProfile(session.user.id, res);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  }, [accessToken, session?.user?.id]);

  const updateDisplayName = async (name) => {
    try {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name })
      }, accessToken);
      setUserProfile(prev => {
        const next = prev ? { ...prev, displayName: name } : prev;
        if (next && session?.user?.id) writeCachedProfile(session.user.id, next);
        return next;
      });
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

  // Single entry point for "view all friends" actions across the app — keeps
  // the BottomAppBar tab and the various in-app affordances (StatsTiles,
  // CookWithFriends, etc.) routing through the same prep work (initial tab
  // selection + data refresh).
  const navigateToFriendsTab = useCallback(() => {
    setFriendsInitialTab((friendRequests?.length ?? 0) > 0 ? 'pending' : 'connections');
    setCurrentView('friends');
    fetchFriends();
    fetchFriendRequests();
  }, [friendRequests, fetchFriends, fetchFriendRequests]);

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
      // When the source recipe is owned by another user, pass originalUserId
      // so the worker can notify that owner: "X saved your recipe [title]".
      // The owner's own id is filtered out server-side defensively.
      const ownerId = recipe.userId && session?.user?.id && recipe.userId !== session.user.id
        ? recipe.userId
        : null;
      const payload = {
        title: recipe.title,
        sourceUrl: recipe.sourceUrl || '',
        imageUrl: recipe.imageUrl || '',
        mealTypes: recipe.mealTypes || [],
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || null,
        durationMinutes: recipe.durationMinutes || null,
        notes: '',
        ...(ownerId ? { originalUserId: ownerId } : {}),
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
      setSnackbarState({ open: true, message: `"${recipe.title}" saved to your collection!`, severity: 'success', duration: 2000 });
      dismissSuggestion(recipe.id);
    } catch {
      setSnackbarState({ open: true, message: 'Failed to save recipe', severity: 'error' });
    }
  };

  const handleSharePublicRecipe = (recipe, event) => {
    const anchorPosition = event?.currentTarget
      ? { top: event.currentTarget.getBoundingClientRect().bottom, left: event.currentTarget.getBoundingClientRect().left }
      : { top: window.innerHeight / 2, left: window.innerWidth / 2 };
    const url = buildRecipeShareUrl(recipe.id, recipe.userId);
    setShareMenuState({ anchorPosition, url, title: recipe.title, imageUrl: recipe.imageUrl || '' });
  };

  const handleOpenEditorPickRecipe = (recipe) => {
    // When the user's own recipe surfaces in home-feed sections (e.g., a
    // friend recently shared it back, or it matches trending criteria),
    // open it with the owner three-dot menu rather than the share/save
    // template. Only recipes owned by someone else should be treated as
    // shared.
    if (recipe?.userId && session?.user?.id && recipe.userId === session.user.id) {
      handleOpenRecipeDetails(recipe);
      return;
    }
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


  // Mark onboarding seen — cache locally AND persist to server so it survives
  // iOS app reinstalls (which wipe the WKWebView localStorage).
  const markOnboardingSeen = async () => {
    localStorage.setItem('onboarding_seen', '1');
    if (!accessToken) return;
    try {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ onboardingSeen: true })
      }, accessToken);
      setUserProfile(prev => prev ? { ...prev, onboardingSeen: true } : prev);
    } catch (_) { /* non-fatal — localStorage still carries us through the session */ }
  };

  // OnboardingDrawer "Next" — save prefs to server then advance internally.
  const handleOnboardingSavePrefs = async (prefs) => {
    if (!accessToken) return;
    if (prefs.dietaryPrefs?.length || prefs.cookingFor || prefs.cuisinePrefs?.length) {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ dietaryPrefs: prefs.dietaryPrefs, cookingFor: prefs.cookingFor, cuisinePrefs: prefs.cuisinePrefs })
      }, accessToken);
      fetchProfile();
    }
  };

  // OnboardingDrawer "Get started" (or X tapped on the final checklist
  // screen) — close, mark seen, land on home with the checklist
  // collapsed by default (user just saw the same content in the drawer).
  const handleOnboardingComplete = async () => {
    setOnboardingDrawerOpen(false);
    setCurrentView('home');
    setChecklistKey((k) => k + 1);
    await markOnboardingSeen();
  };

  // OnboardingDrawer X close BEFORE the checklist screen — early exit. Mark
  // onboarding seen (don't keep nagging on every launch). The home
  // OnboardingChecklist auto-expands on its own while the user is under
  // 2/3 steps, so no session flag is needed here anymore.
  const handleOnboardingClose = async () => {
    setOnboardingDrawerOpen(false);
    setCurrentView('home');
    setChecklistKey((k) => k + 1);
    await markOnboardingSeen();
  };

  // OnboardingDrawer "Don't show this again" link on the welcome screen —
  // same handling as an early X dismiss: just mark seen. The home checklist
  // auto-expands while under 2/3 steps, so the user still sees the steps.
  const handleOnboardingSkipForever = async () => {
    setOnboardingDrawerOpen(false);
    setCurrentView('home');
    setChecklistKey((k) => k + 1);
    await markOnboardingSeen();
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

  // Tapping a "Friends You May Know" suggestion opens the same drawer as
  // tapping a friend, but loads from /users/:id/recipes (no friendship
  // required). Reuses the friend-recipes drawer's UI by setting selectedFriend
  // to a friend-shaped object; isSuggestion lets the drawer hide friend-only
  // affordances if needed. fromHomeFeed = true when the dialog wasn't already
  // open (i.e. tapped from FriendSections) — header hides the "← Friends"
  // back row so swipe-down is the only way back, returning to home rather
  // than to the friends list.
  const fetchSuggestionRecipes = async (suggestion) => {
    const fromHomeFeed = !isFriendsDialogOpen;
    trackEvent('view_suggestion_recipes', { name: suggestion.name || '' });
    setIsFriendsDialogOpen(true);
    setSelectedFriend({
      friendId: suggestion.userId,
      friendName: suggestion.name,
      avatarUrl: suggestion.avatarUrl ?? null,
      isSuggestion: true,
      fromHomeFeed,
    });
    setVisibleRecipeCount(7);
    setFriendRecipesLoading(true);
    try {
      const response = await callRecipesApi(
        `/users/${encodeURIComponent(suggestion.userId)}/recipes`,
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

  // === [S09] OTP state — both web and native show 6-digit code field after sending ===
  // Persisted to localStorage so the code-entry view survives iOS WebView reloads
  // when the user backgrounds the app to fetch the code from email.
  const [otpSentToEmail, setOtpSentToEmail] = useState(readPendingOtpEmail);
  const [otpCode, setOtpCode] = useState('');
  // === [/S09] ===

  // Shared core that signInWithOtp uses — called by both the initial send
  // (handleSendOtpCode) and the "Resend code" link in the OTP entry view.
  const sendOtpToEmail = async (email, { resend = false } = {}) => {
    if (!supabase) {
      setAuthError('Authentication is not configured.');
      return;
    }
    const trimmed = email.trim();
    if (!trimmed) {
      setAuthError('Please enter your email address.');
      return;
    }

    setIsAuthLoading(true);
    setAuthError('');

    try {
      // No emailRedirectTo — we sign in via the 8-digit code only. The
      // Supabase email template should render `{{ .Token }}` and omit
      // `{{ .ConfirmationURL }}` so users never see a tappable link.
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
      });

      if (error) throw error;

      writePendingOtpEmail(trimmed);
      setOtpSentToEmail(trimmed);
      setOtpCode('');
      setSnackbarState({
        open: true,
        message: resend
          ? `New code sent to ${trimmed}.`
          : 'Check your email for your sign-in code.',
        severity: 'success',
      });
    } catch (error) {
      setAuthError(error.message || (resend ? 'Failed to resend code.' : 'Failed to send code.'));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSendOtpCode = async (event) => {
    event.preventDefault();
    await sendOtpToEmail(authEmail);
  };

  const handleResendOtpCode = async () => {
    await sendOtpToEmail(otpSentToEmail, { resend: true });
  };

  // === [S09] Verify the 6-digit OTP code ===
  const handleVerifyOtpCode = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const code = otpCode.trim();
    if (code.length < 6) {
      setAuthError('Enter the verification code from your email.');
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
      clearPendingOtpEmail();
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
    // Drop any stale recipe deep-link before the session clears, so the
    // deep-link effect doesn't reprocess an own-recipe URL as a shared one
    // and spam the "Recipe not found" snackbar.
    clearRecipeDeepLinkFromUrl();
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
      severity: 'info',
      duration: 1000,
    });
  };

  // App Store Connect Apple ID for ReciFriend. The `itms-apps://` scheme
  // launches the App Store app directly to the write-review page on iOS;
  // the `https://apps.apple.com/…` fallback opens in Safari and bounces
  // to the App Store. iOS handles both transparently.
  const APP_STORE_ID = '6763828182';
  // Show the row in the Capacitor iOS app AND in iOS mobile Safari (PWA /
  // recifriend.com on iPhone). iOS recognizes the itms-apps:// scheme in
  // both contexts. Hide on desktop / Android since there's nothing to open.
  // The MacIntel + maxTouchPoints guard catches iPad on iPadOS 13+, which
  // otherwise reports a desktop UA.
  const isIOSEnv = (() => {
    if (Capacitor.isNativePlatform()) return true;
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  })();
  const handleRateOnAppStore = () => {
    const url = `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`;
    try {
      window.location.href = url;
    } catch (err) {
      console.error('[rate] failed to open App Store:', err);
      setSnackbarState({
        open: true,
        message: "Couldn't open the App Store. Please try again.",
        severity: 'warning',
        duration: 3000,
      });
    }
  };

  // Hits the worker's DELETE /profile, then signs out + closes the settings
  // drawer + redirects to the logged-out home. Throws so AboutContent can
  // show an inline error message on failure (network blip, etc).
  const handleDeleteAccount = async () => {
    if (!accessToken) {
      throw new Error('You appear to be signed out. Refresh and try again.');
    }
    await callRecipesApi('/profile', { method: 'DELETE' }, accessToken);
    clearRecipeDeepLinkFromUrl();
    clearRecipesCache();
    setRecipes([]);
    setHasNewRecipes(false);
    pendingRecipesRef.current = null;
    setSettingsDrawer(null);
    if (supabase) {
      try { await supabase.auth.signOut(); } catch (_) { /* swallow — local state is already wiped */ }
    }
    setSnackbarState({
      open: true,
      message: 'Account deleted.',
      severity: 'info',
      duration: 2000,
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

  const openAuthDialog = (opts = {}) => {
    setAuthEmail('');
    setAuthError('');
    setAuthDialogReason(opts.reason ?? null);
    setAuthDialogMode(opts.mode === 'join' ? 'join' : 'signin');
    setIsAuthDialogOpen(true);
  };

  const closeAuthDialog = () => {
    setIsAuthDialogOpen(false);
    setAuthEmail('');
    setAuthError('');
    setAuthDialogReason(null);
    setAuthDialogMode('signin');
    if (pendingShare) {
      clearPendingShare();
      setPendingShare(null);
    }
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
  const availableCuisines = useMemo(() => getUniqueCuisines(recipes), [recipes]);

  const filteredRecipes = useMemo(() => {
    const scored = recipes
      .map((recipe, index, array) => {
        if (showFavoritesOnly && !favorites.has(recipe.id)) {
          return null;
        }

        // Faceted filtering: OR within a facet, AND across facets. A recipe
        // must match at least one of the selected meal types AND at least one
        // of the selected cuisines AND at least one of the selected tags.
        if (selectedMealTypes.length > 0) {
          const matchesMealType = recipe.mealTypes.some(
            (type) => selectedMealTypes.some((s) => s.toLowerCase() === type.toLowerCase())
          );
          if (!matchesMealType) {
            return null;
          }
        }

        if (selectedCuisines.length > 0) {
          const matchesCuisine = (recipe.cuisines || []).some(
            (c) => selectedCuisines.some((s) => s.toLowerCase() === c.toLowerCase())
          );
          if (!matchesCuisine) return null;
        }

        if (selectedTags.length > 0) {
          const matchesAnyTag = (recipe.customTags || []).some(
            (t) => selectedTags.some((s) => s.toLowerCase() === t.toLowerCase())
          );
          if (!matchesAnyTag) return null;
        }

        let ingredientScore = 0;
        if (normalizedIngredients.length > 0) {
          const haystack = `${recipe.title} ${recipe.ingredients.join(' ')} ${
            recipe.steps ? recipe.steps.join(' ') : ''
          } ${(recipe.customTags || []).join(' ')}`.toLowerCase();

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
        const score = ingredientScore + (selectedMealTypes.length ? 1 : 0) + (selectedCuisines.length ? 1 : 0);
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
  }, [recipes, selectedMealTypes, selectedCuisines, selectedTags, normalizedIngredients, showFavoritesOnly, favorites]);

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

  // Refetch recipes when the app returns to the foreground — the share
  // extension may have saved a new recipe while we were backgrounded.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listenerHandle;
    let cancelled = false;
    CapacitorApp.addListener('appStateChange', (state) => {
      if (state.isActive && session?.user?.id) {
        syncRecipesFromApi({ forceUpdate: true }).catch(() => { /* best-effort refresh */ });
      }
    }).then((handle) => {
      if (cancelled) { handle.remove(); return; }
      listenerHandle = handle;
    });
    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
  }, [session?.user?.id, syncRecipesFromApi]);

  // Pull-to-refresh handler — fans out to the same fetchers that fire on
  // foreground/login so the user gets a real refresh on the home + recipes
  // views, not just a recipes list re-sync.
  const handlePullRefresh = useCallback(async () => {
    // Discover is a public tab — refresh it regardless of auth by remounting
    // DiscoverPage (it fetches its feeds on mount). Brief await so the PTR
    // spinner doesn't snap back before DiscoverPage swaps to its skeletons.
    if (currentView === 'discover') {
      setDiscoverRefreshKey((k) => k + 1);
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    if (!session?.user?.id) return;
    await Promise.allSettled([
      syncRecipesFromApi({ forceUpdate: true }),
      fetchProfile(),
      fetchFriendRequests(),
      fetchNotifications(),
    ]);
  }, [currentView, session?.user?.id, syncRecipesFromApi, fetchProfile, fetchFriendRequests, fetchNotifications]);

  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [selectedMealTypes, normalizedIngredientsKey, recipes]);

  // Capture Chrome/Android install prompt
  useEffect(() => {
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifriend-install-banner-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    if (onboardingDrawerOpen) return;
    let timer;
    const handler = (e) => {
      e.preventDefault();
      deferredInstallPrompt.current = e;
      timer = setTimeout(() => {
        if (!sessionStorage.getItem('invite_entry')) {
          setShowInstallBanner(true);
        }
      }, 15000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timer);
    };
  }, [onboardingDrawerOpen]);


  // Show "See this in app" prompt on iOS Mobile Safari after a 0.5s dwell.
  // Skipped inside the Capacitor app (we're already in it), in standalone
  // PWA mode, when the user has permanently dismissed it, or after they've
  // chosen "Continue in browser" earlier this session.
  useEffect(() => {
    if (!isAuthChecked) return;
    if (!isIosSafari) return;
    if (isStandalone) return;
    if (isPwaInstalled()) return;
    if (localStorage.getItem('recifriend-install-banner-dismissed')) return;
    if (sessionStorage.getItem('recifriend-app-prompt-dismissed')) return;
    if (sessionStorage.getItem('pending_invite_token')) return;
    if (sessionStorage.getItem('invite_entry')) return;
    if (onboardingDrawerOpen) return;
    const timer = setTimeout(() => setShowInstallBanner(true), 500);
    return () => clearTimeout(timer);
  }, [isAuthChecked, session, onboardingDrawerOpen]);

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
    setAddRecipeSource('manual');
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
  const activeRecipeDisplayDuration = activeRecipeView
    ? (activeRecipeView.durationMinutes
        || estimateDurationMinutes(activeRecipeView.steps, activeRecipeView.ingredients))
    : 0;

  const hasUnsavedChanges = useMemo(() => {
    if (!activeRecipe || !activeRecipeDraft) return false;
    return (
      activeRecipeDraft.title !== activeRecipe.title ||
      activeRecipeDraft.sourceUrl !== activeRecipe.sourceUrl ||
      activeRecipeDraft.notes !== activeRecipe.notes ||
      activeRecipeDraft.durationMinutes !== activeRecipe.durationMinutes ||
      JSON.stringify(activeRecipeDraft.ingredients) !== JSON.stringify(activeRecipe.ingredients) ||
      JSON.stringify(activeRecipeDraft.steps) !== JSON.stringify(activeRecipe.steps) ||
      JSON.stringify(activeRecipeDraft.mealTypes) !== JSON.stringify(activeRecipe.mealTypes) ||
      JSON.stringify(activeRecipeDraft.cuisines || []) !== JSON.stringify(activeRecipe.cuisines || []) ||
      JSON.stringify(activeRecipeDraft.customTags || []) !== JSON.stringify(activeRecipe.customTags || [])
    );
  }, [activeRecipe, activeRecipeDraft]);

  const activeRecipeImageUrl = useMemo(() => {
    if (!activeRecipeView) {
      return '';
    }
    return resolveRecipeImageUrl(activeRecipeView.title, activeRecipeView.imageUrl);
  }, [activeRecipeView]);

  // Distinct customTags across all of the user's recipes, sorted alphabetically.
  // Case-insensitive dedupe — when two recipes have different casings ("Meal Prep"
  // vs "meal prep"), the first occurrence wins. This list is what the
  // Autocomplete dropdown shows as suggestions, and what the filter drawer's Tags
  // section iterates over.
  const availableTags = useMemo(() => {
    const seenLower = new Set();
    const out = [];
    for (const r of recipes) {
      const tags = r.customTags || [];
      for (const tag of tags) {
        if (typeof tag !== 'string') continue;
        const lower = tag.toLowerCase();
        if (seenLower.has(lower)) continue;
        seenLower.add(lower);
        out.push(tag);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const newRecipePreviewImageUrl = useMemo(
    () => resolveRecipeImageUrl(newRecipeForm.title, newRecipeForm.imageUrl),
    [newRecipeForm.title, newRecipeForm.imageUrl]
  );

  const handleMealTypeToggle = (value) => {
    setSelectedMealTypes((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
    setCurrentView('recipes');
  };

  const handleCuisineToggle = (value) => {
    setSelectedCuisines((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
    setCurrentView('recipes');
  };

  const handleSnackbarClose = () => {
    setSnackbarState((prev) => ({ ...prev, open: false }));
  };

  const handleOpenRecipeDetails = useCallback((recipe, updateUrl = true) => {
    if (!recipe) {
      return;
    }
    // Reset shared-recipe flags so an own recipe opened right after a shared
    // recipe (e.g., closing a friend's recipe and tapping one of mine) renders
    // with the owner-layout three-dot menu, not the share/save template.
    setIsSharedRecipeView(false);
    setSharedRecipeOwnerId(null);
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

  useEffect(() => {
    acceptFriendRequestRef.current = acceptFriendRequest;
    accessTokenRef.current = accessToken;
  }, [acceptFriendRequest, accessToken]);

  useEffect(() => {
    setIsInferredCaveatOpen(false);
  }, [activeRecipe?.id]);

  // Handle URL parameters to open recipe modal on page load
  useEffect(() => {
    // Wait for Supabase to resolve auth — without this, on iOS app resume
    // the brief window where session is rehydrating causes own-recipe URLs
    // (?recipe=xxx&user=me) to be misread as shared-recipe URLs (since
    // currentUserId is undefined, sharedUserId !== currentUserId), flashing
    // the share/save layout before re-correcting to the owner layout.
    if (!isAuthChecked) return;

    const url = new URL(window.location.href);
    const shareToken = url.searchParams.get('share');
    // Recipe id from the new `/recipes/{id}` path form OR the legacy
    // `?recipe=` query (kept for already-shared old links).
    let recipeId = url.searchParams.get('recipe');
    if (!recipeId) {
      const m = url.pathname.match(/^\/recipes\/([^/?#]+)\/?$/);
      if (m) {
        try { recipeId = decodeURIComponent(m[1]); } catch { recipeId = m[1]; }
      }
    }
    const sharedUserId = url.searchParams.get('user');

    if (activeRecipe) return;

    // Recipient opened a shared link on web — once the recipe detail is
    // showing, surface the "See this in ReciFriend" app/browser drawer.
    // Respects the same opt-out gates as the timed prompt and waits a beat
    // so the recipe paints before the sheet slides up.
    const popShareAppPrompt = () => {
      if (isStandalone || isPwaInstalled()) return;
      if (localStorage.getItem('recifriend-install-banner-dismissed')) return;
      if (sessionStorage.getItem('recifriend-app-prompt-dismissed')) return;
      setTimeout(() => setShowInstallBanner(true), 500);
    };

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
            popShareAppPrompt();
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
            popShareAppPrompt();
          }
        } catch (error) {
          console.error('Error fetching shared recipe:', error);
          setSnackbarState({ open: true, message: 'Failed to load shared recipe', severity: 'error' });
        }
      };
      fetchSharedRecipe();
    }
  }, [recipes, activeRecipe, handleOpenRecipeDetails, session, isAuthChecked]);

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
        setAuthDialogReason(null);
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
          setAuthDialogReason(null);
          const name = res?.inviterName;
          setTimeout(() => {
            console.log('[INVITE DEBUG] showing snackbar (accept-invite path), name:', name);
            setSnackbarState({ open: true, message: name ? `You're now connected with ${name}` : "You're now connected!", severity: 'success', duration: 8000, anchorOrigin: { vertical: 'top', horizontal: 'center' } });
          }, 400);
          fetchFriends();
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifriend-install-banner-dismissed') && !sessionStorage.getItem('recifriend-app-prompt-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 15000);
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
                setAuthDialogReason(null);
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
      setAuthDialogReason(null);
      callRecipesApi('/friends/accept-open-invite', {
        method: 'POST',
        body: JSON.stringify({ token: pendingOpenInviteToken })
      }, accessToken)
        .then((result) => {
          setIsAuthDialogOpen(false);
          setAuthDialogReason(null);
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
              setIsAuthDialogOpen(false);
              setAuthDialogReason(null);
              setSnackbarState({
                open: true,
                message: `"${recipe.title}" saved to your recipes!`,
                severity: 'success',
                duration: 2000,
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
          if (!isStandalone && !isPwaInstalled() && !localStorage.getItem('recifriend-install-banner-dismissed') && !sessionStorage.getItem('recifriend-app-prompt-dismissed')) {
            setTimeout(() => setShowInstallBanner(true), 15000);
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
      severity: 'info',
      duration: 2000
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
      severity: 'success',
      duration: 2000
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

      // Track whether the merge actually filled visible content, separate from
      // bookkeeping-only updates (provenance). The toast wording depends on this.
      let addedContent = false;

      setActiveRecipeDraft((prev) => {
        if (!prev) {
          return prev;
        }
        const next = { ...prev };
        let changed = false;

        if ((!next.title || !next.title.trim()) && enriched.title) {
          next.title = enriched.title;
          changed = true;
          addedContent = true;
        }

        if (Array.isArray(enriched.ingredients) && enriched.ingredients.length > 0) {
          if (!Array.isArray(next.ingredients) || next.ingredients.length === 0) {
            next.ingredients = [...enriched.ingredients];
            changed = true;
            addedContent = true;
          }
        }

        if (Array.isArray(enriched.steps) && enriched.steps.length > 0) {
          if (!Array.isArray(next.steps) || next.steps.length === 0) {
            next.steps = [...enriched.steps];
            changed = true;
            addedContent = true;
          }
        }

        if (Array.isArray(enriched.mealTypes) && enriched.mealTypes.length > 0) {
          if (!Array.isArray(next.mealTypes) || next.mealTypes.length === 0) {
            next.mealTypes = [...enriched.mealTypes];
            changed = true;
            addedContent = true;
          }
        }

        if (!next.durationMinutes && typeof enriched.durationMinutes === 'number') {
          next.durationMinutes = enriched.durationMinutes;
          changed = true;
          addedContent = true;
        }

        // Update image if missing or using placeholder SVG
        const hasPlaceholderImage = next.imageUrl && next.imageUrl.startsWith('data:image/svg');
        if ((!next.imageUrl || !next.imageUrl.trim() || hasPlaceholderImage) && enriched.imageUrl) {
          next.imageUrl = enriched.imageUrl;
          changed = true;
          addedContent = true;
        }

        if ((!next.notes || !next.notes.trim()) && enriched.notes) {
          next.notes = enriched.notes;
          changed = true;
          addedContent = true;
        }

        // Provenance on its own is bookkeeping — don't let it trigger the
        // "AI suggestions added" toast when no visible field actually changed.
        if (
          enriched.provenance === 'extracted'
          || enriched.provenance === 'inferred'
          || enriched.provenance === 'title-only'
          || enriched.provenance === null
        ) {
          if (next.provenance !== enriched.provenance) {
            next.provenance = enriched.provenance;
            changed = true;
          }
        }

        return changed ? next : prev;
      });

      // Tailor the snackbar to the actual outcome. "title-only" means the
      // server fetched the source but found a dish name without a structured
      // ingredient list — re-running won't help; the user needs to fill in
      // manually.
      const isTitleOnly = enriched.provenance === 'title-only';
      setSnackbarState({
        open: true,
        message: addedContent
          ? 'AI suggestions added. Review and save to keep changes.'
          : isTitleOnly
            ? "We couldn't find a structured recipe in this source — tap an ingredient row to add ingredients manually."
            : "Couldn't grab recipe details right now. Try again in a minute, or add the ingredients yourself.",
        severity: addedContent ? 'info' : 'warning',
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
    const isRecipePath = /^\/recipes\/[^/?#]+\/?$/.test(url.pathname);
    if (isRecipePath || url.searchParams.has('recipe') || url.searchParams.has('user') || url.searchParams.has('share')) {
      url.searchParams.delete('recipe');
      url.searchParams.delete('user');
      url.searchParams.delete('share');
      if (isRecipePath) url.pathname = '/';
      window.history.pushState({}, '', url.toString());
    }
  };
  // Keep the ref pointed at the latest closeDialog so the stable deep-link
  // dispatcher can call it when 'View on ReciFriend' fires.
  closeDialogRef.current = closeDialog;

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
      dismissSuggestion(activeRecipe.id);
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
    setAddRecipeSource('manual');
    setIsAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    setIsAddDialogOpen(false);
    setIsFirstRecipe(false);
    setAddRecipeSource(null);
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
        // Worker returns a 400 with a friendly message for unsupported hosts
        // (the source-URL allowlist). Surface that so the user sees why the
        // form didn't auto-fill instead of an unexplained "idle" state. Match
        // on the word "supported" since both pre- and post-redirect messages
        // include it and the platform list may change over time.
        const message = typeof error?.message === 'string' ? error.message : '';
        if (/supported/i.test(message)) {
          setSourceParseState({ status: 'error', message });
          return;
        }
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
            // Stamp provenance so the POST /recipes payload reflects the
            // enrich outcome — most importantly 'title-only' for empty-
            // caption reels, which the recipe-detail UI uses to hide the
            // Auto-fill / Enhance-with-AI button.
            if (
              enriched.provenance === 'extracted'
              || enriched.provenance === 'inferred'
              || enriched.provenance === 'title-only'
            ) {
              if (next.provenance !== enriched.provenance) {
                next.provenance = enriched.provenance;
                changed = true;
              }
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

    // Share-extension layout hides the title error helper; substitute a default
    // so the drawer never silently no-ops on a whitespace-only title.
    const trimmedTitle = newRecipeForm.title.trim();
    const title = addRecipeSource === 'share-extension' && !trimmedTitle
      ? 'Untitled recipe'
      : trimmedTitle;
    if (!title) {
      errors.title = 'Title is required.';
    }

    const sourceUrlError = validateUrl(newRecipeForm.sourceUrl.trim(), { required: true });
    if (sourceUrlError) {
      errors.sourceUrl = sourceUrlError;
    }

    if (Object.keys(errors).length > 0) {
      setNewRecipeErrors(errors);
      // The share-extension layout renders no URL/title fields, so
      // field-level errors are invisible. Surface them via snackbar so
      // the user isn't stuck tapping Save with no feedback.
      if (addRecipeSource === 'share-extension') {
        setSnackbarState({
          open: true,
          message: errors.sourceUrl || errors.title || 'Unable to save recipe.',
          severity: 'error',
        });
      }
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
      sharedWithFriends: newRecipeForm.sharedWithFriends ? 1 : 0,
      provenance: newRecipeForm.provenance ?? null,
    };

    const resetFormState = (message) => {
      setCurrentView('recipes');
      setSelectedMealTypes([]);
      setIngredientInput('');
      setVisibleCount(RESULTS_PAGE_SIZE);
      setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
      setNewRecipeErrors({});
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      setIsAddDialogOpen(false);
      setAddRecipeSource(null);
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
              provenance:
                enriched.provenance === 'extracted'
                  || enriched.provenance === 'inferred'
                  || enriched.provenance === 'title-only'
                  ? enriched.provenance
                  : (savedRecipe.provenance ?? null),
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

        // Save-time silent retry: the worker's enrichAfterSave runs via
        // ctx.waitUntil and typically takes 5–30s. If this recipe came in
        // empty (no ingredients OR no steps), refetch the row at t+6s and
        // t+18s so by the time the user opens the detail, the row reflects
        // whatever enrichAfterSave wrote. Best-effort; errors are swallowed.
        if (savedRecipe.sourceUrl && (!savedHasIngredients || !savedHasSteps)) {
          const retryId = savedRecipe.id;
          const retryToken = accessToken;
          const silentRefetch = async () => {
            try {
              const res = await callRecipesApi(`/recipes/${encodeURIComponent(retryId)}`, {}, retryToken);
              const refreshed = normalizeRecipeFromApi(res?.recipe);
              if (!refreshed) return;
              setRecipes((prev) => prev.map((r) => (r.id === refreshed.id ? refreshed : r)));
              setActiveRecipe((curr) => (curr?.id === refreshed.id ? refreshed : curr));
            } catch { /* best-effort */ }
          };
          setTimeout(silentRefetch, 6000);
          setTimeout(silentRefetch, 18000);
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
    const url = buildRecipeShareUrl(recipe.id, recipe.userId);
    const subject = `A recipe was shared with you on ReciFriend.`;
    const body = `A recipe was shared with you on ReciFriend.\n\n${recipe.title}\n\n${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: subject, text: body, url });
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
      const shareUrl = buildRecipeShareUrl(recipeId, ownerId);
      const sharerName = userProfile?.displayName || 'A friend';
      const subject = `${sharerName} shared a recipe with you on ReciFriend.`;
      const body = `${sharerName} shared a recipe with you on ReciFriend.\n\n${recipe.title}\n\n${shareUrl}`;

      if (navigator.share) {
        try {
          await navigator.share({ title: subject, text: body, url: shareUrl });
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
      trackEvent('share_recipe', { method: 'in_app_friends' });
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
    if (action === 'copy-link' && pickerRecipeId) {
      // Same canonical path link as every other share surface (Option 1):
      // consistent, deep-links into the app, one OG path. Existing opaque
      // ?share={token} links still resolve server-side for backward compat.
      const shareUrl = buildRecipeShareUrl(pickerRecipeId, session?.user?.id || null);
      navigator.clipboard.writeText(shareUrl);
      trackEvent('share_recipe', { method: 'in_app_copy_link' });
    }
  };
  // === [/S04] ===

  const useIosShareLayout = isMobile && addRecipeSource === 'share-extension';
  const hasTitle = Boolean(newRecipeForm.title && newRecipeForm.title.trim());
  const hasImage = Boolean(newRecipeForm.imageUrl && newRecipeForm.imageUrl.trim());
  const shareLayoutIsLoading = useIosShareLayout && !hasTitle && sourceParseState.status === 'loading';
  const shareLayoutIsError = useIosShareLayout && !hasTitle && sourceParseState.status === 'error';

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />


      <OnboardingDrawer
        open={onboardingDrawerOpen}
        inviterName={inviterName}
        initialPrefs={{
          dietaryPrefs: userProfile?.dietaryPrefs ?? [],
          cookingFor: userProfile?.cookingFor ?? '',
          cuisinePrefs: userProfile?.cuisinePrefs ?? [],
        }}
        onSavePrefs={handleOnboardingSavePrefs}
        onComplete={handleOnboardingComplete}
        onClose={handleOnboardingClose}
        onSkipForever={handleOnboardingSkipForever}
      />

      <AddFriendDrawer
        open={addFriendDrawerOpen}
        onClose={() => setAddFriendDrawerOpen(false)}
        loading={openInviteLinkLoading}
        inviteToken={openInviteLink}
        accessToken={accessToken}
        onTapSuggestion={fetchSuggestionRecipes}
        onShareEmail={async (existingToken) => {
          let token = existingToken;
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
        }}
        onShareText={async (existingToken) => {
          let token = existingToken;
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
        }}
        onShareCopyLink={async (existingToken) => {
          let token = existingToken;
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

      {/* Logged-out home: show discovery landing page. Other tabs (recipes,
          discover) are reachable for logged-out users via the bottom nav so
          Apple App Review can access non-account features without registering.
          Only render after auth is checked to avoid flash. */}
      {!session && isAuthChecked && currentView === 'home' && (
        <PublicLanding
          onJoin={() => openAuthDialog({ mode: 'join' })}
          onLogin={openAuthDialog}
          onOpenRecipe={handleOpenRecipeDetails}
          darkMode={darkMode}
          onCookWithFriendsVisible={setCookWithFriendsVisible}
          onShare={(recipe, event) => openShareSheet(recipe, event)}
        />
      )}

      {/* Main container renders for logged-in users (all views) and for
          logged-out users on non-home tabs. PublicLanding owns the logged-out
          home layout above. */}
      {(session || !isAuthChecked || (isAuthChecked && currentView !== 'home')) && (<Container maxWidth="lg" disableGutters>
        <Box
          sx={{
            px: { xs: 2, sm: 3, md: 4 },
            // Top inset now content-managed since the top AppBar was removed.
            // Friends view owns its own top padding (so the sticky title+tabs
            // can pin all the way to viewport top with bg covering the notch).
            pt: currentView === 'friends'
              ? 0
              : { xs: 'calc(env(safe-area-inset-top) + 16px)', md: 'calc(env(safe-area-inset-top) + 22px)' },
            // Bottom space for the BottomAppBar (64) + safe-area + room for the
            // floating Add Recipe pill FAB above it.
            pb: { xs: 'calc(64px + env(safe-area-inset-bottom) + 80px)', md: 4 },
          }}
        >
          <Stack spacing={1.5}>
            {currentView === 'home' && session && (
              <>
                <Box>
                  <Typography
                    sx={{
                      fontFamily: "'Fraunces', Georgia, serif",
                      fontWeight: 600,
                      fontSize: '26px',
                      lineHeight: 1.2,
                      letterSpacing: '-0.01em',
                      color: 'text.primary',
                    }}
                  >
                    {(userProfile?.displayName || session.user?.email?.split('@')[0] || 'there').split(' ')[0]}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: "'Fraunces', Georgia, serif",
                      fontStyle: 'italic',
                      fontWeight: 400,
                      fontSize: '18px',
                      color: 'text.secondary',
                      mt: '4px',
                      lineHeight: 1.25,
                      // Typewriter-style reveal: clip-path peels back from the
                      // right edge in discrete steps so the line reads as being
                      // typed left-to-right. inline-block sizes the Typography
                      // to its text width so the clip animates over the text
                      // (not trailing empty space). 120ms delay lets the user's
                      // name register first; `both` holds the pre-animation
                      // clip so there's no pre-flash of full text.
                      display: 'inline-block',
                      maxWidth: '100%',
                      animation: 'greetingType 500ms steps(30, end) 120ms both',
                      '@keyframes greetingType': {
                        '0%':   { clipPath: 'inset(0 100% 0 0)' },
                        '100%': { clipPath: 'inset(0 0 0 0)' },
                      },
                      '@media (prefers-reduced-motion: reduce)': {
                        animation: 'none',
                        clipPath: 'inset(0 0 0 0)',
                      },
                    }}
                  >
                    {getHomeGreetingMessage()}
                  </Typography>
                </Box>
                {(() => {
                  const userId = session?.user?.id;
                  const hasRecipe = recipes.length > 0;
                  const hasInvitedFriend =
                    Boolean(userId && localStorage.getItem(`onboarding_invited_${userId}`)) ||
                    friends.length > 0;
                  const hasSharedRecipe = Boolean(
                    userId && localStorage.getItem(`onboarding_shared_${userId}`)
                  );
                  const allDoneFlag = userId ? `onboarding_complete_${userId}` : null;
                  const allDoneCached = Boolean(allDoneFlag && localStorage.getItem(allDoneFlag));
                  const allDoneNow = hasRecipe && hasInvitedFriend && hasSharedRecipe;
                  if (allDoneNow && allDoneFlag && !allDoneCached) {
                    localStorage.setItem(allDoneFlag, '1');
                  }
                  // No manual dismiss — the module self-removes only when all
                  // 3 steps are complete.
                  if (allDoneCached || allDoneNow) return null;
                  // Wrapper Box adds 10px of padding-top above the checklist.
                  // Combined with the parent Stack's 12px margin between
                  // children, the total visible gap from greeting bottom to
                  // the checklist's border = 12 + 10 = 22px. Padding (not
                  // margin) — see feedback_mui_stack_spacing memory.
                  return (
                    <Box sx={{ pt: '10px' }}>
                      <OnboardingChecklist
                        key={checklistKey}
                        hasRecipe={hasRecipe}
                        hasInvitedFriend={hasInvitedFriend}
                        hasSharedRecipe={hasSharedRecipe}
                        onAddRecipe={openAddDialog}
                        onInviteFriend={() => setAddFriendDrawerOpen(true)}
                      />
                    </Box>
                  );
                })()}
                {/* Use padding-top, not margin-top — see
                    feedback_mui_stack_spacing memory note. The parent Stack
                    adds 12px on top of this child; with pt:20px the total
                    visible gap above StatsTiles is 32px. */}
                {/* Design 1 — clickable, animated. Design 2 + original
                    StatsTiles + StatsTilesPreview kept commented below for
                    easy revert / comparison. */}
                <Box sx={{ pt: '20px' }}>
                  <StatsTilesDesign1
                    recipeCount={recipes.length}
                    friendCount={friendsLoaded ? friends.length : null}
                    onAddRecipe={openAddDialog}
                    onViewRecipes={() => setCurrentView('recipes')}
                    onAddFriends={() => setAddFriendDrawerOpen(true)}
                    onViewFriends={navigateToFriendsTab}
                  />
                </Box>
                {/* --- Design 2 (uncomment to swap back) ---
                <Box sx={{ pt: '20px' }}>
                  <StatsTilesDesign2
                    recipeCount={recipes.length}
                    friendCount={friendsLoaded ? friends.length : null}
                    onAddRecipe={openAddDialog}
                    onViewRecipes={() => setCurrentView('recipes')}
                    onAddFriends={() => setAddFriendDrawerOpen(true)}
                    onViewFriends={navigateToFriendsTab}
                  />
                </Box>
                */}
                {/* --- Original StatsTiles (revert path: uncomment below,
                    delete the active block above) ---
                <Box sx={{ pt: '20px' }}>
                  <StatsTilesPreview />
                </Box>
                <Box sx={{ pt: '20px' }}>
                  <StatsTiles
                    recipeCount={recipes.length}
                    friendCount={friendsLoaded ? friends.length : null}
                    onAddRecipe={openAddDialog}
                    onViewRecipes={() => setCurrentView('recipes')}
                    onAddFriends={() => setAddFriendDrawerOpen(true)}
                    onViewFriends={navigateToFriendsTab}
                  />
                </Box>
                */}
                {/* Use padding-top instead of margin-top: the parent
                    <Stack spacing={1.5}> applies a 12px margin-top via a
                    selector with higher specificity than child sx, which
                    silently overrides any mt set here. Padding sits on the
                    box itself and isn't contested. Total visible gap above
                    "Friend Activity" = 12 (Stack mt) + 30 (this pt) = 42px. */}
                <Box sx={{ pt: '30px' }}>
                <Box ref={statsTilesRef} sx={{ height: 0 }} />
                <FriendSections
                  accessToken={accessToken}
                  cookingFor={userProfile?.cookingFor ?? null}
                  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
                  dietaryPrefs={userProfile?.dietaryPrefs ?? null}
                  onOpenRecipe={handleOpenEditorPickRecipe}
                  onSaveRecipe={handleSavePublicRecipe}
                  onShareRecipe={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
                  onInviteFriend={() => setAddFriendDrawerOpen(true)}
                  onOpenFriends={navigateToFriendsTab}
                  onSuggestionTap={fetchSuggestionRecipes}
                  onOpenFriendRecipes={(userId, name, avatarUrl) => fetchSuggestionRecipes({ userId, name, avatarUrl })}
                  onAcceptFriendRequest={acceptFriendRequest}
                  onDeclineFriendRequest={declineFriendRequest}
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
                dismissedSuggestionIds={dismissedSuggestionIds}
                onDismissSuggestion={(recipe) => dismissSuggestion(recipe.id)}
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
                sentinelRef={sentinelRef}
                availableMealTypes={availableMealTypes}
                selectedMealTypes={selectedMealTypes}
                onMealTypeToggle={(type) => handleMealTypeToggle(type)}
                onClearMealTypes={() => setSelectedMealTypes([])}
                availableCuisines={availableCuisines}
                selectedCuisines={selectedCuisines}
                onCuisineToggle={(c) => handleCuisineToggle(c)}
                onClearCuisines={() => setSelectedCuisines([])}
                availableTags={availableTags}
                selectedTags={selectedTags}
                onTagToggle={(t) => setSelectedTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                onClearTags={() => setSelectedTags([])}
                showFavoritesOnly={showFavoritesOnly}
                onToggleFavoritesOnly={() => setShowFavoritesOnly((prev) => !prev)}
                MEAL_TYPE_LABELS={MEAL_TYPE_LABELS}
                MEAL_TYPE_ICONS={MEAL_TYPE_ICONS}
                CUISINE_LABELS={CUISINE_LABELS}
              />
            )}
            {currentView === 'friends' && session && (
              <FriendsPage
                friends={friends}
                pendingRequests={friendRequests}
                sentRequests={sentRequests}
                sentInvites={sentInvites}
                initialTab={friendsInitialTab}
                onTapFriend={(friend) => {
                  setIsFriendsDialogOpen(true);
                  fetchFriendRecipes(friend);
                }}
                onRemoveFriend={(friend) => setFriendConfirm({
                  open: true,
                  title: 'Remove friend',
                  message: `Remove ${friend.friendName || friend.friendEmail} from your friends?`,
                  onConfirm: () => removeFriend(friend.friendId),
                })}
                onAccept={acceptFriendRequest}
                onDecline={declineFriendRequest}
                onCancelSentRequest={cancelSentFriendRequest}
                onCancelInvite={cancelInvite}
              />
            )}
            {currentView === 'discover' && (
              <DiscoverPage
                key={discoverRefreshKey}
                accessToken={accessToken}
                cookingFor={userProfile?.cookingFor ?? null}
                cuisinePrefs={userProfile?.cuisinePrefs ?? null}
                dietaryPrefs={userProfile?.dietaryPrefs ?? null}
                onOpenRecipe={handleOpenEditorPickRecipe}
                onSaveRecipe={handleSavePublicRecipe}
                onShareRecipe={(recipe, event) => openShareSheet(recipe, event)}
              />
            )}
            {currentView === 'profile' && session && (
              <ProfilePage
                user={{
                  displayName: userProfile?.displayName,
                  email: session.user?.email,
                  avatarUrl: userProfile?.avatarUrl ?? null,
                }}
                themePref={themePref}
                onThemeChange={updateThemePref}
                onEditName={() => {
                  setEditNameValue(userProfile?.displayName || '');
                  setIsEditNameOpen(true);
                }}
                onPickAvatar={async (file) => {
                  if (!accessToken || !file) return;
                  // 8MB pre-base64 cap (worker enforces 5MB on the decoded
                  // payload; data-URL encoding adds ~33% overhead).
                  if (file.size > 8 * 1024 * 1024) {
                    setSnackbarState({ open: true, message: 'Image is too large. Pick something under 5MB.', severity: 'error' });
                    return;
                  }
                  setAvatarUploading(true);
                  try {
                    const readRaw = () => new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.onerror = () => reject(reader.error || new Error('read failed'));
                      reader.readAsDataURL(file);
                    });
                    // Downscale to a 256x256 square before upload. If decoding the
                    // image fails (exotic format, etc.) fall back to a raw upload —
                    // the worker still enforces the 5MB cap.
                    let dataUrl;
                    try {
                      dataUrl = await downscaleAvatar(file);
                    } catch (resizeErr) {
                      console.warn('avatar downscale failed, uploading original:', resizeErr);
                      dataUrl = await readRaw();
                    }
                    const contentType = (typeof dataUrl === 'string' && dataUrl.startsWith('data:'))
                      ? (dataUrl.slice(5, dataUrl.indexOf(';')) || file.type || 'image/jpeg')
                      : (file.type || 'image/jpeg');
                    const res = await callRecipesApi('/profile/avatar', {
                      method: 'POST',
                      body: JSON.stringify({ dataUrl, contentType }),
                    }, accessToken);
                    if (res?.avatarUrl) {
                      setUserProfile((prev) => prev ? { ...prev, avatarUrl: res.avatarUrl } : prev);
                    }
                  } catch (err) {
                    console.error('avatar upload failed:', err);
                    setSnackbarState({ open: true, message: 'Could not upload avatar. Try again.', severity: 'error' });
                  } finally {
                    setAvatarUploading(false);
                  }
                }}
                avatarUploading={avatarUploading}
                onRemoveAvatar={async () => {
                  if (!accessToken) return;
                  setAvatarUploading(true);
                  try {
                    const res = await callRecipesApi('/profile/avatar', { method: 'DELETE' }, accessToken);
                    setUserProfile((prev) => prev ? { ...prev, avatarUrl: res?.avatarUrl ?? null } : prev);
                  } catch (err) {
                    console.error('avatar remove failed:', err);
                    setSnackbarState({ open: true, message: 'Could not remove avatar. Try again.', severity: 'error' });
                  } finally {
                    setAvatarUploading(false);
                  }
                }}
                onEditCookingPrefs={() => setSettingsDrawer('preferences')}
                onSendFeedback={() => setSettingsDrawer('feedback')}
                onRateOnAppStore={isIOSEnv ? handleRateOnAppStore : undefined}
                onOpenAbout={() => setSettingsDrawer('about')}
                onOpenNotifications={() => setSettingsDrawer('notifications')}
                onPrivacy={() => setSettingsDrawer('privacy')}
                onSignOut={handleLogout}
                notificationsEnabled={true}
              />
            )}
          </Stack>
        </Box>
      </Container>)}

      {isAuthChecked && (
        <BottomAppBar
          activeTab={
            currentView === 'home' ? 'home' :
            currentView === 'recipes' ? 'recipes' :
            currentView === 'friends' ? 'friends' :
            currentView === 'discover' ? 'discover' :
            currentView === 'profile' ? 'profile' :
            null
          }
          onTabChange={(tab) => {
            if (!session && (tab === 'friends' || tab === 'profile')) {
              openAuthDialog({ mode: 'join' });
              return;
            }
            if (tab === 'friends') {
              navigateToFriendsTab();
            } else {
              setCurrentView(tab);
            }
          }}
          pendingFriendCount={session ? (friendRequests?.length ?? 0) : 0}
          profileInitial={userProfile?.displayName || session?.user?.email || 'U'}
          profileAvatarUrl={userProfile?.avatarUrl || null}
          signedIn={!!session}
        />
      )}

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
          const sharerName = userProfile?.displayName || 'A friend';
          const subject = `${sharerName} shared a recipe with you on ReciFriend.`;
          const body = `${sharerName} shared a recipe with you on ReciFriend.\n\n${title}\n\n${url}`;
          if (navigator.share) {
            try {
              await navigator.share({ title: subject, text: body, url });
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
          const sharerName = userProfile?.displayName || 'A friend';
          const subject = encodeURIComponent(`${sharerName} shared a recipe with you on ReciFriend.`);
          const body = encodeURIComponent(`${sharerName} shared a recipe with you on ReciFriend.\n\n${title}\n\n${url}`);
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
          trackEvent('share_recipe', { method: 'email' });
        }}>
          <ListItemIcon><EmailOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Email</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          const { url, title } = shareMenuState;
          setShareMenuState(null);
          const sharerName = userProfile?.displayName || 'A friend';
          const body = encodeURIComponent(`${sharerName} shared a recipe with you on ReciFriend.\n\n${title}\n\n${url}`);
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
                      sx={{ fontWeight: 700, fontSize: '1.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
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
                {!isEditMode && activeRecipeDisplayDuration ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(activeRecipeDisplayDuration)}
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
                      transition: 'all 250ms ease'
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
                    {/* Close button overlay on thumbnail — hidden when stuck.
                        iOS-style: small circular translucent backdrop in the
                        top-left corner with safe-area-aware padding. */}
                    {isMobile && !isStickyStuck && (
                      <IconButton
                        aria-label="Close recipe details"
                        onClick={(e) => { e.stopPropagation(); closeDialog(); }}
                        sx={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          width: 40,
                          height: 40,
                          backgroundColor: 'rgba(0, 0, 0, 0.55)',
                          color: '#fff',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.7)' },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 24 }} />
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
                        sx={{ fontWeight: 700, fontSize: '1.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
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
                  {!isEditMode && activeRecipeDisplayDuration ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                      <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        {formatDuration(activeRecipeDisplayDuration)}
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
                      {(activeRecipeView.ingredients || []).map((item, i) => (
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
                    {activeRecipeView.provenance === 'inferred' && (
                      <Box sx={{ mb: 1.5 }}>
                        <Chip
                          icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
                          label="AI-inferred"
                          size="small"
                          variant="outlined"
                          onClick={() => setIsInferredCaveatOpen((v) => !v)}
                          sx={{
                            color: 'warning.dark',
                            borderColor: 'warning.light',
                            cursor: 'pointer',
                            '&:hover': { backgroundColor: 'warning.light', opacity: 0.15 }
                          }}
                        />
                        {isInferredCaveatOpen && (
                          <Typography
                            variant="caption"
                            sx={{ display: 'block', color: 'text.secondary', mt: 0.5, maxWidth: 420 }}
                          >
                            We couldn't read the full recipe. Please verify with the source.
                          </Typography>
                        )}
                      </Box>
                    )}
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

                {(isEditMode || (activeRecipeView.cuisines && activeRecipeView.cuisines.length > 0)) && (
                  <Box>
                    <Divider sx={{ borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : '#E0E0E0', mb: 3 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Cuisines
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {isEditMode ? (
                        CUISINE_ORDER.map((c) => {
                          const isSelected = (activeRecipeView.cuisines || []).includes(c);
                          return (
                            <Chip
                              key={c}
                              label={CUISINE_LABELS[c] || c}
                              size="small"
                              variant={isSelected ? 'filled' : 'outlined'}
                              color={isSelected ? 'primary' : 'default'}
                              onClick={isSharedRecipeView ? undefined : () => {
                                setActiveRecipeDraft((prev) => {
                                  if (!prev) return prev;
                                  const currentCuisines = prev.cuisines || [];
                                  const newCuisines = isSelected
                                    ? currentCuisines.filter((t) => t !== c)
                                    : [...currentCuisines, c];
                                  return { ...prev, cuisines: newCuisines };
                                });
                              }}
                              sx={{ cursor: isSharedRecipeView ? 'default' : 'pointer' }}
                            />
                          );
                        })
                      ) : (
                        (activeRecipeView.cuisines || []).map((c) => (
                          <Chip
                            key={c}
                            label={CUISINE_LABELS[c] || c}
                            size="small"
                            variant="filled"
                            color="primary"
                          />
                        ))
                      )}
                    </Box>
                  </Box>
                )}

                {((activeRecipeView.customTags || []).length > 0 || isEditMode) && (
                  <Box sx={{ pb: isEditMode ? 3 : 0 }}>
                    <Divider sx={{ borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : '#E0E0E0', mb: 3 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Tags
                    </Typography>
                    {isEditMode ? (
                      <CustomTagsAutocomplete
                        availableTags={availableTags}
                        value={activeRecipeDraft?.customTags ?? []}
                        onValueChange={(next) => setActiveRecipeDraft((prev) => prev ? { ...prev, customTags: next } : prev)}
                        disabled={isSharedRecipeView}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {(activeRecipeView.customTags || []).map((t) => (
                          <Chip key={t} label={t} size="small" variant="filled" color="primary" />
                        ))}
                      </Box>
                    )}
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
                  {(() => {
                    const sharedSaved = isRecipeAlreadySaved(activeRecipe);
                    return (
                      <Button
                        variant={sharedSaved ? 'outlined' : 'contained'}
                        color="primary"
                        onClick={sharedSaved ? undefined : handleSaveSharedRecipe}
                        startIcon={sharedSaved ? <CheckIcon /> : <BookmarkBorderIcon />}
                        sx={{ flex: 1, ...(sharedSaved ? {
                          pointerEvents: 'none',
                          color: '#4caf50',
                          // Scope to .MuiButton-outlined so this beats the
                          // variant's primary border-color on the light
                          // palette — keeps the outline matching the
                          // checkmark in both themes.
                          '&.MuiButton-outlined': { borderColor: '#4caf50' },
                        } : {}) }}
                      >
                        {sharedSaved ? 'Saved' : 'Save'}
                      </Button>
                    );
                  })()}
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
                    {/* Auto-fill is shown for any recipe with a sourceUrl —
                        even when provenance is 'title-only' from a prior
                        empty enrichment. Reason: the chain can come back
                        empty for transient reasons (CF datacenter rate-
                        limited by Instagram, r.jina.ai blocking, Gemini
                        timeout) where re-running later WILL succeed. Hiding
                        the button stranded users on real recipes whose
                        first parse happened to fail. The "couldn't find a
                        structured recipe" snackbar still surfaces when the
                        retry comes back empty, so users get the right
                        signal either way.
                        visibility:hidden + pointerEvents:none keeps the
                        slot width (Cancel/Save stay anchored) for the
                        no-sourceUrl case. */}
                    {(() => {
                      const showAutofill = isRemoteEnabled && !!activeRecipeDraft?.sourceUrl;
                      return (
                        <Typography
                          component="button"
                          onClick={(isActiveRecipeEnhancing || !showAutofill) ? undefined : handleEnhanceActiveRecipe}
                          aria-hidden={!showAutofill}
                          tabIndex={showAutofill ? 0 : -1}
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
                            visibility: showAutofill ? 'visible' : 'hidden',
                            pointerEvents: showAutofill ? 'auto' : 'none',
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
                      );
                    })()}
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
          <MenuItem onClick={() => { setRecipeMenuAnchor(null); openShareSheet(activeRecipe); }}>
            <ListItemIcon><IosShareOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Share</ListItemText>
          </MenuItem>
        )}
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
              // Open as a tall sheet (like the iOS share drawer) instead of
              // sizing to content. Title bar pinned top, content scrolls,
              // Save button pinned bottom via the flex column below.
              height: '90dvh',
              // Cap the drawer's top edge below the notch / Dynamic Island
              // so the title bar can't slide under it on small devices when
              // the keyboard is up. Preserves the rounded-top corners.
              maxHeight: 'calc(100% - env(safe-area-inset-top))',
              display: 'flex',
              flexDirection: 'column',
              ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
            },
          }}
        >
          {/* Title bar — centered title with iOS-style close button on the
              right. Swipe-down on this bar still closes the drawer
              (preserves the gesture from the removed drag handle). */}
          <Box
            onTouchStart={(e) => { drawerTouchStartY.current = e.touches[0].clientY; }}
            onTouchEnd={(e) => {
              if (drawerTouchStartY.current === null) return;
              const delta = e.changedTouches[0].clientY - drawerTouchStartY.current;
              drawerTouchStartY.current = null;
              if (delta > 40) closeAddDialog();
            }}
            sx={{
              display: 'flex', alignItems: 'center',
              px: 1.5, pt: 2, pb: 0.5,
              touchAction: 'none',
              flexShrink: 0,
            }}
          >
            <IconButton
              onClick={closeAddDialog}
              aria-label="Close"
              sx={(theme) => ({
                width: 30, height: 30,
                flexShrink: 0,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,0.24)' : 'rgba(120,120,128,0.16)',
                color: theme.palette.mode === 'dark' ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
                '&:hover': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,0.36)' : 'rgba(120,120,128,0.28)',
                },
              })}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography variant="h6" sx={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
              {isFirstRecipe ? 'Add your first recipe' : 'Add recipe'}
            </Typography>
            {/* Spacer mirroring the close button so the title is geometrically
                centered between the two sides. */}
            <Box sx={{ width: 30, height: 30, flexShrink: 0 }} />
          </Box>
          {/* Fields — scrollable region between the pinned title bar and the
              pinned Save button, so the sheet can be tall without leaving the
              CTA floating mid-sheet. */}
          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {useIosShareLayout ? (
            <Box sx={{ px: 3, pt: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Preview row: thumbnail + title */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {/* Thumbnail */}
                {shareLayoutIsLoading ? (
                  <Skeleton variant="rectangular" width={96} height={96} sx={{ borderRadius: '8px', flexShrink: 0 }} />
                ) : hasImage && !imageLoadFailed ? (
                  <Box
                    component="img"
                    src={newRecipeForm.imageUrl}
                    alt={newRecipeForm.title || 'Recipe thumbnail'}
                    onError={() => setImageLoadFailed(true)}
                    sx={{ width: 96, height: 96, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 96, height: 96, borderRadius: '8px', flexShrink: 0,
                      bgcolor: 'action.hover',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 32,
                    }}
                    aria-hidden="true"
                  >
                    🍳
                  </Box>
                )}
                {/* Title — borderless, always-editable field with an X to
                    clear, mirroring the iOS share extension's title row
                    (size 15 / semibold, xmark.circle.fill clear button that
                    empties + refocuses). */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {shareLayoutIsLoading ? (
                    <>
                      <Skeleton variant="text" width="90%" height={24} />
                      <Skeleton variant="text" width="60%" height={20} />
                    </>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                      <TextField
                        value={newRecipeForm.title}
                        onChange={(e) => setNewRecipeForm((prev) => ({ ...prev, title: e.target.value }))}
                        onBlur={() => setNewRecipeForm((prev) => ({ ...prev, title: (prev.title || '').trim() }))}
                        inputRef={titleInputRef}
                        placeholder="Title"
                        variant="standard"
                        fullWidth
                        multiline
                        maxRows={2}
                        onFocus={(e) => {
                          // Cursor at the end (not select-all), matching iOS.
                          const len = e.target.value.length;
                          e.target.setSelectionRange(len, len);
                        }}
                        InputProps={{ disableUnderline: true }}
                        inputProps={{ 'aria-label': 'Recipe title' }}
                        sx={{
                          '& .MuiInputBase-root': { p: 0 },
                          '& .MuiInputBase-input': {
                            // 16px (not 15) to sit at iOS's input-zoom
                            // threshold — prevents the auto-zoom-on-focus that
                            // shifts the page. Visually ~identical to the iOS
                            // share extension's 15px title.
                            fontSize: 16,
                            fontWeight: 600,
                            lineHeight: 1.25,
                            p: 0,
                          },
                        }}
                      />
                      {hasTitle && (
                        <IconButton
                          size="small"
                          aria-label="Clear title"
                          onClick={() => {
                            setNewRecipeForm((prev) => ({ ...prev, title: '' }));
                            requestAnimationFrame(() => titleInputRef.current?.focus());
                          }}
                          sx={{
                            p: 0.25,
                            mt: '-1px',
                            flexShrink: 0,
                            color: 'text.disabled',
                            '&:hover': { color: 'text.secondary', backgroundColor: 'transparent' },
                          }}
                        >
                          <CancelIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
              {shareLayoutIsError && (
                <Typography variant="caption" color="error">
                  Couldn't fetch recipe details. Edit title to save.
                </Typography>
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
          ) : (
            <Box sx={{ px: 3, pt: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
              {/* Reels-first onboarding: animated workflow row teaches the
                  share-extension flow, with the URL field as the fallback.
                  The row is rendered only while the drawer is open (Drawer
                  conditionally mounts its children) so the cycling logo's
                  setInterval is torn down on close. */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <SourcesWorkflowRow darkMode={darkMode} />
                <Typography variant="body2" sx={{ color: 'text.primary', textAlign: 'center', mt: 0.5 }}>
                  Share directly from social media reels
                </Typography>
              </Box>
              {/* "or" divider — horizontal rule on either side of the word. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 0.5 }}>
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>or</Typography>
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
              </Box>
              <Typography variant="body2" sx={{ color: 'text.primary', textAlign: 'center' }}>
                Copy and paste a link below
              </Typography>
              <TextField
                label="Source URL"
                value={newRecipeForm.sourceUrl}
                onChange={handleNewRecipeChange('sourceUrl')}
                required
                fullWidth
                placeholder="https://example.com/recipe"
                error={Boolean(newRecipeErrors.sourceUrl)}
                helperText={newRecipeErrors.sourceUrl || 'Link to the original recipe or video.'}
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
          )}
          {/* Actions — Save Recipe sits directly under the content (Make it
              public), flowing with it rather than pinned to the sheet bottom.
              Mirrors the Add Recipe FAB pill styling minus the + icon. */}
          <Box sx={{ px: 3, pb: 2, pt: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Button
              type="submit"
              disabled={shareLayoutIsLoading}
              startIcon={<AddIcon />}
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
            >
              Save Recipe
            </Button>
          </Box>
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
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
              Share from Instagram, TikTok, or YouTube or paste a link below.
            </Typography>
            <TextField
              label="Source URL"
              value={newRecipeForm.sourceUrl}
              onChange={handleNewRecipeChange('sourceUrl')}
              required
              fullWidth
              placeholder="https://example.com/recipe"
              error={Boolean(newRecipeErrors.sourceUrl)}
              helperText={newRecipeErrors.sourceUrl}
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
                Save Recipe
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
            // Subtract safe-area-inset-top from the height so the drawer's
            // top edge stops below the notch / Dynamic Island in both
            // collapsed and fully-expanded states (and the X-close stays
            // out of the Island in the expanded state).
            height: friendsDrawerExpanded
              ? 'calc(100dvh - env(safe-area-inset-top))'
              : 'calc(85dvh + 20px)',
            maxHeight: 'calc(100% - env(safe-area-inset-top))',
            display: 'flex',
            flexDirection: 'column',
            transition: 'height 0.3s ease, border-radius 0.3s ease',
            paddingBottom: 'env(safe-area-inset-bottom)',
            ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
          }
        }}
      >
        {/* Header — single row: avatar + name on the left, iOS-style X
            close on the right. Drag-grabber removed; the scrollable
            content area below still has its own swipe-down-to-dismiss
            handler. */}
        {selectedFriend && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pt: 2, pb: 2.5, flexShrink: 0 }}>
            {/* Avatar + friend name. Uses the friend's avatar image when
                available, otherwise renders the same hashed-color initial
                circle as the activity feed for visual continuity (same
                palette as FriendSections.ActivityItem). */}
            {(() => {
              const avatarSrc = selectedFriend.avatarUrl || selectedFriend.avatar_url;
              const name = selectedFriend.friendName || '?';
              const palette = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
              let h = 0;
              for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
              const color = palette[Math.abs(h) % palette.length];
              const initial = name.charAt(0).toUpperCase();
              return (
                <Box sx={{
                  position: 'relative', overflow: 'hidden',
                  width: 38, height: 38, borderRadius: '50%', bgcolor: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {/* Colored initial backdrop; photo overlays and removes
                      itself on load failure so a broken URL falls back here. */}
                  <Typography sx={{ color: '#fff', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{initial}</Typography>
                  {avatarSrc && (
                    <Box
                      component="img"
                      src={avatarSrc}
                      alt=""
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                        // Suppress iOS WKWebView long-press image menu on this avatar.
                        WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                    />
                  )}
                </Box>
              );
            })()}
            <Typography sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 16, fontWeight: 500 }}>
              {selectedFriend.friendName}
            </Typography>
            <Box
              component="button"
              aria-label="Close"
              onClick={() => {
                setIsFriendsDialogOpen(false);
                setSelectedFriend(null);
                setFriendRecipes([]);
                setFriendRecipeSearchOpen(false);
                setFriendRecipeSearchQuery('');
              }}
              sx={(theme) => ({
                width: 36, height: 36, borderRadius: '50%',
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                color: '#8a8a8a',
                border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                transition: 'background-color 150ms ease, transform 150ms ease',
                '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
                '&:active': { transform: 'scale(0.92)' },
              })}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
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
                      saved={isRecipeAlreadySaved(recipe)}
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
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, textAlign: 'center' }}>
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

                  <Box sx={{ mt: 5, mb: 5, borderTop: 1, borderColor: 'divider' }} />
                  <SuggestionsShelf accessToken={accessToken} variant="compact" onTapCard={fetchSuggestionRecipes} />
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
                    <Avatar
                      src={friend.avatarUrl || undefined}
                      sx={{ bgcolor: getAvatarColor(friend.friendId) }}
                    >
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

      {/* Pull-to-refresh — feed-style views only, with an active session,
          on any touch-capable device. The 'ontouchstart' check captures
          mobile web (Safari/Chrome) alongside the native iOS Capacitor
          WebView; desktop browsers without touch stay opted out. */}
      <PullToRefresh
        enabled={
          (Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'ontouchstart' in window))
          // home/recipes need a session (they refresh user data); Discover
          // is a public tab so PTR there works logged-out too.
          && (
            (!!session && (currentView === 'home' || currentView === 'recipes'))
            || currentView === 'discover'
          )
          && !isAddDialogOpen
          && !isFriendsDialogOpen
          // Recipe-detail dialog body-locks window scroll, so PTR's window-level
          // scrollTop check always reads 0 — without this guard, every downward
          // gesture inside the dialog would call preventDefault and freeze the
          // dialog's own scroll.
          && !activeRecipeView
          // Same freeze applies to the share-with-friends/connections drawer
          // and the friend picker — both body-lock scroll, so PTR would
          // preventDefault every downward drag and freeze their lists.
          && !shareSheetState
          && !pickerOpen
          // The onboarding drawer (Welcome → prefs → checklist screens) also
          // body-locks scroll — PTR would preventDefault every downward drag
          // and freeze the drawer's own scroll.
          && !onboardingDrawerOpen
        }
        onRefresh={handlePullRefresh}
      />

      <Snackbar
        open={snackbarState.open}
        autoHideDuration={snackbarState.duration ?? 4000}
        onClose={handleSnackbarClose}
        anchorOrigin={snackbarState.anchorOrigin}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={snackbarState.severity}
          sx={{
            width: '100%',
            // Long recipe titles are embedded in save/delete messages; clamp the
            // message to two lines so a long title can't balloon the snackbar.
            '& .MuiAlert-message': {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            },
          }}
        >
          {snackbarState.message}
        </Alert>
      </Snackbar>

      {/* "See this in…" prompt — repurposed from the old A2HS dialog.
          Shown on iOS Mobile Safari (not inside Capacitor, not desktop, not
          Android) once per session after the 90s timer fires. Open button
          deep-links into the native ReciFriend app via the recifriend://
          scheme and falls back to the App Store listing if the app isn't
          installed. */}
      <Drawer
        anchor="bottom"
        open={
          showInstallBanner
          && isIos
          && !Capacitor.isNativePlatform()
          && !isAddDialogOpen
          && !isFriendsDialogOpen
        }
        onClose={(_, reason) => { if (reason !== 'backdropClick') setShowInstallBanner(false); }}
        sx={{ zIndex: (t) => t.zIndex.modal + 10 }}
        PaperProps={{
          sx: (theme) => ({
            borderRadius: '14px 14px 0 0',
            px: 0,
            pt: '14px',
            pb: 'calc(env(safe-area-inset-bottom) + 16px)',
            boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
            ...(theme.palette.mode === 'dark' ? { backgroundImage: 'none', bgcolor: '#1c1c1e' } : null),
          }),
        }}
      >
        <Box
          sx={{
            position: 'relative',
            pb: '12px',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography
            sx={{
              textAlign: 'center',
              fontSize: 15,
              fontWeight: 600,
              color: 'text.primary',
            }}
          >
            See this in…
          </Typography>
          <IconButton
            aria-label="Dismiss"
            onClick={() => {
              setShowInstallBanner(false);
              sessionStorage.setItem('recifriend-app-prompt-dismissed', '1');
            }}
            sx={{
              position: 'absolute',
              top: -6,
              right: 8,
              color: 'text.secondary',
              p: '6px',
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* Row 1: ReciFriend app — primary action */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '16px', py: '14px' }}>
          <Box
            component="img"
            src="/icon-192.png"
            alt=""
            sx={{ width: 38, height: 38, borderRadius: '8px', flexShrink: 0 }}
          />
          <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
            ReciFriend app
          </Typography>
          <Button
            onClick={() => {
              // Mark dismissed for the session so the sheet doesn't reappear
              // mid-redirect. Doesn't set the permanent flag — user explicitly
              // chose Open, not Don't show again.
              setShowInstallBanner(false);
              // Fire the custom scheme. If the app is installed iOS shows a
              // confirmation alert ("Open in ReciFriend?") — the page stays
              // visible underneath it, so a short visibility check alone
              // would race the prompt and send the user to the App Store.
              // Listen for pagehide/visibilitychange (fires once iOS hands
              // off to the app) and cancel the fallback if it does.
              let handedOff = false;
              const onLeave = () => { handedOff = true; };
              document.addEventListener('visibilitychange', onLeave, { once: true });
              window.addEventListener('pagehide', onLeave, { once: true });
              // Deep-link to the recipe currently being viewed so the app opens
              // its DETAIL page (not the listing). Mirror the cold-load parser:
              // id from the `/recipes/{id}` path or legacy `?recipe=` query,
              // owner from `?user=`. Falls back to the recipes list off-recipe.
              const loc = new URL(window.location.href);
              let deepRecipeId = loc.searchParams.get('recipe');
              if (!deepRecipeId) {
                const dm = loc.pathname.match(/^\/recipes\/([^/?#]+)\/?$/);
                if (dm) {
                  try { deepRecipeId = decodeURIComponent(dm[1]); } catch { deepRecipeId = dm[1]; }
                }
              }
              window.location.href = buildRecipeAppDeepLink(deepRecipeId, loc.searchParams.get('user'));
              setTimeout(() => {
                document.removeEventListener('visibilitychange', onLeave);
                window.removeEventListener('pagehide', onLeave);
                if (handedOff) return;
                if (document.visibilityState !== 'visible') return;
                window.location.href = `https://apps.apple.com/app/id${APP_STORE_ID}`;
              }, 2500);
            }}
            sx={{
              minWidth: 96,
              height: 34,
              px: '14px',
              fontSize: 14,
              fontWeight: 700,
              backgroundColor: 'primary.main',
              color: '#fff',
              borderRadius: '999px',
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { backgroundColor: 'primary.dark', boxShadow: 'none' },
            }}
          >
            Open
          </Button>
        </Box>

        <Divider sx={{ mx: '16px' }} />

        {/* Row 2: Browser — dismiss */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '16px', py: '14px' }}>
          <Box
            sx={(theme) => ({
              width: 38, height: 38, borderRadius: '8px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid',
              borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
              color: 'text.secondary',
            })}
          >
            <LanguageIcon sx={{ fontSize: 22 }} />
          </Box>
          <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
            Browser
          </Typography>
          <Button
            onClick={() => {
              setShowInstallBanner(false);
              // Suppress for the rest of this session — they explicitly chose
              // to stay in the browser. Don't permanently dismiss; they may
              // want it again on a future visit.
              sessionStorage.setItem('recifriend-app-prompt-dismissed', '1');
            }}
            variant="outlined"
            sx={(theme) => ({
              minWidth: 96,
              height: 34,
              px: '14px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: '999px',
              textTransform: 'none',
              color: 'text.primary',
              borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              '&:hover': {
                borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.32)',
                backgroundColor: 'transparent',
              },
            })}
          >
            Continue
          </Button>
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
        // Skip the open transition on first mount. When iOS evicts the
        // WebView and the user comes back from their email app with the
        // 8-digit code, the dialog re-mounts with open=true and would
        // otherwise replay its fade/grow animation — the "flash" the
        // user sees. Subsequent open/close (e.g. clicking Sign in
        // normally) still animates because `appear` only affects the
        // initial-mount transition.
        TransitionProps={{ appear: false }}
        // disableScrollLock: bypass MUI's body overflow:hidden lock.
        // With `appear: false` above, MUI's scroll-lock cleanup doesn't
        // fire on dialog close — body keeps overflow:hidden and the
        // page becomes unscrollable. Skipping the lock entirely dodges
        // that interaction; on this centered auth dialog letting the
        // page scroll behind the backdrop is fine UX.
        disableScrollLock
        PaperProps={{
          sx: (theme) => ({
            bgcolor: theme.palette.mode === 'dark' ? '#1c1c1e' : theme.palette.background.paper,
            backgroundImage: 'none',
            boxShadow: theme.palette.mode === 'dark'
              ? '0 12px 40px rgba(0, 0, 0, 0.75)'
              : '0 12px 40px rgba(0, 0, 0, 0.5)',
          }),
        }}
      >
        {/* Title bar — iOS-style X close on the left, centered title.
            Both share the row's alignItems:center so the X glyph and the
            title baseline align regardless of asymmetric padding. */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, pt: 2, pb: 0.5 }}>
          <IconButton
            onClick={closeAuthDialog}
            aria-label="Close"
            sx={(theme) => ({
              width: 30, height: 30,
              flexShrink: 0,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,0.24)' : 'rgba(120,120,128,0.16)',
              color: theme.palette.mode === 'dark' ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
              '&:hover': {
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,0.36)' : 'rgba(120,120,128,0.28)',
              },
            })}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Typography id="auth-dialog-title" variant="h6" sx={{ flex: 1, textAlign: 'center', fontWeight: 400 }}>
            {authDialogMode === 'join' ? 'Join Free' : 'Sign in'}
          </Typography>
          {/* Spacer mirroring the close button so the title is geometrically
              centered between the two sides. */}
          <Box sx={{ width: 30, height: 30, flexShrink: 0 }} />
        </Box>
        {authDialogReason && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              px: 3,
              pb: 1,
              mt: -0.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
              lineHeight: 1.43,
              maxHeight: 'calc(1.43em * 2)',
              textAlign: 'center',
            }}
          >
            {authDialogReason}
          </Typography>
        )}
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {authError && (
              <Alert severity="error" onClose={() => setAuthError('')}>
                {authError}
              </Alert>
            )}
            {/* Provider tiles — Google + Apple (iOS only) side by side, sharing
                the same neutral background. Icons mirror outward: G on the left
                of the Google tile, Apple on the right of the Apple tile. On
                non-native platforms Apple isn't available, so Google fills the
                row alone. */}
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button
                disabled={isAuthLoading}
                onClick={handleGoogleSignIn}
                sx={(theme) => ({
                  flex: 1,
                  // iOS: 8px-corner square that splits the row equally with the Apple tile.
                  // Web: pill-shaped wide button with G icon + "Sign in with Google" label.
                  ...(Capacitor.isNativePlatform()
                    ? { aspectRatio: '1', borderRadius: '16px', p: 0 }
                    : { height: 52, borderRadius: 999, gap: 1.25, px: 2, textTransform: 'none', fontWeight: 500, fontSize: '0.95rem' }),
                  minWidth: 0,
                  justifyContent: 'center',
                  alignItems: 'center',
                  bgcolor: theme.palette.mode === 'dark' ? '#2a2a2c' : '#f5f5f7',
                  color: 'text.primary',
                  // Dark-mode 1px border matching the outlined TextField stroke
                  // so the tile reads as the same surface family as the email
                  // field below.
                  ...(theme.palette.mode === 'dark' && {
                    border: '1px solid rgba(255, 255, 255, 0.23)',
                  }),
                  '&:hover': {
                    bgcolor: theme.palette.mode === 'dark' ? '#3a3a3c' : '#ebebed',
                  },
                })}
              >
                <Box component="svg" viewBox="0 0 48 48" sx={{ width: Capacitor.isNativePlatform() ? 24 : 20, height: Capacitor.isNativePlatform() ? 24 : 20, flexShrink: 0 }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </Box>
                {!Capacitor.isNativePlatform() && 'Sign in with Google'}
              </Button>

              {/* === [S09] Capacitor auth — Apple sign-in (iOS only) === */}
              {Capacitor.isNativePlatform() && (
                <Button
                  disabled={isAuthLoading}
                  onClick={handleAppleSignIn}
                  sx={(theme) => ({
                    flex: 1,
                    aspectRatio: '1',
                    minWidth: 0,
                    justifyContent: 'center',
                    alignItems: 'center',
                    p: 0,
                    borderRadius: '16px',
                    bgcolor: theme.palette.mode === 'dark' ? '#2a2a2c' : '#f5f5f7',
                    color: 'text.primary',
                    ...(theme.palette.mode === 'dark' && {
                      border: '1px solid rgba(255, 255, 255, 0.23)',
                    }),
                    '&:hover': {
                      bgcolor: theme.palette.mode === 'dark' ? '#3a3a3c' : '#ebebed',
                    },
                  })}
                >
                  <Box component="svg" viewBox="0 0 24 24" fill="currentColor" sx={{ width: 25, height: 25, flexShrink: 0 }}>
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </Box>
                </Button>
              )}
              {/* === [/S09] === */}
            </Box>

            <Divider sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>or</Divider>

            {/* === [S09] Show OTP code input after email sent === */}
            {otpSentToEmail ? (
              <Box component="form" onSubmit={handleVerifyOtpCode}>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    We sent a code to <strong>{otpSentToEmail}</strong>. Enter it below.
                  </Typography>
                  <TextField
                    label="Verification code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(e) => {
                      setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setAuthError('');
                    }}
                    required
                    fullWidth
                    placeholder="12345678"
                    inputProps={{ maxLength: 10, pattern: '[0-9]*' }}
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
                  <Stack spacing={0.25} alignItems="center">
                    <Button
                      size="small"
                      onClick={handleResendOtpCode}
                      disabled={isAuthLoading}
                      sx={(theme) => ({
                        textTransform: 'none',
                        ...(theme.palette.mode === 'dark' && { color: '#fff' }),
                      })}
                    >
                      Resend code
                    </Button>
                    <Button
                      size="small"
                      onClick={() => { clearPendingOtpEmail(); setOtpSentToEmail(''); setOtpCode(''); setAuthError(''); }}
                      disabled={isAuthLoading}
                      sx={(theme) => ({
                        textTransform: 'none',
                        ...(theme.palette.mode === 'dark' && { color: '#fff' }),
                      })}
                    >
                      Use a different email
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ) : (
            <Box
              component="form"
              onSubmit={handleSendOtpCode}
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Enter your email and we'll send you a sign-in code.
                </Typography>
                <TextField
                  label="Email"
                  type="email"
                  size="small"
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
                  variant="text"
                  size="small"
                  disabled={isAuthLoading}
                  startIcon={isAuthLoading ? <CircularProgress size={14} /> : null}
                  sx={(theme) => ({
                    alignSelf: 'center',
                    textTransform: 'none',
                    px: 0,
                    minWidth: 0,
                    color: theme.palette.mode === 'dark' ? '#fff' : 'primary.main',
                    '&:hover': { background: 'none' },
                  })}
                >
                  Send code
                </Button>
              </Stack>
            </Box>
            )}
            {/* === [/S09] === */}
          </Stack>
        </DialogContent>
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

      <SettingsDrawer
        kind={settingsDrawer}
        onClose={() => setSettingsDrawer(null)}
        feedbackRating={feedbackRating}
        setFeedbackRating={setFeedbackRating}
        feedbackFrequency={feedbackFrequency}
        setFeedbackFrequency={setFeedbackFrequency}
        feedbackMessage={feedbackMessage}
        setFeedbackMessage={setFeedbackMessage}
        feedbackEmail={feedbackEmail}
        setFeedbackEmail={setFeedbackEmail}
        feedbackSubmitting={feedbackSubmitting}
        feedbackDone={feedbackDone}
        onSubmitFeedback={handleSubmitFeedback}
        onResetFeedback={() => setFeedbackDone(false)}
        preferences={{
          dietaryPrefs: userProfile?.dietaryPrefs ?? [],
          cookingFor: userProfile?.cookingFor ?? '',
          cuisinePrefs: userProfile?.cuisinePrefs ?? [],
        }}
        onSavePreferences={async (prefs) => {
          if (!accessToken) return;
          await callRecipesApi('/profile', {
            method: 'PATCH',
            body: JSON.stringify({
              dietaryPrefs: prefs.dietaryPrefs,
              cookingFor: prefs.cookingFor,
              cuisinePrefs: prefs.cuisinePrefs,
            }),
          }, accessToken);
          // Refresh local profile so other surfaces (FriendSections, Discover)
          // pick up the new prefs without a reload.
          fetchProfile();
        }}
        onDeleteAccount={handleDeleteAccount}
      />

      {/* Floating Add Friend FAB — only on the Friends page. Always visible
          there (no scroll-trigger), sits above the BottomAppBar. Same MUI
          Button + AddIcon treatment as the Add Recipe FAB so the two pills
          look like the same control with different labels. */}
      {session && currentView === 'friends' && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 'calc(64px + env(safe-area-inset-bottom) + 16px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1200,
          }}
        >
          <Button
            onClick={() => setAddFriendDrawerOpen(true)}
            aria-label="Add friend"
            startIcon={<AddIcon />}
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
          >
            Add Friend
          </Button>
        </Box>
      )}

      {/* Floating FAB — mobile only, slides up when user scrolls down.
          Logged-in: Add Recipe pill. Logged-out: Join Free CTA.
          BottomAppBar is now always rendered after auth, so FAB always
          sits 16px above its top edge. */}
      {isMobile && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 'calc(64px + env(safe-area-inset-bottom) + 16px)',
            left: '50%',
            transform: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home') && !isAddDialogOpen && !isFriendsDialogOpen
                : showFloatingFab && !cookWithFriendsVisible;
              return visible ? 'translateX(-50%) translateY(0) scale(1)' : 'translateX(-50%) translateY(20px) scale(0.92)';
            })(),
            opacity: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home') && !isAddDialogOpen && !isFriendsDialogOpen
                : showFloatingFab && !cookWithFriendsVisible;
              return visible ? 1 : 0;
            })(),
            transition: 'transform 320ms cubic-bezier(0.34, 1.3, 0.64, 1), opacity 220ms ease',
            willChange: 'transform, opacity',
            pointerEvents: (() => {
              const visible = session
                ? (showFloatingFab && currentView === 'recipes' || showHomeFab && currentView === 'home') && !isAddDialogOpen && !isFriendsDialogOpen
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
