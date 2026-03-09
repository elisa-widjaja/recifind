# Token-Based Friend Invites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manual "type an email" friend invite UI with Email and SMS invite buttons that generate a shareable token link — preserving auto-connect for both new and existing ReciFind users.

**Architecture:** A new `open_invites` table stores tokens linked to the inviter (no recipient email needed). The invite URL `?invite=TOKEN` is embedded in a mailto: or native share message. When the recipient opens the link — whether already logged in or after signing up — the app calls `POST /friends/accept-open-invite` to auto-connect both users. The existing email-typed flow and `pending_invites` system remain untouched.

**Tech Stack:** Cloudflare D1 (SQL), Cloudflare Worker (TypeScript), React + MUI (JSX), Web Share API, mailto: protocol

---

## Key Files

- `apps/worker/src/index.ts` — all API routes and handlers
- `apps/worker/migrations/` — D1 SQL migrations (run via `wrangler d1 migrations apply recipes-db --remote`)
- `apps/recipe-ui/src/App.jsx` — entire frontend (single file)
- Deploy frontend: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
- Deploy worker: `cd apps/worker && npx wrangler deploy`

## Existing System Reference (do not break these)

- `?invite_token=UUID` — email-typed flow for pending_invites (keep as-is)
- `?accept_friend=USER_ID` — existing user friend request accept (keep as-is)
- `POST /friends/accept-invite` — accepts email-typed invite token (keep as-is)
- `POST /friends/check-invites` — email-matching fallback (keep as-is)
- `pending_invites` table — stores email-typed invites (keep as-is)

---

## Task 1: D1 Migration — open_invites table

**Files:**
- Create: `apps/worker/migrations/0003_open_invites.sql`

**Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS open_invites (
  token TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  inviter_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_invites_inviter ON open_invites(inviter_user_id);
```

**Step 2: Apply migration to remote D1**

```bash
cd apps/worker
npx wrangler d1 migrations apply recipes-db --remote
```

Expected: `✅ Applied 1 migration` (only 0003 should be new)

**Step 3: Commit**

```bash
git add apps/worker/migrations/0003_open_invites.sql
git commit -m "feat: add open_invites table for token-based friend invites"
```

---

## Task 2: Worker — POST /friends/open-invite

**Files:**
- Modify: `apps/worker/src/index.ts`

**Step 1: Add route**

Find the friends route block (around line 345-424). Add this route alongside the other `/friends/` routes:

```typescript
// inside the main fetch handler, in the friends routes block
if (url.pathname === '/friends/open-invite' && request.method === 'POST') {
  return await handleCreateOpenInvite(request, env, user);
}
```

**Step 2: Write the handler**

Add `handleCreateOpenInvite` near the other friend handlers (around line 1280):

```typescript
async function handleCreateOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const token = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO open_invites (token, inviter_user_id, inviter_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.userId, profile.displayName || null, now).run();

  return json({ token });
}
```

**Step 3: Verify build**

```bash
cd apps/worker && npm run build 2>&1 | grep -E "error|Error|warning" | head -20
```

Expected: no TypeScript errors

**Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add POST /friends/open-invite endpoint"
```

---

## Task 3: Worker — POST /friends/accept-open-invite

**Files:**
- Modify: `apps/worker/src/index.ts`

**Step 1: Add route**

```typescript
if (url.pathname === '/friends/accept-open-invite' && request.method === 'POST') {
  return await handleAcceptOpenInvite(request, env, user);
}
```

**Step 2: Write the handler**

Add after `handleCreateOpenInvite`:

