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
export default function FriendSections({ accessToken, onOpenRecipe, onSaveRecipe, onShareRecipe }) {
  const [activity, setActivity] = useState([]);
  const [recentlySaved, setRecentlySaved] = useState([]);
  const [recentlyShared, setRecentlyShared] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [editorsPick, setEditorsPick] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);

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
        <Box>
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
                  <Box sx={{ height: '1px', bgcolor: '#f0f0f0', mx: '12px' }} />
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

function ActivityItem({ item, onOpenRecipe }) {
  const friendName = item.friendName ?? '?';
  const colorIndex = item.id % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[Math.abs(colorIndex)];
  const initial = friendName.charAt(0).toUpperCase();
  const verb = VERB_MAP[item.type] ?? 'interacted with';
  const recipeTitle = item.recipe?.title ?? '';

  function handleClick() {
    if (item.recipe) onOpenRecipe?.(item.recipe);
  }

  return (
    <Box
      onClick={handleClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        px: '10px',
        py: '8px',
        cursor: item.recipe ? 'pointer' : 'default',
        '&:hover': item.recipe ? { bgcolor: 'action.hover' } : {},
      }}
    >
      {/* Avatar */}
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{initial}</Typography>
      </Box>

      {/* Sentence */}
      <Typography sx={{
        flex: 1,
        fontSize: 12,
        lineHeight: 1.4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        <Box component="span" sx={{ fontWeight: 600, color: '#111' }}>{friendName}</Box>
        <Box component="span" sx={{ color: '#666' }}> {verb} </Box>
        <Box component="span" sx={{ fontWeight: 600, color: '#111' }}>{recipeTitle}</Box>
      </Typography>

      {/* Timestamp */}
      <Typography sx={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>

      {/* Thumbnail */}
      <Box sx={{
        width: 44, height: 44, borderRadius: '8px', flexShrink: 0,
        overflow: 'hidden', bgcolor: 'action.hover',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.recipe?.imageUrl
          ? <Box component="img" src={item.recipe.imageUrl} alt={recipeTitle}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Typography sx={{ fontSize: 20 }}>🍳</Typography>
        }
      </Box>
    </Box>
  );
}
