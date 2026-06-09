# Seed-shelf Conversion Funnel Metric — Design

Date: 2026-06-09
Status: APPROVED design. Next step: writing-plans -> implementation.

## Goal

Measure whether the seeded "Suggested friends" shelf (founder + top contributor,
shipped 2026-06-08) actually converts cold-start users. This is the decision gate
for whether to build Phase 2 (founder-initiated concierge requests): we are
currently flying blind on whether the passive shelf does anything. Output a 3-step
funnel per seed so leaks are visible (no taps / taps-but-no-accept / connects-but-
no-save).

## Background / grounding

- Seed accounts are defined by `SEEDED_SUGGESTIONS` in `apps/worker/src/index.ts`
  (`elisa.widjaja@gmail.com` -> "ReciFriend Founder", `mochislime02@gmail.com` ->
  "Top contributor"). Single source of truth; the metric must read from it, not a
  copy, so adding a 3rd seed later is automatically reflected.
- Tapping "Add Friend" on a shelf card sends a normal friend request, inserting a
  row into `friend_requests` (`to_user_id`, `from_user_id`, `status`, `created_at`).
- An accepted connection inserts bidirectional rows into `friends`
  (`user_id`, `friend_id`, ..., `connected_at`).
- Existing admin metrics live in `apps/worker/src/routes/admin.ts`, surfaced via
  admin-gated routes registered in `index.ts` (e.g. `GET /admin/metrics/timeseries`
  -> `handleAdminMetricsTimeseries`). They follow a testable `build*Query` ->
  `{ sql, params }` pattern and resolve owner/test accounts via
  `METRICS_EXCLUDED_EMAILS` (a `profiles WHERE email IN (...)` CTE).

## Decisions (locked in brainstorm)

1. **Depth = full funnel** (requests -> connections -> activated-after), per seed and
   as a total. Not intent-only, not connections-only.
2. **Surface = standalone admin JSON endpoint** `GET /admin/metrics/seed-conversions`.
   No `apps/admin-ui` change yet; promote to a dashboard widget later if the numbers
   warrant it.
3. **Window = since-launch, fixed floor.** A single editable constant
   `SEED_SHELF_LAUNCH = '2026-06-08'` (worker ship date = earliest a seed connection
   could be shelf-driven; anything earlier is the seeds' pre-existing real
   friendships). Bumpable later to an iOS-approval date for a "clean iOS-era" window.
   No `?days=` param for now.
3a. **iOS note (context, not a requirement):** the worker serves seed cards to all
   clients as of 2026-06-08, but the correct frontend rendering (labels + "Suggested
   friends" title) only exists in builds cut after the seed commits. Build 30 (in
   review) predates them, so early iOS taps render degraded labels yet still send
   real requests. This is why the floor starts at the worker date (capture early web
   + degraded-iOS signal now), not the later iOS-approval date.

## Architecture

### Route (index.ts)
Register `GET /admin/metrics/seed-conversions`. Mirror the existing timeseries route:
require an authenticated `user`, dynamic-import the handler, and pass the seed config
in so the metric stays a single source of truth without a circular import
(admin.ts must NOT statically import from index.ts):

```ts
if (url.pathname === '/admin/metrics/seed-conversions' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Missing Authorization header');
  const { handleAdminSeedConversions } = await import('./routes/admin');
  return await handleAdminSeedConversions({
    env, user, adminEmails: env.ADMIN_EMAILS, url, seeds: SEEDED_SUGGESTIONS,
  });
}
```

### Handler (admin.ts) — `handleAdminSeedConversions(ctx)`
1. `requireAdmin(ctx)` guard (same gating as other admin metrics; non-admin -> 401/403).
2. Resolve seed emails -> user ids:
   `SELECT user_id, email FROM profiles WHERE email IN (<seed emails>)`.
   Build an email -> user_id map.
3. For each entry in `seeds` (preserving order, so founder first): if a user_id was
   resolved, run `buildSeedFunnelQuery(userId, SEED_SHELF_LAUNCH, METRICS_EXCLUDED_EMAILS)`
   and read `{ requests, connections, activated }`; otherwise emit zeros with
   `userId: null`.
4. Sum the three counts into `totals`.
5. `return json({ launchFloor: SEED_SHELF_LAUNCH, seeds: [...], totals }, 200, withCors())`.

