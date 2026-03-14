import { useState, useEffect } from 'react';
import { Box, Typography, Stack } from '@mui/material';
import RecipeShelf from './RecipeShelf';
import RecipeListCard from './RecipeListCard';

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
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend }) {
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
            boxShadow: '0 1px 4px rgba(0,0,0,.08)',
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
                color: 'primary.main',
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
                color: 'primary.main',
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
          <SectionLabel>Trending in health & nutrition</SectionLabel>
          <Stack spacing={1}>
            {aiPicks.map((pick, i) => (
              <Box key={i} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{pick.topic}</Typography>
                  <Typography variant="caption" sx={{ bgcolor: 'primary.main', color: '#fff', px: 1, py: 0.25, borderRadius: 10, fontWeight: 600, fontSize: 10 }}>
                    {pick.hashtag}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{pick.reason}</Typography>
                {pick.recipe && (
                  <Box
                    onClick={() => onOpenRecipe?.(pick.recipe)}
                    sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: 'action.hover', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    {pick.recipe.imageUrl && (
                      <Box component="img" src={pick.recipe.imageUrl} sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{pick.recipe.title}</Typography>
                  </Box>
                )}
              </Box>
            ))}
          </Stack>
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
