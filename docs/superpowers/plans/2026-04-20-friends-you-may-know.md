# Friends You May Know Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "Friends you may know" horizontal-scroll shelf above Editor's Picks on the logged-in home feed, as a reusable `<SuggestionsShelf>` component.

**Architecture:** Backend `GET /friends/suggestions` is already wired (route + `handleFriendSuggestions` + `resolveEmailFromUserId` + `userId` path on `POST /friends/request`). This plan slims the handler's return shape to `{ userId, name, kind, mutualCount | sharedPref }` (no name leak, no reason string on server), builds the frontend component, and threads it into the home feed. No D1 schema changes.

**Tech Stack:** Cloudflare Workers (TypeScript), Cloudflare D1, React 18 + MUI 5, vitest + React Testing Library for frontend tests, vitest + mocked D1 for backend tests.

**Spec:** [docs/superpowers/specs/2026-04-20-friends-you-may-know-design.md](../specs/2026-04-20-friends-you-may-know-design.md)

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `apps/worker/src/index.ts` | Modify (replace function body) | Slim `handleFriendSuggestions` return shape |
| `apps/worker/src/friends-suggestions.test.ts` | Modify | Update tests to expect new shape |
| `apps/recipe-ui/src/components/SuggestionsShelf.jsx` | Create | Self-contained shelf: fetch, state, render, add, dismiss |
| `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx` | Create | Component tests (render, add→requested, dismiss) |
| `apps/recipe-ui/src/components/FriendSections.jsx` | Modify | Accept `onOpenFriends` prop, render `<SuggestionsShelf>` above Editor's Picks |
| `apps/recipe-ui/src/App.jsx` | Modify | Pass `onOpenFriends={() => setIsFriendsDialogOpen(true)}` to `<FriendSections>` |

---

## Chunk 1: Backend

### Task 1: Slim `handleFriendSuggestions` return shape

**Files:**
- Modify: `apps/worker/src/index.ts` (function body at ~line 2019–2096)
- Modify: `apps/worker/src/friends-suggestions.test.ts`

The existing handler returns `{ userId, name, reason: string }`. The new contract is a discriminated union:

```ts
type Suggestion =
  | { userId: string; name: string; kind: 'fof'; mutualCount: number }
  | { userId: string; name: string; kind: 'pref'; sharedPref: string };
```

Drop `GROUP_CONCAT(mp.display_name)` and the `JOIN profiles mp` from the FOF query. Backend no longer sends mutual-friend names. For pref-match rows, return `sharedPref` (first overlap or fallback). The `/friends/suggestions` route (line 645) already returns whatever this handler returns — no route change needed.

- [ ] **Step 1: Update tests to expect the new shape**