```typescript
async function handleAcceptOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const body = await request.json() as { token?: string };
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) throw new HttpError(400, 'Token is required');

  const invite = await env.DB.prepare(
    'SELECT * FROM open_invites WHERE token = ?'
  ).bind(token).first();

  if (!invite) throw new HttpError(404, 'Invite not found or already used');

  const inviterUserId = invite.inviter_user_id as string;

  // Prevent self-connection
  if (inviterUserId === user.userId) {
    return json({ message: 'Cannot accept your own invite' });
  }

  // Check if already friends
  const existing = await env.DB.prepare(
    'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
  ).bind(user.userId, inviterUserId).first();

  if (existing) {
    // Already connected — clean up the token and return success
    await env.DB.prepare('DELETE FROM open_invites WHERE token = ?').bind(token).run();
    return json({ message: 'Already friends' });
  }

  const accepterProfile = await getOrCreateProfile(env, user.userId, user.email);
  const inviterProfile = await getOrCreateProfile(env, inviterUserId, '');
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(inviterUserId, user.userId, accepterProfile.email, accepterProfile.displayName, now),
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
    env.DB.prepare('DELETE FROM open_invites WHERE token = ?').bind(token),
  ]);

  // Notify the inviter
  const notifId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, type, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(
    notifId,
    inviterUserId,
    'invite_accepted',
    JSON.stringify({ fromUserId: user.userId, fromName: accepterProfile.displayName }),
    now
  ).run();

  return json({ message: 'Connected!' });
}
```

**Step 3: Verify build**

```bash
cd apps/worker && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

**Step 4: Deploy worker**

```bash
cd apps/worker && npx wrangler deploy
```

**Step 5: Quick smoke test** (use DEV_API_KEY)

```bash
# Create an open invite
curl -s -X POST https://recipes-worker.elisa-widjaja.workers.dev/friends/open-invite \
  -H "Authorization: Bearer $DEV_API_KEY" \
  -H "Content-Type: application/json" | jq .
# Expected: { "token": "some-uuid" }
```

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add POST /friends/accept-open-invite endpoint"
```

---

## Task 4: Frontend — capture ?invite=TOKEN on page load

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (lines 140-154 area)

**Context:** URL params are captured at module level (before React renders) to survive OAuth redirects. Look for the block that handles `?accept_friend` and `?invite_token` — add `?invite` handling in the same block.

**Step 1: Add capture alongside existing params**

Find this block (around line 140):
```javascript
const _inviteToken = _url.searchParams.get('invite_token');
if (_inviteToken) {
  sessionStorage.setItem('pending_invite_token', _inviteToken);
  _url.searchParams.delete('invite_token');
  window.history.replaceState({}, '', _url.toString());
}
```

Add immediately after:
```javascript
const _openInvite = _url.searchParams.get('invite');
if (_openInvite) {
  sessionStorage.setItem('pending_open_invite', _openInvite);
  _url.searchParams.delete('invite');
  window.history.replaceState({}, '', _url.toString());
}
```

**Step 2: Include in OAuth redirectTo**

Find the OAuth redirect setup (around lines 1427-1437 and 1467-1477). Look for where `redirectTo` is built from `pendingId` / `pendingInvite`. Add `pending_open_invite` to the chain:

```javascript
const pendingId = sessionStorage.getItem('pending_accept_friend');
const pendingInviteToken = sessionStorage.getItem('pending_invite_token');
const pendingOpenInvite = sessionStorage.getItem('pending_open_invite');

const redirectTo = pendingId
  ? `${window.location.origin}?accept_friend=${encodeURIComponent(pendingId)}`
  : pendingInviteToken
    ? `${window.location.origin}?invite_token=${encodeURIComponent(pendingInviteToken)}`
    : pendingOpenInvite
      ? `${window.location.origin}?invite=${encodeURIComponent(pendingOpenInvite)}`
      : window.location.origin;
```

There are TWO places where redirectTo is built (Google OAuth and email OTP) — update both.

**Step 3: Commit (frontend only, no deploy yet)**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: capture ?invite= token on page load for open invite flow"
```

---

## Task 5: Frontend — handle open invite post-auth

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (post-auth handler around lines 2090-2214)

**Step 1: Read the existing post-auth block**

Find the `useEffect` that handles `pending_accept_friend` and `pending_invite_token` after `session` changes. It has this shape:
```javascript
// Handle pending shared recipe save
// Handle pending accept_friend
// Handle pending invite_token
// Email-based fallback (check-invites)
```

**Step 2: Add open invite handler alongside invite_token handler**

After the `pending_invite_token` block, add:

```javascript
// Handle open invite (token-based, no email required)
const pendingOpenInviteToken = sessionStorage.getItem('pending_open_invite');
if (pendingOpenInviteToken) {
  sessionStorage.removeItem('pending_open_invite');
  try {
    await callRecipesApi('/friends/accept-open-invite', {
      method: 'POST',
      body: JSON.stringify({ token: pendingOpenInviteToken })
    }, session.access_token);
    setSnackbarState({
      open: true,
      message: "You're now connected with your friend on ReciFind!",
      severity: 'success'
    });
  } catch (err) {
    console.error('Error accepting open invite:', err);
  }
}
```

**Step 3: Also handle the case where user is ALREADY logged in when they click the link**

The module-level capture stores the token in sessionStorage and removes it from the URL. The post-auth effect runs whenever `session` changes (including on initial load when already logged in). So if a logged-in user clicks `?invite=TOKEN`, the flow is:

1. Module-level: stores token in `sessionStorage('pending_open_invite')`, cleans URL
2. Post-auth effect fires (session already exists) → accepts invite immediately

This works with no extra code — just verify the effect dependency includes `session`.

**Step 4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: auto-accept open invite token after auth"
```

