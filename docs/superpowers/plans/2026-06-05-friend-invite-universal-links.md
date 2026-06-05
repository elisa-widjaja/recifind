# Friend invite Universal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit policy for THIS session:** the user holds all commits until explicit go-ahead. Implementers must NOT run `git commit`/`git add`; leave changes in the working tree. Ignore the per-task "Commit" steps.

**Goal:** Friend invite links (email + SMS) open the installed iOS app via Universal Link and auto-connect, by moving them onto the already-claimed `/friends` path and teaching the deep-link parser/dispatcher to handle them; reconcile the in-app friend-request UI so nothing goes stale.

**Architecture:** Move both invite links from the unclaimable root path `/` onto `/friends` (already in the AASA — no AASA/entitlement change). Add `friend_invite`/`friends_list` to the shared deep-link contract + parser + dispatcher. The dispatcher runs the existing connect endpoints (`/friends/accept-invite` for the email `invite_token`, `/friends/accept-open-invite` for the SMS `invite` token — kept distinct). Mark the resolved friend-request activity item "now connected".

**Tech Stack:** Shared TypeScript (`apps/shared`, vitest), React (`App.jsx`/`FriendSections.jsx`, no JS unit harness — verify via build + manual), Cloudflare Worker (TS).

Spec: `docs/superpowers/specs/2026-06-05-friend-invite-universal-links-design.md`

## File Structure
- `apps/shared/contracts.ts` — add two `DeepLink` variants.
- `apps/shared/deepLink.ts` — add the `/friends` parse case.
- `apps/shared/deepLink.test.ts` — parser tests.
- `apps/recipe-ui/src/lib/deepLinkDispatch.js` — dispatch the two new kinds.
- `apps/recipe-ui/src/App.jsx` — `onFriendInvite`/`onFriendsList` handlers; extract `acceptInvite`/`acceptOpenInvite` into refs.
- `apps/recipe-ui/src/components/FriendSections.jsx` — resolved-item "now connected" copy.
- `apps/worker/src/index.ts` — invite email link → `/friends`.

The link-form changes (worker + SMS) deploy immediately; the parser/dispatcher/copy changes (bundled web assets) ride the next app build (28+). Land them together to avoid a degraded window.

---

## Task 1: Add `friend_invite` + `friends_list` to the deep-link contract

**Files:** Modify `apps/shared/contracts.ts:56-62`

- [ ] **Step 1: Extend the `DeepLink` union**

