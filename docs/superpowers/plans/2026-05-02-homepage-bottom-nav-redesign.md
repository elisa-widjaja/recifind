# Homepage Redesign + Bottom App Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User preference (memory: feedback_no_autocommit):** Do NOT run `git commit` without explicit user go-ahead. Treat every "Commit" step in this plan as **"Stage the change, show the diff, ASK the user before committing."**

**Goal:** Replace the hamburger drawer with a 5-slot bottom app bar (Home / Recipes / + FAB / Friends / Discover) and a Profile page reached via the header avatar. Move Editor's Picks and Trending Health off Home and PublicLanding into a new Discover tab. Add an onboarding checklist for new users. Pin Cook with Friends at the bottom of Home.

**Architecture:** New presentation-only components (`BottomAppBar`, `ProfilePage`, `FriendsSheet`, `DiscoverPage`, `OnboardingChecklist`) are added first in isolation with their own tests. Then `App.jsx` is rewired in a single phase: extend `currentView` to `'discover' | 'profile'`, mount `BottomAppBar`, route the FAB to `openAddDialog`, route the avatar to Profile, replace the friends Dialog with `FriendsSheet`, and delete the entire hamburger `Drawer`. Finally `RecipesPage`, `FriendSections`, and `PublicLanding` are trimmed/relocated to match.

**Tech Stack:** React 18 + Vite + MUI v5; tests are Vitest + @testing-library/react. iOS deployment via Capacitor. Existing endpoints (`/public/trending-recipes`, `/public/discover`, `/public/editors-pick`, `/public/ai-picks`, `/friends/activity`, `/friends/recently-saved`, `/friends/recently-shared`) are reused unchanged.

---

## File Structure

**New files:**

