import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Typography,
  Table, TableHead, TableRow, TableCell, TableBody,
  Menu, MenuItem, Snackbar, IconButton, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ConfirmModal from '../components/ConfirmModal';
import { fetchAdmin } from '../api';

const truncateTitle = (s) => {
  const t = s || '';
  return t.length > 35 ? t.slice(0, 35) + '…' : t;
};

export default function UserDrilldown({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = () => {
    setData(null); setError(null);
    fetchAdmin(`/admin/users/${id}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(reload, [id]);

  const [anchor, setAnchor] = useState(null);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind, recipeId?, title? }
  const [editName, setEditName] = useState({ open: false, value: '' });
  const [magicLink, setMagicLink] = useState({ open: false, url: '' });

  const post = (path, body) =>
    fetchAdmin(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const patch = (path, body) =>
    fetchAdmin(path, { method: 'PATCH', body: JSON.stringify(body) });
  const del = (path) => fetchAdmin(path, { method: 'DELETE' });

  const doResend = (inviteId) =>
    post(`/admin/users/${id}/resend-invite`, { inviteId })
      .then(() => { setToast('Invite resent'); reload(); })
      .catch((e) => setToast(`Resend failed: ${e.message}`));
  const doForceAccept = (inviteId) =>
    post(`/admin/users/${id}/force-accept`, { inviteId })
      .then(() => { setToast('Force-accepted'); reload(); })
      .catch((e) => setToast(`Force-accept failed: ${e.message}`));
  const doMagicLink = () =>
    post(`/admin/users/${id}/magic-link`, {})
      .then((r) => setMagicLink({ open: true, url: r.url }))
      .catch((e) => setToast(`Magic link failed: ${e.message}`));
  const doEditName = () =>
    patch(`/admin/users/${id}`, { display_name: editName.value })
      .then(() => { setEditName({ open: false, value: '' }); setToast('Name updated'); reload(); })
      .catch((e) => setToast(`Edit failed: ${e.message}`));
  const doSoftDelete = () =>
    del(`/admin/users/${id}`).then(() => { setToast('Soft-deleted'); reload(); })
      .catch((e) => setToast(`Delete failed: ${e.message}`));
  const doHideRecipe = (rid) =>
    post(`/admin/recipes/${rid}/hide`, {}).then(() => { setToast('Recipe hidden'); reload(); })
      .catch((e) => setToast(`Hide failed: ${e.message}`));
  const doUnhideRecipe = (rid) =>
    post(`/admin/recipes/${rid}/unhide`, {}).then(() => { setToast('Recipe unhidden'); reload(); })
      .catch((e) => setToast(`Unhide failed: ${e.message}`));

  if (error) return <Typography color="error">{error}</Typography>;
  if (!data) return <CircularProgress />;

  const p = data.profile;

  return (
    <Box>
      <Button onClick={() => { window.location.hash = '#/users'; }}>← Back to users</Button>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
        <Typography variant="h5">{p.email}</Typography>
        {p.deleted_at && <Chip label="Soft-deleted" color="warning" />}
        <IconButton onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon /></IconButton>
        <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => { setAnchor(null); setEditName({ open: true, value: p.display_name || '' }); }}>
            Edit display name
          </MenuItem>
          <MenuItem onClick={() => { setAnchor(null); doMagicLink(); }}>
            Send magic link
          </MenuItem>
          <MenuItem onClick={() => { setAnchor(null); setConfirm({ kind: 'soft_delete' }); }}
            sx={{ color: 'error.main' }}>
            Soft-delete account
          </MenuItem>
        </Menu>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Signed up {new Date(p.created_at).toLocaleDateString()} · {data.recipes.length} recipes
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Section title="Invite conversions">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {data.invite_link
            ? `Invite link active · ${data.invite_conversions.length} conversion${data.invite_conversions.length === 1 ? '' : 's'} · link created ${new Date(data.invite_link.created_at).toLocaleDateString()}`
            : 'No invite link generated'}
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invitee</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Recipes</TableCell>
              <TableCell>Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.invite_conversions.map((iv, i) => (
              <TableRow key={iv.invitee_user_id || i}>
                <TableCell>
                  {iv.invitee_email || iv.invitee_name || '(email unavailable)'}
                  {iv.invitee_deleted_at && (
                    <Typography component="span" variant="caption" color="text.secondary"> · deleted</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {iv.status === 'accepted_disconnected' ? (
                    <Typography component="span" variant="body2" color="text.secondary">accepted · disconnected</Typography>
                  ) : (
                    iv.status
                  )}
                </TableCell>
                <TableCell>{iv.invitee_recipe_count}</TableCell>
                <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Pending invites received (${data.pending_received.length})`}>
        {data.pending_received.map((pi, i) => (
          <Stack key={i} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
            <Typography variant="body2">
              {pi.from_email} — sent {new Date(pi.created_at).toLocaleDateString()}
            </Typography>
            <Button size="small" onClick={() => doForceAccept(pi.from_user_id)}>Force-accept</Button>
          </Stack>
        ))}
      </Section>

      <Divider sx={{ my: 3 }} />

      <Section title={`Recipes (${data.recipes.length})`}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Recipe</TableCell>
              <TableCell>Date</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.recipes.slice(0, 50).map((r) => (
              <TableRow key={r.id}>
                <TableCell title={r.title}>
                  {truncateTitle(r.title)}{r.hidden_at && ' · hidden'}
                </TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell align="right">
                  {!r.hidden_at ? (
                    <Button size="small" onClick={() => setConfirm({ kind: 'hide_recipe', recipeId: r.id, title: r.title })}>Hide</Button>
                  ) : (
                    <Button size="small" color="primary" onClick={() => doUnhideRecipe(r.id)}>Unhide</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Cook events (last ${data.cook_events.length})`}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Recipe</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.cook_events.map((e, i) => (
              <TableRow key={i}>
                <TableCell title={e.recipe_title || e.recipe_id}>
                  {e.recipe_title ? truncateTitle(e.recipe_title) : '(deleted recipe)'}
                </TableCell>
                <TableCell>{new Date(e.created_at).toLocaleDateString()}</TableCell>
                <TableCell>{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <ConfirmModal
        open={confirm?.kind === 'soft_delete'}
        title="Soft-delete this account?"
        body={`User: ${p.email}. They will be hidden from feeds and friend lists immediately. Recipes preserved. Reversible by clearing profiles.deleted_at in D1.`}
        destructive
        confirmLabel="Soft-delete"
        onConfirm={() => { doSoftDelete(); setConfirm(null); }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm?.kind === 'hide_recipe'}
        title={`Hide recipe "${confirm?.title}"?`}
        body="This recipe will be hidden from public landing and friend feeds. Owner can still see it. Reversible by clearing recipes.hidden_at in D1."
        destructive
        confirmLabel="Hide"
        onConfirm={() => { doHideRecipe(confirm.recipeId); setConfirm(null); }}
        onClose={() => setConfirm(null)}
      />
      <Dialog open={editName.open} onClose={() => setEditName({ ...editName, open: false })}>
        <DialogTitle>Edit display name</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth value={editName.value}
            onChange={(e) => setEditName({ ...editName, value: e.target.value })} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditName({ open: false, value: '' })}>Cancel</Button>
          <Button variant="contained" onClick={doEditName}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={magicLink.open} onClose={() => setMagicLink({ open: false, url: '' })}>
        <DialogTitle>Magic link</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }} variant="body2">
            Send this URL to the user. It logs them in directly.
          </Typography>
          <TextField fullWidth value={magicLink.url} InputProps={{ readOnly: true }}
            onClick={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { navigator.clipboard.writeText(magicLink.url); setToast('Copied'); }}>Copy</Button>
          <Button onClick={() => setMagicLink({ open: false, url: '' })}>Close</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}

function Section({ title, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2, ...sx }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      {children}
    </Paper>
  );
}
