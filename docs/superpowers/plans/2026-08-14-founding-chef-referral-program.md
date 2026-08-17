# Founding Chef Referral Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reward users who bring 3 new signups that each save 5 recipes with a gift card + permanent "Founding Chef" badge, and nudge heavy solo users to start inviting.

**Architecture:** New self-contained worker module `apps/worker/src/referrals.ts` (pure decision functions + thin D1 orchestrator, mirroring `brokenDigest.ts`), hooked into the existing hourly `scheduled()` handler on the 17:00 UTC tick. Attribution reuses the `open_invite_used` ledger; email-invite accept paths start writing it too. Frontend gets one self-fetching `ReferralProgramCard` component (mirroring `SuggestionsShelf`) plus a badge chip.

**Tech Stack:** Cloudflare Workers (TypeScript), D1/SQLite, vitest, React + MUI (JavaScript), Resend, APNs push.

**Spec:** `docs/superpowers/specs/2026-08-14-founding-chef-referral-program-design.md`

## Global Constraints

- No em dashes in ANY user-facing copy (app text, notifications, emails). Code comments exempt.
- All new worker route handlers: `return await handler()` inside the existing async try/catch (never `return handler()`).
- Migrations are idempotent SQL applied manually via `wrangler d1 execute` (no d1_migrations tracking on prod). This feature's migration is `0021` (0020 is taken).
- Milestone constants: 3 friends, 5 recipes each, 48h new-signup window, promo nudge at >= 10 recipes and 0 friends, 20 promo sends/day cap.
- Excluded from earning and from promo nudges: `METRICS_EXCLUDED_EMAILS` (exported from `src/routes/admin.ts:632`).
- Admin alert email goes to `elisa.widjaja@gmail.com` (same hard-coded pattern as the `/feedback` endpoint, `index.ts:322-341`).
- Prod deploys are OUT OF SCOPE for this plan. Execution stops after the dev deploy + verification task; Elisa reviews on dev web AND the Xcode dev build first.
- Run all worker tests with `cd apps/worker && npm test`.
- Commits: per-task commit steps are included, but per the project owner's standing rule get explicit go-ahead for the commit workflow before the first commit of the execution session.

---

### Task 1: Migration 0021 (schema + one-time backfill)

**Files:**
- Create: `apps/worker/migrations/0021_founding_chef.sql`

**Interfaces:**
- Produces: columns `profiles.founding_chef_at TEXT`, `profiles.referral_promo_at TEXT`; table `referral_rewards(user_id TEXT PK, granted_at TEXT NOT NULL, admin_emailed_at TEXT)`; backfilled `open_invite_used` rows. All later tasks assume these exist.

- [ ] **Step 1: Write the migration file**

```sql
-- 0021: Founding Chef referral program.
-- Idempotent-by-convention like other migrations here: ALTER TABLE ADD COLUMN
-- errors if re-run, which the manual apply process treats as "already applied"
-- (same as 0013/0014/0015). The INSERT and CREATE TABLE are safely re-runnable.

ALTER TABLE profiles ADD COLUMN founding_chef_at TEXT;
ALTER TABLE profiles ADD COLUMN referral_promo_at TEXT;

CREATE TABLE IF NOT EXISTS referral_rewards (
  user_id TEXT PRIMARY KEY,
  granted_at TEXT NOT NULL,
  admin_emailed_at TEXT
);

-- One-time backfill: recover invite attribution destroyed by the email-invite
-- path (and accepts predating migration 0017). Heuristic: the newer account
-- connected within 48h of its own creation AND the inviter account is >48h
-- older, so the older account almost certainly caused the signup. friends is
-- bilateral, so the WHERE clause picks exactly one direction per pair.
-- Previewed on prod 2026-08-14: adds exactly 5 rows.
INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at)
SELECT f.user_id, f.friend_id, f.connected_at
FROM friends f
JOIN profiles ip ON ip.user_id = f.user_id
JOIN profiles ap ON ap.user_id = f.friend_id
WHERE julianday(f.connected_at) - julianday(ap.created_at) BETWEEN 0 AND 2
  AND julianday(ap.created_at) - julianday(ip.created_at) > 2;
```

- [ ] **Step 2: Apply to the LOCAL dev database and verify**

Run (from `apps/worker`):
```bash
npx wrangler d1 execute recipes-db --local --file migrations/0021_founding_chef.sql
npx wrangler d1 execute recipes-db --local --command "SELECT sql FROM sqlite_master WHERE name IN ('profiles','referral_rewards')"
```
Expected: `profiles` shows both new columns; `referral_rewards` exists. (Local DB may have little data; the backfill inserting 0 rows locally is fine.)

