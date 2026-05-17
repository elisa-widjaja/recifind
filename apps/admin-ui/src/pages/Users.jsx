import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, MenuItem, Select, TextField, Typography,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress
} from '@mui/material';
import {
  useReactTable, getCoreRowModel, flexRender,
} from '@tanstack/react-table';
import { fetchAdmin } from '../api';

const RECIPE_BUCKETS = [
  { v: '', label: 'All recipes' },
  { v: '0', label: '0' },
  { v: '1-9', label: '1–9' },
  { v: '10-19', label: '10–19' },
  { v: '20-49', label: '20–49' },
  { v: '50+', label: '50+' },
];
const ACTIVITY_OPTIONS = [
  { v: '', label: 'All activity' },
  { v: 'active', label: 'Active' },
  { v: 'inactive', label: 'Inactive' },
  { v: 'ghost', label: 'Signup-only ghost' },
  { v: 'soft_deleted', label: 'Soft-deleted' },
];
const SIGNUP_OPTIONS = [
  { v: '', label: 'All time' },
  { v: '1', label: 'Today' },
  { v: '7', label: 'Last 7d' },
  { v: '30', label: 'Last 30d' },
  { v: '90', label: 'Last 90d' },
];

const PAGE_SIZE = 50;

export default function Users() {
  const [search, setSearch] = useState('');
  const [recipeBucket, setRecipeBucket] = useState('');
  const [activity, setActivity] = useState('');
  const [signupDays, setSignupDays] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ users: [], page: { returned: 0, has_more: false } });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    if (search) params.set('search', search);
    if (recipeBucket) params.set('recipeBucket', recipeBucket);
    if (activity) params.set('activity', activity);
    if (signupDays) {
      const after = new Date(Date.now() - Number(signupDays) * 86400000).toISOString();
      params.set('signupAfter', after);
    }
    fetchAdmin(`/admin/users?${params.toString()}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [search, recipeBucket, activity, signupDays, page]);

  const columns = useMemo(() => [
    { accessorKey: 'email', header: 'Email', cell: (i) => i.getValue() },
    { accessorKey: 'signed_up_at', header: 'Signed up',
      cell: (i) => new Date(i.getValue()).toLocaleDateString() },
    { accessorKey: 'recipe_count', header: 'Recipes', cell: (i) => i.getValue() },
    { accessorKey: 'invites_accepted', header: 'Friends', cell: (i) => i.getValue() },
    { accessorKey: 'invites_sent', header: 'Sent', cell: (i) => i.getValue() },
    {
      id: 'active',
      header: 'Active',
      cell: (i) => (
        <Box
          component="span"
          title={i.row.original.is_active ? 'Active (≥1 recipe & signed in within 30d)' : 'Inactive'}
          sx={{
            color: i.row.original.is_active ? 'success.light' : 'text.disabled',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          {i.row.original.is_active ? '●' : '○'}
        </Box>
      ),
    },
  ], []);

  const table = useReactTable({
    data: data.users, columns, getCoreRowModel: getCoreRowModel(),
  });

  const exportCsv = () => {
    const params = new URLSearchParams();
    params.set('limit', '5000');
    if (search) params.set('search', search);
    if (recipeBucket) params.set('recipeBucket', recipeBucket);
    if (activity) params.set('activity', activity);
    if (signupDays) {
      const after = new Date(Date.now() - Number(signupDays) * 86400000).toISOString();
      params.set('signupAfter', after);
    }
    fetchAdmin(`/admin/users?${params.toString()}`).then((all) => {
      const headers = ['email', 'signed_up_at', 'recipe_count', 'invites_sent', 'invites_accepted', 'is_active'];
      const rows = all.users.map((u) => headers.map((h) => JSON.stringify(u[h] ?? '')).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `recifriend-users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Users</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Search email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <Select size="small" value={recipeBucket} onChange={(e) => { setRecipeBucket(e.target.value); setPage(0); }}>
          {RECIPE_BUCKETS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Select size="small" value={activity} onChange={(e) => { setActivity(e.target.value); setPage(0); }}>
          {ACTIVITY_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Select size="small" value={signupDays} onChange={(e) => { setSignupDays(e.target.value); setPage(0); }}>
          {SIGNUP_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={exportCsv}>Export CSV</Button>
      </Box>

      {loading && <CircularProgress size={20} />}

      <Table size="small">
        <TableHead>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableCell key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} hover sx={{ cursor: 'pointer' }}
              onClick={() => { window.location.hash = `#/users/${row.original.id}`; }}>
              {row.getVisibleCells().map((c) => (
                <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
        <Typography>Page {page + 1}</Typography>
        <Button disabled={!data.page.has_more} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </Box>
    </Box>
  );
}
