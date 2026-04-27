# Unified Recipe Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap on any recipe-card share icon opens a bottom action sheet offering "Share with Friends" (iOS share sheet → SMS rich preview / email) and "Share with Connections" (multi-select drawer of ReciFriend friends).

**Architecture:** New `ShareSheet` component (MUI `Drawer anchor="bottom"`) is the single chooser. `FriendPicker` is refactored from a `Dialog` to a `Drawer` with iMessage-style avatar-overlay selection. App.jsx collapses three existing share handlers into one `openShareSheet(recipe, event)` that branches on `session`. SMS rich preview already works via the existing OG middleware — no worker or middleware changes.

**Tech Stack:** React 18, MUI v5, Vitest + @testing-library/react, Cloudflare Pages Functions (existing OG middleware).

**Spec:** [docs/superpowers/specs/2026-04-19-unified-recipe-share-design.md](../specs/2026-04-19-unified-recipe-share-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/recipe-ui/src/components/ShareSheet.jsx` (new) | Bottom-drawer chooser — two rows: "Share with Friends" / "Share with Connections". Pure presentational + click handlers. |
| `apps/recipe-ui/src/components/ShareSheet.test.jsx` (new) | Renders both rows, fires correct callbacks, dismisses on backdrop. |
| `apps/recipe-ui/src/components/FriendPicker.jsx` (modify) | Replace `Dialog` with `Drawer anchor="bottom"`. Replace MUI `Checkbox` + `ListItem` with custom row using `Avatar` + overlay-badge. Keep all existing props and behavior. |
| `apps/recipe-ui/src/components/FriendPicker.test.jsx` (modify) | Adjust the "shows zero state with copy-link fallback" assertions only if needed. Existing click-by-name selectors must keep working. |
| `apps/recipe-ui/src/App.jsx` (modify) | Add `shareSheetState` + `openShareSheet(recipe, event)`. Mount `<ShareSheet>` near existing `<FriendPicker>`. Replace three current call-sites: `RecipesPage onShare`, `FriendSections onShareRecipe`, `PublicLanding onShare`. Existing `handleShare` body becomes `triggerNativeShare` (renamed, behavior preserved). Existing share `<Menu>` stays as desktop fallback. |

---

## Task 1: ShareSheet component (TDD)

**Files:**
- Create: `apps/recipe-ui/src/components/ShareSheet.jsx`
- Create: `apps/recipe-ui/src/components/ShareSheet.test.jsx`

- [ ] **Step 1: Write the failing tests**

Write to `apps/recipe-ui/src/components/ShareSheet.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareSheet } from './ShareSheet';

describe('ShareSheet', () => {
  it('does not render contents when closed', () => {
    render(<ShareSheet open={false} onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.queryByText(/Share with Friends/i)).not.toBeInTheDocument();
  });

  it('renders both share rows when open', () => {
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.getByText(/Share with Friends/i)).toBeInTheDocument();
    expect(screen.getByText(/Share with Connections/i)).toBeInTheDocument();
  });

  it('clicking "Share with Friends" calls onPickFriends', () => {
    const onPickFriends = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={onPickFriends} onPickConnections={() => {}} />);
    fireEvent.click(screen.getByText(/Share with Friends/i));
    expect(onPickFriends).toHaveBeenCalledTimes(1);
  });

  it('clicking "Share with Connections" calls onPickConnections', () => {
    const onPickConnections = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={onPickConnections} />);
    fireEvent.click(screen.getByText(/Share with Connections/i));
    expect(onPickConnections).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd apps/recipe-ui && npx vitest run src/components/ShareSheet.test.jsx`
Expected: FAIL — "Cannot find module './ShareSheet'"

- [ ] **Step 3: Implement ShareSheet**

Write to `apps/recipe-ui/src/components/ShareSheet.jsx`:

```jsx
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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd apps/recipe-ui && npx vitest run src/components/ShareSheet.test.jsx`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/components/ShareSheet.jsx apps/recipe-ui/src/components/ShareSheet.test.jsx
git commit -m "feat(ui): add ShareSheet bottom-drawer chooser component"
```

---

## Task 2: Refactor FriendPicker to bottom Drawer with avatar-overlay selection

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendPicker.jsx`
- Modify: `apps/recipe-ui/src/components/FriendPicker.test.jsx` (only if existing tests break)

- [ ] **Step 1: Run existing tests to confirm baseline passes**

Run: `cd apps/recipe-ui && npx vitest run src/components/FriendPicker.test.jsx`
Expected: PASS — all 6 existing tests passing.

- [ ] **Step 2: Add a new failing test for avatar-overlay selection state**

Add to `apps/recipe-ui/src/components/FriendPicker.test.jsx` (inside the `describe('FriendPicker', ...)` block, after the empty-state test):

```jsx
  it('shows a checkmark badge on the selected friend\'s avatar', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    fireEvent.click(screen.getByText('Alice'));
    const aliceRow = screen.getByText('Alice').closest('[data-testid="friend-row"]');
    expect(aliceRow).toHaveAttribute('data-selected', 'true');
    const bobRow = screen.getByText('Bob').closest('[data-testid="friend-row"]');
    expect(bobRow).toHaveAttribute('data-selected', 'false');
  });
