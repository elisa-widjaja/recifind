# Admin Users Filter Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PROJECT COMMIT RULE:** This repo's standing convention is **no `git commit` without the user's explicit go-ahead**. The commit steps below are written out for completeness, but the executor MUST pause and ask before running any commit (or batch them all to the end and ask once). Do not auto-commit.

**Goal:** Show "All users" plus a global count beside every filter option (Recipes / Activity / Signed-up) on the admin dashboard Users page.

**Architecture:** A single SQL aggregate (`SUM(CASE WHEN …)`) over `profiles LEFT JOIN admin_user_stats` produces all counts at once. It's computed in the existing hourly `syncAdminUserStats` cron and cached to KV (`admin:user-counts:v1`). A new admin-gated `GET /admin/users/counts` serves the cached JSON (computing on-demand if the cache is cold). The frontend fetches it once on mount and renders the numbers into the header and dropdown labels.

**Tech Stack:** Cloudflare Worker (TypeScript) + D1 + Workers KV; React + MUI admin UI; vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-admin-users-filter-counts-design.md`

---

## File Structure

- **Modify** `apps/worker/src/routes/admin.ts` — add `UserCounts` type, `buildUserCountsQuery()`, `computeUserCounts()`, `handleAdminUserCounts()`, and the exported KV-key / TTL constants. Reuses the existing `RECIPE_BUCKETS`, `IS_ACTIVE_EXPR`, `GHOST_EXPR`, `requireAdmin`, and `json` helpers already in this file.
- **Modify** `apps/worker/src/index.ts` — register `GET /admin/users/counts` (next to the existing `/admin/users` route ~line 389) and add the count-caching step to the `scheduled()` cron (~line 977, right after the `syncAdminUserStats` block).
- **Modify** `apps/worker/src/routes/admin.test.ts` — unit tests for `buildUserCountsQuery`, `computeUserCounts`, and `handleAdminUserCounts`, in the existing SQL-string-assertion + mock-D1 style.
- **Modify** `apps/admin-ui/src/pages/Users.jsx` — fetch counts on mount, render the header line, append count suffixes to dropdown labels.

---

## Task 1: Count-query builder, type, and `computeUserCounts` (worker)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add after `handleAdminUsersList`, ~line 369)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this block to `apps/worker/src/routes/admin.test.ts`. Also add the imports `buildUserCountsQuery, computeUserCounts` to the existing `from './admin'` import line (the one at the top that already imports `buildUsersListQuery`).

```js
describe('buildUserCountsQuery', () => {
  it('aggregates over profiles LEFT JOIN admin_user_stats with no GROUP BY', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/FROM profiles p/i);
    expect(sql).toMatch(/LEFT JOIN admin_user_stats s ON s\.user_id = p\.user_id/i);
    expect(sql).not.toMatch(/GROUP BY/i);
  });

  it('counts total (non-deleted) and soft_deleted separately', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/SUM\(CASE WHEN p\.deleted_at IS NULL THEN 1 ELSE 0 END\) AS total/i);
    expect(sql).toMatch(/SUM\(CASE WHEN p\.deleted_at IS NOT NULL THEN 1 ELSE 0 END\) AS soft_deleted/i);
  });

  it('counts every recipe bucket scoped to non-deleted', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) = 0 THEN 1 ELSE 0 END\) AS r0/i);
    expect(sql).toMatch(/BETWEEN 1 AND 9 THEN 1 ELSE 0 END\) AS r1_9/i);
    expect(sql).toMatch(/BETWEEN 10 AND 19 THEN 1 ELSE 0 END\) AS r10_19/i);
    expect(sql).toMatch(/BETWEEN 20 AND 49 THEN 1 ELSE 0 END\) AS r20_49/i);
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) >= 50 THEN 1 ELSE 0 END\) AS r50p/i);
  });

  it('counts activity buckets reusing the active + ghost expressions', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)[\s\S]*AS active/i);
    expect(sql).toMatch(/5\.0\/1440\.0[\s\S]*AS ghost/i);
    expect(sql).toMatch(/AS inactive/i);
  });

  it('counts cumulative signup windows (non-deleted)', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/julianday\('now','-1 days'\)[\s\S]*AS d1/i);
    expect(sql).toMatch(/julianday\('now','-7 days'\)[\s\S]*AS d7/i);
    expect(sql).toMatch(/julianday\('now','-30 days'\)[\s\S]*AS d30/i);
    expect(sql).toMatch(/julianday\('now','-90 days'\)[\s\S]*AS d90/i);
  });
});

