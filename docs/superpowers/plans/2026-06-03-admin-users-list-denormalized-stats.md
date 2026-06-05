# Admin Users List — Denormalized Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the per-page-load cost of the admin Users list (≈50 Supabase calls + a heavy grouped D1 join) by serving it from a denormalized `admin_user_stats` table refreshed by the existing hourly cron, and fix the activity-filter-after-pagination bug.

**Architecture:** A new admin-only table `admin_user_stats(user_id, recipe_count, friends_count, last_sign_in_at, synced_at)` is recomputed hourly in `scheduled()`. The Users list query becomes `profiles LEFT JOIN admin_user_stats` with the activity filter and `is_active` computed in SQL (via `julianday()`). Drill-down stays live (one Supabase call for the single user).

**Tech Stack:** Cloudflare Workers + D1 (TypeScript, vitest), Supabase Auth admin API.

> **PROJECT RULES:**
> - Do NOT `git commit` until the user gives explicit go-ahead. Commit steps are written out but must pause for approval.
> - If bash fails with ENOSPC on /private/tmp: `export CLAUDE_CODE_TMPDIR="$HOME/.claude/tmp"; mkdir -p "$HOME/.claude/tmp"` then retry.
> - Prod D1 migrations are applied MANUALLY with idempotent SQL (no `d1_migrations` table) — see Task 7. Do not run `wrangler d1 migrations apply`.
> - Run worker tests from `apps/worker`: `npx vitest run src/routes/admin.test.ts`.

## Spec

`docs/superpowers/specs/2026-06-03-admin-users-list-denormalized-stats-design.md`.

## File Structure

- **Create** `apps/worker/migrations/0019_admin_user_stats.sql` — the new table (idempotent).
- **Modify** `apps/worker/src/routes/admin.ts` — rewrite `buildUsersListQuery`; add `fetchAllSupabaseLastSignIn` + `syncAdminUserStats`; simplify `handleAdminUsersList`; remove dead helpers; add live `last_sign_in_at` to drill-down.
- **Modify** `apps/worker/src/routes/admin.test.ts` — tests for the new query, the sync, the simplified handler, and the drill-down fetch.
- **Modify** `apps/worker/src/index.ts` — call `syncAdminUserStats` from `scheduled()`.

## Key facts (verified)

- Dead-after-this-change helpers in `admin.ts`, referenced ONLY inside `admin.ts` (not in tests): `enrichWithLastSignIn`, `computeIsActive`, `classifyActivity`, `filterByActivity`, `ACTIVE_WINDOW_MS`, `GHOST_WINDOW_MS`. Safe to delete.
- `admin.test.ts` references `handleAdminUsersList` only for input-validation (400) tests — unaffected.
- Supabase admin list API: `GET {SUPABASE_URL}/auth/v1/admin/users?page=N&per_page=1000` with headers `Authorization: Bearer <key>` + `apikey: <key>`; returns `{ users: [{ id, last_sign_in_at, ... }] }`.
- Activity semantics being ported: `is_active` = not deleted AND recipe_count≥1 AND last_sign_in within 30d; `ghost` = recipe_count==0 AND NOT cameBack (cameBack = last_sign_in more than 5 min after signup); `inactive` = not active and not ghost; `soft_deleted` = deleted_at set.

---

### Task 1: Create the `admin_user_stats` migration

**Files:**
- Create: `apps/worker/migrations/0019_admin_user_stats.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0019_admin_user_stats.sql
-- Denormalized, admin-only per-user stats for the Users list. Recomputed hourly
-- by syncAdminUserStats() in scheduled(). Read by buildUsersListQuery via a PK
-- join so the list does no aggregation and no Supabase calls.
CREATE TABLE IF NOT EXISTS admin_user_stats (
  user_id          TEXT PRIMARY KEY,
  recipe_count     INTEGER NOT NULL DEFAULT 0,
  friends_count    INTEGER NOT NULL DEFAULT 0,
  last_sign_in_at  TEXT,
  synced_at        TEXT NOT NULL
);
```

