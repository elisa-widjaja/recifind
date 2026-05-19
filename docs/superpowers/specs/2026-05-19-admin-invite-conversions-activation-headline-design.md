# Admin Drill-down — Invite Conversions: Activation Headline + Collapsible Detail

**Date:** 2026-05-19
**Scope:** Frontend-only. `apps/admin-ui/src/pages/UserDrilldown.jsx`, the `<Section title="Invite conversions">` block only. No API, worker, schema, or migration changes.

## Problem

The current "Invite conversions" section shows a one-line caption (`N conversions · link created …`) and an always-expanded flat table. There is no at-a-glance measure of invite *quality*. A literal "invites sent vs accepted" rate is not computable: the data model is a single reusable invite link (`open_invites`), shared off-platform an unknown number of times; the per-send table `friend_requests_sent` is dormant (0 rows). The meaningful, computable funnel is **Joined → Activated**.

## Activation definition

Reuse the dashboard's existing composite "active" rule for consistency. An invitee is **activated** when ALL hold:

- `invitee_recipe_count >= 1`
- `last_sign_in_at` is within the last 30 days (relative to now)
- `invitee_deleted_at` is null (not soft-deleted)

`last_sign_in_at` null/absent → **not** activated (conservative).

## UI

Replace the current caption + always-open table with:

### Headline (big numbers)

Three stacked metrics, value as a large `Typography` (e.g. h4/h3) with a caption label beneath:

- **Joined** = `data.invite_conversions.length` (all accepters)
- **Active** = count of conversions matching the activation rule
- **Activated** = `Math.round(Active / Joined * 100)` as `NN%`; render `—` when Joined = 0

Subline (caption, secondary text): `via invite link · created <link created date>` when `data.invite_link` exists. When `data.invite_link` is null and Joined = 0: `No invite link generated`.

### Collapsible detail

- Collapsed by default. Toggle row using MUI `Collapse`:
  - collapsed label: `▸ View {N} invitees`
  - expanded label: `▾ Hide invitees`
  - `N` = Joined; hide the toggle entirely when Joined = 0.
- Expanded content = the existing table, unchanged columns: **Invitee · Status · Recipes · Last seen**, plus a leading status dot per row (green = activated, grey = not), visually consistent with the Users-table active dots.
- Empty state (Joined = 0): caption text `No one has joined via this link yet.` — no empty table rendered.

## Out of scope / non-goals

- No change to the worker drill-down endpoint or its query.
- No change to other drill-down sections (Pending invites received, Recipes, Cook events, Support actions).
- No new "invites sent" metric (not computable; intentionally omitted).

## Testing

- Manual smoke on prod admin after deploy: a user with multiple conversions (mixed active/inactive/disconnected/deleted) shows correct Joined/Active/Activated numbers; toggle expands/collapses; dots match per-row activation; Joined = 0 user shows empty-state copy and no toggle.
- No automated test added (presentational, derived entirely from existing endpoint data; admin.test.ts unaffected since the endpoint is unchanged).

## Deploy

`cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin`
(Pages deploy is scoped to `apps/admin-ui` — safe regardless of unrelated working-tree state in `apps/worker`/`apps/recipe-ui`.)
