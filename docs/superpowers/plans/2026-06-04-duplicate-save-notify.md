# Duplicate-save detect & notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saving a recipe whose `(user_id, source_url)` already exists never creates a second row; the user is told "already in your collection", and an empty failed-import row is healed on re-save instead of dead-ending.

**Architecture:** Server-side detection in `handleCreateRecipe` replaces the 60s-bounded dedup with an unbounded `(user_id, source_url)` match. On a hit: existing-has-content → pure dedup; existing-empty + incoming-has-content → backfill the row; existing-empty + incoming-empty → re-trigger `enrichAfterSave` on the existing id. Response gains a `duplicate` boolean the web + native clients use to swap the toast.

**Tech Stack:** Cloudflare Worker (TypeScript, vitest), React/MUI frontend (`App.jsx`, no unit-test infra), Swift iOS Share Extension.

Spec: `docs/superpowers/specs/2026-06-04-duplicate-save-notify-design.md`

---

## File Structure

- `apps/worker/src/index.ts` — MODIFY `handleCreateRecipe` dedup block (~2469-2482) + fresh-save response (~2596); ADD `backfillEmptyRecipe` helper near it; export it.
- `apps/worker/src/create-recipe.test.ts` — MODIFY mock to drive existing-row content + capture backfill UPDATE; MODIFY the stale waitUntil test; ADD duplicate-flag + backfill + re-enrich tests.
- `apps/recipe-ui/src/App.jsx` — MODIFY 3 save handlers + `resetFormState` to branch the snackbar on `duplicate`.
- `apps/ios/ios/App/ShareExtension/ShareFormView.swift` — MODIFY the saved-state label to read "Already in your collection" on HTTP 200.

No unit-test harness exists for `App.jsx` or the Swift extension; those tasks end in manual verification + the prod smoke test (Task 8).

---

## Task 1: Worker — unbounded dedup returns `duplicate: true` for a content-bearing existing row

**Files:**
- Modify: `apps/worker/src/index.ts:2469-2482` (dedup block) and `:2596` (fresh-save return)
- Test: `apps/worker/src/create-recipe.test.ts`

- [ ] **Step 1: Extend the mock to drive existing-row content**

In `create-recipe.test.ts`, replace the `makeMockDb` signature/`fullRecipeRow` (lines 5-33) so a test can give the existing row real ingredients/steps and so backfill UPDATEs are captured. Replace lines 5-33 with:

```ts
function makeMockDb(options: {
  existingRecipe?: { id: string; created_at: string } | null;
  existingIngredients?: string[];
  existingSteps?: string[];
  friends?: Array<{ friend_id: string }>;
  profile?: { display_name?: string } | null;
}) {
  const firstCalls: Array<{ sql: string; binds: any[] }> = [];
  const runCalls: Array<{ sql: string; binds: any[] }> = [];
  const allCalls: Array<{ sql: string; binds: any[] }> = [];

  // Full-row shape that loadRecipe's SELECT * requires — must survive rowToRecipe()
  const fullRecipeRow = options.existingRecipe
    ? {
        id: options.existingRecipe.id,
        user_id: 'user-abc',
        title: 'Pasta',
        source_url: 'https://www.tiktok.com/@u/video/pasta',
        image_url: '',
        image_path: null,
        meal_types: JSON.stringify([]),
        ingredients: JSON.stringify(options.existingIngredients ?? []),
        steps: JSON.stringify(options.existingSteps ?? []),
        duration_minutes: null,
        notes: '',
        preview_image: null,
        shared_with_friends: 0,
        created_at: options.existingRecipe.created_at,
        updated_at: options.existingRecipe.created_at,
      }
    : null;
```

- [ ] **Step 2: Write the failing test (content-bearing duplicate)**

Add inside `describe('handleCreateRecipe dedup', ...)`:

