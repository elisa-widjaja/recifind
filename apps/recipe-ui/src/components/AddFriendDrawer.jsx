import { Drawer, Box, Typography, CircularProgress } from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import SuggestionsShelf from './SuggestionsShelf';

// Bottom-sheet drawer triggered by the "+ Add Friend" FAB on FriendsPage.
// Hosts the existing share-link invite UI (Email / Text / Copy link) plus
// the suggestions shelf. iOS-style X close button on the top LEFT.
export default function AddFriendDrawer({
  open,
  onClose,
  loading,
  inviteToken,
  accessToken,
  onTapSuggestion,
  // Each handler corresponds to one of the share methods. They receive the
  // current invite token (or null if none yet) and should generate one if
  // missing before performing their share action. We keep the per-method
  // logic in the parent so the existing trackEvent + clipboard / mailto /
  // sms flows stay co-located with their state.
  onShareEmail,
  onShareText,
  onShareCopyLink,
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      transitionDuration={{ enter: 225, exit: 225 }}
      ModalProps={{
        disableAutoFocus: true,
        disableEnforceFocus: true,
        disableRestoreFocus: true,
        BackdropProps: { transitionDuration: 225 },
      }}
      SlideProps={{ appear: true }}
      PaperProps={{
        sx: (theme) => ({
          width: '100%',
          // Match the friend-recipes drawer: fixed height (smoother slide
          // than `height: auto`, which animates the computed content height
          // and feels jerky), 16px corners, and the same near-black bg.
          height: 'calc(85dvh + 20px)',
          borderRadius: '16px 16px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          bgcolor: theme.palette.mode === 'dark' ? '#212328' : 'background.paper',
          ...(theme.palette.mode === 'dark' ? {
            backgroundImage: 'none',
            color: 'rgba(255,255,255,0.86)',
          } : null),
          willChange: 'transform',
          transform: 'translateZ(0)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }),
      }}
    >
      {/* Header: X on the LEFT, title centered. X position matches the
          friend-recipes drawer (left: 16px, top: 20px → vertical center at
          38px from drawer top). Header pt set so the title's vertical center
          lands at the same 38px point. */}
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', px: '24px', pt: '26px', pb: '16px', flexShrink: 0 }}>
        <Box sx={{ position: 'absolute', left: '16px', top: '20px' }}>
          <Box
            component="button"
            aria-label="Close"
            onClick={onClose}
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
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>Add Friends</Typography>
      </Box>

      {/* Body */}
      <Box sx={{ px: '24px', pb: '24px', overflowY: 'auto', flex: 1 }}>
        <Typography sx={{ mt: '10px', mb: 2.5, textAlign: 'center', fontWeight: 700, fontSize: 13, color: 'text.primary' }}>
          Share a link with friends to connect
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mb: 3 }}>
              <ShareTile
                icon={<EmailOutlinedIcon sx={{ fontSize: 26 }} />}
                label="Email"
                onClick={() => onShareEmail?.(inviteToken)}
              />
              <ShareTile
                icon={<SmsOutlinedIcon sx={{ fontSize: 26 }} />}
                label="Text"
                onClick={() => onShareText?.(inviteToken)}
              />
              <ShareTile
                icon={<ContentCopyIcon sx={{ fontSize: 26 }} />}
                label="Copy link"
                onClick={() => onShareCopyLink?.(inviteToken)}
              />
            </Box>

            <Box sx={{ mt: 0, mb: 3, borderTop: 1, borderColor: 'divider' }} />
            <SuggestionsShelf accessToken={accessToken} variant="compact" onTapCard={onTapSuggestion} />
          </>
        )}
      </Box>
    </Drawer>
  );
}

function ShareTile({ icon, label, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={(theme) => ({
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
        width: 88, height: 88, borderRadius: 3,
        border: 'none', cursor: 'pointer',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        color: 'inherit',
        fontFamily: 'inherit',
        WebkitTapHighlightColor: 'transparent',
        '&:active': { opacity: 0.7 },
        transition: 'opacity 0.15s',
      })}
    >
      {icon}
      <Typography variant="caption" sx={{ fontWeight: 500 }}>{label}</Typography>
    </Box>
  );
}
