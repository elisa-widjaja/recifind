# Admin Dashboard Growth Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signups / 24h-activation / new-saves / re-saves counters (toggleable over 1 day / 1 week / 1 month) plus a daily 30-day retention-cohort table to the admin dashboard.

**Architecture:** Extend the existing `GET /admin/metrics/timeseries` worker handler with two pure, unit-tested D1 query builders and a `growth` block in the JSON response (all three windows computed server-side in one request). The separate admin Vite app (`apps/admin-ui`) renders a client-side window toggle plus a retention table from that single fetch — no refetch on toggle.

**Tech Stack:** Cloudflare Workers + D1 (TypeScript, vitest), React + MUI + recharts (`apps/admin-ui`).

> **PROJECT RULE — commits:** This repo's owner does not auto-commit. Do NOT run any `git commit` until the user explicitly gives the go-ahead. The commit steps below are written out so they're ready, but the executor must pause and ask before running them.

---

## Spec

See `docs/superpowers/specs/2026-06-02-admin-dashboard-growth-metrics-design.md`.

## File Structure

- **Modify** `apps/worker/src/routes/admin.ts` — add `buildGrowthCountersQuery`, `buildRetentionCohortsQuery`, and a `growth` block inside `handleAdminMetricsTimeseries`.
- **Modify** `apps/worker/src/routes/admin.test.ts` — unit tests for the two builders + a handler test for the `growth` shape and percentage math.
- **Modify** `apps/admin-ui/src/pages/Dashboard.jsx` — window toggle, four stat tiles, retention table, `HELP` copy entries.

No new files, no migration, no schema change.

## Data model facts (why the SQL works)

