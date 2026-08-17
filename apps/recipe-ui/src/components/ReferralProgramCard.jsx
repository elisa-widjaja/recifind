import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import badgeIcon from '../assets/founding-chef.png';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');

// Founding Chef program card. Copy rule: no em dashes in any user-facing text.
export default function ReferralProgramCard({ accessToken }) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!accessToken || !API_BASE_URL) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/friends/referral-progress`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data) setProgress(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  // Bail unless the payload has the expected shape — there's no ErrorBoundary
  // in this app, so a malformed 200 body must not white-screen the page.
  if (!progress?.threshold || progress.foundingChefAt) return null; // hidden once earned

  const slots = Array.from({ length: progress.threshold.friends }, (_, i) => progress.friends[i] || null);

  return (
    <Box sx={(theme) => ({
      borderRadius: 3, p: 1.5, mb: 2.5,
      bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.75 }}>
        <Box component="img" src={badgeIcon} alt="" sx={{ width: 28, height: 28 }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Become a Founding Chef</Typography>
      </Box>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: slots.some(Boolean) ? 1.25 : 0 }}>
        Invite 3 friends who each save 5 recipes and earn a gift card.
      </Typography>
      {slots.some(Boolean) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {slots.map((f, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {f && f.qualified
                ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
              <Typography sx={{ fontSize: 13 }}>
                {f
                  ? `${f.name}: ${f.savesCount} of ${progress.threshold.recipes} recipes`
                  : 'Invite a friend'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
