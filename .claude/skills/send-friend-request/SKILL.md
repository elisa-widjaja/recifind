---
name: send-friend-request
description: Test sending a friend request via the ReciFind API. Use when the user wants to test or debug the send friend request flow. Requires a Supabase JWT or DEV_API_KEY.
argument-hint: <recipient-email> [--token <jwt>]
allowed-tools: Bash
---

Test the send-friend-request API endpoint for ReciFind.

Worker API base: `https://recipes-worker.elisa-widjaja.workers.dev`
Endpoint: `POST /friends/request`
Body: `{ "email": "<recipient-email>" }`

## Steps

1. Parse `$ARGUMENTS` — extract the recipient email and optional `--token <jwt>` flag.

2. If no `--token` is provided, check `apps/recipe-ui/.env.local` or ask the user for a Supabase JWT or DEV_API_KEY to use as the Bearer token.

3. Make the API call:
```bash
curl -s -X POST https://recipes-worker.elisa-widjaja.workers.dev/friends/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"email": "<RECIPIENT_EMAIL>"}'
```

4. Show the full response (status code + body).

5. Interpret the result:
   - `201` + `{ success: true }` → request sent, email delivered via Resend
   - `404` → recipient email not found in Supabase (user hasn't signed up)
   - `409` + `"You are already friends with this user"` → UI shows "Already connected."
   - `409` + `"Friend request already sent"` or `"already sent you"` → UI shows "Request sent. Pending acceptance."
   - `401` → bad or missing token (JWT may be expired — tokens last 1 hour; get a fresh one)
   - `500` + `error code: 1101` (Cloudflare infrastructure error, no CORS headers) → Worker is crashing before error handler runs. Check: (a) D1 tables exist (`wrangler d1 execute recipes-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`), (b) all handler `return` calls in `fetch()` use `await` so the try/catch catches rejections
   - Any other error → show the error message and suggest a fix

6. If successful, remind the user to check the recipient's inbox for the friend request email and to use `/test-friend-accept` to verify the accept flow.

## Getting a JWT token
If the user needs a fresh token, ask them to open the browser console on https://recifind.elisawidjaja.com while logged in, type `allow pasting`, press Enter, then paste:
```javascript
JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('sb-')))).access_token
```
Tokens expire after 1 hour.
