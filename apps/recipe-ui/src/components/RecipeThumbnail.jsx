import { Box, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

// Title-hashed gradient palette — warm food-tile feel. Same title always
// resolves to the same gradient so a given recipe looks consistent wherever
// it appears (shelf, list, activity feed, modal).
const PALETTE = [
  ['#fcd34d', '#f97316'], // amber → orange
  ['#fda4af', '#f43f5e'], // pink → rose
  ['#fde68a', '#fb923c'], // yellow → orange
  ['#86efac', '#16a34a'], // mint → green
  ['#fef08a', '#facc15'], // pale → gold
  ['#c4b5fd', '#7c3aed'], // lavender → violet
  ['#a5b4fc', '#6366f1'], // periwinkle → indigo
  ['#5eead4', '#0d9488'], // aqua → teal
];

function hashString(s) {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function gradientFor(title) {
  const [a, b] = PALETTE[hashString(title) % PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function initialOf(title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) return '?';
  // First non-whitespace character of the first non-emoji-leading word.
  // Strip leading non-alphanumeric chars (emoji, punctuation) so titles like
  // "🌶️ Spicy Noodles" resolve to "S" rather than the emoji.
  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+/u, '');
  return (stripped || trimmed).charAt(0).toUpperCase();
}

/**
 * Recipe thumbnail with skeleton-style loading + graceful fallback.
 *
 * Behavior:
 *   - Title-hashed gradient is always painted — acts as the skeleton while
 *     the image loads, and as the permanent fallback if there's no src or
 *     the image fails to load.
 *   - On successful load, the image fades in over 200ms.
 *   - On error or missing src, a centered initial letter renders over the
 *     gradient. Never shows a broken-image icon.
 *
 * Props:
 *   src        — image URL (string | null | undefined)
 *   title      — recipe title; used for the initial letter + gradient hash
 *   alt        — img alt text (defaults to title)
 *   fontSize   — initial-letter font size (default 28)
 *   sx         — extra sx merged onto the outer Box (size/borderRadius/etc.)
 *
 * The component fills its parent (width/height: 100%). Wrap in a sized Box
 * with `position:'relative'` and the desired `borderRadius` / `overflow`.
 */
export default function RecipeThumbnail({ src, title, alt, fontSize = 28, sx }) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const useFallback = !src || errored;
  const gradient = useMemo(() => gradientFor(title), [title]);

  return (
    <Box sx={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: gradient,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...sx,
    }}>
      {!useFallback && (
        <Box
          component="img"
          src={src}
          alt={alt ?? title ?? ''}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          sx={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 200ms ease-out',
          }}
        />
      )}
      {useFallback && (
        <Typography
          aria-hidden
          sx={{
            color: '#ffffff',
            fontWeight: 800,
            fontSize,
            lineHeight: 1,
            textShadow: '0 1px 2px rgba(0,0,0,0.18)',
            userSelect: 'none',
          }}
        >
          {initialOf(title)}
        </Typography>
      )}
    </Box>
  );
}
