import { useRef } from 'react';
import { Box, Typography, IconButton, Chip } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { buildVideoEmbedUrl, formatDuration, useInView } from '../utils/videoEmbed';

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
 * Single card sub-component. Extracted so useInView can be called at the
 * top level of a component (React hooks cannot be called inside a loop).
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
  const cardRef = useRef(null);
  const inView = useInView(cardRef);
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);
  const platform = showPlatformBadge ? getPlatform(recipe.sourceUrl) : null;

  return (
    <Box
      ref={cardRef}
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
              src={inView ? embedUrl : ''}
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

        {platform && (
          <Chip
            label={platform.label}
            size="small"
            sx={{
              position: 'absolute',
              top: 6,
              left: 6,
              zIndex: 2,
              height: 18,
              fontSize: 9,
              fontWeight: 700,
              bgcolor: platform.color,
              color: '#fff',
              borderRadius: 1,
            }}
          />
        )}
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
              <AccessTimeIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
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
            sx={{ p: 0.5 }}
          >
            <BookmarkBorderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onShare(recipe); }}
            aria-label="Share recipe"
            sx={{ p: 0.5 }}
          >
            <IosShareOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

function getPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('tiktok.com')) return { label: 'TikTok', color: '#000' };
  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be'))
    return { label: 'YouTube', color: '#ff0000' };
  if (sourceUrl.includes('instagram.com')) return { label: 'Instagram', color: '#c13584' };
  return null;
}
