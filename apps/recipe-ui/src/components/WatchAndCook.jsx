import { Box, Typography } from '@mui/material';
import { buildVideoEmbedUrl } from '../utils/videoEmbed';

/**
 * "Watch & Cook" — Instagram Suggested-Reels style horizontal shelf.
 * Shows only TikTok/YouTube recipes as full-bleed portrait video cards.
 *
 * Props:
 *   recipes — embeddable recipes (parent filters to TikTok/YouTube only)
 *   onOpen  — (recipe) => void, opens full recipe detail
 */
export default function WatchAndCook({ recipes = [], onOpen = () => {} }) {
  if (!recipes.length) return null;

  return (
    <Box>
      <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>
        📺 Watch &amp; Cook
      </Typography>

      {/*
        Bleed to screen edges (mx: -2 negates parent px: 2),
        pl: 2 keeps first card aligned with page content.
        No right padding so the 3rd card peeks from the right edge.
      */}
      <Box
        sx={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          mx: -2,
          pl: 2,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {recipes.map((recipe) => (
          <WatchCard
            key={recipe.id}
            recipe={recipe}
            onOpen={onOpen}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single portrait video card for the Watch & Cook shelf.
 * Width = calc((100vw - 44px) / 2) — 2 cards + 8px gap visible,
 * with ~20px sliver of the 3rd card peeking from the right.
 */
function WatchCard({ recipe, onOpen }) {
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);

  return (
    <Box
      sx={{
        flexShrink: 0,
        width: 'calc((100vw - 44px) / 2)',
        aspectRatio: '9 / 16',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: 'action.hover',
        cursor: 'pointer',
      }}
    >
      {/* Video iframe — always loaded */}
      {embedUrl && (
        <Box
          component="iframe"
          src={embedUrl}
          title={recipe.title}
          allow="autoplay"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      )}

      {/* Static image fallback */}
      {!embedUrl && recipe.imageUrl && (
        <Box
          component="img"
          src={recipe.imageUrl}
          alt={recipe.title}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {/* Gradient overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
          zIndex: 1,
        }}
      />

      {/* Title */}
      <Typography
        sx={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 2,
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {recipe.title}
      </Typography>

      {/* Transparent tap overlay — intercepts taps so onOpen fires, not the iframe */}
      <Box
        onClick={(e) => { e.stopPropagation(); onOpen(recipe); }}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          cursor: 'pointer',
        }}
      />
    </Box>
  );
}
