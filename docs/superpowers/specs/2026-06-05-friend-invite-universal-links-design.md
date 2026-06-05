# Friend invite/accept links open the iOS app (Universal Links) — design

Date: 2026-06-05
Status: spec for review (not yet implemented)

## Problem

Friend **invite** links (email + SMS/text) always open the web version, never the
installed iOS app. Reported: "Friend invite request (email link) goes to web; need
email and text links to open the iOS app if installed."

## Root cause (verified)

iOS Universal Links match on the URL **path**. The live AASA
(`https://recifriend.com/.well-known/apple-app-site-association`, served 200 /
`application/json`) claims: `/auth/callback`, `/recipes`, `/recipes/*`,
`/friend-requests`, `/friends`, `/add-recipe`. The app has the
`applinks:recifriend.com` entitlement. So Universal Links already work for claimed
paths.

The invite links use the **root path** `/` with a query param, which the AASA cannot
claim (claiming `/` would hijack every web page into the app):
- Invite email (`worker/index.ts:3492`): `https://recifriend.com?invite_token=...`
- Invite SMS/text (`App.jsx:5514`): `https://recifriend.com?invite=...`

Root path → not claimed → iOS opens Safari. The native parser (`apps/shared/deepLink.ts`)
also returns `null` for the root path.

By contrast the friend-request **Accept** email
(`worker/index.ts:3551`) already uses the claimed `/friend-requests?accept_friend=...`
path, which the parser handles and which auto-accepts on landing — so that one already
opens the app. Recipe links (`/recipes/{id}`) work the same way. This is the pattern to
copy.

## Goal

Friend invite links (email + SMS) open the installed iOS app via Universal Link and
auto-connect the friendship in-app, matching the existing accept-link / recipe-link
behavior. Web fallback for users without the app is unchanged.

## Approach: move invite links onto the already-claimed `/friends` path

Reusing `/friends` (already in the AASA) means **no AASA change and no Apple
cache-propagation delay** — existing installs already recognize it as a Universal Link.
The presence of an invite query param distinguishes an invite from a plain friends-view
open.

Connection model is **A (auto-connect/auto-accept), with UI reconciliation** (chosen
during brainstorming): clicking the link is the affirmative action (the buttons say
"Join" / "Accept"), so the link connects, and the in-app UI is reconciled so nothing
goes stale.

## Components

### 1. Worker — invite email link
`worker/index.ts:3492`: `https://recifriend.com?invite_token=${inviteId}` →
`https://recifriend.com/friends?invite_token=${inviteId}`. Ships on worker deploy
(immediate).

### 2. Frontend — SMS/text invite link
`App.jsx:5514`: `${SHARE_PUBLIC_URL}?invite=${token}` →
`${SHARE_PUBLIC_URL}/friends?invite_token=${token}`. Ships on Pages deploy and is
bundled into the next app build.

Note: today the email uses `invite_token` (a pending-invite id) and the SMS uses
`invite` (an open/shareable token from `/friends/open-invite`) — different token types.
The plan will confirm whether they can share one param name or must stay distinct; the
design only requires both to arrive on `/friends` and be routed to the existing connect
flow. Whatever param(s) are used, the web module-load capture
(`App.jsx:263-272`, currently reads `invite_token`) and the parser must read the same
name(s).

### 3. Parser — `apps/shared/deepLink.ts`
Add a `/friends` case mirroring the existing `/friend-requests` case:
- `/friends` with an invite param → `{ kind: 'friend_invite', token }`
- `/friends` with no invite param → `{ kind: 'friends_list' }` (plain open)

The existing `/friend-requests?accept_friend=` → `{ kind: 'friend_requests', accept_id }`
case is unchanged.

### 4. Dispatcher — `apps/recipe-ui/src/lib/deepLinkDispatch.js`
Handle `friend_invite`: stash the token and run the **existing** post-auth connect flow
(the same `pending_invite_token` path the web uses today). An app-installed invitee is
already signed in, so the connect happens immediately. The existing `friend_requests`
(auto-accept) dispatch is unchanged.

### 5. UI reconciliation after a link-driven accept/connect
After the link accepts/connects (which removes the pending request server-side), the
in-app state must reconcile (these artifacts are shown in
`apps/recipe-ui/src/components/FriendSections.jsx`):
- **Friend-request activity item** flips to `resolved` (the existing flag, already set
  for "accepted via email"; renders a checkmark, not tappable). **Copy change:** a
  resolved item should read "You and X are now connected" instead of the original
  "X sent you a friend request" + checkmark.
- **"1" Friends-tab badge** (pending-request count) clears once the requests list
  refreshes.
- **Accept/decline dialog**: if it happens to be open when the link fires, it is
  dismissed on refresh.
- The accept/connect call must be **idempotent** — an already-accepted or
  double-tapped state is a graceful no-op (no error, no un-friend).

## Behavior matrix

| Path | App installed | Result |
|---|---|---|
| Invite email/SMS link | yes | Opens app (Universal Link), auto-connects, activity shows "now connected" |
| Invite email/SMS link | no | Opens web; existing web connect flow runs (unchanged) |
| Accept-request email link | yes | Already works: opens app, auto-accepts; reconciliation applies |
| No link — user opens app | n/a | Activity shows "X sent you a friend request" (tappable) → tap opens accept/decline dialog; "1" badge; Pending tab lists X. **Unchanged.** |

## Web fallback (the common invitee case)
Unchanged. The SPA serves `index.html` for arbitrary paths (how `/recipes/{id}` works on
web), and the module-load handler reads the invite param from the query regardless of
path. `/friends?invite_token=X` in a browser behaves exactly like today's root-path form.

## Out of scope (explicitly not doing)
- **No auto-popping** the accept/decline dialog on app open.
- **No inline Accept/Decline buttons** on the activity card.
- The accept/decline UX stays exactly as today: tap the activity card → dialog. (The
  acceptance-UX question is a separate decision, deliberately not bundled here.)
- No AASA change, no entitlement change, no change to the recipe or auth deep links.

## What ships when
- **Immediate** (worker + Pages deploy): invite links point at `/friends`; existing app
  installs already recognize it, so the link **opens the app**.
- **Next app build (28+)**: the parser/dispatcher invite handling + the resolved-copy
  change (bundled web assets) make the app **auto-connect and reconcile**. Until then an
  app-installed invitee opens to the friends view without auto-connect — but invitees
  usually do not have the app yet (web path, fully working). To avoid a degraded window,
  land the link flip and the in-app handling together in the next build.

## Testing
- Unit (`apps/shared/deepLink.test.ts`): `/friends?invite_token=` → `friend_invite`;
  `/friends` (no param) → `friends_list`; the `invite` param variant; confirm
  `/friend-requests?accept_friend=` still parses unchanged.
- Manual: invite email + SMS on a device with the app installed → opens app → connects →
  activity reads "now connected", badge clears. Same links with the app uninstalled →
  web flow still connects. In-app discovery (no link) → dialog/badge/Pending unchanged.
