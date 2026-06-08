# Nudge Email Recipes Grid + `/discover` Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nudge email show 6 recommended recipes in a 2x3 grid with half-height thumbnails and a "Discover more recipes" CTA, and add a real `/discover` deep link that opens the app's Discover tab (Universal Link) or loads it on the web.

**Architecture:** A new `discover` deep-link kind is added to the shared contract + parser, wired through the dispatcher to an App.jsx handler and the SPA's web path routing, and registered in the AASA. The worker's `buildNudgeEmailHtml` is reworked to render a 6-card grid and discover CTAs that point at the new `/discover` path.

**Tech Stack:** TypeScript shared lib (`apps/shared`) + Cloudflare Worker (`apps/worker`), React/Vite frontend (`apps/recipe-ui`), Vitest. Cloudflare Pages serves the AASA.

**Spec:** `docs/superpowers/specs/2026-06-08-nudge-email-recipes-discover-deeplink-design.md`

**Conventions:**
- Shared parser tests: `cd apps/shared && npx vitest run deepLink.test.ts`
- Frontend tests: `cd apps/recipe-ui && npm test -- <path>`
- Worker tests: `cd apps/worker && npm test -- <path>`
- Work on `main`, no branches. Commit only the exact `git add <paths>` per step (the tree has unrelated uncommitted files). No em dashes in user-facing copy.

---

## File Structure

- **Modify** `apps/shared/contracts.ts` — add `discover` to the `DeepLink` union.
- **Modify** `apps/shared/deepLink.ts` — parse `/discover`.
- **Modify** `apps/shared/deepLink.test.ts` — cover `/discover`.
- **Modify** `apps/recipe-ui/src/lib/deepLinkDispatch.js` — `onDiscover` case.
- **Modify** `apps/recipe-ui/src/lib/deepLinkDispatch.test.js` — cover discover routing.
- **Modify** `apps/recipe-ui/src/App.jsx` — `onDiscover` handler + `/discover` web path routing.
- **Modify** `apps/recipe-ui/public/.well-known/apple-app-site-association` — add `/discover`.
- **Modify** `apps/worker/src/index.ts` — `buildNudgeEmailHtml` grid/CTA + `getRecommendedRecipes` cron call.
- **Modify** `apps/worker/src/routes/admin.ts` — test-nudge `getRecommendedRecipes` call.
- **Modify** `apps/worker/src/nudge-email.test.ts` — grid/CTA assertions.

---

## Task 1: Add the `discover` deep-link kind + parser

**Files:**
- Modify: `apps/shared/contracts.ts:56-64`
- Modify: `apps/shared/deepLink.ts`
- Test: `apps/shared/deepLink.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/shared/deepLink.test.ts`:

```ts
describe('parseDeepLink — /discover', () => {
  it('parses an https /discover Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com/discover')).toEqual({ kind: 'discover' });
  });
  it('parses /discover with a trailing slash', () => {
    expect(parseDeepLink('https://recifriend.com/discover/')).toEqual({ kind: 'discover' });
  });
  it('parses the recifriend://discover custom scheme', () => {
    expect(parseDeepLink('recifriend://discover')).toEqual({ kind: 'discover' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/shared && npx vitest run deepLink.test.ts`
Expected: FAIL (the 3 new cases return `null`, not `{ kind: 'discover' }`).

- [ ] **Step 3: Add `discover` to the DeepLink union**

In `apps/shared/contracts.ts`, change the `DeepLink` union (lines 56-64) to add the new member:

```ts
export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string; title?: string }
  | { kind: 'friend_requests'; accept_id?: string }
  | { kind: 'friend_invite'; token: string; invite_kind: 'pending' | 'open' }
  | { kind: 'friends_list' }
  | { kind: 'recipe_detail'; recipe_id: string; owner_id?: string }
  | { kind: 'recipes_list' }
  | { kind: 'discover' }
  | { kind: 'open_pending_share' };
```

- [ ] **Step 4: Parse `/discover` in the parser**

In `apps/shared/deepLink.ts`, add this block immediately after the `/recipes` list block (after line 28, before the `/recipes/:id` match):

