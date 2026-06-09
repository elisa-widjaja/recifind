# Seed-shelf Conversion Funnel Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-gated `GET /admin/metrics/seed-conversions` endpoint returning a requestsPending → connections → activated funnel per seed account (founder + top contributor), floored at the shelf launch date, so we can decide whether Phase 2 is worth building.

**Architecture:** A pure query builder + a handler in `apps/worker/src/routes/admin.ts`, plus one route registration in `apps/worker/src/index.ts` that passes the existing `SEEDED_SUGGESTIONS` config in (single source of truth, no circular import). Reuses the established `build*Query` → `{ sql, params }` pattern, the `requireAdmin` gate, `METRICS_EXCLUDED_EMAILS`, and the module-local `json()` helper.

**Tech Stack:** TypeScript Cloudflare Worker, D1, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-seed-conversion-metric-design.md`

---

## Grounding facts (verified)

- `apps/worker/src/routes/admin.ts` exports: `interface BuiltQuery { sql: string; params: unknown[] }` (line 172), `requireAdmin(ctx)` (returns a `Response` denial or `null`), the module-local `json(status, body)` helper (CORS baked in), and `METRICS_EXCLUDED_EMAILS` (includes both seed emails).
- Exclusion idiom (from `buildGrowthCountersQuery`): ``const ph = excludeEmails.map(() => '?').join(', '); const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';``
- Handler arg shape (from `handleAdminMetricsTimeseries`): `{ env: { DB }, user: { userId, email? }, adminEmails, url }`; it calls `requireAdmin({ user, adminEmails })` first, then `env.DB.prepare(sql).bind(...params).first()/.all()`.
- `isAdminEmail(email, adminEmails)` splits `adminEmails` on commas, lowercases, and checks membership.
- `SEEDED_SUGGESTIONS` is `export const` in `apps/worker/src/index.ts` (`{ email, label }[]`, founder first).
- Schema (0001_init): `friend_requests(to_user_id, from_user_id, status, created_at TEXT)`, `friends(user_id, friend_id, connected_at TEXT)`, `recipes(... created_at TEXT)`. All timestamps are ISO-8601 strings → lexical `>= '2026-06-08'` is valid.
- Resolved request rows are DELETED on accept/decline/cancel, so `friend_requests` holds only pending; intent is `requestsPending + connections`.

## File structure

- `apps/worker/src/routes/admin.ts` — add `SEED_SHELF_LAUNCH` const, `buildSeedFunnelQuery()`, `handleAdminSeedConversions()`.
- `apps/worker/src/routes/admin.test.ts` — add tests for the builder and handler.
- `apps/worker/src/index.ts` — register the route, passing `seeds: SEEDED_SUGGESTIONS`.

---

## Task 1: `SEED_SHELF_LAUNCH` + `buildSeedFunnelQuery`

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add after `buildWeeklySavesQuery`, near the other metric builders)
- Test: `apps/worker/src/routes/admin.test.ts`

### Step 1: Write the failing tests

Add to `apps/worker/src/routes/admin.test.ts`. First extend the existing import from `./admin` to also bring in the new symbols (add them to the existing import list at the top of the file):

```ts
import { buildSeedFunnelQuery, SEED_SHELF_LAUNCH, handleAdminSeedConversions } from './admin';
```

Then append this describe block:

```ts
describe('buildSeedFunnelQuery', () => {
  it('exposes the launch floor constant', () => {
    expect(SEED_SHELF_LAUNCH).toBe('2026-06-08');
  });

  it('builds the 3-step funnel with exclusions and per-subquery binds', () => {
    const { sql, params } = buildSeedFunnelQuery('seed-1', '2026-06-08', ['owner@x.com', 'test@x.com']);
    expect(sql).toContain('AS requestsPending');
    expect(sql).toContain('AS connections');
    expect(sql).toContain('AS activated');
    // each subquery floors on the launch param
    expect(sql).toContain('fr.created_at >= ?');
    expect(sql).toContain('f.connected_at >= ?');
    // activation = saved AFTER connecting
    expect(sql).toContain('r.created_at >= f.connected_at');
    // exclusion subselect present with one placeholder per excluded email
    expect(sql).toContain('email IN (?, ?)');
    // params: [seed, launch, ...excl] repeated once per subquery (3x)
    expect(params).toEqual([
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
    ]);
  });

  it('degrades the exclusion filter to constant-false with no excludeEmails', () => {
    const { sql, params } = buildSeedFunnelQuery('seed-1', '2026-06-08', []);
    expect(sql).toContain('WHERE 0');
    expect(sql).not.toContain('email IN');
    expect(params).toEqual([
      'seed-1', '2026-06-08',
      'seed-1', '2026-06-08',
      'seed-1', '2026-06-08',
    ]);
  });
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t buildSeedFunnelQuery`
Expected: FAIL — `buildSeedFunnelQuery` / `SEED_SHELF_LAUNCH` are not exported yet (import error).

### Step 3: Implement the constant and builder

In `apps/worker/src/routes/admin.ts`, add immediately after the `buildWeeklySavesQuery` function (search for `export function buildWeeklySavesQuery`):

```ts
// Floor for seed-shelf attribution. The worker shipped the seeded "Suggested
// friends" tier on 2026-06-08 (web gets the correct UX same day; iOS only from a
// post-seed build 31+). Connections before this are the seeds' pre-existing real
// friendships, not shelf-driven. Bump to the App Store approval date if you want
// the official window to start when the full UX is live on iOS.
export const SEED_SHELF_LAUNCH = '2026-06-08';

// Per-seed conversion funnel, floored at `launchIso`:
//   requestsPending — requests to the seed still awaiting acceptance. Resolved
//                     request rows are deleted on accept/decline, so this is the
//                     live pending set.
//   connections     — accepted connections to the seed (friends.connected_at).
//   activated       — connectors who saved >=1 recipe AFTER connecting.
// Caller derives intent = requestsPending + connections. `excludeEmails` drops
// owner/test requesters & connectors (same idiom as the other metric builders).
export function buildSeedFunnelQuery(
  seedUserId: string,
  launchIso: string,
  excludeEmails: string[] = []
): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM friend_requests fr
         WHERE fr.to_user_id = ? AND fr.created_at >= ?
           AND fr.from_user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      ) AS requestsPending,
      (SELECT COUNT(*) FROM friends f
         WHERE f.friend_id = ? AND f.connected_at >= ?
           AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      ) AS connections,
      (SELECT COUNT(*) FROM friends f
         WHERE f.friend_id = ? AND f.connected_at >= ?
           AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
           AND EXISTS (SELECT 1 FROM recipes r
                       WHERE r.user_id = f.user_id AND r.created_at >= f.connected_at)
      ) AS activated
  `.trim();
  const params = [
    seedUserId, launchIso, ...excludeEmails,
    seedUserId, launchIso, ...excludeEmails,
    seedUserId, launchIso, ...excludeEmails,
  ];
  return { sql, params };
}
```

### Step 4: Run the tests to verify they pass

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t buildSeedFunnelQuery`
Expected: PASS (3 tests).

### Step 5: Commit

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(metrics): buildSeedFunnelQuery + SEED_SHELF_LAUNCH

Per-seed requestsPending/connections/activated funnel floored at the shelf
launch date. Resolved request rows are deleted, so requestsPending is the live
pending set; intent is derived by the caller.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `handleAdminSeedConversions`

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add after `buildSeedFunnelQuery`)
- Test: `apps/worker/src/routes/admin.test.ts`

### Step 1: Write the failing tests

Append to `apps/worker/src/routes/admin.test.ts` (the `handleAdminSeedConversions` import was already added in Task 1). Add `vi` to the vitest import if not present (the file already uses `vi` elsewhere):

```ts
describe('handleAdminSeedConversions', () => {
  const SEEDS = [
    { email: 'elisa.widjaja@gmail.com', label: 'ReciFriend Founder' },
    { email: 'mochislime02@gmail.com', label: 'Top contributor' },
  ];
  const adminEmails = 'admin@recifriend.com';

  it('rejects a non-admin caller with 403', async () => {
    const res = await handleAdminSeedConversions({
      env: { DB: {} as unknown as D1Database },
      user: { userId: 'u', email: 'nobody@x.com' },
      adminEmails,
      url: new URL('https://x/admin/metrics/seed-conversions'),
      seeds: SEEDS,
    });
    expect(res.status).toBe(403);
  });

  it('returns the funnel per seed with derived intent and summed totals', async () => {
    const funnelRows = [
      { requestsPending: 8, connections: 4, activated: 2 }, // founder
      { requestsPending: 3, connections: 2, activated: 1 }, // top contributor
    ];
    let funnelCall = 0;
    const mockDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        // resolve query reads .all(); funnel queries read .first()
        all: vi.fn().mockResolvedValue({ results: [
          { userId: 'id-founder', email: 'elisa.widjaja@gmail.com' },
          { userId: 'id-mochi', email: 'mochislime02@gmail.com' },
        ] }),
        first: vi.fn().mockImplementation(() => Promise.resolve(funnelRows[funnelCall++])),
      })),
    } as unknown as D1Database;

    const res = await handleAdminSeedConversions({
      env: { DB: mockDb }, user: { userId: 'u', email: 'admin@recifriend.com' },
      adminEmails, url: new URL('https://x/'), seeds: SEEDS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.launchFloor).toBe('2026-06-08');
    expect(body.seeds[0]).toEqual({
      label: 'ReciFriend Founder', email: 'elisa.widjaja@gmail.com', userId: 'id-founder',
      requestsPending: 8, connections: 4, activated: 2, intent: 12,
    });
    expect(body.seeds[1].intent).toBe(5);
    expect(body.totals).toEqual({ requestsPending: 11, connections: 6, activated: 3, intent: 17 });
  });

  it('reports userId null and zeros for an unresolved seed', async () => {
    const mockDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [
          { userId: 'id-founder', email: 'elisa.widjaja@gmail.com' },
        ] }),
        first: vi.fn().mockResolvedValue({ requestsPending: 8, connections: 4, activated: 2 }),
      })),
    } as unknown as D1Database;

    const res = await handleAdminSeedConversions({
      env: { DB: mockDb }, user: { userId: 'u', email: 'admin@recifriend.com' },
      adminEmails, url: new URL('https://x/'), seeds: SEEDS,
    });
    const body = await res.json();
    const mochi = body.seeds.find((s: { email: string }) => s.email === 'mochislime02@gmail.com');
    expect(mochi).toEqual({
      label: 'Top contributor', email: 'mochislime02@gmail.com', userId: null,
      requestsPending: 0, connections: 0, activated: 0, intent: 0,
    });
  });
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t handleAdminSeedConversions`
Expected: FAIL — `handleAdminSeedConversions` not exported yet.

### Step 3: Implement the handler

In `apps/worker/src/routes/admin.ts`, add immediately after `buildSeedFunnelQuery`:

```ts
// GET /admin/metrics/seed-conversions
// Funnel of cold-start conversions driven by the seeded "Suggested friends"
// shelf, per seed and overall. `seeds` is passed in from index.ts
// (SEEDED_SUGGESTIONS) so this stays a single source of truth without importing
// from index.ts (which would be circular).
export async function handleAdminSeedConversions(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
  seeds: ReadonlyArray<{ email: string; label: string }>;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const emails = args.seeds.map((s) => s.email);
  const ph = emails.map(() => '?').join(', ');
  const resolved = emails.length
    ? await args.env.DB
        .prepare(`SELECT user_id AS userId, email FROM profiles WHERE email IN (${ph})`)
        .bind(...emails)
        .all<{ userId: string; email: string }>()
    : { results: [] as Array<{ userId: string; email: string }> };
  const idByEmail = new Map((resolved.results || []).map((r) => [r.email, r.userId]));

  const seeds: Array<{
    label: string; email: string; userId: string | null;
    requestsPending: number; connections: number; activated: number; intent: number;
  }> = [];
  let tReq = 0, tConn = 0, tAct = 0;

  for (const s of args.seeds) {
    const userId = idByEmail.get(s.email) ?? null;
    let requestsPending = 0, connections = 0, activated = 0;
    if (userId) {
      const q = buildSeedFunnelQuery(userId, SEED_SHELF_LAUNCH, METRICS_EXCLUDED_EMAILS);
      const row = await args.env.DB.prepare(q.sql).bind(...q.params)
        .first<{ requestsPending: number; connections: number; activated: number }>();
      requestsPending = Number(row?.requestsPending ?? 0);
      connections = Number(row?.connections ?? 0);
      activated = Number(row?.activated ?? 0);
    }
    const intent = requestsPending + connections;
    tReq += requestsPending; tConn += connections; tAct += activated;
    seeds.push({ label: s.label, email: s.email, userId, requestsPending, connections, activated, intent });
  }

  return json(200, {
    launchFloor: SEED_SHELF_LAUNCH,
    seeds,
    totals: { requestsPending: tReq, connections: tConn, activated: tAct, intent: tReq + tConn },
  });
}
```

### Step 4: Run the tests to verify they pass

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t handleAdminSeedConversions`
Expected: PASS (3 tests).

