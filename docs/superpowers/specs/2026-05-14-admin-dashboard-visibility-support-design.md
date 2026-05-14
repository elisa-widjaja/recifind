# Admin Dashboard — Visibility + Support

**Date:** 2026-05-14
**Status:** Spec — pending implementation plan
**Scope:** Slices 1 (Visibility) and 3 (Support) of a 4-slice admin dashboard initiative. Curation (slice 2) and Moderation (slice 4) are deliberately deferred to their own future spec/plan/ship cycles.

## Why we're doing this

Today, answering basic questions about ReciFriend requires hand-running SQL against D1 or pulling the Supabase Auth user list manually. There's no tool for "show me users with 0 recipes" or "did this user's invitee actually start using the app." When a friend texts that something is broken, there's no way to look up their account state, resend a stuck friend invite, or manually unstick a pending accept — every Support task becomes a wrangler one-liner.

This spec covers the foundation for a real admin tool plus the two slices that pay back fastest:

1. **Visibility** — a filterable user table + trend charts that surface the viral-loop health metrics already named in the product strategy notes (viral coefficient, activation, friend-acceptance + downstream activity).
2. **Support** — Help-the-user actions (resend invite, force-accept, magic-link, edit display name, soft-delete, hide recipe) that turn 5-minute one-off DB pokes into one-click admin actions.

Slices 1 and 3 share the same per-user drill-down panel — Visibility surfaces the user, Support acts on them. Building them together is cheaper than building them sequentially.

**Out of scope (deferred slices):**
- **Slice 2 — Curation:** UI for managing the hardcoded ID arrays in `apps/worker/src/index.ts` (`CURATED_COMMUNITY_IDS`, `EDITOR_PICK_TITLES`, `CURATED_TRENDING_IDS`, `CURATED_YOUTUBE_SHORTS_IDS`).
- **Slice 4 — Moderation:** Reports queue, ban-by-email, hard-delete account, mass actions.

## Architecture

### New Vite app: `apps/admin-ui/`

A standalone React + Vite + MUI app, separate from `apps/recipe-ui`. Same stack as the consumer app to minimize learning cost, but with desktop-first sizing and a different shell (sidebar nav, no bottom app bar, no mobile breakpoint work).

**Why not a route inside `apps/recipe-ui`:**
- The consumer bundle would carry admin code (mitigatable via `React.lazy`, but still mixes concerns)
- MUI primitives in recipe-ui are tuned for mobile-first cards, fighting them for dense tables/charts is wasted effort
- A discoverable `/admin` route inside the public site is messy even if the worker 403s

**Stack additions specific to admin-ui** (not used by recipe-ui):
- **TanStack Table** for the user table (server-side pagination, sortable columns, keyboard nav)
- **Recharts** for the trend charts (~30KB, simple API)

### Cloudflare Pages project: `recifriend-admin`

A second Pages project, fully separate from the existing `recifind` project. Custom domain: `admin.recifriend.com`.

Deploy command:
```bash
cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin
```

### Cloudflare Access in front of `admin.recifriend.com`

Two-layer auth — Access at the edge, JWT at the worker.

- **Access policy:** Google SSO, allowlist initially `elisa.widjaja@gmail.com`. 24-hour session, then re-prompt.
- Set up once in the Cloudflare dashboard (Zero Trust → Access → Applications). No code change.
- **Why:** A leaked Supabase JWT alone can't reach the admin API — attacker also needs a valid Google login for the Access policy. Belt-and-suspenders against laptop compromise / log leakage.

### Worker changes — extend `apps/worker`, do not create a new worker

All admin endpoints live under `/admin/*` in the existing worker. Reasons:
- Shares the existing D1 binding, Supabase admin API client, Resend client, and secrets — no duplication
- The existing `/admin/test-nudge-email` route already establishes the prefix
- A separate worker would duplicate `wrangler.toml` env vars across two configs, with no real isolation benefit at solo-admin scale

**New file:** `apps/worker/src/routes/admin.ts`. Extract the existing `/admin/test-nudge-email` handler into this file too while we're touching it — `index.ts` is already 3700+ lines and adding 13+ admin routes inline would make it worse.

**Admin gate:** A small middleware reads the verified JWT email and checks against `ADMIN_EMAILS` (a new worker secret, comma-separated list). Returns 403 if the email isn't on the list.

**Auth flow end-to-end:**

