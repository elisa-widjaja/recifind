import { Box, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { getVideoThumbnailUrl } from '../utils/videoEmbed';

/**
 * "Watch & Cook" — Instagram Suggested-Reels style horizontal shelf.
 * Shows TikTok/YouTube recipes as full-bleed portrait cards with thumbnail + play button.
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
          <WatchCard key={recipe.id} recipe={recipe} onOpen={onOpen} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single portrait card. Shows YouTube thumbnail (or recipe image) with
 * a play button overlay and title gradient. Tapping opens recipe detail.
 */
function WatchCard({ recipe, onOpen }) {
  const videoThumb = getVideoThumbnailUrl(recipe.sourceUrl);
  const thumbSrc = videoThumb || recipe.imageUrl;

  return (
    <Box
      onClick={() => onOpen(recipe)}
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
      {/* Thumbnail image */}
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

      {/* Dark gradient overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
          zIndex: 1,
        }}
      />

      {/* Play button — centred */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}
      >
        <Box sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          bgcolor: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <PlayArrowIcon sx={{ color: '#fff', fontSize: 26 }} />
        </Box>
      </Box>

      {/* Title overlay at bottom */}
      <Typography
        sx={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 3,
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
    </Box>
  );
}
