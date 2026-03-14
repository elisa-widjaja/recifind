import { Box, Typography, IconButton } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { buildVideoEmbedUrl, getVideoThumbnailUrl, formatDuration } from '../utils/videoEmbed';

/**
 * Horizontal scrollable shelf of recipe cards.
 *
 * Props:
 *   recipes        — array of recipe objects
 *   onSave         — (recipe) => void, called when save icon tapped
 *   onShare        — (recipe) => void, called when share icon tapped
 *   onOpen         — (recipe) => void, called when card tapped
 *   cardWidth      — number (default 140), card width in px
 *   cardHeight     — number (default = cardWidth), thumbnail height in px
 */
export default function RecipeShelf({
  recipes = [],
  onSave = () => {},
  onShare = () => {},
  onOpen = () => {},
  cardWidth = 140,
  cardHeight,
  gap = '12px',
  peek = false,
}) {
  if (!recipes.length) return null;

  const thumbHeight = cardHeight ?? cardWidth;

  return (
    // Outer wrapper: negative margin extends the scroll container to screen edges
    <Box sx={{ mx: -2, overflow: 'hidden', position: 'relative' }}>
      {/* Inner scroll row: px:2 aligns first card with page content */}
      <Box
        sx={{
          display: 'flex',
          gap,
          overflowX: 'auto',
          px: 2,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          ...(peek && {
            scrollSnapType: 'x mandatory',
          }),
        }}
      >
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onSave={onSave}
            onShare={onShare}
            onOpen={onOpen}
            cardWidth={cardWidth}
            thumbHeight={thumbHeight}
            peek={peek}
          />
        ))}
      </Box>
      {/* Right-edge gradient to signal more content */}
      {peek && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 8,
            width: 48,
            pointerEvents: 'none',
            background: theme => `linear-gradient(to right, transparent, ${theme.palette.background.default})`,
          }}
        />
      )}
    </Box>
  );
}

function RecipeCard({ recipe, onSave, onShare, onOpen, cardWidth, thumbHeight, peek }) {
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);
  const thumbSrc = getVideoThumbnailUrl(recipe.sourceUrl) || recipe.imageUrl;

  return (
    <Box
      onClick={() => onOpen(recipe)}
      sx={{
        flexShrink: 0,
        width: cardWidth,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        cursor: 'pointer',
        ...(peek && { scrollSnapAlign: 'start' }),
      }}
    >
      {/* ── Thumbnail ── */}
      <Box
        sx={{
          position: 'relative',
          width: cardWidth,
          height: thumbHeight,
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        {/* Thumbnail — always shown, fallback when iframe is blocked */}
        {thumbSrc ? (
          <Box
            component="img"
            src={thumbSrc}
            alt={recipe.title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
            🍳
          </Box>
        )}

        {/* Autoplay muted iframe — covers thumbnail when embedding works */}
        {embedUrl && (
          <>
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
            {/* Transparent overlay intercepts taps so onOpen fires, not the iframe */}
            <Box
              onClick={(e) => { e.stopPropagation(); onOpen(recipe); }}
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                cursor: 'pointer',
              }}
            />
          </>
        )}
      </Box>

      {/* ── Text + actions — fixed height so icons never shift ── */}
      <Box sx={{ px: 1, py: 0.75, height: 72, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.35,
            color: 'text.primary',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {recipe.title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {recipe.durationMinutes > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                {formatDuration(recipe.durationMinutes)}
              </Typography>
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onSave(recipe); }}
            aria-label="Save recipe"
            sx={{ p: 0.5, mr: '9px' }}
          >
            <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onShare(recipe, e); }}
            aria-label="Share recipe"
            sx={{ p: 0.5 }}
          >
            <IosShareOutlinedIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
