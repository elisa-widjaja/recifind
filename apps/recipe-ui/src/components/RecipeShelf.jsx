import { Box, Typography, Card, CardActionArea, Chip, Button } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';

/**
 * Horizontal scrollable shelf of recipe cards.
 * Props:
 *   recipes: Array<{ id, title, imageUrl, mealTypes, durationMinutes, sourceUrl?, platform?, saves? }>
 *   onSave: (recipe) => void  — called when Save is clicked
 *   onOpen: (recipe) => void  — called when card is clicked
 *   showPlatformBadge: boolean — show TikTok/Instagram badge
 *   cardWidth: number (default 140)
 */
export default function RecipeShelf({ recipes = [], onSave, onOpen, showPlatformBadge = false, cardWidth = 140 }) {
  if (!recipes.length) return null;

  return (
    <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 1, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
      {recipes.map((recipe) => {
        const platform = showPlatformBadge ? getPlatform(recipe.sourceUrl) : null;
        return (
          <Card
            key={recipe.id}
            elevation={0}
            sx={{ flexShrink: 0, width: cardWidth, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
          >
            <CardActionArea onClick={() => onOpen?.(recipe)} sx={{ p: 0 }}>
              <Box sx={{ width: cardWidth, height: cardWidth, position: 'relative', bgcolor: 'action.hover', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
                {recipe.imageUrl
                  ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🍳</Box>
                }
                {platform && (
                  <Chip
                    label={platform.label}
                    size="small"
                    sx={{ position: 'absolute', top: 6, left: 6, height: 18, fontSize: 9, fontWeight: 700, bgcolor: platform.color, color: '#fff', borderRadius: 1 }}
                  />
                )}
              </Box>
              <Box sx={{ p: 1 }}>
                <Typography variant="caption" display="block" noWrap fontWeight={600} sx={{ color: 'text.primary', fontSize: 11, lineHeight: 1.3, mb: 0.25 }}>
                  {recipe.title}
                </Typography>
                {recipe.durationMinutes && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                    {recipe.durationMinutes} min
                  </Typography>
                )}
              </Box>
            </CardActionArea>
            <Box sx={{ px: 1, pb: 1 }}>
              <Button
                fullWidth size="small" variant="contained" disableElevation
                startIcon={<BookmarkBorderIcon sx={{ fontSize: 14 }} />}
                onClick={(e) => { e.stopPropagation(); onSave?.(recipe); }}
                sx={{ borderRadius: 20, fontSize: 10, py: 0.5, textTransform: 'none' }}
              >
                Save
              </Button>
            </Box>
          </Card>
        );
      })}
    </Box>
  );
}

function getPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('tiktok.com')) return { label: 'TikTok', color: '#000' };
  if (sourceUrl.includes('instagram.com')) return { label: 'Instagram', color: '#c13584' };
  return null;
}
