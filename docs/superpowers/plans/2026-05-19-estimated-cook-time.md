# Estimated Cook-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a cook-time chip on every detailed recipe by filling missing `duration_minutes` with a shared deterministic estimate (persist on enrichment, one-time backfill, display-only fallback).

**Architecture:** One pure heuristic `estimateDurationMinutes(steps, ingredients)` implemented identically in worker (TS) and frontend (JS), pinned by a single shared JSON test-vector fixture both suites assert against. Worker enrichment fills the estimate before its existing D1 UPDATE (zero extra writes). A one-off script backfills the 129 existing rows. The frontend recipe-detail view computes the same estimate as a render-time fallback when no stored value exists.

**Tech Stack:** Cloudflare Worker (TypeScript, vitest), React/Vite frontend (JS, vitest), wrangler D1.

> **Project workflow note:** Work directly on `main` (no branches/worktrees). Commit and deploy steps require explicit user go-ahead — do not auto-run them.

---

## File Structure

- Create `test-fixtures/duration-vectors.json` — canonical input→expected vectors, imported by both test suites (anti-drift).
- Create `apps/worker/src/estimateDuration.ts` — worker heuristic + `ensureEstimatedDuration` helper.
- Create `apps/worker/src/estimateDuration.test.ts` — asserts heuristic + helper against the fixture.
- Modify `apps/worker/src/index.ts` — call `ensureEstimatedDuration(result)` after each enrichment chain run.
- Create `apps/recipe-ui/src/utils/estimateDuration.js` — frontend mirror of the heuristic.
- Create `apps/recipe-ui/src/utils/estimateDuration.test.js` — asserts mirror against the same fixture.
- Modify `apps/recipe-ui/src/App.jsx` — compute one display-duration fallback, use it at both render sites.
- Create `scripts/backfill-duration.mjs` — one-time backfill (dry-run first), deleted after the run.

---

### Task 1: Shared test-vector fixture

**Files:**
- Create: `test-fixtures/duration-vectors.json`

- [ ] **Step 1: Create the fixture**

```json
[
  { "name": "empty steps -> 0", "steps": [], "ingredients": ["a", "b"], "expected": 0 },
  { "name": "simple no-verb", "steps": ["Chop the onions", "Add to pan", "Serve hot"], "ingredients": ["onion", "oil", "salt", "pepper"], "expected": 11 },
  { "name": "bake + rest", "steps": ["Preheat oven and bake the cake for 35 minutes", "Let it rest before serving"], "ingredients": ["flour", "sugar", "eggs", "butter", "milk", "vanilla", "baking powder", "salt"], "expected": 45 },
  { "name": "many short steps mid", "stepsRepeat": { "text": "Mix", "count": 30 }, "ingredientsCount": 0, "expected": 90 },
  { "name": "clamp upper", "stepsRepeat": { "text": "Marinate then bake then chill then simmer then rest then boil the mixture thoroughly and carefully for a long time until done", "count": 50 }, "ingredientsCount": 20, "expected": 120 }
]
```

- [ ] **Step 2: Commit** (requires user go-ahead)

```bash
git add test-fixtures/duration-vectors.json
git commit -m "test(fixture): shared duration-estimate vectors"
```

---

### Task 2: Worker heuristic + helper (TDD)

**Files:**
- Create: `apps/worker/src/estimateDuration.ts`
- Test: `apps/worker/src/estimateDuration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import vectors from '../../../test-fixtures/duration-vectors.json';
import { estimateDurationMinutes, ensureEstimatedDuration } from './estimateDuration';

function buildCase(v: any) {
  const steps = v.steps ?? Array(v.stepsRepeat.count).fill(v.stepsRepeat.text);
  const ingredients = v.ingredients ?? Array(v.ingredientsCount ?? 0).fill('x');
  return { steps, ingredients, expected: v.expected, name: v.name };
}

describe('estimateDurationMinutes', () => {
  for (const v of vectors as any[]) {
    const c = buildCase(v);
    it(c.name, () => {
      expect(estimateDurationMinutes(c.steps, c.ingredients)).toBe(c.expected);
    });
  }
  it('returns 0 for non-array steps', () => {
    expect(estimateDurationMinutes(undefined as any, [])).toBe(0);
  });
});

describe('ensureEstimatedDuration', () => {
  it('fills durationMinutes when null and steps exist', () => {
    const r: any = { durationMinutes: null, steps: ['Chop the onions', 'Add to pan', 'Serve hot'], ingredients: ['onion', 'oil', 'salt', 'pepper'] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(11);
  });
  it('leaves an existing positive durationMinutes untouched', () => {
    const r: any = { durationMinutes: 25, steps: ['x'], ingredients: [] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(25);
  });
  it('stays null when there are no steps', () => {
    const r: any = { durationMinutes: 0, steps: [], ingredients: ['a'] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/estimateDuration.test.ts`