### Step 5: Run the full admin test file (no regressions)

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS (all previously-passing tests plus the 6 new ones).

### Step 6: Commit

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(metrics): handleAdminSeedConversions handler

Admin-gated funnel handler: resolves seed emails -> ids, runs the per-seed
funnel, derives intent = requestsPending + connections, sums totals. Missing
seed -> userId null + zeros.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register the route

**Files:**
- Modify: `apps/worker/src/index.ts` (next to the existing `/admin/metrics/timeseries` route, ~line 567)

### Step 1: Add the route registration

In `apps/worker/src/index.ts`, immediately after the `/admin/metrics/timeseries` block (the `if (url.pathname === '/admin/metrics/timeseries' ...)` block ending ~line 573), add:

```ts
      if (url.pathname === '/admin/metrics/seed-conversions' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const { handleAdminSeedConversions } = await import('./routes/admin');
        return await handleAdminSeedConversions({
          env, user, adminEmails: env.ADMIN_EMAILS, url, seeds: SEEDED_SUGGESTIONS,
        });
      }
```

### Step 2: Typecheck / build the worker

Run: `cd apps/worker && npx tsc --noEmit`
Expected: PASS (no type errors). If `tsc` isn't wired, run `npx wrangler deploy --dry-run --outdir /tmp/wbuild` and expect "Compiled Worker successfully".

