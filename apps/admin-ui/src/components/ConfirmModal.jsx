import { useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography } from '@mui/material';

export default function ConfirmModal({ open, title, body, confirmLabel = 'Confirm', destructive = false, onConfirm, onClose }) {
  const [sure, setSure] = useState(false);
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{body}</Typography>
        <FormControlLabel
          control={<Checkbox checked={sure} onChange={(e) => setSure(e.target.checked)} />}
          label="I'm sure"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color={destructive ? 'error' : 'primary'}
          variant="contained"
          disabled={!sure}
          onClick={() => { setSure(false); onConfirm(); }}
        >{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