```ts
it('returns existing recipe with duplicate:true and no insert when it already has content', async () => {
  const dupe = { id: 'recipe-existing-123', created_at: new Date(Date.now() - 5 * 86400_000).toISOString() };
  const { db, runCalls } = makeMockDb({
    existingRecipe: dupe,
    existingIngredients: ['1 cup flour'],
    existingSteps: ['Mix'],
  });
  const env = { DB: db as unknown as D1Database } as Env;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const user = { userId: 'user-abc', email: 'a@b.c' };
  const req = new Request('https://worker/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://www.tiktok.com/@u/video/pasta', ingredients: ['1 cup flour'], steps: ['Mix'] }),
  });

  const res = await handleCreateRecipe(req, env, ctx, user as any);
  const body = await res.json() as { recipe: { id: string }; duplicate: boolean };

  expect(res.status).toBe(200);
  expect(body.duplicate).toBe(true);
  expect(body.recipe.id).toBe('recipe-existing-123');
  expect(runCalls.find(c => c.sql.includes('INSERT INTO recipes'))).toBeUndefined();
  expect(runCalls.find(c => c.sql.includes('UPDATE recipes'))).toBeUndefined();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/worker && npx vitest run src/create-recipe.test.ts -t "duplicate:true and no insert"`
Expected: FAIL — `body.duplicate` is `undefined` (current code returns `{ recipe }` only).

- [ ] **Step 4: Implement — rewrite the dedup block**

In `index.ts`, replace the block at lines 2469-2482 (the comment through the closing `}` of `if (recipe.sourceUrl)`) with:

```ts
  // Duplicate detection: a recipe with the same (user_id, source_url) already
  // exists. Never create a second row. Exact-URL match (tracking-param variants
  // intentionally not normalized — see spec). Replaces the old 60s window so
  // re-saves days apart are also caught.
  if (recipe.sourceUrl) {
    const dupe = await env.DB.prepare(
      `SELECT id FROM recipes WHERE user_id = ? AND source_url = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(user.userId, recipe.sourceUrl).first() as { id: string } | null;

    if (dupe) {
      const existing = await loadRecipe(env, user.userId, dupe.id);
      const existingEmpty = existing.ingredients.length === 0 && existing.steps.length === 0;
      const incomingHasContent = recipe.ingredients.length > 0 || recipe.steps.length > 0;

      if (existingEmpty && incomingHasContent) {
        // Failed-import retry where the re-save carries content: heal the row.
        const refreshed = await backfillEmptyRecipe(env, user.userId, dupe.id, recipe);
        return json({ recipe: refreshed, duplicate: true }, 200);
      }

      if (existingEmpty) {
        // Failed-import retry, re-save also empty: give enrichment another shot
        // on the EXISTING id (preserves the old after-60s retry path).
        ctx.waitUntil(
          enrichAfterSave(env, user.userId, dupe.id, recipe.sourceUrl, recipe.title)
            .catch(err => console.error('[enrichAfterSave] failed', { recipeId: dupe.id, err: String(err) }))
        );
        return json({ recipe: existing, duplicate: true }, 200);
      }

      // Existing row already has content -> pure dedup, no write.
      return json({ recipe: existing, duplicate: true }, 200);
    }
  }
```

Note: `DEDUP_WINDOW_MS` (line 2436) is now unused — leave its declaration removed in Task 2's cleanup if no other reference exists; verify with grep before deleting.

- [ ] **Step 5: Add `duplicate: false` to the fresh-save return**

Change `index.ts:2596` from `return json({ recipe }, 201);` to:

```ts
  return json({ recipe, duplicate: false }, 201);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/worker && npx vitest run src/create-recipe.test.ts -t "duplicate:true and no insert"`
Expected: PASS. (`backfillEmptyRecipe` is referenced but only on a branch this test doesn't hit; it must still be defined to compile — implement it in Task 2 before running the full suite. If TypeScript errors on the missing symbol, do Task 2 Step 1-2 first.)

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "feat(worker): detect duplicate saves by (user_id, source_url), return duplicate flag"
```

---

