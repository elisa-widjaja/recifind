# "Invite Friends" → `/friends?add=1` Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nudge email's "Invite Friends →" CTA open Friends → "My Friends" tab with the Add Friend drawer open, via a new `/friends?add=1` deep link (app if installed, web otherwise).

**Architecture:** Extend the existing `friends_list` deep-link kind with an optional `open_add` flag parsed from `?add=1`, carry it through the dispatcher to App.jsx (which selects the `connections` tab and opens `addFriendDrawerOpen`), add web mount routing for `/friends?add=1`, and point the email CTA at the new URL. `/friends` is already AASA-associated, so no AASA change.

**Tech Stack:** TypeScript shared lib (`apps/shared`), React/Vite frontend (`apps/recipe-ui`), Cloudflare Worker (`apps/worker`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-invite-friends-deeplink-design.md`

**Conventions:**
- Shared tests: `cd apps/shared && npx vitest run deepLink.test.ts`
- Frontend: `cd apps/recipe-ui && npm test -- <path>`
- Worker: `cd apps/worker && npm test -- <path>`
- Work on `main`, no branches. Commit only the exact `git add <paths>` per step (tree has unrelated uncommitted files). No em dashes in user-facing copy.

---

## File Structure
- **Modify** `apps/shared/contracts.ts` — `friends_list` gains `open_add?: boolean`.
- **Modify** `apps/shared/deepLink.ts` — parse `?add=1` in the `/friends` branch.
- **Modify** `apps/shared/deepLink.test.ts` — cover `?add=1`, bare `/friends`, invite precedence.
- **Modify** `apps/recipe-ui/src/lib/deepLinkDispatch.js` — pass `open_add` to `onFriendsList`.
- **Modify** `apps/recipe-ui/src/lib/deepLinkDispatch.test.js` — cover flag pass-through.
- **Modify** `apps/recipe-ui/src/App.jsx` — `onFriendsList(openAdd)` handler + `/friends?add=1` web routing.
- **Modify** `apps/worker/src/index.ts` — nudge "Invite Friends" CTA href.
- **Modify** `apps/worker/src/nudge-email.test.ts` — assert Invite CTA → `/friends?add=1`.

---

## Task 1: Parse `/friends?add=1` → `friends_list` with `open_add`

**Files:** Modify `apps/shared/contracts.ts`, `apps/shared/deepLink.ts`; test `apps/shared/deepLink.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `apps/shared/deepLink.test.ts`:
```ts
describe('parseDeepLink — /friends?add=1 (open add-friend drawer)', () => {
  it('flags open_add for /friends?add=1', () => {
    expect(parseDeepLink('https://recifriend.com/friends?add=1')).toEqual({ kind: 'friends_list', open_add: true });
  });
  it('bare /friends has no open_add flag', () => {
    expect(parseDeepLink('https://recifriend.com/friends')).toEqual({ kind: 'friends_list' });
  });
  it('add=1 is ignored when an invite_token is present (invite wins)', () => {
    expect(parseDeepLink('https://recifriend.com/friends?invite_token=abc&add=1'))
      .toEqual({ kind: 'friend_invite', token: 'abc', invite_kind: 'pending' });
  });
  it('parses the recifriend://friends?add=1 custom scheme', () => {
    expect(parseDeepLink('recifriend://friends?add=1')).toEqual({ kind: 'friends_list', open_add: true });
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS** — `cd apps/shared && npx vitest run deepLink.test.ts`. Expected: FAIL (bare `/friends?add=1` currently returns `{ kind: 'friends_list' }` without the flag).

- [ ] **Step 3: Add `open_add` to the union** — in `apps/shared/contracts.ts`, change the `friends_list` member (currently `| { kind: 'friends_list' }`) to:
```ts
  | { kind: 'friends_list'; open_add?: boolean }
```

- [ ] **Step 4: Parse `?add=1`** — in `apps/shared/deepLink.ts`, the `/friends` branch currently ends:
```ts
    const openToken = url.searchParams.get('invite');
    if (openToken) return { kind: 'friend_invite', token: openToken, invite_kind: 'open' };
    return { kind: 'friends_list' };
  }
