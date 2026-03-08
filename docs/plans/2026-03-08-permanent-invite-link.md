# Permanent Invite Link — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current single-use open invite token + Requests tab UI with a permanent, reusable invite link shown directly in the invite section. Removed friends cannot reconnect via the same link.

**Tech Stack:** Cloudflare Worker (TypeScript), Cloudflare D1 (SQL), React + MUI (JSX)

---

## Key Files

- `apps/worker/src/index.ts` — all API routes and handlers
- `apps/recipe-ui/src/App.jsx` — entire frontend (~5000 lines, single file)
- Deploy frontend: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
- Deploy worker: `cd apps/worker && npx wrangler deploy`

---

## Reference: Existing Code Locations

- `handleCreateOpenInvite` — search by name in `index.ts` (creates token, has 24h dedup check)
- `handleAcceptOpenInvite` — search by name in `index.ts` (accepts token, currently deletes it)
- `handleListSentInvites` — search by name in `index.ts` (returns email + open invites)
- `handleDeleteOpenInvite` — search by name in `index.ts` (deletes token by inviter)
- Invite buttons UI — search `Invite by Email` in `App.jsx`
- `generateOpenInviteUrl` — search by name in `App.jsx`
- `sentInvites.map` — search in `App.jsx` (Requests tab rendering)
- Post-auth useEffect — search `pending_open_invite` in `App.jsx`

---

## Task 1: DB — create open_invite_used table

**Files:** `apps/worker/src/index.ts`

**Step 1: Create the migration**

Run against D1 (both local and prod):

```bash
npx wrangler d1 execute recipes-db --remote --command "
CREATE TABLE IF NOT EXISTS open_invite_used (
  inviter_user_id TEXT NOT NULL,
  accepter_user_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (inviter_user_id, accepter_user_id)
);
"
```

**Step 2: Verify**

```bash
npx wrangler d1 execute recipes-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='open_invite_used';"
```

Expected: one row with `name = open_invite_used`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add open_invite_used table for permanent invite link tracking"
```

---

## Task 2: Worker — make token permanent + block re-accept

**Files:** `apps/worker/src/index.ts`

**Context:** `handleAcceptOpenInvite` currently deletes the token after acceptance. Change it to:
1. Keep the token (remove DELETE from batch)
2. Check `open_invite_used` before accepting — block if accepter already used this inviter's link
3. Record the acceptance in `open_invite_used` after connecting

**Step 1: Find handleAcceptOpenInvite**

Search for `handleAcceptOpenInvite` in `index.ts`. The batch currently includes:
```typescript
env.DB.prepare('DELETE FROM open_invites WHERE token = ?').bind(token),
```

**Step 2: Remove DELETE from batch**

Remove the `DELETE FROM open_invites` line from the `env.DB.batch([...])` call. Keep the two friend INSERT statements.

**Step 3: Add re-accept check (after the "already friends" check)**

After the existing `if (existing)` already-friends check, add:

```typescript
// Block re-accept: if accepter has previously used this inviter's link, deny
const previouslyUsed = await env.DB.prepare(
  'SELECT 1 FROM open_invite_used WHERE inviter_user_id = ? AND accepter_user_id = ?'
).bind(inviterUserId, user.userId).first();

if (previouslyUsed) {
  return json({ message: 'Already used' });
}
```

**Step 4: Record acceptance in open_invite_used (after the batch)**

After `await env.DB.batch([...])`, add:

```typescript
await env.DB.prepare(
  'INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at) VALUES (?, ?, ?)'
).bind(inviterUserId, user.userId, now).run();
```

**Step 5: Verify build**

```bash
cd apps/worker && npx wrangler deploy 2>&1 | tail -5
```

Expected: `✨ Deployment complete`

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: make open invite token permanent, block re-accept after friend removal"
```

---

## Task 3: Worker — remove 24h deduplication, make token permanent per user

**Files:** `apps/worker/src/index.ts`

**Context:** `handleCreateOpenInvite` has a 24h cutoff check. Replace it with a simple "return existing token if any" (no time limit).

**Step 1: Find the deduplication block**

Search for `cutoff` in `handleCreateOpenInvite`. It looks like:

```typescript
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const existing = await env.DB.prepare(
  'SELECT token FROM open_invites WHERE inviter_user_id = ? AND created_at > ? LIMIT 1'
).bind(user.userId, cutoff).first();
```