- [ ] **Step 3: Commit**

```bash
git add apps/worker/migrations/0021_founding_chef.sql
git commit -m "feat(referrals): migration 0021 for Founding Chef program + attribution backfill"
```

Do NOT apply to prod (`--remote`) in this task; that happens in Task 7.

---

### Task 2: `referrals.ts` pure core (qualification, promo eligibility, admin email)

**Files:**
- Create: `apps/worker/src/referrals.ts`
- Test: `apps/worker/src/referrals.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (exact exports later tasks import):
  - `REFERRAL_FRIENDS_REQUIRED = 3`, `REFERRAL_RECIPES_REQUIRED = 5`, `NEW_SIGNUP_WINDOW_DAYS = 2`, `PROMO_MIN_RECIPES = 10`, `PROMO_DAILY_CAP = 20`
  - `type ReferralRow = { inviter_user_id: string; inviter_email: string; inviter_name: string | null; accepter_name: string | null; accepter_recipes: number }` (one row per new-signup referral, already filtered by the 48h test in SQL)
  - `selectWinners(rows: ReferralRow[], excludedEmails: string[]): Winner[]` where `type Winner = { userId: string; email: string; name: string; qualifiedFriends: { name: string; recipes: number }[] }`
  - `buildRewardAdminEmail(w: Winner): { subject: string; html: string }`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import {
  selectWinners, buildRewardAdminEmail,
  REFERRAL_FRIENDS_REQUIRED, REFERRAL_RECIPES_REQUIRED,
  type ReferralRow,
} from './referrals';

const row = (over: Partial<ReferralRow>): ReferralRow => ({
  inviter_user_id: 'inv-1', inviter_email: 'inv@example.com', inviter_name: 'Inga',
  accepter_name: 'Ana', accepter_recipes: 5, ...over,
});

describe('selectWinners', () => {
  it('grants when 3 referred friends each have >= 5 recipes', () => {
    const rows = [
      row({ accepter_name: 'Ana' }),
      row({ accepter_name: 'Ben', accepter_recipes: 7 }),
      row({ accepter_name: 'Cal', accepter_recipes: 5 }),
    ];
    const w = selectWinners(rows, []);
    expect(w).toHaveLength(1);
    expect(w[0].userId).toBe('inv-1');
    expect(w[0].qualifiedFriends.map(f => f.name)).toEqual(['Ana', 'Ben', 'Cal']);
  });

  it('does not grant with 3 friends when only 2 are qualified', () => {
    const rows = [row({}), row({ accepter_name: 'Ben' }), row({ accepter_name: 'Cal', accepter_recipes: 4 })];
    expect(selectWinners(rows, [])).toHaveLength(0);
  });

  it('excludes owner/test inviters case-insensitively', () => {
    const rows = [row({}), row({ accepter_name: 'B' }), row({ accepter_name: 'C' })]
      .map(r => ({ ...r, inviter_email: 'Elisa.Widjaja@gmail.com' }));
    expect(selectWinners(rows, ['elisa.widjaja@gmail.com'])).toHaveLength(0);
  });

  it('groups rows by inviter and can return multiple winners', () => {
    const a = [row({}), row({ accepter_name: 'B' }), row({ accepter_name: 'C' })];
    const b = a.map(r => ({ ...r, inviter_user_id: 'inv-2', inviter_email: 'two@example.com' }));
    expect(selectWinners([...a, ...b], []).map(w => w.userId).sort()).toEqual(['inv-1', 'inv-2']);
  });

  it('falls back to email when inviter_name is null/empty', () => {
    const rows = [row({ inviter_name: '' }), row({ inviter_name: '', accepter_name: 'B' }), row({ inviter_name: '', accepter_name: 'C' })];
    expect(selectWinners(rows, [])[0].name).toBe('inv@example.com');
  });
});

describe('buildRewardAdminEmail', () => {
  const winner = {
    userId: 'inv-1', email: 'inv@example.com', name: 'Inga',
    qualifiedFriends: [{ name: 'Ana', recipes: 6 }, { name: 'Ben', recipes: 5 }, { name: 'Cal', recipes: 9 }],
  };
  it('includes winner identity, all qualified friends, and no em dashes', () => {
    const { subject, html } = buildRewardAdminEmail(winner);
    expect(subject).toContain('Founding Chef');
    expect(subject).toContain('Inga');
    expect(html).toContain('inv@example.com');
    for (const f of winner.qualifiedFriends) expect(html).toContain(f.name);
    expect(html).not.toContain('—');
    expect(subject).not.toContain('—');
  });
  it('HTML-escapes names', () => {
    const { html } = buildRewardAdminEmail({ ...winner, name: '<b>x</b>' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('thresholds', () => {
  it('exports the spec constants', () => {
    expect(REFERRAL_FRIENDS_REQUIRED).toBe(3);
    expect(REFERRAL_RECIPES_REQUIRED).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/referrals.test.ts`
