# Invite Flow Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the token-based friend invite flow with auto-login on arrival, personalized connection snackbar, invite button state, and duplicate invite prevention.

**Architecture:** Four self-contained changes — two worker-side (return inviter name on accept, deduplicate tokens within 24h) and two frontend-side (auto-open auth dialog on invite arrival + suppress install banner, hide invite buttons after send with snackbar). All changes are in `apps/worker/src/index.ts` and `apps/recipe-ui/src/App.jsx`.

**Tech Stack:** Cloudflare Worker (TypeScript), React + MUI (JSX), Cloudflare D1 (SQL)

---

## Key Files

- `apps/worker/src/index.ts` — all API routes and handlers
- `apps/recipe-ui/src/App.jsx` — entire frontend (~5000 lines, single file)
- Deploy frontend: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
- Deploy worker: `cd apps/worker && npx wrangler deploy`

## Reference: Existing Code Locations

- `handleCreateOpenInvite` — creates open invite token (search `handleCreateOpenInvite` in index.ts)
- `handleAcceptOpenInvite` — accepts token, connects users (search `handleAcceptOpenInvite` in index.ts)
- Module-level URL capture block — lines ~140-165 in App.jsx (search `_openInvite`)
- `showInstallBanner` / `beforeinstallprompt` — lines ~1809-1819 in App.jsx
- Post-auth useEffect — search `pending_open_invite` in App.jsx (~line 2156)
- `generateOpenInviteUrl` — search by name in App.jsx (~line 1274)
- Invite buttons UI — search `Invite by Email` in App.jsx (~line 4865)
- Friends drawer `onClose` — search `setFriendsDrawerOpen(false)` or `friendsDrawerOpen`

---

## Task 1: Worker — return inviterName from accept-open-invite

**Files:**
- Modify: `apps/worker/src/index.ts`

**Context:** `handleAcceptOpenInvite` currently returns `json({ message: 'Connected!' })`. The `open_invites` row has `inviter_name` stored. Return it in the response so the frontend can personalize the snackbar.

**Step 1: Find the return statement**

Search for `Connected!` in `apps/worker/src/index.ts`. The handler fetches `invite` from the DB before deleting it in the batch. The `inviter_name` field is available on that row.

**Step 2: Capture inviter_name before the batch delete**

In `handleAcceptOpenInvite`, the `invite` variable holds the DB row. Before `env.DB.batch([...])`, add:

```typescript
const inviterName = (invite.inviter_name as string | null) || null;
```

**Step 3: Update the return statement**

Change:
```typescript
return json({ message: 'Connected!' });
```
To:
```typescript
return json({ message: 'Connected!', inviterName });
```

**Step 4: Verify build**

```bash
cd apps/worker && npm run build 2>&1 | grep -iE "^.*error" | head -20
```

Expected: no errors

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: return inviterName from accept-open-invite response"
```

---

## Task 2: Worker — deduplicate open invite tokens within 24h

**Files:**
- Modify: `apps/worker/src/index.ts`

**Context:** `handleCreateOpenInvite` currently always inserts a new row. Add a check: if the same user already has an `open_invite` created in the last 24 hours, return that existing token instead of creating a new one.

**Step 1: Find handleCreateOpenInvite**

Search for `handleCreateOpenInvite` in `apps/worker/src/index.ts`.

**Step 2: Add deduplication check at the top of the handler**

Insert BEFORE `const token = crypto.randomUUID()`:

```typescript
// Reuse existing token if one was created in the last 24 hours
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const existing = await env.DB.prepare(
  'SELECT token FROM open_invites WHERE inviter_user_id = ? AND created_at > ? LIMIT 1'
).bind(user.userId, cutoff).first();

if (existing) {
  return json({ token: existing.token as string });
}
```

**Step 3: Verify build**

```bash
cd apps/worker && npm run build 2>&1 | grep -iE "^.*error" | head -20
```

Expected: no errors

**Step 4: Deploy worker**

```bash
cd apps/worker && npx wrangler deploy 2>&1 | tail -5
```

Expected: `✨ Deployment complete`

**Step 5: Smoke test deduplication**

```bash
# Call twice — should get same token both times
TOKEN1=$(curl -s -X POST https://recipes-worker.elisa-widjaja.workers.dev/friends/open-invite \
  -H "Authorization: Bearer $DEV_API_KEY" -H "Content-Type: application/json" | jq -r .token)

