import { Dialog, DialogContent, Box, Typography, Button, Stack } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const STEPS = [
  {
    label: 'Add your first recipe',
    sub: 'Share directly from social media reels or copy and paste a URL.',
  },
  {
    label: 'Invite a friend',
    sub: "See your friends' recipes and what they are cooking.",
  },
  {
    label: 'Share a recipe with a friend',
    sub: "Send a recipe you love so it shows up in their feed.",
  },
];

/**
 * Bridge dialog shown after the OnboardingFlow completes (or is dismissed).
 * Surfaces the same "Get started" checklist that lives on Home, framed as a
 * one-shot welcome panel. The "Get started" button closes the dialog and
 * lands the user on Home with the checklist rendered collapsed (App.jsx
 * sets the sessionStorage flag the OnboardingChecklist reads).
 */
export default function GetStartedDialog({ open, onGetStarted }) {
  return (
    <Dialog
      open={open}
      onClose={() => {}}
      disableEscapeKeyDown
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          // More pillowy than the MUI default to match the rest of the app.
          borderRadius: '24px',
          overflow: 'hidden',
          bgcolor: 'background.paper',
        },
      }}
    >
      <DialogContent sx={{ p: '32px 28px 28px' }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1.2, mb: 1 }}>
          You're all set
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 3 }}>
          Three quick wins to get the most out of ReciFriend.
        </Typography>

        <Stack spacing={2} sx={{ mb: 4 }}>
          {STEPS.map((step, i) => (
            <Box key={step.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box
                sx={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  border: '1.5px solid', borderColor: 'divider',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'text.secondary',
                  fontSize: 12, fontWeight: 700,
                  mt: '1px',
                }}
              >
                {i + 1}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
                  {step.label}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
                  {step.sub}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>

        <Button
          fullWidth
          variant="contained"
          onClick={onGetStarted}
          sx={{
            borderRadius: 999,
            textTransform: 'none',
            fontWeight: 700,
            py: 1.25,
            fontSize: 15,
          }}
        >
          Get started
        </Button>
      </DialogContent>
    </Dialog>
  );
}