```
Replace that final `return { kind: 'friends_list' };` with:
```ts
    if (url.searchParams.get('add') === '1') return { kind: 'friends_list', open_add: true };
    return { kind: 'friends_list' };
  }
```

- [ ] **Step 5: Run the test, verify it PASSES** — `cd apps/shared && npx vitest run deepLink.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/shared/contracts.ts apps/shared/deepLink.ts apps/shared/deepLink.test.ts
git commit -m "feat(deeplink): parse /friends?add=1 to open the add-friend drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dispatcher pass-through + App.jsx handler + web routing

**Files:** Modify `apps/recipe-ui/src/lib/deepLinkDispatch.js`, `deepLinkDispatch.test.js`, `App.jsx`.

- [ ] **Step 1: Write the failing dispatcher test** — in `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`, add inside the `describe('deep link dispatcher', ...)` block:
```js
  it('passes open_add to onFriendsList for /friends?add=1', async () => {
    const onFriendsList = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onFriendsList });
    await dispatch('https://recifriend.com/friends?add=1');
    expect(onFriendsList).toHaveBeenCalledWith(true);
  });
  it('calls onFriendsList without a flag for bare /friends', async () => {
    const onFriendsList = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onFriendsList });
    await dispatch('https://recifriend.com/friends');
    expect(onFriendsList).toHaveBeenCalledWith(undefined);
  });
```

- [ ] **Step 2: Run the test, verify it FAILS** — `cd apps/recipe-ui && npm test -- src/lib/deepLinkDispatch.test.js`. Expected: FAIL (the case currently calls `onFriendsList()` with no arg).

- [ ] **Step 3: Pass `open_add` through the dispatcher** — in `apps/recipe-ui/src/lib/deepLinkDispatch.js`, update the JSDoc line for `onFriendsList` to `onFriendsList: (openAdd?: boolean) => void,` and change the case from `case 'friends_list': return handlers.onFriendsList();` to:
```js
      case 'friends_list':       return handlers.onFriendsList(link.open_add);
```

- [ ] **Step 4: Run the dispatcher test, verify it PASSES** — `cd apps/recipe-ui && npm test -- src/lib/deepLinkDispatch.test.js`. Expected: PASS.

- [ ] **Step 5: Update the App.jsx `onFriendsList` handler** — in `apps/recipe-ui/src/App.jsx`, replace the handler (currently `onFriendsList: () => { setCurrentView('friends'); },` around line 2229) with:
```jsx
      onFriendsList: (openAdd) => {
        if (openAdd) {
          setFriendsInitialTab('connections');
          setAddFriendDrawerOpen(true);
        }
        setCurrentView('friends');
      },
```
(`setFriendsInitialTab` and `setAddFriendDrawerOpen` are already declared at App.jsx ~1355 and ~1359.)

- [ ] **Step 6: Add `/friends?add=1` web routing** — in `apps/recipe-ui/src/App.jsx`, extend the one-shot mount effect (the `useEffect` around lines 1391-1403 that currently handles `?view=` and the `/discover` pathname). Replace it with:
```jsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pathname = window.location.pathname;
    const pathIsDiscover = pathname === '/discover' || pathname === '/discover/';
    const pathIsFriendsAdd = (pathname === '/friends' || pathname === '/friends/') && params.get('add') === '1';
    const v = params.get('view');
    let target = pathIsDiscover ? 'discover' : (v && VALID_VIEWS.includes(v) ? v : null);
    if (pathIsFriendsAdd) {
      target = 'friends';
      setFriendsInitialTab('connections');
      setAddFriendDrawerOpen(true);
    }
    if (target) {
      setCurrentView(target);
      params.delete('view');
      params.delete('add');
      const qs = params.toString();
      // Normalize back to root so the path/params don't stick across in-app nav.
      window.history.replaceState({}, '', '/' + (qs ? `?${qs}` : ''));
    }
  }, []);
```
Keep the explanatory comment lines already above this effect.