1. User opens `admin.recifriend.com`
2. Cloudflare Access intercepts → prompts Google login → drops session cookie (24h)
3. Admin app loads → standard Supabase Google OAuth (same code as recipe-ui)
4. Admin app calls `GET /admin/me` with the Supabase JWT → worker verifies signature + checks `ADMIN_EMAILS`
5. Worker returns `{ email, isAdmin: true }` → admin app renders dashboard
6. Every subsequent API call attaches the JWT, worker re-checks on each request

**Sharp choice deferred for v1:** Use Supabase Google OAuth in the admin app rather than the `CF-Access-Jwt-Assertion` header. The header path would let us skip the second login but requires a new code path in the worker. We use Supabase JWTs in v1 and revisit if the double-login becomes annoying.

## Data model changes

Two ALTERs and one new table.

```sql
-- For action: hide recipe
ALTER TABLE recipes ADD COLUMN hidden_at TEXT;

-- For action: soft-delete user
ALTER TABLE profiles ADD COLUMN deleted_at TEXT;

-- For audit log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_recipe_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_email, created_at DESC);
```

**Soft-delete is a footgun.** Once `profiles.deleted_at` exists, every existing query that touches the friend graph, the recipe feed, or anything user-facing must filter out deleted users — or deleted users will keep showing up in friend lists and recipe feeds. The risk is missing one query and silently leaking deleted accounts.

To contain it, all queries that JOIN against profiles go through a single helper function (or shared SQL fragment) that always appends `AND p.deleted_at IS NULL`. The implementation plan must enumerate every query that needs the filter and add it explicitly — no implicit filtering.

**Why no audit_log on the existing user-initiated `deleteAccount`:** That's user action, not admin action. The audit log is for admin-initiated changes only.

## API endpoints

All under `/admin/*`, all gated by the `ADMIN_EMAILS` middleware.

### Performance note for the implementation plan

`accepted_active_count` is the trickiest column on `GET /admin/users` — for each row in the page, we need to know how many of *that user's accepted invitees* are themselves active. A naive per-row subquery scales O(page_size × invites). For the page sizes we're using (50) and the user volume we expect in the next 6 months (low thousands), a single JOIN-based aggregate query should be fine. The implementation plan must benchmark this on a seeded D1 with 1,000+ users before merging — if it's slow, denormalize via a periodic worker cron that materializes a `user_stats` table.

### Read endpoints (Visibility)

