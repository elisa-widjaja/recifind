import { Box, Badge, Typography } from '@mui/material';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'friends', label: 'Friends' },
  { id: 'discover', label: 'Discover' },
  { id: 'profile', label: 'Profile' },
];

const NAV_HEIGHT = 64;

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
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>
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
// Profile: filled circle with the user's initial. Larger than the other
// tab icons since this tab has no text label below it (the avatar fills
// the icon-plus-label vertical slot).
function ProfileIcon({ initial, avatarUrl }) {
  // Always full opacity / primary color so the avatar reads as
  // "you" (not as a disabled tab icon) regardless of active state.
  // Render the user's uploaded image when present; fall back to a
  // primary-colored circle with their first-letter initial.
  if (avatarUrl) {
    return (
      <Box
        component="img"
        src={avatarUrl}
        alt=""
        sx={{
          width: 30, height: 30, borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    );
  }
  return (
    <Box
      sx={{
        width: 30, height: 30, borderRadius: '50%',
        bgcolor: 'primary.main',
        color: '#fff',
        fontSize: 13, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}
    >
      {(initial || 'U').charAt(0).toUpperCase()}
    </Box>
  );
}
const ICONS = { home: HomeIcon, recipes: RecipesIcon, friends: FriendsIcon, discover: DiscoverIcon, profile: ProfileIcon };

export default function BottomAppBar({ activeTab, onTabChange, pendingFriendCount = 0, profileInitial, profileAvatarUrl }) {
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
      {TABS.map((tab) => {
        const Icon = ICONS[tab.id];
        const active = activeTab === tab.id;
        const showBadge = tab.id === 'friends' && pendingFriendCount > 0;
        const isProfile = tab.id === 'profile';
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
              justifyContent: 'center',
              gap: '3px', pt: '4px', position: 'relative',
              border: 'none', bgcolor: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit',
              color: active ? 'primary.main' : 'text.primary',
              // No tap-highlight background in any theme; the icon-only scale
              // below provides all the press feedback.
              WebkitTapHighlightColor: 'transparent',
              '&:focus': { outline: 'none' },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-4px', borderRadius: '6px' },
              // Scale only the icon wrap (not the label) when the tab is
              // pressed. Smooth ease-out on the way back.
              '&:active .bn-icon': { transform: 'scale(0.88)' },
            }}
          >
            <Box
              className="bn-icon"
              sx={{
                display: 'inline-flex',
                transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                willChange: 'transform',
              }}
            >
              {showBadge ? (
                <Badge
                  badgeContent={pendingFriendCount}
                  color="error"
                  aria-label={`${pendingFriendCount} pending friend requests`}
                  sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 14, minWidth: 14, padding: '0 4px' } }}
                >
                  <Icon active={active} initial={profileInitial} avatarUrl={profileAvatarUrl} />
                </Badge>
              ) : (
                <Icon active={active} initial={profileInitial} avatarUrl={profileAvatarUrl} />
              )}
            </Box>
            {!isProfile && (
              <Typography sx={{ fontSize: 9, fontWeight: 600, color: active ? 'primary.main' : 'text.disabled' }}>
                {tab.label}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
