import { Box, Typography, Stack, useTheme } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

// Count-up animation. Eases the number from the prior in-flight value to
// the new target over `duration` ms (easeOutCubic — fast start, gentle
// landing). Non-numeric targets (null/'--' loading state) pass through
// untouched. Honors prefers-reduced-motion by snapping to the target.
function useAnimatedNumber(target, duration = 700) {
  const [display, setDisplay] = useState(typeof target === 'number' ? 0 : target);
  const displayRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) {
      setDisplay(target);
      return undefined;
    }
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      displayRef.current = target;
      setDisplay(target);
      return undefined;
    }
    const from = displayRef.current;
    const to = target;
    if (from === to) return undefined;

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (to - from) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

export default function StatsTiles({ recipeCount, friendCount, onAddRecipe, onViewRecipes, onAddFriends, onViewFriends }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  const friendsEmpty = friendCount === 0;
  const animatedRecipeCount = useAnimatedNumber(recipeCount);
  const animatedFriendCount = useAnimatedNumber(friendCount);
  const friendDisplay = friendCount === null ? '--' : animatedFriendCount;

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
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: t1.count, lineHeight: 1, mb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
          {animatedRecipeCount}
        </Typography>
        <Typography sx={{ fontSize: 12, color: t1.sub, flex: 1 }}>
          Saved recipes
        </Typography>
        {/* Actions pinned to bottom */}
        <Stack spacing={0} sx={{ mt: 'auto' }}>
          <Typography component="button" onClick={onViewRecipes} sx={{ ...linkBtn(t1.link), mb: 2 }}>
            View recipes
          </Typography>
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
        <Typography sx={{ fontSize: 28, fontWeight: 800, color: t2.count, lineHeight: 1, mb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
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
          {friendsEmpty ? 'You have no connection yet' : 'Friends'}
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