Replace the `DeepLink` type (currently lines 56-62) with:
```ts
export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string; title?: string }
  | { kind: 'friend_requests'; accept_id?: string }
  | { kind: 'friend_invite'; token: string; invite_kind: 'pending' | 'open' }
  | { kind: 'friends_list' }
  | { kind: 'recipe_detail'; recipe_id: string; owner_id?: string }
  | { kind: 'recipes_list' }
  | { kind: 'open_pending_share' };
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/worker && npx tsc -p tsconfig.json --noEmit` (or the repo's shared typecheck). Expected: no new errors from this change. (If `apps/shared` has no own tsconfig, this type is validated transitively by the parser tests in Task 2.)

---

## Task 2: Parser handles `/friends` invite + plain open

**Files:** Modify `apps/shared/deepLink.ts` (add a case before the final `return null;`), Test `apps/shared/deepLink.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/shared/deepLink.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDeepLink } from './deepLink';

describe('parseDeepLink /friends', () => {
  it('parses /friends?invite_token= as a pending friend_invite', () => {
    expect(parseDeepLink('https://recifriend.com/friends?invite_token=abc123'))
      .toEqual({ kind: 'friend_invite', token: 'abc123', invite_kind: 'pending' });
  });
  it('parses /friends?invite= as an open friend_invite', () => {
    expect(parseDeepLink('https://recifriend.com/friends?invite=xyz789'))
      .toEqual({ kind: 'friend_invite', token: 'xyz789', invite_kind: 'open' });
  });
  it('parses bare /friends as friends_list', () => {
    expect(parseDeepLink('https://recifriend.com/friends'))
      .toEqual({ kind: 'friends_list' });
  });
  it('leaves /friend-requests?accept_friend= unchanged', () => {
    expect(parseDeepLink('https://recifriend.com/friend-requests?accept_friend=u1'))
      .toEqual({ kind: 'friend_requests', accept_id: 'u1' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd apps/shared && npx vitest run deepLink.test.ts -t "/friends"` (or from repo root if shared tests run there — check `apps/shared` for a test script; if shared tests live under another package, run `npx vitest run apps/shared/deepLink.test.ts`).
Expected: the three new `/friends` tests FAIL (parser returns null); the `/friend-requests` test passes.

- [ ] **Step 3: Implement the `/friends` case**

In `apps/shared/deepLink.ts`, immediately AFTER the existing `/friend-requests` block and BEFORE the final `return null;`, add:
```ts
  // /friends — friend-invite landing. `?invite_token=<id>` is the email invite
  // (a pending-invite id); `?invite=<token>` is the SMS open invite (a shareable
  // token). They route to different connect endpoints, so keep them distinct.
  // Bare /friends just opens the friends view.
  if (fullPath === '/friends' || fullPath === '/friends/') {
    const pendingToken = url.searchParams.get('invite_token');
    if (pendingToken) return { kind: 'friend_invite', token: pendingToken, invite_kind: 'pending' };
    const openToken = url.searchParams.get('invite');
    if (openToken) return { kind: 'friend_invite', token: openToken, invite_kind: 'open' };
    return { kind: 'friends_list' };
  }
```

- [ ] **Step 4: Run, expect PASS**

Run: the same vitest command. Expected: all four tests PASS. Then run the full shared suite (`npx vitest run` in the shared package) and confirm no regressions in existing deep-link tests.

---

## Task 3: Dispatcher routes the two new kinds

**Files:** Modify `apps/recipe-ui/src/lib/deepLinkDispatch.js`

No unit harness for the dispatcher wiring beyond the parser; verify via build + the App.jsx manual test.

- [ ] **Step 1: Add the two cases + JSDoc**

In `createDispatcher`'s JSDoc handler list, add:
```js
 *   onFriendInvite: (token: string, inviteKind: 'pending' | 'open') => void,
 *   onFriendsList: () => void,
```
In the `switch (link.kind)`, add (after the `friend_requests` case):
```js
      case 'friend_invite':      return handlers.onFriendInvite(link.token, link.invite_kind);
      case 'friends_list':       return handlers.onFriendsList();
```

- [ ] **Step 2: Build**

Run: `cd apps/recipe-ui && npm run build`. Expected: succeeds (App.jsx must provide the new handlers — done in Task 6; if building before Task 6, the dispatcher object literal will be missing keys but JS won't fail the build. Proceed to Task 6 before manual testing.)

---

## Task 4: Worker invite email link → `/friends`

**Files:** Modify `apps/worker/src/index.ts:3492`

- [ ] **Step 1: Change the link**

Replace:
```ts
        <a href="https://recifriend.com?invite_token=${inviteId}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Join ReciFriend</a>
```
with (only the `href` changes — add the `/friends` path):
```ts
        <a href="https://recifriend.com/friends?invite_token=${inviteId}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Join ReciFriend</a>
```

- [ ] **Step 2: Worker suite stays green**

Run: `cd apps/worker && npx vitest run`. Expected: still 327 passing (no test asserts this exact URL; if one does, update it to the `/friends` form). 

---

## Task 5: Frontend SMS invite link → `/friends`

**Files:** Modify `apps/recipe-ui/src/App.jsx:5514`

- [ ] **Step 1: Change the link (keep the `invite` param — it's the open-invite token)**

Replace:
```jsx
          const inviteUrl = `${SHARE_PUBLIC_URL}?invite=${token}`;
```
with:
```jsx
          const inviteUrl = `${SHARE_PUBLIC_URL}/friends?invite=${token}`;
```
Do NOT rename `invite` → `invite_token`: this token is consumed by `/friends/accept-open-invite`, a different endpoint than the email `invite_token`.

- [ ] **Step 2: Build**

Run: `cd apps/recipe-ui && npm run build`. Expected: succeeds.

---

## Task 6: App.jsx — invite handlers + extracted connect functions

**Files:** Modify `apps/recipe-ui/src/App.jsx` (dispatcher handlers ~`:2154`, plus add refs + extract the two connect calls)

The existing `onFriendRequests` (~`:2154`) is the pattern: signed in → call a ref; not signed in → stash in sessionStorage for the post-signin effect. Mirror it.

- [ ] **Step 1: Add refs for the two connect operations**

Near `acceptFriendRequestRef` (defined ~`:2061`), add:
```jsx
  const acceptInviteRef = useRef(null);       // POST /friends/accept-invite (email invite_token)
  const acceptOpenInviteRef = useRef(null);   // POST /friends/accept-open-invite (SMS open invite)
```

- [ ] **Step 2: Extract the two connect calls into functions and publish to refs**

The connect logic currently lives inline in the post-auth effect (`/friends/accept-invite` ~`:3990`, `/friends/accept-open-invite` ~`:4046`). Add these two functions in the component body (near `acceptFriendRequest` ~`:2652`), reusing the exact endpoints + success snackbars already in the effect:
```jsx
  const acceptInvite = async (token) => {
    try {
      const res = await callRecipesApi('/friends/accept-invite', { method: 'POST', body: JSON.stringify({ token }) }, accessTokenRef.current);
      const name = res?.inviterName;
      setSnackbarState({ open: true, message: name ? `You're now connected with ${name}` : "You're now connected!", severity: 'success', duration: 8000, anchorOrigin: { vertical: 'top', horizontal: 'center' } });
      fetchFriends();
      friendActivityRefreshRef.current?.();
    } catch {
      setSnackbarState({ open: true, message: 'Could not accept the invite. It may have expired.', severity: 'error' });
    }
  };
  const acceptOpenInvite = async (token) => {
    try {
      const res = await callRecipesApi('/friends/accept-open-invite', { method: 'POST', body: JSON.stringify({ token }) }, accessTokenRef.current);
      const name = res?.inviterName;
      setSnackbarState({ open: true, message: name ? `You're now connected with ${name}!` : "You're now connected with your friend on ReciFriend!", severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
      fetchFriends();
      friendActivityRefreshRef.current?.();
    } catch {
      setSnackbarState({ open: true, message: 'Could not accept the invite. It may have expired.', severity: 'error' });
    }
  };
```
And publish them via an effect next to where `acceptFriendRequestRef.current = acceptFriendRequest` is set (~`:3818`):
```jsx
  useEffect(() => { acceptInviteRef.current = acceptInvite; acceptOpenInviteRef.current = acceptOpenInvite; });
```
(`friendActivityRefreshRef` is added in Task 8 — if implementing Task 6 first, the `?.()` call is a safe no-op until then.)

- [ ] **Step 3: Add the dispatcher handlers**

In the dispatcher handler object (where `onFriendRequests` is defined ~`:2154`), add:
```jsx
      onFriendInvite: (token, inviteKind) => {
        setCurrentView('friends');
        if (accessTokenRef.current) {
          if (inviteKind === 'open') acceptOpenInviteRef.current?.(token);
          else acceptInviteRef.current?.(token);
        } else {
          sessionStorage.setItem(inviteKind === 'open' ? 'pending_open_invite' : 'pending_invite_token', token);
        }
      },
      onFriendsList: () => { setCurrentView('friends'); },
```
(If `'friends'` is not the exact `currentView` value for the friends view, use the value the hamburger/Friends-tab navigation uses — grep `setCurrentView(` for the friends destination and match it.)

- [ ] **Step 4: Build + manual sanity**

Run: `cd apps/recipe-ui && npm run build`. Expected: succeeds. Manual (browser at dev.recifriend.com): load `/friends?invite_token=<valid>` and `/friends?invite=<valid>` while signed in → "You're now connected" snackbar; bare `/friends` → friends view, no connect call.

---

## Task 7: FriendSections — resolved item reads "now connected"

**Files:** Modify `apps/recipe-ui/src/components/FriendSections.jsx` (the connection-notification render ~`:778-786`)

- [ ] **Step 1: Override the message for resolved friend-requests**

A `friend_request` item renders `{item.message}` (the server text, e.g. "X sent you a friend request"). When `isResolvedFriendRequest` is true, render the connected copy instead. Replace the `{item.message}` render (~`:784`) with:
```jsx
          {isResolvedFriendRequest ? `You and ${friendName} are now connected` : item.message}
```
(`friendName` and `isResolvedFriendRequest` are already in scope at `:666` and `:676`.)

- [ ] **Step 2: Build**

Run: `cd apps/recipe-ui && npm run build`. Expected: succeeds.

---

## Task 8: Reconcile activity feed + badge after a link connect

**Files:** Modify `apps/recipe-ui/src/App.jsx` (add `friendActivityRefreshRef`), `apps/recipe-ui/src/components/FriendSections.jsx` (expose a refresh)

After a link-driven accept/connect, the activity feed must re-fetch so the item flips to `resolved` (server-derived) and the Friends-tab "1" badge clears. `fetchFriends()` (called in Task 6) refreshes the friends/badge side; this task wires the activity-feed refresh.

- [ ] **Step 1: Add the ref in App.jsx**

Near the other refs (~`:2061`):
```jsx
  const friendActivityRefreshRef = useRef(null);
```
Pass a setter into `FriendSections` where it's rendered (find `<FriendSections` ~`:5760`) by adding a prop:
```jsx
                onReady={(refresh) => { friendActivityRefreshRef.current = refresh; }}
```

- [ ] **Step 2: Expose the refresh from FriendSections**

In `FriendSections.jsx`, find the function that fetches the activity feed (grep `fetch`/`loadActivity`/`useEffect` that populates the feed). Add an `onReady` prop to the component signature (`:40`) and, in a `useEffect`, publish the existing fetch function:
```jsx
  useEffect(() => { onReady?.(loadFeed); }, [onReady, loadFeed]);
```
(Use the actual feed-loading function name. If the feed loads via an inline effect with no named function, extract it into a `useCallback` named `loadFeed` first, then reference it in both the mount effect and `onReady`.)

- [ ] **Step 3: Build + manual**

Run: `cd apps/recipe-ui && npm run build`. Expected: succeeds. Manual: accept via link → the "X sent you a friend request" card flips to "You and X are now connected" with a checkmark, and the Friends "1" badge clears, without a manual refresh.

---

## Task 9: Deploy sequencing + manual end-to-end

**Files:** none (verification/deploy — held for user go-ahead per session policy)

- [ ] **Step 1: Full test pass**

Run: `cd apps/shared && npx vitest run` (parser) and `cd apps/worker && npx vitest run` (327+). Expected: all green. `cd apps/recipe-ui && npm run build` succeeds.

- [ ] **Step 2: Deploy (after go-ahead)**

`cd apps/worker && npx wrangler deploy` (email link) and `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind` (SMS link + web parser/dispatcher). `git status` first per the deploy-working-tree rule.

- [ ] **Step 3: Manual end-to-end**

- App installed (next build 28+): tap invite email link + SMS link → app opens → "You're now connected" → activity reconciles. Accept email link → app opens → auto-accepts → reconciles.
- App not installed: same links in a browser → web connect flow runs (unchanged).
- In-app, no link: "X sent you a friend request" card → tap → accept/decline dialog (unchanged); badge + Pending tab unchanged.

Note the native parser/dispatcher/copy ride the **next app build (28+)**; the worker + Pages deploy make the links *open the app* immediately on existing installs.

---

## Self-Review

**Spec coverage:**
- Invite email → `/friends?invite_token=` → Task 4. ✔
- Invite SMS → `/friends?invite=` (param kept distinct) → Task 5. ✔
- Parser `/friends` invite + plain open → Tasks 1-2. ✔
- Dispatcher routing → Task 3. ✔
- Auto-connect via existing endpoints (accept-invite / accept-open-invite), signed-in vs deferred → Task 6. ✔
- Reconciliation: resolved "now connected" copy → Task 7; activity refresh + badge clear → Task 8; `fetchFriends` for badge → Task 6/8. ✔
- Idempotent / graceful: the connect endpoints already no-op on already-connected (existing web behavior); errors show a snackbar, not a crash → Task 6. ✔
- Out of scope (no auto-pop, no inline buttons, no AASA/entitlement change) → not touched by any task. ✔
- Web fallback unchanged (module-load capture already path-agnostic) → no task needed; noted. ✔
- Ship sequencing → Task 9. ✔

**Placeholder scan:** No TBD/TODO. Two tasks (6 Step 3, 8 Step 2) say "use the actual name if it differs" for `setCurrentView('friends')` and the feed-load function — these are named verification points against real code, not placeholders; the engineer greps and matches.

**Type/naming consistency:** `DeepLink` adds `friend_invite{token,invite_kind}` + `friends_list` (Task 1), consumed identically in parser (Task 2), dispatcher (`onFriendInvite(token, invite_kind)` / `onFriendsList` — Task 3), and App.jsx handlers (Task 6). `acceptInviteRef`/`acceptOpenInviteRef`/`friendActivityRefreshRef` defined and used consistently (Tasks 6, 8). Endpoints `/friends/accept-invite` (pending) vs `/friends/accept-open-invite` (open) kept distinct throughout.