- [ ] **Step 7: Run the full frontend suite + build**
Run: `cd apps/recipe-ui && npm test` → Expected: PASS (existing suite + the 2 new dispatcher tests).
Run: `cd apps/recipe-ui && npm run build` → Expected: succeeds.

- [ ] **Step 8: Commit**
```bash
git add apps/recipe-ui/src/lib/deepLinkDispatch.js apps/recipe-ui/src/lib/deepLinkDispatch.test.js apps/recipe-ui/src/App.jsx
git commit -m "feat(deeplink): /friends?add=1 opens My Friends tab + Add Friend drawer (app + web)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Point the nudge email "Invite Friends" CTA at `/friends?add=1`

**Files:** Modify `apps/worker/src/index.ts`; test `apps/worker/src/nudge-email.test.ts`.

- [ ] **Step 1: Add the failing assertion** — in `apps/worker/src/nudge-email.test.ts`, add this test inside the existing `describe('buildNudgeEmailHtml', ...)` block (the `mockRecipes` fixture already exists at the top of the file):
```ts
  it('points the Invite Friends CTA at /friends?add=1', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('href="https://recifriend.com/friends?add=1"');
    expect(html).toContain('Invite Friends');
  });
```

- [ ] **Step 2: Run the test, verify it FAILS** — `cd apps/worker && npm test -- src/nudge-email.test.ts`. Expected: FAIL (CTA currently `https://recifriend.com/friends`).

- [ ] **Step 3: Update the CTA href** — in `apps/worker/src/index.ts`, the nudge email's "Invite Friends →" CTA (the one inside the "Invite friends, earn rewards!" gradient box, identifiable by `color:#764ba2` and the text `Invite Friends →`, ~line 4915) currently reads:
```ts
      <a href="https://recifriend.com/friends" style="display:inline-block;background:#fff;color:#764ba2;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">Invite Friends →</a>
```
Change ONLY this anchor's href to `https://recifriend.com/friends?add=1`:
```ts
      <a href="https://recifriend.com/friends?add=1" style="display:inline-block;background:#fff;color:#764ba2;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">Invite Friends →</a>
```
Do NOT change the other `recifriend.com/friends` links in this file (lines ~3510, 3511, 3569, 3808), they belong to different emails (friend-invite, friend-request, etc.).

- [ ] **Step 4: Run the test, verify it PASSES** — `cd apps/worker && npm test -- src/nudge-email.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(email): nudge Invite Friends CTA -> /friends?add=1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (after all tasks)
- [ ] `cd apps/shared && npx vitest run deepLink.test.ts`; `cd apps/recipe-ui && npm test`; `cd apps/worker && npm test`. All green.
- [ ] Send a live test nudge to elisa.widjaja@gmail.com and confirm the "Invite Friends" button href is `/friends?add=1` (eyeball the email, or curl the rendered HTML is not exposed, so eyeball).

## Rollout (deploy only on the user's go-ahead)
1. **Frontend (Pages)** — ships the dispatcher pass-through, App handler, and web routing: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`.
2. **Worker** — ships the email CTA: `cd apps/worker && npx wrangler deploy`. Per the project rule, smoke-test the import/enrich path after (POST `/recipes/enrich` with a real Allrecipes URL, expect non-empty ingredients + steps).

### Open item (same as the `/discover` work)
Whether the **production App Store** app runs the new `onFriendsList(openAdd)` handler from a web deploy or needs a new iOS build depends on how that build loads its web content. `/friends` already resolves to the app via Universal Link; the question is only whether the bundled JS includes the new handler. The dev build (live-loads dev.recifriend.com) gets it immediately.

## Out of scope (do not build here)
- AASA changes (`/friends` already associated).
- Changes to the Add Friend drawer's contents.
- The other `/friends` email links (different emails).
