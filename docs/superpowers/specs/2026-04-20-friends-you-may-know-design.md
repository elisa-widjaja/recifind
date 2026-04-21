# Friends You May Know — Design

**Date:** 2026-04-20
**Supersedes:** `docs/superpowers/plans/2026-03-13-friends-you-may-know.md` (reshaped; backend handler already drafted in [apps/worker/src/index.ts](../../apps/worker/src/index.ts) but uncommitted and not deployed)

## Goal

Add a horizontal-scroll "Friends you may know" shelf to the logged-in home feed, showing friends-of-friends first and shared-preference matches as fallback. Matches the Instagram/Facebook "People you may know" pattern, scoped down to what ReciFind needs today.

## Scope

**In:** home-feed shelf above Editor's Picks, as a self-contained `<SuggestionsShelf>` component. Component is designed to be dropped into the friends drawer later without internal changes.

**Out:** drawer integration, persistent dismiss, push notifications, 2nd-degree FOF, pagination, dedicated "People you may know" page.

## Data contract

### Endpoint

`GET /friends/suggestions` — authenticated (JWT).

### Response

```ts
{
  suggestions: Array<
    | { userId: string; name: string; kind: 'fof'; mutualCount: number }
    | { userId: string; name: string; kind: 'pref'; sharedPref: string }
  >
}
```

### Ranking and size

- Up to **10** suggestions total. No pagination.
- `kind: 'fof'` rows come first, sorted by `mutualCount DESC`.
- `kind: 'pref'` rows fill remaining slots only when FOF rows < 5.
- If both queries return empty, `suggestions: []`.

### FOF query

`friends` is bidirectional (one row per direction). `profiles` has no `avatar_url` — do not select one.

```sql
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
```

Bind: `[me, me, me, me]`. No `GROUP_CONCAT` — names are not returned.

### Pref-match fallback

Runs only when FOF rows < 5. Fills up to 10 total. Reads `dietary_prefs` and `meal_type_prefs` from the requesting user's profile (JSON-encoded arrays). For each non-empty pref, build a `LIKE` clause against other users' pref columns. Exclude self, existing friends, existing outgoing requests, and users already in the FOF result.