Expected: FAIL (module `./referrals` does not exist).

- [ ] **Step 3: Implement the pure core**

```typescript
import type { Env } from './index';

export const REFERRAL_FRIENDS_REQUIRED = 3;
export const REFERRAL_RECIPES_REQUIRED = 5;
export const NEW_SIGNUP_WINDOW_DAYS = 2; // profile created within 48h before the accept
export const PROMO_MIN_RECIPES = 10;
export const PROMO_DAILY_CAP = 20;

export type ReferralRow = {
  inviter_user_id: string;
  inviter_email: string;
  inviter_name: string | null;
  accepter_name: string | null;
  accepter_recipes: number;
};

export type Winner = {
  userId: string;
  email: string;
  name: string;
  qualifiedFriends: { name: string; recipes: number }[];
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function selectWinners(rows: ReferralRow[], excludedEmails: string[]): Winner[] {
  const excluded = new Set(excludedEmails.map(e => e.toLowerCase()));
  const byInviter = new Map<string, ReferralRow[]>();
  for (const r of rows) {
    if (excluded.has(r.inviter_email.toLowerCase())) continue;
    const list = byInviter.get(r.inviter_user_id) ?? [];
    list.push(r);
    byInviter.set(r.inviter_user_id, list);
  }
  const winners: Winner[] = [];
  for (const [userId, list] of byInviter) {
    const qualified = list.filter(r => r.accepter_recipes >= REFERRAL_RECIPES_REQUIRED);
    if (qualified.length < REFERRAL_FRIENDS_REQUIRED) continue;
    const first = list[0];
    winners.push({
      userId,
      email: first.inviter_email,
      name: (first.inviter_name || '').trim() || first.inviter_email,
      qualifiedFriends: qualified.map(r => ({ name: (r.accepter_name || '').trim() || 'A friend', recipes: r.accepter_recipes })),
    });
  }
  return winners;
}

export function buildRewardAdminEmail(w: Winner): { subject: string; html: string } {
  const subject = `Founding Chef earned: ${w.name} qualifies for a gift card`;
  const friends = w.qualifiedFriends
    .map(f => `<li>${esc(f.name)}: ${f.recipes} recipes saved</li>`)
    .join('');
  const html = [
    `<p><strong>${esc(w.name)}</strong> (${esc(w.email)}) just completed the Founding Chef milestone.</p>`,
    `<p>Qualified friends they brought to ReciFriend:</p>`,
    `<ul>${friends}</ul>`,
    `<p>Next step: reply to them to ask which gift card they want. Their badge and in-app notification were granted automatically.</p>`,
  ].join('\n');
  return { subject, html };
}
```

(`Env` import is unused until Task 4 adds the orchestrator to this same file; keep it now so Task 4 diffs stay small. If `noUnusedLocals` complains, prefix with `void 0` usage or add it in Task 4 instead.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/referrals.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/referrals.ts apps/worker/src/referrals.test.ts
git commit -m "feat(referrals): pure qualification + admin email core for Founding Chef"
```

---

### Task 3: Durable attribution on email-invite accepts

**Files:**
- Modify: `apps/worker/src/index.ts` — `handleAcceptInvite` (~line 4082 batch) and `handleCheckInvites` (~line 4126 batch)

**Interfaces:**
- Consumes: existing `open_invite_used` table.
- Produces: every email-invite accept writes `open_invite_used(inviter_user_id, accepter_user_id, accepted_at)`; Task 4's qualification query reads it.

- [ ] **Step 1: Add the ledger write to both batches**

In `handleAcceptInvite`, extend the existing `env.DB.batch([...])` (currently 2 friends inserts + 1 delete) with a 4th statement, placed BEFORE the delete:

```typescript
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(inviterUserId, user.userId, newUserProfile.email, newUserProfile.displayName, now),
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
    // Durable referral attribution: the email-invite path used to leave no
    // trace once pending_invites was deleted (Founding Chef program needs it).
    env.DB.prepare('INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at) VALUES (?, ?, ?)').bind(inviterUserId, user.userId, now),
    env.DB.prepare('DELETE FROM pending_invites WHERE id = ?').bind(token),
  ]);
