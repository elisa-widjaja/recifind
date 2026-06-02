import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';

// Two-step App Store review prompt. Step 1 gauges sentiment; a happy user goes
// to step 2 (the App Store ask), an unhappy one is routed to the feedback form.
// Presentational only — all gating/persistence lives in the caller.
export default function ReviewPrompt({ open, step, onYes, onNot, onRate, onLater, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {step === 'sentiment' ? (
        <>
          <DialogTitle sx={{ fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>Enjoying ReciFriend?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 14 }}>
              We'd love to know how it's going so far.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'center' }}>
            <Button onClick={onNot} sx={{ textTransform: 'none' }}>Not really</Button>
            <Button onClick={onYes} variant="contained" sx={{ textTransform: 'none', fontWeight: 600, minWidth: 104, px: 3 }}>Yes!</Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle sx={{ fontWeight: 700, fontSize: 18 }}>Glad you're enjoying it!</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 14 }}>
              Mind leaving a rating on the App Store? It takes a few seconds and really helps.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', gap: 1, '& > :not(:first-of-type)': { ml: 0 } }}>
            <Button onClick={onRate} variant="contained" fullWidth sx={{ textTransform: 'none', fontWeight: 600 }}>Rate ReciFriend</Button>
            <Button onClick={onLater} fullWidth sx={{ textTransform: 'none' }}>Maybe later</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