```ts
  // /discover — opens the Discover tab.
  if (fullPath === '/discover' || fullPath === '/discover/') {
    return { kind: 'discover' };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/shared && npx vitest run deepLink.test.ts`
Expected: PASS (52 tests: the original 49 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add apps/shared/contracts.ts apps/shared/deepLink.ts apps/shared/deepLink.test.ts
git commit -m "feat(deeplink): add /discover route to the shared parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire `discover` through the dispatcher, App.jsx, and web path routing

**Files:**
- Modify: `apps/recipe-ui/src/lib/deepLinkDispatch.js`
- Test: `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`
- Modify: `apps/recipe-ui/src/App.jsx` (dispatcher handlers ~2154-2262; the `?view=` effect ~1391-1400)

- [ ] **Step 1: Write the failing dispatcher test**

In `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`, add `onDiscover: () => {}` to the `noopHandlers` object, then add this test inside the `describe('deep link dispatcher', ...)` block:

```js
  it('routes /discover to onDiscover', async () => {
    const onDiscover = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onDiscover });
    await dispatch('https://recifriend.com/discover');
    expect(onDiscover).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/recipe-ui && npm test -- src/lib/deepLinkDispatch.test.js`
Expected: FAIL (`onDiscover` is never called; the switch has no `discover` case).

- [ ] **Step 3: Add the `discover` case to the dispatcher**

In `apps/recipe-ui/src/lib/deepLinkDispatch.js`, add `onDiscover` to the JSDoc handlers block (after `onFriendsList`) and add a switch case. The JSDoc gains:

```js
 *   onFriendsList: () => void,
 *   onDiscover: () => void,
```

And in the `switch (link.kind)` add (after the `friends_list` case):

```js
      case 'discover':           return handlers.onDiscover();
```

- [ ] **Step 4: Run the dispatcher test to verify it passes**

Run: `cd apps/recipe-ui && npm test -- src/lib/deepLinkDispatch.test.js`
Expected: PASS.

- [ ] **Step 5: Add the `onDiscover` handler in App.jsx**

In `apps/recipe-ui/src/App.jsx`, in the `createDispatcher({ ... })` call, add an `onDiscover` handler. Insert it right after the `onRecipesList` handler block (which ends around line 2261 with `},`), before the closing `});`:

```jsx
      onDiscover: () => {
        closeDialogRef.current?.();
        setCurrentView('discover');
      },
```

- [ ] **Step 6: Add `/discover` web path routing in App.jsx**

In `apps/recipe-ui/src/App.jsx`, replace the existing `?view=` mount effect (currently lines ~1391-1400) with one that also handles the `/discover` pathname for non-installed web visitors:

```jsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pathIsDiscover = window.location.pathname === '/discover' || window.location.pathname === '/discover/';
    const v = params.get('view');
    const target = pathIsDiscover ? 'discover' : (v && VALID_VIEWS.includes(v) ? v : null);
    if (target) {
      setCurrentView(target);
      params.delete('view');
      const qs = params.toString();
      // Normalize back to root so /discover or ?view= doesn't stick across nav.
      window.history.replaceState({}, '', '/' + (qs ? `?${qs}` : ''));
    }
  }, []);
```

- [ ] **Step 7: Run the full frontend suite + build**

Run: `cd apps/recipe-ui && npm test`
Expected: PASS (existing suite + the new dispatcher test; nothing regressed).

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-ui/src/lib/deepLinkDispatch.js apps/recipe-ui/src/lib/deepLinkDispatch.test.js apps/recipe-ui/src/App.jsx
git commit -m "feat(deeplink): route /discover to the Discover tab (app + web)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register `/discover` in the AASA

**Files:**
- Modify: `apps/recipe-ui/public/.well-known/apple-app-site-association`

- [ ] **Step 1: Add `/discover` to the associated paths**

Replace the `paths` array so it reads:

```json
        "paths": [
          "/auth/callback",
          "/recipes",
          "/recipes/*",
          "/friend-requests",
          "/friends",
          "/add-recipe",
          "/discover"
        ]
```

- [ ] **Step 2: Verify the file is still valid JSON**

Run: `python3 -c "import json; json.load(open('apps/recipe-ui/public/.well-known/apple-app-site-association')); print('valid JSON')"`
Expected: `valid JSON`

Run: `grep -c '"/discover"' apps/recipe-ui/public/.well-known/apple-app-site-association`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-ui/public/.well-known/apple-app-site-association
git commit -m "feat(deeplink): associate /discover with the iOS app (AASA)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Nudge email — 6-card grid, 90px thumbnails, "Discover more recipes" CTA, /discover hrefs

**Files:**
- Modify: `apps/worker/src/index.ts` (`buildNudgeEmailHtml` ~4791-4900; cron `getRecommendedRecipes` call ~1031)
- Modify: `apps/worker/src/routes/admin.ts` (test-nudge `getRecommendedRecipes` call ~129)
- Test: `apps/worker/src/nudge-email.test.ts`

- [ ] **Step 1: Update the test to the new email contract (write failing test)**

Replace the entire contents of `apps/worker/src/nudge-email.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildNudgeEmailHtml } from './index';

// Shape matches the worker's RecommendedRecipe interface (id, userId, title,
// durationMinutes, mealTypes, imageUrl, shareUrl) so it typechecks structurally.
const mockRecipes = Array.from({ length: 6 }, (_, i) => ({
  id: `r${i + 1}`,
  userId: `u${i + 1}`,
  title: `Recipe ${i + 1}`,
  durationMinutes: 30,
  mealTypes: ['dinner'],
  imageUrl: `https://example.com/img${i + 1}.jpg`,
  shareUrl: `https://recifriend.com/recipes/r${i + 1}?user=u${i + 1}`,
}));

