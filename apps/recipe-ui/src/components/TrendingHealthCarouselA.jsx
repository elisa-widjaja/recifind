import { Box, Typography, Chip, IconButton } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';

/**
 * Horizontal peek carousel of AI-generated health/nutrition topic cards.
 *
 * Props:
 *   picks     — array of { topic, hashtag, reason, recipe }
 *   onOpen    — (recipe) => void
 *   onSave    — (recipe) => void
 */
export default function TrendingHealthCarouselA({ picks = [], onOpen, onSave }) {
  if (!picks.length) return null;

  return (
    <Box sx={{ mx: -2, overflow: 'hidden', position: 'relative' }}>
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          pl: 2,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: '16px',
        }}
      >
        {picks.map((pick) => (
          <AiPickCard key={pick.topic} pick={pick} onOpen={onOpen} onSave={onSave} />
        ))}
      </Box>
      {/* Right-edge gradient */}
      <Box
        sx={{
          position: 'absolute', top: 0, right: 0, bottom: 8, width: 48,
          pointerEvents: 'none',
          background: theme => `linear-gradient(to right, transparent, ${theme.palette.background.default})`,
        }}
      />
    </Box>
  );
}

function AiPickCard({ pick, onOpen, onSave }) {
  const recipe = pick.recipe || {};
  const thumbSrc = recipe.imageUrl;

  return (
    <Box
      sx={{
        flexShrink: 0,
        width: 'calc(85vw - 16px)',
        maxWidth: 320,
        scrollSnapAlign: 'start',
        border: 1,
        borderColor: 'divider',
        borderRadius: '10px',
        bgcolor: 'background.paper',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {/* Topic name */}
      <Typography fontWeight={700} fontSize={15} lineHeight={1.3}>
        {pick.topic}
      </Typography>

      {/* Hashtag chip — outlined purple, below title */}
      {pick.hashtag && (
        <Box>
          <Chip
            label={pick.hashtag}
            size="small"
            variant="outlined"
            sx={{
              fontSize: 11,
              height: 22,
              borderRadius: '11px',
              borderColor: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
              color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
              fontWeight: 600,
            }}
          />
        </Box>
      )}

      {/* Inline reason — clamped to 5 lines */}
      {pick.reason && (
        <Typography
          variant="body2"
          color="text.secondary"
          fontSize={12}
          lineHeight={1.5}
          sx={{ display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {pick.reason}
        </Typography>
      )}

      {/* Recipe preview */}
      {recipe.title && (
        <Box
          onClick={() => onOpen?.(recipe)}
          sx={{
            display: 'flex',
            gap: 1.25,
            alignItems: 'center',
            cursor: 'pointer',
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            p: 1,
            mt: 0.5,
          }}
        >
          <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'divider' }}>
            {thumbSrc
              ? <Box component="img" src={thumbSrc} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🍳</Box>
            }
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              fontSize={12}
              fontWeight={600}
              lineHeight={1.35}
              sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {recipe.title}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onSave?.(recipe); }}
            sx={{ p: 0.5, flexShrink: 0 }}
          >
            <BookmarkBorderIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
