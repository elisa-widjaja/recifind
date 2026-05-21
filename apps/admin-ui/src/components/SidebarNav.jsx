import { Box, Button, Drawer, List, ListItemButton, ListItemText, Toolbar, Typography } from '@mui/material';

export const DRAWER_WIDTH = 220;

export default function SidebarNav({ open, email, signOut }) {
  const nav = (path) => () => { window.location.hash = path; };
  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
      }}
    >
      <Toolbar />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <List>
          <ListItemButton onClick={nav('#/')}><ListItemText primary="Dashboard" /></ListItemButton>
          <ListItemButton onClick={nav('#/users')}><ListItemText primary="Users" /></ListItemButton>
          <ListItemButton onClick={nav('#/audit-log')}><ListItemText primary="Audit log" /></ListItemButton>
        </List>
        <Box sx={{ mt: 'auto', fontSize: 12 }}>
          <Typography variant="caption" display="block">{email}</Typography>
          <Button size="small" onClick={signOut}>Sign out</Button>
        </Box>
      </Box>
    </Drawer>
  );
}
