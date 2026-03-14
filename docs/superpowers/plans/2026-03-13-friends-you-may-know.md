# Friends You May Know — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Friends you may know" horizontal scroll shelf to the logged-in home feed, above Editor's Picks, suggesting friends-of-friends (FOF) first and shared-preference matches as fallback.

**Architecture:** New `GET /friends/suggestions` worker endpoint runs one SQL query for FOF + a second bounded query for pref-match fallback; `handleSendFriendRequest` gains a `userId` input path so the frontend never receives other users' emails; `FriendSections.jsx` adds a `SuggestionsShelf` section that fetches suggestions on mount and tracks `requestedIds` in local state.

**Tech Stack:** Cloudflare Workers (TypeScript), Cloudflare D1 (SQLite), React + MUI, vitest for worker unit tests.

---

## Chunk 1: Backend

### Task 1: `handleFriendSuggestions` — FOF query

**Files:**
- Modify: `apps/worker/src/index.ts` (add handler function + route registration)
- Test: `apps/worker/src/friends-suggestions.test.ts` (new file)

The `friends` table is **bidirectional** — one row per direction. Row `(user_id=A, friend_id=B)` means A follows B. To find A's friends: `SELECT friend_id FROM friends WHERE user_id = A`.

FOF SQL finds users connected to my friends who are NOT me, NOT already my friend, and NOT already sent a request to:

```sql
SELECT
  f2.friend_id                         AS userId,
  p.display_name                       AS name,
  COUNT(DISTINCT f1.friend_id)         AS mutualCount,
  GROUP_CONCAT(mp.display_name, '||')  AS mutualNames
FROM friends f1
JOIN friends f2  ON f2.user_id = f1.friend_id
JOIN profiles p  ON p.user_id  = f2.friend_id
JOIN profiles mp ON mp.user_id = f1.friend_id
WHERE f1.user_id = ?
  AND f2.friend_id != ?
  AND f2.friend_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
  AND f2.friend_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
GROUP BY f2.friend_id
ORDER BY mutualCount DESC
LIMIT 10
```

**Note:** The `profiles` table uses `user_id` as the primary key column (not `id`). `GROUP_CONCAT` uses `||` as separator (safe for display names). SQLite does not support `GROUP_CONCAT(DISTINCT expr, separator)` — omit `DISTINCT` here; `COUNT(DISTINCT ...)` on the same column keeps the mutual count accurate.

Bind order: `[me, me, me, me]`.

- [ ] **Step 1: Create the test file with a failing test**