- `apps/recipe-ui/src/components/BottomAppBar.jsx` — 5-slot bottom nav with center FAB
- `apps/recipe-ui/src/components/BottomAppBar.test.jsx`
- `apps/recipe-ui/src/components/ProfilePage.jsx` — Profile shell (theme, prefs link, notifications, feedback, about, sign out)
- `apps/recipe-ui/src/components/ProfilePage.test.jsx`
- `apps/recipe-ui/src/components/FriendsSheet.jsx` — full-page slide-up sheet replacing the friends Dialog
- `apps/recipe-ui/src/components/FriendsSheet.test.jsx`
- `apps/recipe-ui/src/components/DiscoverPage.jsx` — 4 discovery sections (Trending Now / Watch & Cook / Editor's Picks / Trending Health)
- `apps/recipe-ui/src/components/DiscoverPage.test.jsx`
- `apps/recipe-ui/src/components/OnboardingChecklist.jsx` — 3-step new-user checklist
- `apps/recipe-ui/src/components/OnboardingChecklist.test.jsx`

**Modified files:**

- `apps/recipe-ui/src/App.jsx` — extensive (bottom nav mounting, FAB, avatar header, hamburger removal, currentView extension, friends sheet wiring)
- `apps/recipe-ui/src/components/FriendSections.jsx` — collapse 3 shelves into one "From your friends"; remove Editor's Picks and Trending Health rendering
- `apps/recipe-ui/src/components/PublicLanding.jsx` — remove Editor's Picks and Trending Health
- `apps/recipe-ui/src/RecipesPage.jsx` — inline meal-type chip row + favorites heart in header

**Reused (unchanged):**

- `apps/recipe-ui/src/components/RecipeShelf.jsx`
- `apps/recipe-ui/src/components/RecipeListCard.jsx`
- `apps/recipe-ui/src/components/DiscoverRecipes.jsx`
- `apps/recipe-ui/src/components/TrendingHealthCarouselB.jsx`
- `apps/recipe-ui/src/components/SuggestionsShelf.jsx`
- `apps/recipe-ui/src/components/FriendSections.jsx` → `CookWithFriends` and `CwfTicker` (pinned at bottom of Home; component itself untouched)
- `apps/recipe-ui/src/components/OnboardingFlow.jsx` (entry from Profile → Cooking preferences)

---

## Phase 0 — Pre-flight

### Task 0.1: Tag the revert point and verify baseline tests pass

**Files:** none modified — repo metadata only.

- [ ] **Step 1: Tag current HEAD as the revert anchor**

```bash
git tag testflight-build-6 91b7061
```

If the tag already exists, skip — verify `git rev-parse testflight-build-6` returns `91b7061`.

- [ ] **Step 2: Run the existing test suite to confirm a green baseline**

```bash
cd apps/recipe-ui && npm test
```

Expected: all tests pass. Note any pre-existing failures — don't introduce new ones, but don't try to fix unrelated failures inside this plan.

- [ ] **Step 3: Run the worker test suite to confirm a green baseline**

```bash
cd apps/worker && npm test
```

Expected: all tests pass.

- [ ] **Step 4: ASK the user before tagging is pushed (only if they're using a remote tag)**

Local tag is fine for revert. Pushing to origin requires:
```bash
git push origin testflight-build-6
```
**Wait for user explicit instruction.**

---

## Phase 1 — New components (no integration yet)

Each component is built standalone with tests, then committed (with user approval). Nothing in `App.jsx` is touched in this phase. After Phase 1 the app behaves exactly as today; the new files just exist on disk.

### Task 1.1: BottomAppBar — write the failing test

**Files:**
- Test (Create): `apps/recipe-ui/src/components/BottomAppBar.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/recipe-ui/src/components/BottomAppBar.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BottomAppBar from './BottomAppBar';

describe('BottomAppBar', () => {
  const defaultProps = {
    activeTab: 'home',
    onTabChange: vi.fn(),
    onAddClick: vi.fn(),
    pendingFriendCount: 0,
  };

  it('renders all five tab labels', () => {
    render(<BottomAppBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recipes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /friends/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discover/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add recipe/i })).toBeInTheDocument();
  });

  it('marks the active tab as aria-selected', () => {
    render(<BottomAppBar {...defaultProps} activeTab="recipes" />);
    expect(screen.getByRole('button', { name: /recipes/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /home/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with the tab id when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<BottomAppBar {...defaultProps} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('button', { name: /discover/i }));
    expect(onTabChange).toHaveBeenCalledWith('discover');
  });

  it('calls onAddClick when the FAB is tapped', () => {
    const onAddClick = vi.fn();
    render(<BottomAppBar {...defaultProps} onAddClick={onAddClick} />);
    fireEvent.click(screen.getByRole('button', { name: /add recipe/i }));
    expect(onAddClick).toHaveBeenCalled();
  });

  it('shows a pending-request badge on the Friends tab when pendingFriendCount > 0', () => {
    render(<BottomAppBar {...defaultProps} pendingFriendCount={3} />);
    expect(screen.getByLabelText(/3 pending friend requests/i)).toBeInTheDocument();
  });

  it('hides the pending badge when pendingFriendCount === 0', () => {
    render(<BottomAppBar {...defaultProps} pendingFriendCount={0} />);
    expect(screen.queryByLabelText(/pending friend requests/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/recipe-ui && npx vitest run src/components/BottomAppBar.test.jsx
```

Expected: FAIL — `Cannot find module './BottomAppBar'`.

### Task 1.2: BottomAppBar — implement

**Files:**
- Create: `apps/recipe-ui/src/components/BottomAppBar.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/recipe-ui/src/components/BottomAppBar.jsx
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
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd apps/recipe-ui && npx vitest run src/components/BottomAppBar.test.jsx
```

Expected: PASS (all 6 tests).

- [ ] **Step 3: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/BottomAppBar.jsx \
        apps/recipe-ui/src/components/BottomAppBar.test.jsx
git status
git diff --cached
```

Show the diff and ask the user. **Do not commit until they say so.**

When approved:
```bash
git commit -m "feat(ui): BottomAppBar component (5 slots + center FAB)"
```

### Task 1.3: ProfilePage — write the failing test

**Files:**
- Test (Create): `apps/recipe-ui/src/components/ProfilePage.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/recipe-ui/src/components/ProfilePage.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfilePage from './ProfilePage';

const baseProps = {
  user: { displayName: 'Elisa Widjaja', email: 'elisa@example.com' },
  themePref: 'system',
  onThemeChange: vi.fn(),
  onEditName: vi.fn(),
  onEditAvatar: vi.fn(),
  onEditCookingPrefs: vi.fn(),
  onSendFeedback: vi.fn(),
  onOpenAbout: vi.fn(),
  onSignOut: vi.fn(),
  notificationsEnabled: true,
};

describe('ProfilePage', () => {
  it('renders the user display name and email', () => {
    render(<ProfilePage {...baseProps} />);
    expect(screen.getByText('Elisa Widjaja')).toBeInTheDocument();
    expect(screen.getByText('elisa@example.com')).toBeInTheDocument();
  });

  it('falls back to email username when displayName is empty', () => {
    render(<ProfilePage {...baseProps} user={{ email: 'foo@example.com' }} />);
    expect(screen.getByText('foo')).toBeInTheDocument();
  });

  it('renders all six setting/more rows', () => {
    render(<ProfilePage {...baseProps} />);
    expect(screen.getByText(/cooking preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/send feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/about/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('shows the active theme as selected in the segmented control', () => {
    render(<ProfilePage {...baseProps} themePref="dark" />);
    expect(screen.getByRole('button', { name: /dark/i, pressed: true })).toBeInTheDocument();
  });

  it('calls onThemeChange("light") when Light is clicked', () => {
    const onThemeChange = vi.fn();
    render(<ProfilePage {...baseProps} onThemeChange={onThemeChange} themePref="system" />);
    fireEvent.click(screen.getByRole('button', { name: /light/i }));
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('calls onSignOut when Sign out is clicked', () => {
    const onSignOut = vi.fn();
    render(<ProfilePage {...baseProps} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('calls onEditCookingPrefs when Cooking preferences row is clicked', () => {
    const onEditCookingPrefs = vi.fn();
    render(<ProfilePage {...baseProps} onEditCookingPrefs={onEditCookingPrefs} />);
    fireEvent.click(screen.getByText(/cooking preferences/i));
    expect(onEditCookingPrefs).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd apps/recipe-ui && npx vitest run src/components/ProfilePage.test.jsx
```

Expected: FAIL — `Cannot find module './ProfilePage'`.

### Task 1.4: ProfilePage — implement

**Files:**
- Create: `apps/recipe-ui/src/components/ProfilePage.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/recipe-ui/src/components/ProfilePage.jsx
import { Box, Typography, Avatar, ToggleButton, ToggleButtonGroup, Divider } from '@mui/material';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LogoutIcon from '@mui/icons-material/Logout';

// Inline SVG stroke style to match existing app drawer (stroke=2, currentColor, round caps)
function LineIcon({ d, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      {d}
    </svg>
  );
}
const PencilD = (
  <>
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/>
  </>
);
const CogD = (
  <>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </>
);
const BellD = (
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </>
);
const ChatD = <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>;
const InfoD = (
  <>
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </>
);
const ChevronRightD = <path d="M9 18l6-6-6-6"/>;

function Row({ icon, label, value, onClick, danger }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, width: '100%',
        py: '11px', px: '4px',
        border: 'none', bgcolor: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        color: danger ? 'error.main' : 'text.primary',
        borderBottom: 1, borderColor: 'divider',
      }}
    >
      <Box sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'error.main' : 'text.secondary' }}>
        {icon}
      </Box>
      <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{label}</Typography>
      {value && (
        <Typography sx={{ fontSize: 10, color: 'primary.main', fontWeight: 600 }}>{value}</Typography>
      )}
      {!value && !danger && (
        <Box sx={{ color: 'action.disabled' }}>
          <LineIcon d={ChevronRightD} size={14} />
        </Box>
      )}
    </Box>
  );
}

export default function ProfilePage({
  user,
  themePref,
  onThemeChange,
  onEditName,
  onEditAvatar,
  onEditCookingPrefs,
  onSendFeedback,
  onOpenAbout,
  onSignOut,
  notificationsEnabled,
}) {
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'You';
  const initial = (displayName || 'U').charAt(0).toUpperCase();

  return (
    <Box sx={{ pb: '90px' /* leave room for bottom nav */ }}>
      {/* Hero */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1, pb: 2.5 }}>
        <Box sx={{ position: 'relative', mb: 1 }}>
          <Avatar sx={{ width: 72, height: 72, bgcolor: 'primary.main', fontSize: 28, fontWeight: 700 }}>
            {initial}
          </Avatar>
          <Box
            component="button"
            aria-label="Edit avatar"
            onClick={onEditAvatar}
            sx={{
              position: 'absolute', bottom: 0, right: 0,
              width: 24, height: 24, borderRadius: '50%',
              bgcolor: 'background.paper',
              boxShadow: '0 1px 3px rgba(0,0,0,.15)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'primary.main',
            }}
          >
            <LineIcon d={PencilD} size={13} />
          </Box>
        </Box>
        <Box
          component="button"
          onClick={onEditName}
          aria-label="Edit display name"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: 'none', bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{displayName}</Typography>
          <Box sx={{ color: 'action.disabled' }}>
            <LineIcon d={PencilD} size={13} />
          </Box>
        </Box>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{user?.email || ''}</Typography>
      </Box>

      {/* Settings */}
      <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1, px: '4px' }}>
        Settings
      </Typography>

      {/* Theme — iOS pill control matching existing drawer */}
      <Box sx={{ py: '11px', px: '4px', borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.75 }}>Theme</Typography>
        <ToggleButtonGroup
          value={themePref}
          exclusive
          size="small"
          fullWidth
          onChange={(_, next) => { if (next) onThemeChange(next); }}
          sx={(theme) => ({
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(118,118,128,.24)' : 'rgba(118,118,128,.12)',
            borderRadius: '999px',
            p: '3px',
            '& .MuiToggleButtonGroup-grouped': {
              border: 0, borderRadius: '999px', mx: 0,
              '&:not(:first-of-type)': { borderLeft: 0, borderRadius: '999px' },
              '&:first-of-type': { borderRadius: '999px' },
            },
            '& .MuiToggleButton-root': {
              py: 0.75, gap: 0.5, fontSize: 12, fontWeight: 500,
              textTransform: 'none', color: 'text.primary',
            },
            '& .Mui-selected': {
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(99,99,102,1)' : '#fff !important',
              color: 'text.primary',
              boxShadow: theme.palette.mode === 'dark' ? 'none' : '0 3px 8px rgba(0,0,0,.12), 0 3px 1px rgba(0,0,0,.04)',
            },
          })}
        >
          <ToggleButton value="system"><SettingsBrightnessOutlinedIcon sx={{ fontSize: 16 }} />System</ToggleButton>
          <ToggleButton value="light"><LightModeOutlinedIcon sx={{ fontSize: 16 }} />Light</ToggleButton>
          <ToggleButton value="dark"><DarkModeOutlinedIcon sx={{ fontSize: 16 }} />Dark</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Row icon={<LineIcon d={CogD} size={20} />} label="Cooking preferences" onClick={onEditCookingPrefs} />
      <Row icon={<LineIcon d={BellD} size={20} />} label="Notifications" value={notificationsEnabled ? 'On' : 'Off'} onClick={() => {}} />

      <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mt: 2, mb: 1, px: '4px' }}>
        More
      </Typography>

      <Row icon={<LineIcon d={ChatD} size={20} />} label="Send feedback" onClick={onSendFeedback} />
      <Row icon={<LineIcon d={InfoD} size={20} />} label="About" onClick={onOpenAbout} />

      <Box sx={{ mt: 2 }}>
        <Row icon={<LogoutIcon sx={{ fontSize: 20 }} />} label="Sign out" onClick={onSignOut} danger />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Run the test**

```bash
cd apps/recipe-ui && npx vitest run src/components/ProfilePage.test.jsx
```

Expected: PASS (7 tests).

- [ ] **Step 3: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/ProfilePage.jsx \
        apps/recipe-ui/src/components/ProfilePage.test.jsx
git diff --cached
```

Show the user. When approved:
```bash
git commit -m "feat(ui): ProfilePage shell (theme, prefs, notifications, sign out)"
```

### Task 1.5: FriendsSheet — write the failing test

**Files:**
- Test (Create): `apps/recipe-ui/src/components/FriendsSheet.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/recipe-ui/src/components/FriendsSheet.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FriendsSheet from './FriendsSheet';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  initialView: 'list',
  friends: [
    { userId: 'u1', name: 'Henny' },
    { userId: 'u2', name: 'Max' },
  ],
  pendingRequests: [],
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onSendInvite: vi.fn(),
};

describe('FriendsSheet', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<FriendsSheet {...baseProps} open={false} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the friends list with count when open', () => {
    render(<FriendsSheet {...baseProps} />);
    expect(screen.getByText(/friends · 2/i)).toBeInTheDocument();
    expect(screen.getByText('Henny')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });

  it('calls onClose when the X button is tapped', () => {
    const onClose = vi.fn();
    render(<FriendsSheet {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Add view when + Add tab is clicked', () => {
    render(<FriendsSheet {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('starts on Add view when initialView="add"', () => {
    render(<FriendsSheet {...baseProps} initialView="add" />);
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('renders pending requests with Accept and Decline buttons', () => {
    const pending = [{ id: 1, fromUserId: 'p1', friendName: 'James' }];
    render(<FriendsSheet {...baseProps} pendingRequests={pending} />);
    expect(screen.getByText('James')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd apps/recipe-ui && npx vitest run src/components/FriendsSheet.test.jsx
```

Expected: FAIL — module not found.

### Task 1.6: FriendsSheet — implement

**Files:**
- Create: `apps/recipe-ui/src/components/FriendsSheet.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/recipe-ui/src/components/FriendsSheet.jsx
import { useState, useEffect } from 'react';
import { Modal, Box, Typography, IconButton, TextField, Button, Slide } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function FriendRow({ name, seed, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: avatarColor(seed),
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, flexShrink: 0,
      }}>
        {name.charAt(0).toUpperCase()}
      </Box>
      <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{name}</Typography>
      {action}
    </Box>
  );
}

export default function FriendsSheet({
  open,
  onClose,
  initialView = 'list',
  friends = [],
  pendingRequests = [],
  onAccept,
  onDecline,
  onSendInvite,
}) {
  const [view, setView] = useState(initialView);
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => { if (open) setView(initialView); }, [open, initialView]);

  return (
    <Modal open={open} onClose={onClose} aria-label="Friends sheet">
      <Slide in={open} direction="up" mountOnEnter unmountOnExit>
        <Box
          role="dialog"
          sx={{
            position: 'fixed',
            left: 0, right: 0, bottom: 0,
            top: '8%',
            bgcolor: 'background.paper',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            boxShadow: '0 -10px 30px rgba(0,0,0,.2)',
            display: 'flex', flexDirection: 'column',
            outline: 'none',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Drag-grabber */}
          <Box sx={{ width: 38, height: 4, bgcolor: 'divider', borderRadius: 2, mx: 'auto', mt: '6px', mb: '12px' }} />

          {/* Header row */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, mb: 1.25 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 16 }}>Friends</Typography>
            <IconButton aria-label="Close" onClick={onClose} sx={{ bgcolor: 'action.hover', width: 28, height: 28 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>

          {/* Tab row */}
          <Box sx={{ mx: 2, mb: 1.5, display: 'flex', gap: 0.5, bgcolor: 'action.hover', borderRadius: 1.25, p: '3px' }}>
            <Box
              component="button"
              role="button"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              sx={{
                flex: 1, textAlign: 'center', py: 0.875, fontSize: 11, fontWeight: 600,
                color: 'primary.main', borderRadius: 1, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                bgcolor: view === 'list' ? 'background.paper' : 'transparent',
                boxShadow: view === 'list' ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}
            >
              Friends · {friends.length}
            </Box>
            <Box
              component="button"
              role="button"
              aria-pressed={view === 'add'}
              onClick={() => setView('add')}
              sx={{
                flex: 1, textAlign: 'center', py: 0.875, fontSize: 11, fontWeight: 600,
                color: 'primary.main', borderRadius: 1, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                bgcolor: view === 'add' ? 'background.paper' : 'transparent',
                boxShadow: view === 'add' ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}
            >
              + Add
            </Box>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2 }}>
            {view === 'list' && (
              <>
                {friends.map((f) => (
                  <FriendRow key={f.userId} name={f.name} seed={f.userId} />
                ))}
                {pendingRequests.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 2, mb: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      Pending requests · {pendingRequests.length}
                    </Typography>
                    {pendingRequests.map((req) => (
                      <FriendRow
                        key={req.id}
                        name={req.friendName}
                        seed={req.fromUserId}
                        action={
                          <Box sx={{ display: 'flex', gap: 0.75 }}>
                            <Button size="small" variant="outlined" onClick={() => onDecline?.(req.fromUserId)} sx={{ fontSize: 10, py: 0.5, px: 1.25, textTransform: 'none', borderRadius: 999 }}>
                              Decline
                            </Button>
                            <Button size="small" variant="contained" color="success" onClick={() => onAccept?.(req.fromUserId)} sx={{ fontSize: 10, py: 0.5, px: 1.25, textTransform: 'none', borderRadius: 999 }}>
                              Accept
                            </Button>
                          </Box>
                        }
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {view === 'add' && (
              <Box>
                <Typography sx={{ fontSize: 12, mb: 1.5, color: 'text.secondary' }}>
                  Send your friend an invite — they'll get an email with a link to join.
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Friend's email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  sx={{ mb: 1.5 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  disabled={!inviteEmail.trim()}
                  onClick={() => { onSendInvite?.(inviteEmail.trim()); setInviteEmail(''); }}
                  sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
                >
                  Send invite
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Slide>
    </Modal>
  );
}
```

- [ ] **Step 2: Run the test**

```bash
cd apps/recipe-ui && npx vitest run src/components/FriendsSheet.test.jsx
```

Expected: PASS (6 tests).

- [ ] **Step 3: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/FriendsSheet.jsx \
        apps/recipe-ui/src/components/FriendsSheet.test.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(ui): FriendsSheet — full-page slide-up replacing the friends Dialog"
```

### Task 1.7: DiscoverPage — write the failing test

**Files:**
- Test (Create): `apps/recipe-ui/src/components/DiscoverPage.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/recipe-ui/src/components/DiscoverPage.test.jsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DiscoverPage from './DiscoverPage';

describe('DiscoverPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/public/trending-recipes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 't1', title: 'Miso Ramen' }] }) });
      }
      if (url.includes('/public/discover')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'd1', title: 'Tacos Reel', sourceUrl: 'https://www.tiktok.com/@x/video/1' }] }) });
      }
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      if (url.includes('/public/ai-picks')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ picks: [{ topic: 'GutHealth', reason: 'Probiotics', recipes: [{ id: 'a1', title: 'Kimchi Rice' }] }] }) });
      }
      return Promise.resolve({ ok: false });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const noop = () => {};

  it('renders all four section headers', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.getByText(/watch & cook/i)).toBeInTheDocument();
    expect(screen.getByText(/editor's picks/i)).toBeInTheDocument();
    expect(screen.getByText(/trending in health & nutrition/i)).toBeInTheDocument();
  });

  it('fetches all four discovery endpoints on mount', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/trending-recipes'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/discover'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/editors-pick'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/ai-picks'));
    });
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd apps/recipe-ui && npx vitest run src/components/DiscoverPage.test.jsx
```

Expected: FAIL — module not found.

### Task 1.8: DiscoverPage — implement

**Files:**
- Create: `apps/recipe-ui/src/components/DiscoverPage.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/recipe-ui/src/components/DiscoverPage.jsx
import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Button } from '@mui/material';
import RecipeShelf from './RecipeShelf';
import RecipeListCard from './RecipeListCard';
import DiscoverRecipes from './DiscoverRecipes';
import TrendingHealthCarousel from './TrendingHealthCarouselB';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path, accessToken) {
  const res = await fetch(`${API_BASE_URL}${path}`, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {});
  if (!res.ok) return null;
  return res.json();
}

function isEmbeddable(url) {
  if (!url) return false;
  return url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('youtu.be');
}

function SectionLabel({ children }) {
  return (
    <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary', mb: '10px' }}>
      {children}
    </Typography>
  );
}

/**
 * Logged-in Discover tab — 4 sections sourced from existing public discovery endpoints.
 */
export default function DiscoverPage({
  accessToken,
  cookingFor,
  cuisinePrefs,
  dietaryPrefs,
  onOpenRecipe,
  onSaveRecipe,
  onShareRecipe,
}) {
  const [trending, setTrending] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);

  useEffect(() => {
    fetchJson('/public/trending-recipes').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/discover').then(d => setDiscover(d?.recipes || []));
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));
    const q = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${q}`).then(d => setAiPicks(d?.picks || []));
  }, [cookingFor, cuisinePrefs, dietaryPrefs]);

  // Same de-dup logic as PublicLanding: drop trending overlaps, drop YouTube embeds, prioritise reels.
  const trendingIds = new Set(trending.map(r => r.id));
  const seen = new Set();
  const discoverUniq = discover.filter(r => {
    if (trendingIds.has(r.id)) return false;
    if (!r.sourceUrl || seen.has(r.sourceUrl)) return false;
    if (r.sourceUrl.includes('youtube.com') || r.sourceUrl.includes('youtu.be')) return false;
    seen.add(r.sourceUrl);
    return true;
  });
  const reels = discoverUniq.filter(r => {
    const u = r.sourceUrl || '';
    return u.includes('tiktok.com') || u.includes('instagram.com/reel');
  }).slice(0, 2);
  const reelIds = new Set(reels.map(r => r.id));
  const otherEmbed = discoverUniq.filter(r => !reelIds.has(r.id) && isEmbeddable(r.sourceUrl));
  const nonEmbed = discoverUniq.filter(r => !reelIds.has(r.id) && !isEmbeddable(r.sourceUrl));
  const videoRecipes = [...reels, ...otherEmbed, ...nonEmbed].slice(0, 5);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  return (
    <Box sx={{ pb: '90px' /* leave room for bottom nav */ }}>
      <Typography sx={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 22, mb: 2 }}>
        Discover
      </Typography>

      <Stack sx={{ gap: '32px' }}>
        {trending.length > 0 && (
          <Box>
            <SectionLabel>Trending Now</SectionLabel>
            <RecipeShelf recipes={trending.slice(0, 5)} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} cardWidth={180} cardHeight={120} gap="8px" />
          </Box>
        )}

        {videoRecipes.length > 0 && (
          <Box>
            <SectionLabel>Watch & Cook</SectionLabel>
            <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
          </Box>
        )}

        {editorsPick.length > 0 && (
          <Box>
            <SectionLabel>Editor's Picks</SectionLabel>
            <Stack spacing={1}>
              {visibleEditors.map(recipe => (
                <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
              ))}
            </Stack>
            {editorsPick.length > 3 && (
              <Button size="small" onClick={() => setEditorsExpanded(e => !e)} sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: 'text.secondary' }}>
                {editorsExpanded ? 'Show less' : `+ ${editorsPick.length - 3} more picks`}
              </Button>
            )}
          </Box>
        )}

        {aiPicks.length > 0 && (
          <Box>
            <SectionLabel>Trending in Health & Nutrition</SectionLabel>
            <TrendingHealthCarousel picks={aiPicks} onOpen={onOpenRecipe} onSave={onSaveRecipe} onShare={onShareRecipe} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Run the test**

```bash
cd apps/recipe-ui && npx vitest run src/components/DiscoverPage.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/DiscoverPage.jsx \
        apps/recipe-ui/src/components/DiscoverPage.test.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(ui): DiscoverPage — Trending Now / Watch & Cook / Editor's Picks / Trending Health"
```

### Task 1.9: OnboardingChecklist — write the failing test

**Files:**
- Test (Create): `apps/recipe-ui/src/components/OnboardingChecklist.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/recipe-ui/src/components/OnboardingChecklist.test.jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnboardingChecklist from './OnboardingChecklist';

describe('OnboardingChecklist', () => {
  it('renders all 3 step labels', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    expect(screen.getByText(/add your first recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/invite a friend/i)).toBeInTheDocument();
    expect(screen.getByText(/save a friend's recipe/i)).toBeInTheDocument();
  });

  it('shows N of 3 counter reflecting completed steps', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
  });

  it('renders nothing when all 3 are complete', () => {
    const { container } = render(<OnboardingChecklist hasRecipe hasInvitedFriend hasSavedFriendRecipe />);
    expect(container.firstChild).toBeNull();
  });

  it('marks completed steps with the data-done attribute', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    const recipeStep = screen.getByText(/add your first recipe/i).closest('[data-step]');
    expect(recipeStep).toHaveAttribute('data-done', 'true');
    const inviteStep = screen.getByText(/invite a friend/i).closest('[data-step]');
    expect(inviteStep).toHaveAttribute('data-done', 'false');
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd apps/recipe-ui && npx vitest run src/components/OnboardingChecklist.test.jsx
```

Expected: FAIL.

### Task 1.10: OnboardingChecklist — implement

**Files:**
- Create: `apps/recipe-ui/src/components/OnboardingChecklist.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/recipe-ui/src/components/OnboardingChecklist.jsx
import { Box, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const STEPS = [
  { key: 'recipe', label: 'Add your first recipe' },
  { key: 'invite', label: 'Invite a friend' },
  { key: 'save',   label: "Save a friend's recipe" },
];

export default function OnboardingChecklist({ hasRecipe, hasInvitedFriend, hasSavedFriendRecipe }) {
  const status = { recipe: !!hasRecipe, invite: !!hasInvitedFriend, save: !!hasSavedFriendRecipe };
  const done = STEPS.filter((s) => status[s.key]).length;

  if (done === STEPS.length) return null;

  const pct = Math.round((done / STEPS.length) * 100);

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      borderRadius: 2,
      p: 1.5,
      border: '2px solid',
      borderColor: 'rgba(124,58,237,0.10)',
      boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      mb: 2,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 12 }}>Get started</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main' }}>{done} of {STEPS.length}</Typography>
      </Box>

      {STEPS.map((step) => {
        const isDone = status[step.key];
        return (
          <Box key={step.key} data-step={step.key} data-done={isDone ? 'true' : 'false'}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, fontSize: 11 }}>
            <Box sx={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
              border: '1.5px solid',
              borderColor: isDone ? 'success.main' : 'divider',
              bgcolor: isDone ? 'success.main' : 'transparent',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isDone && <CheckIcon sx={{ fontSize: 11 }} />}
            </Box>
            <Typography sx={{
              fontSize: 11,
              color: isDone ? 'text.disabled' : 'text.primary',
              textDecoration: isDone ? 'line-through' : 'none',
            }}>
              {step.label}
            </Typography>
          </Box>
        );
      })}

      <Box sx={{ bgcolor: 'rgba(124,58,237,0.10)', height: 4, borderRadius: 2, mt: 1, overflow: 'hidden' }}>
        <Box sx={{ bgcolor: 'primary.main', height: '100%', width: `${pct}%`, transition: 'width 250ms ease' }} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Run the test**

```bash
cd apps/recipe-ui && npx vitest run src/components/OnboardingChecklist.test.jsx
```

Expected: PASS (4 tests).

- [ ] **Step 3: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/OnboardingChecklist.jsx \
        apps/recipe-ui/src/components/OnboardingChecklist.test.jsx
```

When approved:
```bash
git commit -m "feat(ui): OnboardingChecklist — 3-step new-user activation card"
```

### Phase 1 checkpoint

After Phase 1, all 5 new components exist with passing tests. Nothing in `App.jsx` or other files has changed; the running app behaves exactly as before. Run the full suite once before moving on:

```bash
cd apps/recipe-ui && npm test
```

Expected: green.

---

## Phase 2 — Wire BottomAppBar + ProfilePage + DiscoverPage into App.jsx

This phase changes the navigation surface. The hamburger drawer is **NOT yet removed** — bottom nav coexists with it for one phase so we can verify the wiring before deleting old code. The hamburger goes in Phase 3.

### Task 2.1: Extend `currentView` to include `'discover'` and `'profile'`

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (around lines 1051-1058 — the `currentView` state and its sessionStorage effect)

- [ ] **Step 1: Inspect the current state init**

Open `App.jsx` and look at the `currentView` state declaration around line 1051:

```jsx
const [currentView, setCurrentView] = useState(() => {
  const saved = sessionStorage.getItem('currentView');
  // ...
});
```

The valid values today are `'home' | 'recipes' | 'friend-requests'`. We need to allow `'discover' | 'profile'`.

- [ ] **Step 2: Update the view validator**

Find the validator inside the initial state callback. Replace any explicit allow-list with:

```jsx
const VALID_VIEWS = ['home', 'recipes', 'friend-requests', 'discover', 'profile'];
```

Use it both in the `useState(() => ...)` initializer and anywhere else `currentView` is sanity-checked. (If the existing code uses an inline list of valid values, update it; if it just trusts sessionStorage, leave the trust in place — but ensure no code throws on the new values.)

- [ ] **Step 3: Run unit tests to confirm nothing broke**

```bash
cd apps/recipe-ui && npm test
```

Expected: green.

- [ ] **Step 4: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(app): allow 'discover' and 'profile' as currentView values"
```

### Task 2.2: Render BottomAppBar at the app root

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Import BottomAppBar near the top of App.jsx with the other component imports**

```jsx
import BottomAppBar from './components/BottomAppBar';
```

- [ ] **Step 2: Render BottomAppBar after the closing `</Container>` for the logged-in view**

Inside the App return (around the bottom of the JSX), after the existing main content but inside the `<ThemeProvider>`, add:

```jsx
{session && (
  <BottomAppBar
    activeTab={
      currentView === 'home' ? 'home' :
      currentView === 'recipes' ? 'recipes' :
      currentView === 'discover' ? 'discover' :
      currentView === 'profile' ? null /* not a tab */ :
      null
    }
    onTabChange={(tab) => {
      if (tab === 'friends') {
        setIsFriendsDialogOpen(true);
        setIsAddFriendOpen(false);
        fetchFriends();
        fetchFriendRequests();
      } else {
        setCurrentView(tab);
      }
    }}
    onAddClick={openAddDialog}
    pendingFriendCount={friendRequests?.length ?? 0}
  />
)}
```

(`friendRequests` is the existing pending-requests state in `App.jsx` — verify the variable name; if it's `incomingFriendRequests` or similar, use that.)

- [ ] **Step 3: Add bottom padding to the main scroll container so the bar doesn't cover content**

In the existing `<Container maxWidth="lg">` wrapper or whatever wraps the per-view content, add to its `sx`:

```jsx
sx={{
  // ...existing sx
  pb: 'calc(64px + env(safe-area-inset-bottom) + 28px)', /* nav height + FAB protrusion */
}}
```

- [ ] **Step 4: Manually smoke-test the dev server**

```bash
cd apps/recipe-ui && npm run dev -- --host
```

Open the URL in a browser. With a logged-in user:
- Bottom bar is visible.
- Tapping Home → currentView becomes `home`.
- Tapping Recipes → currentView becomes `recipes`.
- Tapping the FAB → Add Recipe dialog opens.
- Tapping Friends → existing friends Dialog opens.
- Tapping Discover → currentView becomes `discover` (page may render blank for now — wired in 2.3).

Logged out, the bar should NOT be rendered.

- [ ] **Step 5: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(app): mount BottomAppBar for logged-in users"
```

### Task 2.3: Render DiscoverPage when currentView === 'discover'

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Import DiscoverPage**

```jsx
import DiscoverPage from './components/DiscoverPage';
```

- [ ] **Step 2: Add a render branch for 'discover' in the main view switch**

Find the existing block (around `currentView === 'recipes' && (...)`). Add right after:

```jsx
{currentView === 'discover' && session && (
  <DiscoverPage
    accessToken={accessToken}
    cookingFor={userProfile?.cookingFor ?? null}
    cuisinePrefs={userProfile?.cuisinePrefs ?? null}
    dietaryPrefs={userProfile?.dietaryPrefs ?? null}
    onOpenRecipe={handleOpenEditorPickRecipe}
    onSaveRecipe={handleSavePublicRecipe}
    onShareRecipe={(recipe, event) => openShareSheet(recipe, event)}
  />
)}
```

(The handler names `handleOpenEditorPickRecipe`, `handleSavePublicRecipe`, `openShareSheet` should match what's currently passed to `FriendSections` — copy from there.)

- [ ] **Step 3: Smoke test**

```bash
cd apps/recipe-ui && npm run dev -- --host
```

Tap Discover in the bottom bar — page should render with all 4 sections (data may be slow to load; wait a beat).

- [ ] **Step 4: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(app): render DiscoverPage when currentView === 'discover'"
```

### Task 2.4: Add header avatar that opens Profile, render ProfilePage

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (header AppBar section starting around line 4623, and add a `currentView === 'profile'` render branch)

- [ ] **Step 1: Import ProfilePage**

```jsx
import ProfilePage from './components/ProfilePage';
```

- [ ] **Step 2: Replace the existing top-right Add button with the avatar**

Find the existing toolbar block (App.jsx around line 4642):

```jsx
<Stack direction="row" spacing="6px" alignItems="center">
  <Button onClick={openAddDialog} ...>+ Add</Button>
  {/* ... */}
</Stack>
```

Replace the Add Button with an avatar IconButton. Keep any account-menu or login button untouched for now (those will be removed in Phase 3 when the hamburger goes away):

```jsx
<Stack direction="row" spacing="6px" alignItems="center">
  {session ? (
    <Box
      component="button"
      onClick={() => setCurrentView('profile')}
      aria-label="Open profile"
      sx={{
        width: 32, height: 32, borderRadius: '50%',
        bgcolor: 'primary.main',
        color: '#fff',
        fontSize: 13, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer',
        boxShadow: '0 0 0 2px var(--mui-palette-background-paper, #fff), 0 1px 4px rgba(0,0,0,.12)',
        fontFamily: 'inherit',
      }}
    >
      {(userProfile?.displayName || session.user?.email || 'U').charAt(0).toUpperCase()}
    </Box>
  ) : null}
</Stack>
```

The "+ Add" button is removed from the header — the FAB takes over that responsibility.

- [ ] **Step 3: Add a render branch for currentView === 'profile'**

Add inside the main view switch:

```jsx
{currentView === 'profile' && session && (
  <ProfilePage
    user={{
      displayName: userProfile?.displayName,
      email: session.user?.email,
    }}
    themePref={themePref}
    onThemeChange={updateThemePref}
    onEditName={() => {
      setEditNameValue(userProfile?.displayName || '');
      setIsDrawerEditingName(true);
    }}
    onEditAvatar={() => { /* TODO: avatar upload — separate brainstorm */ }}
    onEditCookingPrefs={() => setOnboardingOpen(true)}
    onSendFeedback={() => setFeedbackOpen(true)}
    onOpenAbout={() => { /* TODO: about page — out of scope */ }}
    onSignOut={handleLogout}
    notificationsEnabled={pushNotificationsEnabled ?? true}
  />
)}
```

(Adapt names: `themePref`, `updateThemePref`, `setIsDrawerEditingName`, `setEditNameValue`, `setOnboardingOpen`, `setFeedbackOpen`, `handleLogout`, `pushNotificationsEnabled` are existing identifiers in `App.jsx` — verify each one exists with that exact name; if a different name, use that.)

- [ ] **Step 4: Smoke test**

Reload the dev server. Tap the avatar in the top-right → Profile page renders. Tap theme → it changes. Tap Sign out → user is logged out.

- [ ] **Step 5: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(app): header avatar opens ProfilePage"
```

### Phase 2 checkpoint

After Phase 2, the bottom bar is wired up, Discover and Profile are reachable, the FAB opens Add Recipe, and the avatar opens Profile. The hamburger drawer still exists in the code and is still triggered by the `MenuIcon`. Both navigation surfaces work simultaneously. Run tests and a smoke test before moving on.

```bash
cd apps/recipe-ui && npm test
```

---

## Phase 3 — Replace the Friends Dialog with FriendsSheet, then remove the hamburger

### Task 3.1: Swap the friends Dialog for FriendsSheet

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Import FriendsSheet**

```jsx
import FriendsSheet from './components/FriendsSheet';
```

- [ ] **Step 2: Find the existing friends Dialog**

Search for the existing friends dialog rendering (it uses `isFriendsDialogOpen` and renders a list/Add UI inside MUI `Dialog`). It's likely several hundred lines long. Confirm where it starts and ends.

- [ ] **Step 3: Replace it with FriendsSheet**

Replace the entire friends-Dialog JSX block with:

```jsx
<FriendsSheet
  open={isFriendsDialogOpen}
  initialView={isAddFriendOpen ? 'add' : 'list'}
  onClose={() => { setIsFriendsDialogOpen(false); setIsAddFriendOpen(false); }}
  friends={friends}
  pendingRequests={friendRequests}
  onAccept={acceptFriendRequest}
  onDecline={declineFriendRequest}
  onSendInvite={(email) => { sendFriendInvite(email); }}
/>
```

(`friends`, `friendRequests`, `acceptFriendRequest`, `declineFriendRequest`, `sendFriendInvite` are existing — verify exact names. The original dialog likely passed these handlers in different shapes; thread them through.)

- [ ] **Step 4: Smoke test**

Tap the Friends bottom-bar tab → sheet slides up from the bottom. Friends list shows. Tap "+ Add" → Add view appears. Type an email → Send invite. Tap X → sheet dismisses.

- [ ] **Step 5: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "feat(app): replace friends Dialog with FriendsSheet slide-up"
```

### Task 3.2: Remove the hamburger Drawer (the big surgery)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

This is the most invasive single change in the plan. The drawer (around lines 4768-5144) hosts: profile header, nav shortcuts (Home/Recipes/Favorites/Friends/Invite), meal-type filter chips, theme controls, and Logout. By Phase 3 these are all owned by:
- Profile (theme, sign-out, name-edit, avatar-edit) — already wired in 2.4.
- Bottom nav (Home, Recipes, Friends, Discover) — already wired in 2.2.
- Recipes page (meal-type chips and favorites) — wired in Phase 4 below. **Do this task BEFORE Phase 4 only if you're willing to lose meal-type filtering temporarily; otherwise do Phase 4 first.**

**Preferred order: Phase 4 first, then 3.2.**

- [ ] **Step 1: Verify Phase 4 is complete (meal-type chips inline on RecipesPage)**

If Phase 4 hasn't been done yet, jump to Phase 4 now and come back here.

- [ ] **Step 2: Remove the menu IconButton from the AppBar toolbar**

Around App.jsx line 4625 there's an IconButton that triggers `setMobileFilterDrawerOpen(true)`. Delete the entire IconButton.

- [ ] **Step 3: Remove the entire `<Drawer>` block**

Delete the JSX from `<Drawer anchor="left" open={mobileFilterDrawerOpen} ...>` down to its closing `</Drawer>`. This is roughly lines 4767-5144 — verify the exact span before deleting.

- [ ] **Step 4: Remove now-unused state and refs**

Delete these state declarations:

```jsx
const [mobileFilterDrawerOpen, setMobileFilterDrawerOpen] = useState(false);
const [isDrawerEditingName, setIsDrawerEditingName] = useState(false);  // KEEP — used by ProfilePage's onEditName handler
const [editNameValue, setEditNameValue] = useState('');                 // KEEP — same reason
```

`mobileFilterDrawerOpen` is genuinely dead; `isDrawerEditingName` and `editNameValue` are still used by Profile's edit-name flow. Keep those.

Search the rest of `App.jsx` for any remaining references to `mobileFilterDrawerOpen` and remove them too (there are several `&& !mobileFilterDrawerOpen` guards on FABs, install banners, etc. — those become trivially true and can be deleted).

- [ ] **Step 5: Remove the unused `FilterListIcon` import** (if no longer used)

```bash
grep -n "FilterListIcon" apps/recipe-ui/src/App.jsx
```

If only the import line shows up, remove the import:

```jsx
import FilterListIcon from '@mui/icons-material/FilterList';  // DELETE if no longer used
```

- [ ] **Step 6: Run tests**

```bash
cd apps/recipe-ui && npm test
```

Expected: green. Any test that referenced the drawer needs updating — but since we don't have drawer-specific tests, this should be clean.

- [ ] **Step 7: Smoke test**

Run the dev server and verify:
- No left-side drawer opens. There's no menu icon to open it.
- Bottom nav still navigates between Home / Recipes / Discover.
- Friends tab opens the FriendsSheet.
- Avatar in header opens Profile.
- Recipes page filter chips work inline (verify Phase 4 was done).
- Theme switcher in Profile changes the theme.
- Sign out works.

- [ ] **Step 8: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
git diff --cached
```

When approved:
```bash
git commit -m "refactor(app): remove hamburger drawer — replaced by bottom nav + Profile"
```

### Phase 3 checkpoint

After Phase 3, navigation is fully on the bottom bar + Profile + FriendsSheet. The hamburger drawer is gone. The app should feel like it does in the design mockup.

---

## Phase 4 — RecipesPage inline meal-type chips + favorites toggle

This phase MUST land before Phase 3.2 (removing the drawer) because the meal-type chips currently live inside the drawer.

### Task 4.1: Add inline meal-type chip row to RecipesPage — write the failing test

**Files:**
- Modify: `apps/recipe-ui/src/RecipesPage.jsx`
- Create: `apps/recipe-ui/src/RecipesPage.test.jsx` (NEW — there's no existing test file)

- [ ] **Step 1: Write a focused test for the chip row**

```jsx
// apps/recipe-ui/src/RecipesPage.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecipesPage from './RecipesPage';

const noop = () => {};
const baseProps = {
  displayedRecipes: [],
  filteredRecipes: [],
  totalRecipes: 0,
  accessToken: 'tok',
  ingredientInput: '',
  setIngredientInput: noop,
  ingredientInputKeyCount: 0,
  showIngredientSuggestions: false,
  filteredIngredientSuggestions: [],
  ingredientSuggestionFormatter: (s) => s,
  handleIngredientInputChange: noop,
  handleIngredientSuggestionClick: noop,
  setIngredientInputFocused: noop,
  setIngredientInputKeyCount: noop,
  normalizedIngredients: [],
  isMobile: true,
  searchBarRef: { current: null },
  handleOpenRecipe: noop,
  toggleFavorite: noop,
  handleShare: noop,
  handleVideoThumbnailClick: noop,
  onAddRecipe: noop,
  addRecipeBtnRef: { current: null },
  session: { user: { id: 'u1' } },
  favorites: new Set(),
  openAuthDialog: noop,
  remoteState: { status: 'idle' },
  resolveRecipeImageUrl: () => '',
  buildEmbedUrl: () => null,
  createImageFallbackHandler: () => noop,
  RecipeThumbnail: () => null,
  sentinelRef: { current: null },
  // NEW props for inline filter:
  availableMealTypes: ['breakfast', 'lunch', 'dinner'],
  selectedMealType: '',
  onMealTypeSelect: vi.fn(),
  showFavoritesOnly: false,
  onToggleFavoritesOnly: vi.fn(),
};

describe('RecipesPage inline meal-type filter', () => {
  it('renders a chip per available meal type', () => {
    render(<RecipesPage {...baseProps} />);
    expect(screen.getByRole('button', { name: /breakfast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lunch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dinner/i })).toBeInTheDocument();
  });

  it('calls onMealTypeSelect with the type when a chip is clicked', () => {
    const onMealTypeSelect = vi.fn();
    render(<RecipesPage {...baseProps} onMealTypeSelect={onMealTypeSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /lunch/i }));
    expect(onMealTypeSelect).toHaveBeenCalledWith('lunch');
  });

  it('renders selectedMealType chip with aria-pressed=true', () => {
    render(<RecipesPage {...baseProps} selectedMealType="dinner" />);
    expect(screen.getByRole('button', { name: /dinner/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /lunch/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders favorites heart toggle and reflects active state', () => {
    render(<RecipesPage {...baseProps} showFavoritesOnly />);
    expect(screen.getByRole('button', { name: /favorites/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Verify the tests fail (the new props don't exist yet)**

```bash
cd apps/recipe-ui && npx vitest run src/RecipesPage.test.jsx
```

Expected: FAIL.

### Task 4.2: Add inline meal-type chip row + favorites toggle to RecipesPage

**Files:**
- Modify: `apps/recipe-ui/src/RecipesPage.jsx`

- [ ] **Step 1: Update the component signature**

Add the new props at the top of `RecipesPage`:

```jsx
export default function RecipesPage({
  // ...existing props
  availableMealTypes,
  selectedMealType,
  onMealTypeSelect,
  showFavoritesOnly,
  onToggleFavoritesOnly,
  MEAL_TYPE_LABELS = {},
  MEAL_TYPE_ICONS = {},
}) {
```

- [ ] **Step 2: Add the favorites toggle to the search-area header**

Just above the search TextField, render a header row with the search field + a favorites heart button:

```jsx
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
  {/* Existing TextField goes here (move it inside this Box, with sx={{ flex: 1 }}) */}
  <Box
    component="button"
    role="button"
    aria-label="Favorites"
    aria-pressed={showFavoritesOnly}
    onClick={onToggleFavoritesOnly}
    sx={{
      width: 36, height: 36, borderRadius: '50%',
      border: 'none', bgcolor: 'transparent', cursor: 'pointer',
      color: showFavoritesOnly ? '#e53935' : 'text.secondary',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
  >
    {showFavoritesOnly ? (
      <FavoriteIcon sx={{ fontSize: 22 }} />
    ) : (
      <FavoriteBorderIcon sx={{ fontSize: 22 }} />
    )}
  </Box>
</Box>
```

- [ ] **Step 3: Add the chip row directly under the search**

```jsx
{availableMealTypes && availableMealTypes.length > 0 && (
  <Box
    sx={{
      display: 'flex', flexWrap: 'nowrap', overflowX: 'auto',
      gap: 1, mb: 1.5,
      mx: -2, px: 2,
      '&::-webkit-scrollbar': { display: 'none' },
      scrollbarWidth: 'none',
      maskImage: 'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)',
    }}
  >
    {availableMealTypes.map((type) => {
      const label = MEAL_TYPE_LABELS[type] || type.replace(/^\w/, (c) => c.toUpperCase());
      const icon = MEAL_TYPE_ICONS[type];
      const selected = selectedMealType === type;
      return (
        <Box
          key={type}
          component="button"
          role="button"
          aria-pressed={selected}
          onClick={() => onMealTypeSelect(type)}
          sx={(theme) => ({
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            height: 36, px: 1.5, border: 'none', borderRadius: '999px',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
            whiteSpace: 'nowrap', flexShrink: 0,
            ...(selected
              ? { bgcolor: 'primary.main', color: '#fff' }
              : {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                  color: 'text.primary',
                }),
          })}
        >
          {icon && (
            <Box component="span" sx={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, bgcolor: selected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)' }}>
              {icon}
            </Box>
          )}
          {label}
        </Box>
      );
    })}
  </Box>
)}
```

- [ ] **Step 4: Pass the new props from App.jsx**

In `App.jsx` where `<RecipesPage ...>` is rendered (around line 5287), add:

```jsx
availableMealTypes={availableMealTypes}
selectedMealType={selectedMealType}
onMealTypeSelect={(type) => handleMealTypeSelect(type)}
showFavoritesOnly={showFavoritesOnly}
onToggleFavoritesOnly={() => setShowFavoritesOnly((prev) => !prev)}
MEAL_TYPE_LABELS={MEAL_TYPE_LABELS}
MEAL_TYPE_ICONS={MEAL_TYPE_ICONS}
```

`availableMealTypes`, `selectedMealType`, `handleMealTypeSelect`, `showFavoritesOnly`, `setShowFavoritesOnly`, `MEAL_TYPE_LABELS`, `MEAL_TYPE_ICONS` are all existing identifiers in `App.jsx` — verify their exact names.

- [ ] **Step 5: Run the tests**

```bash
cd apps/recipe-ui && npx vitest run src/RecipesPage.test.jsx
```

Expected: PASS (4 tests).

- [ ] **Step 6: Smoke test**

Open Recipes — chip row visible under search, meal-type filtering works, favorites heart toggles.

- [ ] **Step 7: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/RecipesPage.jsx \
        apps/recipe-ui/src/RecipesPage.test.jsx \
        apps/recipe-ui/src/App.jsx
```

When approved:
```bash
git commit -m "feat(recipes): inline meal-type chips + favorites toggle in header"
```

### Phase 4 checkpoint

After Phase 4, the meal-type filter is on the Recipes page itself, not in the drawer. **Now Phase 3.2 (drawer removal) is safe to execute.** Go back and complete it before continuing.

---

## Phase 5 — FriendSections cleanup (collapse 3 sections → 1, remove Editor's Picks + Trending Health)

### Task 5.1: Update FriendSections — write the failing test

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.test.jsx` (existing tests)
- The component test should assert the new behavior

- [ ] **Step 1: Read the existing test file**

```bash
cd apps/recipe-ui && cat src/components/FriendSections.test.jsx
```

Note which behaviors are already tested. Add new tests for:

```jsx
it('renders a single "From your friends" section when there is friend activity', async () => {
  global.fetch = vi.fn((url) => {
    if (url.includes('/friends/activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ activity: [{ id: 1, type: 'friend_saved_recipe', friendName: 'Henny', recipe: { id: 'r1', title: 'Beef Stew' }, createdAt: new Date().toISOString() }] }) });
    if (url.includes('/friends/recently-saved')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    if (url.includes('/friends/recently-shared')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    if (url.includes('/public/editors-pick')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [] }) });
    if (url.includes('/public/ai-picks')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ picks: [] }) });
    return Promise.resolve({ ok: false });
  });
  render(<FriendSections accessToken="t" onOpenRecipe={() => {}} onSaveRecipe={() => {}} />);
  await waitFor(() => expect(screen.getByText(/from your friends/i)).toBeInTheDocument());
  expect(screen.queryByText(/^Friend Activity$/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/recently saved by friends/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/recently shared by friends/i)).not.toBeInTheDocument();
});

it('does NOT render Editor\'s Picks or Trending in Health & Nutrition (those moved to Discover)', async () => {
  // Use the same fetch setup; assert these labels are absent
  render(<FriendSections accessToken="t" onOpenRecipe={() => {}} onSaveRecipe={() => {}} />);
  await waitFor(() => expect(screen.queryByText(/editor's picks/i)).not.toBeInTheDocument());
  expect(screen.queryByText(/trending in health & nutrition/i)).not.toBeInTheDocument();
});

it('hides "From your friends" entirely when there is no activity', async () => {
  global.fetch = vi.fn((url) => {
    if (url.includes('/friends/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ activity: [], items: [] }) });
    if (url.includes('/public/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    return Promise.resolve({ ok: false });
  });
  render(<FriendSections accessToken="t" onOpenRecipe={() => {}} onSaveRecipe={() => {}} />);
  await waitFor(() => expect(screen.queryByText(/from your friends/i)).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd apps/recipe-ui && npx vitest run src/components/FriendSections.test.jsx
```

Expected: the 3 new tests fail; existing tests may also need updating.

### Task 5.2: Update FriendSections.jsx

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx`

- [ ] **Step 1: Merge activity / saved / shared into one feed**

Today the component fetches three friend-feed endpoints and renders three separate sections. The merge:

In the `useEffect` that fetches the three endpoints, after the `Promise.all`, build a unified array sorted by timestamp:

```jsx
const merged = [
  ...act.activity.map(a => ({ ...a, _kind: 'activity' })),
  ...(saved?.items || []).map(i => ({
    id: `saved-${i.recipe.id}`,
    type: 'friend_saved_recipe',
    friendName: i.friendName,
    recipe: i.recipe,
    createdAt: i.createdAt || new Date().toISOString(),
    _kind: 'saved',
  })),
  ...(shared?.items || []).map(i => ({
    id: `shared-${i.recipe.id}`,
    type: 'friend_shared_recipe',
    friendName: i.friendName,
    recipe: i.recipe,
    createdAt: i.createdAt || new Date().toISOString(),
    _kind: 'shared',
  })),
];
merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
// Dedup by recipe.id within the same friendName + type so a single
// save doesn't appear twice when both /activity and /recently-saved return it.
const seen = new Set();
const dedup = merged.filter(item => {
  const key = `${item.friendName}|${item.type}|${item.recipe?.id || item.id}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
setUnifiedFeed(dedup);
```

Replace the three previous state hooks (`activity`, `recentlySaved`, `recentlyShared`) with one:

```jsx
const [unifiedFeed, setUnifiedFeed] = useState([]);
```

- [ ] **Step 2: Replace the three section JSX blocks with one "From your friends" block**

Replace this region of the JSX:

```jsx
{hasActivity && (<Box>...Friend Activity...</Box>)}
{hasSaved && (<Box>...Recently Saved by Friends...</Box>)}
{hasShared && (<Box>...Recently Shared by Friends...</Box>)}
```

with:

```jsx
{unifiedFeed.length > 0 && (
  <Box>
    <SectionLabel>From your friends</SectionLabel>
    <Box sx={{
      bgcolor: 'background.paper',
      borderRadius: '12px',
      boxShadow: theme => theme.palette.mode === 'dark'
        ? '0 0 0 1px rgba(255,255,255,0.10)'
        : '0 1px 4px rgba(0,0,0,.08)',
      overflow: 'hidden',
    }}>
      {unifiedFeed.slice(0, feedExpanded ? 8 : 3).map((item, index, arr) => (
        <Box key={item.id}>
          <ActivityItem
            item={item}
            onOpenRecipe={onOpenRecipe}
            onOpenFriendRequest={(it) => setRequestDialogItem(it)}
          />
          {index < arr.length - 1 && (
            <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.5 }} />
          )}
        </Box>
      ))}
    </Box>
    {unifiedFeed.length > 3 && (
      <Typography
        component="button"
        onClick={() => setFeedExpanded(prev => !prev)}
        sx={{
          background: 'none', border: 'none', p: 0, mt: 0.75,
          cursor: 'pointer', fontSize: 12, fontWeight: 500,
          color: 'primary.main', fontFamily: 'inherit',
        }}
      >
        {feedExpanded ? 'Show less' : `+ ${unifiedFeed.length - 3} more`}
      </Typography>
    )}
  </Box>
)}
```

(`feedExpanded` is a new local state: `const [feedExpanded, setFeedExpanded] = useState(false);` — replace the existing `activityExpanded` state.)

- [ ] **Step 3: Remove Editor's Picks and Trending Health rendering**

Delete the JSX blocks for "Editor's Picks" (the `RecipeListCard` list with the "+ N more picks" expand) and "Trending in Health & Nutrition" (the `TrendingHealthCarousel` block) — those now live only on `DiscoverPage`.

Also remove the corresponding state and effects:

```jsx
const [editorsPick, setEditorsPick] = useState([]);             // DELETE
const [editorsExpanded, setEditorsExpanded] = useState(false);   // DELETE
const [aiPicks, setAiPicks] = useState([]);                      // DELETE

// Delete the two useEffects that fetch /public/editors-pick and /public/ai-picks
```

- [ ] **Step 4: Remove unused imports**

```jsx
import RecipeListCard from './RecipeListCard';                  // DELETE if no longer used
import TrendingHealthCarousel from './TrendingHealthCarouselB'; // DELETE if no longer used
```

- [ ] **Step 5: Run tests**

```bash
cd apps/recipe-ui && npx vitest run src/components/FriendSections.test.jsx
```

Expected: PASS (the 3 new tests + any existing that still apply).

- [ ] **Step 6: Smoke test**

Open Home with a logged-in user. There's now ONE "From your friends" section, with a unified feed merging cooked/saved/shared. No Editor's Picks or Trending Health on Home — those are only in Discover. Cook with Friends still pinned at the bottom.

- [ ] **Step 7: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx \
        apps/recipe-ui/src/components/FriendSections.test.jsx
```

When approved:
```bash
git commit -m "feat(home): unified 'From your friends' feed; remove Editor's Picks + Trending Health from Home"
```

---

## Phase 6 — Onboarding checklist visibility on Home

### Task 6.1: Wire OnboardingChecklist into Home (App.jsx)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Import OnboardingChecklist**

```jsx
import OnboardingChecklist from './components/OnboardingChecklist';
```

- [ ] **Step 2: Compute the three completion booleans**

Add near other Home-view derived state (above the `currentView === 'home' && session && (...)` render block):

```jsx
const hasRecipe = recipes.length > 0;
const hasInvitedFriend =
  Boolean(localStorage.getItem(`onboarding_invited_${session?.user?.id}`)) ||
  friends.length > 0; // someone they connected with implies they engaged
// Saved a recipe authored by another user:
const hasSavedFriendRecipe = recipes.some(r => r.ownerId && r.ownerId !== session?.user?.id);

// Once all three are done, persist a flag so the checklist disappears permanently
// (avoids flicker on subsequent loads before fresh data arrives)
const allDoneFlag = `onboarding_complete_${session?.user?.id}`;
const allDoneCached = Boolean(localStorage.getItem(allDoneFlag));
const allDoneNow = hasRecipe && hasInvitedFriend && hasSavedFriendRecipe;
useEffect(() => {
  if (allDoneNow && !allDoneCached) localStorage.setItem(allDoneFlag, '1');
}, [allDoneNow, allDoneCached, allDoneFlag]);
const showChecklist = !(allDoneCached || allDoneNow);
```

- [ ] **Step 3: Render the checklist above StatsTiles in the Home view**

Inside the `currentView === 'home' && session && (...)` block, between the greeting and the StatsTiles, add:

```jsx
{showChecklist && (
  <OnboardingChecklist
    hasRecipe={hasRecipe}
    hasInvitedFriend={hasInvitedFriend}
    hasSavedFriendRecipe={hasSavedFriendRecipe}
  />
)}
```

- [ ] **Step 4: Set the invited-friend flag from the FriendsSheet onSendInvite callback**

Find where `<FriendsSheet ... onSendInvite={...}>` is wired in App.jsx. Wrap the handler:

```jsx
onSendInvite={(email) => {
  sendFriendInvite(email);
  if (session?.user?.id) {
    localStorage.setItem(`onboarding_invited_${session.user.id}`, '1');
  }
}}
```

- [ ] **Step 5: Drop "Welcome" + emoji from greetings**

Find the greeting block in App.jsx around line 5210-5256. The greeting Typography currently shows the user's first name — that's already correct (no "Welcome").

Find `getHomeGreetingMessage` (around line 982) and update it to remove emoji from any returned strings. If it currently returns "good evening 🌙" or similar, return just "good evening" (no emoji). Apply to all branches.

- [ ] **Step 6: Run tests + smoke test**

```bash
cd apps/recipe-ui && npm test
```

Smoke: log in as a brand-new account → checklist appears with 0/3. Add a recipe → 1/3, first row checks. Send an invite via Friends sheet → 2/3. Save a recipe authored by someone else → 3/3 → checklist disappears on next render.

- [ ] **Step 7: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
```

When approved:
```bash
git commit -m "feat(home): show OnboardingChecklist for new users; drop emoji from greetings"
```

---

## Phase 7 — Pin Cook with Friends at the bottom of Home

The component already exists in `FriendSections.jsx` and is already at the bottom of the Stack. Phase 5 should have left it in place. Verify, and if needed, ensure it is the **last** child in the Stack returned by FriendSections.

### Task 7.1: Verify CookWithFriends is the last section on Home

**Files:**
- Modify (only if needed): `apps/recipe-ui/src/components/FriendSections.jsx`

- [ ] **Step 1: Inspect the JSX order in FriendSections after Phase 5**

The Stack should render in this order:

1. (Optional, when active) `From your friends` section — unified feed
2. `SuggestionsShelf` (people you may know)
3. `CookWithFriends` (with the existing `CwfTicker`)

If `CookWithFriends` isn't last, move it to be the final child of the returned `<Stack>`.

- [ ] **Step 2: Confirm CWF is unchanged**

The `CookWithFriends` and `CwfTicker` definitions inside `FriendSections.jsx` are untouched by this plan. They use the existing gradient + ticker implementation.

- [ ] **Step 3: Smoke test**

Home shows: greeting → checklist (if applicable) → StatsTiles → "From your friends" (if any) → SuggestionsShelf (if any) → CookWithFriends. CWF is last.

- [ ] **Step 4: Commit only if changes were made**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
```

When approved:
```bash
git commit -m "chore(home): ensure CookWithFriends is pinned last on Home"
```

If no changes were needed, skip the commit.

---

## Phase 8 — Public landing trim

### Task 8.1: Remove Editor's Picks and Trending Health from PublicLanding — write the failing test

**Files:**
- Create: `apps/recipe-ui/src/components/PublicLanding.test.jsx` (NEW)

- [ ] **Step 1: Write the test**

```jsx
// apps/recipe-ui/src/components/PublicLanding.test.jsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PublicLanding from './PublicLanding';

describe('PublicLanding (trimmed)', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/public/trending-recipes')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 't1', title: 'Miso' }] }) });
      if (url.includes('/public/discover')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'd1', title: 'Reel', sourceUrl: 'https://www.tiktok.com/@x/video/1' }] }) });
      if (url.includes('/public/editors-pick')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor' }] }) });
      if (url.includes('/public/ai-picks')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ picks: [{ topic: 'X', recipes: [] }] }) });
      return Promise.resolve({ ok: false });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('does NOT render Editor\'s Picks (members-only)', async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.queryByText(/editor's picks/i)).not.toBeInTheDocument();
  });

  it('does NOT render Trending in Health & Nutrition (members-only)', async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.queryByText(/trending in health & nutrition/i)).not.toBeInTheDocument();
  });

  it('renders the Why Join carousel and the two retained shelves', async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/save, cook, share/i)).toBeInTheDocument());
    expect(screen.getByText(/trending now/i)).toBeInTheDocument();
    expect(screen.getByText(/discover new recipes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify the first two tests fail (today's PublicLanding still has those sections)**

```bash
cd apps/recipe-ui && npx vitest run src/components/PublicLanding.test.jsx
```

### Task 8.2: Trim PublicLanding.jsx

**Files:**
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Remove Editor's Picks JSX block**

Delete this region (around lines 495-511 in current PublicLanding):

```jsx
{editorsPick.length > 0 && (
  <Box>
    <SectionLabel label="Editor's Picks" />
    {/* ... */}
  </Box>
)}
```

- [ ] **Step 2: Remove Trending in Health & Nutrition JSX block**

Delete this region (around lines 513-519):

```jsx
{aiPicks.length > 0 && (
  <Box>
    <SectionLabel label="Trending in Health & Nutrition" />
    <TrendingHealthCarousel ... />
  </Box>
)}
```

- [ ] **Step 3: Remove unused state, effects, imports**

```jsx
const [editorsPick, setEditorsPick] = useState([]);              // DELETE
const [aiPicks, setAiPicks] = useState([]);                      // DELETE
const [editorsExpanded, setEditorsExpanded] = useState(false);   // DELETE
```

In the consolidated `useEffect`:

```jsx
fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || [])); // DELETE
fetchJson('/public/ai-picks').then(d => setAiPicks(d?.picks || []));            // DELETE
```

Remove imports if no longer used:

```jsx
import RecipeListCard from './RecipeListCard';                  // DELETE if no longer referenced
import TrendingHealthCarousel from './TrendingHealthCarouselB'; // DELETE if no longer referenced
```

- [ ] **Step 4: Run tests**

```bash
cd apps/recipe-ui && npx vitest run src/components/PublicLanding.test.jsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Smoke test logged out**

Sign out of the app. Public landing should show: "Save, cook, share" carousel + Trending Now + Discover New Recipes + Join Free FAB. No Editor's Picks. No Trending Health.

- [ ] **Step 6: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/components/PublicLanding.jsx \
        apps/recipe-ui/src/components/PublicLanding.test.jsx
```

When approved:
```bash
git commit -m "refactor(public-landing): drop Editor's Picks + Trending Health (members-only on Discover)"
```

---

## Phase 9 — Final cleanup and verification

### Task 9.1: Remove dead imports and verify nothing in App.jsx is orphaned

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Find unused imports**

```bash
cd apps/recipe-ui
grep -n "MenuIcon\|FilterListIcon\|Drawer\|InputBase\|Badge" src/App.jsx
```

If `MenuIcon` and `Drawer` no longer have any usage, remove their imports.

```bash
grep -n "from '@mui/icons-material/Menu'\|from '@mui/material/Drawer'" src/App.jsx
```

- [ ] **Step 2: Run a full test pass**

```bash
cd apps/recipe-ui && npm test
```

- [ ] **Step 3: Build the production bundle to catch broken imports**

```bash
cd apps/recipe-ui && npm run build
```

Expected: clean build with no errors. Warnings about unused vars are acceptable but list them.

- [ ] **Step 4: Stage and ASK before committing**

```bash
git add apps/recipe-ui/src/App.jsx
```

When approved:
```bash
git commit -m "chore(app): remove dead imports left from hamburger removal"
```

### Task 9.2: Mobile smoke test

- [ ] **Step 1: Start the dev server with --host so a phone can reach it**

```bash
cd apps/recipe-ui && npm run dev -- --host
```

- [ ] **Step 2: Start a tunnel for phone access**

```bash
cloudflared tunnel --url http://localhost:5173
```

(Or if `recifind-dev` named tunnel is configured per memory, use that instead — `dev.recifriend.com`.)

- [ ] **Step 3: Walk through the full flow on iOS Safari (or the native iOS app via TestFlight if available)**

- Bottom nav respects safe-area inset (the home indicator).
- FAB is visually elevated above the bar (28px protrusion).
- Bottom nav hides when soft keyboard is open (focus the search bar to verify).
- Tap each tab: Home / Recipes / FAB / Friends (sheet slides up) / Discover.
- Home (active user): greeting + StatsTiles + "From your friends" (if data) + SuggestionsShelf + CookWithFriends pinned.
- Home (new user): greeting + Onboarding checklist + StatsTiles + CookWithFriends. No "From your friends" empty strip.
- Recipes: search + meal-type chips inline + favorites heart in header.
- Discover: 4 sections render (Trending Now, Watch & Cook, Editor's Picks, Trending Health).
- Friends sheet: list view + Add tab + grabber + X close.
- Profile: avatar tap from header opens it. Theme switcher works. Sign out works.
- Sign out → public landing trimmed to carousel + Trending Now + Discover New Recipes + Join FAB.

- [ ] **Step 4: Verify deep links still land on the right tab**

- Friend-accept Universal Link → opens app, Friends-accepted state visible (whatever it does today).
- Share-extension entry from TikTok / Instagram → drops user into Add Recipe flow.

- [ ] **Step 5: Confirm with user before final commit (none needed for smoke test) and ASK to push**

If the user wants to push to remote:

```bash
git push origin main
git push origin testflight-build-6  # only if they want the tag remote
```

**Wait for explicit instruction.**

---

## Risks / things to verify during execution

- **Hamburger removal touches a LOT of state.** Run `grep -n "mobileFilterDrawerOpen" apps/recipe-ui/src/App.jsx` after Phase 3.2 — should return zero matches.
- **`getHomeGreetingMessage` may return emoji.** Walk every return statement and strip emoji to satisfy the no-emoji rule.
- **`onboarding_invited_${userId}` in localStorage** is a client-only flag. If the user invites from a different device, the checklist will still show step 2 as not done. Acceptable — this is user-perceived progress, not a server-truth.
- **Capacitor + iOS keyboard handling:** `position: fixed` plus the on-screen keyboard sometimes overlays the nav awkwardly. The nav should hide when keyboard is open. Verify on a real device, not just in browser dev tools.
- **Existing share-extension entry point** sets `currentView` directly. After this redesign, `'home'` and `'recipes'` still exist; deeplinks should be unaffected, but verify.

---

## Done when

- All 9 phases committed (with user approval) on `main`.
- `npm test` passes in `apps/recipe-ui` and `apps/worker`.
- `npm run build` succeeds in `apps/recipe-ui`.
- Manual smoke test passes on iOS device (TestFlight build or Safari over tunnel).
- Hamburger drawer is gone (`grep MenuIcon src/App.jsx` returns nothing).
- Editor's Picks + Trending Health appear ONLY on `DiscoverPage`.
- Friends slide up; FAB protrudes 28px above the bar.

---

## Decisions log (inherited from spec)

See [`docs/superpowers/specs/2026-05-02-homepage-bottom-nav-redesign.md`](../specs/2026-05-02-homepage-bottom-nav-redesign.md) for the full design and decision rationale.
