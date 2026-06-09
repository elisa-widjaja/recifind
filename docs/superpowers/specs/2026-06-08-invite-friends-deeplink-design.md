# "Invite Friends" Email CTA → Friends / Add Friend Drawer Deep Link — Design

Date: 2026-06-08
Status: Design approved, pending spec review

## Problem / context

The nudge email's "Invite Friends →" CTA points at `https://recifriend.com/friends`.
That path is already Universal-Link-associated and parses to `{ kind: 'friends_list' }`,
so on an iPhone with the app installed it opens the Friends view, but it lands on the
default tab with nothing prompting the user to actually add anyone. The user wants this
CTA to open the app (if installed) directly on the Friends page's "My Friends" tab with
the "Add Friend" drawer already open, so the invite action is one step away. On desktop
/ web (no app) it should do the same in the SPA.

The Friends infrastructure already supports this: `FriendsPage` takes an `initialTab`
prop (driven by App's `friendsInitialTab` state; tabs are `connections` = "My Friends"
and `pending`), and the Add Friend drawer is App-level state `addFriendDrawerOpen`
(opened via `setAddFriendDrawerOpen(true)`). The only gap is that no deep link can
currently request "open the add-friend drawer."

## Goal

`https://recifriend.com/friends?add=1`:
- Opens the installed iOS app on Friends → "My Friends" tab with the Add Friend drawer open.
- On the web (app not installed) loads the SPA Friends view in the same state.
- The nudge email's "Invite Friends →" CTA uses this URL.

## Non-goals / out of scope

- No AASA change. `/friends` is already in the associated paths; query strings don't
  affect AASA matching.
- The existing `/friends?invite_token=` and `/friends?invite=` flows are unchanged and
  keep priority over `?add=1`.
- No change to the Add Friend drawer's own contents/behavior, only opening it.
- Other emails' CTAs are out of scope.

## Design

### 1. Deep-link contract + parser (`apps/shared`)
- `contracts.ts`: extend the union member to `{ kind: 'friends_list'; open_add?: boolean }`.
- `deepLink.ts`: in the `/friends` branch, after the existing `invite_token` and `invite`
  checks, return `{ kind: 'friends_list', open_add: true }` when the `add` query param
  equals `1`; otherwise return bare `{ kind: 'friends_list' }` (current behavior). The
  invite-token cases still take precedence.

### 2. Dispatcher (`apps/recipe-ui/src/lib/deepLinkDispatch.js`)
- `onFriendsList` gains an optional arg; the switch becomes
  `case 'friends_list': return handlers.onFriendsList(link.open_add);`. JSDoc updated to
  `onFriendsList: (openAdd?: boolean) => void`.

### 3. App.jsx handler
- The `onFriendsList` handler accepts `openAdd`. When truthy it sets the friends tab to
  `connections` (`setFriendsInitialTab('connections')`) and `setAddFriendDrawerOpen(true)`,
  then `setCurrentView('friends')`. When falsy it behaves exactly as today (just
  `setCurrentView('friends')`), so bare `/friends` is unaffected.

### 4. Web path routing (App.jsx mount effect)
- Extend the SPA's mount routing so a web visitor landing on `/friends?add=1` selects the
  `connections` tab, opens the Add Friend drawer, and shows the Friends view, then
  normalizes the URL (strip the param) the same way the `/discover` and `?view=` routing
  does. (Reuse/extend the existing mount effect rather than adding a parallel one.)

### 5. Email CTA (`apps/worker/src/index.ts`)
- Change the "Invite Friends →" CTA href (~line 4915) from
  `https://recifriend.com/friends` to `https://recifriend.com/friends?add=1`.

## Affected files
- apps/shared/contracts.ts — `friends_list` gains `open_add?`.
- apps/shared/deepLink.ts — parse `?add=1`.
- apps/shared/deepLink.test.ts — cover `?add=1` + bare `/friends` + invite precedence.
- apps/recipe-ui/src/lib/deepLinkDispatch.js — pass `open_add` to `onFriendsList`.
- apps/recipe-ui/src/lib/deepLinkDispatch.test.js — cover the flag pass-through.
- apps/recipe-ui/src/App.jsx — `onFriendsList(openAdd)` handler + `/friends?add=1` web routing.
- apps/worker/src/index.ts — email CTA href.
- apps/worker/src/nudge-email.test.ts — assert the Invite CTA → `/friends?add=1`.

## Verification
- `cd apps/shared && npx vitest run deepLink.test.ts`: `/friends?add=1` → `{ kind: 'friends_list', open_add: true }`; bare `/friends` → `{ kind: 'friends_list' }` (no flag); `/friends?invite_token=x` and `/friends?invite=y` still parse to `friend_invite` (precedence preserved).
- `cd apps/recipe-ui && npm test`: dispatcher routes `friends_list` with `open_add` to `onFriendsList(true)`; full suite green.
- `cd apps/worker && npm test`: nudge email asserts the Invite CTA href is `https://recifriend.com/friends?add=1`.
- Manual (after deploy): send a test nudge; on the dev iOS build (live-loads dev.recifriend.com) tapping "Invite Friends" opens Friends → My Friends with the Add Friend drawer open; on web the same.

## Rollout
- Web routing + dispatcher + handler ship via **Pages** deploy.
- Email CTA ships via **worker** deploy (smoke-test the import/enrich path after, per the project rule).

### Open item (same as the `/discover` work)
Whether the **production App Store** app runs the new in-app `onFriendsList(openAdd)`
handler from a web deploy or needs a new iOS build depends on how that build loads its web
content. The Universal Link already resolves to the app (`/friends` is associated); the
question is only whether the bundled JS includes the new handler. Verify before relying on
the full tab+drawer behavior for App Store users; the dev build gets it immediately.
