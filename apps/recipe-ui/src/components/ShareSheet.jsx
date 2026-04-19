import { Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Box } from '@mui/material';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';

export function ShareSheet({ open, onClose, onPickFriends, onPickConnections }) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 'env(safe-area-inset-bottom)',
          },
        },
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', py: 1 }}>
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={onPickFriends} sx={{ py: 2 }}>
              <ListItemIcon><IosShareOutlinedIcon /></ListItemIcon>
              <ListItemText
                primary="Share with Friends"
                secondary="via SMS, email, or other apps"
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={onPickConnections} sx={{ py: 2 }}>
              <ListItemIcon><GroupOutlinedIcon /></ListItemIcon>
              <ListItemText
                primary="Share with Connections"
                secondary="pick from your ReciFriend friends"
              />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Drawer>
  );
}