Expected: FAIL — cannot find module `./estimateDuration`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/worker/src/estimateDuration.ts
// Pure, deterministic cook-time estimate. MUST stay byte-for-byte equivalent
// to apps/recipe-ui/src/utils/estimateDuration.js — both are pinned by
// test-fixtures/duration-vectors.json so they cannot silently drift.

export function estimateDurationMinutes(steps: unknown, ingredients: unknown): number {
  const s = Array.isArray(steps)
    ? steps.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  if (s.length === 0) return 0;
  const ing = Array.isArray(ingredients)
    ? ingredients.filter((x) => String(x ?? '').trim())
    : [];

  let minutes = 0;
  for (const step of s) {
    minutes += 3;
    minutes += Math.min(Math.floor(step.length / 80), 4);
  }

  const joined = s.join(' ').toLowerCase();
  const verbBonuses: Array<[RegExp, number]> = [
    [/\bmarinat/, 30],
    [/\b(bake|roast)\b/, 20],
    [/\b(chill|refrigerat)/, 20],
    [/\bsimmer\b/, 15],
    [/\b(rest|proof|rise|prove)\b/, 15],
    [/\bboil\b/, 10],
  ];
  for (const [re, bonus] of verbBonuses) {
    if (re.test(joined)) minutes += bonus;
  }

  minutes += Math.round(Math.min(ing.length, 15) * 0.5);

  minutes = Math.round(minutes);
  if (minutes < 10) minutes = 10;
  if (minutes > 120) minutes = 120;
  return minutes;
}

