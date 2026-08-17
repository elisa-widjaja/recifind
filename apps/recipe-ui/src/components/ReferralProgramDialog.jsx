import { Box, Button, Dialog, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import badgeIcon from '../assets/founding-chef.png';

// Founding Chef program dialog: milestone re-surfacing variant of
// ReferralProgramCard. Content mirrors the card exactly. Copy rule: no em
// dashes in any user-facing text.
export default function ReferralProgramDialog({ open, progress, onInvite, onDismiss }) {
  const threshold = progress?.threshold || { friends: 3, recipes: 5 };
  const friends = progress?.friends || [];
  const slots = Array.from({ length: threshold.friends }, (_, i) => friends[i] || null);

  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      PaperProps={{
        sx: (theme) => ({
          borderRadius: '16px',
          p: 3.5,
          maxWidth: 360,
          ...(theme.palette.mode === 'dark' ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
        }),
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Box component="img" src={badgeIcon} alt="" sx={{ width: 40, height: 40 }} />
        <Typography sx={{ fontWeight: 700, fontSize: 16, textAlign: 'center' }}>Become a Founding Chef</Typography>
      </Box>
      <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', mb: slots.some(Boolean) ? 3 : 3 }}>
        Invite 3 friends who each save 5 recipes and earn a gift card.
      </Typography>
      {slots.some(Boolean) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 3 }}>
          {slots.map((f, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {f && f.qualified
                ? <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                : <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: 'text.disabled' }} />}
              <Typography sx={{ fontSize: 14 }}>
                {f
                  ? `${f.name}: ${f.savesCount} of ${threshold.recipes} recipes`
                  : 'Invite a friend'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Button variant="contained" onClick={onInvite} fullWidth>
          Invite friends
        </Button>
        <Button variant="text" onClick={onDismiss} fullWidth>
          Maybe later
        </Button>
      </Box>
    </Dialog>
  );
}
