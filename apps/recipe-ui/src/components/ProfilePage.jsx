import { Box, Typography, Avatar, ToggleButton, ToggleButtonGroup } from '@mui/material';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LogoutIcon from '@mui/icons-material/Logout';

function LineIcon({ d, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      {d}
    </svg>
  );
}

const PencilD = (
  <>
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/>
  </>
);
const CogD = (
  <>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </>
);
const BellD = (
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </>
);
const ChatD = <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>;
const InfoD = (
  <>
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </>
);
const ShieldD = <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>;
const ChevronRightD = <path d="M9 18l6-6-6-6"/>;

function Row({ icon, label, value, onClick, danger }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, width: '100%',
        py: '16px', px: '4px',
        border: 'none', bgcolor: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        color: danger ? 'error.main' : 'text.primary',
      }}
    >
      <Box sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'error.main' : 'text.secondary' }}>
        {icon}
      </Box>
      <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{label}</Typography>
      {value && (
        <Typography sx={{ fontSize: 13, color: 'primary.main', fontWeight: 600 }}>{value}</Typography>
      )}
      {!value && !danger && (
        <Box sx={{ color: 'action.disabled' }}>
          <LineIcon d={ChevronRightD} size={14} />
        </Box>
      )}
    </Box>
  );
}

export default function ProfilePage({
  user,
  themePref,
  onThemeChange,
  onEditName,
  onEditAvatar,
  onEditCookingPrefs,
  onSendFeedback,
  onOpenAbout,
  onPrivacy,
  onSignOut,
  notificationsEnabled,
}) {
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'You';
  const initial = (displayName || 'U').charAt(0).toUpperCase();

  return (
    <Box sx={{ pb: '90px' }}>
      {/* Hero */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1, pb: 2.5 }}>
        <Box sx={{ position: 'relative', mb: 1 }}>
          <Avatar sx={{ width: 72, height: 72, bgcolor: 'primary.main', fontSize: 28, fontWeight: 700 }}>
            {initial}
          </Avatar>
          <Box
            component="button"
            aria-label="Edit avatar"
            onClick={onEditAvatar}
            sx={{
              position: 'absolute', bottom: 0, right: 0,
              width: 24, height: 24, borderRadius: '50%',
              bgcolor: 'background.paper',
              boxShadow: '0 1px 3px rgba(0,0,0,.15)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'primary.main',
            }}
          >
            <LineIcon d={PencilD} size={13} />
          </Box>
        </Box>
        <Box
          component="button"
          onClick={onEditName}
          aria-label="Edit display name"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: 'none', bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{displayName}</Typography>
          <Box sx={{ color: 'action.disabled' }}>
            <LineIcon d={PencilD} size={13} />
          </Box>
        </Box>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{user?.email || ''}</Typography>
      </Box>

      {/* Settings */}
      <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mt: '10px', mb: 0, px: '4px' }}>
        Settings
      </Typography>

      {/* Theme — iOS pill control matching existing drawer */}
      <Box sx={{ py: '14px', px: '4px' }}>
        <ToggleButtonGroup
          value={themePref}
          exclusive
          size="small"
          fullWidth
          onChange={(_, next) => { if (next) onThemeChange(next); }}
          sx={(theme) => ({
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,.24)' : 'rgba(118,118,128,.12)',
            borderRadius: '999px',
            p: '3px',
            '& .MuiToggleButtonGroup-grouped': {
              border: 0, borderRadius: '999px', mx: 0,
              '&:not(:first-of-type)': { borderLeft: 0, borderRadius: '999px' },
              '&:first-of-type': { borderRadius: '999px' },
            },
            '& .MuiToggleButton-root': {
              py: 0.75, gap: 0.5, fontSize: 12, fontWeight: 500,
              textTransform: 'none', color: 'text.primary',
            },
            '& .Mui-selected': {
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(99,99,102,1)' : '#fff !important',
              color: 'text.primary',
              boxShadow: theme.palette.mode === 'dark' ? 'none' : '0 3px 8px rgba(0,0,0,.12), 0 3px 1px rgba(0,0,0,.04)',
            },
          })}
        >
          <ToggleButton value="system"><SettingsBrightnessOutlinedIcon sx={{ fontSize: 16 }} />System</ToggleButton>
          <ToggleButton value="light"><LightModeOutlinedIcon sx={{ fontSize: 16 }} />Light</ToggleButton>
          <ToggleButton value="dark"><DarkModeOutlinedIcon sx={{ fontSize: 16 }} />Dark</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Row icon={<LineIcon d={CogD} size={20} />} label="Cooking preferences" onClick={onEditCookingPrefs} />
      <Row icon={<LineIcon d={BellD} size={20} />} label="Notifications" value={notificationsEnabled ? 'On' : 'Off'} onClick={() => {}} />
      <Row icon={<LineIcon d={ChatD} size={20} />} label="Send feedback" onClick={onSendFeedback} />
      <Row icon={<LineIcon d={InfoD} size={20} />} label="About" onClick={onOpenAbout} />
      <Row icon={<LineIcon d={ShieldD} size={20} />} label="Privacy" onClick={onPrivacy} />

      <Box sx={{ mt: 2 }}>
        <Row icon={<LogoutIcon sx={{ fontSize: 20 }} />} label="Sign out" onClick={onSignOut} danger />
      </Box>
    </Box>
  );
}
