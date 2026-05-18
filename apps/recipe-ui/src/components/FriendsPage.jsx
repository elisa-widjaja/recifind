import { useEffect, useState } from 'react';
import { Box, Typography, Tabs, Tab, IconButton, Button, Avatar } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
function avatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function FriendsPage({
  friends = [],
  pendingRequests = [],   // incoming requests awaiting user's accept/decline
  sentRequests = [],      // requests user sent, still pending
  sentInvites = [],       // open invites user sent (no recipient yet)
  initialTab,             // 'connections' | 'pending'
  onTapFriend,
  onRemoveFriend,
  onAccept,
  onDecline,
  onCancelSentRequest,
  onCancelInvite,
}) {
  const [tab, setTab] = useState(initialTab || 'connections');

  // If the parent reroutes here with a different initial tab (e.g., user
  // returns via a notification badge), respect that.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const pendingTotal = pendingRequests.length + sentRequests.length + sentInvites.length;

  return (
    <Box sx={{ pb: '80px' /* clearance for the FAB above the bottom nav */ }}>
      {/* Title + tabs share one sticky container so they pin together at
          the top while the list scrolls underneath. Edge-to-edge bg via
          the negative mx so content doesn't show through. */}
      <Box sx={(theme) => ({
        position: 'sticky',
        top: 0,
        zIndex: 5,
        bgcolor: theme.palette.background.default,
        mx: { xs: -2, sm: -3, md: -4 },
        px: { xs: 2, sm: 3, md: 4 },
        // Restore the safe-area padding inside the sticky so the title
        // sits below the notch in both unpinned and pinned states.
        pt: { xs: 'calc(env(safe-area-inset-top) + 16px)', md: 'calc(env(safe-area-inset-top) + 22px)' },
        mb: 2,
        borderBottom: 1,
        borderColor: 'divider',
      })}>
        <Typography sx={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontWeight: 600,
          fontSize: '26px',
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: 'text.primary',
          mb: 2,
        }}>
          Friends
        </Typography>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          textColor="primary"
          indicatorColor="primary"
          sx={(theme) => ({
            minHeight: 44,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: 14,
              minHeight: 44,
              py: 1,
              color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.65)' : 'text.secondary',
              '&.Mui-selected': {
                color: theme.palette.mode === 'dark' ? '#fff' : 'primary.main',
              },
            },
            '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' },
          })}
        >
          <Tab value="connections" label={`My Friends${friends.length ? ` · ${friends.length}` : ''}`} />
          <Tab value="pending" label={`Pending${pendingTotal ? ` · ${pendingTotal}` : ''}`} />
        </Tabs>
      </Box>

      {tab === 'connections' && (
        <ConnectionsList
          friends={friends}
          onTapFriend={onTapFriend}
          onRemoveFriend={onRemoveFriend}
        />
      )}

      {tab === 'pending' && (
        <PendingList
          pendingRequests={pendingRequests}
          sentRequests={sentRequests}
          sentInvites={sentInvites}
          onAccept={onAccept}
          onDecline={onDecline}
          onCancelSentRequest={onCancelSentRequest}
          onCancelInvite={onCancelInvite}
        />
      )}
    </Box>
  );
}