TOKEN2=$(curl -s -X POST https://recipes-worker.elisa-widjaja.workers.dev/friends/open-invite \
  -H "Authorization: Bearer $DEV_API_KEY" -H "Content-Type: application/json" | jq -r .token)

echo "Same token: $([ "$TOKEN1" = "$TOKEN2" ] && echo YES || echo NO)"
```

Expected: `Same token: YES`

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: deduplicate open invite tokens within 24h window"
```

---

## Task 3: Frontend — auto-open auth dialog on invite arrival

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

**Context:** When a user arrives via `?invite=TOKEN`, they should immediately see the login/signup dialog. The token is already captured in `sessionStorage('pending_open_invite')` at module level (~line 155). We need to: (a) also set `sessionStorage('invite_entry', '1')`, and (b) on app mount, if `invite_entry` is set and user is not logged in, open the auth dialog.

**Step 1: Set invite_entry flag in module-level capture**

Find the block (around line 155-160):
```javascript
const _openInvite = _url.searchParams.get('invite');
if (_openInvite) {
  sessionStorage.setItem('pending_open_invite', _openInvite);
  _url.searchParams.delete('invite');
  window.history.replaceState({}, '', _url.toString());
}
```

Add `sessionStorage.setItem('invite_entry', '1');` inside the `if (_openInvite)` block:
```javascript
const _openInvite = _url.searchParams.get('invite');
if (_openInvite) {
  sessionStorage.setItem('pending_open_invite', _openInvite);
  sessionStorage.setItem('invite_entry', '1');
  _url.searchParams.delete('invite');
  window.history.replaceState({}, '', _url.toString());
}
```

**Step 2: Auto-open auth dialog on mount**

Find the `useEffect` that runs once on mount (or the one that runs when `session` changes). Look for the existing post-auth handler `useEffect` that checks `pending_open_invite` (around line 2156).

Find where `session` is first available (the useEffect with `[session]` dependency). Add at the START of that effect, before any other checks:

```javascript
// Auto-open auth dialog for users arriving via invite link
if (!session) {
  const isInviteEntry = sessionStorage.getItem('invite_entry');
  if (isInviteEntry) {
    sessionStorage.removeItem('invite_entry');
    openAuthDialog();
  }
}
```

**IMPORTANT:** This check must only run when `session` is `null` (not logged in). Place it inside the `if (!session)` branch or guard it with `if (!session)`.

**Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: auto-open auth dialog when arriving via invite link"
```

---

## Task 4: Frontend — suppress Add to Homescreen banner for invite arrivals

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

**Context:** The install banner is triggered by a `beforeinstallprompt` event with a 3-second delay (around lines 1809-1819). Suppress it if the user arrived via an invite link.

**Step 1: Find the install banner trigger**

Search for `beforeinstallprompt` in App.jsx. The handler looks roughly like:
```javascript
useEffect(() => {
  const handler = (e) => {
    e.preventDefault();
    deferredInstallPrompt.current = e;
    setTimeout(() => setShowInstallBanner(true), 3000);
  };
  window.addEventListener('beforeinstallprompt', handler);
  ...
}, []);
```

**Step 2: Add invite_entry check before showing the banner**

Wrap the `setTimeout` / `setShowInstallBanner(true)` call:
```javascript
setTimeout(() => {
  if (!sessionStorage.getItem('invite_entry')) {
    setShowInstallBanner(true);
  }
}, 3000);
```

Note: `invite_entry` is removed from sessionStorage in Task 3 Step 2 when the auth dialog opens, so this check correctly suppresses the banner only for the initial invite arrival session.

**Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: suppress install banner for invite link arrivals"
```

---

## Task 5: Frontend — personalized connection snackbar

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

