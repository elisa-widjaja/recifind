import { Box, Button, List, ListItemButton, ListItemText, Typography } from '@mui/material';

export default function SidebarNav({ email, signOut }) {
  const nav = (path) => () => { window.location.hash = path; };
  return (
    <Box sx={{ width: 220, borderRight: 1, borderColor: 'divider', p: 2 }}>
      <Typography variant="h6" gutterBottom>ReciFriend Admin</Typography>
      <List>
        <ListItemButton onClick={nav('#/')}><ListItemText primary="Dashboard" /></ListItemButton>
        <ListItemButton onClick={nav('#/users')}><ListItemText primary="Users" /></ListItemButton>
        <ListItemButton onClick={nav('#/audit-log')}><ListItemText primary="Audit log" /></ListItemButton>
      </List>
      <Box sx={{ position: 'absolute', bottom: 16, left: 16, fontSize: 12 }}>
        <Typography variant="caption" display="block">{email}</Typography>
        <Button size="small" onClick={signOut}>Sign out</Button>
      </Box>
    </Box>
  );
}
