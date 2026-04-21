import { Drawer, Box, Typography } from '@mui/material';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';

// Matches the "Friends" SVG in the hamburger drawer (inline Feather "users" icon).
function ConnectionsIcon({ size = 30, style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function ShareSheet({ open, onClose, onPickFriends, onPickConnections, darkMode = false }) {
  const tiles = [
    { icon: <IosShareOutlinedIcon sx={{ fontSize: 26 }} />, label: 'Friends', onClick: onPickFriends },
    { icon: <ConnectionsIcon size={28} />, label: 'Connections', onClick: onPickConnections },
  ];
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
          ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5, pb: 1, flexShrink: 0 }}>
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: darkMode ? 'rgba(255,255,255,0.3)' : 'grey.300', mb: 1.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Share with</Typography>
      </Box>
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', px: 2, pt: 2, pb: 3 }}>
        <Box sx={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
          {tiles.map(({ icon, label, onClick }) => (
            <Box
              key={label}
              onClick={onClick}
              sx={(theme) => ({
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                width: 120, height: 120, borderRadius: 3, cursor: 'pointer',
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                '&:active': { opacity: 0.7 },
                transition: 'opacity 0.15s',
              })}
            >
              {/* Fixed-height icon box with bottom alignment so icon bottoms
                  line up across tiles regardless of icon glyph size. */}
              <Box sx={{ height: 32, display: 'flex', alignItems: 'flex-end' }}>
                {icon}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                {label.split(' ').map((word) => (
                  <Typography key={word} sx={{ fontWeight: 500, fontSize: '0.8125rem', lineHeight: 1.15 }}>{word}</Typography>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Drawer>
  );
}
