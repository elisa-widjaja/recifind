import { Box, Typography, useTheme } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

// Count-up animation. Eases the number from the prior in-flight value to
// the new target over `duration` ms (easeOutCubic — fast start, gentle
// landing). Non-numeric targets (null/'--' loading state) pass through
// untouched. Honors prefers-reduced-motion by snapping to the target.
// Mirrors the helper in StatsTiles.jsx so behavior matches exactly.
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

// Right-arrow glyph — same head shape and arm thickness as the original
// /landing-arrow-20.svg. Tail rendered at ~13px wide (14.444 viewBox units
// at 0.9 px/unit). Head sits to the right of the bar; tip lands at x=17.637.
// The viewBox aspect keeps 1 unit = 0.9px at size=18 so the bar arm stays
// at the same 1.5px stroke as before.
function Arrow({ color, size = 18 }) {
  const width = size * 17.637 / 20;
  return (
    <Box
      component="svg"
      viewBox="0 0 17.637 20"
      sx={{ width, height: size, display: 'block', flexShrink: 0 }}
      fill="none"
    >
      <path
        d="M14.444 10.833H0V9.167H14.444L9.777 4.5L10.965 3.333L17.637 10L10.965 16.667L9.777 15.5L14.444 10.833Z"
        fill={color}
      />
    </Box>
  );
}

// Plus glyph — stroke-width 1.667 to match the Arrow's filled arm thickness
// on the same 20×20 viewBox, so both icons read at identical visual weight.
function Plus({ color, size = 18 }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 20 20"
      sx={{ width: size, height: size, display: 'block', flexShrink: 0 }}
      fill="none"
    >
      <line x1="10" y1="4" x2="10" y2="16" stroke={color} strokeWidth="1.667" strokeLinecap="round" />
      <line x1="4" y1="10" x2="16" y2="10" stroke={color} strokeWidth="1.667" strokeLinecap="round" />
    </Box>
  );
}

export default function StatsTilesDesign1({
  recipeCount,
  friendCount,
  onViewRecipes,
  onViewFriends,
  onAddRecipe,
  onAddFriends,
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  const animatedRecipeCount = useAnimatedNumber(recipeCount);
  const animatedFriendCount = useAnimatedNumber(friendCount);
  const friendDisplay = friendCount === null ? '--' : animatedFriendCount;

  // Light mode traced from the user's Design 1 mock (white → soft lavender).
  // Dark mode mirrors the structure with a near-page-bg violet undertone so
  // the tile blends into the #121212 home background.
  const t = dark ? {
    bg: 'linear-gradient(135deg, #1e1730 0%, #15131c 55%)',
    text: '#fff',
    label: 'rgba(255,255,255,0.9)',
    icon: '#fff',
    border: '1px solid rgba(255,255,255,0.06)',
    press: 'rgba(255,255,255,0.04)',
    addBg: 'rgba(255,255,255,0.08)',
    addPress: 'rgba(255,255,255,0.16)',
    shadow: '0 4px 14px rgba(0,0,0,0.75)',
  } : {
    bg: 'linear-gradient(135deg, #ffffff 40%, #ebe5ff 100%)',
    text: '#0a0a0a',
    label: '#0a0a0a',
    icon: '#0a0a0a',
    border: '1px solid rgba(0,0,0,0.06)',
    press: 'rgba(0,0,0,0.04)',
    addBg: 'rgba(0,0,0,0.05)',
    addPress: 'rgba(0,0,0,0.12)',
    shadow: '0 4px 14px rgba(0,0,0,0.12)',
  };

  // Each card is a separate rounded box with its own shadow/border. Outer is
  // div+role=button (not <button>) so we can nest the "+" Add button inside
  // without violating the no-nested-interactives rule. Keyboard support is
  // preserved via Enter/Space → onView.
  const cardSx = {
    position: 'relative',
    textAlign: 'left',
    borderRadius: '14px',
    background: t.bg,
    border: t.border,
    boxShadow: t.shadow,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    p: '18px 16px',
    minHeight: 100,
    overflow: 'hidden',
    transition: 'background-color 120ms ease-out',
    '&:active': { bgcolor: t.press },
  };

  // "+" Add button — circular, subtle bg that darkens on press.
  const addBtnSx = {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: 'none',
    bgcolor: t.addBg,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: 0,
    flexShrink: 0,
    transition: 'background-color 120ms ease-out',
    WebkitTapHighlightColor: 'transparent',
    '&:active': { bgcolor: t.addPress },
  };

  const onKeyView = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  const renderCard = ({ count, label, onView, onAdd, addLabel }) => (
    <Box
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={onKeyView(onView)}
      sx={cardSx}
    >
      {/* Top row: number left, arrow right (vertically centered with number). */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{
          fontSize: 30, fontWeight: 800, lineHeight: 1,
          color: t.text, fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </Typography>
        <Arrow color={t.icon} />
      </Box>
      {/* Bottom row: label left, "+" circle right (vertically centered with label). */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1.25 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: t.label }}>
          {label}
        </Typography>
        <Box
          component="button"
          aria-label={addLabel}
          onClick={(e) => { e.stopPropagation(); onAdd?.(); }}
          sx={addBtnSx}
        >
          <Plus color={t.icon} size={14} />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
      {renderCard({
        count: animatedRecipeCount,
        label: 'Recipes',
        onView: onViewRecipes,
        onAdd: onAddRecipe,
        addLabel: 'Add recipe',
      })}
      {renderCard({
        count: friendDisplay,
        label: 'Friends',
        onView: onViewFriends,
        onAdd: onAddFriends,
        addLabel: 'Add friends',
      })}
    </Box>
  );
}
