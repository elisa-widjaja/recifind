# Story 04 — Friend Picker UI (Web PWA)

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Add a friend picker modal to the recipe detail Share button. User selects friends, taps Send → `POST /recipes/:id/share`. Works identically in web PWA and iOS (same React component). Develop first against a mock API; integrate with real Story 03 endpoint at Gate G1.

**Depends on:** Story 02 (contracts)
**Blocks:** Gate G1
**Can develop in parallel with:** Stories 03, 05, 06, 07, 08

**Contracts consumed:** C1 Share API (imports `ShareRecipeRequest`, `ShareRecipeResponse`, `ShareRecipeError` from `apps/shared/contracts.ts`)
**Contracts produced:** none

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/recipe-ui/src/components/FriendPicker.jsx` | Modal component |
| Create | `apps/recipe-ui/src/components/FriendPicker.test.jsx` | Component tests (vitest + testing-library) |
| Create | `apps/recipe-ui/src/lib/shareRecipe.js` | API call wrapper |
| Create | `apps/recipe-ui/src/lib/shareRecipe.test.js` | Tests with mocked fetch |
| Modify | `apps/recipe-ui/src/App.jsx` | Wire picker into recipe detail Share button. Marker: `// === [S04] Friend picker wiring ===` … `// === [/S04] ===` |

---

## Task 1: API wrapper with tests

- [ ] **Step 1:** Create `apps/recipe-ui/src/lib/shareRecipe.test.js`

```js
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { shareRecipe } from './shareRecipe';

describe('shareRecipe', () => {
  const BASE = 'https://api.recifriend.com';
  const TOKEN = 'test-token';
  const RECIPE = 'rec-1';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('POSTs to /recipes/:id/share with bearer auth', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ shared_with: 2, skipped: 0 })));
    await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a', 'b'] });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/recipes/${RECIPE}/share`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ recipient_user_ids: ['a', 'b'] }),
      })
    );
  });

  it('returns parsed success response', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ shared_with: 3, skipped: 1 }), { status: 200 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a'] });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ shared_with: 3, skipped: 1 });
  });

  it('returns typed error on 400 NOT_FRIENDS', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FRIENDS', non_friend_user_ids: ['x'] }), { status: 400 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['x'] });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FRIENDS');
    expect(res.error.non_friend_user_ids).toEqual(['x']);
  });

  it('returns typed error on 429 RATE_LIMITED', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'RATE_LIMITED', retry_after_seconds: 600 }), { status: 429 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a'] });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('RATE_LIMITED');
    expect(res.error.retry_after_seconds).toBe(600);
  });
});
```

- [ ] **Step 2:** Run to confirm failing

```bash
cd apps/recipe-ui && npm test -- shareRecipe
```

Expected: fails with `shareRecipe is not defined`.

- [ ] **Step 3:** Create `apps/recipe-ui/src/lib/shareRecipe.js`

```js
// apps/recipe-ui/src/lib/shareRecipe.js
/** @typedef {import('../../../shared/contracts').ShareRecipeRequest} ShareRecipeRequest */
/** @typedef {import('../../../shared/contracts').ShareRecipeResponse} ShareRecipeResponse */
/** @typedef {import('../../../shared/contracts').ShareRecipeError} ShareRecipeError */