describe('buildNudgeEmailHtml', () => {
  it('renders all 6 recommended recipe cards', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    // One thumbnail <img object-fit:cover> per card with an image.
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(6);
  });

  it('uses half-height (90px) thumbnails, not 180px', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('height:90px');
    expect(html).not.toContain('height:180px');
  });

  it('has a "Discover more recipes" CTA pointing at /discover', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('Discover more recipes');
    expect(html).toContain('href="https://recifriend.com/discover"');
  });

  it('no longer uses the ?view=discover query route', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).not.toContain('view=discover');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/worker && npm test -- src/nudge-email.test.ts`
Expected: FAIL (currently caps at 2 cards, 180px thumbnails, no "Discover more recipes" CTA, primary CTA still `/?view=discover`).

- [ ] **Step 3: Rework the recipe grid in `buildNudgeEmailHtml`**

In `apps/worker/src/index.ts`, replace the `recipeCardsHtml` builder (currently lines ~4796-4812, the `const recipeCardsHtml = recipes.map(...).slice(0, 2).join(...)`) with a 6-card, 2-per-row grid builder:

```ts
  const recipeCells = recipes.slice(0, 6).map(r => {
    const tag = r.mealTypes[0] || 'Recipe';
    const duration = r.durationMinutes ? `${r.durationMinutes} min` : '';
    const label = [duration, tag].filter(Boolean).join(' · ');
    const imgHtml = r.imageUrl
      ? `<img src="${r.imageUrl}" alt="${r.title}" width="260" height="90" style="width:100%;height:90px;object-fit:cover;display:block;" />`
      : `<div style="width:100%;height:90px;background:#f0e6d6;text-align:center;line-height:90px;font-size:32px;">🍳</div>`;
    return `<td style="width:50%;vertical-align:top;padding:0 6px 12px;">
      <a href="${r.shareUrl}" style="text-decoration:none;color:inherit;display:block;border:1px solid #eee;border-radius:10px;overflow:hidden;">
        ${imgHtml}
        <div style="padding:10px 10px 14px;">
          <div style="font-size:12px;font-weight:700;color:#1a1a1a;text-transform:uppercase;line-height:1.35;max-height:33px;overflow:hidden;">${r.title}</div>
          <div style="font-size:11px;color:#888;margin-top:8px;">${label}</div>
        </div>
      </a>
    </td>`;
  });
  // Chunk into rows of 2; pad a lone trailing cell so the grid stays aligned.
  const recipeRows: string[] = [];
  for (let i = 0; i < recipeCells.length; i += 2) {
    const pair = recipeCells.slice(i, i + 2);
    if (pair.length === 1) pair.push('<td style="width:50%;"></td>');
    recipeRows.push(`<tr>${pair.join('')}</tr>`);
  }
  const recipeGridHtml = recipeRows.join('\n      ');
