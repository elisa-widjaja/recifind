import { Drawer, Box, Button, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import TravelExploreOutlinedIcon from '@mui/icons-material/TravelExploreOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';

// Icon per "Try it" destination (tip.action in lib/whatsNew.js).
const ACTION_ICONS = {
  discover: TravelExploreOutlinedIcon,
  friends: PeopleAltOutlinedIcon,
  recipes: LocalOfferOutlinedIcon,
};

// One-time "What's new" bottom sheet. Purely presentational: the show/seen
// logic lives in lib/whatsNew.js and App.jsx decides when it opens. Header
// layout matches ShareSheet / AddFriendDrawer. Copy rule: no em dashes.
export default function WhatsNewSheet({ open, tips, onTry, onClose, darkMode = false }) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
      PaperProps={{
        sx: {
          borderRadius: '16px 16px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          maxHeight: 'calc(100% - env(safe-area-inset-top))',
          ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
        },
      }}
    >
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
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>What's new</Typography>
      </Box>

      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', px: 2, pt: 1, pb: 3, overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {tips.map((tip) => {
            const Icon = ACTION_ICONS[tip.action] || TravelExploreOutlinedIcon;
            return (
              <Box
                key={tip.id}
                sx={(theme) => ({
                  display: 'flex', alignItems: 'flex-start', gap: 1.5,
                  p: 1.5, borderRadius: '12px',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
                })}
              >
                <Box
                  sx={(theme) => ({
                    width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: theme.palette.mode === 'dark' ? '#fff' : theme.palette.primary.main,
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : alpha(theme.palette.primary.main, 0.10),
                  })}
                >
                  <Icon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{tip.title}</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 13.5, lineHeight: 1.35, mt: 0.25 }}>
                    {tip.body}
                  </Typography>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => onTry(tip)}
                    // White in dark mode: the primary purple is hard to read there.
                    sx={(theme) => ({
                      mt: 0.25, ml: -0.75, minWidth: 0, fontWeight: 700, textTransform: 'none',
                      ...(theme.palette.mode === 'dark' ? { color: '#fff' } : {}),
                    })}
                  >
                    Try it
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
        <Button variant="contained" fullWidth onClick={onClose} sx={{ mt: 2.5 }}>
          Got it
        </Button>
      </Box>
    </Drawer>
  );
}
