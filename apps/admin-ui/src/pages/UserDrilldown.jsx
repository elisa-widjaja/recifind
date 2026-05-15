import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Typography,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import { fetchAdmin } from '../api';

export default function UserDrilldown({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = () => {
    setData(null); setError(null);
    fetchAdmin(`/admin/users/${id}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(reload, [id]);

  if (error) return <Typography color="error">{error}</Typography>;
  if (!data) return <CircularProgress />;

  const p = data.profile;

  return (
    <Box>
      <Button onClick={() => { window.location.hash = '#/users'; }}>← Back to users</Button>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
        <Typography variant="h5">{p.email}</Typography>
        {p.deleted_at && <Chip label="Soft-deleted" color="warning" />}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Signed up {new Date(p.created_at).toLocaleDateString()} · {data.recipes.length} recipes
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Stack direction="row" spacing={4} alignItems="flex-start">
        <Section title={`Recipes (${data.recipes.length})`} sx={{ flex: 1 }}>
          {data.recipes.slice(0, 50).map((r) => (
            <Stack key={r.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <Typography variant="body2">{r.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(r.created_at).toLocaleDateString()}
                {r.hidden_at && ' · hidden'}
              </Typography>
            </Stack>
          ))}
        </Section>

        <Section title={`Cook events (last ${data.cook_events.length})`} sx={{ flex: 1 }}>
          {data.cook_events.map((e, i) => (
            <Typography variant="body2" key={i}>
              {new Date(e.created_at).toLocaleString()} — {e.recipe_id}
            </Typography>
          ))}
        </Section>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Section title={`Invites sent (${data.invites_sent.length})`}>
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
            {data.invites_sent.map((iv) => (
              <TableRow key={iv.to_user_id}>
                <TableCell>{iv.to_email || iv.to_user_id}</TableCell>
                <TableCell>{iv.status}</TableCell>
                <TableCell>{iv.recipe_count}</TableCell>
                <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Pending invites received (${data.pending_received.length})`}>
        {data.pending_received.map((pi, i) => (
          <Typography variant="body2" key={i}>
            {pi.from_email} — sent {new Date(pi.created_at).toLocaleDateString()}
          </Typography>
        ))}
      </Section>
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