```

Make the exact same 3rd-statement addition to the batch inside the `for` loop of `handleCheckInvites` (identical bind: `inviterUserId, user.userId, now`).

- [ ] **Step 2: Typecheck + full test suite**

Run: `cd apps/worker && npm test`
Expected: PASS, no type errors, no existing friend-flow tests broken.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(referrals): write open_invite_used attribution on email-invite accepts"
```

---

### Task 4: Reward + promo cron (`runReferralRewards`) wired into `scheduled()`

**Files:**
- Modify: `apps/worker/src/referrals.ts` (add orchestrator)
- Modify: `apps/worker/src/index.ts` — `scheduled()` (~line 1108, before the nudge kill-switch return) and `NotificationItem` type union (~line 92)
- Test: `apps/worker/src/referrals.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 1 schema, Task 2 `selectWinners`/`buildRewardAdminEmail`, `sendEmailNotification` + `computeHmac`-style exports from `./index`, `METRICS_EXCLUDED_EMAILS` from `./routes/admin`, `sendPushToUser` from `./push/apns`.
- Produces: `runReferralRewards(env: Env, now: Date): Promise<{ granted: number; emailsRetried: number; promosSent: number }>`; notification type `'reward_granted'`.

- [ ] **Step 1: Add failing tests for the tick gate and promo eligibility**

Add to `referrals.test.ts` (pure parts only; the D1 orchestration is exercised on dev in Task 7):

```typescript
import { isRewardTick, REFERRAL_TICK_HOUR_UTC, buildWinnerNotification, buildPromoNotification } from './referrals';

describe('isRewardTick', () => {
  it('fires only on the 17:00 UTC tick', () => {
    expect(isRewardTick(new Date('2026-08-14T17:05:00Z'))).toBe(true);
    expect(isRewardTick(new Date('2026-08-14T16:05:00Z'))).toBe(false);
    expect(REFERRAL_TICK_HOUR_UTC).toBe(17);
  });
});

describe('notification builders', () => {
  it('winner notification mentions the badge and gift card, no em dashes', () => {
    const n = buildWinnerNotification('2026-08-14T17:00:00.000Z');
    expect(n.type).toBe('reward_granted');
    expect(n.message).toContain('Founding Chef');
    expect(n.message).toContain('gift card');
    expect(n.message).not.toContain('—');
  });
  it('promo notification pitches inviting friends, no em dashes', () => {
    const n = buildPromoNotification('2026-08-14T17:00:00.000Z');
    expect(n.type).toBe('reward_granted');
    expect(n.message).toContain('gift card');
    expect(n.message).not.toContain('—');
  });
});
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `cd apps/worker && npx vitest run src/referrals.test.ts`
Expected: new cases FAIL (exports missing); Task 2 cases still PASS.

- [ ] **Step 3: Implement the orchestrator in `referrals.ts`**

```typescript
export const REFERRAL_TICK_HOUR_UTC = 17; // clear of the 16:00 nudge-email tick

export function isRewardTick(now: Date): boolean {
  return now.getUTCHours() === REFERRAL_TICK_HOUR_UTC;
}

export function buildWinnerNotification(createdAt: string) {
  return {
    type: 'reward_granted' as const,
    message: 'You earned the Founding Chef badge! Elisa will reach out about your gift card.',
    data: {},
    createdAt,
  };
}

export function buildPromoNotification(createdAt: string) {
  return {
    type: 'reward_granted' as const,
    message: 'Your recipe collection is getting serious. Invite friends who cook and earn a gift card on us.',
    data: { deepLink: 'friends' },
    createdAt,
  };
}

// One row per referred NEW signup (accepter profile created within 48h before
// the accept), with the accepter's live recipe count.
const REFERRAL_ROWS_SQL = `
  SELECT oiu.inviter_user_id, ip.email AS inviter_email, ip.display_name AS inviter_name,
         ap.display_name AS accepter_name,
         (SELECT COUNT(*) FROM recipes r WHERE r.user_id = oiu.accepter_user_id AND r.hidden_at IS NULL) AS accepter_recipes
  FROM open_invite_used oiu
  JOIN profiles ip ON ip.user_id = oiu.inviter_user_id AND ip.deleted_at IS NULL
  JOIN profiles ap ON ap.user_id = oiu.accepter_user_id AND ap.deleted_at IS NULL
  WHERE julianday(oiu.accepted_at) - julianday(ap.created_at) BETWEEN 0 AND ${NEW_SIGNUP_WINDOW_DAYS}