export async function shareRecipe({ apiBase, jwt, recipeId, recipientUserIds }) {
  const res = await fetch(`${apiBase}/recipes/${recipeId}/share`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_user_ids: recipientUserIds }),
  });
  const body = await res.json();
  if (res.ok) return { ok: true, value: body };
  return { ok: false, error: body };
}
```

- [ ] **Step 4:** Tests pass

```bash
npm test -- shareRecipe
```

- [ ] **Step 5:** Commit

```bash
git add apps/recipe-ui/src/lib/shareRecipe.js apps/recipe-ui/src/lib/shareRecipe.test.js
git commit -m "feat(ui): add shareRecipe API wrapper"
```

## Task 2: FriendPicker component tests

- [ ] **Step 1:** Create `apps/recipe-ui/src/components/FriendPicker.test.jsx`

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendPicker } from './FriendPicker';

const FRIENDS = [
  { id: 'f1', display_name: 'Alice', avatar_url: null },
  { id: 'f2', display_name: 'Bob', avatar_url: null },
  { id: 'f3', display_name: 'Carol', avatar_url: null },
];

describe('FriendPicker', () => {
  it('renders each friend as a selectable row', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('Send button is disabled when nothing is selected', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('selecting a friend enables Send and passes ids to onSend', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true, value: { shared_with: 2, skipped: 0 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Bob'));
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(['f1', 'f2']));
  });

  it('shows success toast-like message after Send', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true, value: { shared_with: 1, skipped: 0 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/shared with 1 friend/i)).toBeInTheDocument());
  });

  it('shows rate-limit error after 429', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED', retry_after_seconds: 600 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument());
  });

  it('empty friend list shows zero state with copy-link fallback', () => {
    render(<FriendPicker open friends={[]} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByText(/you don't have friends yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** Run to fail

```bash
cd apps/recipe-ui && npm test -- FriendPicker
```

- [ ] **Step 3:** Commit failing test

```bash
git add apps/recipe-ui/src/components/FriendPicker.test.jsx
git commit -m "test(friend-picker): add failing tests"
```

## Task 3: Implement FriendPicker

- [ ] **Step 1:** Create `apps/recipe-ui/src/components/FriendPicker.jsx`

```jsx
import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItem, ListItemButton, Checkbox, ListItemText, Avatar, ListItemAvatar, Alert, Typography } from '@mui/material';

