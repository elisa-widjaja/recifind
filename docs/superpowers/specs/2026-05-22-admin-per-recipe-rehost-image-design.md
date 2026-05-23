# Admin per-recipe Re-host image (+ both actions on User drilldown)

**Date:** 2026-05-22
**Status:** Approved, ready for implementation

## Problem

The admin can fix hallucinated content with the per-recipe **Re-enrich** button (shipped),
but stale Instagram/TikTok preview images (expiring `oh`/`oe` CDN URLs) can still only be
re-hosted via a shell script. Admins need a per-recipe **Re-host image** action in the UI,
sitting next to Re-enrich. Both maintenance actions should also be available on the **User
drilldown** recipe table, which today has only Hide/Unhide.

## Goal

1. A stale-aware **Re-host image** button on the admin Recipes table, beside Re-enrich.
2. **Re-host + Re-enrich** buttons on the User drilldown recipe table.

Manual, per-recipe only. No bulk runner (stays parked in
`2026-05-22-admin-rehost-preview-image-ui-design.md`). No image-status chip — the
button's enabled/disabled state is the only indicator.

## Existing pieces (reused, not changed)

- `POST /admin/migrate-images {recipeIds:[id], dryRun:false}` — re-hosts one recipe's
  image (re-fetches og:image from source, uploads to Supabase, updates D1). Returns
  `{ results: [{ status: 'rehosted'|'cleared'|'failed', reason? }], ... }`. Writes audit log.
- `POST /admin/recipes/:id/re-enrich` — admin re-enrich (shipped `d5c24aa`).
- `fetchAdmin` (`admin-ui/src/api.js`); `ConfirmModal`; `Snackbar` toast.
- Recipes page (`Recipes.jsx`) already has Re-enrich (confirm modal) + Hide/Unhide in a
  non-wrapping flex action cell. Drilldown (`UserDrilldown.jsx`) has Hide/Unhide and a
  kind-based `confirm` state (`{ kind, recipeId, title }`) with one ConfirmModal per kind.

## Endpoint behavior that shapes the design

`migrate-images` re-fetches the og:image from the **source**; if the source has no image
it **clears** the recipe image (`image_url=''`), status `cleared`. The per-recipe path
bypasses the hostname filter, so the UI gates the button to `image_status === 'stale'`
(an image that exists and is external) and confirms intent, to avoid clearing/orphaning a
healthy image. `cleared`/`failed` are 200-level outcomes — surfaced, never silent.

## Changes

### 1. Backend — `apps/worker/src/routes/admin.ts` (additive)

- New export `deriveImageStatus(imageUrl: string | null | undefined): 'none'|'hosted'|'stale'`:
  - empty/whitespace → `'none'`
  - contains `'/storage/v1/object/public/'` → `'hosted'`
  - else → `'stale'`
- `buildRecipeSearchQuery` (`:856`): add `r.image_url AS image_url` to the SELECT.
- `handleAdminSearchRecipes`: add `image_status: deriveImageStatus(r.image_url)` to each
  pushed owner.
- `handleAdminUserDrilldown` (`:356`): add `image_url` to the recipes SELECT; return
  recipes mapped with `image_status` (e.g. `(recipes.results||[]).map(r => ({ ...r, image_status: deriveImageStatus(r.image_url) }))`).

No new endpoint; no change to enrichment/import functions.

### 2. Recipes page — `apps/admin-ui/src/pages/Recipes.jsx`

- `reHostTarget` state (`{ recipeId, title } | null`).
- Handler `doReHost(rid)`:
  ```js
  const doReHost = (rid) =>
    fetchAdmin('/admin/migrate-images', {
      method: 'POST',
      body: JSON.stringify({ recipeIds: [rid], dryRun: false }),
    })
      .then((d) => {
        const r = (d.results || [])[0];
        const st = r?.status;
        if (st === 'rehosted') setToast('Image re-hosted');
        else if (st === 'cleared') setToast(`Image cleared — ${r?.reason || 'source had no image'}`);
        else setToast(`Re-host failed — ${r?.reason || 'unknown'}`);
        load();
      })
      .catch((e) => setToast(`Re-host failed: ${e.message}`));
  ```
