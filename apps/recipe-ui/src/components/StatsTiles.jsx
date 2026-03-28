import { useState, useEffect } from 'react';
import { Box, Typography, Stack, useTheme } from '@mui/material';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

export default function StatsTiles({ recipeCount, accessToken, onAddRecipe, onViewRecipes, onAddFriends, onViewFriends }) {
  const [friendCount, setFriendCount] = useState(null);
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_BASE_URL}/friends`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setFriendCount((data.friends || []).length))
      .catch(() => setFriendCount(null));
  }, [accessToken]);

  const recipesEmpty = recipeCount === 0;
  const friendsEmpty = friendCount === 0;
  const friendDisplay = friendCount === null ? '--' : friendCount;

  const t1 = dark
    ? { bg: 'linear-gradient(135deg, #1e1b4b, #1a1a2e)', border: '#3730a3', label: '#818cf8', count: '#fff', sub: '#a5b4fc', btn: '#6366f1', btnText: '#fff', link: '#818cf8' }
    : { bg: 'linear-gradient(135deg, #eef2ff, #f5f3ff)', border: '#c7d2fe', label: '#4f46e5', count: '#1e1b4b', sub: '#6366f1', btn: '#6200EA', btnText: '#fff', link: '#4f46e5' };

  const t2 = dark
    ? { bg: 'linear-gradient(135deg, #064e3b, #0a1f18)', border: '#065f46', label: '#34d399', count: '#fff', sub: '#6ee7b7', btn: '#10b981', btnText: '#fff', link: '#34d399' }
    : { bg: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '#6ee7b7', label: '#059669', count: '#064e3b', sub: '#059669', btn: '#10b981', btnText: '#fff', link: '#059669' };

  const tileBase = {
    borderRadius: '12px',
    p: 2,
    display: 'flex',
    flexDirection: 'column',
    height: 200,
  };

  const linkBtn = (color) => ({
    background: 'none',
    border: 'none',
    p: 0,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    textAlign: 'center',
  });

  const pillBtn = (bg, color) => ({
    background: bg,
    color,
    border: 'none',
    borderRadius: '999px',
    py: '9px',
    px: '12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%',
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', mb: { xs: '52px', md: '40px' } }}>

      {/* Tile 1 — Recipes */}
      <Box sx={{ ...tileBase, background: t1.bg, border: `1px solid ${t1.border}` }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: t1.label, letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          RECIPES
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: t1.count, lineHeight: 1, mb: 0.5 }}>
          {recipeCount}
        </Typography>
        <Typography sx={{ fontSize: 12, color: t1.sub, flex: 1 }}>
          {recipesEmpty ? "You don't have any saved recipes yet" : 'Saved recipes'}
        </Typography>
        {/* Actions pinned to bottom */}
        <Stack spacing={0} sx={{ mt: 'auto' }}>
          {!recipesEmpty && (
            <Typography component="button" onClick={onViewRecipes} sx={{ ...linkBtn(t1.link), mb: 2 }}>
              View recipes
            </Typography>
          )}
          <Box component="button" onClick={onAddRecipe} sx={pillBtn(t1.btn, t1.btnText)}>
            + Add Recipe
          </Box>
        </Stack>
      </Box>

      {/* Tile 2 — Friends */}
      <Box sx={{ ...tileBase, background: t2.bg, border: `1px solid ${t2.border}` }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: t2.label, letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          FRIENDS
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: t2.count, lineHeight: 1, mb: 0.5 }}>
          {friendDisplay}
        </Typography>
        <Typography sx={{
          fontSize: 12,
          color: t2.sub,
          flex: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {friendsEmpty ? 'You have no connection yet' : 'friends'}
        </Typography>
        {/* Actions pinned to bottom */}
        <Stack spacing={0} sx={{ mt: 'auto' }}>
          {friendCount > 0 && (
            <Typography component="button" onClick={onViewFriends} sx={{ ...linkBtn(t2.link), mb: 2 }}>
              View friends
            </Typography>
          )}
          <Box component="button" onClick={onAddFriends} sx={pillBtn(t2.btn, t2.btnText)}>
            + Add Friends
          </Box>
        </Stack>
      </Box>

    </Box>
  );
}