---

## Task 6: Frontend — replace "Add friend" UI

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (lines 4796-4873 area)

**Step 1: Read the current "Add a friend by email" section**

It currently contains:
- Subtitle: "Add a friend by email"
- TextField for email input (state: `addFriendEmail`)
- Send button calling `sendFriendRequest(addFriendEmail)`
- Divider "or"
- SMS button opening `sms:?body=...`

**Step 2: Add a shared helper function for generating open invite URL**

Add this function near `sendFriendRequest` (around line 1239):

```javascript
const generateOpenInviteUrl = async () => {
  const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token;
  if (!accessToken) { openAuthDialog(); return null; }
  const res = await callRecipesApi('/friends/open-invite', { method: 'POST' }, accessToken);
  if (!res?.token) return null;
  return `${window.location.origin}?invite=${res.token}`;
};
```

**Step 3: Replace the friend UI section**

Replace the entire section (from "Add a friend by email" subtitle through the SMS button) with:

```jsx
<Typography variant="subtitle2" gutterBottom sx={{ fontSize: { xs: '13px', sm: '0.875rem' } }}>
  Invite a friend
</Typography>
<Stack spacing={1.5}>
  <Button
    fullWidth
    variant="outlined"
    startIcon={<EmailOutlinedIcon />}
    onClick={async () => {
      const inviteUrl = await generateOpenInviteUrl();
      if (!inviteUrl) return;
      const subject = encodeURIComponent('Join me on ReciFind!');
      const body = encodeURIComponent(
        `Hey! I'd love to share recipes with you on ReciFind.\n\nJoin me here: ${inviteUrl}`
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      trackEvent('invite_friend', { method: 'email' });
    }}
  >
    Invite by Email
  </Button>
  <Button
    fullWidth
    variant="outlined"
    startIcon={<SmsIcon />}
    onClick={async () => {
      const inviteUrl = await generateOpenInviteUrl();
      if (!inviteUrl) return;
      const text = `Hey! I'd love to share recipes with you on ReciFind. Join me here: ${inviteUrl}`;
      if (navigator.share) {
        try {
          await navigator.share({ text, url: inviteUrl });
          trackEvent('invite_friend', { method: 'native_share' });
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      // Fallback: sms: protocol
      window.open(`sms:?body=${encodeURIComponent(text)}`);
      trackEvent('invite_friend', { method: 'sms' });
    }}
  >
    Invite by Text
  </Button>
</Stack>
```

**Note:** `EmailOutlinedIcon` is already imported (added in the recipe sharing work). `SmsIcon` is already imported (line 78).

**Step 4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: replace manual email input with Invite by Email and Invite by Text buttons"
```

---

## Task 7: Build and deploy

**Step 1: Build frontend**

```bash
cd apps/recipe-ui && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` with no errors (chunk size warnings are OK)

**Step 2: Deploy**

```bash
npx wrangler pages deploy dist --project-name recifind 2>&1 | tail -5
```

Expected: `✨ Deployment complete!`

**Step 3: Smoke test the full flow**

1. On mobile, log in to ReciFind
2. Go to Friends tab → tap "Invite by Email"
3. Mail app opens with subject "Join me on ReciFind!" and body with `?invite=TOKEN`
4. Copy the invite URL from the draft
5. Open the URL in a different browser (or private tab logged out)
6. Sign up → should see "You're now connected with your friend on ReciFind!" snackbar
7. Check both accounts — they should appear in each other's friends list

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: deploy token-based friend invites"
```
