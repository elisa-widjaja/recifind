import { useState } from 'react';
import { Box, Typography, Collapse } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const STEPS = [
  { key: 'recipe', label: 'Add your first recipe' },
  { key: 'invite', label: 'Invite a friend' },
  { key: 'share',  label: 'Share a recipe with a friend' },
];

export default function OnboardingChecklist({ hasRecipe, hasInvitedFriend, hasSharedRecipe, onAddRecipe, onInviteFriend }) {
  // Per-step tap action, only used while the step is incomplete. The 'share'
  // step has no direct entry point (sharing happens from a recipe), so it
  // stays non-interactive.
  const actions = { recipe: onAddRecipe, invite: onInviteFriend, share: null };
  const status = { recipe: !!hasRecipe, invite: !!hasInvitedFriend, share: !!hasSharedRecipe };
  const done = STEPS.filter((s) => status[s.key]).length;
  // Expanded by default until the user has completed 2 of 3 steps; collapsed
  // once they've done 2. `manualExpanded` stays null until the user toggles —
  // while null, `expanded` is derived from the LIVE step count every render,
  // so it stays correct even though hasRecipe/hasInvitedFriend load
  // asynchronously (a useState initializer would freeze the wrong value
  // captured before that data settled). Once the user toggles, their choice
  // holds for the session and resets next session on remount. There is no
  // manual dismiss; the module self-removes at 3/3 (return null below).
  const [manualExpanded, setManualExpanded] = useState(null);
  const expanded = manualExpanded === null ? done < 2 : manualExpanded;

  if (done === STEPS.length) return null;

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      // Same 12px radius in both states.
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
      // Top spacing controlled by a wrapper Box with pt in App.jsx (see
      // feedback_mui_stack_spacing memory — Stack overrides child mt).
      // Bottom spacing lives on the StatsTiles wrapper (pt) for the same
      // reason — child mb on a Stack child composes weirdly with Stack's
      // own margin selector.
      mb: 0,
      transition: 'padding 200ms ease',
    }}>
      {/* Header row: title + count + collapse toggle */}
      <Box
        component="button"
        aria-label={expanded ? 'Collapse checklist' : 'Expand checklist'}
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!expanded)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 1.25,
          border: 'none', bgcolor: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left', p: 0,
        }}
      >
        <Typography sx={(theme) => ({
          fontWeight: 700, fontSize: 14, flex: 1,
          color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary',
        })}>
          Get started
        </Typography>
        <Typography sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main' }}>
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
            const action = !isDone ? actions[step.key] : null;
            const isTappable = typeof action === 'function';
            return (
              <Box key={step.key} data-step={step.key} data-done={isDone ? 'true' : 'false'}
                {...(isTappable ? {
                  component: 'button',
                  type: 'button',
                  'aria-label': step.label,
                  onClick: action,
                } : {})}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75,
                  width: '100%',
                  ...(isTappable ? {
                    border: 'none', bgcolor: 'transparent', cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', px: 0,
                    WebkitTapHighlightColor: 'transparent',
                    '&:hover .checklist-label': { color: 'primary.main' },
                  } : {}),
                }}>
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
                <Typography className="checklist-label" sx={{
                  fontSize: 14,
                  color: isDone ? 'text.disabled' : 'text.primary',
                  textDecoration: isDone ? 'line-through' : 'none',
                  transition: 'color 150ms ease',
                }}>
                  {step.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
}
