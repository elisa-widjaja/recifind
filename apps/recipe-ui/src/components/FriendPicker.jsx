import { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Button,
  Stack,
  Avatar,
  Alert,
  Typography,
  IconButton,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

function FriendRow({ friend, selected, onToggle }) {
  return (
    <Box
      data-testid="friend-row"
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onToggle(friend.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(friend.id);
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : 'transparent',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Avatar src={friend.avatar_url ?? undefined}>
          {(friend.display_name ?? '?').charAt(0)}
        </Avatar>
        {selected && (
          <Box
            sx={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid',
              borderColor: 'background.paper',
            }}
          >
            <CheckIcon sx={{ fontSize: 12 }} />
          </Box>
        )}
      </Box>
      <Typography sx={{ flex: 1, fontWeight: 500 }}>
        {friend.display_name ?? friend.id}
      </Typography>
    </Box>
  );
}

export function FriendPicker({ open, friends, onClose, onSend }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setBusy(false);
      setResult(null);
    }
  }, [open]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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

  const handleCopyLink = () => onClose('copy-link');

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onClose()}
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 'env(safe-area-inset-bottom)',
            maxHeight: '85vh',
          },
        },
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
          <Typography variant="h6">Share this recipe</Typography>
          <IconButton onClick={() => onClose()} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ overflowY: 'auto', px: 1, pb: 1 }}>
          {friends.length === 0 ? (
            <Box sx={{ px: 2, py: 3 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                You don&apos;t have friends yet on ReciFriend.
              </Typography>
              <Button onClick={handleCopyLink} variant="outlined">Copy link</Button>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {friends.map((f) => (
                <FriendRow
                  key={f.id}
                  friend={f}
                  selected={selected.has(f.id)}
                  onToggle={toggle}
                />
              ))}
            </Stack>
          )}
          {result?.kind === 'success' && (
            <Alert severity="success" sx={{ mt: 2, mx: 1 }}>
              Shared with {result.count} friend{result.count === 1 ? '' : 's'}
            </Alert>
          )}
          {result?.kind === 'error' && (
            <Alert severity="error" sx={{ mt: 2, mx: 1 }}>
              {result.message}
            </Alert>
          )}
        </Box>

        {friends.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <Button onClick={handleCopyLink}>Copy link</Button>
            <Button
              onClick={handleSend}
              variant="contained"
              disabled={busy || selected.size === 0}
            >
              Send
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