```

- [ ] **Step 3: Run tests and verify the new test fails**

Run: `cd apps/recipe-ui && npx vitest run src/components/FriendPicker.test.jsx`
Expected: 6 PASS, 1 FAIL — "Unable to find an element by selector `[data-testid="friend-row"]`".

- [ ] **Step 4: Refactor FriendPicker**

Replace the entire contents of `apps/recipe-ui/src/components/FriendPicker.jsx` with:

```jsx
import { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Button,
  Stack,
  Avatar,
  Alert,
  Typography,
  IconButton,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

function FriendRow({ friend, selected, onToggle }) {
  return (
    <Box
      data-testid="friend-row"
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onToggle(friend.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(friend.id);
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : 'transparent',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Avatar src={friend.avatar_url ?? undefined}>
          {(friend.display_name ?? '?').charAt(0)}
        </Avatar>
        {selected && (
          <Box
            sx={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid',
              borderColor: 'background.paper',
            }}
          >
            <CheckIcon sx={{ fontSize: 12 }} />
          </Box>
        )}
      </Box>
      <Typography sx={{ flex: 1, fontWeight: 500 }}>
        {friend.display_name ?? friend.id}
      </Typography>
    </Box>
  );
}

export function FriendPicker({ open, friends, onClose, onSend }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setBusy(false);
      setResult(null);
    }
  }, [open]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    setResult(null);
    setBusy(true);
    const ids = Array.from(selected);
    const res = await onSend(ids);
    setBusy(false);
    if (res.ok) {
      setResult({ kind: 'success', count: res.value.shared_with });
    } else if (res.error?.code === 'RATE_LIMITED') {
      setResult({
        kind: 'error',
        message: `You've shared too much recently. Try again in ${Math.ceil(res.error.retry_after_seconds / 60)} minutes.`,
      });
    } else if (res.error?.code === 'NOT_FRIENDS') {
      setResult({ kind: 'error', message: "Some of those friends aren't connected with you yet." });
    } else {
      setResult({ kind: 'error', message: 'Something went wrong. Try again.' });
    }
  };

  const handleCopyLink = () => onClose('copy-link');

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onClose()}
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 'env(safe-area-inset-bottom)',
            maxHeight: '85vh',
          },
        },
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
          <Typography variant="h6">Share this recipe</Typography>
          <IconButton onClick={() => onClose()} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ overflowY: 'auto', px: 1, pb: 1 }}>
          {friends.length === 0 ? (
            <Box sx={{ px: 2, py: 3 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                You don&apos;t have friends yet on ReciFriend.
              </Typography>
              <Button onClick={handleCopyLink} variant="outlined">Copy link</Button>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {friends.map((f) => (
                <FriendRow
                  key={f.id}
                  friend={f}
                  selected={selected.has(f.id)}
                  onToggle={toggle}
                />
              ))}
            </Stack>
          )}
          {result?.kind === 'success' && (
            <Alert severity="success" sx={{ mt: 2, mx: 1 }}>
              Shared with {result.count} friend{result.count === 1 ? '' : 's'}
            </Alert>
          )}
          {result?.kind === 'error' && (
            <Alert severity="error" sx={{ mt: 2, mx: 1 }}>
              {result.message}
            </Alert>
          )}
        </Box>

        {friends.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <Button onClick={handleCopyLink}>Copy link</Button>
            <Button
              onClick={handleSend}
              variant="contained"
              disabled={busy || selected.size === 0}
            >
              Send
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
```

- [ ] **Step 5: Run all FriendPicker tests and verify they pass**

Run: `cd apps/recipe-ui && npx vitest run src/components/FriendPicker.test.jsx`
Expected: PASS — all 7 tests (6 original + 1 new).

If any of the original tests fail because they relied on the `Checkbox` role or `dialog` role, the failure must be in selectors not in behavior. The original tests only use `screen.getByText('Alice')` and `screen.getByRole('button', ...)` — both still work with the new structure.

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-ui/src/components/FriendPicker.jsx apps/recipe-ui/src/components/FriendPicker.test.jsx
git commit -m "refactor(friend-picker): bottom Drawer + avatar-overlay selection"
```

---

## Task 3: Wire ShareSheet into App.jsx (single entry point)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

This task collapses the three existing share entry points into one. It is a refactor — no new behavior — so we verify by manual inspection of the diff and a smoke run of all worker/UI tests, not new unit tests (the App.jsx file isn't unit tested).

- [ ] **Step 1: Add ShareSheet import**

In `apps/recipe-ui/src/App.jsx`, find the line:

```jsx
import { FriendPicker } from './components/FriendPicker';
```

(currently line 105). Add immediately below it:

```jsx
import { ShareSheet } from './components/ShareSheet';
```

- [ ] **Step 2: Add `shareSheetState` to the existing share state**

In `apps/recipe-ui/src/App.jsx`, find:

```jsx
  const [shareMenuState, setShareMenuState] = useState(null); // { anchorEl, url, title }
```

(currently line 1165). Add immediately below it:

```jsx
  const [shareSheetState, setShareSheetState] = useState(null); // { recipe, anchorEvent }
```

- [ ] **Step 3: Rename `handleShare` → `triggerNativeShare` and add `openShareSheet`**

In `apps/recipe-ui/src/App.jsx`, find the function declaration:

```jsx
  const handleShare = async (recipe, anchorPosition) => {
```

(currently line 3921). Rename it to `triggerNativeShare`. Its body is unchanged.

Then immediately above the renamed function, add the unified entry point:

```jsx
  const openShareSheet = (recipe, event) => {
    const anchorPosition = event?.currentTarget
      ? { top: event.currentTarget.getBoundingClientRect().bottom, left: event.currentTarget.getBoundingClientRect().left }
      : { top: window.innerHeight / 2, left: window.innerWidth / 2 };
    if (!session) {
      // Logged-out: skip chooser, go straight to native share with no auth required.
      handleSharePublicRecipe(recipe, event);
      return;
    }
    setShareSheetState({ recipe, anchorPosition });
  };

  const handleShareSheetPickFriends = () => {
    const state = shareSheetState;
    setShareSheetState(null);
    if (state) triggerNativeShare(state.recipe, state.anchorPosition);
  };

  const handleShareSheetPickConnections = () => {
    const state = shareSheetState;
    setShareSheetState(null);
    if (state?.recipe?.id) openSharePicker(state.recipe.id);
  };
```

Note: `triggerNativeShare` currently takes `anchorPosition` as second arg (an object), not the raw event. Both `openShareSheet` (above) and the existing call-sites already pass the position object. We pass the same shape here.

- [ ] **Step 4: Re-wire the three call-sites to use `openShareSheet`**

In `apps/recipe-ui/src/App.jsx`:

a) Find:

```jsx
          onShare={handleSharePublicRecipe}
```

(currently line 4507, inside the `<PublicLanding>` element). Replace with:

```jsx
          onShare={(recipe, event) => openShareSheet(recipe, event)}
```

b) Find:

```jsx
                  onShareRecipe={(recipe) => openSharePicker(recipe?.id) /* [S04] */}
```

(currently line 4538, inside `<FriendSections>`). Replace with:

```jsx
                  onShareRecipe={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
```

c) Find:

```jsx
                handleShare={(recipe) => openSharePicker(recipe?.id) /* [S04] */}
```

(currently line 4566, inside `<RecipesPage>`). Replace with:

```jsx
                handleShare={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
```

d) Find:

