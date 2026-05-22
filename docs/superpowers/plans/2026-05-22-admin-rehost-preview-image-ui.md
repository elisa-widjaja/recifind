# Admin Re-host Preview Image UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin app a bulk runner to drain the stale-image backlog and a stale-aware per-recipe "Re-host" button, both on top of the existing `POST /admin/migrate-images` endpoint.

**Architecture:** One additive backend change surfaces each recipe copy's image status in the admin search response (`none` / `hosted` / `stale`). The admin UI adds a dedicated "Image migration" page (batch sweep) and a per-owner-row "Re-host" button on the Recipes page (enabled only when the image is `stale`). No change to `migrate-images`, `fetchOgImage`, or `persistPreviewImage`.

**Tech Stack:** Cloudflare Worker (TypeScript, vitest); admin-ui (React + MUI + Vite, hash-routed; no test harness).

**Spec:** `docs/superpowers/specs/2026-05-22-admin-rehost-preview-image-ui-design.md`

---

## Task 1: Backend — `deriveImageStatus` helper (TDD)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (add export near the other pure helpers, e.g. after `isAdminEmail`)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/routes/admin.test.ts` — extend the import line and add a describe block:

```ts
import { deriveImageStatus } from './admin';

describe('deriveImageStatus', () => {
  it("returns 'none' for empty, null, undefined, or whitespace", () => {
    expect(deriveImageStatus('')).toBe('none');
    expect(deriveImageStatus(null)).toBe('none');
    expect(deriveImageStatus(undefined)).toBe('none');
    expect(deriveImageStatus('   ')).toBe('none');
  });

  it("returns 'hosted' for a Supabase public storage URL", () => {
    expect(
      deriveImageStatus(
        'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/preview/u/r/x.jpg'
      )
    ).toBe('hosted');
  });

  it("returns 'stale' for an external CDN URL", () => {
    expect(
      deriveImageStatus('https://scontent-sjc6-1.cdninstagram.com/v/t51.jpg?oh=abc&oe=def')
    ).toBe('stale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t deriveImageStatus`
Expected: FAIL — `deriveImageStatus` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/worker/src/routes/admin.ts`:

```ts
export type ImageStatus = 'none' | 'hosted' | 'stale';

// Classify a recipe's image_url for the admin UI. The Supabase public-URL marker
// is a stable substring, so no env is needed.
export function deriveImageStatus(imageUrl: string | null | undefined): ImageStatus {
  const u = (imageUrl || '').trim();
  if (!u) return 'none';
  if (u.includes('/storage/v1/object/public/')) return 'hosted';
  return 'stale';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t deriveImageStatus`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin-api): add deriveImageStatus helper"
```

---

## Task 2: Backend — surface `image_status` in recipe search

**Files:**
- Modify: `apps/worker/src/routes/admin.ts` (`buildRecipeSearchQuery` ~`:856`, `handleAdminSearchRecipes` owner push ~`:907`)
- Test: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `buildRecipeSearchQuery` describe block in `admin.test.ts` (or create one):

```ts
describe('buildRecipeSearchQuery image_url', () => {
  it('selects r.image_url so image status can be derived', () => {
    const { sql } = buildRecipeSearchQuery({ q: 'pie', limit: 10 });
    expect(sql).toContain('r.image_url');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts -t "image_url"`
Expected: FAIL — SQL does not contain `r.image_url`.

- [ ] **Step 3: Add `image_url` to the query**

In `buildRecipeSearchQuery`, add the column to the SELECT (after `source_url`):

```ts
      r.source_url          AS source_url,
      r.image_url           AS image_url,
      r.created_at          AS created_at,
```

- [ ] **Step 4: Add `image_status` to each owner**

In `handleAdminSearchRecipes`, update the `g.owners.push({ ... })` object to include:

```ts
    g.owners.push({
      id: r.id,
      user_id: r.user_id,
      email: r.owner_email || null,
      display_name: r.owner_display_name || null,
      created_at: r.created_at,
      shared_with_friends: r.shared_with_friends,
      hidden_at: r.hidden_at || null,
      image_status: deriveImageStatus(r.image_url),
    });
```

(`deriveImageStatus` is already in this module from Task 1 — no import needed.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS (all admin tests, including the new image_url assertion).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin-api): return image_status per recipe copy in search"
```

---

## Task 3: Frontend — "Image migration" bulk runner page

> The admin-ui has no test harness, so Tasks 3–4 are implement-then-manually-verify. No failing-test-first step.

**Files:**
- Create: `apps/admin-ui/src/pages/ImageMigration.jsx`
- Modify: `apps/admin-ui/src/App.jsx` (import + `Router`)
- Modify: `apps/admin-ui/src/components/SidebarNav.jsx` (nav entry)

- [ ] **Step 1: Create the page**

Create `apps/admin-ui/src/pages/ImageMigration.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Box, Button, Chip, CircularProgress, Divider, Snackbar, Stack, Typography } from '@mui/material';
import { fetchAdmin } from '../api';

