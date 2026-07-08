# Mutual Friends in the Friend Drawer — Design

Date: 2026-07-07
Status: Approved (pending spec review)

## Goal

When a user taps a friend's avatar and the Friend Drawer opens, let them see, at a
glance, that friend's recipe count and friend count, and browse the **mutual
friends** they share. The two counts double as tabs: Recipes (default) shows the
existing shared-recipe list; Friends shows the mutual-friends list.

Reference sketch: `~/Downloads/Mutual friends .pdf`.

## Layout (matches the sketch)

Top to bottom inside the Friend Drawer:

- **Close (×)** button in a top bar, **left-aligned**.
- **Avatar centered** (~60px) with the friend's **name centered** below it, and the
  existing **"Connected {date}"** subline kept, centered.
- **Two tabs**, each showing a count + label:
  - `{recipeCount} Recipes` (active by default)
  - `{friendCount} Friends`
  - Active tab is marked with the green underline (brand green `#4a8c5f`).
- **Panel** below the tabs:
  - **Recipes tab** → the existing shared-recipe list (search, count caption,
    infinite scroll) unchanged.
  - **Friends tab** → header **"{mutualCount} mutual friends"** followed by a list
    of mutual-friend rows (avatar + name). Tapping a row opens that friend's own
    Friend Drawer view.

Tab-label semantics (confirmed):
- Recipes tab count = the target's **shared** recipe count (matches the list).
- Friends tab count = the target's **total** friend count (e.g. 28).
- The Friends panel header count = **mutual** friends only (e.g. 5). The label/count
  intentionally differ because a viewer cannot see a non-owned user's full friend
  list; only the shared subset is shown.

## Architecture

Chosen approach: **one new endpoint, fetched when the drawer opens** (Approach A).
Rejected: lazy per-tab loading (B — unneeded spinner for a ~5-row list) and folding
counts into `GET /friends` (C — N per-target self-joins on every list load).

### Backend

New authenticated route in `apps/worker/src/index.ts`:

```
GET /users/{targetId}/friend-view-stats
```

- Viewer = authenticated user id. `targetId` = the user whose drawer is open.
- Returns:
  ```json
  {
    "recipeCount": 42,
    "friendCount": 28,
    "mutualCount": 5,
    "mutualFriends": [
      { "userId": "...", "name": "Jordan Lee", "avatarUrl": "https://..." }
    ]
  }
  ```
- Queries (all on already-indexed `friends` / `recipes`; no new tables or migration):
  - `recipeCount`:
    `SELECT COUNT(*) FROM recipes WHERE user_id = ?targetId AND shared_with_friends = 1 AND hidden_at IS NULL`
  - `friendCount`:
    `SELECT COUNT(*) FROM friends WHERE user_id = ?targetId`
  - `mutualFriends` (reuse the self-join pattern from `handleFriendSuggestions`,
    ~lines 3679–3740): friends shared by viewer and target, joined to `profiles`
    for `display_name` + `avatar_url`, excluding deleted profiles. `mutualCount` =
    length of that list. Example:
    ```sql
    SELECT f_t.friend_id AS userId, p.display_name AS name, p.avatar_url AS avatarUrl
    FROM friends f_v
    JOIN friends f_t ON f_t.friend_id = f_v.friend_id
    JOIN profiles p ON p.user_id = f_t.friend_id
    WHERE f_v.user_id = ?viewerId
      AND f_t.user_id = ?targetId
      AND p.deleted_at IS NULL
    ORDER BY p.display_name
    ```
- Handler follows the worker rule: `return await handler()` inside the async
  try/catch so CORS headers are always emitted (no 1101s).

### Frontend

All in `apps/recipe-ui/src/App.jsx`.

**New state:**
- `friendViewStats` — `{ recipeCount, friendCount, mutualCount, mutualFriends } | null`
- `friendViewStatsLoading` — boolean
- `friendDrawerTab` — `'recipes' | 'friends'`, default `'recipes'`

**New fetch:** `fetchFriendViewStats(userId)` — GETs the endpoint, stores into
`friendViewStats`. Called from both `fetchFriendRecipes` (lines ~3047–3065) and
`fetchSuggestionRecipes` (lines ~3075–3101), so it populates for a tapped friend and
a tapped suggestion alike.

**Header restructure** (drawer header ~lines 7557–7623):
- Top bar row with the close (×) left-aligned.
- Centered avatar (~60px) + centered name + centered "Connected {date}" subline.
- Two-tab row bound to `friendDrawerTab`; active tab shows the green underline.
- Reset `friendDrawerTab = 'recipes'` whenever a new friend/suggestion is opened, so
  the drawer never opens stuck on the Friends tab.

**Panels:**
- Recipes panel: existing recipe list block, rendered only when
  `friendDrawerTab === 'recipes'`. Unchanged behavior (search, count caption,
  infinite scroll).
- Friends panel: rendered only when `friendDrawerTab === 'friends'`. Header
  "{mutualCount} mutual friends"; maps `mutualFriends` to rows (hashed-color avatar
  fallback matching existing pattern). Empty state: "No mutual friends yet." Row tap
  → `fetchFriendRecipes(thatFriend)` + `fetchFriendViewStats(thatFriend.userId)`,
  re-pointing the drawer (recursive).

**Loading:** while `friendViewStatsLoading`, tab counts render a subtle placeholder
(e.g. `–`) rather than jumping numbers.

## Edge cases

- **Suggestions (non-friends):** endpoint is keyed by user id, so it works for the
  suggestion preview path too. A mutual friend tapped there is one of the viewer's
  own friends, so it opens through the normal friend path.
- **Zero mutual friends:** Friends panel shows "No mutual friends yet."
- **Deleted / missing profiles:** excluded via `p.deleted_at IS NULL`.

## Testing

- Worker unit test mirroring `apps/worker/src/friends-suggestions.test.ts`: seed
  viewer, target, and overlapping friends; assert `recipeCount`, `friendCount`,
  `mutualCount`, and the `mutualFriends` list (viewer ≠ target).
- Smoke-test the recipe import parse + enrich flow is untouched before shipping
  (project rule), since this only adds a read endpoint.

## Constraints / conventions

- No em dashes in any user-facing copy.
- MUI `Stack` children use `pt`, not `mt`, for spacing.
- Live theme edits go in `App.jsx` `createTheme`, not the dead `theme.js`.
- No new D1 tables or migrations; all reads hit indexed columns.

## Out of scope

- Showing a non-friend's full friend list (privacy; only mutuals are shown).
- Any change to the recipe list itself, friend-request flows, or suggestions ranking.