Returned row shape: `{ userId, name, kind: 'pref', sharedPref }` where `sharedPref` is the first pref both users share (or the candidate's first pref if no direct overlap).

### Auth change to `POST /friends/request`

The shelf sends `{ userId }` instead of `{ email }`. Handler resolves the email from `profiles` internally and continues the existing flow. Email-based callers continue to work.

Add `resolveEmailFromUserId(db, userId): Promise<string | null>` helper. In `handleSendFriendRequest`, accept either `body.email` or `body.userId`; if only `userId` is provided, look up the email; return 404 if no profile matches.

## Component

**File:** `apps/recipe-ui/src/components/SuggestionsShelf.jsx` (new)

Self-contained. Owns its own fetch, its own state, its own visibility.

### Props

```ts
{
  accessToken: string,
  onOpenFriends?: () => void,
  variant?: 'feed' | 'compact'  // 'compact' reserved for future drawer use
}
```

### Behavior

- On mount, calls `GET /friends/suggestions`. On error, sets `suggestions: []` silently.
- While fetching, renders `null` (no skeleton, no placeholder).
- If `suggestions.length === 0` or all visible cards have been dismissed, renders `null`.

### Card anatomy

- 150×200 px rounded card, 1 px border `divider`, soft shadow (`0 1px 3px rgba(0,0,0,0.06)`).
- Dismiss `×` icon button in top-right, 20 px, `color: text.secondary`.
- 64×64 gradient-initial avatar centered.
- Name: 14 px / weight 600, single-line ellipsis.
- Reason: 11 px muted, 2-line clamp.
  - `kind: 'fof'`: `"{mutualCount} mutual friend"` (singular) or `"{mutualCount} mutual friends"` (plural).
  - `kind: 'pref'`: `"Likes {sharedPref}"`.
- Full-width button pinned to bottom: `Add friend` → `Requested` (disabled, outlined variant).

### Layout

- Horizontal flex, gap 12 px.
- `overflow-x: auto`, scrollbar hidden, right-edge mask fade (`mask-image: linear-gradient(to right, black 85%, transparent 100%)`).

### Gradient helper

Reuse `apps/recipe-ui/src/lib/avatarColor.js` if it exposes a gradient-compatible function; otherwise add a 5-gradient palette local to the component:

```js
const SUGGESTION_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #e85d3a)',
  'linear-gradient(135deg, #43b89c, #1976d2)',
  'linear-gradient(135deg, #9b59b6, #e85d8a)',
  'linear-gradient(135deg, #27ae60, #f5a623)',
  'linear-gradient(135deg, #e74c3c, #9b59b6)',
];
```

Index by `userId.charCodeAt(0) % 5`.

## Interactions

### Add friend (optimistic)

```
user taps Add friend
  → add userId to requestedIds immediately (button flips to "Requested")
  → POST /friends/request { userId }
  → on 2xx or any 4xx (409 already-friends, 404 user-not-found): no change, stay "Requested"
  → on 5xx or network error: remove from requestedIds, button becomes "Add friend" again
```

### Dismiss

```
user taps ×
  → add userId to dismissedIds
  → card unmounts (filtered out of render)
  → if visible count == 0, whole shelf unmounts
  → no network call
```

Dismiss is **session-only**. Reloading the page restores all suggestions. Matches the "Requested" state behavior.

## Placement

Insert `<SuggestionsShelf>` in [FriendSections.jsx](../../apps/recipe-ui/src/components/FriendSections.jsx), immediately before the Editor's Picks block.

```jsx
<SuggestionsShelf accessToken={accessToken} onOpenFriends={onOpenFriends} />
```

Add `onOpenFriends` to `FriendSections`' destructured props and JSDoc. Thread it from `App.jsx` as `() => setIsFriendsDialogOpen(true)` on the existing `<FriendSections>` usage.

## Section chrome

Rendered inside `SuggestionsShelf` when the shelf is visible:

- Header row: `"Friends you may know"` on the left (15 px / weight 600); `"See all"` on the right (13 px, `text.secondary`, clickable) — only rendered when `onOpenFriends` is provided.
- Empty shelf → no header, no spacing.

## Edge cases

- **Suggestion already requested mid-session** (user tapped Add then dismissed): dismiss takes precedence — card unmounts.
- **Duplicate userId across FOF and pref lists**: the backend de-duplicates (pref query excludes userIds already in FOF result). Frontend makes no assumption; React key is `userId`.
- **Long display names**: single-line ellipsis at 150 px card width.
- **Empty initial in name** (e.g. profile with `display_name = ""`): fall back to `?` in the avatar.
- **Pref-match with `sharedPref === "None / all good"`**: filtered out server-side; should never reach the client.

## Out of scope (deferred)

- Drawer shelf integration — component is shape-ready (`variant: 'compact'` reserved) but no wire-up in this spec.
- Persistent dismiss across sessions (would need `friend_suggestion_dismissals` D1 table).
- Retraining / "Not interested" reasoning.
- 2nd-degree FOF expansion.
- Push notifications.

## Testing

- **Worker:** unit tests in `apps/worker/src/friends-suggestions.test.ts` for:
  1. FOF returns count-only rows, sorted by `mutualCount DESC`.
  2. FOF with no mutuals returns empty.
  3. Pref-match fallback fires only when FOF < 5; excludes userIds already in FOF.
  4. `resolveEmailFromUserId` returns email / null correctly.
  5. `handleSendFriendRequest` resolves `userId` → email and proceeds.
- **Frontend:** component-level test for `SuggestionsShelf` — render with mocked `suggestions` prop, assert cards render, Add→Requested flips button state, × removes card. (Use existing vitest + React Testing Library setup.)
- **Manual smoke:** log in as a user with ≥1 friend; confirm shelf appears above Editor's Picks; tap Add friend on one card and × on another; reload and confirm they reset.

## Files touched

- `apps/worker/src/index.ts` — slim `handleFriendSuggestions`, add `resolveEmailFromUserId`, extend `handleSendFriendRequest` to accept `userId`, register `/friends/suggestions` route
- `apps/worker/src/friends-suggestions.test.ts` — unit tests
- `apps/recipe-ui/src/components/SuggestionsShelf.jsx` — new
- `apps/recipe-ui/src/components/FriendSections.jsx` — insert shelf, thread `onOpenFriends`
- `apps/recipe-ui/src/App.jsx` — pass `onOpenFriends={() => setIsFriendsDialogOpen(true)}` to `<FriendSections>`