`;

export async function runReferralRewards(env: Env, now: Date): Promise<{ granted: number; emailsRetried: number; promosSent: number }> {
  const { METRICS_EXCLUDED_EMAILS } = await import('./routes/admin');
  const { sendEmailNotification } = await import('./index');
  const { sendPushToUser } = await import('./push/apns');
  const nowIso = now.toISOString();
  let granted = 0, emailsRetried = 0, promosSent = 0;

  // --- 1. New winners ---
  const rowsResult = await env.DB.prepare(REFERRAL_ROWS_SQL).all();
  const rows = (rowsResult.results ?? []) as ReferralRow[];
  const alreadyGranted = await env.DB.prepare('SELECT user_id FROM referral_rewards').all();
  const grantedIds = new Set((alreadyGranted.results ?? []).map(r => r.user_id as string));
  const winners = selectWinners(rows, METRICS_EXCLUDED_EMAILS).filter(w => !grantedIds.has(w.userId));

  for (const w of winners) {
    // Grant first (idempotency anchor), then side effects.
    await env.DB.prepare('INSERT OR IGNORE INTO referral_rewards (user_id, granted_at) VALUES (?, ?)').bind(w.userId, nowIso).run();
    await env.DB.prepare('UPDATE profiles SET founding_chef_at = ? WHERE user_id = ? AND founding_chef_at IS NULL').bind(nowIso, w.userId).run();
    const notif = buildWinnerNotification(nowIso);
    await env.DB.prepare('INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(w.userId, notif.type, notif.message, JSON.stringify(notif.data), notif.createdAt).run();
    try {
      await sendPushToUser(env as any, w.userId, {
        title: 'Founding Chef',
        body: notif.message,
        deepLink: 'https://recifriend.com/friends',
      });
    } catch (err) {
      console.error('[referrals] push failed', err);
    }
    granted++;
  }

  // --- 2. Admin fulfillment emails (fresh winners + retries for past failures) ---
  const pendingEmail = await env.DB.prepare('SELECT user_id FROM referral_rewards WHERE admin_emailed_at IS NULL').all();
  for (const p of (pendingEmail.results ?? [])) {
    const userId = p.user_id as string;
    // Rebuild the winner payload from current data (names/counts may have moved; fine for an admin email).
    const winner = selectWinners(rows.filter(r => r.inviter_user_id === userId), []).find(w => w.userId === userId);
    const profile = await env.DB.prepare('SELECT email, display_name FROM profiles WHERE user_id = ?').bind(userId).first();
    const email = buildRewardAdminEmail(winner ?? {
      userId,
      email: (profile?.email as string) ?? '(unknown)',
      name: ((profile?.display_name as string) || (profile?.email as string) || userId),
      qualifiedFriends: [],
    });
    const sent = await sendEmailNotification(env, 'elisa.widjaja@gmail.com', email.subject, email.html);
    if (sent.ok) {
      await env.DB.prepare('UPDATE referral_rewards SET admin_emailed_at = ? WHERE user_id = ?').bind(nowIso, userId).run();
      emailsRetried++;
    }
  }

  // --- 3. One-time promo nudge for heavy solo users ---
  const excludedPlaceholders = METRICS_EXCLUDED_EMAILS.map(() => '?').join(',');
  const promoTargets = await env.DB.prepare(
    `SELECT p.user_id FROM profiles p
     WHERE p.deleted_at IS NULL AND p.referral_promo_at IS NULL
       AND LOWER(p.email) NOT IN (${excludedPlaceholders})
       AND (SELECT COUNT(*) FROM recipes r WHERE r.user_id = p.user_id AND r.hidden_at IS NULL) >= ${PROMO_MIN_RECIPES}
       AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.user_id = p.user_id)
     LIMIT ${PROMO_DAILY_CAP}`
  ).bind(...METRICS_EXCLUDED_EMAILS.map(e => e.toLowerCase())).all();

  for (const t of (promoTargets.results ?? [])) {
    const userId = t.user_id as string;
    const notif = buildPromoNotification(nowIso);
    await env.DB.prepare('INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(userId, notif.type, notif.message, JSON.stringify(notif.data), notif.createdAt).run();
    await env.DB.prepare('UPDATE profiles SET referral_promo_at = ? WHERE user_id = ?').bind(nowIso, userId).run();
    try {
      await sendPushToUser(env as any, userId, {
        title: 'ReciFriend',
        body: notif.message,
        deepLink: 'https://recifriend.com/friends',
      });
    } catch (err) {
      console.error('[referrals] promo push failed', err);
    }
    promosSent++;
  }

  return { granted, emailsRetried, promosSent };
}
```

- [ ] **Step 4: Widen the notification type union and hook the cron**

In `index.ts` (~line 92) add the new type:

