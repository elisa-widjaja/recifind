import { Box, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const STEPS = [
  { key: 'recipe', label: 'Add your first recipe' },
  { key: 'invite', label: 'Invite a friend' },
  { key: 'save',   label: "Save a friend's recipe" },
];

export default function OnboardingChecklist({ hasRecipe, hasInvitedFriend, hasSavedFriendRecipe }) {
  const status = { recipe: !!hasRecipe, invite: !!hasInvitedFriend, save: !!hasSavedFriendRecipe };
  const done = STEPS.filter((s) => status[s.key]).length;

  if (done === STEPS.length) return null;

  const pct = Math.round((done / STEPS.length) * 100);

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      borderRadius: 2,
      p: 1.5,
      border: '2px solid',
      borderColor: 'rgba(124,58,237,0.10)',
      boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      mb: 2,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 12 }}>Get started</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main' }}>{done} of {STEPS.length}</Typography>
      </Box>

      {STEPS.map((step) => {
        const isDone = status[step.key];
        return (
          <Box key={step.key} data-step={step.key} data-done={isDone ? 'true' : 'false'}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, fontSize: 11 }}>
            <Box sx={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
              border: '1.5px solid',
              borderColor: isDone ? 'success.main' : 'divider',
              bgcolor: isDone ? 'success.main' : 'transparent',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isDone && <CheckIcon sx={{ fontSize: 11 }} />}
            </Box>
            <Typography sx={{
              fontSize: 11,
              color: isDone ? 'text.disabled' : 'text.primary',
              textDecoration: isDone ? 'line-through' : 'none',
            }}>
              {step.label}
            </Typography>
          </Box>
        );
      })}

      <Box sx={{ bgcolor: 'rgba(124,58,237,0.10)', height: 4, borderRadius: 2, mt: 1, overflow: 'hidden' }}>
        <Box sx={{ bgcolor: 'primary.main', height: '100%', width: `${pct}%`, transition: 'width 250ms ease' }} />
      </Box>
    </Box>
  );
}
