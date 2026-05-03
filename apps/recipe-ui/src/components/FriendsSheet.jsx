import { useState, useEffect } from 'react';
import { Modal, Box, Typography, IconButton, TextField, Button, Slide } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function FriendRow({ name, seed, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: avatarColor(seed),
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, flexShrink: 0,
      }}>
        {name.charAt(0).toUpperCase()}
      </Box>
      <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{name}</Typography>
      {action}
    </Box>
  );
}

export default function FriendsSheet({
  open,
  onClose,
  initialView = 'list',
  friends = [],
  pendingRequests = [],
  onAccept,
  onDecline,
  onSendInvite,
}) {
  const [view, setView] = useState(initialView);
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => { if (open) setView(initialView); }, [open, initialView]);

  return (
    <Modal open={open} onClose={onClose} aria-label="Friends sheet">
      <Slide in={open} direction="up" mountOnEnter unmountOnExit>
        <Box
          role="dialog"
          sx={{
            position: 'fixed',
            left: 0, right: 0, bottom: 0,
            top: '8%',
            bgcolor: 'background.paper',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            boxShadow: '0 -10px 30px rgba(0,0,0,.2)',
            display: 'flex', flexDirection: 'column',
            outline: 'none',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Drag-grabber */}
          <Box sx={{ width: 38, height: 4, bgcolor: 'divider', borderRadius: 2, mx: 'auto', mt: '6px', mb: '12px' }} />

          {/* Header row */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, mb: 1.25 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 16 }}>Friends</Typography>
            <IconButton aria-label="Close" onClick={onClose} sx={{ bgcolor: 'action.hover', width: 28, height: 28 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>

          {/* Tab row */}
          <Box sx={{ mx: 2, mb: 1.5, display: 'flex', gap: 0.5, bgcolor: 'action.hover', borderRadius: 1.25, p: '3px' }}>
            <Box
              component="button"
              role="button"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              sx={{
                flex: 1, textAlign: 'center', py: 0.875, fontSize: 11, fontWeight: 600,
                color: 'primary.main', borderRadius: 1, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                bgcolor: view === 'list' ? 'background.paper' : 'transparent',
                boxShadow: view === 'list' ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}
            >
              Friends · {friends.length}
            </Box>
            <Box
              component="button"
              role="button"
              aria-pressed={view === 'add'}
              onClick={() => setView('add')}
              sx={{
                flex: 1, textAlign: 'center', py: 0.875, fontSize: 11, fontWeight: 600,
                color: 'primary.main', borderRadius: 1, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                bgcolor: view === 'add' ? 'background.paper' : 'transparent',
                boxShadow: view === 'add' ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}
            >
              + Add
            </Box>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2 }}>
            {view === 'list' && (
              <>
                {friends.map((f) => (
                  <FriendRow key={f.userId} name={f.name} seed={f.userId} />
                ))}
                {pendingRequests.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 2, mb: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      Pending requests · {pendingRequests.length}
                    </Typography>
                    {pendingRequests.map((req) => (
                      <FriendRow
                        key={req.id}
                        name={req.friendName}
                        seed={req.fromUserId}
                        action={
                          <Box sx={{ display: 'flex', gap: 0.75 }}>
                            <Button size="small" variant="outlined" onClick={() => onDecline?.(req.fromUserId)} sx={{ fontSize: 10, py: 0.5, px: 1.25, textTransform: 'none', borderRadius: 999 }}>
                              Decline
                            </Button>
                            <Button size="small" variant="contained" color="success" onClick={() => onAccept?.(req.fromUserId)} sx={{ fontSize: 10, py: 0.5, px: 1.25, textTransform: 'none', borderRadius: 999 }}>
                              Accept
                            </Button>
                          </Box>
                        }
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {view === 'add' && (
              <Box>
                <Typography sx={{ fontSize: 12, mb: 1.5, color: 'text.secondary' }}>
                  Send your friend an invite — they'll get an email with a link to join.
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Friend's email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  sx={{ mb: 1.5 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  disabled={!inviteEmail.trim()}
                  onClick={() => { onSendInvite?.(inviteEmail.trim()); setInviteEmail(''); }}
                  sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
                >
                  Send invite
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Slide>
    </Modal>
  );
}