```typescript
  type: 'friend_request' | 'friend_accepted' | 'friend_cooked_recipe' | 'friend_saved_recipe' | 'friend_saved_your_recipe' | 'reward_granted';
```

In `scheduled()` insert this block AFTER the brokenDigest block (~line 1107) and BEFORE the nudge kill-switch (so it runs even while nudges are paused), matching the surrounding isolated-try/catch style:

```typescript
    // Founding Chef referral rewards + solo-user promo nudge. Isolated so a
    // failure never blocks nudges; internally gated to the 17:00 UTC tick.
    // See docs/superpowers/specs/2026-08-14-founding-chef-referral-program-design.md
    try {
      const { runReferralRewards, isRewardTick } = await import('./referrals');
      if (isRewardTick(new Date(event.scheduledTime))) {
        const result = await runReferralRewards(env, new Date(event.scheduledTime));
        console.log('[cron] referralRewards', result);
      }
    } catch (err) {
      console.error('[cron] referralRewards failed', err);
    }
```

- [ ] **Step 5: Run the full suite**

Run: `cd apps/worker && npm test`
Expected: PASS including the new `referrals.test.ts` cases; no type errors (the `'reward_granted'` union addition must not break existing `addNotification` call sites).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/referrals.ts apps/worker/src/referrals.test.ts apps/worker/src/index.ts
git commit -m "feat(referrals): daily reward cron, admin email with retry, solo-user promo nudge"
```

---

### Task 5: `GET /friends/referral-progress` endpoint

**Files:**
- Modify: `apps/worker/src/referrals.ts` (progress data function)
- Modify: `apps/worker/src/index.ts` (route registration near `/friends/open-invite`, ~line 926)
- Test: `apps/worker/src/referrals.test.ts` (shape function)

**Interfaces:**
- Consumes: Task 2 constants + `ReferralRow`, Task 1 `profiles.founding_chef_at`.
- Produces: `shapeProgress(rows: ReferralRow[], foundingChefAt: string | null)` returning `{ threshold: { friends: 3, recipes: 5 }, friends: { name: string, savesCount: number, qualified: boolean }[], qualifiedCount: number, foundingChefAt: string | null }`; HTTP endpoint `GET /friends/referral-progress` returning that JSON. The frontend (Task 6) fetches this path.

- [ ] **Step 1: Write the failing test**

```typescript
import { shapeProgress } from './referrals';

