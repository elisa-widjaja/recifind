# Admin Recipes table — per-recipe "Re-enrich" button

**Date:** 2026-05-22
**Status:** Approved, ready for implementation

## Problem

Recipes imported by the old implementation can carry hallucinated content (e.g. a recipe
titled "Eggs and Sardine breakfast" whose ingredients/steps were prosciutto-wrapped
melon). The fix — re-running the current enrichment chain — is now exposed as an
admin-only endpoint (`POST /admin/recipes/:id/re-enrich`, shipped `d5c24aa`), but the
only way to call it is a shell script + admin token. An admin needs to trigger it from
the admin UI when they spot a bad recipe.

## Goal

A manual, per-recipe **"Re-enrich"** action on the admin Recipes table, next to
Hide/Unhide, that calls the existing endpoint and reports the outcome. No bulk sweep
(deliberately — the candidate signal is fuzzy and each call is a Gemini chain). No image
re-host work here (that remains parked in its own spec/plan).

## Scope

Frontend only — `apps/admin-ui/src/pages/Recipes.jsx`. The endpoint already exists and is
deployed; **no worker change**. No provenance chip (declined — keep the row simple).

## Existing pieces (reused)

- `POST /admin/recipes/:id/re-enrich` — admin-scoped, re-runs the chain on the recipe's
  source URL, overwrites ingredients/steps/etc. Returns `{ recipe: {...} }`. Has a
  preserve-on-empty guard (empty chain result → keeps existing content, no overwrite).
- `fetchAdmin(path, init)` (`apps/admin-ui/src/api.js`) — auto-attaches the admin token,
  throws on non-2xx.
- `ConfirmModal` (`apps/admin-ui/src/components/ConfirmModal.jsx`) — already used by the
  Hide action (`open`, `title`, `body`, `destructive`, `confirmLabel`, `onConfirm`,
  `onClose`).
- `Snackbar` toast + `load()` re-search, already in the `Recipes` component.

## Changes (all in `Recipes.jsx`)

1. **State:** add `reEnrichTarget` (`{ recipeId, title } | null`) alongside the existing
   `confirm` state.

2. **Handler** `doReEnrich(recipeId)`:
   ```js
   fetchAdmin(`/admin/recipes/${recipeId}/re-enrich`, { method: 'POST', body: '{}' })
     .then((d) => {
       const r = d.recipe || {};
       const ing = (r.ingredients || []).length;
       const steps = (r.steps || []).length;
       if (ing === 0 && steps === 0) {
         setToast('Source returned nothing — content unchanged');
       } else {
         setToast(`Re-enriched (${ing} ingredients, provenance: ${r.provenance || 'n/a'})`);
       }
       load();
     })
     .catch((e) => setToast(`Re-enrich failed: ${e.message}`));
   ```
   Note: the endpoint returns the unchanged recipe when preserve-on-empty fires, so the
   `ing === 0 && steps === 0` check distinguishes "nothing changed" from a real update.

3. **Button:** in each owner row's action cell (`RecipeGroupRow`, beside Hide/Unhide), add
   a `<Button size="small">Re-enrich</Button>` that opens the confirm —
   `onReEnrich(o.id, g.title)` → `setReEnrichTarget({ recipeId: o.id, title: g.title })`.
   Thread an `onReEnrich` prop from `Recipes` → `RecipeGroupRow` (mirrors `onHide`).
   Widen the action cell as needed to fit three actions.

4. **Confirm modal:** a second `ConfirmModal` instance:
   - `title`: `Re-enrich "{title}"?`
   - `body`: "Re-runs enrichment on the source URL and replaces this recipe's ingredients
     and steps. If the source can't be parsed, the current content is kept."
   - `confirmLabel`: "Re-enrich" (not `destructive` — it's a fix, not a delete)
   - `onConfirm`: `doReEnrich(reEnrichTarget.recipeId); setReEnrichTarget(null);`
   - `onClose`: `setReEnrichTarget(null)`

## Error handling

- `fetchAdmin` throws on non-2xx (403/404/HTTP n) → caught into the failure toast.
- Preserve-on-empty is a 200 with unchanged content → surfaced as the "content unchanged"
  toast, not silently.
- The endpoint writes its own audit-log entry server-side.

## Testing

Admin UI has no test harness, so verification is manual:
1. Search a known old/hallucinated recipe (e.g. one with mismatched title vs content).
2. Click Re-enrich → confirm modal appears → confirm → success toast with ingredient
   count and provenance; reload shows corrected content (if re-openable in a drilldown).
3. Confirm a recipe whose source is unreachable shows "content unchanged".
4. `cd apps/admin-ui && npm run build` succeeds.

No automated UI test added; absence is intentional and noted.

## Out of scope

- Bulk re-enrich (declined — fuzzy candidate signal, Gemini cost, no clean drain).
- Image re-host UI (parked: `2026-05-22-admin-rehost-preview-image-ui-design.md`).
- Provenance hint chip (declined).
