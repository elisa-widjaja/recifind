import { useEffect, useState } from 'react';
import { Box, Table, TableHead, TableRow, TableCell, TableBody, TextField, Typography, MenuItem, Select } from '@mui/material';
import { fetchAdmin } from '../api';

const ACTIONS = ['', 'resend_invite', 'resend_invite_failed', 'force_accept', 'generate_magic_link', 'edit_profile', 'soft_delete_user', 'hide_recipe'];

export default function AuditLog() {
  const [data, setData] = useState({ entries: [] });
  const [adminEmail, setAdminEmail] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (adminEmail) params.set('adminEmail', adminEmail);
    if (action) params.set('action', action);
    fetchAdmin(`/admin/audit-log?${params.toString()}`).then(setData).catch(() => setData({ entries: [] }));
  }, [adminEmail, action]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Audit log</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" placeholder="Admin email" value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)} />
        <Select size="small" value={action} onChange={(e) => setAction(e.target.value)} displayEmpty>
          {ACTIONS.map((a) => <MenuItem key={a} value={a}>{a || 'All actions'}</MenuItem>)}
        </Select>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Admin</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Target user</TableCell>
            <TableCell>Target recipe</TableCell>
            <TableCell>Payload</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{new Date(e.created_at).toLocaleString()}</TableCell>
              <TableCell>{e.admin_email}</TableCell>
              <TableCell>{e.action}</TableCell>
              <TableCell>{e.target_user_id || '—'}</TableCell>
              <TableCell>{e.target_recipe_id || '—'}</TableCell>
              <TableCell><code style={{ fontSize: 11 }}>{e.payload || ''}</code></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
