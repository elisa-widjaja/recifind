import { Drawer, Box, Typography, Button } from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';

const COPY = {
  'friend-request-sent': {
    headline: 'Know the moment they accept',
    body: "We'll send you a notification when your friend says yes.",
  },
  'recipe-shared': {
    headline: 'Never miss a recipe',
    body: 'Get a notification when a friend shares a recipe with you.',
  },
  'recipe-saved': {
    headline: 'See who loves your recipes',
    body: 'Find out when a friend saves a recipe you posted.',
  },
};

const DEFAULT_COPY = {
  headline: 'Stay in the loop',
  body: 'Turn on notifications to hear from your friends on ReciFriend.',
};

export function NotificationSoftPrompt({ open, onAccept, onDismiss, context }) {
  const { headline, body } = COPY[context] ?? DEFAULT_COPY;

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onDismiss}
      PaperProps={{
        sx: (theme) => ({
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          ...(theme.palette.mode === 'dark'
            ? { backgroundColor: '#212328', backgroundImage: 'none' }
            : {}),
        }),
      }}
    >
      <Box sx={{ px: 3, pt: 4, pb: 3, textAlign: 'center' }}>
        <Box
          sx={(theme) => ({
            width: 64,
            height: 64,
            borderRadius: '50%',
            mx: 'auto',
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.palette.mode === 'dark'
              ? 'rgba(124, 58, 237, 0.18)'
              : 'rgba(124, 58, 237, 0.10)',
          })}
        >
          <NotificationsActiveOutlinedIcon
            sx={{ fontSize: 32, color: 'primary.main' }}
          />
        </Box>

        <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 1, lineHeight: 1.25 }}>
          {headline}
        </Typography>

        <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 3, px: 1 }}>
          {body}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <Button
            variant="contained"
            onClick={onAccept}
            sx={{
              borderRadius: 999,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: 15,
              py: 1.5,
              px: 4,
            }}
          >
            Turn on notifications
          </Button>
        </Box>

        <Button
          fullWidth
          variant="text"
          onClick={onDismiss}
          sx={{
            textTransform: 'none',
            fontWeight: 500,
            fontSize: 14,
            color: 'text.secondary',
            py: 1,
          }}
        >
          Not now
        </Button>
      </Box>
    </Drawer>
  );
}