- [ ] **Step 2: Verify the SQL parses locally (no prod write yet)**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --local --file ./migrations/0019_admin_user_stats.sql`
Expected: succeeds (creates the table in the local D1). Prod application happens in Task 7.

- [ ] **Step 3: Commit** (after user go-ahead)

```bash
git add apps/worker/migrations/0019_admin_user_stats.sql
git commit -m "feat(admin): add admin_user_stats table"
```

---

### Task 2: Rewrite `buildUsersListQuery` to read `admin_user_stats`

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (`RECIPE_BUCKETS` map + `buildUsersListQuery`, ~lines 174-235)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write/replace the failing tests**

Find the existing `describe('buildUsersListQuery', ...)` block (~line 157) and replace it with:

```ts
describe('buildUsersListQuery', () => {
  it('joins admin_user_stats with no GROUP BY and no recipes/invites_sent', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/LEFT JOIN admin_user_stats s ON s\.user_id = p\.user_id/i);
    expect(sql).not.toMatch(/GROUP BY/i);
    expect(sql).not.toMatch(/LEFT JOIN recipes/i);
    expect(sql).not.toMatch(/invites_sent/i);
    expect(sql).toMatch(/COALESCE\(s\.recipe_count, 0\) AS recipe_count/i);
    expect(sql).toMatch(/COALESCE\(s\.friends_count, 0\) AS invites_accepted/i);
    expect(sql).toMatch(/s\.last_sign_in_at AS last_sign_in_at/i);
    expect(sql).toMatch(/AS is_active/i);
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)/i);
  });

  it('default excludes soft-deleted and paginates', () => {
    const { sql, params } = buildUsersListQuery({ limit: 25, offset: 50 });
    expect(sql).toMatch(/p\.deleted_at IS NULL/i);
    expect(sql).toMatch(/LIMIT \? OFFSET \?/i);
    expect(params).toEqual([25, 50]);
  });

  it('search adds a LIKE clause with two params before limit/offset', () => {
    const { params } = buildUsersListQuery({ limit: 50, offset: 0, search: 'ann' });
    expect(params).toEqual(['%ann%', '%ann%', 50, 0]);
  });

  it('recipeBucket filters on COALESCE(s.recipe_count,0)', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '10-19' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) BETWEEN 10 AND 19/i);
  });

  it('activity=active filters by the is-active expression', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'active' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) >= 1/i);
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)/i);
  });

  it('activity=ghost filters by recipe_count 0 and not-came-back', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'ghost' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) = 0/i);
    expect(sql).toMatch(/5\.0\/1440\.0/);
  });

  it('activity=soft_deleted selects deleted rows', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'soft_deleted' });
    expect(sql).toMatch(/p\.deleted_at IS NOT NULL/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t buildUsersListQuery`
Expected: FAIL (old query still has GROUP BY / recipes join).

- [ ] **Step 3: Replace `RECIPE_BUCKETS` and `buildUsersListQuery`**

In `apps/worker/src/routes/admin.ts`, replace the `RECIPE_BUCKETS` const (~174-180) and the whole `buildUsersListQuery` function (~182-235) with:

```ts
const RECIPE_BUCKETS: Record<string, string> = {
  '0': 'COALESCE(s.recipe_count,0) = 0',
  '1-9': 'COALESCE(s.recipe_count,0) BETWEEN 1 AND 9',
  '10-19': 'COALESCE(s.recipe_count,0) BETWEEN 10 AND 19',
  '20-49': 'COALESCE(s.recipe_count,0) BETWEEN 20 AND 49',
  '50+': 'COALESCE(s.recipe_count,0) >= 50',
};

// Activity expressions (julianday so ISO `…T…Z` values compare correctly vs 'now').
const IS_ACTIVE_EXPR =
  `p.deleted_at IS NULL AND COALESCE(s.recipe_count,0) >= 1 ` +
  `AND s.last_sign_in_at IS NOT NULL ` +
  `AND julianday(s.last_sign_in_at) >= julianday('now','-30 days')`;
const CAME_BACK_EXPR =
  `julianday(COALESCE(s.last_sign_in_at, p.created_at)) - julianday(p.created_at) > (5.0/1440.0)`;
const GHOST_EXPR = `COALESCE(s.recipe_count,0) = 0 AND NOT (${CAME_BACK_EXPR})`;

export function buildUsersListQuery(p: UsersListParams): BuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  if (p.activity === 'soft_deleted') {
    where.push('p.deleted_at IS NOT NULL');
  } else {
    where.push('p.deleted_at IS NULL');
  }

  if (p.search) {
    where.push('(p.email LIKE ? OR p.display_name LIKE ?)');
    params.push(`%${p.search}%`, `%${p.search}%`);
  }
  if (p.signupAfter) { where.push('p.created_at >= ?'); params.push(p.signupAfter); }
  if (p.signupBefore) { where.push('p.created_at <= ?'); params.push(p.signupBefore); }
  if (p.recipeBucket && RECIPE_BUCKETS[p.recipeBucket]) where.push(RECIPE_BUCKETS[p.recipeBucket]);

  if (p.activity === 'active') where.push(`(${IS_ACTIVE_EXPR})`);
  else if (p.activity === 'ghost') where.push(`(${GHOST_EXPR})`);
  else if (p.activity === 'inactive') where.push(`NOT (${IS_ACTIVE_EXPR}) AND NOT (${GHOST_EXPR})`);
  // 'soft_deleted' is already covered by the base deleted_at filter above.

  const orderBy = p.sort === 'signup_asc' ? 'p.created_at ASC' : 'p.created_at DESC';

  const sql = `
    SELECT
      p.user_id      AS id,
      p.email        AS email,
      p.display_name AS display_name,
      p.created_at   AS signed_up_at,
      p.deleted_at   AS deleted_at,
      COALESCE(s.recipe_count, 0)  AS recipe_count,
      COALESCE(s.friends_count, 0) AS invites_accepted,
      s.last_sign_in_at            AS last_sign_in_at,
      CASE WHEN ${IS_ACTIVE_EXPR} THEN 1 ELSE 0 END AS is_active
    FROM profiles p
    LEFT JOIN admin_user_stats s ON s.user_id = p.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `.trim();

  params.push(p.limit, p.offset);
  return { sql, params };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t buildUsersListQuery`
Expected: PASS.

- [ ] **Step 5: Commit** (after user go-ahead)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): users list reads admin_user_stats, activity filter in SQL"
```

---

### Task 3: Add `fetchAllSupabaseLastSignIn` + `syncAdminUserStats`

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add near the other exported helpers, e.g. after `buildUsersListQuery`)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/worker/src/routes/admin.test.ts`:

```ts
import { syncAdminUserStats, fetchAllSupabaseLastSignIn } from './admin';