export function FriendPicker({ open, friends, onClose, onSend }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);  // { kind: 'success', count } | { kind: 'error', message }

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleSend = async () => {
    setBusy(true);
    const ids = Array.from(selected);
    const res = await onSend(ids);
    setBusy(false);
    if (res.ok) {
      setResult({ kind: 'success', count: res.value.shared_with });
    } else if (res.error?.code === 'RATE_LIMITED') {
      setResult({ kind: 'error', message: `You've shared too much recently. Try again in ${Math.ceil(res.error.retry_after_seconds / 60)} minutes.` });
    } else if (res.error?.code === 'NOT_FRIENDS') {
      setResult({ kind: 'error', message: 'Some of those friends aren\'t connected with you yet.' });
    } else {
      setResult({ kind: 'error', message: 'Something went wrong. Try again.' });
    }
  };

  const handleCopyLink = () => {
    // Fallback — owner of <Dialog /> can handle via onClose callback sequence.
    // For this component: rely on App.jsx to wrap; expose a simple callback.
    onClose('copy-link');
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={() => onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Share this recipe</DialogTitle>
      <DialogContent>
        {friends.length === 0 ? (
          <>
            <Typography variant="body2">You don't have friends yet on ReciFriend.</Typography>
            <Button onClick={handleCopyLink} sx={{ mt: 2 }}>Copy link instead</Button>
          </>
        ) : (
          <List>
            {friends.map((f) => (
              <ListItem key={f.id} disablePadding>
                <ListItemButton onClick={() => toggle(f.id)}>
                  <Checkbox edge="start" checked={selected.has(f.id)} tabIndex={-1} disableRipple />
                  <ListItemAvatar>
                    <Avatar src={f.avatar_url ?? undefined}>{(f.display_name ?? '?').charAt(0)}</Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={f.display_name ?? f.id} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {result?.kind === 'success' && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Shared with {result.count} friend{result.count === 1 ? '' : 's'}
          </Alert>
        )}
        {result?.kind === 'error' && (
          <Alert severity="error" sx={{ mt: 2 }}>{result.message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Cancel</Button>
        <Button onClick={handleCopyLink}>Copy link</Button>
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={busy || selected.size === 0 || friends.length === 0}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2:** Tests pass

```bash
npm test -- FriendPicker
```

- [ ] **Step 3:** Commit

```bash
git add apps/recipe-ui/src/components/FriendPicker.jsx
git commit -m "feat(friend-picker): modal component with multi-select + state"
```

## Task 4: Wire into App.jsx

- [ ] **Step 1:** Find the current recipe detail Share button (copy-link behavior) in `apps/recipe-ui/src/App.jsx`. It's behind a function often named `handleShare` or similar.

- [ ] **Step 2:** Add S04-marked imports and state near the top of the App component:

```jsx
// === [S04] Friend picker wiring ===
import { FriendPicker } from './components/FriendPicker';
import { shareRecipe } from './lib/shareRecipe';
// (keep the rest of App.jsx as-is)
// === [/S04] ===
```

- [ ] **Step 3:** Inside the App function, add picker state (wrapped in S04 markers):

```jsx
// === [S04] Friend picker wiring ===
const [pickerOpen, setPickerOpen] = useState(false);
const [pickerRecipeId, setPickerRecipeId] = useState(null);
const [friends, setFriends] = useState([]);  // populated from GET /friends

const openSharePicker = async (recipeId) => {
  setPickerRecipeId(recipeId);
  const friendsRes = await fetch(`${apiBase}/friends`, { headers: { Authorization: `Bearer ${jwt}` } });
  setFriends(await friendsRes.json());
  setPickerOpen(true);
};

const handlePickerSend = async (recipientUserIds) => {
  return await shareRecipe({ apiBase, jwt, recipeId: pickerRecipeId, recipientUserIds });
};

const handlePickerClose = (action) => {
  setPickerOpen(false);
  if (action === 'copy-link') {
    navigator.clipboard.writeText(`https://recifriend.com/recipes/${pickerRecipeId}`);
  }
};
// === [/S04] ===
```

- [ ] **Step 4:** Replace existing `handleShare` behavior with `openSharePicker(recipe.id)`. Keep the rest of the old function's behavior (e.g., close other dialogs) if present.

- [ ] **Step 5:** Render the picker near other top-level dialogs:

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

- [ ] **Step 6:** Tunnel preview

```bash
cd apps/recipe-ui && npm run dev -- --host
# Open tunnel URL on a mobile + desktop.
# Click Share on a recipe → picker appears with friends list.
# Select friends → Send → expect "Shared with N" alert.
```

- [ ] **Step 7:** Commit

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): wire FriendPicker into recipe detail Share button"
```

## Task 5: Build + deploy to production (part of Gate G1)

Only do this step once Story 03 has deployed its backend.

- [ ] **Step 1:** Verify backend is live

```bash
curl -i https://api.recifriend.com/recipes/seed-edit-01/share \
  -X POST -H "Authorization: Bearer <valid>" \
  -H "Content-Type: application/json" -d '{"recipient_user_ids":["test"]}'
```

- [ ] **Step 2:** Build + deploy

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

- [ ] **Step 3:** Manual E2E on prod with two test accounts — share a recipe, see it land in recipient's `📤 recently shared` feed.

## Acceptance criteria

- [ ] All 6 FriendPicker tests + 4 shareRecipe tests pass
- [ ] Picker opens from Share button; friend list populates from `/friends`
- [ ] Multi-select → Send → success toast
- [ ] Rate-limit error surfaces to user in minutes
- [ ] Empty-friends state shows Copy link fallback
- [ ] Every S04 edit is inside marker pairs in `App.jsx`
- [ ] Gate G1 manual test passes: two accounts, recipient sees shared recipe in feed

## Commit checklist

- `feat(ui): add shareRecipe API wrapper`
- `test(friend-picker): add failing tests`
- `feat(friend-picker): modal component ...`
- `feat(ui): wire FriendPicker into recipe detail ...`