Create `apps/worker/src/friends-suggestions.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleFriendSuggestions } from './index';

describe('handleFriendSuggestions', () => {
  it('returns FOF suggestions sorted by mutual count', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2, mutualNames: 'Sarah||Tom' },
      { userId: 'user-c', name: 'James T.', mutualCount: 1, mutualNames: 'Sarah' },
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
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].userId).toBe('user-b');
    expect(result.suggestions[0].reason).toBe('Friend of Sarah and Tom');
  });

  it('returns empty array when no suggestions found', async () => {
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
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: FAIL with `handleFriendSuggestions is not a function` or similar export error.

- [ ] **Step 3: Implement `handleFriendSuggestions`**

Add this function to `apps/worker/src/index.ts`, near the other friend handler functions (around line 1300):

```typescript
export async function handleFriendSuggestions(db: D1Database, userId: string): Promise<{ suggestions: Array<{ userId: string; name: string; reason: string }> }> {
  // --- FOF pass ---
  const fofRows = await db.prepare(`
    SELECT
      f2.friend_id                         AS userId,
      p.display_name                       AS name,
      COUNT(DISTINCT f1.friend_id)         AS mutualCount,
      GROUP_CONCAT(mp.display_name, '||')  AS mutualNames
    FROM friends f1
    JOIN friends f2  ON f2.user_id = f1.friend_id
    JOIN profiles p  ON p.user_id  = f2.friend_id
    JOIN profiles mp ON mp.user_id = f1.friend_id
    WHERE f1.user_id = ?
      AND f2.friend_id != ?
      AND f2.friend_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND f2.friend_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
    GROUP BY f2.friend_id
    ORDER BY mutualCount DESC
    LIMIT 10
  `).bind(userId, userId, userId, userId).all<{ userId: string; name: string; mutualCount: number; mutualNames: string }>();

  const fofSuggestions = (fofRows.results || []).map(row => {
    const names = row.mutualNames ? row.mutualNames.split('||') : [];
    const reason = names.length === 0
      ? 'Someone you may know'
      : names.length === 1
        ? `Friend of ${names[0]}`
        : `Friend of ${names[0]} and ${names[1]}`;
    return { userId: row.userId, name: row.name, reason };
  });

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
  // Build LIKE clauses for each pref — D1 stores prefs as JSON strings e.g. '["Vegetarian","Gluten-free"]'
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
  `).bind(userId, userId, userId, ...likeBinds, remaining).all<{ userId: string; name: string; dietary_prefs: string | null; meal_type_prefs: string | null }>();

  const prefSuggestions = (prefRows.results || [])
    .filter(row => !alreadySuggested.has(row.userId))
    .map(row => {
      const theirPrefs = [
        ...(row.dietary_prefs ? JSON.parse(row.dietary_prefs) : []),
        ...(row.meal_type_prefs ? JSON.parse(row.meal_type_prefs) : []),
      ];
      const sharedPref = allMyPrefs.find(p => theirPrefs.includes(p)) || theirPrefs[0] || 'cooking';
      return { userId: row.userId, name: row.name, reason: `Likes ${sharedPref}` };
    });

  return { suggestions: [...fofSuggestions, ...prefSuggestions] };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd apps/worker
git add src/friends-suggestions.test.ts src/index.ts
git commit -m "feat(worker): add handleFriendSuggestions with FOF + pref-match fallback"
```

---

### Task 2: Register `GET /friends/suggestions` route

**Files:**
- Modify: `apps/worker/src/index.ts` (route registration block, around line 413)

- [ ] **Step 1: Add the route**

In `apps/worker/src/index.ts`, find the friends route block (around line 413). Add this entry alongside the other `/friends` GET routes:

```typescript
// GET /friends/suggestions — People you may know
if (url.pathname === '/friends/suggestions' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Missing Authorization header');
  const suggestions = await handleFriendSuggestions(env.DB, user.userId);
  return json(suggestions);
}
```

- [ ] **Step 2: Smoke-test with wrangler dev**

```bash
cd apps/worker && npx wrangler dev --port 8787
```

In another terminal:
```bash
curl -s -H "Authorization: Bearer $DEV_API_KEY" http://localhost:8787/friends/suggestions | jq .
```

Expected: `{ "suggestions": [...] }` — array may be empty if no friends exist in local dev, but no 500 error.

- [ ] **Step 3: Commit**

```bash
cd apps/worker && git add src/index.ts && git commit -m "feat(worker): register GET /friends/suggestions route"
```

---

### Task 3: Add `userId` input path to `handleSendFriendRequest`

**Files:**
- Modify: `apps/worker/src/index.ts` — `handleSendFriendRequest` function (around line 1708)

The frontend will call `POST /friends/request` with `{ userId }` instead of `{ email }`. The backend resolves the email from `profiles` internally, then continues the existing flow unchanged. Email-based calls continue to work as before.

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/friends-suggestions.test.ts`:

```typescript
import { resolveEmailFromUserId } from './index';

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

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: FAIL — `resolveEmailFromUserId is not a function`.

- [ ] **Step 3: Implement `resolveEmailFromUserId` and wire it into `handleSendFriendRequest`**

First, add the helper function near the other lookup helpers in `apps/worker/src/index.ts`:

```typescript
export async function resolveEmailFromUserId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT email FROM profiles WHERE user_id = ?'
  ).bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}
```

Then, at the top of `handleSendFriendRequest`, replace the existing email extraction block:

**Before (around line 1709–1712):**
```typescript
const body = await readJsonBody(request);
const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
if (!email) throw new HttpError(400, 'Email is required');
```

**After:**
```typescript
const body = await readJsonBody(request);
let email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

// userId path: frontend passes userId directly (avoids exposing emails in API responses)
if (!email && typeof body.userId === 'string' && body.userId.trim()) {
  const resolved = await resolveEmailFromUserId(env.DB, body.userId.trim());
  if (!resolved) throw new HttpError(404, 'User not found');
  email = resolved.toLowerCase();
}

if (!email) throw new HttpError(400, 'Email or userId is required');
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/worker && npm test -- friends-suggestions
```

Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
cd apps/worker && git add src/index.ts src/friends-suggestions.test.ts && git commit -m "feat(worker): add userId input path to handleSendFriendRequest"
```

---

## Chunk 2: Frontend

### Task 4: Add `SuggestionsShelf` section to `FriendSections.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx`

The component already uses `fetchJson(path, token)` (defined at the top of the file) for all API calls and `Promise.all` for parallel mounting fetches. Follow the same patterns exactly.

**Avatar color gradient helper** — the `ActivityItem` sub-component in the same file already has a `AVATAR_COLORS` array. Reuse that same array (or define a local one with the same colors) for the suggestion cards.

- [ ] **Step 1: Add `suggestions` and `requestedIds` state**

In `FriendSections.jsx`, find the state declarations block (around line 34). Add:

```javascript
const [suggestions, setSuggestions] = useState([]);
const [requestedIds, setRequestedIds] = useState(new Set());
```

- [ ] **Step 2: Fetch suggestions on mount**

Find the first `useEffect` (friend data fetch, around line 43). Add `fetchJson('/friends/suggestions', accessToken)` to the `Promise.all`:

**Before:**
```javascript
Promise.all([
  fetchJson('/friends/activity', accessToken),
  fetchJson('/friends/recently-saved', accessToken),
  fetchJson('/friends/recently-shared', accessToken),
]).then(([act, saved, shared]) => {
  setActivity(act?.activity || []);
  setRecentlySaved((saved?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
  setRecentlyShared((shared?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
  setLoaded(true);
});
```

**After:**
```javascript
Promise.all([
  fetchJson('/friends/activity', accessToken),
  fetchJson('/friends/recently-saved', accessToken),
  fetchJson('/friends/recently-shared', accessToken),
  fetchJson('/friends/suggestions', accessToken),
]).then(([act, saved, shared, sugg]) => {
  setActivity(act?.activity || []);
  setRecentlySaved((saved?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
  setRecentlyShared((shared?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
  setSuggestions(sugg?.suggestions || []);
  setLoaded(true);
});
```

- [ ] **Step 3: Add `onOpenFriends` prop and update JSDoc**

Find the component signature (around line 33). Add `onOpenFriends` to the destructured props:

**Before:**
```javascript
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend }) {
```

**After:**
```javascript
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, onOpenFriends }) {
```

Also update the JSDoc block immediately above the function (lines 26–32) to add `@param {Function} onOpenFriends - Opens the friends management drawer`.

- [ ] **Step 4: Add `addFriend` handler**

Add this function inside the component body, near the top (after state declarations):

```javascript
async function addFriend(suggestion) {
  try {
    const res = await fetch(`${API_BASE_URL}/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ userId: suggestion.userId }),
    });
    // Treat success (2xx) and conflict (4xx) as "requested"; only skip on 5xx
    if (res.ok || res.status < 500) {
      setRequestedIds(prev => new Set([...prev, suggestion.userId]));
    }
  } catch (_) {
    // Network error — silent failure, button stays active
  }
}
```

- [ ] **Step 5: Add the avatar gradient helper**

Add this constant near the top of the file (before the component), alongside or referencing the existing `AVATAR_COLORS`:

```javascript
const SUGGESTION_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #e85d3a)',
  'linear-gradient(135deg, #43b89c, #1976d2)',
  'linear-gradient(135deg, #9b59b6, #e85d8a)',
  'linear-gradient(135deg, #27ae60, #f5a623)',
  'linear-gradient(135deg, #e74c3c, #9b59b6)',
];

function suggestionGradient(userId) {
  const idx = userId.charCodeAt(0) % SUGGESTION_GRADIENTS.length;
  return SUGGESTION_GRADIENTS[idx];
}
```

- [ ] **Step 6: Add the `SuggestionsShelf` JSX**

Find the Editor's Picks section in the return block (search for `Editor's Pick` or `editorsPick`). Insert the following block **immediately before** it. Only renders when `suggestions.length > 0`:

```jsx
{suggestions.length > 0 && (
  <Box sx={{ mb: 3 }}>
    {/* Section header */}
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, px: 0 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: 15 }}>
        Friends you may know
      </Typography>
      {onOpenFriends && (
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', cursor: 'pointer', fontSize: 13 }}
          onClick={onOpenFriends}
        >
          See all
        </Typography>
      )}
    </Box>

    {/* Horizontal scroll shelf with right-fade mask */}
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
      {suggestions.map(suggestion => {
        const isRequested = requestedIds.has(suggestion.userId);
        return (
          <Box
            key={suggestion.userId}
            sx={{
              minWidth: 130,
              maxWidth: 130,
              height: 190,
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
            {/* Avatar */}
            <Box
              sx={{
                width: 62,
                height: 62,
                borderRadius: '50%',
                background: suggestionGradient(suggestion.userId),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {(suggestion.name || '?')[0].toUpperCase()}
            </Box>

            {/* Name */}
            <Typography
              sx={{ fontWeight: 600, fontSize: 13, textAlign: 'center', mt: 1, lineHeight: 1.2 }}
            >
              {suggestion.name}
            </Typography>

            {/* Reason — vertically centered in remaining space */}
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <Typography
                sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center', lineHeight: 1.3 }}
              >
                {suggestion.reason}
              </Typography>
            </Box>

            {/* CTA — pinned to bottom */}
            <Button
              variant={isRequested ? 'outlined' : 'contained'}
              disabled={isRequested}
              size="small"
              fullWidth
              onClick={() => !isRequested && addFriend(suggestion)}
              sx={{ flexShrink: 0, fontSize: 13, fontWeight: 600, borderRadius: 2, textTransform: 'none' }}
            >
              {isRequested ? 'Requested' : 'Add friend'}
            </Button>
          </Box>
        );
      })}
    </Box>
  </Box>
)}
```

**Import note:** `Typography` and `Box` are already imported from MUI. `Button` is NOT currently imported — add it to the existing MUI import on line 2:

```javascript
// Before:
import { Box, Typography, Stack } from '@mui/material';

// After:
import { Box, Typography, Stack, Button } from '@mui/material';
```

- [ ] **Step 7: Verify in browser (dev server)**

```bash
cd apps/recipe-ui && npm run dev
```

Open http://localhost:5173, log in, and confirm:
- "Friends you may know" shelf appears above Editor's Picks (if suggestions returned)
- Cards are 190px tall with button pinned to bottom
- "Add friend" changes to "Requested" on click and stays disabled

- [ ] **Step 8: Commit**

```bash
cd apps/recipe-ui && git add src/components/FriendSections.jsx && git commit -m "feat(ui): add Friends You May Know shelf to home feed"
```

---

### Task 5: Wire `onOpenFriends` prop in `App.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

`isFriendsDialogOpen` and `setIsFriendsDialogOpen` already exist in `App.jsx`. Find the `<FriendSections` JSX usage (search for `<FriendSections`) and add the new prop.

- [ ] **Step 1: Pass `onOpenFriends` prop**

Search for `<FriendSections` in `App.jsx` (around line 4131). Add `onOpenFriends` as a new prop on the component. The existing prop list is `accessToken`, `cookingFor`, `cuisinePrefs`, `onOpenRecipe`, `onSaveRecipe`, `onShareRecipe`, `onInviteFriend`, and `darkMode` — do not remove any of them. Simply append:

```jsx
onOpenFriends={() => setIsFriendsDialogOpen(true)}
```

`setIsFriendsDialogOpen` already exists in `App.jsx` — do not redefine it.

- [ ] **Step 2: Verify "See all" opens the friends drawer**

In browser dev server: click "See all" on the suggestions shelf — confirm the friends management drawer opens (shows friends list and "+ Add Friends" with Email / Text / Copy link tiles).

- [ ] **Step 3: Commit**

```bash
cd apps/recipe-ui && git add src/App.jsx && git commit -m "feat(ui): wire onOpenFriends prop to friends drawer in App.jsx"
```

---

## Final Verification

- [ ] Run all worker tests:
  ```bash
  cd apps/worker && npm test
  ```
  Expected: all tests pass, including the 4 new tests in `friends-suggestions.test.ts`.

- [ ] Test the full flow end-to-end in dev:
  1. Log in as a user who has at least one friend
  2. Confirm "Friends you may know" shelf appears with correct cards
  3. Click "Add friend" — button should change to "Requested" immediately
  4. Click "See all" — friends drawer should open
  5. Reload the page — "Requested" state resets (no persistence needed, this is correct)

- [ ] Deploy worker:
  ```bash
  cd apps/worker && npx wrangler deploy
  ```

- [ ] Deploy frontend (must run from `apps/recipe-ui`):
  ```bash
  cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
  ```