```jsx
                      onShare={(r, e) => handleShare(r, e)}
```

(currently line 5639). Replace with:

```jsx
                      onShare={(r, e) => openShareSheet(r, e)}
```

- [ ] **Step 5: Mount `<ShareSheet>` in the JSX**

In `apps/recipe-ui/src/App.jsx`, find the existing `<FriendPicker>` mount block:

```jsx
      {/* === [S04] Friend picker wiring === */}
      <FriendPicker
        open={pickerOpen}
        friends={friends}
        onClose={handlePickerClose}
        onSend={handlePickerSend}
      />
      {/* === [/S04] === */}
```

(currently lines 4482-4489). Add immediately above this block:

```jsx
      <ShareSheet
        open={Boolean(shareSheetState)}
        onClose={() => setShareSheetState(null)}
        onPickFriends={handleShareSheetPickFriends}
        onPickConnections={handleShareSheetPickConnections}
      />

```

- [ ] **Step 6: Run worker tests + UI component tests to confirm nothing broke**

Run in parallel:
```bash
cd apps/recipe-ui && npx vitest run
```
```bash
cd apps/worker && npm test
```
Expected: all tests PASS. (Worker tests aren't touched by this change but we run them as a sanity check.)

- [ ] **Step 7: Build the frontend to catch any syntax / import errors**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): unified share — ShareSheet chooser routes to native share or FriendPicker"
```

---

## Task 4: Tunnel verification (manual on phone)

**Files:** none — this is verification, not code.

Per CLAUDE.md and the project memory, the tunnel preview is the canonical mobile-test path before deploy.

- [ ] **Step 1: Confirm `allowedHosts: true` in vite config**

Read: `apps/recipe-ui/vite.config.js`
Expected: file contains `allowedHosts: true` (boolean, not the string `'all'`).

If missing, add it inside the `server: { ... }` block and commit separately:
```bash
git add apps/recipe-ui/vite.config.js
git commit -m "chore(ui): allow tunnel hosts in vite dev server"
```

- [ ] **Step 2: Start the dev server**

Run in background: `cd apps/recipe-ui && npm run dev -- --host`
Expected: Vite prints both Local and Network URLs on port 5173.

- [ ] **Step 3: Start the cloudflared tunnel**

Run in background: `cloudflared tunnel --url http://localhost:5173`
Expected: tunnel prints a `https://xxxx.trycloudflare.com` URL.