describe('syncAdminUserStats', () => {
  function mockDb(captured: any[]) {
    const prepare = vi.fn((sql: string) => ({
      bind: (...args: any[]) => ({ __sql: sql, __args: args }),
      all: vi.fn().mockImplementation(() => {
        if (/FROM recipes/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1', n: 3 }] });
        if (/FROM friends/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1', n: 2 }] });
        if (/FROM profiles/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1' }, { user_id: 'u2' }] });
        return Promise.resolve({ results: [] });
      }),
    }));
    const batch = vi.fn((stmts: any[]) => { captured.push(...stmts); return Promise.resolve([]); });
    return { prepare, batch } as any;
  }

  it('upserts one row per profile with merged counts + last_sign_in', async () => {
    const captured: any[] = [];
    const db = mockDb(captured);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [{ id: 'u1', last_sign_in_at: '2026-06-01T00:00:00Z' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await syncAdminUserStats({ DB: db, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });

    expect(res.users).toBe(2);
    const u1 = captured.find((s) => s.__args[0] === 'u1');
    const u2 = captured.find((s) => s.__args[0] === 'u2');
    // (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
    expect(u1.__args.slice(0, 4)).toEqual(['u1', 3, 2, '2026-06-01T00:00:00Z']);
    expect(u2.__args.slice(0, 4)).toEqual(['u2', 0, 0, null]);
    expect(u1.__sql).toMatch(/last_sign_in_at=excluded\.last_sign_in_at/i);
    vi.unstubAllGlobals();
  });

  it('preserves existing last_sign_in_at when Supabase fetch fails', async () => {
    const captured: any[] = [];
    const db = mockDb(captured);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const res = await syncAdminUserStats({ DB: db, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });

    expect(res.users).toBe(2); // counts still written
    const u1 = captured.find((s) => s.__args[0] === 'u1');
    expect(u1.__args.slice(0, 3)).toEqual(['u1', 3, 2]);
    // The conflict update must NOT touch last_sign_in_at on the failure path.
    expect(u1.__sql).not.toMatch(/last_sign_in_at=excluded/i);
    vi.unstubAllGlobals();
  });
});

describe('fetchAllSupabaseLastSignIn', () => {
  it('returns empty map without a service role key (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const m = await fetchAllSupabaseLastSignIn({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(m.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "syncAdminUserStats|fetchAllSupabaseLastSignIn"`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement both functions in `admin.ts`**

Add (e.g. right after `buildUsersListQuery`):

```ts
// Page through Supabase Auth admin users → Map<user_id, last_sign_in_at|null>.
export async function fetchAllSupabaseLastSignIn(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return out;
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!res.ok) throw new Error(`supabase list users failed: ${res.status}`);
    const body = (await res.json()) as { users?: Array<{ id: string; last_sign_in_at?: string | null }> };
    const users = body.users || [];
    for (const u of users) out.set(u.id, u.last_sign_in_at ?? null);
    if (users.length < perPage) break;
  }
  return out;
}

// Recompute admin_user_stats for every profile. Counts come from D1 (authoritative);
// last_sign_in from a batched Supabase call. If Supabase fails, counts are still
// written and existing last_sign_in_at values are PRESERVED (not blanked).
export async function syncAdminUserStats(
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }
): Promise<{ users: number }> {
  const now = new Date().toISOString();

  const [recipeRows, friendRows, profileRows] = await Promise.all([
    env.DB.prepare(`SELECT user_id, COUNT(*) AS n FROM recipes GROUP BY user_id`).all(),
    env.DB.prepare(`SELECT user_id, COUNT(DISTINCT friend_id) AS n FROM friends GROUP BY user_id`).all(),
    env.DB.prepare(`SELECT user_id FROM profiles`).all(),
  ]);

  const recipeCounts = new Map<string, number>();
  for (const r of (recipeRows.results as any[]) || []) recipeCounts.set(r.user_id, r.n);
  const friendCounts = new Map<string, number>();
  for (const r of (friendRows.results as any[]) || []) friendCounts.set(r.user_id, r.n);

  let lastSignIn = new Map<string, string | null>();
  let gotSignIn = false;
  try {
    lastSignIn = await fetchAllSupabaseLastSignIn(env);
    gotSignIn = true;
  } catch (err) {
    console.error('[admin] syncAdminUserStats: supabase fetch failed; writing counts only', err);
  }

  // On success, refresh last_sign_in_at too. On failure, leave it untouched for
  // existing rows (and NULL for brand-new ones).
  const upsertSql = gotSignIn
    ? `INSERT INTO admin_user_stats (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         recipe_count = excluded.recipe_count,
         friends_count = excluded.friends_count,
         last_sign_in_at = excluded.last_sign_in_at,
         synced_at = excluded.synced_at`
    : `INSERT INTO admin_user_stats (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         recipe_count = excluded.recipe_count,
         friends_count = excluded.friends_count,
         synced_at = excluded.synced_at`;

  const stmt = env.DB.prepare(upsertSql);
  const profileIds = ((profileRows.results as any[]) || []).map((r) => r.user_id as string);
  const batch = profileIds.map((id) =>
    stmt.bind(id, recipeCounts.get(id) ?? 0, friendCounts.get(id) ?? 0, lastSignIn.get(id) ?? null, now)
  );
  if (batch.length) await env.DB.batch(batch);
  return { users: batch.length };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "syncAdminUserStats|fetchAllSupabaseLastSignIn"`
Expected: PASS.

- [ ] **Step 5: Commit** (after user go-ahead)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): syncAdminUserStats + batched Supabase last-sign-in fetch"
```

---

### Task 4: Run the sync from the hourly cron

**Files:**
- Modify: `apps/worker/src/index.ts` (`scheduled()`, ~line 969)

- [ ] **Step 1: Add the sync call at the start of `scheduled()`**

Immediately after `async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {` insert:

```ts
    // Refresh denormalized admin user stats (isolated so a failure never blocks nudges).
    try {
      const { syncAdminUserStats } = await import('./routes/admin');
      const result = await syncAdminUserStats(env);
      console.log('[cron] syncAdminUserStats done', result);
    } catch (err) {
      console.error('[cron] syncAdminUserStats failed', err);
    }
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/worker && npx tsc --noEmit 2>&1 | grep -E "src/index.ts|src/routes/admin.ts" || echo "no new errors in touched files"`
Expected: no NEW errors (pre-existing admin.ts errors at the Supabase-headers line and the `.at(-1)` line may remain; nothing new from this task).

- [ ] **Step 3: Commit** (after user go-ahead)

```bash
git add apps/worker/src/index.ts
git commit -m "feat(admin): run syncAdminUserStats hourly in scheduled()"
```

---

### Task 5: Simplify `handleAdminUsersList`, remove dead code

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (`handleAdminUsersList` ~241-294; delete `ACTIVE_WINDOW_MS`, `GHOST_WINDOW_MS`, `enrichWithLastSignIn`, `computeIsActive`, `classifyActivity`, `filterByActivity` ~296-345)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/routes/admin.test.ts`:

```ts
describe('handleAdminUsersList (denormalized)', () => {
  it('returns joined rows without making any Supabase calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const rows = [
      { id: 'u1', email: 'a@x.com', display_name: 'A', signed_up_at: '2026-05-01', deleted_at: null,
        recipe_count: 5, invites_accepted: 2, last_sign_in_at: '2026-06-01T00:00:00Z', is_active: 1 },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: rows }) }),
    } as unknown as D1Database;

    const { handleAdminUsersList } = await import('./admin');
    const res = await handleAdminUsersList({
      env: { DB: mockDb, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/users?limit=1'),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].recipe_count).toBe(5);
    expect(body.page.has_more).toBe(true); // returned (1) === limit (1)
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "denormalized"`
Expected: FAIL (current handler calls `enrichWithLastSignIn`, which calls fetch per row).

- [ ] **Step 3: Replace the body of `handleAdminUsersList`**

Replace the block from `const { sql, params: bindParams } = buildUsersListQuery(params);` through the closing `}` of the function (~278-294) with:

```ts
  const { sql, params: bindParams } = buildUsersListQuery(params);
  const { results } = await args.env.DB.prepare(sql).bind(...bindParams).all();
  const users = results || [];

  return json(200, {
    users,
    page: {
      limit,
      offset,
      returned: users.length,
      has_more: users.length === limit,
    },
  });
}
```

- [ ] **Step 4: Delete the now-dead helpers**

Delete these from `admin.ts` (verified referenced only by each other / the old handler):
`ACTIVE_WINDOW_MS`, `GHOST_WINDOW_MS`, `enrichWithLastSignIn`, `computeIsActive`, `classifyActivity`, `filterByActivity` (the contiguous block ~296-345).

- [ ] **Step 5: Run the full admin suite + typecheck**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts && npx tsc --noEmit 2>&1 | grep "src/routes/admin.ts" || echo "no new admin.ts errors"`
Expected: all tests PASS; no NEW `admin.ts` type errors (the 2 pre-existing ones may remain). If `tsc` reports "declared but never read" for a helper, it wasn't deleted — remove it.

- [ ] **Step 6: Commit** (after user go-ahead)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "refactor(admin): simplify users-list handler, drop per-row Supabase enrichment"
```

---

### Task 6: Live `last_sign_in_at` on drill-down

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (`handleAdminUserDrilldown`, ~360-457)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/routes/admin.test.ts`:

```ts
describe('handleAdminUserDrilldown last_sign_in', () => {
  it('surfaces a live last_sign_in_at on the profile when a key is set', async () => {
    const stubs: any[] = [
      { user_id: 'u1', email: 'a@x.com', display_name: 'A', created_at: '2026-01-01', deleted_at: null }, // profile.first
      { results: [] }, // recipes
      { results: [] }, // cook_events
      { results: [] }, // conversions
      null,            // invite link .first
      { results: [] }, // pending_received
      { results: [] }, // shares
    ];
    let i = 0;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => Promise.resolve(stubs[i++])),
        all: vi.fn().mockImplementation(() => Promise.resolve(stubs[i++])),
      }),
    } as unknown as D1Database;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ last_sign_in_at: '2026-06-02T10:00:00Z' }) }));

    const { handleAdminUserDrilldown } = await import('./admin');
    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'u1',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.last_sign_in_at).toBe('2026-06-02T10:00:00Z');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "drilldown last_sign_in"`
Expected: FAIL (`profile.last_sign_in_at` is undefined).

- [ ] **Step 3: Add the live fetch and merge it into `profile`**

In `handleAdminUserDrilldown`, just before the final `return json(200, {`, add:

```ts
  // Live last_sign_in_at for this one user (cheap; keeps detail precise vs the
  // hourly-synced list value).
  let profileLastSignInAt: string | null = null;
  if (args.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/users/${args.userId}`, {
        headers: {
          Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      if (r.ok) profileLastSignInAt = ((await r.json()) as any).last_sign_in_at ?? null;
    } catch (err) {
      console.error('[admin] drilldown profile last_sign_in fetch failed', { userId: args.userId, err });
    }
  }
```

Then change the returned `profile` field from `profile,` to:

```ts
    profile: { ...(profile as any), last_sign_in_at: profileLastSignInAt },
```

- [ ] **Step 4: Run to confirm pass + full suite**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS (new drill-down test green; the existing drill-down tests use `SUPABASE_SERVICE_ROLE_KEY: undefined`, so the new fetch is skipped and they still pass).

- [ ] **Step 5: Commit** (after user go-ahead)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): live last_sign_in_at on user drill-down"
```

---

### Task 7: Verify, deploy, backfill (rollout)

**Files:** none (verification + rollout).

- [ ] **Step 1: Full worker test suite + typecheck**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts && npx tsc --noEmit 2>&1 | grep "src/routes/admin.ts" || echo "no new admin.ts errors"`
Expected: all PASS; only the 2 pre-existing `admin.ts` type errors (Supabase-headers overload; `.at(-1)`), nothing new.

- [ ] **Step 2: Create the table on prod (manual, idempotent)** — after user go-ahead

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --remote --file ./migrations/0019_admin_user_stats.sql`
Expected: success (idempotent; safe to re-run).

- [ ] **Step 3: Deploy the worker** — after user go-ahead

Run: `cd apps/worker && npx wrangler deploy`
Expected: deploys; route `api.recifriend.com/*` listed.

- [ ] **Step 4: Backfill immediately so the list isn't empty before the first cron**

The cron runs at the top of each hour. To populate now, run the same aggregation once via remote SQL (counts only; `last_sign_in_at` fills on the next cron):

Run:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --command "
INSERT INTO admin_user_stats (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
SELECT p.user_id,
       (SELECT COUNT(*) FROM recipes r WHERE r.user_id = p.user_id),
       (SELECT COUNT(DISTINCT f.friend_id) FROM friends f WHERE f.user_id = p.user_id),
       NULL,
       datetime('now')
FROM profiles p
ON CONFLICT(user_id) DO UPDATE SET
  recipe_count = excluded.recipe_count,
  friends_count = excluded.friends_count,
  synced_at = excluded.synced_at;
"
```
Expected: rows written = number of profiles. (last_sign_in_at / is_active populate on the next hourly cron; until then the active dot reads inactive — acceptable for the backfill window.)

- [ ] **Step 5: Smoke-check the live endpoint**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "https://api.recifriend.com/admin/users?limit=5"`
Expected: `401` (auth-gated, worker healthy). Then verify in the admin UI (admin.recifriend.com → Users) that the list renders with recipe/friend counts and pagination, and a row click still opens the drill-down.

---

## Self-Review

- **Spec coverage:** table (T1), sync via cron incl. batched Supabase + failure-preserve (T3,T4), list query w/ activity-in-SQL + dropped invites_sent/recipes join (T2), handler simplification + dead-code removal (T5), drill-down live last_sign_in (T6), rollout incl. manual idempotent migration + immediate backfill (T7), frontend unchanged (noted; no task needed). All spec sections covered.
- **Type consistency:** `admin_user_stats` columns `(user_id, recipe_count, friends_count, last_sign_in_at, synced_at)` identical across migration, sync upserts, list join, and backfill. `buildUsersListQuery` output fields (`recipe_count`, `invites_accepted`, `last_sign_in_at`, `is_active`) match what `Users.jsx` consumes. `syncAdminUserStats`/`fetchAllSupabaseLastSignIn` signatures match their call sites and tests.
- **Placeholder scan:** none — every step has concrete code/commands and expected output.
