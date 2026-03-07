---
name: test-friend-accept
description: Test the end-to-end friend request accept flow for ReciFind. Use when the user wants to verify that clicking Accept in a friend request email auto-accepts the connection. Can simulate the full flow or call the accept API directly.
argument-hint: <sender-user-id> [--token <recipient-jwt>]
allowed-tools: Bash
---

Test the friend request accept flow for ReciFind — either the full email link flow or the API directly.

Worker API base: `https://recipes-worker.elisa-widjaja.workers.dev`
Accept endpoint: `POST /friends/requests/<sender-user-id>/accept`
Auth: Bearer token of the **recipient** (the person accepting)

## Steps

1. Parse `$ARGUMENTS` — extract the sender's user ID and optional `--token <jwt>`.

2. If no sender user ID is given, ask: "Do you want to (a) call the accept API directly with a known sender ID, or (b) simulate the full email link flow by constructing the accept URL?"

### Option A — Direct API call
```bash
curl -s -X POST "https://recipes-worker.elisa-widjaja.workers.dev/friends/requests/<SENDER_ID>/accept" \
  -H "Authorization: Bearer <RECIPIENT_JWT>"
```
- `200` + `{ success: true, friend: {...} }` → accepted, friendship created, confirmation email sent
- `404` → no pending request found (may already be accepted, declined, or sender ID is wrong)
- `401` → bad or missing token

### Option B — Simulate the email link flow
Construct the accept URL as the email would:
```
https://recifind.elisawidjaja.com?accept_friend=<SENDER_USER_ID>
```
Tell the user to:
1. Open this URL in a browser where they are **not** logged in as the recipient
2. Confirm the login dialog appears
3. Sign in (Google or magic link)
4. Confirm "Friend request accepted!" toast appears without going to the Friends tab

Then verify the friendship was created:
```bash
curl -s https://recipes-worker.elisa-widjaja.workers.dev/friends \
  -H "Authorization: Bearer <RECIPIENT_JWT>"
```
The sender should appear in the friends list.

## Key things to check
- `pending_accept_friend` is stored in localStorage before login
- After login, the accept API is called automatically (no manual action needed)
- The sender receives a "Your friend request was accepted" email
- Both users appear in each other's `/friends` list