### Step 3: Run the full worker test suite

Run: `cd apps/worker && npm test`
Expected: PASS for everything except the pre-existing, unrelated `gemini.integration.test.ts` live-API test (it hits the network and is not affected by this change).

### Step 4: Commit

```bash
git add apps/worker/src/index.ts
git commit -m "feat(metrics): register GET /admin/metrics/seed-conversions

Passes SEEDED_SUGGESTIONS in as the single source of truth (avoids a circular
import into admin.ts).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd apps/worker && npx vitest run src/routes/admin.test.ts` — all green (6 new tests).
- [ ] `cd apps/worker && npm test` — green except the pre-existing `gemini.integration.test.ts`.
- [ ] Worker compiles (`tsc --noEmit` or `wrangler deploy --dry-run`).

**Deploy is user-initiated** (worker-only change): `cd apps/worker && npx wrangler deploy`. `git status` first — deploy ships the working tree.

**Live smoke once deployed** (the dev key maps to a synthetic `dev-user`, but this route is admin-gated by email, so the dev key returns 403 — that still proves the route is wired and not a 1101). To read real numbers, call it with an admin Supabase JWT:
```bash
# Proves the route exists + is admin-gated (expect 403 with the dev key):
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $DEV_API_KEY" \
  https://recipes-worker.elisa-widjaja.workers.dev/admin/metrics/seed-conversions
# Real funnel (expect 200 + JSON): use an admin JWT for elisa.widjaja@gmail.com.
```

## Spec coverage check

- Endpoint `GET /admin/metrics/seed-conversions`, admin-gated — Task 2 (requireAdmin) + Task 3 (route).
- Funnel requestsPending → connections → activated, floored at launch — Task 1 (builder).
- Intent = requestsPending + connections, per-seed + totals — Task 2 (handler).
- Seeds from `SEEDED_SUGGESTIONS` single source of truth, no circular import — Task 3 (passed in).
- Exclude owner/test accounts via `METRICS_EXCLUDED_EMAILS` — Task 1 (filter) + Task 2 (passes the list).
- Missing seed → `userId: null` + zeros — Task 2 (handler + test).
- Activation = saved AFTER connecting — Task 1 (`recipes.created_at >= friends.connected_at`).
- Tests for builder + handler gating/shape/totals — Tasks 1 & 2.
- Out of scope (admin-ui widget, `?days=`, timeseries, Phase 2) — none added. Confirmed.
