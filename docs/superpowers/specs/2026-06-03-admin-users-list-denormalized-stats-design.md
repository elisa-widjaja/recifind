# Admin Users List — Denormalized Stats Design

Date: 2026-06-03

## Goal

Make the admin Users tab cheap to load by removing the two per-page-load costs:

1. An N+1 fan-out to Supabase Auth (one HTTP call per user) to fetch
   `last_sign_in_at`.
2. A heavy D1 grouped join (`profiles LEFT JOIN recipes LEFT JOIN
   friend_requests_sent LEFT JOIN friends` + `GROUP BY` with `LIMIT/OFFSET`
   applied after aggregation) — the single largest contributor to D1 read usage.

Also fix a correctness bug: the `activity` filter is currently applied in JS
*after* pagination, so an "Active" filter returns at most one page's worth and
`has_more` is computed pre-filter, making pages inconsistent.

The Users table must render the same columns it does today, and drill-down to a
single user must continue to work (with precise, live data).

## Current state

- Frontend `apps/admin-ui/src/pages/Users.jsx` already paginates (50/page, Prev/
  Next). Rendering is not the bottleneck; the data fetch is.
- `apps/worker/src/routes/admin.ts`:
  - `buildUsersListQuery` — the grouped-join query (cost #2).
  - `handleAdminUsersList` — runs the query, then `enrichWithLastSignIn`
    (cost #1), then `filterByActivity` (the post-pagination bug).
  - `computeIsActive` / `classifyActivity` / `filterByActivity` — JS activity
    semantics to be ported into SQL (see below).
  - `handleAdminUserDrilldown` — separate endpoint, unaffected by this change.
- An hourly cron already exists: `scheduled()` in `apps/worker/src/index.ts`
  (`0 * * * *`), currently only sending nudge emails.
- `collection_meta(user_id, count, ...)` exists but is delta-maintained, so it
  can drift; this design recomputes counts authoritatively instead of trusting
  it.
- D1 migrations are applied MANUALLY on prod (no `d1_migrations` table); ship
  idempotent SQL via `wrangler d1 execute --remote`.

## Approach (chosen)

Periodic denormalization. A small admin-only table `admin_user_stats` holds the
expensive-to-compute fields. The existing hourly cron recomputes it. The Users
list reads it via a cheap PK join, so the read path does no aggregation and no
Supabase calls. List data is up to ~1 hour stale; drill-down fetches the live
value for the single user.

## Schema

New table (idempotent; applied manually on prod + committed as a migration file):

```sql
CREATE TABLE IF NOT EXISTS admin_user_stats (
  user_id          TEXT PRIMARY KEY,
  recipe_count     INTEGER NOT NULL DEFAULT 0,
  friends_count    INTEGER NOT NULL DEFAULT 0,
  last_sign_in_at  TEXT,
  synced_at        TEXT NOT NULL
);
```

Migration file: `apps/worker/migrations/0019_admin_user_stats.sql`.

## Sync job

`syncAdminUserStats(env): Promise<{ users: number }>` in
`apps/worker/src/routes/admin.ts`, invoked from `scheduled()` in `index.ts`
(wrapped in try/catch so a sync failure never breaks the nudge-email job).

Steps:
1. `recipeCounts`: `SELECT user_id, COUNT(*) AS n FROM recipes GROUP BY user_id`
   → `Map<user_id, n>`.
2. `friendCounts`: `SELECT user_id, COUNT(DISTINCT friend_id) AS n FROM friends
   GROUP BY user_id` → `Map<user_id, n>`.
3. `lastSignIn`: page through Supabase `GET /auth/v1/admin/users?page=N&
   per_page=1000` until a short/empty page, building `Map<user_id,
   last_sign_in_at>`. (Helper `fetchAllSupabaseLastSignIn(env)`.)
4. Upsert one row per profile `user_id` (source of truth for who exists):
   `INSERT OR REPLACE INTO admin_user_stats(user_id, recipe_count,
   friends_count, last_sign_in_at, synced_at) VALUES (?,?,?,?,?)`, defaulting
   counts to 0 and `last_sign_in_at` to the map value (or NULL). Use
   `env.DB.batch()` for the upserts.

Bounded cost: two aggregate scans + a few Supabase pages + N upserts per hour.

Scaling caveat (documented, not solved now): upserting every user hourly is fine
at ~100 users; well before ~10k users this should switch to upserting only
changed rows or syncing less frequently. Flagged in code comment + this spec.

## List query rewrite (`buildUsersListQuery`)

```sql
SELECT
  p.user_id      AS id,
  p.email        AS email,
  p.display_name AS display_name,
  p.created_at   AS signed_up_at,
  p.deleted_at   AS deleted_at,
  COALESCE(s.recipe_count, 0)  AS recipe_count,
  COALESCE(s.friends_count, 0) AS invites_accepted,
  s.last_sign_in_at            AS last_sign_in_at,
  CASE WHEN <isActiveExpr> THEN 1 ELSE 0 END AS is_active
FROM profiles p
LEFT JOIN admin_user_stats s ON s.user_id = p.user_id
WHERE <filters>
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?
```

No GROUP BY, no recipes join, `invites_sent` dropped (was never displayed).

Time-safe expressions (use `julianday()` so ISO `…T…Z` values compare correctly
against `'now'`, which `datetime('now')` formats without the `T`/`Z`):

- `isActiveExpr` =
  `p.deleted_at IS NULL AND COALESCE(s.recipe_count,0) >= 1
   AND s.last_sign_in_at IS NOT NULL
   AND julianday(s.last_sign_in_at) >= julianday('now','-30 days')`
- `cameBackExpr` =
  `julianday(COALESCE(s.last_sign_in_at, p.created_at)) - julianday(p.created_at) > (5.0/1440.0)`
  (5 minutes in days — the existing GHOST_WINDOW)

Filters (WHERE), faithfully porting `classifyActivity`:
- base: `p.deleted_at IS NULL` (or `IS NOT NULL` when `activity='soft_deleted'`)
- `search`: `(p.email LIKE ? OR p.display_name LIKE ?)`
- `signupAfter` / `signupBefore`: `p.created_at >= ?` / `<= ?`
- `recipeBucket`: `COALESCE(s.recipe_count,0)` `=0` / `BETWEEN 1 AND 9` / `10..19`
  / `20..49` / `>=50`
- `activity`:
  - `active`   → `<isActiveExpr>`
  - `ghost`    → `COALESCE(s.recipe_count,0) = 0 AND NOT (<cameBackExpr>)`
  - `inactive` → `NOT (<isActiveExpr>) AND NOT (COALESCE(s.recipe_count,0) = 0
                 AND NOT (<cameBackExpr>))`
  - `soft_deleted` → handled by the base `deleted_at IS NOT NULL`

Because filtering happens in SQL before `LIMIT`, `has_more` becomes accurate:
fetch `LIMIT+1`-style or compare returned count to `limit` (returned == limit ⇒
maybe more). Keep the existing `returned == limit` heuristic, now correct since
no post-filtering shrinks the page.

## Handler changes (`handleAdminUsersList`)

- Remove the `enrichWithLastSignIn` call and the `filterByActivity` call.
- Pass `activity` into `buildUsersListQuery` (so it builds the SQL filter).
- Return rows directly: each already has `recipe_count`, `invites_accepted`,
  `last_sign_in_at`, `is_active`.
- `enrichWithLastSignIn`, `computeIsActive`, `classifyActivity`,
  `filterByActivity` become dead for the list path. Remove `enrichWithLastSignIn`
  and `filterByActivity`. Keep nothing unused.

## Drill-down (`handleAdminUserDrilldown`)

Unchanged in structure; still works. Add a single live `last_sign_in_at` fetch
for the one drilled-in user (`GET /auth/v1/admin/users/{id}`) so the detail view
shows the precise, current value rather than the synced one. One call for one
user is cheap. Include it in the drilldown JSON (e.g. `profile.last_sign_in_at`).

## Frontend

No change required. `apps/admin-ui/src/pages/Users.jsx` already consumes
`recipe_count`, `invites_accepted`, `last_sign_in_at`, `is_active`, and the
`page.has_more` flag — all still present. (The drill-down page may optionally
surface the now-available live `last_sign_in_at`; out of scope here.)

## Testing (vitest, worker)

- `buildUsersListQuery`:
  - joins `admin_user_stats`, has no `GROUP BY`, no `recipes` join, no
    `invites_sent`.
  - `recipeBucket` adds the right `COALESCE(s.recipe_count,0)` range to WHERE.
  - each `activity` value adds the expected clause; `julianday` used for the
    30-day and 5-min comparisons.
  - param order/length for representative filter combinations.
- `syncAdminUserStats`: mock D1 (count aggregates) + mock Supabase pages; assert
  it upserts one row per profile with the merged counts + last_sign_in, and that
  a Supabase failure is swallowed (job still completes / counts still written).
- `handleAdminUsersList`: mock D1 returns joined rows; assert no Supabase calls
  are made and the response shape (users + accurate `page.has_more`).
- Drill-down: existing tests still pass; add one asserting the live
  `last_sign_in_at` fetch result is surfaced.

## Rollout

1. Create the table on prod (idempotent `CREATE TABLE IF NOT EXISTS` via
   `wrangler d1 execute --remote`).
2. Deploy the worker (sync wired into cron + new list query). The list shows
   zeros/NULLs until the first sync runs.
3. Run one sync immediately (either wait for the top of the hour or trigger via a
   one-off `wrangler d1 execute` backfill running the same upserts) so the list
   is populated right away.

## Out of scope

- Frontend changes (the table already renders these fields).
- Keyset pagination (OFFSET is fine at this scale).
- Throttled/changed-row-only sync (flagged for when the user base grows).
- Reconciling `collection_meta` drift (this design bypasses it for the admin
  view).