### Query builder (admin.ts) — `buildSeedFunnelQuery(seedUserId, launchIso, excludeEmails)`
Returns `{ sql, params }`. One query per seed, three correlated COUNT subqueries so a
single round trip yields the whole funnel. The exclusion filter drops requesters /
connectors whose email is in `excludeEmails` (owner/test accounts), reusing the
established `email IN (...)` -> `user_id` subselect; when `excludeEmails` is empty the
filter degrades to a constant-false (`0`) like the other builders.

```sql
SELECT
  (SELECT COUNT(*) FROM friend_requests fr
     WHERE fr.to_user_id = ? AND fr.created_at >= ?
       AND fr.from_user_id NOT IN (SELECT user_id FROM profiles WHERE <excludedFilter>)
  ) AS requests,
  (SELECT COUNT(*) FROM friends f
     WHERE f.friend_id = ? AND f.connected_at >= ?
       AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE <excludedFilter>)
  ) AS connections,
  (SELECT COUNT(*) FROM friends f
     WHERE f.friend_id = ? AND f.connected_at >= ?
       AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE <excludedFilter>)
       AND EXISTS (SELECT 1 FROM recipes r
                   WHERE r.user_id = f.user_id AND r.created_at >= f.connected_at)
  ) AS activated
```

`params` order: for each of the three subqueries, `[seedUserId, launchIso,
...excludeEmails]` (D1 placeholders are positional and cannot be reused, so seedId +
launch are bound once per subquery).

**Timestamp comparison:** `created_at` / `connected_at` are ISO-8601 strings, so
lexical `>= '2026-06-08'` correctly includes 2026-06-08 onward. The plan MUST verify
this column format against the schema before relying on it; if any are stored as
epoch integers, convert the floor accordingly.

**Activation definition:** a connector counts as "activated" if they saved >= 1
recipe AFTER connecting to the seed (`recipes.created_at >= friends.connected_at`).
This is the causal signal (the connection warmed them), not "saved ever".

## Output shape

```json
{
  "launchFloor": "2026-06-08",
  "seeds": [
    { "label": "ReciFriend Founder", "email": "elisa.widjaja@gmail.com",
      "userId": "8e4dfd5e-...", "requests": 12, "connections": 9, "activated": 4 },
    { "label": "Top contributor", "email": "mochislime02@gmail.com",
      "userId": "dfa74750-...", "requests": 5, "connections": 3, "activated": 1 }
  ],
  "totals": { "requests": 17, "connections": 12, "activated": 5 }
}
```

Read as a funnel: requests -> connections -> activated, per seed and overall.

## Edge cases

- Seed email not in `profiles` -> that seed reports `userId: null` and zero counts; no
  crash, no query run for it.
- A pending (unaccepted) request shows in `requests` but not `connections` — the
  intended funnel leak.
- `friends` stores bidirectional rows; counting `friend_id = <seed>` counts each real
  connector once (the real-user-side row), not double.
- D1 cost: 1 resolve query + 1 funnel query per seed (3 total today). All indexed
  COUNTs, no `list()` ops; negligible against free-tier quotas.

## Testing

Unit tests in `apps/worker/src/routes/admin.test.ts` (existing mock-D1 pattern):
- `buildSeedFunnelQuery`: SQL contains all three subqueries; floors each on the launch
  param; binds seed id + launch per subquery; applies the `excludeEmails` NOT IN
  filter; the activated subquery joins `recipes.created_at >= friends.connected_at`.
- `buildSeedFunnelQuery` with empty `excludeEmails`: filter degrades to constant-false,
  params contain no email binds.
- `handleAdminSeedConversions`: non-admin caller is rejected (401/403); an admin
  caller with mocked rows returns the `{ launchFloor, seeds, totals }` shape with
  correct totals summed across seeds, and a missing-seed reports `userId: null` + zeros.

## Out of scope

- Any `apps/admin-ui` dashboard widget (promote later if numbers warrant).
- `?days=` rolling window param.
- Per-day timeseries (single snapshot only).
- Phase 2 founder-initiated requests (separate track).
- Counting taps that never created a `friend_requests` row (the request row IS the
  intent signal).

## Relevant files

- `apps/worker/src/index.ts` — route registration; `SEEDED_SUGGESTIONS` source of truth.
- `apps/worker/src/routes/admin.ts` — `SEED_SHELF_LAUNCH`, `buildSeedFunnelQuery`,
  `handleAdminSeedConversions`, `METRICS_EXCLUDED_EMAILS`, `requireAdmin`,
  `handleAdminMetricsTimeseries` (pattern reference).
- `apps/worker/src/routes/admin.test.ts` — tests.
- `apps/worker/migrations/0001_init.sql` — `friends`, `friend_requests`, `recipes`
  schema (verify timestamp column formats here).
