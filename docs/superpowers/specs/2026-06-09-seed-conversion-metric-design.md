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
  row into `friend_requests` (`to_user_id`, `from_user_id`, `status`, `created_at`)
  and `friend_requests_sent`.
- An accepted connection inserts bidirectional rows into `friends`
  (`user_id`, `friend_id`, ..., `connected_at`).
- **CRITICAL — request rows are deleted on resolution.** Accept, decline, AND cancel
  all `DELETE` the `friend_requests` and `friend_requests_sent` rows
  (index.ts ~3785/3827/3839). So neither table retains a record of a *resolved*
  request. There is NO durable "total requests ever sent" count:
  - A request still awaiting acceptance lives in `friend_requests` (status pending).
  - An accepted request lives only in `friends` (the `friend_requests` row is gone).
  - A declined/cancelled request leaves no trace anywhere.
  - **EXCEPTION — admin force-accept:** `handleAdminForceAccept` (admin.ts ~1077)
    does `UPDATE friend_requests SET status = 'accepted'` instead of deleting, so an
    accepted row can persist in `friend_requests` with `status = 'accepted'`.
    Therefore the `requestsPending` count MUST filter `status = 'pending'`, or a
    force-accepted request would be double-counted (in both requestsPending AND
    connections).
- Because the seed accounts are owner-controlled and Phase 1 has **no auto-accept**,
  a request to a seed is in practice either **pending** (owner has not yet accepted on
  that account) or **accepted** (`friends`); declines do not occur. So measurable
  intent = pending + connections. Both are queryable.
- All timestamp columns (`friend_requests.created_at`, `friends.connected_at`,
  `recipes.created_at`) are `TEXT NOT NULL` ISO-8601 strings (verified in 0001_init),
  so a lexical `>= '2026-06-08'` floor is valid.
- Existing admin metrics live in `apps/worker/src/routes/admin.ts`, surfaced via
  admin-gated routes registered in `index.ts` (e.g. `GET /admin/metrics/timeseries`
  -> `handleAdminMetricsTimeseries`). They follow a testable `build*Query` ->
  `{ sql, params }` pattern and resolve owner/test accounts via
  `METRICS_EXCLUDED_EMAILS` (a `profiles WHERE email IN (...)` CTE).

## Decisions (locked in brainstorm)

1. **Depth = full funnel**, per seed and as a total. Because resolved request rows are
   deleted (see Background), the three measurable numbers are
   **requestsPending -> connections -> activated**, where intent is read as
   `requestsPending + connections`. Not intent-only, not connections-only.
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
   and read `{ requestsPending, connections, activated }`; otherwise emit zeros with
   `userId: null`. Derive `intent = requestsPending + connections` per seed.
4. Sum `requestsPending`, `connections`, `activated` (and `intent`) into `totals`.
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
     WHERE fr.to_user_id = ? AND fr.created_at >= ? AND fr.status = 'pending'
       AND fr.from_user_id NOT IN (SELECT user_id FROM profiles WHERE <excludedFilter>)
  ) AS requestsPending,
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

- **requestsPending** = requests to the seed still awaiting acceptance (resolved
  requests are deleted, so this is the live pending set, floored at launch).
- **connections** = accepted connections to the seed.
- **activated** = of those connectors, how many saved >= 1 recipe AFTER connecting
  (`recipes.created_at >= friends.connected_at`) — the causal "the connection warmed
  them" signal, not "saved ever".
- Intent is derived in the handler as `requestsPending + connections`.

`params` order: for each of the three subqueries, `[seedUserId, launchIso,
...excludeEmails]` (D1 placeholders are positional and cannot be reused, so seedId +
launch are bound once per subquery).

## Output shape

```json
{
  "launchFloor": "2026-06-08",
  "seeds": [
    { "label": "ReciFriend Founder", "email": "elisa.widjaja@gmail.com", "userId": "8e4dfd5e-...",
      "requestsPending": 8, "connections": 4, "activated": 2, "intent": 12 },
    { "label": "Top contributor", "email": "mochislime02@gmail.com", "userId": "dfa74750-...",
      "requestsPending": 3, "connections": 2, "activated": 1, "intent": 5 }
  ],
  "totals": { "requestsPending": 11, "connections": 6, "activated": 3, "intent": 17 }
}
```

Read as a funnel: `intent` (requestsPending + connections) -> connections -> activated,
per seed and overall. A high `requestsPending` with low `connections` means people are
tapping but you have not accepted on the seed accounts yet (see Edge cases).

## Edge cases

- Seed email not in `profiles` -> that seed reports `userId: null` and zero counts; no
  crash, no query run for it.
- **Manual-accept dependency (operational, important):** the seed accounts do not
  auto-accept. Until you log into the founder / top-contributor account and accept the
  pending requests, they stay in `requestsPending` and `connections` stays 0. A high
  `requestsPending` / low `connections` reflects an un-done accept pass, not poor
  intent. Do an accept pass before reading the funnel (or revisit founder auto-accept
  later — out of scope here).
- **Declined / cancelled requests are invisible** (rows deleted, no trace). For the
  owner-controlled seed accounts this is acceptable: you would accept, not decline, so
  intent is well approximated by `requestsPending + connections`.
- **Pre-launch organic edge:** a request sent to a seed BEFORE launch but accepted
  AFTER launch counts in `connections` (floored on `connected_at`). Low volume and
  acceptable; noted as a known minor impurity.
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
  `intent = requestsPending + connections` derived per seed, correct totals summed
  across seeds, and a missing-seed reporting `userId: null` + zeros.

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
