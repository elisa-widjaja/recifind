# Design Spec: "Friends You May Know"

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

Add a "Friends you may know" horizontal scroll shelf to the logged-in home feed, positioned above Editor's Picks in `FriendSections.jsx`. Suggests users based on friends-of-friends first, with shared-preference matching as a fallback.

---

## Placement

- **Component:** `FriendSections.jsx`
- **Position:** Above the Editor's Picks section
- **Visibility:** Hidden during loading and when there are no suggestions (no skeleton, no empty state, no heading — section simply doesn't render)

---

## API

### `GET /friends/suggestions`

**Auth:** Required (JWT)

**Logic:**
1. **FOF pass** — The `friends` table is bidirectional (one row per direction, `user_id` → `friend_id`). To find my friends: `WHERE user_id = me`. To find friends-of-friends: for each `friend_id` in my friends, find their `user_id = friend_id` rows, collect the `friend_id` values. Exclude: myself, direct friends (from `friends` table), and anyone with a pending outbound request (from `friend_requests_sent WHERE from_user_id = me`). Group by candidate, count distinct mutual connections, collect mutual friend names for the reason string (e.g. "Friend of Sarah", "Friend of Tom & Ana").
2. **Pref-match fallback** — if FOF results < 5, pad with at most `(10 - fofCount)` users from `profiles` (apply `LIMIT` at the DB level) whose `dietary_prefs` or `meal_type_prefs` overlap the current user's prefs. Apply the same exclusions as FOF (already friends, pending requests). If the current user has null prefs (skipped onboarding), this pass returns zero rows. Reason string: "Likes [first shared pref]". Sort tiebreaker: alphabetical by name.
3. Return max 10 results total, sorted by mutual friend count descending.

**Response** — does NOT expose target email addresses. The backend accepts `userId` directly on the send-request endpoint (see below):
```json
{
  "suggestions": [
    { "userId": "abc123", "name": "Maya R.", "reason": "Friend of Sarah" },
    { "userId": "def456", "name": "Priya K.", "reason": "Likes Vegetarian food" }
  ]
}
```

**Edge cases:**
- User has no friends and skipped onboarding → returns `{ suggestions: [] }` → section hidden
- Duplicate exclusion: a candidate can only appear once (FOF takes priority over pref-match)

---

### `POST /friends/request` — userId support (new code path)

The existing endpoint accepts `{ email }`. Add a parallel code path that accepts `{ userId }` directly — the backend resolves the email internally from `profiles` and processes identically. This avoids exposing other users' email addresses to the client.

---

## Frontend

### `SuggestionsShelf` section (added to `FriendSections.jsx`)

**Data fetching:** `GET /friends/suggestions` called on mount alongside existing friend fetches. Result stored in `suggestions` state (default `[]`). A separate `requestedIds` Set tracks which userIds have been acted on. Section renders only when `suggestions.length > 0`.

**New prop on `FriendSections`:** `onOpenFriends: () => void` — update prop destructuring and any JSDoc in `FriendSections.jsx`.

**Section header:**
- Left: "Friends you may know" (same heading style as other sections)
- Right: "See all" link → calls `onOpenFriends()` to open the existing friends management drawer (shows friends list + Add Friends option with Email / Text / Copy link tiles). This is an intentional simplification — a dedicated suggestions page is out of scope.

**Card design (Instagram-style):**
- Fixed height: 190px
- Width: 130px (min and max)
- Layout: flexbox column, `align-items: center`
- Avatar: 62×62px circle, color gradient based on first letter, initial letter displayed
- Name: `font-weight: 600`, `font-size: 13px`, centered
- Reason: `font-size: 11px`, `color: #999`, centered, vertically centered in remaining flex space (`flex: 1`, `display: flex`, `align-items: center`)
- CTA: full-width "Add friend" button, pinned to bottom (`flex-shrink: 0`)

**Shelf layout:**
- `display: flex`, `gap: 12px`, `overflow-x: auto`
- 3 cards visible at a time; 4th card partially visible as a scroll hint. Apply a right-side fade mask on the scroll container using `-webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%)` — do NOT use opacity on individual cards.

**"Add friend" interaction:**
1. Call `POST /friends/request` with `{ userId: suggestion.userId }`
2. On any non-5xx response (success, 409, or any conflict): add userId to `requestedIds`
3. Button changes to "Requested" — grayed out, disabled. Card stays visible. All 409 sub-cases (already friends, already requested, they requested you) are treated as "Requested" — accepted simplification, since the server-side exclusions in `GET /friends/suggestions` should prevent most conflicts.

**Error handling:**
- API failures (5xx) on "Add friend" are silent at the card level (no toast)
- If `GET /friends/suggestions` fails, section simply doesn't render

---

## Reused Components & Patterns

- **Friends drawer** (`isFriendsDialogOpen` in `App.jsx`) — "See all" opens existing drawer via `onOpenFriends` prop
- **3-tile invite block** (Email / Text / Copy link inside the drawer) — no changes needed
- **Avatar color gradient pattern** — reuse the same 5-color rotation already used in `ActivityItem`
- **Horizontal shelf layout** — same `overflow-x: auto` flex pattern as `RecipeShelf`

---

## What's NOT in scope

- Dismiss / "Not interested" per card
- Dedicated "See all suggestions" page
- Pagination beyond 10 suggestions
- Google Contacts import
- Push notifications for new suggestions
- Skeleton loading state (section is hidden during load)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/worker/src/index.ts` | Add `GET /friends/suggestions` route + `handleFriendSuggestions()` handler; add `userId` code path to `handleSendFriendRequest()` |
| `apps/recipe-ui/src/components/FriendSections.jsx` | Add `SuggestionsShelf` section above Editor's Picks; add `onOpenFriends` prop (update destructuring + JSDoc) |
| `apps/recipe-ui/src/App.jsx` | Pass `onOpenFriends={() => setIsFriendsDialogOpen(true)}` to `FriendSections` |