| Endpoint | Purpose |
|---|---|
| `GET /admin/me` | `{ email, isAdmin: true }`. Admin app calls this on load to gate the UI. |
| `GET /admin/users?limit=50&offset=0&search=&recipeBucket=&activity=&signupAfter=&signupBefore=&sort=signup_desc` | Paginated user list. Each row: `{ id, email, signed_up_at, last_sign_in_at, recipe_count, invites_sent, invites_accepted, accepted_active_count, is_active, deleted_at }` |
| `GET /admin/users/:id` | Drill-down: profile + recipe list (titles, dates, hidden_at) + invite cascade (each invitee's status, recipe count, last_sign_in_at, is_active) + cook events (last 20) + pending received invites |
| `GET /admin/metrics/timeseries?days=90` | All trend chart data in one call: `{ signupsPerDay, cumulativeUsers, viralCoefficientWeekly, activationCurveWeekly, inviteLoopCompletionWeekly, totals: { totalUsers, activeUsers, totalRecipes, viralCoefficient } }`. One call instead of five reduces RTT and lets the worker share intermediate query results. |
| `GET /admin/audit-log?limit=100&offset=0&adminEmail=&action=` | Paginated audit log entries, reverse-chron. |

### Mutate endpoints (Support)

| Endpoint | Action |
|---|---|
| `POST /admin/users/:id/resend-invite` body: `{ inviteId }` | Re-fires the Resend email for an existing pending invite. No new DB row. Audit-logged as `resend_invite`. |
| `POST /admin/users/:id/force-accept` body: `{ inviteId }` | Flips `friend_requests.status` to `accepted`, inserts reciprocal `friends` rows. Same internal helper as the normal accept handler — bypasses the auth check only. Audit-logged as `force_accept`. |
| `POST /admin/users/:id/magic-link` | Calls Supabase Auth admin API `generateLink({ type: 'magiclink', email })`, returns `{ url }`. Admin pastes/sends manually — server does not deliver. Audit-logged as `generate_magic_link`. |
| `PATCH /admin/users/:id` body: `{ display_name }` | Updates `profiles.display_name`. v1 supports only this field. Audit-logged as `edit_profile` with payload `{ field: 'display_name', from, to }`. |
| `DELETE /admin/users/:id` | Soft-delete: sets `profiles.deleted_at = NOW()`. Recoverable for 30 days (cleanup job out of scope here — manual D1 query for now). Audit-logged as `soft_delete_user`. |
| `POST /admin/recipes/:id/hide` body: `{ reason? }` | Sets `recipes.hidden_at = NOW()`. Owner still sees it; everyone else doesn't (feeds, public landing, friend recipes all filter `WHERE hidden_at IS NULL`). Audit-logged as `hide_recipe`. |

### Refactor: existing `deleteAccount`

The existing `deleteAccount` function in `apps/worker/src/index.ts` (around line 1348) is a hard-delete. Refactor signature to `deleteAccount(userId, mode: 'hard' | 'soft')`:
- `hard` — preserves current behavior, used by the user's own "delete my account" flow
- `soft` — only sets `profiles.deleted_at`, leaves rows intact

The admin `DELETE /admin/users/:id` always uses `soft`. The user's own delete-my-account flow stays `hard`.

## UX & pages

Three primary pages plus the audit log, all rendered with a sidebar nav on the left. Desktop-only — no mobile breakpoint work.

### Page 1 — Dashboard (`/`)

Default landing page. The "C/founder narrative" view — pretty enough to screenshot.

**Header row:** four big-number cards
- **Total users** — absolute count, with WoW delta
- **Active users** — absolute count + `(NN%)` of total, where active = the definition below
- **Viral coefficient** — invites accepted ÷ signups (weekly), with WoW delta
- **Total recipes** — absolute count, with WoW delta

**Charts below:**
- Signups per day (line + 7-day rolling average)
- Activation curve — % of new users with ≥1 recipe within 7 days of signup, by signup-week cohort
- Viral loop completion — % of new users who invited ≥1 friend within 7 days of signup, by cohort
- Viral coefficient over time, weekly

All charts powered by the single `/admin/metrics/timeseries` call.

**Date-range selector** top-right: `30d / 90d / all-time`. Manual refresh button — caching is page-load only, no live updates.

### Page 2 — Users (`/users`)

The "B/investigation core."

**Filters row** above the table — single row, no nested drawers:
- **Search:** email substring
- **Recipes bucket:** `0 / 1–9 / 10–19 / 20–49 / 50+`
- **Activity:** `Active / Inactive / Signup-only ghost / Soft-deleted` — disjoint categories (every user falls in exactly one)
- **Signed up:** `Today / 7d / 30d / 90d / all`

**Table columns:**
| Email | Signed up | Recipes | Sent | Acc | Acc.active |
|---|---|---|---|---|---|

- `Sent` = total invites this user sent
- `Acc` = of those, how many were accepted
- `Acc.active` = of those accepted, how many are themselves "active" (per the definition below) — shown as `5/7 71%`
- A green ● dot in the rightmost column indicates the user themselves is active; ○ grey for inactive

Click a row → drill-down (Page 3).

**Pagination:** server-side, page size 50, page count in footer. **No URL hash for filter state in v1** (deferred — add later if you find yourself wanting to share filter URLs).

**Export CSV** button → exports the entire filtered set (not just current page).

### Page 3 — User drill-down (`/users/:id`)

Read panel + Support actions, reached from a row click on Page 2.

**Header:** email, signup date, last sign-in, recipe count, active status badge, `[⋯ Actions ▾]` menu.

**Body sections:**
1. **Recipes (count)** — list of titles with dates. Per-row action: **Hide** (sets `hidden_at`).
2. **Cook events** — last 20, recipe title + timestamp.
3. **Invites sent (count) — N accepted, M active** — table with columns: Invitee email, Status, Recipes count, Last seen, active dot. Per-row actions on Pending rows: **Resend invite**, **Force accept**.
4. **Pending invites received** — list of inbound pending invites with **Force accept** per row.

**Actions menu (`[⋯ Actions ▾]`):**
- Edit display name (modal, single text field)
- Send magic link (modal, generates URL via `POST /admin/users/:id/magic-link`, copy-to-clipboard)
- Soft-delete account (modal, "I'm sure" checkbox + confirm button)

**Confirmation pattern for destructive actions:** A modal with the action description, an "I'm sure" checkbox, and a confirm button (disabled until checkbox is checked). No typed-email confirmation in v1.

After any action: re-fetch the drill-down data and show a brief toast.

### Page 4 — Audit log (`/audit-log`)

Hidden from the sidebar nav for v1 (reachable by typing the URL). Reverse-chron list of every admin action. Filterable by admin email + action type. Read-only.

Columns: timestamp, admin_email, action, target (user email or recipe title), payload (collapsed JSON, expand on click).

## Definitions

### "Active user"

A user is **active** if **both**:
1. They have ≥1 recipe in the `recipes` table
2. They have logged in within the last 30 days (per Supabase `last_sign_in_at`)

A soft-deleted user (`profiles.deleted_at IS NOT NULL`) is never active regardless of the above.

This single definition drives:
- The `is_active` flag in `GET /admin/users` rows
- The `accepted_active_count` calculation
- The "Active users" big-number card on the dashboard
- The activity filter on the users table
- The active dot (●/○) shown next to invitees in the drill-down

### Disjoint activity categories

Every non-deleted user falls into **exactly one** of these:

- **Signup-only ghost** — 0 recipes AND `last_sign_in_at` is within 5 minutes of signup (never came back)
- **Active** — ≥1 recipe AND `last_sign_in_at` within last 30 days
- **Inactive** — anyone else (came back at least once OR has recipes, but doesn't meet the active bar)

`Soft-deleted` (`profiles.deleted_at IS NOT NULL`) is a separate category that overrides all of the above.

The split between Ghost and Inactive matters because they represent different problems: Ghost = signup loop is leaky (they bounced after creating account), Inactive = engagement loop is leaky (they came back but aren't sticking).

## Sharp choices we're making (push back if any are wrong)

1. **No "view as user" / impersonate action.** Powerful for support but requires generating JWTs for arbitrary users. Defer to slice 4 or later, only if a real need emerges.
2. **Magic links are admin-paste, not auto-send.** `POST /admin/users/:id/magic-link` returns the URL; admin chooses how to deliver. Safer than auto-emailing — admin sees what they're doing.
3. **Soft-delete cleanup is manual for v1.** No automated purge. The 30-day "recoverable window" is documented as a convention but not enforced — soft-deleted rows sit in D1 forever until you run a one-off `wrangler d1 execute` command to hard-delete them. Build a real cleanup cron in slice 4 if/when soft-delete volume justifies it.
4. **Same-worker, not separate admin worker.** Trades blast-radius isolation for shared infrastructure. Reconsider if admin traffic ever competes with consumer traffic for CPU time (extremely unlikely at this scale).
5. **No URL hash for filter state in v1.** Deferred per user decision — add later if you start sharing filter URLs with yourself.
6. **No mobile breakpoint.** Admin UI is desktop-only by design.
7. **No real-time updates.** Page-load fetch + manual refresh button. No WebSockets, no polling.

## Test plan (high-level — full plan to be written by writing-plans)

Worker:
- Unit tests for the admin gate middleware (allowed/forbidden email cases)
- Integration tests for the new endpoints against a seeded D1 (vitest + miniflare, same pattern as `apps/worker/src/cook.test.ts`)
- Test the soft-delete filter helper — every JOIN against profiles must filter correctly

Frontend:
- Component test for the user table (filter changes → API call shape)
- Component test for the drill-down (action button → mutation call shape)
- Manual smoke test of the auth flow end-to-end (CF Access → Supabase login → `/admin/me` → dashboard)

## Migration & rollout sequence

1. Apply D1 migrations (`hidden_at`, `deleted_at`, `admin_audit_log`)
2. Deploy worker with new admin routes + middleware (set `ADMIN_EMAILS` secret first)
3. Set up `recifriend-admin` Pages project + custom domain
4. Set up Cloudflare Access policy
5. Deploy admin-ui
6. Smoke test
7. Ship

No traffic from end users is affected by any of this. Zero downtime. The new schema columns are nullable, so they're safe to add before the worker code that reads them.

## What's deliberately not in this spec

- **Curation tooling** (slice 2)
- **Moderation tooling** (slice 4): reports queue, ban-by-email, hard-delete, mass actions
- **Real-time / live-updating dashboards**
- **Mobile responsive admin**
- **The CF Access JWT path** (`CF-Access-Jwt-Assertion`) as an alternative to Supabase login
- **Multi-admin management UI** (admins managed via `wrangler secret put` for v1)
- **Soft-delete cleanup cron job**