export function ensureEstimatedDuration<T extends { durationMinutes: number | null; steps?: unknown; ingredients?: unknown }>(r: T): T {
  if ((r.durationMinutes == null || r.durationMinutes <= 0)) {
    const est = estimateDurationMinutes(r.steps, r.ingredients);
    r.durationMinutes = est > 0 ? est : null;
  }
  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/estimateDuration.test.ts`
Expected: PASS (all fixture cases + helper cases).

- [ ] **Step 5: Commit** (requires user go-ahead)

```bash
git add apps/worker/src/estimateDuration.ts apps/worker/src/estimateDuration.test.ts
git commit -m "feat(worker): deterministic cook-time estimate helper"
```

---

### Task 3: Frontend mirror heuristic (TDD, same fixture)

**Files:**
- Create: `apps/recipe-ui/src/utils/estimateDuration.js`
- Test: `apps/recipe-ui/src/utils/estimateDuration.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import vectors from '../../../../test-fixtures/duration-vectors.json';
import { estimateDurationMinutes } from './estimateDuration';

function buildCase(v) {
  const steps = v.steps ?? Array(v.stepsRepeat.count).fill(v.stepsRepeat.text);
  const ingredients = v.ingredients ?? Array(v.ingredientsCount ?? 0).fill('x');
  return { steps, ingredients, expected: v.expected, name: v.name };
}

describe('estimateDurationMinutes (frontend mirror)', () => {
  for (const v of vectors) {
    const c = buildCase(v);
    it(c.name, () => {
      expect(estimateDurationMinutes(c.steps, c.ingredients)).toBe(c.expected);
    });
  }
  it('returns 0 for non-array steps', () => {
    expect(estimateDurationMinutes(undefined, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-ui && npx vitest run src/utils/estimateDuration.test.js`
Expected: FAIL — cannot find module `./estimateDuration`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// apps/recipe-ui/src/utils/estimateDuration.js
// Pure, deterministic cook-time estimate. MUST stay equivalent to
// apps/worker/src/estimateDuration.ts — both pinned by
// test-fixtures/duration-vectors.json so they cannot silently drift.

export function estimateDurationMinutes(steps, ingredients) {
  const s = Array.isArray(steps)
    ? steps.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  if (s.length === 0) return 0;
  const ing = Array.isArray(ingredients)
    ? ingredients.filter((x) => String(x ?? '').trim())
    : [];

  let minutes = 0;
  for (const step of s) {
    minutes += 3;
    minutes += Math.min(Math.floor(step.length / 80), 4);
  }

  const joined = s.join(' ').toLowerCase();
  const verbBonuses = [
    [/\bmarinat/, 30],
    [/\b(bake|roast)\b/, 20],
    [/\b(chill|refrigerat)/, 20],
    [/\bsimmer\b/, 15],
    [/\b(rest|proof|rise|prove)\b/, 15],
    [/\bboil\b/, 10],
  ];
  for (const [re, bonus] of verbBonuses) {
    if (re.test(joined)) minutes += bonus;
  }

  minutes += Math.round(Math.min(ing.length, 15) * 0.5);

  minutes = Math.round(minutes);
  if (minutes < 10) minutes = 10;
  if (minutes > 120) minutes = 120;
  return minutes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-ui && npx vitest run src/utils/estimateDuration.test.js`
Expected: PASS — identical results to the worker suite (same fixture).

- [ ] **Step 5: Commit** (requires user go-ahead)

```bash
git add apps/recipe-ui/src/utils/estimateDuration.js apps/recipe-ui/src/utils/estimateDuration.test.js
git commit -m "feat(ui): frontend mirror of cook-time estimate"
```

---

### Task 4: Wire estimate into worker enrichment

**Files:**
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Add the import**

Add near the other top-of-file imports in `apps/worker/src/index.ts`:

```typescript
import { ensureEstimatedDuration } from './estimateDuration';
```

- [ ] **Step 2: Locate both enrichment-chain call sites**

Run: `cd apps/worker && grep -n "= await runChain(\|= await runEnrichmentChain(" src/index.ts`
Expected: two destructuring call sites of the form
`const { result, winningStrategy } = await runChain(...)` (re-enrich handler, ~line 2641 region) and the same inside `enrichAfterSave` (~line 5457 region).

- [ ] **Step 3: Insert the estimate fill at each call site**

At **each** location, immediately after the line
`const { result, winningStrategy } = await runChain(...)` (or `await runEnrichmentChain(...)`), add:

```typescript
  ensureEstimatedDuration(result);
```

This mutates `result.durationMinutes` in place before the existing
`UPDATE recipes SET ... duration_minutes = ? ...` runs, so no extra D1 write
is incurred. Both the re-enrich handler and `enrichAfterSave` already bind
`result.durationMinutes` into that UPDATE.

- [ ] **Step 4: Run the worker test suite**

Run: `cd apps/worker && npm test`
Expected: PASS — existing enrich/re-enrich tests still green; `estimateDuration.test.ts` green.

- [ ] **Step 5: Commit** (requires user go-ahead)

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): fill missing duration_minutes during enrichment"
```

---

### Task 5: Display-only fallback in recipe detail

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Add the import**

Add near the other `./utils/...` imports in `apps/recipe-ui/src/App.jsx`:

```javascript
import { estimateDurationMinutes } from './utils/estimateDuration';
```

- [ ] **Step 2: Compute one fallback value next to `activeRecipeView`**

Find the line (around `App.jsx:3384`):

```javascript
  const activeRecipeView = isSharedRecipeView ? activeRecipe : activeRecipeDraft;
```

Immediately after it, add:

```javascript
  const activeRecipeDisplayDuration = activeRecipeView
    ? (activeRecipeView.durationMinutes
        || estimateDurationMinutes(activeRecipeView.steps, activeRecipeView.ingredients))
    : 0;
```

- [ ] **Step 3: Use the fallback at both render sites**

There are two identical blocks (desktop `App.jsx:5679`, mobile `App.jsx:5887`):

```jsx
                {!isEditMode && activeRecipeView.durationMinutes ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(activeRecipeView.durationMinutes)}
                    </Typography>
                  </Box>
                ) : null}
```

In **both**, replace `activeRecipeView.durationMinutes` (the guard) with
`activeRecipeDisplayDuration` and `formatDuration(activeRecipeView.durationMinutes)`
with `formatDuration(activeRecipeDisplayDuration)`. Resulting block:

```jsx
                {!isEditMode && activeRecipeDisplayDuration ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(activeRecipeDisplayDuration)}
                    </Typography>
                  </Box>
                ) : null}
```

(The mobile block at `:5887` uses the same inner styles; apply the same two substitutions there.)

- [ ] **Step 4: Build to verify no syntax errors**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run the frontend test suite**

Run: `cd apps/recipe-ui && npm test`
Expected: PASS — existing suites green; `estimateDuration.test.js` green.

- [ ] **Step 6: Commit** (requires user go-ahead)

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): estimate cook time as recipe-detail fallback"
```

---

### Task 6: One-time backfill script (dry-run first)

**Files:**
- Create: `scripts/backfill-duration.mjs`

- [ ] **Step 1: Write the script**

```javascript
// scripts/backfill-duration.mjs
// One-time backfill of duration_minutes for detailed recipes missing it.
// Dry-run by default; set APPLY=1 to write. Delete this file after the run.
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { estimateDurationMinutes } from '../apps/recipe-ui/src/utils/estimateDuration.js';

const SELECT = `SELECT id, steps, ingredients FROM recipes \
WHERE (duration_minutes IS NULL OR duration_minutes <= 0) \
AND ingredients IS NOT NULL AND ingredients != '[]' AND length(ingredients) > 4 \
AND steps IS NOT NULL AND steps != '[]' AND length(steps) > 4;`;

const raw = execSync(
  `npx wrangler d1 execute recipes-db --remote --json --command "${SELECT.replace(/"/g, '\\"')}"`,
  { cwd: 'apps/worker', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
const rows = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1))[0].results;

