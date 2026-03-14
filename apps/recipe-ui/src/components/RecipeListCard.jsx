import { Box, Card, CardActionArea, IconButton, Typography } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { formatDuration } from '../utils/videoEmbed';

/**
 * Horizontal recipe card: thumbnail left, title + duration + save/share right.
 *
 * Props:
 *   recipe      — recipe object (title, imageUrl, durationMinutes)
 *   onOpen      — () => void, called when card body is tapped
 *   onSave      — (recipe) => void, called when save icon tapped
 *   onShare     — (recipe, e) => void, called when share icon tapped
 *   thumbnail   — optional ReactNode replacing the default img/emoji thumbnail
 *   saveIcon    — optional ReactNode replacing the default BookmarkBorderIcon
 *   cardSx      — optional extra sx merged onto the Card
 */
export default function RecipeListCard({ recipe, onOpen, onSave, onShare, thumbnail, saveIcon, cardSx }) {
  return (
    <Card
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', ...cardSx }}
    >
      <CardActionArea
        onClick={() => onOpen?.(recipe)}
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          pt: '8px',
          pb: '8px',
          pl: '8px',
          pr: 1.5,
          gap: '12px',
          '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0 },
        }}
      >
        {thumbnail ?? (
          <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0, overflow: 'hidden', borderRadius: '6px', bgcolor: 'action.hover' }}>
            {recipe.imageUrl
              ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🍳</Box>
            }
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '0.8125rem',
              lineHeight: 1.4,
              textTransform: 'uppercase',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {recipe.title}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {recipe.durationMinutes ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">{formatDuration(recipe.durationMinutes)}</Typography>
              </Box>
            ) : <Box />}
            <Box sx={{ flexGrow: 1 }} />
            <IconButton
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSave?.(recipe, e); }}
              aria-label="Save recipe"
              sx={{ p: 0.5, mr: '9px' }}
            >
              {saveIcon ?? <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />}
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
      </CardActionArea>
    </Card>
  );
}