**Step 2: Remove time limit**

Replace the entire cutoff block with:

```typescript
// Return existing token if one exists (permanent until explicitly regenerated)
const existing = await env.DB.prepare(
  'SELECT token FROM open_invites WHERE inviter_user_id = ? LIMIT 1'
).bind(user.userId).first();
```

Remove the `cutoff` variable entirely.

**Step 3: Add POST /friends/open-invite/regenerate endpoint**

In the route matching section, after the existing `POST /friends/open-invite` route, add:

```typescript
if (url.pathname === '/friends/open-invite/regenerate' && request.method === 'POST') {
  if (!user) throw new HttpError(401, 'Missing Authorization header');
  return await handleRegenerateOpenInvite(request, env, user);
}
```

**Step 4: Add handleRegenerateOpenInvite function**

Add after `handleCreateOpenInvite`:

```typescript
async function handleRegenerateOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const body = await request.json() as { generateNew?: boolean };
  const generateNew = body.generateNew !== false; // default true

  // Delete existing token
  await env.DB.prepare('DELETE FROM open_invites WHERE inviter_user_id = ?').bind(user.userId).run();

  if (!generateNew) {
    return json({ token: null });
  }

  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const token = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO open_invites (token, inviter_user_id, inviter_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.userId, profile.displayName || null, now).run();

  return json({ token });
}
```

**Step 5: Deploy**

```bash
cd apps/worker && npx wrangler deploy 2>&1 | tail -5
```

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: permanent invite token per user, add regenerate endpoint"
```

---

## Task 4: Worker — clean up handleListSentInvites and remove handleDeleteOpenInvite

**Files:** `apps/worker/src/index.ts`

**Step 1: Revert handleListSentInvites to email-only**

Replace the current `handleListSentInvites` (which includes open invites) with the simple version:

```typescript
async function handleListSentInvites(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    'SELECT id, invited_email, created_at FROM pending_invites WHERE inviter_user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(user.userId).all();

  const invites = (result.results || []).map((row) => ({
    inviteId: row.id as string,
    toEmail: row.invited_email as string,
    createdAt: row.created_at as string,
  }));

  return json({ invites });
}
```

**Step 2: Remove handleDeleteOpenInvite function and its route**

- Remove the `DELETE /friends/open-invite` route from the router
- Remove the `handleDeleteOpenInvite` function

**Step 3: Add GET /friends/open-invite endpoint**

Add route (so frontend can fetch the current link on drawer open):

```typescript
if (url.pathname === '/friends/open-invite' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Missing Authorization header');
  return await handleGetOpenInvite(env, user);
}
```

Add handler:

```typescript
async function handleGetOpenInvite(env: Env, user: AuthenticatedUser): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT token FROM open_invites WHERE inviter_user_id = ? LIMIT 1'
  ).bind(user.userId).first();
  return json({ token: existing ? (existing.token as string) : null });
}
```

**Step 4: Deploy**

```bash
cd apps/worker && npx wrangler deploy 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: clean up invite endpoints, add GET /friends/open-invite"
```

---

## Task 5: Frontend — new invite section UI with permanent link

**Files:** `apps/recipe-ui/src/App.jsx`

**Context:** Replace the current invite buttons section with a three-state UI: loading → no link → active link. Load the current link when the invite section opens.

**Step 1: Add openInviteLink state and loading state**

Near the `isAddFriendOpen` state declaration, add:

```javascript
const [openInviteLink, setOpenInviteLink] = useState(null); // null = not loaded yet
const [openInviteLinkLoading, setOpenInviteLinkLoading] = useState(false);
const [openInviteLinkLoaded, setOpenInviteLinkLoaded] = useState(false);
```

**Step 2: Fetch current link when invite section opens**

Find where `isAddFriendOpen` is set to true (the "Add Friend" button onClick). After `setIsAddFriendOpen(true)`, add a fetch:

```javascript
setIsAddFriendOpen(true);
// Fetch current invite link
setOpenInviteLinkLoaded(false);
setOpenInviteLinkLoading(true);
callRecipesApi('/friends/open-invite', {}, accessToken)
  .then((res) => {
    setOpenInviteLink(res?.token || null);
    setOpenInviteLinkLoaded(true);
  })
  .catch(() => { setOpenInviteLinkLoaded(true); })
  .finally(() => setOpenInviteLinkLoading(false));
