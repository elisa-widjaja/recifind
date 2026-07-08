# Optional Message When Sharing a Recipe to Connections — Design

Date: 2026-07-08
Status: Approved

## Goal

When a user shares a recipe with their connections (the in-app FriendPicker
path), let them add an **optional short message** that is delivered with the
share. The message appears only in the **push notification** and the **email**.
Nothing about the activity feed, the notifications row, or the `recipe_shares`
table changes, and no DB migration is needed — the message is ephemeral (parsed
from the request and used for the sends, never persisted).

Scope: the in-app **Connections** path (`FriendPicker`), not the OS "Friends"
share sheet (which cannot carry a custom in-app message).

## Behavior

- FriendPicker gains an optional message input. When the user sends with a
  message, it is included in the push and email to each recipient.
- Empty/blank message → behaves exactly like today (no note; existing push and
  email copy).
- Max length **200 characters**, enforced on both the client (input `maxLength`)
  and the server (hard cap, defensive).

## Data flow

`FriendPicker` message input
→ `onSend(ids, message)`
→ `handlePickerSend` in App.jsx
→ `shareRecipe({ recipeId, recipientUserIds, message })`
→ `POST /recipes/:id/share` body `{ recipient_user_ids, message }`
→ `handleShareRecipe` uses `message` for push + email only.

## Changes

### Shared contract (`apps/shared/contracts.ts`)
- Add `message?: string` to `ShareRecipeRequest`.
- Add `export const SHARE_RECIPE_MESSAGE_MAX_LENGTH = 200;`.

### API helper (`apps/recipe-ui/src/lib/shareRecipe.js`)
- Accept an optional `message` arg; include it in the POST body only when it is a
  non-empty trimmed string.

### FriendPicker (`apps/recipe-ui/src/components/FriendPicker.jsx`)
- Add a `TextField` (multiline, ~2 rows) with placeholder "Add a message
  (optional)", `inputProps={{ maxLength: 200 }}`, and a subtle character counter.
- Hold the value in local state; reset on close.
- `handleSend` passes `onSend(ids, message.trim())` (empty string when blank).

### App.jsx wiring
- `handlePickerSend(recipientUserIds, message)` forwards `message` into
  `shareRecipe({ ... , message })`.

### Backend (`apps/worker/src/routes/share.ts`)
- Parse `body.message`: coerce to string, `trim()`, cap to
  `SHARE_RECIPE_MESSAGE_MAX_LENGTH`. Treat empty as "no message".
- **Push:** when a message is present, body =
  `` `${sharerName} shared ${recipeTitle}: "${message}"` `` (newlines stripped);
  otherwise the current `` `${sharerName} just shared ${recipeTitle} with you` ``.
- **Email:** when a message is present, render an HTML-escaped "note from
  {sharerName}" block (quoted style) above the recipe card. Escape via a small
  local `escapeHtml` helper (`& < > " '`). Absent → email unchanged.
- Push text needs no HTML escaping (plain text) but strips CR/LF.
- **Unchanged:** `recipe_shares` insert, the `notifications` row (still the
  existing auto summary), the activity/recently-shared feed. No new table/column.

## Security / edge cases

- The message is user-controlled and lands in email HTML → **must be
  HTML-escaped** to prevent markup/script injection. Push is plain text; strip
  newlines so it can't spoof extra lines.
- Server caps length independently of the client (never trust the client).
- Multiple recipients: same message to all (one batch send, as today).
- Whitespace-only message is treated as no message.

## Testing

- Worker unit test (`apps/worker/src/routes/share.ts` via existing share test
  file if present, else a new one): with a message → push body and email HTML
  include the escaped message; without → unchanged copy; an over-200 message is
  truncated; an HTML-injecting message (`<script>`) is escaped in the email.
- Frontend: extend the FriendPicker test to assert the message is passed through
  `onSend`.
- Pre-ship: import parse+enrich smoke-test (worker change) per project rule.

## Out of scope

- Showing the message on the activity-feed recipe card or a notifications inbox
  (explicitly excluded).
- Persisting the message (`recipe_shares.message` column / migration).
- The OS share-sheet path.
