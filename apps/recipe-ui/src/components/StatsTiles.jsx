import { useState, useEffect } from 'react';
import { Box, Typography, Stack } from '@mui/material';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

export default function StatsTiles({ recipeCount, accessToken, onAddRecipe, onViewRecipes, onOpenFriends }) {
  const [friendCount, setFriendCount] = useState(null); // null = loading/error, number = resolved

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_BASE_URL}/friends`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setFriendCount((data.friends || []).length))
      .catch(() => setFriendCount(null)); // null = error, show '--'
  }, [accessToken]);

  const recipesEmpty = recipeCount === 0;
  const friendsEmpty = friendCount === 0;
  const friendDisplay = friendCount === null ? '--' : friendCount;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', mb: 1 }}>
      {/* Tile 1 — Recipes */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #1e1b4b, #1a1a2e)',
          border: '1px solid #3730a3',
          borderRadius: '14px',
          p: 2,
        }}
      >
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#818cf8', letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          RECIPES
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1, mb: 0.25 }}>
          {recipeCount}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#a5b4fc', mb: 1.75 }}>
          {recipesEmpty ? "You don't have any saved recipes yet" : 'saved recipes'}
        </Typography>
        <Stack spacing={1}>
          <Box
            component="button"
            onClick={onAddRecipe}
            sx={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              py: '8px',
              px: '12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            + Add Recipe
          </Box>
          {!recipesEmpty && (
            <Typography
              component="button"
              onClick={onViewRecipes}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                color: '#818cf8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textAlign: 'center',
              }}
            >
              View recipes
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Tile 2 — Friends */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #064e3b, #0a1f18)',
          border: '1px solid #065f46',
          borderRadius: '14px',
          p: 2,
        }}
      >
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#34d399', letterSpacing: '0.8px', textTransform: 'uppercase', mb: 1 }}>
          FRIENDS
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1, mb: 0.25 }}>
          {friendDisplay}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#6ee7b7', mb: 1.75 }}>
          {friendsEmpty ? "You're not connected with any friends yet" : 'friends'}
        </Typography>
        <Stack spacing={1}>
          <Box
            component="button"
            onClick={onOpenFriends}
            sx={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              py: '8px',
              px: '12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            + Add Friends
          </Box>
          {!friendsEmpty && (
            <Typography
              component="button"
              onClick={onOpenFriends}
              sx={{
                background: 'none',
                border: 'none',
                p: 0,
                color: '#34d399',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textAlign: 'center',
              }}
            >
              View friends
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
