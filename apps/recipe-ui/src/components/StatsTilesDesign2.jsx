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

// Right-arrow glyph — same path as /landing-arrow-20.svg so the visual
// lockup matches the brand arrow used in the public landing.
function Arrow({ color, size = 18 }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 20 20"
      sx={{ width: size, height: size, display: 'block', flexShrink: 0 }}
      fill="none"
    >
      <path
        d="M13.4793 10.8333H3.3335V9.16659H13.4793L8.81266 4.49992L10.0002 3.33325L16.6668 9.99992L10.0002 16.6666L8.81266 15.4999L13.4793 10.8333Z"
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

export default function StatsTilesDesign2({
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

  // Light mode traced from the Design 2 mock (white → soft lavender). Dark
  // mode mirrors the structure with a near-page-bg violet undertone so the
  // tile blends into the #121212 home background.
  const t = dark ? {
    bg: 'linear-gradient(135deg, #1c1825 0%, #141319 100%)',
    text: '#fff',
    label: 'rgba(255,255,255,0.9)',
    icon: '#fff',
    border: '1px solid rgba(255,255,255,0.06)',
    press: 'rgba(255,255,255,0.04)',
    addBg: 'rgba(255,255,255,0.08)',
    addPress: 'rgba(255,255,255,0.16)',
    shadow: '0 4px 14px rgba(0,0,0,0.5)',
  } : {
    bg: 'linear-gradient(135deg, #ffffff 0%, #f2f0ff 100%)',
    text: '#0a0a0a',
    label: '#0a0a0a',
    icon: '#0a0a0a',
    border: '1px solid rgba(0,0,0,0.06)',
    press: 'rgba(0,0,0,0.04)',
    addBg: 'rgba(0,0,0,0.05)',
    addPress: 'rgba(0,0,0,0.12)',
    shadow: '0 4px 14px rgba(0,0,0,0.08)',
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
    p: '18px',
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

  // Design 2: label on top of number (rows flipped from Design 1). Two cards
  // stacked vertically (full-width), keeping the same icon pairings — arrow
  // with label row, "+" with number row — so each interactive element shares
  // a horizontal axis with the content it relates to.
  const renderCard = ({ count, label, onView, onAdd, addLabel }) => (
    <Box
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={onKeyView(onView)}
      sx={cardSx}
    >
      {/* Top row: label left, arrow right (vertically centered with label). */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 500, color: t.label }}>
          {label}
        </Typography>
        <Arrow color={t.icon} />
      </Box>
      {/* Bottom row: number left, "+" circle right (vertically centered with number). */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1.25 }}>
        <Typography sx={{
          fontSize: 30, fontWeight: 800, lineHeight: 1,
          color: t.text, fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
