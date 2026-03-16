import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Button } from '@mui/material';
import RecipeShelf from './RecipeShelf';
import RecipeListCard from './RecipeListCard';
import TrendingHealthCarousel from './TrendingHealthCarouselB';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

const SUGGESTION_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #e85d3a)',
  'linear-gradient(135deg, #43b89c, #1976d2)',
  'linear-gradient(135deg, #9b59b6, #e85d8a)',
  'linear-gradient(135deg, #27ae60, #f5a623)',
  'linear-gradient(135deg, #e74c3c, #9b59b6)',
];

function suggestionGradient(userId) {
  const idx = userId.charCodeAt(0) % SUGGESTION_GRADIENTS.length;
  return SUGGESTION_GRADIENTS[idx];
}

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
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, onOpenFriends }) {
  const [activity, setActivity] = useState([]);
  const [recentlySaved, setRecentlySaved] = useState([]);
  const [recentlyShared, setRecentlyShared] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [requestedIds, setRequestedIds] = useState(new Set());
  const [activityExpanded, setActivityExpanded] = useState(false);

  async function addFriend(suggestion) {
    try {
      const res = await fetch(`${API_BASE_URL}/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: suggestion.userId }),
      });
      if (res.ok || res.status < 500) {
        setRequestedIds(prev => new Set([...prev, suggestion.userId]));
      }
    } catch (_) {
      // Network error — silent failure
    }
  }
  const [editorsPick, setEditorsPick] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);
  const [aiPicks, setAiPicks] = useState([]);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      fetchJson('/friends/activity', accessToken),
      fetchJson('/friends/recently-saved', accessToken),
      fetchJson('/friends/recently-shared', accessToken),
      fetchJson('/friends/suggestions', accessToken),
    ]).then(([act, saved, shared, sugg]) => {
      setActivity(act?.activity || []);
      setRecentlySaved((saved?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setRecentlyShared((shared?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setSuggestions(sugg?.suggestions || []);
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
    const query = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
  }, [cookingFor, cuisinePrefs]);
  // Note: cuisinePrefs is null (not []) when profile hasn't loaded yet.
  // This prevents the effect re-firing on every render before userProfile is available.

  if (!loaded) return null;

  const hasActivity = activity.length > 0;
  const hasSaved = recentlySaved.length > 0;
  const hasShared = recentlyShared.length > 0;
  const hasEditorsPick = editorsPick.length > 0;

  if (!hasActivity && !hasSaved && !hasShared && !hasEditorsPick) return null;

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
          <SectionLabel>Recently saved by friends</SectionLabel>
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
          <SectionLabel>Recently shared by friends</SectionLabel>
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

      {suggestions.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: 15 }}>
              Friends you may know
            </Typography>
            {onOpenFriends && (
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', cursor: 'pointer', fontSize: 13 }}
                onClick={onOpenFriends}
              >
                See all
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              overflowX: 'auto',
              pb: 0.5,
              WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
              maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {suggestions.map(suggestion => {
              const isRequested = requestedIds.has(suggestion.userId);
              return (
                <Box
                  key={suggestion.userId}
                  sx={{
                    minWidth: 130,
                    maxWidth: 130,
                    height: 190,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 3,
                    p: '16px 10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    flexShrink: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: 62,
                      height: 62,
                      borderRadius: '50%',
                      background: suggestionGradient(suggestion.userId),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 26,
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {(suggestion.name || '?')[0].toUpperCase()}
                  </Box>
                  <Typography sx={{ fontWeight: 600, fontSize: 13, textAlign: 'center', mt: 1, lineHeight: 1.2 }}>
                    {suggestion.name}
                  </Typography>
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center', lineHeight: 1.3 }}>
                      {suggestion.reason}
                    </Typography>
                  </Box>
                  <Button
                    variant={isRequested ? 'outlined' : 'contained'}
                    disabled={isRequested}
                    size="small"
                    fullWidth
                    onClick={() => !isRequested && addFriend(suggestion)}
                    sx={{ flexShrink: 0, fontSize: 13, fontWeight: 600, borderRadius: 2, textTransform: 'none' }}
                  >
                    {isRequested ? 'Requested' : 'Add friend'}
                  </Button>
                </Box>
              );
            })}
          </Box>
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

    </Stack>
  );
}

function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>{children}</Typography>;
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
