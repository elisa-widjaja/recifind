import { Dialog, DialogContent, Box, Typography, Button, Stack } from '@mui/material';

/**
 * Full-screen welcome modal shown once to new users.
 * Props:
 *   open: boolean
 *   onDismiss: () => void
 *   inviterName: string | null
 *   recipes: Array<{ id, title, imageUrl }>   — 3 recipes to preview
 */
export default function WelcomeModal({ open, onDismiss, onSkip, inviterName, recipes = [] }) {
  const hasInviter = Boolean(inviterName);

  return (
    <Dialog open={open} fullWidth maxWidth="xs" onClose={onDismiss} PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogContent sx={{ pt: 3, pb: 3, px: 3, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size="small" onClick={onSkip} sx={{ color: 'text.disabled', minWidth: 0, p: 0.5, lineHeight: 1, fontSize: 18 }}>✕</Button>
        </Box>
        <Typography fontSize={40} mb={1}>👋</Typography>
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          {hasInviter ? `${inviterName} invited you to ReciFind` : 'Welcome to ReciFind!'}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2.5}>
          {hasInviter
            ? `${inviterName} cooks some great stuff. Save their recipes to your collection.`
            : 'Discover and save recipes. Share them with friends.'}
        </Typography>

        <Stack spacing={1}>
          <Button fullWidth variant="contained" disableElevation onClick={onDismiss}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {hasInviter ? 'Explore ReciFind →' : 'Get started →'}
          </Button>
          <Button fullWidth size="small" onClick={onSkip}
            sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12 }}>
            Don't show this again
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
