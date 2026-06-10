# Nudge Email A/B Test (v1 vs v2) + Founder Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a v1/v2 nudge-email A/B test (differing only by hook) where both share a founder module (the founder's favorite recipes + a "Connect with Elisa" CTA), with a `NUDGE_V2_PCT` split/rollback knob, a re-queue endpoint for the dead-cold cohort, a per-variant activation metric, and an `?add_friend` deep link.

**Architecture:** All email/cron/endpoint logic lives in `apps/worker/src/index.ts` (single-file backend) and `apps/worker/src/routes/admin.ts` (admin endpoints), reusing existing helpers (`getRecommendedRecipes`, `getEditorsPick`, `fnv1a32`, `requireAdmin`, `METRICS_EXCLUDED_EMAILS`). The `?add_friend` deep link mirrors the existing `accept_friend` pattern in `apps/recipe-ui/src/App.jsx`. Pure helpers are unit-tested; the cron loop is wired from tested helpers + verified manually.

**Tech Stack:** TypeScript Cloudflare Worker, D1, Vitest; React frontend (Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-06-09-nudge-email-ab-test-design.md`

---

## Grounding facts (verified)

- Cron send loop: `apps/worker/src/index.ts` ~1018-1071. Selects `nudge_emails` rows `WHERE send_after <= now AND sent = 0 AND email_opt_out = 0`, skips (`sent = 2`) users with recipes, else builds via `buildNudgeEmailHtml(displayName, recipes, gifUrl)`, sends with subject `Your recipes are waiting, ${displayName}!`, marks `sent = 1`.
- `buildNudgeEmailHtml(displayName, recipes, gifUrl)` ~4826. The invite-rewards block is the `<div style="padding:32px 24px;">...Invite Friends →...</div>` at ~4926-4935 (ends just before the footer `<div style="background:#f9f9f9...">`).
- `getRecommendedRecipes(db, userId, limit=3)` ~4670 returns `RecommendedRecipe[]` = `{ id, userId, title, durationMinutes, mealTypes, imageUrl, shareUrl }`, sourced from `EDITORS_PICK_USER_ID` (the founder/curator) across her whole shared collection at random.
- `getEditorsPick(db)` ~1976 returns the founder's `is_favorite = 1` recipes (weekly-rotated, clean-filtered): `{ id, userId, title, sourceUrl, imageUrl, mealTypes, customTags, durationMinutes, ingredients, steps }`.
- `EDITORS_PICK_USER_ID = '8e4dfd5e-bb6a-4890-98cd-d9ac6ce655a2'` (~1914) IS the founder (elisa.widjaja@gmail.com).
- `fnv1a32(s)` ~1985: deterministic 32-bit string hash, sync, no crypto.
- `nudge_emails` PK `user_id`; columns `email, display_name, send_after, sent, sent_at, created_at`.
- Frontend: friend requests via `callRecipesApi('/friends/request', { method:'POST', body: JSON.stringify({ userId }) }, accessToken)`; toasts via `setSnackbarState({ open, message, severity })`. `accept_friend` lifecycle: capture at module load (~260), preserve through OAuth (~3083), consume post-auth (~4131).
- Admin route pattern (`/admin/metrics/timeseries` ~567): `if (!user) throw new HttpError(401,...); const { handler } = await import('./routes/admin'); return await handler({ env, user, adminEmails: env.ADMIN_EMAILS, url });`. admin.ts has module-local `json(status, body)` (CORS baked), `requireAdmin({user,adminEmails})`, `METRICS_EXCLUDED_EMAILS`, `BuiltQuery { sql, params }`.

## File structure

- `apps/worker/src/index.ts` — `nudgeVariantBucket`, `dedupeFavorites`, `buildFounderModuleHtml`, `buildNudgeEmailHtmlV2`, `buildNudgeEmailHtml` (swap invite→founder), cron wiring, two route registrations.
- `apps/worker/src/routes/admin.ts` — `handleAdminNudgeRequeue`, `buildNudgeAbQuery`, `handleAdminNudgeAb`.
- `apps/worker/src/nudge-email.test.ts` (new) — unit tests for the helpers/builders.
- `apps/worker/src/routes/admin.test.ts` — tests for re-queue + nudge-ab.
- `apps/worker/wrangler.toml` — `NUDGE_V2_PCT = "0"` in `[vars]`.
- `apps/recipe-ui/src/App.jsx` — `?add_friend` deep link (3 touchpoints).
- D1 (manual remote): `ALTER TABLE nudge_emails ADD COLUMN variant TEXT`.

---

## Task 1: Config — `variant` column + `NUDGE_V2_PCT`

**Files:** `apps/worker/wrangler.toml`; D1 (manual remote op); `apps/worker/src/index.ts` (Env type).

- [ ] **Step 1: Add the D1 column (remote, one-time).**

Run:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote \
  --command "ALTER TABLE nudge_emails ADD COLUMN variant TEXT"
```
Expected: success. If it errors with "duplicate column name", the column already exists — fine, continue.

- [ ] **Step 2: Add `NUDGE_V2_PCT` to wrangler.toml `[vars]`.**

In `apps/worker/wrangler.toml`, under the existing `[vars]` block (where `NUDGE_EMAILS_ENABLED` lives), add:
```toml
NUDGE_V2_PCT = "0"
```

- [ ] **Step 3: Declare the env var in the `Env` type.**

In `apps/worker/src/index.ts`, near the existing `NUDGE_EMAILS_ENABLED?: string;` field in the `Env` interface (~40), add:
```ts
  NUDGE_V2_PCT?: string;
```

- [ ] **Step 4: Commit.**
```bash
git add apps/worker/wrangler.toml apps/worker/src/index.ts
git commit -m "chore(nudge): add variant column + NUDGE_V2_PCT env knob

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `nudgeVariantBucket` + `pickNudgeVariant`

**Files:** Modify `apps/worker/src/index.ts`; Test: `apps/worker/src/nudge-email.test.ts` (new).

- [ ] **Step 1: Write the failing test.**

Create `apps/worker/src/nudge-email.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { nudgeVariantBucket, pickNudgeVariant } from './index';

describe('nudgeVariantBucket', () => {
  it('is deterministic and in [0,100)', () => {
    const b = nudgeVariantBucket('user-abc');
    expect(b).toBe(nudgeVariantBucket('user-abc'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
  it('spreads across the range for varied ids', () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => nudgeVariantBucket(`u-${i}`)));
    expect(buckets.size).toBeGreaterThan(20); // not all colliding
  });
});

describe('pickNudgeVariant', () => {
  it('all v1 when pct=0', () => {
    expect(pickNudgeVariant('anyone', 0)).toBe('v1');
  });
  it('all v2 when pct=100', () => {
    expect(pickNudgeVariant('anyone', 100)).toBe('v2');
  });
  it('splits by bucket when pct=50', () => {
    // bucket < 50 -> v2, else v1; assert consistency with nudgeVariantBucket
    const id = 'split-test';
    const expected = nudgeVariantBucket(id) < 50 ? 'v2' : 'v1';
    expect(pickNudgeVariant(id, 50)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement.**

In `apps/worker/src/index.ts`, immediately after the `fnv1a32` function (~1985), add:
```ts
// Deterministic 0-99 bucket for nudge A/B assignment. Reuses fnv1a32 (no crypto,
// stable across runtimes). bucket < NUDGE_V2_PCT -> v2.
export function nudgeVariantBucket(userId: string): number {
  return fnv1a32(userId) % 100;
}

export function pickNudgeVariant(userId: string, v2Pct: number): 'v1' | 'v2' {
  return nudgeVariantBucket(userId) < v2Pct ? 'v2' : 'v1';
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(nudge): deterministic A/B variant bucketing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `dedupeFavorites` + `buildFounderModuleHtml`

**Files:** Modify `apps/worker/src/index.ts`; Test: `apps/worker/src/nudge-email.test.ts`.

The founder module takes the founder's favorites (from `getEditorsPick`, mapped to a card shape), removes any already shown in the email, renders up to 3 cards + heading/body + Connect CTA.

- [ ] **Step 1: Write the failing tests.** Append to `apps/worker/src/nudge-email.test.ts`:
```ts
import { dedupeFavorites, buildFounderModuleHtml, EDITORS_PICK_USER_ID } from './index';

const FAV = (id: string) => ({
  id, userId: EDITORS_PICK_USER_ID, title: `Fav ${id}`,
  durationMinutes: 20, mealTypes: ['Dinner'], imageUrl: 'https://x.supabase.co/i.jpg',
  shareUrl: `https://recifriend.com/recipes/${id}?user=${EDITORS_PICK_USER_ID}`,
});

describe('dedupeFavorites', () => {
  it('removes ids already shown and caps at the limit', () => {
    const favs = [FAV('a'), FAV('b'), FAV('c'), FAV('d')];
    const out = dedupeFavorites(favs, new Set(['b']), 2);
    expect(out.map(f => f.id)).toEqual(['a', 'c']);
  });
});

describe('buildFounderModuleHtml', () => {
  it('renders heading, body, favorite cards, and the Connect CTA to ?add_friend', () => {
    const html = buildFounderModuleHtml([FAV('a'), FAV('b')]);
    expect(html).toContain('Recipes from the founder');
    expect(html).toContain("Hi, I'm Elisa");
    expect(html).toContain('Fav a');
    expect(html).toContain(`/recipes/a?user=${EDITORS_PICK_USER_ID}`);
    expect(html).toContain(`?add_friend=${EDITORS_PICK_USER_ID}`);
    expect(html).toContain('Connect with Elisa');
  });
  it('keeps heading/body/CTA but no cards when favorites is empty', () => {
    const html = buildFounderModuleHtml([]);
    expect(html).toContain('Recipes from the founder');
    expect(html).toContain('Connect with Elisa');
    expect(html).not.toContain('<img');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: FAIL (functions/`EDITORS_PICK_USER_ID` not exported).

- [ ] **Step 3: Implement.**

3a. `EDITORS_PICK_USER_ID` is currently `const EDITORS_PICK_USER_ID = '8e4dfd5e-...'` (~1914) — add `export` so tests/builders can reference it:
```ts
export const EDITORS_PICK_USER_ID = '8e4dfd5e-bb6a-4890-98cd-d9ac6ce655a2';
```

3b. Add the dedupe helper + module builder near `buildNudgeEmailHtml` (~4826). `dedupeFavorites` works on the `RecommendedRecipe` shape (the founder favorites are mapped to this shape in Task 6):
```ts
export function dedupeFavorites(
  favorites: RecommendedRecipe[],
  shownIds: Set<string>,
  limit = 3
): RecommendedRecipe[] {
  return favorites.filter(f => !shownIds.has(f.id)).slice(0, limit);
}

// Founder module shared by v1 and v2. `favorites` is already deduped + capped.
export function buildFounderModuleHtml(favorites: RecommendedRecipe[]): string {
  const cards = favorites.map(r => {
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
          <div style="font-size:12px;font-weight:700;color:#1a1a1a;text-transform:uppercase;line-height:17px;height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${r.title}</div>
          <div style="font-size:11px;color:#888;margin-top:8px;">${label}</div>
        </div>
      </a>
    </td>`;
  });
  const rows: string[] = [];
  for (let i = 0; i < cards.length; i += 2) {
    const pair = cards.slice(i, i + 2);
    if (pair.length === 1) pair.push('<td style="width:50%;"></td>');
    rows.push(`<tr>${pair.join('')}</tr>`);
  }
  const grid = cards.length
    ? `<tr><td style="padding:0 16px 8px;"><table cellpadding="0" cellspacing="0" border="0" width="100%">${rows.join('\n')}</table></td></tr>`
    : '';
  return `<div style="border-top:1px solid #eee;margin:0 24px;"></div>
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="padding:32px 24px 12px;">
      <div style="font-size:18px;font-weight:700;color:#1a1a1a;">Recipes from the founder</div>
      <div style="color:#555;font-size:14px;line-height:1.6;margin-top:8px;">Hi, I'm Elisa. I built ReciFriend on nights and weekends to fix my own messy recipe situation. Here are a few of mine to start you off.</div>
    </td></tr>
    ${grid}
    <tr><td style="text-align:center;padding:8px 24px 28px;">
      <a href="https://recifriend.com/?add_friend=${EDITORS_PICK_USER_ID}" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Connect with Elisa →</a>
    </td></tr>
  </table>`;
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(nudge): founder module (favorites + Connect with Elisa) + dedupe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `buildNudgeEmailHtmlV2`

**Files:** Modify `apps/worker/src/index.ts`; Test: `apps/worker/src/nudge-email.test.ts`.

v2 = desire-led hero + "more picks" grid + injected founder module. Takes the pre-built founder module HTML so the email builder stays pure.

- [ ] **Step 1: Write the failing tests.** Append:
```ts
import { buildNudgeEmailHtmlV2 } from './index';

const REC = (id: string) => ({
  id, userId: 'curator', title: `Rec ${id}`, durationMinutes: 15,
  mealTypes: ['Lunch'], imageUrl: 'https://x.supabase.co/i.jpg',
  shareUrl: `https://recifriend.com/recipes/${id}?user=curator`,
});

describe('buildNudgeEmailHtmlV2', () => {
  it('renders the hook, hero save link, browse CTA, and injects the founder module', () => {
    const html = buildNudgeEmailHtmlV2('Sam', [REC('h'), REC('m1'), REC('m2')], '<!--FOUNDER-->');
    expect(html).toContain('one good recipe to get you started');
    expect(html).toContain('Save this recipe');
    expect(html).toContain('/recipes/h?user=curator');     // hero links to recipes[0]
    expect(html).toContain('https://recifriend.com/discover'); // browse more
    expect(html).toContain('<!--FOUNDER-->');               // founder module injected
    // v2 must NOT carry v1's instructional markers
    expect(html).not.toContain('Save Your First Recipe');
  });
  it('degrades gracefully with no recipes (no hero/grid, still founder module)', () => {
    const html = buildNudgeEmailHtmlV2('Sam', [], '<!--FOUNDER-->');
    expect(html).toContain('<!--FOUNDER-->');
    expect(html).not.toContain('Save this recipe');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add after `buildNudgeEmailHtml` in `apps/worker/src/index.ts`:
```ts
export function buildNudgeEmailHtmlV2(
  displayName: string,
  recipes: RecommendedRecipe[],
  founderModuleHtml: string
): string {
  const hero = recipes[0];
  const morePicks = recipes.slice(1, 5);
  const heroHtml = hero ? `
  <div style="padding:8px 24px 0;">
    <a href="${hero.shareUrl}" style="text-decoration:none;color:inherit;display:block;border:1px solid #eee;border-radius:12px;overflow:hidden;">
      ${hero.imageUrl ? `<img src="${hero.imageUrl}" alt="${hero.title}" style="width:100%;height:200px;object-fit:cover;display:block;" />` : ''}
      <div style="padding:16px;">
        <div style="font-size:18px;font-weight:700;color:#1a1a1a;line-height:1.3;">${hero.title}</div>
        <div style="font-size:12px;color:#888;margin-top:6px;">${[hero.durationMinutes ? `${hero.durationMinutes} min` : '', hero.mealTypes[0] || ''].filter(Boolean).join(' · ')}</div>
      </div>
    </a>
  </div>
  <div style="text-align:center;padding:16px 24px 4px;">
    <a href="${hero.shareUrl}" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Save this recipe →</a>
  </div>
  <div style="padding:4px 24px 8px;color:#555;font-size:14px;line-height:1.6;text-align:center;">One tap and it's yours: ingredients, steps, and hands-free cook mode, ready whenever you cook. That first save is where ReciFriend clicks.</div>` : '';

  const moreCells = morePicks.map(r => {
    const label = [r.durationMinutes ? `${r.durationMinutes} min` : '', r.mealTypes[0] || 'Recipe'].filter(Boolean).join(' · ');
    const img = r.imageUrl
      ? `<img src="${r.imageUrl}" alt="${r.title}" width="260" height="90" style="width:100%;height:90px;object-fit:cover;display:block;" />`
      : `<div style="width:100%;height:90px;background:#f0e6d6;text-align:center;line-height:90px;font-size:32px;">🍳</div>`;
    return `<td style="width:50%;vertical-align:top;padding:0 6px 12px;"><a href="${r.shareUrl}" style="text-decoration:none;color:inherit;display:block;border:1px solid #eee;border-radius:10px;overflow:hidden;">${img}<div style="padding:10px 10px 14px;"><div style="font-size:12px;font-weight:700;color:#1a1a1a;text-transform:uppercase;line-height:17px;height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${r.title}</div><div style="font-size:11px;color:#888;margin-top:8px;">${label}</div></div></a></td>`;
  });
  const moreRows: string[] = [];
  for (let i = 0; i < moreCells.length; i += 2) {
    const pair = moreCells.slice(i, i + 2);
    if (pair.length === 1) pair.push('<td style="width:50%;"></td>');
    moreRows.push(`<tr>${pair.join('')}</tr>`);
  }
  const moreHtml = moreCells.length ? `
  <div style="padding:8px 16px 0;">
    <div style="padding:0 8px;font-size:16px;font-weight:700;color:#1a1a1a;">More picks for you</div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;">${moreRows.join('\n')}</table>
  </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">One tap saves it: ingredients, steps, and cook mode included.</div>
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:#6200EA;padding:32px 24px;text-align:center;">
    <div style="font-size:28px;font-weight:700;color:#fff;">🍳 ReciFriend</div>
    <div style="color:rgba(255,255,255,0.9);margin-top:8px;font-size:15px;">Your personal recipe collection</div>
  </div>
  <div style="padding:28px 24px 4px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">Hey ${displayName}, one good recipe to get you started.</div>
  </div>
  ${heroHtml}
  ${moreHtml}
  <div style="text-align:center;padding:8px 24px 24px;">
    <a href="https://recifriend.com/discover" style="display:inline-block;background:transparent;color:#6200EA;border:1px solid #6200EA;text-decoration:none;padding:12px 30px;border-radius:999px;font-size:15px;font-weight:700;">Browse more recipes →</a>
  </div>
  ${founderModuleHtml}
  <div style="background:#f9f9f9;padding:24px;text-align:center;border-top:1px solid #eee;">
    <div style="color:#999;font-size:12px;line-height:1.6;">You're receiving this because you signed up for ReciFriend.<br>
      <a href="https://api.recifriend.com/unsubscribe?userId=__USER_ID__&token=__TOKEN__" style="color:#999;">Unsubscribe</a>
    </div>
  </div>
</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(nudge): v2 desire-led hero email builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Swap v1's invite-rewards block for the founder module

**Files:** Modify `apps/worker/src/index.ts` (`buildNudgeEmailHtml`); Test: `apps/worker/src/nudge-email.test.ts`.

v1 keeps its original hook/structure but takes a `founderModuleHtml` param and renders it where the invite-rewards block was.

- [ ] **Step 1: Write the failing test.** Append:
```ts
import { buildNudgeEmailHtml } from './index';

describe('buildNudgeEmailHtml (v1)', () => {
  it('keeps the original hook + injects founder module, drops the invite-rewards block', () => {
    const html = buildNudgeEmailHtml('Sam', [REC('a')], null, '<!--FOUNDER-->');
    expect(html).toContain('Save Your First Recipe');     // original v1 hook intact
    expect(html).toContain('<!--FOUNDER-->');              // founder module injected
    expect(html).not.toContain('earn rewards');            // invite-rewards block gone
    expect(html).not.toContain('?add=1');                  // invite CTA gone
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts -t "v1"`
Expected: FAIL — `buildNudgeEmailHtml` has arity 3 (no founder param) and still contains the invite block.

- [ ] **Step 3: Implement.** In `apps/worker/src/index.ts`:
3a. Change the signature:
```ts
export function buildNudgeEmailHtml(
  displayName: string,
  recipes: RecommendedRecipe[],
  gifUrl: string | null,
  founderModuleHtml: string
): string {
```
3b. Replace the invite-rewards block (the `<div style="border-top:1px solid #eee;margin:0 24px;"></div>` + `<div style="padding:32px 24px;">...Invite Friends →...</div>` immediately before the footer, ~4924-4935) with:
```ts
  ${founderModuleHtml}
```
Leave everything else (header, hook, 3-step, "Save Your First Recipe" CTA, recommended grid, footer) unchanged.

- [ ] **Step 4: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/nudge-email.test.ts`
Expected: PASS (all nudge-email tests).

- [ ] **Step 5: Commit.**
```bash
git add apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat(nudge): v1 swaps invite-rewards block for the founder module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the cron — variant assignment, subjects, founder module

**Files:** Modify `apps/worker/src/index.ts` (cron send loop ~1018-1071).

Mechanical wiring of the tested helpers. No new unit tests (the `scheduled` loop is integration; helpers are already covered). Verify by a careful read + the worker build + the manual smoke at the end.

- [ ] **Step 1: Fetch founder favorites once per run.** Right after the `NUDGE_EMAILS_ENABLED` kill-switch check and before the `rows` query (~1018), add:
```ts
    const v2Pct = Math.min(Math.max(parseInt(env.NUDGE_V2_PCT ?? '0', 10) || 0, 0), 100);
    const founderFavRaw = await getEditorsPick(env.DB); // founder's is_favorite recipes
    const founderFavorites: RecommendedRecipe[] = founderFavRaw.map(r => ({
      id: r.id, userId: r.userId, title: r.title, durationMinutes: r.durationMinutes,
      mealTypes: r.mealTypes, imageUrl: r.imageUrl,
      shareUrl: `https://recifriend.com/recipes/${encodeURIComponent(r.id)}?user=${encodeURIComponent(r.userId)}`,
    }));
```

- [ ] **Step 2: Per-recipient: pick variant, build the deduped founder module, choose builder + subject.** Replace the body of the send branch (currently ~1050-1066, from `const recipes = await getRecommendedRecipes(...)` through the `sendEmailNotification(...)` call) with:
```ts
      const recipes = await getRecommendedRecipes(env.DB, userId, 6);
      const variant = pickNudgeVariant(userId, v2Pct);

      // Dedup founder favorites against whatever this email already shows.
      const shownIds = new Set(recipes.map(r => r.id));
      const founderModuleHtml = buildFounderModuleHtml(dedupeFavorites(founderFavorites, shownIds, 3));

      const secret = env.DEV_API_KEY;
      if (!secret) return; // Can't sign unsubscribe tokens without DEV_API_KEY
      const unsubToken = await computeHmac(secret, userId);

      let html = variant === 'v2'
        ? buildNudgeEmailHtmlV2(displayName, recipes, founderModuleHtml)
        : buildNudgeEmailHtml(displayName, recipes, null, founderModuleHtml);
      html = html.replace('__USER_ID__', encodeURIComponent(userId));
      html = html.replace('__TOKEN__', unsubToken);

      const subject = variant === 'v2'
        ? (recipes[0] ? `Worth saving tonight, ${displayName} 🍴` : `Your next favorite recipe, ${displayName} 🍴`)
        : `Your recipes are waiting, ${displayName}!`;

      await sendEmailNotification(env, email, subject, html);
```
(Remove the now-unused `const gifUrl` line.)

- [ ] **Step 3: Record the variant on send.** Change the post-send update (~1068) from
`'UPDATE nudge_emails SET sent = 1, sent_at = ? WHERE user_id = ?'` bound `(now, userId)` to:
```ts
      await env.DB.prepare(
        'UPDATE nudge_emails SET sent = 1, sent_at = ?, variant = ? WHERE user_id = ?'
      ).bind(now, variant, userId).run();
```

- [ ] **Step 4: Build the worker to typecheck.**
Run: `cd apps/worker && npx wrangler deploy --dry-run --outdir /tmp/wbuild 2>&1 | tail -3`
Expected: "Compiled Worker successfully".

- [ ] **Step 5: Run the full worker suite.**
Run: `cd apps/worker && npm test`
Expected: PASS except the pre-existing unrelated `gemini.integration.test.ts`.

- [ ] **Step 6: Commit.**
```bash
git add apps/worker/src/index.ts
git commit -m "feat(nudge): cron assigns v1/v2 by NUDGE_V2_PCT, injects founder module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Re-queue endpoint

**Files:** Modify `apps/worker/src/routes/admin.ts`, `apps/worker/src/index.ts`; Test: `apps/worker/src/routes/admin.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `apps/worker/src/routes/admin.test.ts` (add `handleAdminNudgeRequeue` to the `./admin` import):
```ts
describe('handleAdminNudgeRequeue', () => {
  const adminEmails = 'admin@recifriend.com';
  it('rejects a non-admin with 403', async () => {
    const res = await handleAdminNudgeRequeue({
      env: { DB: {} as unknown as D1Database }, user: { userId: 'u', email: 'nobody@x.com' },
      adminEmails, url: new URL('https://x/admin/nudge/requeue'),
    });
    expect(res.status).toBe(403);
  });
  it('resets still-0-recipe sent rows and returns the count', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 7 } });
    const bind = vi.fn().mockReturnValue({ run });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind }) } as unknown as D1Database;
    const res = await handleAdminNudgeRequeue({
      env: { DB: mockDb }, user: { userId: 'u', email: 'admin@recifriend.com' },
      adminEmails, url: new URL('https://x/'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requeued: 7 });
    // The UPDATE must scope to still-0-recipe sent rows.
    const sql = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain('UPDATE nudge_emails');
    expect(sql).toContain('sent = 0');
    expect(sql).toContain('variant = NULL');
    expect(sql).toContain('NOT IN (SELECT DISTINCT user_id FROM recipes)');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t handleAdminNudgeRequeue`
Expected: FAIL.

- [ ] **Step 3: Implement the handler** in `apps/worker/src/routes/admin.ts` (after the seed-conversions handler):
```ts
// POST /admin/nudge/requeue — reset still-0-recipe previously-sent nudge rows so the
// cron re-sends them with a fresh A/B variant. Idempotent.
export async function handleAdminNudgeRequeue(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;
  const now = new Date().toISOString();
  const r = await args.env.DB.prepare(
    `UPDATE nudge_emails
     SET sent = 0, sent_at = NULL, variant = NULL, send_after = ?
     WHERE sent = 1 AND user_id NOT IN (SELECT DISTINCT user_id FROM recipes)`
  ).bind(now).run();
  const requeued = (r as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  return json(200, { requeued });
}
```

- [ ] **Step 4: Register the route** in `apps/worker/src/index.ts` (after the seed-conversions route):
```ts
      if (url.pathname === '/admin/nudge/requeue' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const { handleAdminNudgeRequeue } = await import('./routes/admin');
        return await handleAdminNudgeRequeue({ env, user, adminEmails: env.ADMIN_EMAILS, url });
      }
```

- [ ] **Step 5: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t handleAdminNudgeRequeue`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/index.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(nudge): admin re-queue endpoint for the dead-cold cohort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: nudge-ab metric

**Files:** Modify `apps/worker/src/routes/admin.ts`, `apps/worker/src/index.ts`; Test: `apps/worker/src/routes/admin.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `apps/worker/src/routes/admin.test.ts` (add `buildNudgeAbQuery`, `handleAdminNudgeAb` to the import):
```ts
describe('buildNudgeAbQuery', () => {
  it('counts sent + activated-after-send per variant, excludes NULL + owner emails', () => {
    const { sql } = buildNudgeAbQuery(['owner@x.com']);
    expect(sql).toContain("variant IN ('v1','v2')");
    expect(sql).toContain('n.sent = 1');
    expect(sql).toContain('r.created_at >= n.sent_at');   // activated after send
    expect(sql).toContain('email IN (?)');                 // exclusion
    expect(sql).toContain('GROUP BY');                     // per-variant
  });
});

describe('handleAdminNudgeAb', () => {
  const adminEmails = 'admin@recifriend.com';
  it('rejects a non-admin with 403', async () => {
    const res = await handleAdminNudgeAb({
      env: { DB: {} as unknown as D1Database }, user: { userId: 'u', email: 'nobody@x.com' },
      adminEmails, url: new URL('https://x/'),
    });
    expect(res.status).toBe(403);
  });
  it('returns per-variant rows + totals with computed rates', async () => {
    const mockDb = { prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [
        { variant: 'v1', sent: 100, activated: 12 },
        { variant: 'v2', sent: 100, activated: 20 },
      ] }),
    }) } as unknown as D1Database;
    const res = await handleAdminNudgeAb({
      env: { DB: mockDb }, user: { userId: 'u', email: 'admin@recifriend.com' },
      adminEmails, url: new URL('https://x/'),
    });
    const body = await res.json();
    expect(body.variants).toEqual([
      { variant: 'v1', sent: 100, activated: 12, rate: 0.12 },
      { variant: 'v2', sent: 100, activated: 20, rate: 0.2 },
    ]);
    expect(body.totals).toEqual({ sent: 200, activated: 32, rate: 0.16 });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "buildNudgeAbQuery|handleAdminNudgeAb"`
Expected: FAIL.

- [ ] **Step 3: Implement** in `apps/worker/src/routes/admin.ts`:
```ts
export function buildNudgeAbQuery(excludeEmails: string[] = []): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      SELECT n.variant AS variant,
             COUNT(*) AS sent,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM recipes r
               WHERE r.user_id = n.user_id AND r.created_at >= n.sent_at
             ) THEN 1 ELSE 0 END) AS activated
      FROM nudge_emails n
      WHERE n.sent = 1
        AND n.variant IN ('v1','v2')
        AND n.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      GROUP BY n.variant
    `.trim(),
    params: [...excludeEmails],
  };
}

export async function handleAdminNudgeAb(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;
  const q = buildNudgeAbQuery(METRICS_EXCLUDED_EMAILS);
  const rows = await args.env.DB.prepare(q.sql).bind(...q.params)
    .all<{ variant: string; sent: number; activated: number }>();
  const rate = (a: number, s: number) => (s > 0 ? Math.round((a / s) * 1000) / 1000 : 0);
  const variants = (rows.results || []).map(r => ({
    variant: r.variant, sent: Number(r.sent), activated: Number(r.activated),
    rate: rate(Number(r.activated), Number(r.sent)),
  }));
  const sent = variants.reduce((a, v) => a + v.sent, 0);
  const activated = variants.reduce((a, v) => a + v.activated, 0);
  return json(200, { variants, totals: { sent, activated, rate: rate(activated, sent) } });
}
```
Note: the `excludeEmails NOT IN profiles` filter resolves emails to user ids on the requester side (the nudge recipient is the profile user); `email IN (...)` matches `profiles.email`.

- [ ] **Step 4: Register the route** in `apps/worker/src/index.ts` (after the re-queue route):
```ts
      if (url.pathname === '/admin/metrics/nudge-ab' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const { handleAdminNudgeAb } = await import('./routes/admin');
        return await handleAdminNudgeAb({ env, user, adminEmails: env.ADMIN_EMAILS, url });
      }
```

- [ ] **Step 5: Run to verify it passes.**
Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS (all admin tests).

- [ ] **Step 6: Commit.**
```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/index.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(nudge): GET /admin/metrics/nudge-ab per-variant activation funnel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `?add_friend` deep link (frontend)

**Files:** Modify `apps/recipe-ui/src/App.jsx`. Mirrors the `accept_friend` lifecycle (capture → OAuth-preserve → consume).

- [ ] **Step 1: Capture at module load.** In `apps/recipe-ui/src/App.jsx`, in the module-load capture block (~260-266, right after the `accept_friend` capture), add:
```js
  const _addFriendId = _url.searchParams.get('add_friend');
  if (_addFriendId) {
    sessionStorage.setItem('pending_add_friend', _addFriendId);
    _url.searchParams.delete('add_friend');
  }
```

- [ ] **Step 2: Preserve through OAuth sign-in.** In the `redirectTo` chain (~3083), add a branch so a logged-out email click survives Google sign-in. Change the chain to include, before the final `: window.location.origin`:
```js
        : sessionStorage.getItem('pending_add_friend')
          ? `${window.location.origin}?add_friend=${encodeURIComponent(sessionStorage.getItem('pending_add_friend'))}`
```
(Insert it as another ternary rung in the existing `redirectTo` expression.)

- [ ] **Step 3: Consume post-auth.** In the "Handle pending friend request accept" effect (~4131), after the `if (pendingId) { ... }` accept block, add a sibling block. First extend the logged-out guard so an add_friend also opens the auth dialog: in the `if (!accessToken) {` block (~4137), include `pending_add_friend` in the condition that calls `setIsAuthDialogOpen(true)`. Then add:
```js
    const pendingAddFriend = sessionStorage.getItem('pending_add_friend');
    if (accessToken && pendingAddFriend) {
      sessionStorage.removeItem('pending_add_friend');
      callRecipesApi('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ userId: pendingAddFriend }),
      }, accessToken).then(() => {
        trackEvent('send_friend_request');
        setIsAuthDialogOpen(false);
        setSnackbarState({ open: true, message: 'Friend request sent to Elisa 💛', severity: 'success', anchorOrigin: { vertical: 'top', horizontal: 'center' } });
        fetchFriendRequests();
      }).catch((error) => {
        const msg = error?.message || '';
        const benign = msg.includes('already friends') || msg.includes('already sent');
        setSnackbarState({ open: true, message: benign ? 'You\'re already connected with Elisa.' : 'Could not send the request.', severity: benign ? 'info' : 'error' });
      });
    }
```

- [ ] **Step 4: Add a test.** Create `apps/recipe-ui/src/addFriendDeepLink.test.jsx` (or extend an existing App-level test). Because App.jsx is a large single component, a focused integration test is heavy; at minimum assert the capture logic with a small extracted check. If a full render is impractical, write a unit test around the capture by setting `window.history.replaceState` with `?add_friend=elisa-id` and asserting `sessionStorage.getItem('pending_add_friend')` is set after import. Concretely:
```jsx
import { describe, it, expect, beforeEach } from 'vitest';

describe('add_friend deep link capture', () => {
  beforeEach(() => { sessionStorage.clear(); });
  it('stashes pending_add_friend and strips the param', async () => {
    window.history.replaceState({}, '', '/?add_friend=elisa-id');
    await import('./App.jsx');           // module-load capture runs on import
    expect(sessionStorage.getItem('pending_add_friend')).toBe('elisa-id');
    expect(window.location.search).not.toContain('add_friend');
  });
});
```
If importing App.jsx has side effects that break the test environment, instead extract the capture into a tiny exported helper `captureAddFriendParam(url, storage)` and unit-test that; wire the module-load block to call it. Choose whichever keeps the test reliable; do NOT skip the test.

- [ ] **Step 5: Run the test + full frontend suite.**
Run: `cd apps/recipe-ui && npx vitest run src/addFriendDeepLink.test.jsx` then `npm test`
Expected: PASS; no regressions.

- [ ] **Step 6: Commit.**
```bash
git add apps/recipe-ui/src/App.jsx apps/recipe-ui/src/addFriendDeepLink.test.jsx
git commit -m "feat(friends): ?add_friend deep link sends a request (powers Connect with Elisa)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd apps/worker && npm test` — green except pre-existing `gemini.integration.test.ts`.
- [ ] `cd apps/recipe-ui && npm test` — green.
- [ ] Worker compiles (`wrangler deploy --dry-run`).

**Deploy (user-initiated, `git status` first):** worker `cd apps/worker && npx wrangler deploy`; frontend `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`.

**Smoke (post-deploy):**
- `NUDGE_V2_PCT` stays `"0"` (all v1) and `NUDGE_EMAILS_ENABLED` stays `"false"` until you're ready — so deploying does NOT send anything.
- Send yourself both variants via the existing `POST /admin/test-nudge-email` (verify it threads the founder module + variant; if it doesn't accept a variant param, eyeball v1 and temporarily flip the builder to confirm v2 renders).
- `POST /admin/nudge/requeue` (admin JWT) → `{ requeued: N }`; confirm N matches the still-0-recipe sent cohort.
- When ready: set `NUDGE_V2_PCT="50"`, then `NUDGE_EMAILS_ENABLED="true"`, redeploy. Read `GET /admin/metrics/nudge-ab` after sends accrue. Rollback = `NUDGE_V2_PCT="0"`.

## Spec coverage check

- v1/v2 differ only by hook, both share founder module — Tasks 4, 5, 6.
- Founder module = favorites (getEditorsPick) deduped + Connect CTA — Task 3, 6.
- NUDGE_V2_PCT split + rollback, deterministic assignment — Tasks 1, 2, 6.
- variant column + record on send; NULL excluded from metric — Tasks 1, 6, 8.
- Re-queue still-0-recipe cohort — Task 7.
- nudge-ab per-variant activation metric, owner-excluded — Task 8.
- ?add_friend deep link (capture/OAuth/consume), idempotent UX — Task 9.
- Out of scope (open/click pixels, N-day window, admin-ui widget, auto-accept) — none added.

## Notes / deviations from spec

- Assignment uses the existing `fnv1a32` hash (sync, no crypto) instead of SHA-256 — same deterministic 0-99 bucket, DRY, and avoids an async helper. Behavior identical.
- The founder favorites are mapped to the `RecommendedRecipe` shape in the cron (Task 6) so `dedupeFavorites`/`buildFounderModuleHtml` share one type.