describe('shapeProgress', () => {
  it('caps savesCount at the threshold and marks qualified friends', () => {
    const rows = [
      row({ accepter_name: 'Ana', accepter_recipes: 12 }),
      row({ accepter_name: 'Ben', accepter_recipes: 3 }),
    ];
    const p = shapeProgress(rows, null);
    expect(p.threshold).toEqual({ friends: 3, recipes: 5 });
    expect(p.friends).toEqual([
      { name: 'Ana', savesCount: 5, qualified: true },
      { name: 'Ben', savesCount: 3, qualified: false },
    ]);
    expect(p.qualifiedCount).toBe(1);
    expect(p.foundingChefAt).toBeNull();
  });
  it('passes through the badge timestamp', () => {
    expect(shapeProgress([], '2026-08-14T17:00:00.000Z').foundingChefAt).toBe('2026-08-14T17:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/worker && npx vitest run src/referrals.test.ts`
Expected: FAIL (`shapeProgress` not exported).

- [ ] **Step 3: Implement shape function + handler + route**

In `referrals.ts`:

```typescript
export function shapeProgress(rows: ReferralRow[], foundingChefAt: string | null) {
  const friends = rows.map(r => ({
    name: (r.accepter_name || '').trim() || 'A friend',
    savesCount: Math.min(r.accepter_recipes, REFERRAL_RECIPES_REQUIRED),
    qualified: r.accepter_recipes >= REFERRAL_RECIPES_REQUIRED,
  }));
  return {
    threshold: { friends: REFERRAL_FRIENDS_REQUIRED, recipes: REFERRAL_RECIPES_REQUIRED },
    friends,
    qualifiedCount: friends.filter(f => f.qualified).length,
    foundingChefAt,
  };
}

export async function getReferralProgress(env: Env, userId: string) {
  const rowsResult = await env.DB.prepare(REFERRAL_ROWS_SQL + ' AND oiu.inviter_user_id = ?').bind(userId).all();
  const profile = await env.DB.prepare('SELECT founding_chef_at FROM profiles WHERE user_id = ?').bind(userId).first();
  return shapeProgress((rowsResult.results ?? []) as ReferralRow[], (profile?.founding_chef_at as string) ?? null);
}
```

NOTE: for the appended `AND` to be valid, `REFERRAL_ROWS_SQL` must not end after the WHERE clause with anything but the condition (it currently ends with the julianday BETWEEN condition, so appending `AND ...` is valid SQL).

In `index.ts`, next to the `/friends/open-invite` routes (~line 926), following the surrounding `return await` style:

```typescript
      if (url.pathname === '/friends/referral-progress' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await (async () => {
          const { getReferralProgress } = await import('./referrals');
          return json(await getReferralProgress(env, user.userId));
        })();
      }
```

- [ ] **Step 4: Run full suite**

Run: `cd apps/worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/referrals.ts apps/worker/src/referrals.test.ts apps/worker/src/index.ts
git commit -m "feat(referrals): GET /friends/referral-progress endpoint"
```

---

### Task 6: Frontend — program card, badge chip, notification rendering

**Files:**
- Create: `apps/recipe-ui/src/components/ReferralProgramCard.jsx`
- Create: `apps/recipe-ui/src/assets/founding-chef.png` (copy of `image assets/Awards icon/reward.png`)
- Modify: `apps/recipe-ui/src/components/AddFriendDrawer.jsx` (render card above the divider)
- Modify: `apps/recipe-ui/src/components/FriendsPage.jsx` (render card; badge icon on friend avatars)
- Modify: `apps/recipe-ui/src/components/ProfilePage.jsx` (Founding Chef chip)
- Modify: `apps/recipe-ui/src/App.jsx` (pass `accessToken`/profile data where needed)
- Modify: `apps/worker/src/index.ts` + `apps/worker/src/routes/*` as needed so the OWN-profile GET payload and the friends-list payload include `foundingChefAt` (grep for the profile GET handler and the `/friends` list handler; add `founding_chef_at` to their SELECTs and camelCase it in the JSON like neighboring fields)

**Interfaces:**
- Consumes: `GET /friends/referral-progress` (Task 5 shape), `foundingChefAt` on profile/friends payloads.
- Produces: `<ReferralProgramCard accessToken={...} />` self-fetching component.

- [ ] **Step 1: Copy the badge asset**

```bash
cp "image assets/Awards icon/reward.png" apps/recipe-ui/src/assets/founding-chef.png
```

- [ ] **Step 2: Write `ReferralProgramCard.jsx`**

Follow the `SuggestionsShelf.jsx` pattern (own `API_BASE_URL` from `import.meta.env`, self-fetch on mount with `accessToken`, render nothing while loading or on error):

```jsx
import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import badgeIcon from '../assets/founding-chef.png';

const API_BASE_URL = (import.meta.env.VITE_RECIPES_API_BASE_URL || '').replace(/\/$/, '');

// Founding Chef program card. Copy rule: no em dashes in any user-facing text.
export default function ReferralProgramCard({ accessToken }) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!accessToken || !API_BASE_URL) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/friends/referral-progress`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data) setProgress(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  if (!progress || progress.foundingChefAt) return null; // hidden once earned

  const slots = Array.from({ length: progress.threshold.friends }, (_, i) => progress.friends[i] || null);

  return (
    <Box sx={(theme) => ({
      borderRadius: 3, p: 2, mb: 2.5,
      bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Box component="img" src={badgeIcon} alt="" sx={{ width: 28, height: 28 }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Become a Founding Chef</Typography>
      </Box>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: slots.some(Boolean) ? 1.5 : 0 }}>
        Invite 3 friends. When each saves 5 recipes, you get a gift card of your choice, on us.
      </Typography>
      {slots.some(Boolean) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {slots.map((f, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {f && f.qualified
                ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
              <Typography sx={{ fontSize: 13 }}>
                {f
                  ? `${f.name}: ${f.savesCount} of ${progress.threshold.recipes} recipes`
                  : 'Waiting for your next invite'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Mount the card**

In `AddFriendDrawer.jsx`: import it and render `<ReferralProgramCard accessToken={accessToken} />` inside the non-loading branch, directly after the `ShareTile` row's closing `</Box>` and before the divider `<Box sx={{ mt: 0, mb: 3, ... }} />`.

In `FriendsPage.jsx`: import and render `<ReferralProgramCard accessToken={accessToken} />` near the top of the page body (above the friends list). `FriendsPage` receives or can receive `accessToken` from App.jsx the same way `AddFriendDrawer` does; check its current props at the `<FriendsPage` call site in App.jsx and thread it through if missing.

- [ ] **Step 4: Badge rendering**

Worker: find the handler serving the OWN profile (grep `display_name` selects around `GET /profile` routing in index.ts) and the friends-list handler (`GET /friends`); add `founding_chef_at` to their SELECT + `foundingChefAt` to the JSON payloads, matching neighboring camelCase mapping.

`ProfilePage.jsx`: where the display name renders (~line 143-165 region has the avatar block), add below the name, gated on the profile payload:

```jsx
{profile?.foundingChefAt && (
  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.5, px: 1, py: 0.25, borderRadius: 999, bgcolor: 'rgba(245,166,35,0.15)' }}>
    <Box component="img" src={badgeIcon} alt="" sx={{ width: 14, height: 14 }} />
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#f5a623' }}>Founding Chef</Typography>
  </Box>
)}
```

`FriendsPage.jsx`: on each friend row's `Avatar`, when that friend's payload has `foundingChefAt`, overlay the badge icon bottom-right (16px img absolutely positioned over the avatar Box).

- [ ] **Step 5: Notification deep link**

In App.jsx, find where notification taps are handled (grep `friend_request` in the notifications/activity rendering path, `FriendSections.jsx` `VERB_MAP` ~line 664). Add a `reward_granted` entry so the row renders with the message text as-is; tapping navigates to the Friends tab (same navigation used by friend_request rows). Also confirm `getFriendActivity`'s owner-visible type list in `index.ts` (~line 2558) includes `'reward_granted'` so the winner sees it in their feed; add it there.

- [ ] **Step 6: Build + visual check**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds. Then `npm run dev` and verify in the browser (logged in as a dev user): program card shows in Friends tab and Add Friend drawer; no console errors from the new fetch.

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-ui/src apps/worker/src
git commit -m "feat(referrals): Founding Chef program card, badge chip, notification rendering"
```

---

### Task 7: Dev deploy + end-to-end verification (STOP for Elisa's review)

**Files:** none created; deploy + manual verification.

- [ ] **Step 1: Apply migration 0021 to PROD D1** (additive; no behavior change until worker code ships, and the dev worker shares this DB)

```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --file migrations/0021_founding_chef.sql
npx wrangler d1 execute recipes-db --remote --command "SELECT COUNT(*) AS c FROM open_invite_used"
```
Expected: count is previous 42 + 5 backfilled = 47. Verify columns exist: `SELECT founding_chef_at, referral_promo_at FROM profiles LIMIT 1`.

- [ ] **Step 2: Check working tree, then deploy the DEV worker**

```bash
git status   # confirm only this feature's files are in play (parallel-work rule)
cd apps/worker && npx wrangler deploy --env dev
```

- [ ] **Step 3: Start the dev frontend stack**

Vite + tunnel (dev.recifriend.com): `cd apps/recipe-ui && npm run dev` in one terminal; `cloudflared tunnel run recifind-dev` in another (or ask Elisa to start them).

- [ ] **Step 4: Smoke-test the import flow** (protect-import-flow rule: parse + enrich a known-good recipe URL against the dev worker before considering the worker change safe)

- [ ] **Step 5: Force one cron pass on dev and verify**

`npx wrangler dev` cron testing is unreliable here; instead temporarily invoke via a one-off: run `runReferralRewards` logic by triggering the scheduled handler with `npx wrangler dev --env dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"` if workable, otherwise verify on the next real 17:00 UTC tick via `npx wrangler tail --env dev`. Expected: `[cron] referralRewards { granted: 0, emailsRetried: 0, promosSent: <n> }` and NO winner grants (no one qualifies yet per spec).

- [ ] **Step 6: STOP. Hand to Elisa for review**

Elisa reviews on dev.recifriend.com (web) AND the Xcode dev build (iOS) per the spec's rollout gate: program card in Friends tab + Add Friend drawer, badge chip (temporarily set `founding_chef_at` on a test account to preview: `UPDATE profiles SET founding_chef_at = '2026-08-14T00:00:00.000Z' WHERE email = 'elisa.widjaja@gmail.com'`, then NULL it back). Prod deploys happen only after her explicit approval, outside this plan.

---

## Self-review notes

- Spec coverage: rules → Tasks 2/4; migration + backfill → Task 1; attribution fixes → Task 3; cron/grant/admin-email-retry/promo → Task 4; progress API → Task 5; card/badge/notification → Task 6; rollout gate → Task 7. Launch email to existing users: intentionally manual, out of plan (spec says so).
- The promo nudge uses notification type `reward_granted` for both winner and promo messages to avoid a second union change; acceptable since rendering is message-driven.
- Task 4's admin-email rebuild-on-retry can (rarely) email with `qualifiedFriends: []` if data shifted between grant and retry; acceptable for an admin-facing alert.
