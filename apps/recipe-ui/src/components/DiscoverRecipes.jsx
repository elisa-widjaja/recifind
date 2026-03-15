import { Box, Typography } from '@mui/material';
import { buildVideoEmbedUrl, getVideoThumbnailUrl } from '../utils/videoEmbed';

/**
 * DiscoverRecipes — Instagram Suggested-Reels style horizontal shelf.
 * Shows TikTok/YouTube/Instagram recipes as full-bleed portrait cards with autoplay iframes.
 * Thumbnail image is always rendered underneath as a fallback background.
 *
 * Props:
 *   recipes — embeddable recipes (parent filters to social video sources)
 *   onOpen  — (recipe) => void, opens full recipe detail
 */
export default function DiscoverRecipes({ recipes = [], onOpen = () => {} }) {
  if (!recipes.length) return null;

  return (
    <Box>
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
          <WatchCard key={recipe.id} recipe={recipe} onOpen={onOpen} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single portrait video card.
 * Thumbnail image underneath + autoplay muted iframe on top.
 * If the iframe fails to embed (video owner disabled it), the thumbnail shows.
 * A transparent overlay intercepts taps so onOpen fires instead of the iframe.
 */
function WatchCard({ recipe, onOpen }) {
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);
  const thumbSrc = getVideoThumbnailUrl(recipe.sourceUrl) || recipe.imageUrl;

  return (
    <Box
      sx={{
        flexShrink: 0,
        width: 'calc((100vw - 44px) / 2)',
        aspectRatio: '9 / 16',
        borderRadius: '10px',
        overflow: 'hidden',
        position: 'relative',
        bgcolor: 'action.hover',
        cursor: 'pointer',
      }}
    >
      {/* Thumbnail — always present, acts as fallback if iframe is blocked */}
      {thumbSrc && (
        <Box
          component="img"
          src={thumbSrc}
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

      {/* Autoplay muted iframe — covers thumbnail when embedding works */}
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

      {/* Gradient overlay for legibility of title */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
          zIndex: 1,
        }}
      />

      {/* Title overlay at bottom */}
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