const BATCH = 10;
const statusColor = (s) => (s === 'rehosted' ? 'success' : s === 'cleared' ? 'warning' : 'error');

export default function ImageMigration() {
  const [remaining, setRemaining] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState('');

  const refreshCount = () => {
    setLoading(true);
    fetchAdmin('/admin/migrate-images', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, batchSize: BATCH }),
    })
      .then((d) => setRemaining(d.totalRemaining ?? 0))
      .catch((e) => setToast(`Failed to load count: ${e.message}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refreshCount(); }, []);

  const runBatch = () => {
    setRunning(true);
    fetchAdmin('/admin/migrate-images', {
      method: 'POST',
      body: JSON.stringify({ dryRun: false, batchSize: BATCH }),
    })
      .then((d) => {
        setRemaining(d.totalRemaining ?? 0);
        setLog((prev) => [...(d.results || []), ...prev]);
        const c = d.counts || {};
        setToast(`Batch done — ${c.rehosted || 0} re-hosted, ${c.cleared || 0} cleared, ${c.failed || 0} failed`);
      })
      .catch((e) => setToast(`Batch failed: ${e.message}`))
      .finally(() => setRunning(false));
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Image migration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Re-hosts recipe preview images that still point at expiring Instagram/TikTok CDN
        URLs onto Supabase storage. Runs in batches of {BATCH}. A “cleared” result means
        the source post no longer returns an image and the recipe image was removed.
      </Typography>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h6">
          {loading || remaining === null
            ? <CircularProgress size={20} />
            : `${remaining} recipe(s) with stale images`}
        </Typography>
        <Button variant="contained" disabled={running || loading || remaining === 0} onClick={runBatch}>
          {running ? 'Re-hosting…' : 'Re-host next batch'}
        </Button>
        {remaining === 0 && <Chip color="success" label="All clear" />}
      </Stack>

      {log.length > 0 && (
        <>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Results ({log.length})</Typography>
          <Stack spacing={0.5} sx={{ maxHeight: 480, overflow: 'auto' }}>
            {log.map((r, i) => (
              <Stack key={`${r.id}-${i}`} direction="row" spacing={1} alignItems="center">
                <Chip size="small" color={statusColor(r.status)} label={r.status} />
                <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title || r.id}{r.reason ? ` — ${r.reason}` : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </>
      )}

      <Snackbar open={!!toast} autoHideDuration={4000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}
```

- [ ] **Step 2: Wire the route into `App.jsx`**

Add the import alongside the other page imports:

```jsx
import ImageMigration from './pages/ImageMigration';
```

In the `Router` function, add the route before the `Dashboard` fallback:

```jsx
  if (hash === '#/image-migration') return <ImageMigration />;
```

- [ ] **Step 3: Add the nav entry in `SidebarNav.jsx`**

After the "Recipes" `ListItemButton`:

```jsx
          <ListItemButton onClick={nav('#/image-migration')}><ListItemText primary="Image migration" /></ListItemButton>
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd apps/admin-ui && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-ui/src/pages/ImageMigration.jsx apps/admin-ui/src/App.jsx apps/admin-ui/src/components/SidebarNav.jsx
git commit -m "feat(admin-ui): add Image migration bulk re-host page"
```

---

## Task 4: Frontend — stale-aware per-recipe "Re-host" button

**Files:**
- Modify: `apps/admin-ui/src/pages/Recipes.jsx`

- [ ] **Step 1: Add the re-host handler**

In the `Recipes` component, after `doUnhide` (~`:58`), add:

```jsx
  const doRehost = (rid) =>
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

- [ ] **Step 2: Pass `onRehost` down to the row component**

In the `data.groups.map(...)` render, add the prop to `<RecipeGroupRow>`:

```jsx
                <RecipeGroupRow
                  key={g.key}
                  g={g}
                  open={!!expanded[g.key]}
                  onToggle={() => toggle(g.key)}
                  onHide={(rid) => setConfirm({ recipeId: rid, title: g.title })}
                  onUnhide={doUnhide}
                  onRehost={doRehost}
                />
```

- [ ] **Step 3: Update `RecipeGroupRow` signature and inner table header**

Change the function signature:

```jsx
function RecipeGroupRow({ g, open, onToggle, onHide, onUnhide, onRehost }) {
```

In the inner `<TableHead>`, add an "Image" header before the trailing empty action header, and widen the action header:

```jsx
                  <TableRow>
                    <TableCell sx={{ width: CARET_W, px: 0 }} />
                    <TableCell sx={{ width: COL1_W, pl: 0.5 }}>Owner</TableCell>
                    <TableCell>Recipe ID</TableCell>
                    <TableCell>Saved</TableCell>
                    <TableCell>Visibility</TableCell>
                    <TableCell sx={{ width: 96 }}>Image</TableCell>
                    <TableCell sx={{ width: 168 }} />
                  </TableRow>
```

Keep all other headers unchanged.

- [ ] **Step 4: Add the image-status chip + Re-host button to each owner row**

In the `g.owners.map((o) => (...))` row, add two cells after the Visibility cell, replacing the existing trailing action `<TableCell>`:

```jsx
                      <TableCell sx={{ width: 96 }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={o.image_status === 'stale' ? 'warning' : o.image_status === 'hosted' ? 'success' : 'default'}
                          label={o.image_status || 'none'}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ width: 168 }}>
                        <Button
                          size="small"
                          disabled={o.image_status !== 'stale'}
                          title={o.image_status === 'stale'
                            ? 'Re-host this image onto Supabase'
                            : `Image is ${o.image_status || 'none'} — nothing to re-host`}
                          onClick={() => onRehost(o.id)}
                        >
                          Re-host
                        </Button>
                        {o.hidden_at ? (
                          <Button size="small" onClick={() => onUnhide(o.id)}>Unhide</Button>
                        ) : (
                          <Button size="small" onClick={() => onHide(o.id)}>Hide</Button>
                        )}
                      </TableCell>
```

- [ ] **Step 5: Build to verify it compiles**

Run: `cd apps/admin-ui && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-ui/src/pages/Recipes.jsx
git commit -m "feat(admin-ui): stale-aware per-recipe Re-host button"
```

---

## Task 5: Manual verification

**No automated UI tests** (admin-ui has no harness). Verify against a running admin app pointed at the prod (or `--remote` dev) worker, logged in as an admin.

- [ ] **Step 1: Per-recipe button**
  - Open `#/recipes`, search a recipe known to have a stale Instagram/TikTok image.
  - Confirm its owner row shows a `stale` (orange) chip and an enabled **Re-host** button.
  - Click Re-host → toast "Image re-hosted" → after reload the chip flips to `hosted` (green) and the button is disabled.
  - Confirm a recipe already on Supabase shows `hosted` with the button disabled.

- [ ] **Step 2: Bulk runner**
  - Open `#/image-migration`. Confirm it shows "N recipe(s) with stale images".
  - Click **Re-host next batch** → results log fills with `rehosted` (and any `cleared`/`failed` with reasons) → count decrements.
  - Repeat until "All clear".

- [ ] **Step 3: Final confirmation**
  - Re-run `cd apps/worker && npm test` → all green.
  - Confirm no changes to `fetchOgImage` / `persistPreviewImage` / the import path.

---

## Notes for the executor

- **Deploys are manual** (per CLAUDE.md): worker via `cd apps/worker && npx wrangler deploy`; admin-ui via its own build/deploy (confirm the admin Pages project before deploying).
- **Do not** widen the bulk hostname filter or alter `migrate-images` — out of scope.
- The `migrate-images` endpoint already writes an audit-log entry on real runs; both flows are covered automatically.