```

**Step 3: Reset on drawer close**

In the Drawer `onClose` handler, add:
```javascript
setOpenInviteLink(null);
setOpenInviteLinkLoaded(false);
```

**Step 4: Replace the invite buttons section**

Find the current `isAddFriendOpen ? (` section (the invite UI). Replace the entire content with:

```jsx
<Box sx={{ mt: '24px' }}>
  <Typography variant="subtitle2" gutterBottom sx={{ fontSize: { xs: '13px', sm: '0.875rem' } }}>
    Invite a friend
  </Typography>

  {/* Link display area */}
  {openInviteLinkLoading ? (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
      <CircularProgress size={20} />
    </Box>
  ) : !openInviteLinkLoaded || openInviteLink ? (
    <>
      {openInviteLink && (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            bgcolor: 'action.hover', borderRadius: 1, px: 1.5, py: 1, mb: 1.5
          }}
        >
          <Typography
            variant="caption"
            sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}
          >
            {`${window.location.origin}?invite=${openInviteLink}`}
          </Typography>
          <IconButton
            size="small"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}?invite=${openInviteLink}`);
              setSnackbarState({ open: true, message: 'Invite link copied!', severity: 'success' });
            }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      <Stack spacing={1.5}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<EmailOutlinedIcon />}
          onClick={async () => {
            let link = openInviteLink;
            if (!link) {
              link = await generateOpenInviteUrl();
              if (!link) return;
              setOpenInviteLink(link);
            }
            const subject = encodeURIComponent('Join me on ReciFind!');
            const body = encodeURIComponent(
              `Hey! I'd love to share recipes with you on ReciFind.\n\nJoin me here: ${window.location.origin}?invite=${link}`
            );
            window.location.href = `mailto:?subject=${subject}&body=${body}`;
            setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
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
            let link = openInviteLink;
            if (!link) {
              link = await generateOpenInviteUrl();
              if (!link) return;
              setOpenInviteLink(link);
            }
            const inviteUrl = `${window.location.origin}?invite=${link}`;
            const text = `Hey! I'd love to share recipes with you on ReciFind. Join me here: ${inviteUrl}`;
            if (navigator.share) {
              try {
                await navigator.share({ text, url: inviteUrl });
                setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
                trackEvent('invite_friend', { method: 'native_share' });
                return;
              } catch (err) {
                if (err.name === 'AbortError') return;
              }
            }
            window.open(`sms:?body=${encodeURIComponent(text)}`);
            setSnackbarState({ open: true, message: 'Invite sent! Pending acceptance.', severity: 'success' });
            trackEvent('invite_friend', { method: 'sms' });
          }}
        >
          Invite by Text
        </Button>
      </Stack>

      {openInviteLink && (
        <Button
          size="small"
          variant="text"
          color="inherit"
          sx={{ mt: 1, opacity: 0.6, fontSize: '0.75rem' }}
          onClick={() => setOpenInviteRegenerateOpen(true)}
        >
          Regenerate link
        </Button>
      )}
    </>
  ) : (
    /* No active link state */
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        No active invite link
      </Typography>
      <Button
        variant="outlined"
        size="small"
        onClick={async () => {
          const link = await generateOpenInviteUrl();
          if (link) setOpenInviteLink(link);
        }}
      >
        Generate link
      </Button>
    </Box>
  )}
</Box>
```

**Step 5: Add openInviteRegenerateOpen state**

Near the other invite states:
```javascript
const [openInviteRegenerateOpen, setOpenInviteRegenerateOpen] = useState(false);
const [openInviteDeactivate, setOpenInviteDeactivate] = useState(false);
```

**Step 6: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: permanent invite link UI with copy, email, text, and regenerate"
```

---

## Task 6: Frontend — regenerate confirmation dialog

**Files:** `apps/recipe-ui/src/App.jsx`

**Step 1: Add the dialog**

Near the other dialogs (e.g., near `friendConfirm` Dialog), add:

