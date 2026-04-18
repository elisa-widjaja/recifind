import { Alert, Button, Snackbar } from '@mui/material';

export function NotificationSoftPrompt({ open, onAccept, onDismiss, context }) {
  const copy = {
    'friend-request-sent': 'Get notified when your friend accepts?',
    'recipe-shared':       'Get notified when friends share recipes with you?',
    'recipe-saved':        'Get notified when friends save your recipes?',
  }[context] ?? 'Get notifications from ReciFriend?';

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      onClose={onDismiss}
      autoHideDuration={8000}
    >
      <Alert severity="info" action={<>
        <Button color="inherit" size="small" onClick={onDismiss}>Not now</Button>
        <Button color="inherit" size="small" onClick={onAccept}>Yes</Button>
      </>}>
        {copy}
      </Alert>
    </Snackbar>
  );
}
