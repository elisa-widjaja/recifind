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
import CloseIcon from '@mui/icons-material/Close';
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
      {/* Header: iOS X-close on top-LEFT, centered title — matches ShareSheet
          ("Share with") so the two share drawers read consistently. */}
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', px: '24px', pt: '26px', pb: '16px', flexShrink: 0 }}>
        <Box sx={{ position: 'absolute', left: '16px', top: '20px' }}>
          <Box
            component="button"
            aria-label="Close"
            onClick={() => onClose()}
            sx={(theme) => ({
              width: 36, height: 36, borderRadius: '50%',
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
              color: '#8a8a8a',
              border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              transition: 'background-color 150ms ease, transform 150ms ease',
              '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
              '&:active': { transform: 'scale(0.92)' },
            })}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>Your Connections</Typography>
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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
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