```jsx
<Dialog
  open={openInviteRegenerateOpen}
  onClose={() => { setOpenInviteRegenerateOpen(false); setOpenInviteDeactivate(false); }}
  maxWidth="xs"
  fullWidth
>
  <DialogTitle>Regenerate invite link?</DialogTitle>
  <DialogContent>
    <Typography variant="body2" sx={{ mb: 2 }}>
      Your current link will stop working. Anyone who hasn't accepted it yet won't be able to connect.
    </Typography>
    <FormControlLabel
      control={
        <Checkbox
          checked={openInviteDeactivate}
          onChange={(e) => setOpenInviteDeactivate(e.target.checked)}
          size="small"
        />
      }
      label={
        <Typography variant="body2">Deactivate without generating a new link</Typography>
      }
    />
  </DialogContent>
  <DialogActions>
    <Button onClick={() => { setOpenInviteRegenerateOpen(false); setOpenInviteDeactivate(false); }}>
      Cancel
    </Button>
    <Button
      variant="contained"
      onClick={async () => {
        setOpenInviteRegenerateOpen(false);
        setOpenInviteDeactivate(false);
        setOpenInviteLinkLoading(true);
        try {
          const res = await callRecipesApi('/friends/open-invite/regenerate', {
            method: 'POST',
            body: JSON.stringify({ generateNew: !openInviteDeactivate })
          }, accessToken);
          setOpenInviteLink(res?.token || null);
          setOpenInviteLinkLoaded(true);
          setSnackbarState({
            open: true,
            message: openInviteDeactivate ? 'Invite link deactivated.' : 'Invite link regenerated.',
            severity: 'success'
          });
        } catch {
          setSnackbarState({ open: true, message: 'Could not regenerate link.', severity: 'error' });
        } finally {
          setOpenInviteLinkLoading(false);
        }
      }}
    >
      Confirm
    </Button>
  </DialogActions>
</Dialog>
```

**Step 2: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: add regenerate invite link confirmation dialog with deactivate option"
```

---

## Task 7: Frontend — remove open invite from Requests tab

**Files:** `apps/recipe-ui/src/App.jsx`

**Step 1: Remove isOpenInvite handling from sentInvites.map()**

In `sentInvites.map()`, remove:
- The copy IconButton for open invite rows
- The `isOpenInvite` conditional in `secondaryAction`
- The `isOpenInvite` conditional in Avatar
- The `isOpenInvite` conditional in `ListItemText`

Restore to the simple email-only version:
```jsx
{sentInvites.map((inv) => (
  <ListItem
    key={inv.inviteId}
    sx={{ pl: 0, '& .MuiListItemSecondaryAction-root': { right: -8 } }}
    secondaryAction={
      <IconButton
        size="small"
        onClick={() => setFriendConfirm({
          open: true,
          title: 'Cancel invite',
          message: `Cancel your invite to ${inv.toEmail}?`,
          onConfirm: () => cancelInvite(inv.inviteId)
        })}
        aria-label="Cancel invite"
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    }
  >
    <ListItemAvatar>
      <Avatar sx={{ bgcolor: 'grey.300' }}>
        {(inv.toEmail || '?')[0].toUpperCase()}
      </Avatar>
    </ListItemAvatar>
    <ListItemText
      primary={inv.toEmail}
      secondary="Invited — not on ReciFind yet"
      sx={{ pr: 8 }}
    />
  </ListItem>
))}
```

**Step 2: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: remove open invite row from requests tab"
```

---

## Task 8: Build and deploy

**Step 1: Build**

```bash
cd apps/recipe-ui && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

**Step 2: Deploy frontend**

```bash
npx wrangler pages deploy dist --project-name recifind 2>&1 | tail -5
```

Expected: `✨ Deployment complete!`

**Step 3: Smoke test**

1. Open Friends → Add Friend → invite section loads with current link (or "No active link")
2. Tap copy → "Invite link copied!" snackbar
3. Tap "Invite by Email" → mail app opens
4. Tap "Invite by Text" → share sheet opens; dismiss → no snackbar; share → "Invite sent!" snackbar
5. Tap "Regenerate link" → dialog opens with deactivate checkbox
6. Confirm without checkbox → new link appears
7. Confirm with checkbox → "No active link" state + "Generate link" button
8. Open invite URL in incognito → auth dialog opens, no install banner
9. Sign in → "You're connected with [Name]!" snackbar at top
10. Sign in again with same account via same link → blocked (Already used)