const updates = [];
for (const r of rows) {
  let steps = [];
  let ingredients = [];
  try { steps = JSON.parse(r.steps || '[]'); } catch {}
  try { ingredients = JSON.parse(r.ingredients || '[]'); } catch {}
  const est = estimateDurationMinutes(steps, ingredients);
  if (est > 0) updates.push({ id: r.id, est });
}

console.log(`Rows matched: ${rows.length}, will update: ${updates.length}`);
for (const u of updates) console.log(`${u.id} -> ${u.est} min`);

if (process.env.APPLY === '1' && updates.length) {
  const sql = updates
    .map((u) => `UPDATE recipes SET duration_minutes = ${u.est} WHERE id = '${u.id.replace(/'/g, "''")}';`)
    .join('\n');
  const file = 'scripts/.tmp-backfill.sql';
  writeFileSync(file, sql);
  execSync(`npx wrangler d1 execute recipes-db --remote --file ../../${file}`, {
    cwd: 'apps/worker', stdio: 'inherit',
  });
  rmSync(file);
  console.log('Applied.');
} else {
  console.log('Dry run only. Re-run with APPLY=1 to write.');
}
```

- [ ] **Step 2: Dry run and review output**

Run: `cd /Users/elisa/Desktop/VibeCode && node scripts/backfill-duration.mjs`
Expected: prints "Rows matched: ~129, will update: ~129" and an `id -> N min` list. No DB writes. Inspect a few values for sanity.

- [ ] **Step 3: Apply the backfill** (requires user go-ahead)

Run: `cd /Users/elisa/Desktop/VibeCode && APPLY=1 node scripts/backfill-duration.mjs`
Expected: "Applied." — one batched `wrangler d1 execute --file` write.

- [ ] **Step 4: Verify in D1**

Run from `apps/worker`:
`npx wrangler d1 execute recipes-db --remote --command "SELECT COUNT(*) AS n FROM recipes WHERE (duration_minutes IS NULL OR duration_minutes <= 0) AND ingredients != '[]' AND length(ingredients) > 4 AND steps != '[]' AND length(steps) > 4;"`
Expected: `n` is 0 (or only rows whose estimate computed to 0, i.e. effectively none).

- [ ] **Step 5: Delete the one-off script and commit** (requires user go-ahead)

```bash
git rm scripts/backfill-duration.mjs
git commit -m "chore: remove one-time duration backfill script after run"
```

---

### Task 7: Deploy & verify

- [ ] **Step 1: Deploy the worker** (requires user go-ahead)

Run: `cd apps/worker && npx wrangler deploy`
Expected: deployment succeeds.

- [ ] **Step 2: Deploy the frontend** (requires user go-ahead — check `git status` first per project workflow)

Run: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
Expected: deployment succeeds.

- [ ] **Step 3: Verify on production**

Open a previously-affected detailed recipe (one of the 129) on https://recifriend.com and confirm the `⏱` cook-time chip now renders. Open a freshly-added social recipe with no stated time and confirm the chip appears after enrichment.

---

## Self-Review

- **Spec coverage:** Heuristic B (Task 2/3), shared fixture anti-drift (Task 1), persist-on-enrichment zero-extra-write (Task 4), one-time backfill (Task 6), display-only silent fallback incl. non-owners via shared `steps` payload (Task 5), tests (Tasks 2/3), provenance untouched (`ensureEstimatedDuration` only sets `durationMinutes`). Out-of-scope items not implemented. ✅ Covered.
- **Placeholder scan:** No TBD/TODO; all code blocks complete; exact paths and commands given. ✅
- **Type consistency:** `estimateDurationMinutes(steps, ingredients)` and `ensureEstimatedDuration(r)` signatures identical across worker/frontend/script/tests; fixture field names (`steps`, `ingredients`, `stepsRepeat.{text,count}`, `ingredientsCount`, `expected`) used consistently by both test harnesses. ✅
