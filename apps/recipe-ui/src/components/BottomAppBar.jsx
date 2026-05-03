import { Box, Badge, Typography } from '@mui/material';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'friends', label: 'Friends' },
  { id: 'discover', label: 'Discover' },
];

const NAV_HEIGHT = 64;
const FAB_SIZE = 56;
const FAB_PROTRUSION = 28;

function HomeIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="22" height="22"
      style={{ opacity: active ? 1 : 0.55 }}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>
    </svg>
  );
}
function RecipesIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="22" height="22"
      style={{ opacity: active ? 1 : 0.55 }}>
      <path d="M4 7h16M4 12h16M4 17h10"/>
    </svg>
  );
}
function FriendsIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="22" height="22"
      style={{ opacity: active ? 1 : 0.55 }}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function DiscoverIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="22" height="22"
      style={{ opacity: active ? 1 : 0.55 }}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M16 8l-3 5-5 3 3-5z"/>
    </svg>
  );
}
const ICONS = { home: HomeIcon, recipes: RecipesIcon, friends: FriendsIcon, discover: DiscoverIcon };

export default function BottomAppBar({ activeTab, onTabChange, onAddClick, pendingFriendCount = 0 }) {
  return (
    <Box
      role="navigation"
      aria-label="Primary"
      sx={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        height: `${NAV_HEIGHT}px`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        px: 0.75,
        py: 1,
      }}
    >
      {/* Left half: Home, Recipes */}
      {TABS.slice(0, 2).map((tab) => {
        const Icon = ICONS[tab.id];
        const active = activeTab === tab.id;
        return (
          <Box
            key={tab.id}
            component="button"
            role="button"
            aria-selected={active}
            aria-label={tab.label}
            onClick={() => onTabChange(tab.id)}
            sx={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', pt: '4px',
              border: 'none', bgcolor: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit',
              color: active ? 'primary.main' : 'text.primary',
            }}
          >
            <Icon active={active} />
            <Typography sx={{ fontSize: 9, fontWeight: 600, color: active ? 'primary.main' : 'text.disabled' }}>
              {tab.label}
            </Typography>
          </Box>
        );
      })}

      {/* Center spacer (the floating FAB sits here) */}
      <Box sx={{ flex: 1 }} aria-hidden />

      {/* Right half: Friends, Discover */}
      {TABS.slice(2).map((tab) => {
        const Icon = ICONS[tab.id];
        const active = activeTab === tab.id;
        const showBadge = tab.id === 'friends' && pendingFriendCount > 0;
        return (
          <Box
            key={tab.id}
            component="button"
            role="button"
            aria-selected={active}
            aria-label={tab.label}
            onClick={() => onTabChange(tab.id)}
            sx={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', pt: '4px', position: 'relative',
              border: 'none', bgcolor: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit',
              color: active ? 'primary.main' : 'text.primary',
            }}
          >
            {showBadge ? (
              <Badge
                badgeContent={pendingFriendCount}
                color="error"
                aria-label={`${pendingFriendCount} pending friend requests`}
                sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 14, minWidth: 14, padding: '0 4px' } }}
              >
                <Icon active={active} />
              </Badge>
            ) : (
              <Icon active={active} />
            )}
            <Typography sx={{ fontSize: 9, fontWeight: 600, color: active ? 'primary.main' : 'text.disabled' }}>
              {tab.label}
            </Typography>
          </Box>
        );
      })}

      {/* The center FAB — absolutely positioned on the parent; bar provides the slot */}
      <Box
        component="button"
        role="button"
        aria-label="Add recipe"
        onClick={onAddClick}
        sx={{
          position: 'absolute',
          bottom: `calc(${NAV_HEIGHT - FAB_PROTRUSION}px + env(safe-area-inset-bottom))`,
          left: '50%',
          transform: 'translateX(-50%)',
          width: FAB_SIZE, height: FAB_SIZE,
          borderRadius: '50%',
          background: 'linear-gradient(180deg, #8b5cf6, #7c3aed)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '4px solid',
          borderColor: 'background.paper',
          boxShadow: '0 8px 18px rgba(124,58,237,.45), 0 2px 6px rgba(0,0,0,.12)',
          fontSize: 30, fontWeight: 300, lineHeight: 1,
          cursor: 'pointer',
          zIndex: 1101,
          fontFamily: 'inherit',
        }}
      >
        +
      </Box>
    </Box>
  );
}
