# Invite Flow Polish — Design Doc

**Date:** 2026-03-08
**Status:** Approved

## Goal

Polish the token-based friend invite flow with: auto-login prompt on invite arrival, personalized connection snackbar, invite button state management, and duplicate invite prevention.

## Decisions

- **All recipients must tap the invite link** to connect — no Requests tab changes for open invites
- **Existing Requests tab** (email-typed friend requests, accept/decline) remains untouched
- **Add to Homescreen banner** is suppressed for users arriving via invite link

---

## Feature 1 — Login prompt on invite arrival

**Trigger:** `?invite=TOKEN` is present in the URL on page load and user is not authenticated.

**Behavior:**
1. Module-level capture already stores token in `sessionStorage('pending_open_invite')` and cleans the URL
2. Add: also set `sessionStorage('invite_entry', '1')` when `?invite` is detected
3. On app mount, if `invite_entry` is set and `session` is null → call `openAuthDialog()` immediately
4. Suppress the Add to Homescreen banner: in the `beforeinstallprompt` / 3-second timeout handler, skip showing the banner if `sessionStorage.getItem('invite_entry')` is set
5. Clear `invite_entry` from sessionStorage after the auth dialog opens (one-shot)

---

## Feature 2 — Personalized "You're connected with [Name]!" snackbar

**Worker change:** `POST /friends/accept-open-invite` currently returns `{ message: 'Connected!' }`. Change to return `{ message: 'Connected!', inviterName: string | null }` — the `inviter_name` is already stored in the `open_invites` table row at invite creation time, so no extra DB query needed.

**Frontend change:** After successful accept, show snackbar at **top-center**:
- If `inviterName` is present: `"You're connected with ${inviterName}!"`
- Fallback (no name): `"You're now connected with your friend on ReciFind!"`

`anchorOrigin: { vertical: 'top', horizontal: 'center' }`

---

## Feature 3 — Invite button state: hide after sending + snackbar

**State:** Add `inviteSent` boolean state (resets when Friends drawer closes).

**Behavior:**
- While `inviteSent` is false: show "Invite by Email" and "Invite by Text" buttons normally
- After `generateOpenInviteUrl()` returns a URL: set `inviteSent = true`, show snackbar: **"Invite sent! Pending acceptance."**
- While `inviteSent` is true: hide both buttons, show a small text: **"Invite sent! Pending acceptance."** with a "Send another invite" link that resets `inviteSent = false`
- Reset `inviteSent = false` when the Friends drawer closes (`onClose`)

---

## Feature 4 — Duplicate invite prevention (worker-side)

**Worker change:** In `handleCreateOpenInvite`, before inserting a new row, query `open_invites` for an existing token from the same `inviter_user_id` created within the last 24 hours:

```sql
SELECT token, inviter_name FROM open_invites
WHERE inviter_user_id = ? AND created_at > ?
LIMIT 1
```

- If found: return the existing token (same response shape `{ token }`) — no new row inserted
- If not found: insert new row and return new token

**Frontend:** The behavior is transparent — `generateOpenInviteUrl()` always gets a token back. The "already pending" UI is handled entirely by Feature 3 (button hide state). No extra messaging needed on the frontend since both new and reused tokens look identical to the user.

---

## What is NOT changing

- Existing email-typed friend request flow (`sendFriendRequest` with email input — currently removed from UI but backend intact)
- Requests tab: accept/decline for incoming friend requests, cancel for sent requests
- Friends list tab
- `pending_invites` table and related endpoints
- `?invite_token`, `?accept_friend` URL param flows