**Context:** The post-auth handler (~line 2156-2176) calls `POST /friends/accept-open-invite` and shows a generic snackbar. The API now returns `inviterName`. Use it to personalize the message and show it at the top of the screen.

**Step 1: Find the accept-open-invite success handler**

Search for `pending_open_invite` in App.jsx. Find the `.then()` block that shows the snackbar. It currently shows something like:
```javascript
message: "You're now connected with your friend on ReciFind!"
```

**Step 2: Update to use inviterName from response**

The API call returns the response data. Capture it and use `inviterName`:

```javascript
const result = await callRecipesApi('/friends/accept-open-invite', {
  method: 'POST',
  body: JSON.stringify({ token: pendingOpenInviteToken })
}, accessToken);

const name = result?.inviterName;
setSnackbarState({
  open: true,
  message: name ? `You're connected with ${name}!` : "You're now connected with your friend on ReciFind!",
  severity: 'success',
  anchorOrigin: { vertical: 'top', horizontal: 'center' }
});
```

**Note:** The post-auth handler may use `.then()/.catch()` pattern (not async/await) to match the surrounding non-async useEffect. Adapt accordingly — the key is to get the return value of `callRecipesApi` and read `.inviterName` from it.

**Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: show personalized You're connected with [Name] snackbar at top"
```

---

## Task 6: Frontend — hide invite buttons after sending + snackbar

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

**Context:** After `generateOpenInviteUrl()` returns a URL (whether new or reused from deduplication), hide both invite buttons and show a snackbar. Add a "Send another invite" link to reset the state.

**Step 1: Add inviteSent state**

Find where other drawer-related state is declared (search `friendsDrawerOpen` or `friendsTab`). Add nearby:

```javascript
const [inviteSent, setInviteSent] = useState(false);
```

**Step 2: Reset inviteSent when Friends drawer closes**

Find the Friends drawer component (search for `friendsDrawerOpen` in JSX). On its `onClose` prop, add `setInviteSent(false)`:

```jsx
onClose={() => {
  setFriendsDrawerOpen(false);
  setInviteSent(false);
}}
```

**Step 3: Set inviteSent after URL generation in both invite buttons**

In both the "Invite by Email" and "Invite by Text" button `onClick` handlers, after `generateOpenInviteUrl()` returns a non-null URL and BEFORE opening the mailto/share, add:

```javascript
setInviteSent(true);
setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
```

**Step 4: Conditionally render the invite buttons**

In the invite buttons section (around line 4857-4904), wrap the two `<Button>` elements with a conditional:

```jsx
{inviteSent ? (
  <Box sx={{ textAlign: 'center', py: 1 }}>
    <Typography variant="body2" color="text.secondary">
      Invite sent! Pending acceptance.
    </Typography>
    <Button
      size="small"
      variant="text"
      sx={{ mt: 0.5 }}
      onClick={() => setInviteSent(false)}
    >
      Send another invite
    </Button>
  </Box>
) : (
  <>
    {/* existing Invite by Email button */}
    {/* existing Invite by Text button */}
  </>
)}
```

**Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: hide invite buttons after sending and show pending snackbar"
```

---

## Task 7: Build and deploy

**Step 1: Build**

```bash
cd apps/recipe-ui && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` (chunk size warnings are OK, no errors)

**Step 2: Deploy**

```bash
npx wrangler pages deploy dist --project-name recifind 2>&1 | tail -5
```

Expected: `✨ Deployment complete!` with `✨ Uploading Functions bundle` (confirms middleware deployed)

**Step 3: End-to-end smoke test**

1. Log into ReciFind on desktop → Friends tab → tap "Invite by Text"
   - Verify: both buttons disappear, snackbar "Invite sent! Pending acceptance." appears
   - Verify: "Send another invite" link resets buttons
2. Tap "Invite by Text" again — verify same token is returned (no new DB row)
3. Copy invite URL. Open in private/incognito window
   - Verify: auth dialog opens immediately (no home screen banner)
4. Sign up / log in
   - Verify: snackbar at TOP of screen shows "You're connected with [Your Name]!"
5. Check Friends tab on both accounts — both should show each other