```

- [ ] **Step 4: Use the grid + add the "Discover more recipes" CTA in the recommended section**

In `apps/worker/src/index.ts`, replace the recommended-section inner table (currently lines ~4871-4875, the `<tr><td style="padding:0 16px 24px;"><table ...><tr> ${recipeCardsHtml} </tr></table></td></tr>`) with the grid plus the new CTA row:

```ts
    <tr><td style="padding:0 16px 8px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${recipeGridHtml}
      </table>
    </td></tr>
    <tr><td style="text-align:center;padding:8px 24px 28px;">
      <a href="https://recifriend.com/discover" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:700;">Discover more recipes</a>
    </td></tr>
```

- [ ] **Step 5: Point the primary CTA at `/discover`**

In `apps/worker/src/index.ts`, change the "Save Your First Recipe →" CTA href (line ~4860) from `https://recifriend.com/?view=discover` to `https://recifriend.com/discover`:

```ts
    <a href="https://recifriend.com/discover" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Save Your First Recipe →</a>
```

- [ ] **Step 6: Run the worker test to verify it passes**

Run: `cd apps/worker && npm test -- src/nudge-email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Bump the recommended count to 6 at the nudge call sites**

In `apps/worker/src/index.ts` (~line 1031), change the cron call:

```ts
      const recipes = await getRecommendedRecipes(env.DB, userId, 6);
```

In `apps/worker/src/routes/admin.ts` (~line 129), change the test-nudge call:

```ts
  const recipes = await getRecommendedRecipes(args.env.DB, profileUserId, 6);
```

- [ ] **Step 8: Verify the worker still builds/tests**

Run: `cd apps/worker && npm test -- src/nudge-email.test.ts`
Expected: PASS.

Run: `cd apps/worker && npx tsc --noEmit` (typecheck; the `recipeRows: string[]` typing must be clean)
Expected: no errors from the edited file. (If the project has no tsc script, this still validates types.)

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/admin.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(email): 6-recipe grid, shorter thumbnails, Discover more CTA -> /discover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (after all tasks)

- [ ] Run the three suites: `cd apps/shared && npx vitest run deepLink.test.ts`; `cd apps/recipe-ui && npm test`; `cd apps/worker && npm test`. All green.
- [ ] Send a live test nudge to elisa.widjaja@gmail.com (admin-authenticated call to `POST https://api.recifriend.com/admin/test-nudge-email?to=...`) and eyeball: 6 cards in a 2x3 grid, short thumbnails, "Discover more recipes" button. NOTE: requires the worker deployed first.

## Rollout (deploy only on the user's go-ahead)

1. **Frontend (Pages)** — ships the AASA `/discover` entry, the web `/discover` routing, and the in-app dispatcher handler: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`. Verify recifriend.com/.well-known/apple-app-site-association now lists `/discover`.
2. **Worker** — ships the email: `cd apps/worker && npx wrangler deploy`. Per the project rule, smoke-test the import/enrich path after (POST `/recipes/enrich` with a real Allrecipes URL, expect non-empty ingredients + steps).

### Open item (verify before claiming App Store users are covered)

The AASA update is live for everyone on the Pages deploy, so the *email link* will attempt to open the app. Whether the **production App Store** app actually handles `/discover` in-app depends on whether that build loads its web content live from recifriend.com (gets the new dispatcher handler immediately) or from bundled JS (needs a new iOS build). Check `apps/ios` capacitor config / how the shipped build loads content before telling the user App Store users are fully covered. The dev build (live-loads dev.recifriend.com) works as soon as the frontend deploys.

## Out of scope (do not build here)

- The in-app onboarding "You're all set" carousel (unchanged).
- True per-user personalization of recommended recipes beyond existing `getRecommendedRecipes` logic.
- Deep-linking changes to other emails (their CTAs already open the app or are not in scope).