- `recipes` PK is `(user_id, id)`, but **every recipe row has a globally unique `id`** (verified on prod: 816 ids = 816 rows). A friend saving another user's recipe gets a BRAND-NEW `id`; the `originalUserId` from the save request is NOT persisted on the row. So re-saves are NOT detectable from the recipes table (id-collision would always be 0).
- The re-save signal is in `notifications`: a re-save fires exactly one `friend_saved_your_recipe` notification whose `data` JSON holds `saverId` and `recipeId` (the saver's new copy id). A recipe row (`user_id`=saver, `id`=R) is a **re-save** iff such a notification exists with `json_extract(data,'$.recipeId')=R` AND `json_extract(data,'$.saverId')=user_id`; else it's a **new save**. (The generic `friend_saved_recipe` notification is NOT usable — it fans out one-per-friend on every public save.)
- `profiles.created_at` = signup time (ISO TEXT); exclude `deleted_at IS NOT NULL`.
- **Excluded accounts:** the owner's own / test accounts are excluded from every growth & retention metric via a `METRICS_EXCLUDED_EMAILS` constant resolved to `user_id`s in an `excluded` CTE: `elisa.widjaja@gmail.com`, `elisa_widjaja@hotmail.com`, `mochislime02@gmail.com`. The `firsts` (first-occurrence) CTE stays unfiltered so re-save classification is still correct when an excluded account was the original author.

---

### Task 1: Backend query builders (`buildGrowthCountersQuery`, `buildRetentionCohortsQuery`)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add after `buildViralCoefWeeklyQuery`, ~line 495)
- Test: `apps/worker/src/routes/admin.test.ts` (add near the existing `buildSignupsPerDayQuery` describe block, ~line 561)

- [ ] **Step 1: Write the failing tests**

Add to `apps/worker/src/routes/admin.test.ts`. First extend the existing import on line 6:

```ts
import { buildSignupsPerDayQuery, buildViralCoefWeeklyQuery, buildGrowthCountersQuery, buildRetentionCohortsQuery, METRICS_EXCLUDED_EMAILS } from './admin';
```

Then add these describe blocks after the `buildViralCoefWeeklyQuery` block (~line 561):

```ts
const EXCL = ['a@x.com', 'b@x.com', 'c@x.com'];

describe('buildGrowthCountersQuery', () => {
  it('classifies new vs re-saves via a friend_saved_your_recipe notification match and excludes accounts', () => {
    const { sql, params } = buildGrowthCountersQuery(7, EXCL);
    expect(sql).toMatch(/friend_saved_your_recipe/);
    expect(sql).toMatch(/json_extract\(n\.data, ?'\$\.recipeId'\) ?= ?r\.id/i);
    expect(sql).toMatch(/json_extract\(n\.data, ?'\$\.saverId'\) ?= ?r\.user_id/i);
    expect(sql).toMatch(/datetime\(c\.signup_at, '\+1 day'\)/i); // 24h activation
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/WITH excluded AS/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    // 3 excluded emails + saves window ? + cohort window ?
    expect(params).toHaveLength(5);
    expect(params.slice(0, 3)).toEqual(EXCL);
  });

  it('defaults to no exclusions when none provided', () => {
    const { params } = buildGrowthCountersQuery(7);
    expect(params).toHaveLength(2); // just the two window dates
  });

  it('ships a non-empty default exclusion list', () => {
    expect(METRICS_EXCLUDED_EMAILS).toContain('elisa.widjaja@gmail.com');
  });
});

describe('buildRetentionCohortsQuery', () => {
  it('groups signups by day, counts later-day returners newest first, and excludes accounts', () => {
    const { sql, params } = buildRetentionCohortsQuery(30, EXCL);
    expect(sql).toMatch(/GROUP BY c\.day/i);
    expect(sql).toMatch(/ORDER BY c\.day DESC/i);
    expect(sql).toMatch(/DATE\(r\.created_at\) > c\.day/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/WITH excluded AS/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    // 3 excluded emails + cohort window ?
    expect(params).toHaveLength(4);
    expect(params.slice(0, 3)).toEqual(EXCL);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "buildGrowthCountersQuery|buildRetentionCohortsQuery"`
Expected: FAIL — `buildGrowthCountersQuery is not a function` (not yet exported).

- [ ] **Step 3: Implement the two builders**

In `apps/worker/src/routes/admin.ts`, immediately after `buildViralCoefWeeklyQuery` (~line 495), add:

```ts
// Owner / test accounts excluded from all growth & retention metrics so the
// numbers reflect real users only.
export const METRICS_EXCLUDED_EMAILS = [
  'elisa.widjaja@gmail.com',
  'elisa_widjaja@hotmail.com',
  'mochislime02@gmail.com',
];

// Growth counters for a rolling window of `days`. Returns one row:
//   signups, activated_24h, new_saves, re_saves
// new vs re-save: every recipe id is globally unique, so re-saves can't be found
// in the recipes table. A re-save instead leaves one `friend_saved_your_recipe`
// notification whose data JSON carries the saver id + the saver's new copy id.
// A recipe row matches that notification => re-save; otherwise => new save.
// excludeEmails are resolved to user_ids via the `excluded` CTE and removed from
// every count (for re-saves the saver IS recipes.user_id, so this also drops
// re-saves performed by the owner's own accounts).
export function buildGrowthCountersQuery(days: number, excludeEmails: string[] = []): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      saves AS (
        SELECT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.type = 'friend_saved_your_recipe'
            AND json_extract(n.data, '$.recipeId') = r.id
            AND json_extract(n.data, '$.saverId') = r.user_id
        ) AS is_resave
        FROM recipes r
        WHERE r.created_at >= ?
          AND r.user_id NOT IN (SELECT user_id FROM excluded)
      ),
      cohort AS (
        SELECT user_id, created_at AS signup_at
        FROM profiles
        WHERE deleted_at IS NULL AND created_at >= ?
          AND user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT
        (SELECT COUNT(*) FROM cohort) AS signups,
        (SELECT COUNT(*) FROM cohort c
           WHERE EXISTS (
             SELECT 1 FROM recipes r
             WHERE r.user_id = c.user_id
               AND r.created_at >= c.signup_at
               AND r.created_at <= datetime(c.signup_at, '+1 day')
           )) AS activated_24h,
        (SELECT COALESCE(SUM(CASE WHEN is_resave THEN 0 ELSE 1 END), 0) FROM saves) AS new_saves,
        (SELECT COALESCE(SUM(CASE WHEN is_resave THEN 1 ELSE 0 END), 0) FROM saves) AS re_saves
    `.trim(),
    params: [...excludeEmails, since, since],
  };
}

// Daily signup cohorts over `days`, with how many returned to create a recipe on
// a LATER calendar day. Newest cohort first. Excludes the same accounts.
export function buildRetentionCohortsQuery(days: number, excludeEmails: string[] = []): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      cohort AS (
        SELECT user_id, DATE(created_at) AS day
        FROM profiles
        WHERE deleted_at IS NULL AND created_at >= ?
          AND user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT c.day AS day,
             COUNT(*) AS cohort_size,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM recipes r
               WHERE r.user_id = c.user_id AND DATE(r.created_at) > c.day
             ) THEN 1 ELSE 0 END) AS returned
      FROM cohort c
      GROUP BY c.day
      ORDER BY c.day DESC
    `.trim(),
    params: [...excludeEmails, since],
  };
}
```

