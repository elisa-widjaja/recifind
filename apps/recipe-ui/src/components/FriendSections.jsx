import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Stack, Button } from '@mui/material';
import RecipeShelf from './RecipeShelf';
import RecipeListCard from './RecipeListCard';
import TrendingHealthCarousel from './TrendingHealthCarouselB';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  return res.json();
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return '';
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'yesterday' : `${diffD}d`;
}

/**
 * Logged-in friend discovery sections.
 * Props:
 *   accessToken: string
 *   onOpenRecipe: (recipe) => void
 *   onSaveRecipe: (recipe) => void
 */
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, dietaryPrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, darkMode, onCookWithFriendsVisible }) {
  const [activity, setActivity] = useState([]);
  const [recentlySaved, setRecentlySaved] = useState([]);
  const [recentlyShared, setRecentlyShared] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [editorsPick, setEditorsPick] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);
  const [aiPicks, setAiPicks] = useState([]);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      fetchJson('/friends/activity', accessToken),
      fetchJson('/friends/recently-saved', accessToken),
      fetchJson('/friends/recently-shared', accessToken),
    ]).then(([act, saved, shared]) => {
      setActivity(act?.activity || []);
      setRecentlySaved((saved?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setRecentlyShared((shared?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setLoaded(true);
    });
  }, [accessToken]);

  useEffect(() => {
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));
    const query = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
  }, [cookingFor, cuisinePrefs, dietaryPrefs]);
  // Note: cuisinePrefs is null (not []) when profile hasn't loaded yet.
  // This prevents the effect re-firing on every render before userProfile is available.

  const cookWithFriendsRef = useRef(null);

  useEffect(() => {
    const el = cookWithFriendsRef.current;
    if (!el || !onCookWithFriendsVisible) return;
    const observer = new IntersectionObserver(
      ([entry]) => onCookWithFriendsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCookWithFriendsVisible, loaded]);

  if (!loaded) return null;

  const hasActivity = activity.length > 0;
  const hasSaved = recentlySaved.length > 0;
  const hasShared = recentlyShared.length > 0;
  const hasEditorsPick = editorsPick.length > 0;

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  return (
    <Stack sx={{ gap: '32px' }}>
      {hasActivity && (
        <Box sx={{ pt: '20px' }}>
          <SectionLabel>Friend Activity</SectionLabel>
          <Box sx={{
            bgcolor: 'background.paper',
            borderRadius: '12px',
            boxShadow: theme => theme.palette.mode === 'dark'
              ? '0 0 0 1px rgba(255,255,255,0.10)'
              : '0 1px 4px rgba(0,0,0,.08)',
            overflow: 'hidden',
          }}>
            {activity.slice(0, activityExpanded ? 5 : 2).map((item, index, arr) => (
              <Box key={item.id}>
                <ActivityItem item={item} onOpenRecipe={onOpenRecipe} />
                {index < arr.length - 1 && (
                  <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.5 }} />
                )}
              </Box>
            ))}
          </Box>
          {activity.length > 2 && (
            <Typography
              component="button"
              onClick={() => setActivityExpanded((prev) => !prev)}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                mt: 0.75,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
                fontFamily: 'inherit',
              }}
            >
              {activityExpanded ? 'Show less' : `+ ${activity.length - 2} more`}
            </Typography>
          )}
        </Box>
      )}

      {hasSaved && (
        <Box>
          <SectionLabel>Recently Saved by Friends</SectionLabel>
          <RecipeShelf
            recipes={recentlySaved}
            onSave={onSaveRecipe}
            onShare={(recipe, e) => onShareRecipe?.(recipe, e)}
            onOpen={onOpenRecipe}
            cardWidth={180}
            cardHeight={120}
            gap="8px"
          />
        </Box>
      )}

      {hasShared && (
        <Box>
          <SectionLabel>Recently Shared by Friends</SectionLabel>
          <RecipeShelf
            recipes={recentlyShared}
            onSave={onSaveRecipe}
            onShare={(recipe, e) => onShareRecipe?.(recipe, e)}
            onOpen={onOpenRecipe}
            cardWidth={180}
            cardHeight={120}
            gap="8px"
          />
        </Box>
      )}

      {hasEditorsPick && (
        <Box>
          <SectionLabel>Editor's Picks</SectionLabel>
          <Stack spacing={1}>
            {visibleEditors.map(recipe => (
              <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
            ))}
          </Stack>
          {editorsPick.length > 3 && (
            <Typography
              component="button"
              onClick={() => setEditorsExpanded(e => !e)}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                mt: 0.75,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
                fontFamily: 'inherit',
              }}
            >
              {editorsExpanded ? 'Show less' : `+ ${editorsPick.length - 3} more picks`}
            </Typography>
          )}
        </Box>
      )}

      {aiPicks.length > 0 && (
        <Box>
          <SectionLabel>Trending in Health & Nutrition</SectionLabel>
          <TrendingHealthCarousel picks={aiPicks} onOpen={onOpenRecipe} onSave={onSaveRecipe} onShare={onShareRecipe} />
        </Box>
      )}

      <Box ref={cookWithFriendsRef}>
        <CookWithFriends onInvite={onInviteFriend} darkMode={darkMode} />
      </Box>

    </Stack>
  );
}

function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>{children}</Typography>;
}

