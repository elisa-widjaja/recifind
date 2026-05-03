import { useState } from 'react';
import { Box, Typography, Collapse } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const STEPS = [
  { key: 'recipe', label: 'Add your first recipe' },
  { key: 'invite', label: 'Invite a friend' },
  { key: 'share',  label: 'Share a recipe with a friend' },
];

export default function OnboardingChecklist({ hasRecipe, hasInvitedFriend, hasSharedRecipe, onDismiss }) {
  const status = { recipe: !!hasRecipe, invite: !!hasInvitedFriend, share: !!hasSharedRecipe };
  const done = STEPS.filter((s) => status[s.key]).length;
  const [expanded, setExpanded] = useState(true);

  if (done === STEPS.length) return null;

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      borderRadius: '12px',
      px: 2.5,
      // pt stays constant so the header doesn't shift when toggling.
      // Set to match the collapsed pb (1.5) so the collapsed pill is
      // symmetric. Expanded pb stays larger to give the steps room below.
      pt: 1.5,
      pb: expanded ? 2.5 : 1.5,
      border: '2px solid',
      borderColor: 'rgba(124,58,237,0.10)',
      boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      mb: '100px',
      transition: 'padding 200ms ease',
    }}>
      {/* Header row: title + count + collapse toggle */}
      <Box
        component="button"
        aria-label={expanded ? 'Collapse checklist' : 'Expand checklist'}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 1.25,
          border: 'none', bgcolor: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left', p: 0,
        }}
      >
        <Typography sx={(theme) => ({
          fontWeight: 700, fontSize: 16, flex: 1,
          color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary',
        })}>
          Get started
        </Typography>
        <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'primary.main' }}>
          {done} of {STEPS.length}
        </Typography>
        <ExpandMoreIcon
          sx={{
            fontSize: 22,
            color: 'text.secondary',
            transition: 'transform 200ms ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
      </Box>

      <Collapse in={expanded} timeout={220} unmountOnExit={false}>
        <Box sx={{ mt: 1.5 }}>
          {STEPS.map((step) => {
            const isDone = status[step.key];
            return (
              <Box key={step.key} data-step={step.key} data-done={isDone ? 'true' : 'false'}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
                <Box sx={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  border: '1.5px solid',
                  borderColor: isDone ? 'primary.main' : 'divider',
                  bgcolor: isDone ? 'primary.main' : 'transparent',
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isDone && <CheckIcon sx={{ fontSize: 14 }} />}
                </Box>
                <Typography sx={{
                  fontSize: 14,
                  color: isDone ? 'text.disabled' : 'text.primary',
                  textDecoration: isDone ? 'line-through' : 'none',
                }}>
                  {step.label}
                </Typography>
              </Box>
            );
          })}
          {onDismiss && (
            <Box
              component="button"
              aria-label="Dismiss checklist"
              onClick={onDismiss}
              sx={{
                mt: 1, p: 0,
                border: 'none', bgcolor: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
                fontSize: 13, fontWeight: 500,
                color: 'text.secondary',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                alignSelf: 'flex-start',
                '&:hover': { color: 'text.primary' },
              }}
            >
              Dismiss
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