Note: `excludedFilter` falls back to the literal `0` (false) when no emails are
passed, so `WITH excluded AS (SELECT user_id FROM profiles WHERE 0)` is valid SQL
that yields an empty exclusion set.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "buildGrowthCountersQuery|buildRetentionCohortsQuery"`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit** (only after user go-ahead — see project rule above)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): add growth-counter and retention-cohort D1 query builders"
```

---

### Task 2: Wire the `growth` block into the metrics handler

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` — `handleAdminMetricsTimeseries` (~lines 497-572)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing handler test**

Add to `apps/worker/src/routes/admin.test.ts` (after the `buildRetentionCohortsQuery` describe block). It stubs D1 so every `.first()` returns one growth-counter row and every `.all()` returns array results; this is order-independent and exercises the percentage math:

```ts
import { handleAdminMetricsTimeseries } from './admin';

describe('handleAdminMetricsTimeseries growth block', () => {
  it('returns three windows and a retention table with computed percentages', async () => {
    const counterRow = { signups: 33, activated_24h: 21, new_saves: 40, re_saves: 7, total_users: 33, total_recipes: 47, n: 30 };
    const arrayResult = { results: [{ day: '2026-05-28', cohort_size: 33, returned: 10 }] };
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(counterRow),
        all: vi.fn().mockResolvedValue(arrayResult),
      }),
    } as unknown as D1Database;

    const res = await handleAdminMetricsTimeseries({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/metrics/timeseries?days=90'),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.growth.windows)).toEqual(['1d', '7d', '30d']);
    const w = body.growth.windows['7d'];
    expect(w.signups).toBe(33);
    expect(w.activated_24h).toBe(21);
    expect(w.activated_pct).toBe(63.6); // round(1000*21/33)/10
    expect(w.new_saves).toBe(40);
    expect(w.re_saves).toBe(7);
    expect(body.growth.retention_cohorts[0]).toEqual({
      day: '2026-05-28', cohort_size: 33, returned: 10, returned_pct: 30.3,
    });
  });

  it('denies non-admins', async () => {
    const res = await handleAdminMetricsTimeseries({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/metrics/timeseries'),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "growth block"`
Expected: FAIL — `body.growth` is undefined (handler doesn't return it yet).

- [ ] **Step 3: Implement the growth block in the handler**

In `apps/worker/src/routes/admin.ts`, inside `handleAdminMetricsTimeseries`, AFTER the `activeApprox` query (~line 558) and BEFORE the final `return json(200, {...})`, insert:

```ts
  // Growth counters (1d / 7d / 30d) + daily retention cohorts (last 30d).
  // METRICS_EXCLUDED_EMAILS is defined in this same module (no import needed).
  const runCounters = (days: number) => {
    const q = buildGrowthCountersQuery(days, METRICS_EXCLUDED_EMAILS);
    return args.env.DB.prepare(q.sql).bind(...q.params).first();
  };
  const retQ = buildRetentionCohortsQuery(30, METRICS_EXCLUDED_EMAILS);
  const [g1, g7, g30, retention] = await Promise.all([
    runCounters(1),
    runCounters(7),
    runCounters(30),
    args.env.DB.prepare(retQ.sql).bind(...retQ.params).all(),
  ]);

  const pct = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : 0);
  const toWindow = (row: any) => {
    const signups = row?.signups ?? 0;
    const activated = row?.activated_24h ?? 0;
    return {
      signups,
      activated_24h: activated,
      activated_pct: pct(activated, signups),
      new_saves: row?.new_saves ?? 0,
      re_saves: row?.re_saves ?? 0,
    };
  };
  const retention_cohorts = ((retention.results as any[]) || []).map((r) => ({
    day: r.day,
    cohort_size: r.cohort_size,
    returned: r.returned,
    returned_pct: pct(r.returned, r.cohort_size),
  }));
```

Then add `growth` to the existing return object (after the `totals: {...}` block):

```ts
    totals: {
      total_users: (totals as any)?.total_users ?? 0,
      active_users_approx: (activeApprox as any)?.n ?? 0,
      total_recipes: (recipeTotals as any)?.total_recipes ?? 0,
      latest_viral_coef: (viral.results || []).at(-1) as any,
    },
    growth: {
      windows: { '1d': toWindow(g1), '7d': toWindow(g7), '30d': toWindow(g30) },
      retention_cohorts,
    },
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "growth block"`
Expected: PASS (2 passing).

- [ ] **Step 5: Run the full worker test suite + typecheck**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts && npx tsc --noEmit`
Expected: all admin tests PASS; `tsc` reports no errors.

- [ ] **Step 6: Commit** (only after user go-ahead)

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): return growth counters + retention cohorts from metrics endpoint"
```

---

### Task 3: Verify the SQL against real prod data (read-only sanity check)

The unit tests assert SQL shape, not real-data correctness (the harness mocks D1). This task validates the classification logic against the live database read-only. No code changes.

**Files:** none (verification only).

- [ ] **Step 1: Confirm new_saves + re_saves == total recipes created in the window**

Run (from `apps/worker`):

```bash
npx wrangler d1 execute recipes-db --remote --json --command "
WITH excluded AS (SELECT user_id FROM profiles WHERE email IN ('elisa.widjaja@gmail.com','elisa_widjaja@hotmail.com','mochislime02@gmail.com')),
saves AS (
  SELECT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.type='friend_saved_your_recipe'
      AND json_extract(n.data,'\$.recipeId')=r.id
      AND json_extract(n.data,'\$.saverId')=r.user_id
  ) AS is_resave
  FROM recipes r
  WHERE r.created_at >= datetime('now','-30 days')
    AND r.user_id NOT IN (SELECT user_id FROM excluded)
)
SELECT
  COALESCE(SUM(CASE WHEN is_resave THEN 0 ELSE 1 END),0) AS new_saves,
  COALESCE(SUM(CASE WHEN is_resave THEN 1 ELSE 0 END),0) AS re_saves,
  COUNT(*) AS total_30d_real
FROM saves;
"
```

Expected: `new_saves + re_saves == total_30d_real`, and `re_saves` equals the count of `friend_saved_your_recipe` notifications in the window by non-excluded savers (validated on prod: 4 re-saves / 200 new in the trailing 30 days).

- [ ] **Step 2: Spot-check the retention cohort matches the figure we already know**

Run:

```bash
npx wrangler d1 execute recipes-db --remote --json --command "
WITH excluded AS (SELECT user_id FROM profiles WHERE email IN ('elisa.widjaja@gmail.com','elisa_widjaja@hotmail.com','mochislime02@gmail.com')),
cohort AS (SELECT user_id, DATE(created_at) AS day FROM profiles WHERE deleted_at IS NULL AND DATE(created_at)='2026-05-28' AND user_id NOT IN (SELECT user_id FROM excluded))
SELECT c.day, COUNT(*) AS cohort_size,
  SUM(CASE WHEN EXISTS (SELECT 1 FROM recipes r WHERE r.user_id=c.user_id AND DATE(r.created_at) > c.day) THEN 1 ELSE 0 END) AS returned
FROM cohort c GROUP BY c.day;
"
```

Expected: roughly `cohort_size: 33, returned: ~10` (matches the "May 28 → 33 → 10 → ~30%" figure established during brainstorming). Small drift is fine as more data lands.

---

### Task 4: Frontend — window toggle, stat tiles, retention table

**Files:**
- Modify: `apps/admin-ui/src/pages/Dashboard.jsx`

No frontend test infra exists in `apps/admin-ui`; verification is build + manual (Task 5). Follow the file's existing `Tile` / `ChartCard` / `HELP` / `HelpIcon` patterns.

- [ ] **Step 1: Add imports and HELP copy**

In `apps/admin-ui/src/pages/Dashboard.jsx`, extend the MUI import on lines 2-5 to add `ToggleButton`, `ToggleButtonGroup`, `Table`, `TableBody`, `TableCell`, `TableHead`, `TableRow`:

```jsx
import {
  Box, Card, CardContent, CircularProgress, ClickAwayListener, Grid, IconButton, MenuItem, Select,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup,
  Tooltip as MuiTooltip, Typography,
} from '@mui/material';
```

Add to the `HELP` object (after line 19, before the closing `}`):

```jsx
  signupsWindow: 'New profiles created in the selected window (excludes soft-deleted accounts).',
  activated24h: 'Of the signups in the window, how many created at least one recipe within 24h of their own signup time. Note: people who signed up less than 24h ago are still inside their window, so this can keep rising.',
  newSaves: 'Recipes created in the window that are the first save of that recipe (a fresh import).',
  reSaves: 'Recipes created in the window that are a re-save — a user saving a recipe that already belongs to another user (same recipe id, different owner).',
  retentionCohorts: 'Each row is one signup day (last 30 days). "Came back" = how many of that day\'s signups created a recipe on a LATER calendar day.',
```

- [ ] **Step 2: Add the window toggle state**

Inside the `Dashboard` component, after `const [data, setData] = useState(null);` (line 30), add:

```jsx
  const [growthWindow, setGrowthWindow] = useState('7d');
```

- [ ] **Step 3: Render the growth section**

In the returned JSX, insert this block AFTER the totals `<Grid>` (closes at line 55) and BEFORE the first `<ChartCard title="Signups per day" ...>` (line 57). It guards on `data.growth` so an older worker response won't crash the page:

```jsx
      {data.growth && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>Growth & engagement</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={growthWindow}
                onChange={(e, v) => { if (v) setGrowthWindow(v); }}
              >
                <ToggleButton value="1d">1 day</ToggleButton>
                <ToggleButton value="7d">1 week</ToggleButton>
                <ToggleButton value="30d">1 month</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Grid container spacing={2}>
              <Tile title="Signups" value={data.growth.windows[growthWindow].signups} help={HELP.signupsWindow} />
              <Tile
                title="Activated in 24h"
                value={`${data.growth.windows[growthWindow].activated_24h} (${data.growth.windows[growthWindow].activated_pct}%)`}
                help={HELP.activated24h}
              />
              <Tile title="New saves" value={data.growth.windows[growthWindow].new_saves} help={HELP.newSaves} />
              <Tile title="Re-saves" value={data.growth.windows[growthWindow].re_saves} help={HELP.reSaves} />
            </Grid>

            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              Retention by signup day (last 30 days)
              <HelpIcon text={HELP.retentionCohorts} />
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Day</TableCell>
                  <TableCell align="right">Signed up</TableCell>
                  <TableCell align="right">Came back</TableCell>
                  <TableCell align="right">%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.growth.retention_cohorts.map((c) => (
                  <TableRow key={c.day}>
                    <TableCell>{c.day}</TableCell>
                    <TableCell align="right">{c.cohort_size}</TableCell>
                    <TableCell align="right">{c.returned}</TableCell>
                    <TableCell align="right">{c.returned_pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
```

Note: the existing `Tile` helper uses `<Grid item xs={12} sm={4}>`. With four tiles that wraps 3-then-1; this is acceptable and matches the existing responsive pattern. Do not change the `Tile` signature.

- [ ] **Step 4: Commit** (only after user go-ahead)

```bash
git add apps/admin-ui/src/pages/Dashboard.jsx
git commit -m "feat(admin-ui): growth counters toggle + retention cohort table on dashboard"
```

---

### Task 5: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Worker tests + typecheck green**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 2: Admin UI builds**

Run: `cd apps/admin-ui && npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 3: Manual smoke (optional, requires running the admin UI against a worker that has the new code)**

Start the admin UI (`cd apps/admin-ui && npm run dev`), open the dashboard, and confirm:
- The "Growth & engagement" card shows four tiles.
- Toggling 1 day / 1 week / 1 month changes the numbers with no network refetch (Network tab shows no new `/admin/metrics/timeseries` call on toggle).
- The retention table lists daily cohorts, newest first, with the May 28 row near `33 / 10 / ~30%`.

> **Deploy is a separate, user-driven step** (per project rules). The worker change must be deployed (`cd apps/worker && npx wrangler deploy`) for the dashboard to receive `growth` data, and `apps/admin-ui` must be rebuilt/redeployed however it is served. Do not deploy without the user's go-ahead.

---

## Self-Review

- **Spec coverage:** signups ✓ (Task 1/2 `signups`), activation-in-24h ✓ (`activated_24h`/`activated_pct`), new saves ✓, re-saves ✓ (notifications `friend_saved_your_recipe` classification, Task 1), 1d/7d/30d toggle ✓ (Task 2 windows + Task 4 toggle), daily 30-day retention cohorts always-on ✓ (Task 1 builder + Task 4 table), excluded accounts ✓ (`METRICS_EXCLUDED_EMAILS` + `excluded` CTE in both builders, Task 1/2; verification filters in Task 3). No schema change ✓. Out-of-scope items (no migration, no per-cohort window filter, no changes to existing blocks) respected ✓.
- **Type consistency:** builder names `buildGrowthCountersQuery` / `buildRetentionCohortsQuery`, response keys `growth.windows['1d'|'7d'|'30d']` with fields `signups,activated_24h,activated_pct,new_saves,re_saves`, and `growth.retention_cohorts[].{day,cohort_size,returned,returned_pct}` are used identically in tests, handler, and frontend.
- **Placeholder scan:** no TBD/TODO; every code step shows full code; every run step has an expected result.
