# Admin Dashboard Growth Metrics — Design

Date: 2026-06-02

## Goal

Add growth and engagement metrics to the existing admin dashboard so the
operator can see, at a glance:

- How many users signed up
- How many of those actually saved a recipe within 24h of signing up (activation)
- How many recipes were newly saved (fresh imports)
- How many recipes were re-saved (a friend saving another user's recipe)
- Per-signup-day retention cohorts (how many of each day's signups came back to
  create a recipe on a later day), e.g. "May 28: 33 signed up, 10 came back, 30%"

The counter metrics are viewable over a toggleable window: **1 day / 1 week /
1 month**. The retention cohort table is always shown as daily cohorts for the
last 30 days.

## Context / current state

- `GET /admin/metrics/timeseries` already exists
  (`apps/worker/src/routes/admin.ts`, `handleAdminMetricsTimeseries`) and
  returns `signups_per_day`, `viral_coef_weekly`, `activation_curve`,
  `loop_completion`, and `totals`. Admin auth is enforced via `requireAdmin`.
- The admin dashboard UI lives in a separate Vite app:
  `apps/admin-ui/src/pages/Dashboard.jsx`. It fetches
  `/admin/metrics/timeseries?days=${days}` via `fetchAdmin` (`src/api.js`) and
  renders `Tile`, `ChartCard`, and `HelpIcon` helper components plus a `HELP`
  copy map. There is no frontend test infra in `apps/admin-ui` (no vitest), so
  presentational wiring is verified by build + manual check, matching the
  existing pattern.
- Query-builder functions (`buildSignupsPerDayQuery`, etc.) are pure and
  unit-tested; new work follows that pattern.

### Data model facts that drive the metric definitions

- `recipes` PK is `(user_id, id)`, but in practice **every recipe row has a
  globally unique `id`** (verified on prod: 816 ids = 816 rows). When a friend
  saves another user's recipe the copy gets a BRAND-NEW `id`; the save request
  carries `originalUserId` but it is NOT persisted on the recipe row. So re-saves
  are NOT detectable from the recipes table alone (an id-collision approach would
  always report 0).
- The re-save signal lives in the `notifications` table: a re-save fires exactly
  one `friend_saved_your_recipe` notification (created only when the save carries
  an `originalUserId` different from the saver — a genuine "friend saved another
  user's recipe"). Its `data` JSON holds `saverId` and `recipeId` (the saver's
  new copy id). So a recipe row (`user_id` = saver, `id` = R) is a **re-save**
  iff a `friend_saved_your_recipe` notification exists with
  `json_extract(data,'$.recipeId') = R` AND `json_extract(data,'$.saverId') =
  user_id`; otherwise it is a **new save**. This needs no schema change and works
  on historical + current data. (The generic `friend_saved_recipe` notification
  is NOT usable — it fans out one-per-friend on every public save including fresh
  imports.)
- `profiles.created_at` (TEXT, ISO) = signup time. `deleted_at` marks
  soft-deleted users and must be excluded.
- `recipes.created_at` (TEXT, ISO) = save/import time.

## Excluded accounts

The owner's own / test accounts are excluded from ALL growth and retention
metrics so the numbers reflect real users only:

- `elisa.widjaja@gmail.com`
- `elisa_widjaja@hotmail.com`
- `mochislime02@gmail.com`

Defined once as `METRICS_EXCLUDED_EMAILS` in `admin.ts` and passed into both
query builders. Each builder resolves these emails to `user_id`s via an
`excluded` CTE (`SELECT user_id FROM profiles WHERE email IN (...)`) and filters
them out of signups, activation, new/re-saves, and retention cohorts (re-saves
are filtered by saver = `recipes.user_id`). This affects only the new `growth`
block; the pre-existing `totals` / `activation_curve` / `loop_completion` blocks
are unchanged.

## Metric definitions

For a window of `N` days (`since = now - N days`), all counts exclude the
accounts above:

- **signups** — `COUNT(*)` of `profiles` with `created_at >= since` and
  `deleted_at IS NULL`.
- **activated_24h** — of those signups, the count who created at least one
  recipe within 24h of their own signup time
  (`recipes.created_at` between `signup_at` and `signup_at + 1 day`).
  - `activated_pct` = `activated_24h / signups`.
  - Caveat: users who signed up less than 24h ago have an incomplete window, so
    this number can still rise. The UI notes this.
- **re_saves** — recipe rows with `created_at >= since` (excluded savers removed)
  that match a `friend_saved_your_recipe` notification on (recipeId, saverId) as
  described in the data-model facts. Filtering on `recipes.user_id NOT IN
  excluded` already drops re-saves performed by the owner's own accounts (the
  saver is the actor).