Replace the contents of `apps/worker/src/friends-suggestions.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleFriendSuggestions, resolveEmailFromUserId } from './index';

describe('handleFriendSuggestions', () => {
  it('returns FOF suggestions tagged kind="fof" with mutualCount, sorted desc', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: fofResults }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ dietary_prefs: '["Vegetarian"]', meal_type_prefs: '["Dinner"]' }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toEqual({
      userId: 'user-b',
      name: 'Maya R.',
      kind: 'fof',
      mutualCount: 2,
    });
    expect(result.suggestions[1]).toEqual({
      userId: 'user-c',
      name: 'James T.',
      kind: 'fof',
      mutualCount: 1,
    });
  });

  it('returns empty array when no FOF and no prefs', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');
    expect(result.suggestions).toHaveLength(0);
  });

  it('falls back to pref-match when FOF < 5 and tags rows kind="pref" with sharedPref', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 1 },
    ];
    const prefResults = [
      { userId: 'user-d', name: 'Priya S.', dietary_prefs: '["Vegetarian","Gluten-free"]', meal_type_prefs: null },
      { userId: 'user-e', name: 'Nora K.', dietary_prefs: null, meal_type_prefs: '["Dinner"]' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: fofResults }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ dietary_prefs: '["Vegetarian"]', meal_type_prefs: '["Dinner"]' }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: prefResults }),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].kind).toBe('fof');
    expect(result.suggestions[1]).toEqual({
      userId: 'user-d',
      name: 'Priya S.',
      kind: 'pref',
      sharedPref: 'Vegetarian',
    });
    expect(result.suggestions[2]).toEqual({
      userId: 'user-e',
      name: 'Nora K.',
      kind: 'pref',
      sharedPref: 'Dinner',
    });
  });

  it('skips pref-match when FOF >= 5', async () => {
    const fofResults = [
      { userId: 'u1', name: 'A', mutualCount: 3 },
      { userId: 'u2', name: 'B', mutualCount: 2 },
      { userId: 'u3', name: 'C', mutualCount: 2 },
      { userId: 'u4', name: 'D', mutualCount: 1 },
      { userId: 'u5', name: 'E', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValueOnce({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: fofResults }),
      }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.every(s => s.kind === 'fof')).toBe(true);
    // Only the FOF query should have been prepared (no profile fetch, no pref query)
    expect((mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('resolveEmailFromUserId', () => {
  it('returns email string when profile found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ email: 'maya@example.com' }),
      }),
    } as unknown as D1Database;

    const email = await resolveEmailFromUserId(mockDb, 'user-b');
    expect(email).toBe('maya@example.com');
  });

  it('returns null when user not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;

    const email = await resolveEmailFromUserId(mockDb, 'unknown-user');
    expect(email).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: FAIL — the existing handler returns `{ reason: string }` not `{ kind, mutualCount | sharedPref }`.

- [ ] **Step 3: Replace `handleFriendSuggestions` with the slim version**

In `apps/worker/src/index.ts`, replace the entire function body (lines ~2019–2096) with:

```typescript
export async function handleFriendSuggestions(
  db: D1Database,
  userId: string
): Promise<{
  suggestions: Array<
    | { userId: string; name: string; kind: 'fof'; mutualCount: number }
    | { userId: string; name: string; kind: 'pref'; sharedPref: string }
  >;
}> {
  // --- FOF pass (no GROUP_CONCAT, no name leak) ---
  const fofRows = await db.prepare(`
    SELECT
      f2.friend_id                  AS userId,
      p.display_name                AS name,
      COUNT(DISTINCT f1.friend_id)  AS mutualCount
    FROM friends f1
    JOIN friends f2 ON f2.user_id = f1.friend_id
    JOIN profiles p ON p.user_id = f2.friend_id
    WHERE f1.user_id = ?
      AND f2.friend_id != ?
      AND f2.friend_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND f2.friend_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
    GROUP BY f2.friend_id
    ORDER BY mutualCount DESC
    LIMIT 10
  `).bind(userId, userId, userId, userId).all<{ userId: string; name: string; mutualCount: number }>();

  const fofSuggestions = (fofRows.results || []).map(row => ({
    userId: row.userId,
    name: row.name,
    kind: 'fof' as const,
    mutualCount: row.mutualCount,
  }));

  if (fofSuggestions.length >= 5) {
    return { suggestions: fofSuggestions };
  }

  // --- Pref-match fallback ---
  const alreadySuggested = new Set(fofSuggestions.map(s => s.userId));
  const myProfile = await db.prepare(
    'SELECT dietary_prefs, meal_type_prefs FROM profiles WHERE user_id = ?'
  ).bind(userId).first<{ dietary_prefs: string | null; meal_type_prefs: string | null }>();

  const myDietaryPrefs: string[] = myProfile?.dietary_prefs ? JSON.parse(myProfile.dietary_prefs) : [];
  const myMealPrefs: string[] = myProfile?.meal_type_prefs ? JSON.parse(myProfile.meal_type_prefs) : [];
  const allMyPrefs = [...myDietaryPrefs, ...myMealPrefs].filter(p => p && p !== 'None / all good');

  if (allMyPrefs.length === 0) {
    return { suggestions: fofSuggestions };
  }

  const remaining = 10 - fofSuggestions.length;
  const likeClauses = allMyPrefs.map(() => `(p.dietary_prefs LIKE ? OR p.meal_type_prefs LIKE ?)`).join(' OR ');
  const likeBinds = allMyPrefs.flatMap(pref => [`%${pref}%`, `%${pref}%`]);

  const prefRows = await db.prepare(`
    SELECT p.user_id AS userId, p.display_name AS name, p.dietary_prefs, p.meal_type_prefs
    FROM profiles p
    WHERE p.user_id != ?
      AND p.user_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND p.user_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
      AND (${likeClauses})
    ORDER BY p.display_name ASC
    LIMIT ?
  `).bind(userId, userId, userId, ...likeBinds, remaining).all<{
    userId: string;
    name: string;
    dietary_prefs: string | null;
    meal_type_prefs: string | null;
  }>();

  const prefSuggestions = (prefRows.results || [])
    .filter(row => !alreadySuggested.has(row.userId))
    .map(row => {
      const theirPrefs = [
        ...(row.dietary_prefs ? JSON.parse(row.dietary_prefs) : []),
        ...(row.meal_type_prefs ? JSON.parse(row.meal_type_prefs) : []),
      ];
      const sharedPref = allMyPrefs.find(p => theirPrefs.includes(p)) || theirPrefs[0] || 'cooking';
      return {
        userId: row.userId,
        name: row.name,
        kind: 'pref' as const,
        sharedPref,
      };
    });

  return { suggestions: [...fofSuggestions, ...prefSuggestions] };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run the full worker test suite for regressions**

```bash
cd apps/worker && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Smoke-test live with wrangler dev**

```bash
cd apps/worker && npx wrangler dev --port 8787 --remote
```

In another terminal:

```bash
curl -s -H "Authorization: Bearer $DEV_API_KEY" http://localhost:8787/friends/suggestions | jq .
```

Expected: `{ "suggestions": [...] }` — array items have `kind: "fof"` with `mutualCount` or `kind: "pref"` with `sharedPref`. No `reason` field, no `mutualNames` field.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/friends-suggestions.test.ts
git commit -m "feat(worker): slim /friends/suggestions response shape (kind + count)"
```

---

## Chunk 2: Frontend

### Task 2: Create `SuggestionsShelf` component (TDD)

**Files:**
- Create: `apps/recipe-ui/src/components/SuggestionsShelf.jsx`
- Create: `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx`

The component is self-contained:
- Fetches `/friends/suggestions` on mount
- Owns `requestedIds` + `dismissedIds` (both `Set`, session-only)
- Renders nothing while loading, on fetch error, or when visible count == 0
- Cards: 150×200, gradient-initial avatar, dismiss × top-right, Add friend button pinned bottom
- Reason text:
  - `kind === 'fof'`: `{mutualCount} mutual friend` / `{mutualCount} mutual friends`
  - `kind === 'pref'`: `Likes {sharedPref}`

For testability, allow a `suggestions` prop override — when provided, skip the fetch. Without it, fetch on mount using `accessToken`.

- [ ] **Step 1: Write the failing test file**

Create `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx`:

```jsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuggestionsShelf from './SuggestionsShelf';

const SUGGESTIONS = [
  { userId: 'u1', name: 'Maya R.', kind: 'fof', mutualCount: 2 },
  { userId: 'u2', name: 'James T.', kind: 'fof', mutualCount: 1 },
  { userId: 'u3', name: 'Priya S.', kind: 'pref', sharedPref: 'Vegetarian' },
];

describe('SuggestionsShelf', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per suggestion with name and reason text', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.getByText('Maya R.')).toBeInTheDocument();
    expect(screen.getByText('2 mutual friends')).toBeInTheDocument();
    expect(screen.getByText('James T.')).toBeInTheDocument();
    expect(screen.getByText('1 mutual friend')).toBeInTheDocument();
    expect(screen.getByText('Priya S.')).toBeInTheDocument();
    expect(screen.getByText('Likes Vegetarian')).toBeInTheDocument();
  });

  it('renders "Friends you may know" header and "See all" when onOpenFriends is provided', () => {
    const onOpenFriends = vi.fn();
    render(
      <SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} onOpenFriends={onOpenFriends} />
    );
    expect(screen.getByText('Friends you may know')).toBeInTheDocument();
    const seeAll = screen.getByText('See all');
    fireEvent.click(seeAll);
    expect(onOpenFriends).toHaveBeenCalledTimes(1);
  });

  it('hides "See all" when onOpenFriends is not provided', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.queryByText('See all')).not.toBeInTheDocument();
  });

  it('renders nothing when suggestions list is empty', () => {
    const { container } = render(<SuggestionsShelf accessToken="t" suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('Add friend button flips to Requested (optimistic) and calls POST /friends/request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    render(<SuggestionsShelf accessToken="tok" suggestions={SUGGESTIONS} />);
    const addButtons = screen.getAllByRole('button', { name: /add friend/i });
    fireEvent.click(addButtons[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeDisabled()
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/friends/request'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ userId: 'u1' }),
      })
    );
  });

  it('keeps Requested state on 4xx (e.g. already friends)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 409 });
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    fireEvent.click(screen.getAllByRole('button', { name: /add friend/i })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeDisabled()
    );
  });

  it('reverts Requested to Add friend on 5xx', async () => {
    // Use a controlled promise so we can assert the optimistic state
    // synchronously before the fetch resolves.
    let resolveFetch;
    global.fetch.mockReturnValueOnce(new Promise(r => { resolveFetch = r; }));
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    fireEvent.click(screen.getAllByRole('button', { name: /add friend/i })[0]);
    // Optimistic flip happens synchronously on click
    expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeInTheDocument();
    // Now resolve with 5xx → should revert
    resolveFetch({ ok: false, status: 503 });
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /requested/i })).toHaveLength(0);
    });
  });

  it('dismiss button removes the card from view', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.getByText('Maya R.')).toBeInTheDocument();
    const dismissButtons = screen.getAllByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButtons[0]);
    expect(screen.queryByText('Maya R.')).not.toBeInTheDocument();
    // Other cards still there
    expect(screen.getByText('James T.')).toBeInTheDocument();
  });

  it('unmounts entirely after dismissing all cards', () => {
    const { container } = render(<SuggestionsShelf accessToken="t" suggestions={[SUGGESTIONS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd apps/recipe-ui && npm test -- SuggestionsShelf
```

Expected: FAIL — `Cannot find module './SuggestionsShelf'`.

- [ ] **Step 3: Implement the component**

Create `apps/recipe-ui/src/components/SuggestionsShelf.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { Box, Typography, Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

const SUGGESTION_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #e85d3a)',
  'linear-gradient(135deg, #43b89c, #1976d2)',
  'linear-gradient(135deg, #9b59b6, #e85d8a)',
  'linear-gradient(135deg, #27ae60, #f5a623)',
  'linear-gradient(135deg, #e74c3c, #9b59b6)',
];

function gradientFor(userId) {
  const first = (userId || '?').charCodeAt(0) || 0;
  return SUGGESTION_GRADIENTS[first % SUGGESTION_GRADIENTS.length];
}

function reasonText(s) {
  if (s.kind === 'fof') {
    const n = s.mutualCount;
    return `${n} mutual ${n === 1 ? 'friend' : 'friends'}`;
  }
  return `Likes ${s.sharedPref}`;
}

function initialOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

/**
 * Self-contained "Friends you may know" shelf.
 * Props:
 *   accessToken: string (required for live fetch + add-friend POST)
 *   onOpenFriends?: () => void — if provided, renders "See all"
 *   variant?: 'feed' | 'compact' — reserved; only 'feed' is used today
 *   suggestions?: Array — test-only override; skips the fetch when provided
 */
export default function SuggestionsShelf({ accessToken, onOpenFriends, variant = 'feed', suggestions: suggestionsProp }) {
  const [suggestions, setSuggestions] = useState(suggestionsProp || []);
  const [loading, setLoading] = useState(suggestionsProp === undefined);
  const [requestedIds, setRequestedIds] = useState(() => new Set());
  const [dismissedIds, setDismissedIds] = useState(() => new Set());

  useEffect(() => {
    if (suggestionsProp !== undefined) return;
    if (!accessToken) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/friends/suggestions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return;
        setSuggestions(data?.suggestions || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, suggestionsProp]);

  async function handleAdd(userId) {
    setRequestedIds(prev => new Set([...prev, userId]));
    try {
      const res = await fetch(`${API_BASE_URL}/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok && res.status >= 500) {
        setRequestedIds(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    } catch (_) {
      setRequestedIds(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  function handleDismiss(userId) {
    setDismissedIds(prev => new Set([...prev, userId]));
  }

  if (loading) return null;
  const visible = suggestions.filter(s => !dismissedIds.has(s.userId));
  if (visible.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: 15 }}>
          Friends you may know
        </Typography>
        {onOpenFriends && (
          <Typography
            component="button"
            onClick={onOpenFriends}
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              cursor: 'pointer',
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            See all
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          overflowX: 'auto',
          pb: 0.5,
          WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {visible.map(s => {
          const isRequested = requestedIds.has(s.userId);
          return (
            <Box
              key={s.userId}
              sx={{
                position: 'relative',
                minWidth: 150,
                maxWidth: 150,
                height: 200,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 3,
                p: '16px 10px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                flexShrink: 0,
              }}
            >
              <IconButton
                aria-label={`Dismiss ${s.name}`}
                size="small"
                onClick={() => handleDismiss(s.userId)}
                sx={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  color: 'text.secondary',
                  p: 0.25,
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: gradientFor(s.userId),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {initialOf(s.name)}
              </Box>
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: 14,
                  textAlign: 'center',
                  mt: 1,
                  lineHeight: 1.2,
                  width: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.name}
              </Typography>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <Typography
                  sx={{
                    fontSize: 11,
                    color: 'text.secondary',
                    textAlign: 'center',
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {reasonText(s)}
                </Typography>
              </Box>
              <Button
                variant={isRequested ? 'outlined' : 'contained'}
                disabled={isRequested}
                size="small"
                fullWidth
                onClick={() => !isRequested && handleAdd(s.userId)}
                sx={{
                  flexShrink: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                }}
              >
                {isRequested ? 'Requested' : 'Add friend'}
              </Button>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd apps/recipe-ui && npm test -- SuggestionsShelf
```

Expected: PASS (9 tests).

- [ ] **Step 5: Run the full recipe-ui test suite for regressions**

```bash
cd apps/recipe-ui && npm test
```

Expected: all tests pass (FriendPicker, ShareSheet, etc., plus the new SuggestionsShelf).

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-ui/src/components/SuggestionsShelf.jsx apps/recipe-ui/src/components/SuggestionsShelf.test.jsx
git commit -m "feat(ui): add SuggestionsShelf component (Friends you may know)"
```

---

### Task 3: Integrate the shelf into `FriendSections.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx`

Add an `onOpenFriends` prop, render `<SuggestionsShelf>` immediately before the Editor's Picks block (at line ~171, before `{hasEditorsPick && (...)}`).

- [ ] **Step 1: Add the import**

In `apps/recipe-ui/src/components/FriendSections.jsx`, add below the existing `TrendingHealthCarousel` import (line 5):

```javascript
import SuggestionsShelf from './SuggestionsShelf';
```

- [ ] **Step 2: Update JSDoc and props destructuring**

Replace lines 27–34:

**Before:**
```javascript
/**
 * Logged-in friend discovery sections.
 * Props:
 *   accessToken: string
 *   onOpenRecipe: (recipe) => void
 *   onSaveRecipe: (recipe) => void
 */
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, dietaryPrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, darkMode, onCookWithFriendsVisible }) {
```

**After:**
```javascript
/**
 * Logged-in friend discovery sections.
 * Props:
 *   accessToken: string
 *   onOpenRecipe: (recipe) => void
 *   onSaveRecipe: (recipe) => void
 *   onOpenFriends?: () => void — opens the friends management drawer (threaded into "See all" on the suggestions shelf)
 */
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, dietaryPrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, onOpenFriends, darkMode, onCookWithFriendsVisible }) {
```

- [ ] **Step 3: Insert the shelf before Editor's Picks**

Find the Editor's Picks block at line ~171 (`{hasEditorsPick && (`). Insert this JSX immediately above it, still inside the outer render return:

```jsx
      <SuggestionsShelf accessToken={accessToken} onOpenFriends={onOpenFriends} />

```

The line becomes:

```jsx
      <SuggestionsShelf accessToken={accessToken} onOpenFriends={onOpenFriends} />

      {hasEditorsPick && (
```

- [ ] **Step 4: Run the recipe-ui test suite**

```bash
cd apps/recipe-ui && npm test
```

Expected: all tests pass. `FriendSections` has no direct tests, but if any snapshot tests exist they should still pass since the component self-hides when there are no suggestions.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
git commit -m "feat(ui): render SuggestionsShelf above Editor's Picks in FriendSections"
```

---

### Task 4: Wire `onOpenFriends` from `App.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

`setIsFriendsDialogOpen` already exists (declared at line 1221). Thread a new prop to the `<FriendSections>` usage at line 4612.

- [ ] **Step 1: Add the `onOpenFriends` prop**

In `apps/recipe-ui/src/App.jsx`, find the `<FriendSections ...>` JSX at line 4612. Add `onOpenFriends` between `onInviteFriend` and `darkMode`:

**Before:**
```jsx
                <FriendSections
                  accessToken={accessToken}
                  cookingFor={userProfile?.cookingFor ?? null}
                  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
                  dietaryPrefs={userProfile?.dietaryPrefs ?? null}
                  onOpenRecipe={handleOpenEditorPickRecipe}
                  onSaveRecipe={handleSavePublicRecipe}
                  onShareRecipe={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
                  onInviteFriend={() => setIsFriendsDialogOpen(true)}
                  darkMode={darkMode}
                  onCookWithFriendsVisible={setCookWithFriendsVisible}
                />
```

**After:**
```jsx
                <FriendSections
                  accessToken={accessToken}
                  cookingFor={userProfile?.cookingFor ?? null}
                  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
                  dietaryPrefs={userProfile?.dietaryPrefs ?? null}
                  onOpenRecipe={handleOpenEditorPickRecipe}
                  onSaveRecipe={handleSavePublicRecipe}
                  onShareRecipe={(recipe, event) => openShareSheet(recipe, event) /* [S04] */}
                  onInviteFriend={() => setIsFriendsDialogOpen(true)}
                  onOpenFriends={() => setIsFriendsDialogOpen(true)}
                  darkMode={darkMode}
                  onCookWithFriendsVisible={setCookWithFriendsVisible}
                />
```

- [ ] **Step 2: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): wire onOpenFriends from App.jsx to FriendSections"
```

---

## Chunk 3: Manual verification + deploy

### Task 5: Manual smoke test in dev

- [ ] **Step 1: Start the worker**

```bash
cd apps/worker && npx wrangler dev --port 8787 --remote
```

- [ ] **Step 2: Start the frontend**

```bash
cd apps/recipe-ui && npm run dev -- --host
```

- [ ] **Step 3: Verify in the browser**

Open http://localhost:5173, sign in as a user who has at least one friend whose friends include someone the test user isn't already friends with. Confirm each of the following:

1. "Friends you may know" section header appears immediately above Editor's Picks.
2. Horizontal scroll shelf renders 1–10 cards.
3. Each card shows: gradient avatar with initial, name, reason (`"N mutual friends"` or `"Likes {pref}"`), Add friend button, dismiss × in top-right.
4. Tap "Add friend" → button flips to "Requested" and becomes disabled.
5. Tap × on a card → card disappears from the shelf. Other cards remain.
6. Dismiss all cards → the whole section (header + shelf) disappears.
7. Reload the page → dismissed and requested state both reset (session-only).
8. Tap "See all" → the friends management drawer opens.
9. Sign in as a user with 0 friends and 0 dietary prefs → shelf does not render at all.

If any of these fail, fix before proceeding to deploy.

### Task 6: Deploy worker + frontend

- [ ] **Step 1: Deploy the worker**

```bash
cd apps/worker && npx wrangler deploy
```

Expected: deploys successfully, outputs production URL.

- [ ] **Step 2: Deploy the frontend**

Must run from `apps/recipe-ui` so wrangler picks up the `functions/` directory for OG tags.

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

Expected: deploys successfully to recifind.elisawidjaja.com.

- [ ] **Step 3: Verify in production**

Open https://recifind.elisawidjaja.com, sign in, confirm the same 9 checks from Task 5 Step 3 pass on production.

- [ ] **Step 4: Close out the plan**

Move or delete the superseded plan file so it's clear the old one is no longer authoritative:

```bash
git rm docs/superpowers/plans/2026-03-13-friends-you-may-know.md
git commit -m "docs: retire superseded Friends-you-may-know plan (replaced by 2026-04-20)"
```
