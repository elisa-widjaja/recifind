import { Box, Typography, IconButton } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { buildVideoEmbedUrl, formatDuration } from '../utils/videoEmbed';

/**
 * Horizontal scrollable shelf of recipe cards.
 *
 * Props:
 *   recipes        — array of recipe objects
 *   onSave         — (recipe) => void, called when save icon tapped
 *   onShare        — (recipe) => void, called when share icon tapped (new)
 *   onOpen         — (recipe) => void, called when card tapped
 *   showPlatformBadge — boolean, show TikTok/YouTube badge on thumbnail
 *   cardWidth      — number (default 140), card width in px
 *   cardHeight     — number (default = cardWidth), thumbnail height in px
 */
export default function RecipeShelf({
  recipes = [],
  onSave = () => {},
  onShare = () => {},
  onOpen = () => {},
  showPlatformBadge = false,
  cardWidth = 140,
  cardHeight,
}) {
  if (!recipes.length) return null;

  const thumbHeight = cardHeight ?? cardWidth;

  return (
    // Outer wrapper: negative margin extends the scroll container to screen edges
    <Box sx={{ mx: -2, overflow: 'hidden' }}>
      {/* Inner scroll row: px:2 aligns first card with page content */}
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          px: 2,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onSave={onSave}
            onShare={onShare}
            onOpen={onOpen}
            showPlatformBadge={showPlatformBadge}
            cardWidth={cardWidth}
            thumbHeight={thumbHeight}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single card sub-component.
 */
function RecipeCard({
  recipe,
  onSave,
  onShare,
  onOpen,
  showPlatformBadge,
  cardWidth,
  thumbHeight,
}) {
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);

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
        {embedUrl ? (
          <>
            <Box
              component="iframe"
              src={embedUrl}
              title={recipe.title}
              allow="autoplay"
              sx={{
                width: '100%',
                height: '100%',
                border: 'none',
                display: 'block',
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
        ) : recipe.imageUrl ? (
          <Box
            component="img"
            src={recipe.imageUrl}
            alt={recipe.title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
            }}
          >
            🍳
          </Box>
        )}

        {showPlatformBadge && <PlatformIcon sourceUrl={recipe.sourceUrl} />}
      </Box>

      {/* ── Text + actions ── */}
      <Box sx={{ px: 1, py: 0.75 }}>
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
            mb: 0.5,
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
            onClick={(e) => { e.stopPropagation(); onShare(recipe); }}
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

function PlatformIcon({ sourceUrl }) {
  if (!sourceUrl) return null;

  let svg = null;

  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) {
    svg = (
      <svg width="22" height="15" viewBox="0 0 22 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="22" height="15" rx="3" fill="#FF0000" />
        <polygon points="9,4 16,7.5 9,11" fill="white" />
      </svg>
    );
  } else if (sourceUrl.includes('tiktok.com')) {
    svg = (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="18" height="18" rx="3" fill="#010101" />
        <path d="M12.5 4c.1.9.6 1.7 1.5 2.1v1.6c-.6-.1-1.1-.3-1.5-.6v3.4C12.5 12.3 11.2 13.5 9.5 13.5 7.8 13.5 6.5 12.3 6.5 10.5S7.8 7.5 9.5 7.5c.2 0 .4 0 .5.1V9.2c-.2-.1-.3-.1-.5-.1-.8 0-1.5.6-1.5 1.4s.7 1.4 1.5 1.4 1.5-.6 1.5-1.4V4h1z" fill="white" />
      </svg>
    );
  } else if (sourceUrl.includes('instagram.com')) {
    svg = (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="ig" x1="0" y1="18" x2="18" y2="0">
            <stop offset="0%" stopColor="#f09433" />
            <stop offset="50%" stopColor="#e6683c" />
            <stop offset="75%" stopColor="#dc2743" />
            <stop offset="100%" stopColor="#cc2366" />
          </linearGradient>
        </defs>
        <rect width="18" height="18" rx="4" fill="url(#ig)" />
        <circle cx="9" cy="9" r="3.5" stroke="white" strokeWidth="1.5" fill="none" />
        <circle cx="13" cy="5" r="1" fill="white" />
      </svg>
    );
  }

  if (!svg) return null;
  return (
    <Box sx={{ position: 'absolute', top: 6, left: 6, zIndex: 2, lineHeight: 0 }}>
      {svg}
    </Box>
  );
}