- **new_saves** — recipe rows with `created_at >= since` (excluded savers
  removed) that do NOT match such a notification. By construction, new_saves +
  re_saves = total recipe rows created in the window by non-excluded users.

Retention cohorts (always last 30 days, daily, newest first):

- For each signup day (`DATE(profiles.created_at)`):
  - **cohort_size** — users who signed up that day (excluding soft-deleted).
  - **returned** — of those, how many created a recipe on a *later* calendar day
    (`DATE(recipes.created_at) > DATE(signup)`).
  - **returned_pct** — `returned / cohort_size`.

## Approach

Single endpoint call; compute all three windows server-side and toggle
client-side (no refetch). Queries are tiny (~93 profiles, ~814 recipes), so
computing 1d/7d/30d together is cheap and gives an instant toggle. This is also
friendlier to D1 free-tier read pressure than refetching per toggle.

## Backend changes

File: `apps/worker/src/routes/admin.ts`

Extend `handleAdminMetricsTimeseries` to add a `growth` object to the JSON
response. Define `METRICS_EXCLUDED_EMAILS` (the three owner/test accounts) and
pass it into both builders, which filter via an `excluded` CTE. Add two pure,
unit-testable query builders following the existing pattern:

- `buildGrowthCountersQuery(days, excludeEmails): BuiltQuery` — returns one row
  with `signups`, `activated_24h`, `new_saves`, `re_saves` for the given window.
  A `saves` CTE classifies each in-window recipe row via a correlated `EXISTS`
  against `notifications` (`type='friend_saved_your_recipe'` matched on
  `json_extract(data,'$.recipeId')=r.id` AND `json_extract(data,'$.saverId')=
  r.user_id`): match = re-save, no match = new save. A second correlated `EXISTS`
  against `recipes` computes `activated_24h`.
- `buildRetentionCohortsQuery(days: number): BuiltQuery` — returns one row per
  signup day with `day`, `cohort_size`, `returned`, `returned_pct`.

The handler runs `buildGrowthCountersQuery` for 1, 7, and 30 days plus
`buildRetentionCohortsQuery(30)`, then adds to the response:

```jsonc
growth: {
  windows: {
    "1d":  { signups, activated_24h, activated_pct, new_saves, re_saves },
    "7d":  { ...same... },
    "30d": { ...same... }
  },
  retention_cohorts: [
    { day: "2026-05-28", cohort_size: 33, returned: 10, returned_pct: 30.3 }
  ]
}
```

`activated_pct` and `returned_pct` are computed in JS from the raw counts (round
to 1 decimal) to keep the SQL simple. No new route, no new migration.

## Frontend changes

File: `apps/admin-ui/src/pages/Dashboard.jsx`

The new growth block reads from the single `data` object already fetched on
mount; its window toggle is local state and does NOT depend on the existing
`days` range Select (which only drives the charts).

- Add a **1 day / 1 week / 1 month** `ToggleButtonGroup` (default 1 week).
- Below it, a row of stat tiles bound to the selected window:
  **Signups**, **Activated in 24h** (value + `activated_pct`),
  **New saves**, **Re-saves**.
  - Small helper text under "Activated in 24h": "recent signups may still be
    inside their 24h window."
- A **Retention by signup day** table (always last 30 days, newest first):
  columns Day | Signed up | Came back | %.
- The toggle only switches which `growth.windows` key is rendered; the data is
  already in hand from the single fetch, so no refetch occurs.

## Testing

- vitest unit tests for `buildGrowthCountersQuery` and
  `buildRetentionCohortsQuery` (SQL shape + params).
- A classification test: seed two `recipes` rows sharing an `id` under different
  `user_id`s, run the counters logic, assert exactly one new save and one
  re-save; seed two rows with distinct `id`s, assert two new saves and zero
  re-saves.
- Activation test: a profile plus a recipe created within 24h counts as
  activated; one created 25h+ later does not.

## Out of scope

- No schema change (re-save is derived, not stored).
- No per-cohort window filter (cohort table is fixed at last 30 days, daily).
- No changes to existing `totals` / `activation_curve` / `loop_completion`
  blocks.
