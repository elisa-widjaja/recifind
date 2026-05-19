import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Collapse, Divider, Link, Paper, Stack, Typography,
  Table, TableHead, TableRow, TableCell, TableBody,
  Menu, MenuItem, Snackbar, IconButton, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
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
  const [showInvitees, setShowInvitees] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);
  const [showCookEvents, setShowCookEvents] = useState(false);

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
        <Typography variant="h5">{p.display_name || p.email}</Typography>
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
        {p.display_name ? `${p.email} · ` : ''}Signed up {new Date(p.created_at).toLocaleDateString()} · {data.recipes.length} recipes
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Section title="Invite conversions" titleVariant="h6" titleSx={{ mb: 1.5 }}>
        {(() => {
          const convs = data.invite_conversions;
          const THIRTY_D = 30 * 24 * 60 * 60 * 1000;
          const isActivated = (iv) =>
            iv.invitee_recipe_count >= 1 &&
            !iv.invitee_deleted_at &&
            !!iv.last_sign_in_at &&
            Date.now() - new Date(iv.last_sign_in_at).getTime() <= THIRTY_D;
          const joined = convs.length;
          const active = convs.filter(isActivated).length;
          const rate = joined ? `${Math.round((active / joined) * 100)}%` : '—';
          const Metric = ({ value, label }) => (
            <Stack alignItems="center" sx={{ minWidth: 72 }}>
              <Typography variant="h4">{value}</Typography>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Stack>
          );
          return (
            <>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                <Stack direction="row" spacing={4}>
                  <Metric value={joined} label="Joined" />
                  <Metric value={active} label="Active" />
                  <Metric value={rate} label="Activated" />
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                {joined > 0 && (
                  <IconButton
                    onClick={() => setShowInvitees((v) => !v)}
                    aria-label={showInvitees ? 'Hide invitees' : 'Show invitees'}
                  >
                    {showInvitees
                      ? <KeyboardArrowUpIcon sx={{ fontSize: 44 }} />
                      : <KeyboardArrowDownIcon sx={{ fontSize: 44 }} />}
                  </IconButton>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {data.invite_link
                  ? `via invite link · created ${new Date(data.invite_link.created_at).toLocaleDateString()}`
                  : 'No invite link generated'}
              </Typography>
              {joined === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No one has joined via this link yet.
                </Typography>
              ) : (
                <>
                  <Collapse in={showInvitees} unmountOnExit>
                    <Table size="small" sx={{ mt: 1 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 28 }} />
                          <TableCell>Invitee</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Recipes</TableCell>
                          <TableCell>Last seen</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {convs.map((iv, i) => {
                          const act = isActivated(iv);
                          return (
                            <TableRow key={iv.invitee_user_id || i}>
                              <TableCell
                                title={act ? 'Active (≥1 recipe & signed in within 30d)' : 'Inactive'}
                                sx={{ color: act ? 'success.light' : 'text.disabled' }}
                              >
                                {act ? '●' : '○'}
                              </TableCell>
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
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Collapse>
                </>
              )}
            </>
          );
        })()}
      </Section>

      <Section title="Pending invites received" titleVariant="h6" titleSx={{ mb: 1.5 }}>
        {(() => {
          const pend = data.pending_received;
          const count = pend.length;
          return (
            <>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                <Stack alignItems="center" sx={{ minWidth: 72 }}>
                  <Typography variant="h4">{count}</Typography>
                  <Typography variant="caption" color="text.secondary">Pending</Typography>
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                {count > 0 && (
                  <IconButton
                    onClick={() => setShowPending((v) => !v)}
                    aria-label={showPending ? 'Hide pending invites' : 'Show pending invites'}
                  >
                    {showPending
                      ? <KeyboardArrowUpIcon sx={{ fontSize: 44 }} />
                      : <KeyboardArrowDownIcon sx={{ fontSize: 44 }} />}
                  </IconButton>
                )}
              </Stack>
              {count === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No pending invites received.
                </Typography>
              ) : (
                <Collapse in={showPending} unmountOnExit>
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Email</TableCell>
                        <TableCell>Sent</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pend.map((pi, i) => (
                        <TableRow key={i}>
                          <TableCell>{pi.from_email}</TableCell>
                          <TableCell>{new Date(pi.created_at).toLocaleDateString()}</TableCell>
                          <TableCell align="right">
                            <Button size="small" onClick={() => doForceAccept(pi.from_user_id)}>Force-accept</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Collapse>
              )}
            </>
          );
        })()}
      </Section>

      <Divider sx={{ my: 3 }} />

      <Section title="Recipes" titleVariant="h6" titleSx={{ mb: 1.5 }}>
        {(() => {
          const recipes = data.recipes;
          const count = recipes.length;
          return (
            <>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                <Stack alignItems="center" sx={{ minWidth: 72 }}>
                  <Typography variant="h4">{count}</Typography>
                  <Typography variant="caption" color="text.secondary">Recipes</Typography>
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                {count > 0 && (
                  <IconButton
                    onClick={() => setShowRecipes((v) => !v)}
                    aria-label={showRecipes ? 'Hide recipes' : 'Show recipes'}
                  >
                    {showRecipes
                      ? <KeyboardArrowUpIcon sx={{ fontSize: 44 }} />
                      : <KeyboardArrowDownIcon sx={{ fontSize: 44 }} />}
                  </IconButton>
                )}
              </Stack>
              {count === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No recipes.
                </Typography>
              ) : (
                <Collapse in={showRecipes} unmountOnExit>
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Recipe</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recipes.slice(0, 50).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell title={r.title}>
                            {r.source_url ? (
                              <Link href={r.source_url} target="_blank" rel="noopener noreferrer">
                                {truncateTitle(r.title)}
                              </Link>
                            ) : (
                              truncateTitle(r.title)
                            )}
                            {r.hidden_at && ' · hidden'}
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
                </Collapse>
              )}
            </>
          );
        })()}
      </Section>

      <Section title="Cook events" titleVariant="h6" titleSx={{ mb: 1.5 }}>
        {(() => {
          const events = data.cook_events;
          const count = events.length;
          return (
            <>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                <Stack alignItems="center" sx={{ minWidth: 72 }}>
                  <Typography variant="h4">{count}</Typography>
                  <Typography variant="caption" color="text.secondary">Cook events</Typography>
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                {count > 0 && (
                  <IconButton
                    onClick={() => setShowCookEvents((v) => !v)}
                    aria-label={showCookEvents ? 'Hide cook events' : 'Show cook events'}
                  >
                    {showCookEvents
                      ? <KeyboardArrowUpIcon sx={{ fontSize: 44 }} />
                      : <KeyboardArrowDownIcon sx={{ fontSize: 44 }} />}
                  </IconButton>
                )}
              </Stack>
              {count === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No cook events.
                </Typography>
              ) : (
                <Collapse in={showCookEvents} unmountOnExit>
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Recipe</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Time</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {events.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell title={e.recipe_title}>
                            {e.recipe_source_url ? (
                              <Link href={e.recipe_source_url} target="_blank" rel="noopener noreferrer">
                                {truncateTitle(e.recipe_title)}
                              </Link>
                            ) : (
                              truncateTitle(e.recipe_title)
                            )}
                          </TableCell>
                          <TableCell>{new Date(e.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Collapse>
              )}
            </>
          );
        })()}
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

function Section({ title, children, sx, titleVariant = 'subtitle2', titleSx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2, ...sx }}>
      <Typography variant={titleVariant} sx={{ mb: 1, ...titleSx }}>{title}</Typography>
      {children}
    </Paper>
  );
}
