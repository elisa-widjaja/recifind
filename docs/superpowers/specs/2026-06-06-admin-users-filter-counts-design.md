# Admin Users page: global filter counts

**Date:** 2026-06-06
**Status:** Approved, ready for plan

## Problem

The admin dashboard Users page (`apps/admin-ui/src/pages/Users.jsx`) has four filter
controls (search, Recipes bucket, Activity, Signed-up window) but shows no totals. The
list is server-side and paginated, so an admin can't see how big the user base is or how
it's distributed across buckets without clicking each filter and counting pages.

## Goal

Show, at a glance:
- **All users** — the total non-deleted user count.
- A count for **every filter option** in each dropdown (e.g. `Active (212)`, `0 (430)`,
  `Last 7d (40)`), so the distribution of the user base is visible without selecting
  anything.

Counts are **global**: each option's count reflects all users in that bucket, independent
of the other filters currently applied. (Decided over cross-filtered: global answers "how
is my user base distributed", is stable as filters flip, and is far cheaper.)

## Approach

Mirror the existing `admin_user_stats` denormalization pattern so the dashboard does zero
per-load aggregation.

### Backend (`apps/worker/src/routes/admin.ts` + `index.ts`)

1. **`computeUserCounts(env)`** — a single SQL aggregate over
   `profiles p LEFT JOIN admin_user_stats s`, reusing the existing `IS_ACTIVE_EXPR`,
   `GHOST_EXPR`, and `RECIPE_BUCKETS` expressions via `SUM(CASE WHEN … THEN 1 ELSE 0 END)`.
   Returns an object:
   ```jsonc
   {
     "total": 1240,            // non-deleted profiles = "All users"
     "recipes": { "0": 430, "1-9": 220, "10-19": 90, "20-49": 40, "50+": 8 },
     "activity": { "active": 212, "inactive": 98, "ghost": 430, "soft_deleted": 12 },
     "signup":   { "1": 5, "7": 40, "30": 160, "90": 380 },
     "computed_at": "2026-06-06T12:00:00.000Z"
   }
   ```
   - `total` counts non-deleted profiles only (`p.deleted_at IS NULL`).
   - Recipe-bucket, activity (`active`/`inactive`/`ghost`), and signup tallies are computed
     over non-deleted profiles, so `recipes` and `signup` each sum to ≤ `total` and the
     "All …" labels for Recipes/Activity/Signed-up all equal `total`.
   - `soft_deleted` counts `p.deleted_at IS NOT NULL` (the one bucket outside `total`).
   - Signup windows use `julianday(p.created_at) >= julianday('now','-N days')`; activity
     reuses the 30-day sign-in window already in `IS_ACTIVE_EXPR`. Computed at sync time,
     so windows are at most ~1h stale.

2. **Hook into the hourly cron** — `syncAdminUserStats()` already runs hourly. After it
   upserts `admin_user_stats`, it calls `computeUserCounts` and writes the JSON to KV key
   `admin:user-counts:v1`. One KV put/hour. No migration needed.

3. **`GET /admin/users/counts`** — admin-gated (same `requireAdmin` guard as
   `/admin/users`). Reads the KV key and returns it. If the key is empty (cron hasn't run
   yet, e.g. fresh deploy), compute once on-demand, cache to KV, and return. One KV read
   per dashboard load; no full-table scan on the hot path.

### Frontend (`apps/admin-ui/src/pages/Users.jsx`)

1. Fetch `/admin/users/counts` once on mount in its own effect (global counts don't change
   when filters flip, so this is independent of the paginated-list effect). Store in a
   `counts` state object; default to `null`.
2. **Header line** under the "Users" title:
   `All users: 1,240` with `soft-deleted: 12` shown alongside. Numbers via
   `Number.toLocaleString()`.
3. **Append counts to dropdown option labels.** Each of `RECIPE_BUCKETS`,
   `ACTIVITY_OPTIONS`, `SIGNUP_OPTIONS` renders `label (count)`:
   - `All …` options show `total`.
   - Each specific option shows its bucket count keyed by the option's existing `v` value
     (e.g. recipe `v: '1-9'` → `counts.recipes['1-9']`; activity `v: 'active'` →
     `counts.activity.active`; signup `v: '7'` → `counts.signup['7']`).
   - If `counts` is still `null` (not yet loaded), render labels with **no** suffix —
     graceful, no layout jump beyond the appended text.
   - The selected value still binds on `v`, unchanged; only the displayed label text gains
     the count suffix.

## Out of scope (YAGNI)

- Cross-filtered / faceted counts.
- Counts that react to the free-text search box.
- A manual "refresh counts" button (hourly staleness is acceptable for an admin view).

## Testing

- **Worker vitest:** unit-test the new count-query builder. Seed an in-memory D1 with a
  handful of profiles + `admin_user_stats` rows spanning each recipe bucket, each activity
  state (active / inactive / ghost / soft-deleted), and each signup window; assert every
  tally and that `total` excludes soft-deleted. Sits alongside the existing
  `buildUsersListQuery` tests.
- Confirm the KV read/compute-fallback path in `GET /admin/users/counts` returns the same
  shape whether served from cache or computed on-demand.

## Files touched

- `apps/worker/src/routes/admin.ts` — `computeUserCounts`, count-query builder, cron hook.
- `apps/worker/src/index.ts` — route registration for `GET /admin/users/counts`.
- `apps/admin-ui/src/pages/Users.jsx` — counts fetch, header line, label suffixes.
- Worker test file — count-query builder unit test.