## Task 2: Worker — `backfillEmptyRecipe` helper heals an empty existing row

**Files:**
- Modify: `apps/worker/src/index.ts` (add helper above `handleCreateRecipe`, ~line 2437; remove unused `DEDUP_WINDOW_MS`)
- Test: `apps/worker/src/create-recipe.test.ts`

- [ ] **Step 1: Write the failing test (backfill path)**

Add inside `describe('handleCreateRecipe dedup', ...)`:

```ts
it('backfills an empty existing row from the re-save content (no insert, duplicate:true)', async () => {
  const dupe = { id: 'recipe-empty-1', created_at: new Date(Date.now() - 3 * 86400_000).toISOString() };
  const { db, runCalls } = makeMockDb({
    existingRecipe: dupe,
    existingIngredients: [],
    existingSteps: [],
  });
  const env = { DB: db as unknown as D1Database } as Env;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const user = { userId: 'user-abc', email: 'a@b.c' };
  const req = new Request('https://worker/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://www.tiktok.com/@u/video/pasta', ingredients: ['2 eggs'], steps: ['Whisk'] }),
  });

  const res = await handleCreateRecipe(req, env, ctx, user as any);
  const body = await res.json() as { duplicate: boolean };

  expect(res.status).toBe(200);
  expect(body.duplicate).toBe(true);
  expect(runCalls.find(c => c.sql.includes('INSERT INTO recipes'))).toBeUndefined();
  const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
  expect(update).toBeDefined();
  expect(update!.binds).toContain('recipe-empty-1');
  expect(update!.binds.some(b => typeof b === 'string' && b.includes('eggs'))).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/worker && npx vitest run src/create-recipe.test.ts -t "backfills an empty existing row"`
Expected: FAIL — `backfillEmptyRecipe is not defined` (or no UPDATE captured).

- [ ] **Step 3: Implement the helper**

In `index.ts`, delete the now-unused `const DEDUP_WINDOW_MS = 60_000;` line (verify first: `grep -n DEDUP_WINDOW_MS apps/worker/src/index.ts` returns only that line). In its place add:

```ts
// Heal an empty (no ingredients/steps) existing recipe from a re-save that
// carries content. Only fills columns the old row lacks — never overwrites a
// non-empty title/image. Used by the duplicate-detection path in
// handleCreateRecipe so a failed import the user re-saves gets repaired instead
// of dead-ending. Returns the refreshed recipe.
export async function backfillEmptyRecipe(
  env: Env,
  userId: string,
  recipeId: string,
  recipe: { title: string; imageUrl: string; ingredients: string[]; steps: string[] }
): Promise<Recipe> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE recipes
     SET ingredients = ?, steps = ?,
         title = CASE WHEN title IS NULL OR title = '' THEN ? ELSE title END,
         image_url = CASE WHEN image_url IS NULL OR image_url = '' THEN ? ELSE image_url END,
         updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).bind(
    JSON.stringify(recipe.ingredients),
    JSON.stringify(recipe.steps),
    recipe.title,
    recipe.imageUrl,
    now,
    recipeId,
    userId
  ).run();
  return loadRecipe(env, userId, recipeId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/worker && npx vitest run src/create-recipe.test.ts -t "backfills an empty existing row"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "feat(worker): backfill empty duplicate recipe from re-save content"
```

---

## Task 3: Worker — empty + empty re-save re-triggers enrichment; fix the stale waitUntil test

**Files:**
- Test: `apps/worker/src/create-recipe.test.ts:286-302` (modify) + new test

- [ ] **Step 1: Replace the stale "does NOT fire ctx.waitUntil" test**

That test (lines 286-302) asserts the OLD behavior (dedup never re-enriches). It is now only true when the existing row HAS content. Replace the whole `it('does NOT fire ctx.waitUntil when dedup returns existing row', ...)` block with these two:

```ts
it('does NOT fire ctx.waitUntil when the duplicate already has content', async () => {
  const existing = { id: 'r-dupe', created_at: new Date().toISOString() };
  const { db } = makeMockDb({ existingRecipe: existing, existingIngredients: ['x'], existingSteps: ['y'] });
  const waitUntil = vi.fn();
  const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
  const ctx = { waitUntil } as unknown as ExecutionContext;
  const user = { userId: 'u1', email: 'a@b.c' };
  const req = new Request('https://worker/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://www.tiktok.com/@u/video/bread' }),
  });

  await handleCreateRecipe(req, env, ctx, user as any);
  expect(waitUntil).not.toHaveBeenCalled();
});

it('re-fires enrichAfterSave on the existing id when the duplicate is empty', async () => {
  const existing = { id: 'r-empty', created_at: new Date().toISOString() };
  const { db } = makeMockDb({ existingRecipe: existing, existingIngredients: [], existingSteps: [] });
  const pending: Array<Promise<any>> = [];
  const waitUntil = vi.fn((p: Promise<any>) => { pending.push(p); });
  const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
  const ctx = { waitUntil } as unknown as ExecutionContext;
  const user = { userId: 'u1', email: 'a@b.c' };

  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })));
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  const req = new Request('https://worker/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://www.tiktok.com/@u/video/bread' }),
  });

  const res = await handleCreateRecipe(req, env, ctx, user as any);
  await Promise.allSettled(pending);

  expect(res.status).toBe(200);
  expect(waitUntil).toHaveBeenCalled();
  const enrichLog = logSpy.mock.calls.find(([tag]) => tag === '[enrichAfterSave]');
  expect(enrichLog).toBeDefined();
});
```

- [ ] **Step 2: Run both to verify they pass**