// ── Cook with Friends ──
const CWF_TICKER_ITEMS = [
  { initial: 'E', name: 'Elisa', color: '#7c3aed', lightColor: '#a78bfa', text: 'saved Miso Ramen ❤️', time: '2h' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'shared Beef Stew with you', time: '5h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'is cooking Tacos tonight 🌮', time: 'now' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'saved Salmon Bowl 🐟', time: '3h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'saved Chicken Tikka Masala 🍛', time: '6h' },
];
const CWF_HOLD_MS = 2800, CWF_OUT_MS = 450, CWF_IN_MS = 550, CWF_OVERLAP_MS = 150;
const CWF_OUT_EASE = 'cubic-bezier(0.4,0,1,1)', CWF_IN_EASE = 'cubic-bezier(0,0,0.2,1)';

function CwfTicker() {
  const refs = useRef([]);
  const currentIdx = useRef(0);
  useEffect(() => {
    const items = refs.current;
    if (!items.length) return;
    let enterTimer = null, resetTimer = null;
    const cycle = () => {
      const prev = currentIdx.current;
      const next = (prev + 1) % items.length;
      currentIdx.current = next;
      const prevEl = items[prev];
      prevEl.style.transition = `opacity ${CWF_OUT_MS}ms ${CWF_OUT_EASE}, transform ${CWF_OUT_MS}ms ${CWF_OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-14px)';
      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${CWF_IN_MS}ms ${CWF_IN_EASE}, transform ${CWF_IN_MS}ms ${CWF_IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, CWF_OUT_MS - CWF_OVERLAP_MS);
      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, CWF_OUT_MS + 80);
    };
    const interval = setInterval(cycle, CWF_HOLD_MS + CWF_OUT_MS);
    return () => { clearInterval(interval); clearTimeout(enterTimer); clearTimeout(resetTimer); };
  }, []);
  return (
    <Box sx={{ position: 'relative', height: 44, overflow: 'hidden', mb: 1.5 }}>
      {CWF_TICKER_ITEMS.map((item, i) => (
        <Box key={i} ref={el => { refs.current[i] = el; }}
          style={{ opacity: i === 0 ? 1 : 0, transform: i === 0 ? 'translateY(0)' : 'translateY(20px)' }}
          sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, willChange: 'opacity, transform' }}
        >
          <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{item.initial}</Typography>
          </Box>
          <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.2 }}>
            <Box component="span" sx={{ color: t => t.palette.mode === 'dark' ? item.lightColor : item.color, fontWeight: 600 }}>{item.name}</Box>{' '}{item.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>{item.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function CookWithFriends({ onInvite, darkMode }) {
  return (
    <Box sx={{
      borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)',
      display: 'flex', flexDirection: 'column',
    }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Share recipes and see what your friends are cooking.
      </Typography>
      <CwfTicker />
      <Button variant="outlined" onClick={onInvite}
        sx={{
          borderRadius: 20, textTransform: 'none', fontWeight: 700, alignSelf: 'center', px: 3,
          color: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main,
          borderColor: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main,
          '&:hover': { borderColor: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main },
        }}>
        Invite Friends
      </Button>
    </Box>
  );
}

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

const VERB_MAP = {
  friend_cooked_recipe: 'cooked',
  friend_saved_recipe: 'saved',
  friend_shared_recipe: 'shared',
};

// Notification types that carry a recipe — show structured sentence + thumbnail
const RECIPE_TYPES = new Set(['friend_cooked_recipe', 'friend_saved_recipe', 'friend_shared_recipe']);

function ActivityItem({ item, onOpenRecipe }) {
  const friendName = item.friendName ?? '?';
  const color = AVATAR_COLORS[Math.abs(item.id) % AVATAR_COLORS.length];
  const initial = friendName.charAt(0).toUpperCase();
  const isRecipeNotif = RECIPE_TYPES.has(item.type) && item.recipe;

  function handleClick() {
    if (isRecipeNotif) onOpenRecipe?.(item.recipe);
  }

  return (
    <Box
      onClick={handleClick}
      role={isRecipeNotif ? 'button' : undefined}
      tabIndex={isRecipeNotif ? 0 : undefined}
      aria-label={isRecipeNotif ? `View ${item.recipe.title}` : undefined}
      onKeyDown={isRecipeNotif ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); } : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        px: 1.25,
        py: '8px',
        cursor: isRecipeNotif ? 'pointer' : 'default',
        '&:hover': isRecipeNotif ? { bgcolor: 'action.hover' } : {},
        '&:focus-visible': isRecipeNotif ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' } : {},
      }}
    >
      {/* Avatar */}
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{initial}</Typography>
      </Box>

      {isRecipeNotif ? (
        /* Recipe notification: "Sarah saved Spicy Thai Noodles" */
        <Typography sx={{
          flex: 1, fontSize: 12, lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{friendName}</Box>
          <Box component="span" sx={{ color: 'text.secondary' }}> {VERB_MAP[item.type]} </Box>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{item.recipe.title}</Box>
        </Typography>
      ) : (
        /* Connection notification: use pre-formatted message from the server */
        <Typography sx={{
          flex: 1, fontSize: 12, lineHeight: 1.4, color: 'text.secondary',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {item.message}
        </Typography>
      )}

      {/* Timestamp */}
      <Typography sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>

      {/* Thumbnail — only for recipe notifications */}
      {isRecipeNotif && (
        <Box sx={{
          width: 44, height: 44, borderRadius: '8px', flexShrink: 0,
          overflow: 'hidden', bgcolor: 'action.hover',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {item.recipe.imageUrl
            ? <Box component="img" src={item.recipe.imageUrl} alt={item.recipe.title}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Typography sx={{ fontSize: 20 }}>🍳</Typography>
          }
        </Box>
      )}
    </Box>
  );
}
