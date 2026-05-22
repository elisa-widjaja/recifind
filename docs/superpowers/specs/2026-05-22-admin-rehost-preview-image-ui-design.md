# Admin UI to re-host preview images

**Date:** 2026-05-22
**Status:** Approved, ready for implementation plan

## Problem

Recipes imported from Instagram/TikTok store the raw source CDN URL in
`recipes.image_url`. Those URLs carry expiring `oh`/`oe` signatures and 403 for
everyone once they expire. The worker re-hosts images onto Supabase Storage at save
time, but a backlog of ~89 recipes still carry stale external CDN URLs (legacy rows /
paths that bypassed save-time re-hosting). Today the only way to re-host is to call the
`POST /admin/migrate-images` endpoint by hand (curl + an admin JWT), which is slow and
error-prone.

This adds an admin UI so the operator can (a) drain the stale backlog in batches and
(b) spot-fix a single recipe — both from `apps/admin-ui`, no curl required.

## Goal

Two capabilities in the existing admin app:
1. A **bulk runner** page that shows how many recipes have stale images and re-hosts
   them batch by batch until the count reaches zero.
2. A **stale-aware per-recipe button** on the Recipes page that re-hosts one recipe,
   enabled only when that copy's image is actually stale.

Both reuse the existing `POST /admin/migrate-images` endpoint. The only backend change
is additive: surfacing each recipe copy's image status in the search response.

## Existing pieces (reused, not changed)

- `POST /admin/migrate-images` (`worker/src/index.ts:508`, `handleAdminMigrateImages`):
  accepts pinned `recipeIds` **or** a hostname-batch sweep (`hostnames`, `batchSize`),
  plus `dryRun` (default true). Re-fetches the og:image from the recipe's source URL,
  re-hosts via `persistPreviewImage`, updates D1. Returns `totalRemaining`, `counts`,
  and per-recipe `results` (`rehosted` / `cleared` / `failed` / `dry-run`). Writes an
  audit-log entry on real (non-dryRun) runs.
- `apps/admin-ui` — React + MUI + Vite, hash-routed. `fetchAdmin(path, init)`
  (`src/api.js`) auto-attaches the admin Supabase session token. Pages: Dashboard,
  Users, Recipes, AuditLog. Components: `SidebarNav`, `ConfirmModal`.
- The recipe import/enrich path (`fetchOgImage`, `persistPreviewImage`) is **untouched**.

## Endpoint behavior that shapes the design

`migrate-images` always re-fetches `fresh = fetchOgImage(sourceUrl)` from the **source**,
then:
- `fresh` is a usable external URL → re-host (new object key) and update D1.
- `fresh` is empty (source post deleted / stripped) → **clears** the image
  (`image_url=''`, `image_path=NULL`, `preview_image=NULL`), status `cleared`.

Implications:
- The **bulk** path filters by `cdninstagram.com`/`tiktokcdn` hostnames, so it only ever
  touches genuinely-stale rows — self-limiting and safe.
- The **per-recipe** path targets a pinned ID and bypasses the hostname filter, so it
  could clear a dead-source recipe or orphan an already-healthy one. The UI mitigates
  this by enabling the button **only for `stale` images**.
- `cleared` / `failed` are 200-level outcomes, not HTTP errors — the UI must surface
  them explicitly so wipes/failures are never silent.

## Changes

### 1. Backend — additive image status in search

In `apps/worker/src/routes/admin.ts`:
- `buildRecipeSearchQuery` (`:856`): add `r.image_url AS image_url` to the SELECT.
- `handleAdminSearchRecipes`: add `image_status` to each pushed owner via a pure helper
  `deriveImageStatus(imageUrl)`:
  - empty / null → `'none'`
  - contains `'/storage/v1/object/public/'` → `'hosted'`
  - otherwise → `'stale'`

  The Supabase public-URL marker means no `env` threading is needed.

No other backend change.

### 2. Bulk runner page — `apps/admin-ui/src/pages/ImageMigration.jsx`

- New `SidebarNav` entry and a route in `App.jsx` (hash-routed, matching existing pages).
- On mount: `POST /admin/migrate-images {dryRun:true, batchSize:10}` → display
  **"N recipes with stale images"** (`totalRemaining`) and a preview list of the next
  batch's candidates.
- **"Re-host next batch"** button → `POST {dryRun:false, batchSize:10}`. On success:
  append each result to a scrollable results log, update the remaining count, leave the
  button ready for the next batch. Disabled while a batch is in flight and when the
  count is zero.
- Per-result chips: `rehosted` (green), `cleared` (orange + reason), `failed`
  (red + reason).
- Errors from `fetchAdmin` → a `Snackbar` toast (matching the Recipes page pattern).

### 3. Per-recipe button — `apps/admin-ui/src/pages/Recipes.jsx`

- Render a small image-status chip per owner row from the new `image_status` field
  (`stale` / `hosted` / `none`).
- Add a **"Re-host"** button to each owner row, **enabled only when
  `image_status === 'stale'`** (otherwise disabled with an explanatory tooltip).
- On click: `POST /admin/migrate-images {recipeIds:[id], dryRun:false}` → toast keyed on
  the single result's status (`rehosted` success / `cleared` warning / `failed` error),
  then re-run the current search so the chip flips to `hosted`.
- No confirm modal: the stale-only gate already prevents the dangerous cases; the result
  toast makes the outcome explicit.

## Error handling

- `fetchAdmin` throws on non-2xx (`UNAUTHORIZED` / `FORBIDDEN` / `HTTP nnn`) → caught
  into toasts on each page.
- `cleared` / `failed` results are rendered as warning/error chips (bulk) or toasts
  (per-recipe), never swallowed.
- Both flows are audited automatically by the existing `migrate-images` audit log.

## Testing

- **Worker:** a vitest unit test for `deriveImageStatus` covering `none` / `hosted` /
  `stale`.
- **Admin UI:** manual verification — search a stale recipe → chip shows `stale` →
  click Re-host → chip flips to `hosted`; open the bulk page → run a batch → count
  decrements and results render. The admin app has no test harness, so no automated UI
  test is added; the absence is intentional and noted here.

## Out of scope

- Changing the bulk hostname filter (stays the endpoint's `cdninstagram.com` /
  `tiktokcdn` default).
- Auto-rehost-on-import for the paths that still write stale URLs (separate concern).
- Backfilling/cleaning orphaned Supabase objects left by prior re-hosts.