- In the action cell (before the Re-enrich button), add a **Re-host** button:
  ```jsx
  <Button
    size="small"
    sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }}
    disabled={o.image_status !== 'stale'}
    title={o.image_status === 'stale' ? 'Re-host this image onto Supabase' : `Image is ${o.image_status || 'none'} — nothing to re-host`}
    onClick={() => onReHost(o.id)}
  >Re-host</Button>
  ```
  Thread `onReHost={(rid) => setReHostTarget({ recipeId: rid, title: g.title })}` from
  `Recipes` → `RecipeGroupRow` (mirrors `onReEnrich`). Final row order:
  `Re-host · Re-enrich · Hide/Unhide`. Widen the action column 200 → 280 (header + body).
- Add a `ConfirmModal` for re-host:
  - title: `Re-host image for "{title}"?`
  - body: "Re-fetches the image from the source URL and stores it on Supabase. If the
    source no longer has an image, the current image is cleared."
  - confirmLabel: "Re-host" (not `destructive`)
  - onConfirm: `doReHost(reHostTarget.recipeId); setReHostTarget(null);`

### 3. User drilldown — `apps/admin-ui/src/pages/UserDrilldown.jsx`

- Handlers `doReHostRecipe(rid)` and `doReEnrichRecipe(rid)` mirroring the Recipes page
  (same endpoints, same toast logic), each calling `reload()` after.
- In the recipe table action cell (`:346`), before Hide/Unhide add:
  ```jsx
  <Button size="small" sx={{ minWidth: 'auto' }}
    disabled={r.image_status !== 'stale'}
    title={r.image_status === 'stale' ? 'Re-host this image onto Supabase' : `Image is ${r.image_status || 'none'} — nothing to re-host`}
    onClick={() => setConfirm({ kind: 'rehost_recipe', recipeId: r.id, title: r.title })}>Re-host</Button>
  <Button size="small" sx={{ minWidth: 'auto' }}
    onClick={() => setConfirm({ kind: 'reenrich_recipe', recipeId: r.id, title: r.title })}>Re-enrich</Button>
  ```
  Wrap the action cell's buttons so they stay on one row (flex, `flexWrap: 'nowrap'`,
  right-justified) — same treatment as the Recipes page.
- Add two `ConfirmModal` instances (mirroring the existing `hide_recipe` one):
  - `confirm?.kind === 'rehost_recipe'` → title `Re-host image for "{title}"?`, body as
    above, confirmLabel "Re-host", onConfirm `doReHostRecipe(confirm.recipeId)` then clear.
  - `confirm?.kind === 'reenrich_recipe'` → title `Re-enrich "{title}"?`, body "Re-runs
    enrichment on the source URL and replaces this recipe's ingredients and steps. If the
    source can't be parsed, the current content is kept.", confirmLabel "Re-enrich",
    onConfirm `doReEnrichRecipe(confirm.recipeId)` then clear.

## Error handling

- `fetchAdmin` throws on non-2xx → failure toast on each page.
- `cleared` / `failed` (re-host) and empty re-enrich are 200-level outcomes → warning
  toasts, never silent.
- Both endpoints write their own audit-log entries server-side.

## Testing

- **Worker (vitest):** `deriveImageStatus` covering none/hosted/stale; assert
  `buildRecipeSearchQuery` SELECT contains `r.image_url`.
- **Admin UI (manual, no harness):**
  1. Recipes page: a recipe with a stale image shows an enabled Re-host; confirm → re-hosts
     → reload shows it disabled (now `hosted`). A hosted recipe shows Re-host disabled.
  2. Drilldown: same Re-host behavior, plus Re-enrich works.
  3. `cd apps/admin-ui && npm run build` succeeds.

## Out of scope

- Bulk image re-host runner (parked: `2026-05-22-admin-rehost-preview-image-ui-design.md`).
- Image-status chip / provenance chip.
- Bulk re-enrich.