describe('computeUserCounts', () => {
  function mockDbReturning(row) {
    return {
      prepare: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(row),
      })),
    };
  }

  it('maps the aggregate row into the nested counts shape', async () => {
    const db = mockDbReturning({
      total: 1240, soft_deleted: 12,
      r0: 430, r1_9: 220, r10_19: 90, r20_49: 40, r50p: 8,
      active: 212, ghost: 430, inactive: 586,
      d1: 5, d7: 40, d30: 160, d90: 380,
    });
    const counts = await computeUserCounts({ DB: db });
    expect(counts.total).toBe(1240);
    expect(counts.recipes).toEqual({ '0': 430, '1-9': 220, '10-19': 90, '20-49': 40, '50+': 8 });
    expect(counts.activity).toEqual({ active: 212, inactive: 586, ghost: 430, soft_deleted: 12 });
    expect(counts.signup).toEqual({ '1': 5, '7': 40, '30': 160, '90': 380 });
    expect(typeof counts.computed_at).toBe('string');
  });

  it('coerces null/missing aggregate columns to 0', async () => {
    const db = mockDbReturning(null);
    const counts = await computeUserCounts({ DB: db });
    expect(counts.total).toBe(0);
    expect(counts.recipes['50+']).toBe(0);
    expect(counts.activity.soft_deleted).toBe(0);
    expect(counts.signup['90']).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "buildUserCountsQuery|computeUserCounts"`
Expected: FAIL — `buildUserCountsQuery is not a function` / `computeUserCounts is not a function`.

- [ ] **Step 3: Implement the type, builder, and compute function**

In `apps/worker/src/routes/admin.ts`, add immediately after the `handleAdminUsersList` function (after its closing brace, ~line 369). The expressions `RECIPE_BUCKETS`, `IS_ACTIVE_EXPR`, and `GHOST_EXPR` are already defined above in this file (lines ~174-189) — reuse them.

```ts
// KV key + TTL for the cached global Users-page counts. Written hourly by the
// cron (computeUserCounts) and served by handleAdminUserCounts. 6h TTL is a
// safety net well above the 1h cron cadence.
export const USER_COUNTS_KV_KEY = 'admin:user-counts:v1';
export const USER_COUNTS_TTL = 6 * 60 * 60;

export interface UserCounts {
  total: number;
  recipes: Record<'0' | '1-9' | '10-19' | '20-49' | '50+', number>;
  activity: Record<'active' | 'inactive' | 'ghost' | 'soft_deleted', number>;
  signup: Record<'1' | '7' | '30' | '90', number>;
  computed_at: string;
}

// Single aggregate over every profile. Each tally is scoped to non-deleted rows
// except `soft_deleted`. active/ghost/inactive partition the non-deleted set
// (disjoint, sum to total) using the SAME expressions as the list filters, so a
// bucket's count equals what you'd get by selecting that filter. Signup windows
// are cumulative (last-7d ⊆ last-30d), matching the list's signupAfter filter.
export function buildUserCountsQuery(): string {
  return `
    SELECT
      SUM(CASE WHEN p.deleted_at IS NULL THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN p.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS soft_deleted,

      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['0']} THEN 1 ELSE 0 END) AS r0,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['1-9']} THEN 1 ELSE 0 END) AS r1_9,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['10-19']} THEN 1 ELSE 0 END) AS r10_19,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['20-49']} THEN 1 ELSE 0 END) AS r20_49,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['50+']} THEN 1 ELSE 0 END) AS r50p,

      SUM(CASE WHEN ${IS_ACTIVE_EXPR} THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN p.deleted_at IS NULL AND (${GHOST_EXPR}) THEN 1 ELSE 0 END) AS ghost,
      SUM(CASE WHEN p.deleted_at IS NULL AND NOT (${IS_ACTIVE_EXPR}) AND NOT (${GHOST_EXPR}) THEN 1 ELSE 0 END) AS inactive,

      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-1 days') THEN 1 ELSE 0 END) AS d1,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-7 days') THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-30 days') THEN 1 ELSE 0 END) AS d30,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-90 days') THEN 1 ELSE 0 END) AS d90
    FROM profiles p
    LEFT JOIN admin_user_stats s ON s.user_id = p.user_id
  `.trim();
}

export async function computeUserCounts(env: { DB: D1Database }): Promise<UserCounts> {
  const row = (await env.DB.prepare(buildUserCountsQuery()).first()) as Record<string, number> | null;
  const n = (k: string): number => Number(row?.[k] ?? 0);
  return {
    total: n('total'),
    recipes: { '0': n('r0'), '1-9': n('r1_9'), '10-19': n('r10_19'), '20-49': n('r20_49'), '50+': n('r50p') },
    activity: { active: n('active'), inactive: n('inactive'), ghost: n('ghost'), soft_deleted: n('soft_deleted') },
    signup: { '1': n('d1'), '7': n('d7'), '30': n('d30'), '90': n('d90') },
    computed_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "buildUserCountsQuery|computeUserCounts"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit** *(ask for go-ahead first — see PROJECT COMMIT RULE)*

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): add user-counts aggregate query + computeUserCounts"
```

---

## Task 2: `GET /admin/users/counts` handler + route (worker)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add after `computeUserCounts` from Task 1)
- Modify: `apps/worker/src/index.ts` (~line 395, after the `/admin/users` route block)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/worker/src/routes/admin.test.ts`, and add `handleAdminUserCounts, USER_COUNTS_KV_KEY` to the `from './admin'` import line.

```js
describe('handleAdminUserCounts', () => {
  const adminEmails = 'admin@example.com';
  const admin = { userId: 'a1', email: 'admin@example.com' };

  it('returns 403 for a non-admin without touching KV or DB', async () => {
    const env = { DB: {}, AI_PICKS_CACHE: { get: vi.fn(), put: vi.fn() } };
    const res = await handleAdminUserCounts({
      env, adminEmails, user: { userId: 'u1', email: 'nope@example.com' },
    });
    expect(res.status).toBe(403);
    expect(env.AI_PICKS_CACHE.get).not.toHaveBeenCalled();
  });

  it('serves the cached counts without hitting the DB', async () => {
    const cached = { total: 1240, recipes: {}, activity: {}, signup: {}, computed_at: 'x' };
    const env = {
      DB: { prepare: vi.fn() },
      AI_PICKS_CACHE: { get: vi.fn().mockResolvedValue(cached), put: vi.fn() },
    };
    const res = await handleAdminUserCounts({ env, adminEmails, user: admin });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(cached);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.AI_PICKS_CACHE.get).toHaveBeenCalledWith(USER_COUNTS_KV_KEY, { type: 'json' });
  });

  it('computes + caches on a cold cache', async () => {
    const env = {
      DB: { prepare: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ total: 7 }) })) },
      AI_PICKS_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
    };
    const res = await handleAdminUserCounts({ env, adminEmails, user: admin });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(env.AI_PICKS_CACHE.put).toHaveBeenCalledWith(
      USER_COUNTS_KV_KEY, expect.any(String), { expirationTtl: 6 * 60 * 60 }
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "handleAdminUserCounts"`
Expected: FAIL — `handleAdminUserCounts is not a function`.

- [ ] **Step 3: Implement the handler**

In `apps/worker/src/routes/admin.ts`, add after `computeUserCounts`. `requireAdmin` and `json` are already defined/used in this file (see `handleAdminUsersList`).

```ts
export async function handleAdminUserCounts(args: {
  env: { DB: D1Database; AI_PICKS_CACHE: KVNamespace };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const cached = (await args.env.AI_PICKS_CACHE.get(USER_COUNTS_KV_KEY, { type: 'json' })) as UserCounts | null;
  if (cached) return json(200, cached);

  const counts = await computeUserCounts(args.env);
  await args.env.AI_PICKS_CACHE.put(USER_COUNTS_KV_KEY, JSON.stringify(counts), { expirationTtl: USER_COUNTS_TTL });
  return json(200, counts);
}
```

- [ ] **Step 4: Register the route in `index.ts`**

In `apps/worker/src/index.ts`, add this block immediately after the existing `/admin/users` route block (after line 395). Exact-match `pathname` checks mean ordering vs `/admin/users` is irrelevant, but keeping them adjacent is clearest.

```ts
      if (url.pathname === '/admin/users/counts' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const { handleAdminUserCounts } = await import('./routes/admin');
        return await handleAdminUserCounts({ env, user, adminEmails: env.ADMIN_EMAILS });
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "handleAdminUserCounts"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit** *(ask for go-ahead first)*

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/index.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): serve GET /admin/users/counts from KV with compute fallback"
```

---

## Task 3: Cache counts in the hourly cron (worker)

**Files:**
- Modify: `apps/worker/src/index.ts` (`scheduled()`, ~line 977, right after the `syncAdminUserStats` try/catch)

This wires into the existing cron, which (like the current `syncAdminUserStats` block) has no unit test — verification is the full test suite + typecheck. Counts are recomputed hourly so the served cache is at most ~1h stale.

- [ ] **Step 1: Add the caching step**

In `apps/worker/src/index.ts`, insert immediately after the closing `}` of the existing `syncAdminUserStats` try/catch (after line 977, before `const now = new Date().toISOString();`):

```ts
    // Cache the global Users-page counts off the freshly-synced stats (isolated
    // so a failure never blocks the sync above or the nudges below).
    try {
      const { computeUserCounts, USER_COUNTS_KV_KEY, USER_COUNTS_TTL } = await import('./routes/admin');
      const counts = await computeUserCounts(env);
      await env.AI_PICKS_CACHE.put(USER_COUNTS_KV_KEY, JSON.stringify(counts), { expirationTtl: USER_COUNTS_TTL });
      console.log('[cron] user counts cached', { total: counts.total });
    } catch (err) {
      console.error('[cron] user counts cache failed', err);
    }
```

- [ ] **Step 2: Typecheck + full worker test suite**

Run: `cd apps/worker && npx tsc --noEmit && npm test`
Expected: tsc clean (no errors); all vitest tests PASS including the new Task 1 + Task 2 specs.

- [ ] **Step 3: Commit** *(ask for go-ahead first)*

```bash
git add apps/worker/src/index.ts
git commit -m "feat(admin): refresh cached user counts in the hourly stats cron"
```

---

## Task 4: Render counts on the Users page (admin-ui)

**Files:**
- Modify: `apps/admin-ui/src/pages/Users.jsx`

No frontend test harness exists for admin-ui; verification is a production build + visual check. The labels degrade gracefully (no suffix) until counts load, so there is no layout dependency on the fetch.

- [ ] **Step 1: Add the counts state + fetch on mount**

In `apps/admin-ui/src/pages/Users.jsx`, add a state hook after the existing `const [loading, setLoading] = useState(false);` (line 43):

```jsx
  const [counts, setCounts] = useState(null);
```

Then add a mount-only effect immediately after that existing list `useEffect` (after line 60). Counts are global, so this does NOT depend on the filter state:

```jsx
  useEffect(() => {
    fetchAdmin('/admin/users/counts').then(setCounts).catch(() => {});
  }, []);
```

- [ ] **Step 2: Add label helpers**

In `apps/admin-ui/src/pages/Users.jsx`, add these just before the `return (` statement (after the `exportCsv` function, ~line 114). They append ` (1,234)` to a label, using `total` for the empty "All …" option and the per-bucket value otherwise. The `v` values already match the count keys (`'1-9'`, `'active'`, `'7'`, etc.):

```jsx
  const withCount = (n) => (n == null ? '' : ` (${n.toLocaleString()})`);
  const recipeLabel = (b) => b.label + (counts ? withCount(b.v === '' ? counts.total : counts.recipes[b.v]) : '');
  const activityLabel = (b) => b.label + (counts ? withCount(b.v === '' ? counts.total : counts.activity[b.v]) : '');
  const signupLabel = (b) => b.label + (counts ? withCount(b.v === '' ? counts.total : counts.signup[b.v]) : '');
```

- [ ] **Step 3: Render the header line**

In the same file, replace the title line (line 118):

```jsx
      <Typography variant="h4" gutterBottom>Users</Typography>
```

with:

```jsx
      <Typography variant="h4" gutterBottom>Users</Typography>
      {counts && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          All users: {counts.total.toLocaleString()} · soft-deleted: {counts.activity.soft_deleted.toLocaleString()}
        </Typography>
      )}
```

(Separator is a middle dot `·`, not an em dash — per project copy convention.)

- [ ] **Step 4: Use the label helpers in the three dropdowns**

In the same file, update the three `MenuItem` maps:

Recipes (line 131) — change `{b.label}` to `{recipeLabel(b)}`:
```jsx
            {RECIPE_BUCKETS.map((b) => <MenuItem key={b.v} value={b.v}>{recipeLabel(b)}</MenuItem>)}
```

Activity (line 143) — change `{b.label}` to `{activityLabel(b)}`:
```jsx
            {ACTIVITY_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{activityLabel(b)}</MenuItem>)}
```

Signed up (line 155) — change `{b.label}` to `{signupLabel(b)}`:
```jsx
            {SIGNUP_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{signupLabel(b)}</MenuItem>)}
```

- [ ] **Step 5: Build to verify it compiles**

Run: `cd apps/admin-ui && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Commit** *(ask for go-ahead first)*

```bash
git add apps/admin-ui/src/pages/Users.jsx
git commit -m "feat(admin-ui): show all-users + per-filter counts on Users page"
```

---

## Final verification

- [ ] `cd apps/worker && npx tsc --noEmit && npm test` — all green.
- [ ] `cd apps/admin-ui && npm run build` — succeeds.
- [ ] Manual smoke (after deploy, which is a separate user-run step): open the admin Users page → header shows `All users: N`, each dropdown option shows its count, `All recipes` / `All activity` / `All time` all equal N, and the four activity counts (active + inactive + ghost) sum to N with soft-deleted shown separately.

## Notes / out of scope

- No D1 migration (uses existing `profiles` + `admin_user_stats`; cache lives in the existing `AI_PICKS_CACHE` KV namespace).
- Counts are global (not cross-filtered) and ignore the free-text search box — by design.
- Deploy is a separate manual step (`cd apps/worker && npx wrangler deploy`, then the admin-ui build/deploy) and is NOT part of this plan; the user runs it after review.