- [ ] **Step 4: Add the tunnel URL to Supabase redirect URLs**

In Supabase dashboard → project `jpjuaaxwfpemecbwwthk` → Auth → URL Configuration → Redirect URLs, add `https://xxxx.trycloudflare.com/**`. (User action — pause and ask the user to do this.)

- [ ] **Step 5: Open the URL on phone and walk the verification checklist**

Ask the user to:

1. Open the tunnel URL on their phone.
2. While **logged out**: tap the share icon on any landing-page recipe card. Confirm the iOS share sheet opens **directly** (no chooser).
3. **Sign in** with Google.
4. Tap the share icon on a recipe in the home feed (FriendSections). Confirm the **bottom action sheet** appears with two rows.
5. Tap **"Share with Friends"** → confirm the iOS share sheet opens. Tap **Messages** → pick a contact → confirm the recipe URL renders as a **rich card with thumbnail and title** in the message bubble.
6. Back in the app, tap share again → tap **"Share with Connections"** → confirm the bottom drawer opens with the friends list. Confirm:
   - Tapping a row toggles a checkmark badge on the avatar.
   - Selected row has a tinted background.
   - Send button enables once at least one friend is selected.
   - Sending shows the success alert.
7. Navigate to the Recipes collection view → tap share on any card → confirm the chooser appears (same behavior as #4).
8. Open a recipe detail dialog → tap the Share button → confirm the chooser appears.

Document any issue inline before proceeding to deploy.

- [ ] **Step 6: Stop the tunnel and dev server**

When verification passes, stop the background processes.

---

## Task 5 (optional): Remove the old per-card share Menu if no longer needed

**Files:** `apps/recipe-ui/src/App.jsx`

The existing anchored share `<Menu>` at lines ~4585-4634 is the desktop fallback called by `triggerNativeShare` when `navigator.share` is unavailable. **Keep it** — it is still reached via that fallback path on desktop browsers without Web Share API support.

This task only exists to make explicit: do **not** delete the share `<Menu>` block.

---

## Self-Review Notes

- **Spec coverage:**
  - § Entry point — Task 3 (single `openShareSheet`).
  - § Action sheet UI — Task 1.
  - § Connection picker (refactored FriendPicker) — Task 2.
  - § SMS rich preview — Task 4 step 5 (manual verification; no code change required since middleware already handles it).
  - § Logged-out skips chooser — Task 3 step 3 (`if (!session)` branch).
  - § Out-of-scope (no Capacitor Share, no middleware change, no FriendPicker logic change) — respected.
- **Placeholder scan:** none.
- **Type consistency:**
  - `ShareSheet` props (`open`, `onClose`, `onPickFriends`, `onPickConnections`) match between Task 1 implementation and Task 3 mount.
  - `FriendPicker` public API (`open`, `friends`, `onClose`, `onSend`) is unchanged in Task 2 — App.jsx wiring untouched.
  - `openShareSheet(recipe, event)` signature matches all four call-sites in Task 3 step 4.
