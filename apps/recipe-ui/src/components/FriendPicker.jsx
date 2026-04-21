import { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Button,
  Stack,
  Avatar,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { getAvatarColor } from '../lib/avatarColor';

function FriendRow({ friend, selected, onToggle }) {
  const initial = (friend.display_name ?? '?').charAt(0).toUpperCase();
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
        <Avatar src={friend.avatar_url ?? undefined} sx={{ bgcolor: getAvatarColor(friend.id) }}>
          {initial}
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

export function FriendPicker({ open, friends, onClose, onSend, darkMode = false }) {
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSend = () => {
    const ids = Array.from(selected);
    // Fire-and-forget: dismiss immediately so the drawer never feels stuck
    // on a slow API. Parent owns progress + result via snackbar.
    onClose('sent', ids.length);
    Promise.resolve()
      .then(() => onSend(ids))
      .catch((err) => console.error('FriendPicker send threw:', err));
  };

  const handleCopyLink = () => onClose('copy-link');

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onClose()}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
      PaperProps={{
        sx: {
          borderRadius: '16px 16px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          height: 'calc(85dvh + 20px)',
          display: 'flex',
          flexDirection: 'column',
          ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5, pb: 1, flexShrink: 0 }}>
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: darkMode ? 'rgba(255,255,255,0.3)' : 'grey.300', mb: 1.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Share with Connections</Typography>
      </Box>
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
        <Box sx={{ overflowY: 'auto', px: 1, pb: 1, flex: 1 }}>
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
        </Box>

        {friends.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <Button onClick={handleCopyLink}>Copy link</Button>
            <Button
              onClick={handleSend}
              variant="contained"
              disabled={selected.size === 0}
              sx={{ minWidth: 120 }}
            >
              Send
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
