import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  Checkbox,
  ListItemText,
  Avatar,
  ListItemAvatar,
  Alert,
  Typography,
} from '@mui/material';

export function FriendPicker({ open, friends, onClose, onSend }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { kind: 'success', count } | { kind: 'error', message }

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setBusy(false);
      setResult(null);
    }
  }, [open]);

  const handleSend = async () => {
    setResult(null);
    setBusy(true);
    const ids = Array.from(selected);
    const res = await onSend(ids);
    setBusy(false);
    if (res.ok) {
      setResult({ kind: 'success', count: res.value.shared_with });
    } else if (res.error?.code === 'RATE_LIMITED') {
      setResult({
        kind: 'error',
        message: `You've shared too much recently. Try again in ${Math.ceil(res.error.retry_after_seconds / 60)} minutes.`,
      });
    } else if (res.error?.code === 'NOT_FRIENDS') {
      setResult({ kind: 'error', message: "Some of those friends aren't connected with you yet." });
    } else {
      setResult({ kind: 'error', message: 'Something went wrong. Try again.' });
    }
  };

  const handleCopyLink = () => {
    onClose('copy-link');
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={() => onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Share this recipe</DialogTitle>
      <DialogContent>
        {friends.length === 0 ? (
          <>
            <Typography variant="body2">You don&apos;t have friends yet on ReciFriend.</Typography>
            <Button onClick={handleCopyLink} sx={{ mt: 2 }}>
              Copy link
            </Button>
          </>
        ) : (
          <List>
            {friends.map((f) => (
              <ListItem key={f.id} disablePadding>
                <ListItemButton onClick={() => toggle(f.id)}>
                  <Checkbox
                    edge="start"
                    checked={selected.has(f.id)}
                    tabIndex={-1}
                    disableRipple
                  />
                  <ListItemAvatar>
                    <Avatar src={f.avatar_url ?? undefined}>
                      {(f.display_name ?? '?').charAt(0)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={f.display_name ?? f.id} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {result?.kind === 'success' && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Shared with {result.count} friend{result.count === 1 ? '' : 's'}
          </Alert>
        )}
        {result?.kind === 'error' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {result.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Cancel</Button>
        {friends.length > 0 && (
          <Button onClick={handleCopyLink}>Copy link</Button>
        )}
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={busy || selected.size === 0 || friends.length === 0}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
