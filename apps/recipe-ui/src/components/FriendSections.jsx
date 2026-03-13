import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Divider } from '@mui/material';
import RecipeShelf from './RecipeShelf';

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
export default function FriendSections({ accessToken, onOpenRecipe, onSaveRecipe }) {
  const [activity, setActivity] = useState([]);
  const [recentlySaved, setRecentlySaved] = useState([]);
  const [recentlyShared, setRecentlyShared] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

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

  if (!loaded) return null;

  const hasActivity = activity.length > 0;
  const hasSaved = recentlySaved.length > 0;
  const hasShared = recentlyShared.length > 0;

  if (!hasActivity && !hasSaved && !hasShared) return null;

  return (
    <Stack spacing={2.5}>
      {hasActivity && (
        <Box>
          <SectionLabel>Friend activity</SectionLabel>
          <Stack spacing={0.75}>
            {activity.slice(0, activityExpanded ? 5 : 2).map(item => (
              <ActivityItem key={item.id} item={item} />
            ))}
          </Stack>
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
              {activityExpanded ? 'Show less' : 'Show more'}
            </Typography>
          )}
        </Box>
      )}

      {hasSaved && (
        <Box>
          <SectionLabel>Recently saved by friends</SectionLabel>
          <RecipeShelf recipes={recentlySaved} onSave={onSaveRecipe} onOpen={onOpenRecipe} cardWidth={180} gap="8px" />
        </Box>
      )}

      {hasShared && (
        <Box>
          <SectionLabel>Recently shared by friends</SectionLabel>
          <RecipeShelf recipes={recentlyShared} onSave={onSaveRecipe} onOpen={onOpenRecipe} cardWidth={180} gap="8px" />
        </Box>
      )}

      <Divider />
    </Stack>
  );
}

function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>{children}</Typography>;
}

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function ActivityItem({ item }) {
  const colorIndex = Math.abs(item.id) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[colorIndex];
  const initial = item.message.charAt(0).toUpperCase();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.5 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{initial}</Typography>
      </Box>
      <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>
        {item.message}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>
    </Box>
  );
}
