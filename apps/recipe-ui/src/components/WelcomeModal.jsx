import { Dialog, DialogContent, Box, Typography, Button, Stack } from '@mui/material';

/**
 * Full-screen welcome modal shown once to new users.
 * Props:
 *   open: boolean
 *   onDismiss: () => void
 *   inviterName: string | null
 *   recipes: Array<{ id, title, imageUrl }>   — 3 recipes to preview
 */
export default function WelcomeModal({ open, onDismiss, inviterName, recipes = [] }) {
  const hasInviter = Boolean(inviterName);

  return (
    <Dialog open={open} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogContent sx={{ pt: 4, pb: 3, px: 3, textAlign: 'center' }}>
        <Typography fontSize={40} mb={1}>👋</Typography>
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          {hasInviter ? `${inviterName} invited you to ReciFind` : 'Welcome to ReciFind!'}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2.5}>
          {hasInviter
            ? `${inviterName} cooks some great stuff. Save their recipes to your collection.`
            : 'Discover and save recipes. Share them with friends.'}
        </Typography>

        {recipes.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 3, justifyContent: 'center' }}>
            {recipes.slice(0, 3).map(recipe => (
              <Box key={recipe.id} sx={{ flex: 1, maxWidth: 90, textAlign: 'center' }}>
                <Box sx={{ width: '100%', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', mb: 0.5 }}>
                  {recipe.imageUrl
                    ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🍳</Box>
                  }
                </Box>
                <Typography variant="caption" display="block" noWrap sx={{ fontSize: 10, color: 'text.secondary' }}>
                  {recipe.title}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        <Stack spacing={1}>
          <Button fullWidth variant="contained" disableElevation onClick={onDismiss}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {hasInviter ? 'Explore ReciFind →' : 'Get started →'}
          </Button>
          <Button fullWidth size="small" onClick={onDismiss}
            sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12 }}>
            Skip for now
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
