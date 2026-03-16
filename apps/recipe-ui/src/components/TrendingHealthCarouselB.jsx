import { Box, Typography, Chip, IconButton } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';

// Trim text to fit ~4 lines by cutting at the last sentence boundary within maxChars.
function summarize(text, maxChars = 220) {
  if (!text || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return lastSentence > 80 ? text.slice(0, lastSentence + 1) : cut.trimEnd() + '…';
}

/**
 * Horizontal peek carousel of AI-generated health/nutrition topic cards.
 * Layout order: Recipe → Title → Explanation → Hashtag
 *
 * Props:
 *   picks     — array of { topic, hashtag, reason, recipe }
 *   onOpen    — (recipe) => void
 *   onSave    — (recipe) => void
 */
export default function TrendingHealthCarouselB({ picks = [], onOpen, onSave, onShare }) {
  if (!picks.length) return null;

  return (
    <Box sx={{ mx: -2, overflow: 'hidden', position: 'relative' }}>
      <Box
        sx={{
          display: 'flex',
          gap: '8px',
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
          <AiPickCard key={pick.topic} pick={pick} onOpen={onOpen} onSave={onSave} onShare={onShare} />
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

function AiPickCard({ pick, onOpen, onSave, onShare }) {
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
        pt: 1.5,
        px: 1.5,
        pb: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {/* Recipe preview — top */}
      {recipe.title && (
        <Box
          onClick={() => onOpen?.(recipe)}
          sx={{
            display: 'flex',
            gap: 1.25,
            cursor: 'pointer',
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            p: 1,
          }}
        >
          <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'divider' }}>
            {thumbSrc
              ? <Box component="img" src={thumbSrc} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🍳</Box>
            }
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 56 }}>
            <Typography
              fontSize={12}
              fontWeight={600}
              lineHeight={1.35}
              sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textTransform: 'uppercase' }}
            >
              {recipe.title}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
              <IconButton
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSave?.(recipe, e); }}
                aria-label="Save recipe"
                sx={{ p: 0.5 }}
              >
                <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
              </IconButton>
              <IconButton
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onShare?.(recipe, e); }}
                aria-label="Share recipe"
                sx={{ p: 0.5 }}
              >
                <IosShareOutlinedIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
              </IconButton>
            </Box>
          </Box>
        </Box>
      )}

      {/* Topic name */}
      <Typography fontWeight={700} fontSize={15} lineHeight={1.3} sx={{ mt: '8px' }}>
        {pick.topic}
      </Typography>

      {/* Inline reason — summarized to ~4 lines */}
      {pick.reason && (
        <Typography
          variant="body2"
          color="text.secondary"
          fontSize={12}
          lineHeight={1.5}
        >
          {summarize(pick.reason)}
        </Typography>
      )}

      {/* Hashtag chip — outlined purple, bottom */}
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
    </Box>
  );
}
