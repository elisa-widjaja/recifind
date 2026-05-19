# Estimated cook-time for recipes missing a duration

**Date:** 2026-05-19
**Status:** Approved design — ready for implementation plan

## Problem

The recipe-detail "timestamp" is the cook-time chip (`⏱ {formatDuration(durationMinutes)}`),
rendered at `apps/recipe-ui/src/App.jsx:5679` (desktop) and `:5887` (mobile). Both render
only when `activeRecipeView.durationMinutes` is truthy.

Confirmed via D1 (2026-05-19): of 433 fully-detailed recipes, **129 (~30%)** have complete
ingredients/steps but `duration_minutes` null/0, so the chip is absent for them and present
for others — the user-visible inconsistency. Root cause is a data gap: the Gemini parser
(`buildExtractOnlyPrompt`, `worker/src/index.ts:5167`) is deliberately extract-only and most
social captions never state a cook time, so `durationMinutes` stays null even when
ingredients/steps extract perfectly. It is **not** a rendering bug.

## Approach

Fill the gap with a **deterministic estimate** derived from the recipe's own steps/ingredients:

1. Persist an estimate on enrichment for **new** recipes.
2. One-time backfill for the **129** existing detailed-but-no-duration recipes.
3. A display-only **fallback** as a safety net for anything still missing.

Provenance is left untouched and the estimate is shown like any other time (no "~" prefix).
The Gemini prompt is **not** modified (avoids regressing ingredient/step extraction).

## Components

### 1. Shared heuristic — `estimateDurationMinutes(steps, ingredients)`

Pure function. Algorithm (option B, step-count + text-weighted):

- Base contribution per step, weighted by that step's text length (longer instruction → more time).
- Cook-verb signals add fixed minutes: `simmer`, `bake`, `roast`, `rest`, `chill`, `marinate`,
  `proof` (long); quick verbs (`mix`, `stir`, `combine`) add little.
- Small additive term proportional to ingredient count (prep time).
- `clamp(result, 10, 120)`.
- If `steps` is empty or too thin → return `0` (caller renders nothing; never show a fake time).

**Placement & anti-drift:** `apps/worker` (TS) and `apps/recipe-ui` (JS) cannot share a module.
The function is implemented in **both** (`apps/worker/src/` and `apps/recipe-ui/src/utils/`),
driven from **one shared test-vector fixture** (JSON: inputs → expected minutes) that both test
suites assert against. This guarantees the two implementations cannot silently diverge, so
owner / viewer / backfilled values always agree.

### 2. Persist on enrichment (new recipes)

In the enrichment pipeline, immediately before the existing D1
`UPDATE … SET … duration_minutes = ? …` (`apps/worker/src/index.ts:~2815`): if
`result.durationMinutes` is null/≤0, set it to
`estimateDurationMinutes(result.steps, result.ingredients)`.

Rides the **existing** UPDATE — **zero additional D1 writes**. `provenance` untouched.

### 3. One-time backfill (the 129)

A one-shot script (not a permanent endpoint):

1. One `wrangler d1 execute --remote --json` SELECT of `id, steps, ingredients` where
   `duration_minutes IS NULL OR duration_minutes <= 0` and content is detailed.
2. Compute estimates locally in JS using the shared function.
3. Emit a single batched SQL file of `UPDATE` statements.
4. Apply with one `wrangler d1 execute --remote --file`.

Total cost: ~1 read query + 1 batched write (~129 rows). Far inside free-tier limits.
Script is dry-run-first (print computed values before applying) and is deleted after the
one-time run.

### 4. Display-only fallback (safety net)

At the two render sites (`App.jsx:5679` & `:5887`): when `activeRecipeView.durationMinutes`
is falsy, fall back to `estimateDurationMinutes(activeRecipeView.steps,
activeRecipeView.ingredients)`; render the chip only if that result is `> 0`. Silent (no "~").
Non-owners receive `steps` in the shared-recipe payload
(`handleGetSharedRecipe`, `worker/src/index.ts:2274`), so the fallback works for them too.

### 5. Tests

- Shared test-vector fixture (inputs → expected minutes).
- Worker unit test: heuristic against vectors + "enrichment fills missing duration when null/0".
- Frontend unit test: mirrored heuristic against the same vectors.
- Backfill script: manual dry-run (print before apply) — verified, not committed as a test.

## Out of scope (YAGNI)

- Changing the Gemini extract-only prompt.
- Recipe-card / feed / OG-meta / sort-by-time display of the estimate.
- Any "estimated" UI indicator (tilde, tooltip, provenance change).

## Risk notes

- Free-tier D1: negligible — enrichment persist is zero extra writes; backfill is ~129 writes
  (1 batched execute) one-time.
- Content parsing: untouched. The Gemini extract-only prompt is not modified; estimation is a
  pure post-processing function of already-extracted data.
- Heuristic accuracy: it is an estimate, accepted as such (shown silently per decision).