function ConnectionsList({ friends, onTapFriend, onRemoveFriend }) {
  if (friends.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'text.primary', mb: 1 }}>
          No friends yet
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Tap the + button below to invite someone.
        </Typography>
      </Box>
    );
  }
  return (
    <Box>
      {friends.map((f, i) => {
        const name = f.friendName || f.friendEmail || '?';
        const isLast = i === friends.length - 1;
        return (
          <Box
            key={f.friendId}
            onClick={() => onTapFriend?.(f)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              py: 1.5, px: 0,
              borderBottom: isLast ? 0 : 1, borderColor: 'divider',
              cursor: onTapFriend ? 'pointer' : 'default',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Avatar src={f.avatarUrl || undefined} sx={{ bgcolor: avatarColor(f.friendId), width: 40, height: 40, fontSize: 16, fontWeight: 700 }}>
              {name.charAt(0).toUpperCase()}
            </Avatar>
            <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{name}</Typography>
            <IconButton
              edge="end"
              size="small"
              onClick={(e) => { e.stopPropagation(); onRemoveFriend?.(f); }}
              aria-label={`Remove ${name}`}
              sx={{ color: 'text.disabled' }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
    </Box>
  );
}

function PendingList({ pendingRequests, sentRequests, sentInvites, onAccept, onDecline, onCancelSentRequest, onCancelInvite }) {
  const total = pendingRequests.length + sentRequests.length + sentInvites.length;
  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'text.primary', mb: 1 }}>
          No pending requests
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          When someone wants to connect, you'll see them here.
        </Typography>
      </Box>
    );
  }
  return (
    <Box>
      {pendingRequests.length > 0 && (
        <SectionLabel>Incoming · {pendingRequests.length}</SectionLabel>
      )}
      {pendingRequests.map((r, i) => {
        const name = r.fromName || r.friendName || r.fromEmail || '?';
        const isLast = i === pendingRequests.length - 1 && sentRequests.length === 0 && sentInvites.length === 0;
        return (
          <PendingRow
            key={`incoming-${r.fromUserId || r.id}`}
            seed={r.fromUserId || String(r.id)}
            name={name}
            avatarUrl={r.avatarUrl}
            sub="wants to connect"
            isLast={isLast}
            actions={
              <>
                <CircleActionButton
                  variant="decline"
                  ariaLabel={`Decline friend request from ${name}`}
                  onClick={() => onDecline?.(r.fromUserId)}
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </CircleActionButton>
                <CircleActionButton
                  variant="accept"
                  ariaLabel={`Accept friend request from ${name}`}
                  onClick={() => onAccept?.(r.fromUserId)}
                >
                  <CheckIcon sx={{ fontSize: 18 }} />
                </CircleActionButton>
              </>
            }
          />
        );
      })}

      {sentRequests.length > 0 && (
        <SectionLabel sx={{ mt: pendingRequests.length ? 3 : 0 }}>Sent · {sentRequests.length}</SectionLabel>
      )}
      {sentRequests.map((r, i) => {
        const name = r.toName || r.friendName || r.toEmail || '?';
        const isLast = i === sentRequests.length - 1 && sentInvites.length === 0;
        return (
          <PendingRow
            key={`sent-${r.toUserId || r.id}`}
            seed={r.toUserId || String(r.id)}
            name={name}
            avatarUrl={r.avatarUrl}
            sub="awaiting response"
            isLast={isLast}
            actions={
              <Button
                size="small"
                variant="outlined"
                onClick={() => onCancelSentRequest?.(r.toUserId)}
                sx={(theme) => ({
                  borderRadius: 999,
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: 12,
                  py: 0.5, px: 2,
                  // Stronger contrast in dark mode (default outlined is too
                  // faint on true-black). Light mode uses a clearer border too.
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
                  color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary',
                  '&:hover': {
                    borderColor: theme.palette.mode === 'dark' ? '#fff' : 'text.primary',
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  },
                })}
              >
                Cancel
              </Button>
            }
          />
        );
      })}

      {sentInvites.length > 0 && (
        <SectionLabel sx={{ mt: (pendingRequests.length || sentRequests.length) ? 3 : 0 }}>Open invites · {sentInvites.length}</SectionLabel>
      )}
      {sentInvites.map((inv, i) => {
        const name = inv.toEmail || inv.email || 'Open invite';
        const isLast = i === sentInvites.length - 1;
        return (
          <PendingRow
            key={`invite-${inv.id}`}
            seed={String(inv.id)}
            name={name}
            sub="invite link not yet accepted"
            isLast={isLast}
            actions={
              <Button
                size="small"
                variant="outlined"
                onClick={() => onCancelInvite?.(inv.id)}
                sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, fontSize: 12, py: 0.5, px: 1.5 }}
              >
                Cancel
              </Button>
            }
          />
        );
      })}
    </Box>
  );
}

function SectionLabel({ children, sx }) {
  return (
    <Typography sx={{
      fontSize: 11, fontWeight: 700, color: 'text.secondary',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      mb: 1, ...sx,
    }}>
      {children}
    </Typography>
  );
}

// 36px outlined circle action button. variant='decline' = red stroke + red X;
// variant='accept' = green stroke + green check; default (no variant) = grey
// treatment used for the Cancel-style affordance in the Sent / Open invites
// sections. Colors lift to lighter shades in dark mode for contrast on the
// near-black drawer bg.
function CircleActionButton({ ariaLabel, onClick, children, variant }) {
  return (
    <Box
      component="button"
      aria-label={ariaLabel}
      onClick={onClick}
      sx={(theme) => {
        const isDark = theme.palette.mode === 'dark';
        let stroke;
        let hoverBg;
        if (variant === 'decline') {
          // Red — error palette. Lift to error.light in dark for legibility.
          stroke = isDark ? theme.palette.error.light : theme.palette.error.main;
          hoverBg = isDark ? 'rgba(248,113,113,0.12)' : 'rgba(220,38,38,0.08)';
        } else if (variant === 'accept') {
          // Green — success palette.
          stroke = isDark ? theme.palette.success.light : theme.palette.success.main;
          hoverBg = isDark ? 'rgba(74,222,128,0.12)' : 'rgba(22,163,74,0.08)';
        } else {
          stroke = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
          hoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
        }
        return {
          width: 36, height: 36, borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid',
          borderColor: stroke,
          bgcolor: 'transparent',
          color: stroke,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease, color 150ms ease',
          '&:hover': { bgcolor: hoverBg },
          '&:focus-visible': { outline: '2px solid', outlineColor: stroke, outlineOffset: 2 },
          '&:active': { transform: 'scale(0.92)' },
        };
      }}
    >
      {children}
    </Box>
  );
}

function PendingRow({ seed, name, sub, isLast, actions, avatarUrl }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5,
      py: 1.5, px: 0,
      borderBottom: isLast ? 0 : 1, borderColor: 'divider',
    }}>
      <Avatar src={avatarUrl || undefined} sx={{ bgcolor: avatarColor(seed), width: 40, height: 40, fontSize: 16, fontWeight: 700 }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
          {sub}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
        {actions}
      </Box>
    </Box>
  );
}