Run: `cd apps/worker && npx vitest run src/create-recipe.test.ts -t "ctx.waitUntil"`
Expected: PASS for the content case; PASS for the empty re-enrich case. (No production code change needed — Task 1's branches already implement this. If the empty test fails, confirm the empty branch in Task 1 Step 4 calls `ctx.waitUntil(enrichAfterSave(...))`.)

- [ ] **Step 3: Run the whole worker suite**

Run: `cd apps/worker && npx vitest run`
Expected: PASS. Watch the pre-existing `handleCreateRecipe dedup` "within 60s" test — it has an empty existing row + empty body, so it now also fires `enrichAfterSave` via the mocked (no-op) `waitUntil`; its existing assertions (no INSERT / notifications / collection_meta) still hold and it does not assert on `waitUntil`, so it stays green. Confirm.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/create-recipe.test.ts
git commit -m "test(worker): empty duplicate re-enriches; content duplicate does not"
```

---

## Task 4: Frontend — `handleSavePublicRecipe` shows the duplicate toast

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (~line 2597-2604, inside `handleSavePublicRecipe`)

No JS unit-test harness for `App.jsx`; verify by reading the diff and the prod smoke test (Task 8).

- [ ] **Step 1: Read the duplicate flag and branch the snackbar**

Replace the success block (the `const { recipe: saved } = await res.json();` through the `setSnackbarState(... saved to your collection! ...)` line) with:

```jsx
      const { recipe: saved, duplicate } = await res.json();
      setRecipes((prev) => {
        const updated = [saved, ...prev.filter((r) => r.id !== saved.id)];
        saveRecipesToCache(updated, session?.user?.id || null, serverVersionRef.current);
        return updated;
      });
      setSnackbarState(
        duplicate
          ? { open: true, message: 'Recipe already in your collection', severity: 'info', duration: 2000 }
          : { open: true, message: `"${recipe.title}" saved to your collection!`, severity: 'success', duration: 2000 }
      );
      dismissSuggestion(recipe.id);
```

- [ ] **Step 2: Verify build compiles**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): show 'already in your collection' on duplicate save (public card)"
```

---

## Task 5: Frontend — `handleSaveSharedRecipe` shows the duplicate toast

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (~line 4711-4719, inside `handleSaveSharedRecipe`)

- [ ] **Step 1: Read the flag and add a duplicate-only toast**

This handler currently shows no success toast. Replace the `const { recipe: savedRecipe } = await response.json();` line and the `setRecipes(...)` block that follows with:

```jsx
      const { recipe: savedRecipe, duplicate } = await response.json();
      setRecipes((prev) => {
        const updated = [savedRecipe, ...prev.filter((r) => r.id !== savedRecipe.id)];
        const userId = session?.user?.id || null;
        saveRecipesToCache(updated, userId, serverVersionRef.current);
        return updated;
      });
      if (duplicate) {
        setSnackbarState({ open: true, message: 'Recipe already in your collection', severity: 'info', duration: 2000 });
      }
      dismissSuggestion(activeRecipe.id);
```

- [ ] **Step 2: Verify build compiles**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): show 'already in your collection' on duplicate save (shared recipe)"
```

---

## Task 6: Frontend — `handleAddRecipeSubmit` / `resetFormState` duplicate toast

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — `resetFormState` (~5213-5226), the remote-save block (~5238-5247), and the `resetFormState(...)` call site (~5309)

- [ ] **Step 1: Give `resetFormState` an optional severity argument**

Change the `resetFormState` definition (line 5213) and its `setSnackbarState` call so severity is overridable:

```jsx
    const resetFormState = (message, severity = 'success') => {
      setCurrentView('recipes');
      setSelectedMealTypes([]);
      setIngredientInput('');
      setVisibleCount(RESULTS_PAGE_SIZE);
      setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
      setNewRecipeErrors({});
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      setIsAddDialogOpen(false);
      setAddRecipeSource(null);
      setSnackbarState({
        open: true,
        message,
        severity,
```

(Leave the rest of `resetFormState` — the closing of `setSnackbarState` and the function — unchanged.)

- [ ] **Step 2: Capture the duplicate flag from the save response**

In the remote-save block, change `const savedRecipe = normalizeRecipeFromApi(response?.recipe) || newRecipe;` (line 5238) to also read the flag:

```jsx
        const savedRecipe = normalizeRecipeFromApi(response?.recipe) || newRecipe;
        const isDuplicate = response?.duplicate === true;
```

- [ ] **Step 3: Branch the completion toast on the flag**

Find the `resetFormState(\`Saved "${savedRecipe.title}".\`);` call (~line 5309) and replace it with:

```jsx
        if (isDuplicate) {
          resetFormState('Recipe already in your collection', 'info');
        } else {
          resetFormState(`Saved "${savedRecipe.title}".`);
        }
```

- [ ] **Step 4: Verify build compiles**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): show 'already in your collection' on duplicate save (add form)"
```

---

## Task 7: Native — Share Extension shows "Already in your collection" on HTTP 200

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/ShareFormView.swift` (~line 186-194 save handler, ~line 447 saved label)

`WorkerClient.createRecipe` already returns `result.statusCode`; a duplicate is HTTP 200, a fresh save is 201.

- [ ] **Step 1: Track duplicate state on the view model**

Near the existing `@Published var isSaved` declaration, add:

```swift
    @Published var isDuplicate: Bool = false
```

- [ ] **Step 2: Set it from the save result**

In the save handler where `self.isSaved = true` is set (~line 194, after `result = try await WorkerClient.createRecipe(...)`), add directly before it:

```swift
                self.isDuplicate = (result.statusCode == 200)
```

- [ ] **Step 3: Branch the saved-state label**

Change the saved confirmation `Text("Recipe saved!")` (~line 447) to:

```swift
                Text(viewModel.isDuplicate ? "Already in your collection" : "Recipe saved!")
```

(Match the actual property/scope name used for the view model in that view — adjust `viewModel.` to whatever the surrounding code uses, e.g. `model.` or a direct `isDuplicate` if the `Text` is inside the observed object's own view.)

- [ ] **Step 4: Verify it compiles**

Open `apps/ios/ios/App/App.xcworkspace` in Xcode and build the `ShareExtension` target (or run `xcodebuild -workspace apps/ios/ios/App/App.xcworkspace -scheme App build` if the CLI toolchain is set up). Expected: build succeeds. If the iOS toolchain is unavailable in this environment, note it and defer the build check to the user.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/ShareFormView.swift
git commit -m "feat(ios): show 'already in your collection' on duplicate share-extension save"
```

---

## Task 8: Parse + enrich smoke test, then deploy worker (protect-import-flow rule)

**Files:** none (verification + deploy)

This is REQUIRED before the worker ships because `handleCreateRecipe` is the import save entry point.

- [ ] **Step 1: Run the full worker suite green**

Run: `cd apps/worker && npx vitest run`
Expected: all tests PASS (the 4 prior conversation-state suites plus the new dedup/backfill/re-enrich tests).

- [ ] **Step 2: `git status` before deploy (deploy ships the working tree)**

Run: `git status`
Expected: confirm only intended files are modified; the user may have parallel uncommitted work in other terminals. Do not deploy if unexpected changes are staged.

- [ ] **Step 3: Deploy the worker**

Run: `cd apps/worker && npx wrangler deploy`
Expected: deploy succeeds, prints a version id.

- [ ] **Step 4: Smoke-test parse + enrich + dedup against prod**

Use a real reel URL the user supplies (do NOT write throwaway rows to prod under the owner account; the dev-key path was previously blocked). Preferred: ask the user to perform the manual flow in the app and confirm, OR run read-only verification:
  1. Parse: `GET https://api.recifriend.com/recipes/parse?url=<reel>` returns title/image.
  2. The user saves it in-app fresh → confirms it appears with ingredients/steps after enrichment (201 path).
  3. The user saves the same recipe again → confirms the "Recipe already in your collection" toast and that no duplicate appears in the list (200 path).
  4. For an empty/failed import, re-saving re-triggers enrichment (row fills in or stays, no duplicate).
Expected: all four behaviors confirmed. If parse or enrich regressed, roll back the worker (`wrangler rollback` or redeploy prior version) before anything else.

- [ ] **Step 5: Deploy frontend (Pages)**

Run: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
Expected: deploy succeeds; the duplicate toast is live on web.

- [ ] **Step 6: Report**

Summarize to the user: worker version deployed, smoke-test results, frontend deployed. Native change ships with the next TestFlight/App Store build (build 28+), not this deploy.

---

## Self-Review

**Spec coverage:**
- Unbounded `(user_id, source_url)` detection → Task 1. ✔
- `duplicate` flag in response (true@200 / false@201) → Task 1. ✔
- Existing-has-content pure dedup → Task 1. ✔
- Empty + incoming-content backfill → Task 2 (`backfillEmptyRecipe`). ✔
- Empty + incoming-empty re-enrich on existing id → Task 1 branch + Task 3 test. ✔
- Web copy "Recipe already in your collection" on 3 handlers → Tasks 4, 5, 6. ✔
- Existing recipe surfaces in list (fixes "doesn't show up") → all 3 handlers keep the merge-by-id `setRecipes`. ✔
- Native "Already in your collection" on 200 → Task 7. ✔
- Leave 9 existing dups alone → no migration task, explicitly out of scope. ✔
- Exact-URL match (no normalization) → Task 1 comment + spec non-goal. ✔
- Parse+enrich smoke test before ship → Task 8. ✔

**Placeholder scan:** No TBD/TODO; all code blocks concrete. Task 7 Step 3 flags a real adjust-to-actual-name caveat (Swift view-model binding) since the exact accessor wasn't read in full — acceptable, it's a named verification, not a placeholder.

**Type consistency:** `backfillEmptyRecipe(env, userId, recipeId, recipe)` defined in Task 2, called in Task 1 — signatures match. `duplicate` flag name consistent across worker (Task 1/2), `App.jsx` (Tasks 4-6), and read as `result.statusCode == 200` in Swift (Task 7). `resetFormState(message, severity)` defined and called consistently in Task 6.
