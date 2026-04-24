# Enrichment Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop enrichment from hallucinating recipes out of nothing, label truly-inferred recipes with a tappable chip, show an actionable empty state with an "Enhance with AI" link, and expose a `POST /recipes/:id/re-enrich` endpoint for manual refresh plus silent retry on open.

**Architecture:** One new D1 column `provenance` (`'extracted' | 'inferred' | null`). Worker: gate `textInference` so it returns empty without calling Gemini unless `rawText` is non-null, ≥500 chars, and not an error page; propagate provenance through every strategy, through `runEnrichmentChain`, into `enrichAfterSave` and the sync enrich response; add `handleReEnrichRecipe` routed at `POST /recipes/:id/re-enrich` with "preserve on empty" semantics. Frontend: thread `provenance` through the recipe model, render an "AI-inferred" chip at the bottom of the detail dialog (above View Source) that toggles a caveat on tap, render an empty-state message with an "Enhance with AI" link above ingredients when `provenance=null` + `ingredients=[] && steps=[]` + `source_url` set, add a "Re-enrich with AI" overflow menu item, and silently fire the re-enrich endpoint once per session when the detail opens on a recent empty-with-source-url recipe.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Vitest, React + MUI (JavaScript), Cloudflare Pages, `wrangler`.

**Spec:** [docs/superpowers/specs/2026-04-24-enrichment-reliability-design.md](docs/superpowers/specs/2026-04-24-enrichment-reliability-design.md)

**Working on main.** This repo does not use feature branches or worktrees (per user memory). All commits land on `main`; deploy is manual via `wrangler`.

**Conventions:**
- Small, focused commits per task.
- All worker tests run with `cd apps/worker && npm test -- <pattern>`.
- Commit-message style follows the recent history (e.g., `feat(worker/enrich):`, `feat(ui/recipes):`, `test(worker):`).
- Never use `git add -A` / `git add .`; add named files only.

---

## Task 1: D1 migration — add `provenance` column

**Files:**
- Create: `apps/worker/migrations/0011_add_recipes_provenance.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0011_add_recipes_provenance.sql
-- Adds a provenance tag so the UI can distinguish verbatim extracted content
-- from content Gemini inferred from page body text. Legacy rows keep NULL.
-- Values: 'extracted' | 'inferred' | NULL (application-enforced; no CHECK).

ALTER TABLE recipes ADD COLUMN provenance TEXT;
```

- [ ] **Step 2: Apply migration to dev D1**

Run:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --env dev --file migrations/0011_add_recipes_provenance.sql
```

Expected: `Executed 1 command` with `✔` in the output. If wrangler prompts to confirm, accept.

- [ ] **Step 3: Sanity check the column exists on the remote dev DB**

Run:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --env dev --command "PRAGMA table_info(recipes);"
```

Expected: the output lists a row whose `name` is `provenance` and whose `type` is `TEXT`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/migrations/0011_add_recipes_provenance.sql
git commit -m "$(cat <<'EOF'
feat(worker/d1): add recipes.provenance column (0011)

New column tags each enrichment outcome as 'extracted', 'inferred', or
NULL so the UI can distinguish verbatim captions from Gemini inference.
Legacy rows remain NULL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `EnrichmentResult` type + `EMPTY_ENRICHMENT`

**Files:**
- Modify: `apps/worker/src/index.ts:4105-4123` (type + constant)

- [ ] **Step 1: Write the failing test in `apps/worker/src/enrich.test.ts`**

Add this `describe` block at the end of the file, after the existing `runEnrichmentChain` tests (after [enrich.test.ts:522](apps/worker/src/enrich.test.ts#L522)):

```typescript
describe('EnrichmentResult shape', () => {
  it('EMPTY_ENRICHMENT carries provenance: null', async () => {
    // Every strategy returns EMPTY_ENRICHMENT on empty paths; provenance must default to null
    // so the orchestrator + enrichAfterSave can rely on it.
    const emptyFromStrategy = await captionExtract(
      {} as Env,
      'https://example.com/not-social',
      '',
      { fetchOembedCaption: async () => null, fetchImpl: vi.fn() as any, getAccessToken: async () => 'x', getServiceAccount: async () => ({ client_email: '', private_key: '', token_uri: '', project_id: '' }) }
    );
    expect(emptyFromStrategy).toMatchObject({ ingredients: [], steps: [], provenance: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: new test fails with something like `expected [Object] to match { ingredients: [], steps: [], provenance: null } (received no 'provenance' key)`.

- [ ] **Step 3: Add `provenance` to the type + constant at [index.ts:4105](apps/worker/src/index.ts#L4105)**

Replace the existing `EnrichmentResult` type and `EMPTY_ENRICHMENT` constant with:

```typescript
// Enrichment result shape shared by all strategy functions. When a strategy
// cannot extract, it returns this object with empty arrays — the orchestrator
// treats empty ingredients+steps as the fall-through signal.
type EnrichmentResult = {
  title: string;
  imageUrl: string;
  mealTypes: string[];
  ingredients: string[];
  steps: string[];
  durationMinutes: number | null;
  notes: string;
  provenance: 'extracted' | 'inferred' | null;
};

const EMPTY_ENRICHMENT: EnrichmentResult = {
  title: '',
  imageUrl: '',
  mealTypes: [],
  ingredients: [],
  steps: [],
  durationMinutes: null,
  notes: '',
  provenance: null,
};
```

- [ ] **Step 4: Run tests — type-level failures expected in strategy functions**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: the new test passes. Existing strategy tests may still pass because they construct objects via `parsedToEnrichmentResult` which still returns the object literally (no new required field is checked in those tests yet). If TypeScript type errors fail the build, make sure strategies still return `EMPTY_ENRICHMENT` or a spread of it — the constant now has `provenance: null` so all existing returns remain valid.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/enrich): add provenance to EnrichmentResult

Extend the strategy shape so every pass can tag its output as 'extracted',
'inferred', or null. Constants default to null; strategy logic that sets
the tag lands in following commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `captionExtract` + `youtubeVideo` — tag `'extracted'` on success

**Files:**
- Modify: `apps/worker/src/index.ts:4165-4201` (captionExtract)
- Modify: `apps/worker/src/index.ts:4225-4277` (youtubeVideo)
- Modify: `apps/worker/src/enrich.test.ts` (assertions)

- [ ] **Step 1: Add failing assertions in `enrich.test.ts`**

Inside the existing `captionExtract` → `'passes caption to Gemini and returns parsed result'` test at [enrich.test.ts:202](apps/worker/src/enrich.test.ts#L202), add after the existing assertions on `result.ingredients`:

```typescript
    expect(result.provenance).toBe('extracted');
```

Inside the existing `captionExtract` → `'returns empty result when Gemini returns empty arrays'` test at [enrich.test.ts:234](apps/worker/src/enrich.test.ts#L234), add:

```typescript
    expect(result.provenance).toBeNull();
```

Inside the existing `youtubeVideo` → `'sends a multi-part Gemini request...'` test at [enrich.test.ts:285](apps/worker/src/enrich.test.ts#L285), add:

```typescript
    expect(result.provenance).toBe('extracted');
```

Inside the existing `youtubeVideo` → `'returns empty without a Gemini call for non-YouTube URLs'` test at [enrich.test.ts:277](apps/worker/src/enrich.test.ts#L277), add:

```typescript
    expect(result.provenance).toBeNull();
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: the four added assertions fail with `expected undefined to be 'extracted'` and `expected undefined to be null`.

- [ ] **Step 3: Tag provenance in `captionExtract`**

At [index.ts:4192-4196](apps/worker/src/index.ts#L4192), replace the block:

```typescript
    const parsed = parseGeminiRecipeJson(completion);
    const result = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
```

with:

```typescript
    const parsed = parseGeminiRecipeJson(completion);
    const base = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = base.ingredients.length === 0 && base.steps.length === 0;
    const result: EnrichmentResult = { ...base, provenance: isEmpty ? null : 'extracted' };
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
```

- [ ] **Step 4: Tag provenance in `youtubeVideo`**

At [index.ts:4266-4270](apps/worker/src/index.ts#L4266), replace:

```typescript
    const parsed = parseGeminiRecipeJson(raced);
    const result = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'youtube-video', url: sourceUrl, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
```

with:

```typescript
    const parsed = parseGeminiRecipeJson(raced);
    const base = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = base.ingredients.length === 0 && base.steps.length === 0;
    const result: EnrichmentResult = { ...base, provenance: isEmpty ? null : 'extracted' };
    console.log('[enrich]', { strategy: 'youtube-video', url: sourceUrl, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
```

- [ ] **Step 5: Run tests — they should pass**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: all `captionExtract` and `youtubeVideo` tests pass, including the new provenance assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/enrich): tag caption + youtube strategies with provenance

captionExtract and youtubeVideo set provenance='extracted' on a non-empty
Gemini parse and null otherwise. No behavior change beyond the tag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `textInference` — hallucination gate + provenance

**Files:**
- Modify: `apps/worker/src/index.ts:4286-4364` (textInference)
- Modify: `apps/worker/src/enrich.test.ts`

This is the core bug fix. The gate now applies to the whole strategy: both passes are skipped when `rawText` is null, under 500 chars, or matches the error-page heuristic. The title-only fallback is deleted.

- [ ] **Step 1: Add failing gate tests to `enrich.test.ts` `describe('textInference', ...)`**

Inside the existing `textInference` describe block (after [enrich.test.ts:466](apps/worker/src/enrich.test.ts#L466)), add these tests:

```typescript
  it('skips both Gemini passes and returns null provenance when rawText is null', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    const result = await textInference(
      fakeEnv,
      'https://www.instagram.com/reel/xyz/',
      'Cucumber tea sandwiches',
      { ...baseDeps, fetchRawRecipeText: async () => null, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips both passes when rawText is under 500 chars and not error-page-shaped', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    const result = await textInference(
      fakeEnv,
      'https://example.com/x',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'short body text', fetchImpl: mockFetch }
    );
    expect(result.provenance).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('tags pass-1 success as provenance=extracted', async () => {
    const longText = 'Ingredients:\n- 1 cup flour\n- 2 eggs\n\nInstructions:\n1. Mix flour and eggs.\n'.padEnd(600, ' ');
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['1 cup flour', '2 eggs'], steps: ['Mix flour and eggs.'], mealTypes: [], durationMinutes: null, notes: '', title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/recipe',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => longText, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['1 cup flour', '2 eggs']);
    expect(result.provenance).toBe('extracted');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('tags pass-2 success as provenance=inferred when pass-1 returns empty', async () => {
    const longText = 'A food blog post with lots of words but no explicit ingredient list or steps.'.padEnd(600, ' ');
    let call = 0;
    const mockFetch = vi.fn(async () => {
      const text = call++ === 0
        ? JSON.stringify({ ingredients: [], steps: [], mealTypes: [], durationMinutes: null, notes: '', title: '' })
        : JSON.stringify({ ingredients: ['inferred'], steps: ['step'], mealTypes: [], durationMinutes: null, notes: '', title: '' });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
    }) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/blog',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => longText, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['inferred']);
    expect(result.provenance).toBe('inferred');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null provenance when both passes return empty', async () => {
    const longText = 'Very generic food blog text with no actual recipe data anywhere.'.padEnd(600, ' ');
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ ingredients: [], steps: [], mealTypes: [], durationMinutes: null, notes: '', title: '' }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/x',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => longText, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
```

Also **update** the existing test `'returns empty when raw text fetch returns null and title is empty'` at [enrich.test.ts:385](apps/worker/src/enrich.test.ts#L385) — its title is now misleading. Rename the test to `'returns empty (no Gemini call) when raw text is null, regardless of title'` and remove the `title: ''` aspect by passing a non-empty title to prove the title no longer matters:

```typescript
  it('returns empty (no Gemini call) when raw text is null, regardless of title', async () => {
    const deps = {
      ...baseDeps,
      fetchRawRecipeText: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    };
    const result = await textInference(fakeEnv, 'https://example.com/x', 'Cucumber sandwiches', deps);
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBeNull();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: the five new/modified tests fail. Existing tests that currently pass a short `rawText` ("some weak text...") will also start failing — that's intentional; they need the 500-char pad in Step 3 (merged into the textInference rewrite).

- [ ] **Step 3: Rewrite `textInference` with the gate**

Replace the entire body of `textInference` ([index.ts:4286-4364](apps/worker/src/index.ts#L4286)) with:

```typescript
async function textInference(
  env: Env,
  sourceUrl: string,
  title: string,
  deps: TextInferenceDeps = {}
): Promise<EnrichmentResult> {
  const startedAt = Date.now();
  const fetcher = deps.fetchRawRecipeText ?? fetchRawRecipeText;
  let rawText: string | null = null;
  try {
    rawText = await fetcher(sourceUrl);
  } catch (err) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }

  // Hallucination gate: textInference makes any Gemini call only when the
  // source text is substantive. Title-only fallback has been removed — if
  // rawText is null we treat it as "nothing to work with" and return empty.
  if (!rawText) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: 0, outcome: 'empty', reason: 'no-raw-text', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }
  if (rawText.length < 500) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText.length, outcome: 'empty', reason: 'too-short', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }
  if (/HTTP ERROR \d{3}|Too Many Requests|Target URL returned error/i.test(rawText)) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText.length, outcome: 'empty', reason: 'fetch-error', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  // Build the Recipe shape required by buildGeminiPrompt (pass 2).
  const recipeForPrompt: Recipe = {
    id: 'enrich-preview',
    userId: 'preview',
    title: title || '',
    sourceUrl,
    imageUrl: '',
    imagePath: null,
    mealTypes: [],
    ingredients: [],
    steps: [],
    durationMinutes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: '',
    previewImage: null,
  };

  try {
    // Pass 1: strict extract-only (verbatim if the text contains a recipe).
    const extractCompletion = await callGemini(env, buildExtractOnlyPrompt(rawText), {
      fetchImpl: deps.fetchImpl,
      getAccessToken: deps.getAccessToken,
      getServiceAccount: deps.getServiceAccount,
    });
    const extractParsed = parseGeminiRecipeJson(extractCompletion);
    const extractBase = extractParsed ? parsedToEnrichmentResult(extractParsed) : EMPTY_ENRICHMENT;
    const extractIsEmpty = extractBase.ingredients.length === 0 && extractBase.steps.length === 0;
    if (!extractIsEmpty) {
      console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText.length, pass: 'extract', outcome: 'extracted', duration_ms: Date.now() - startedAt });
      return { ...extractBase, provenance: 'extracted' };
    }

    // Pass 2: inference-allowing prompt runs only when the gate passed AND pass-1 was empty.
    const inferCompletion = await callGemini(env, buildGeminiPrompt(recipeForPrompt, rawText), {
      fetchImpl: deps.fetchImpl,
      getAccessToken: deps.getAccessToken,
      getServiceAccount: deps.getServiceAccount,
    });
    const inferParsed = parseGeminiRecipeJson(inferCompletion);
    const inferBase = inferParsed ? parsedToEnrichmentResult(inferParsed) : EMPTY_ENRICHMENT;
    const inferIsEmpty = inferBase.ingredients.length === 0 && inferBase.steps.length === 0;
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText.length, pass: 'infer', outcome: inferIsEmpty ? 'empty' : 'inferred', duration_ms: Date.now() - startedAt });
    return inferIsEmpty
      ? EMPTY_ENRICHMENT
      : { ...inferBase, provenance: 'inferred' };
  } catch (err) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText.length, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }
}
```

- [ ] **Step 4: Update pre-existing `textInference` tests that depend on short rawText**

The existing test `'falls back to inference prompt when extract returns empty'` at [enrich.test.ts:422](apps/worker/src/enrich.test.ts#L422) uses `'some weak text with no clear recipe structure'` — 44 chars — which the new gate rejects. Change the `fetchRawRecipeText` there to:

```typescript
fetchRawRecipeText: async () => 'A long food blog post that rambles about family memories and cooking traditions without ever laying out an explicit ingredient list or numbered steps.'.padEnd(600, ' ')
```

Similarly, the test `'calls Gemini with extract-only prompt first and returns result when extract succeeds'` at [enrich.test.ts:397](apps/worker/src/enrich.test.ts#L397) uses `'Ingredients:\n- 1 cup flour\n\nInstructions:\n1. Mix.'` (~50 chars). Change its `fetchRawRecipeText` to:

```typescript
fetchRawRecipeText: async () => 'Ingredients:\n- 1 cup flour\n\nInstructions:\n1. Mix.'.padEnd(600, ' ')
```

- [ ] **Step 5: Run all enrich tests**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: all tests in the file pass. If any existing test still fails because of the gate, verify the padding was added to its `rawText` fixture.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "$(cat <<'EOF'
fix(worker/enrich): gate textInference on substantive rawText

Removes the title-only fallback that let pass-2 infer a recipe from only
"Recipe: {title}". Both passes are now skipped when rawText is null,
under 500 chars, or matches the error-page heuristic. Pass-1 success
tags provenance='extracted'; pass-2 success tags provenance='inferred'.
Fixes the honeydew+prosciutto hallucination on rate-limited Instagram
reels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `rowToRecipe` + `Recipe` interface carry provenance

**Files:**
- Modify: `apps/worker/src/index.ts:38-54` (interface)
- Modify: `apps/worker/src/index.ts:976-994` (rowToRecipe)

- [ ] **Step 1: Update the `Recipe` interface**

At [index.ts:38-54](apps/worker/src/index.ts#L38), add the provenance field:

```typescript
interface Recipe {
  id: string;
  userId: string;
  title: string;
  sourceUrl: string;
  imageUrl: string;
  imagePath?: string | null;
  mealTypes: string[];
  ingredients: string[];
  steps: string[];
  durationMinutes: number | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  previewImage?: ImageMetadata | null;
  sharedWithFriends?: boolean;
  provenance?: 'extracted' | 'inferred' | null;
}
```

- [ ] **Step 2: Update `rowToRecipe` at [index.ts:976](apps/worker/src/index.ts#L976)**

Add a `provenance` line in the returned object:

```typescript
function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    sourceUrl: (row.source_url as string) || '',
    imageUrl: (row.image_url as string) || '',
    imagePath: (row.image_path as string) || null,
    mealTypes: JSON.parse((row.meal_types as string) || '[]'),
    ingredients: JSON.parse((row.ingredients as string) || '[]'),
    steps: JSON.parse((row.steps as string) || '[]'),
    durationMinutes: row.duration_minutes as number | null,
    notes: (row.notes as string) || '',
    previewImage: row.preview_image ? JSON.parse(row.preview_image as string) : null,
    sharedWithFriends: Boolean(row.shared_with_friends),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    provenance: (row.provenance as 'extracted' | 'inferred' | null) ?? null,
  };
}
```

- [ ] **Step 3: Run the worker test suite — everything should still pass**

Run: `cd apps/worker && npm test`
Expected: all tests pass. The `Recipe` interface change is backwards-compatible (provenance is optional) and `rowToRecipe` now reads an extra column; tests with mock rows that lack it will still work thanks to the `?? null`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "$(cat <<'EOF'
feat(worker/recipe): Recipe.provenance flows through rowToRecipe

Interface gains an optional provenance field and rowToRecipe maps the
new D1 column to it (null for legacy rows that predate migration 0011).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `normalizeRecipePayload` accepts `provenance` from request body

**Files:**
- Modify: `apps/worker/src/index.ts:2764-2836` (normalizeRecipePayload)

- [ ] **Step 1: Add a failing test in `apps/worker/src/create-recipe.test.ts`**

Add at the bottom of the file:

```typescript
describe('handleCreateRecipe provenance', () => {
  it('persists provenance from the POST body into the INSERT binding list', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });
    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta', provenance: 'inferred' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    const insert = runCalls.find(c => c.sql.includes('INSERT INTO recipes'));
    expect(insert).toBeDefined();
    expect(insert!.binds).toContain('inferred');
  });

  it('defaults provenance to null when the POST body omits it', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });
    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    const insert = runCalls.find(c => c.sql.includes('INSERT INTO recipes'));
    expect(insert).toBeDefined();
    // null binding is acceptable — just must not contain 'inferred'/'extracted'
    expect(insert!.binds).not.toContain('inferred');
    expect(insert!.binds).not.toContain('extracted');
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `cd apps/worker && npm test -- create-recipe.test`
Expected: both new tests fail (one because provenance isn't bound; the other likely passes incidentally, but re-running in Step 6 proves the wire-through).

- [ ] **Step 3: Add provenance to `normalizeRecipePayload`**

At [index.ts:2830](apps/worker/src/index.ts#L2830), immediately after the existing `sharedWithFriends` handling and before the `return` block, insert:

```typescript
  if ('provenance' in payload) {
    const value = payload.provenance;
    if (value === 'extracted' || value === 'inferred' || value === null) {
      recipe.provenance = value;
    } else if (value === undefined) {
      recipe.provenance = null;
    } else {
      throw new HttpError(400, 'provenance must be "extracted", "inferred", or null');
    }
  } else if (!existing) {
    recipe.provenance = null;
  }
```

Also update the `else`-branch default object at [index.ts:2772](apps/worker/src/index.ts#L2772) (inside `normalizeRecipePayload`, the `existing ? { ...existing } : { ... }` literal) so the `else` object includes `provenance: null`. The fields to add is a single new line after `sharedWithFriends: true`:

```typescript
        sharedWithFriends: true,
        provenance: null
```

- [ ] **Step 4: Update the INSERT SQL in `handleCreateRecipe`**

At [index.ts:1775-1784](apps/worker/src/index.ts#L1775), replace the INSERT to include `provenance`:

```typescript
  await env.DB.prepare(
    `INSERT INTO recipes (id, user_id, title, source_url, image_url, image_path, meal_types, ingredients, steps, duration_minutes, notes, preview_image, shared_with_friends, provenance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    recipe.id, recipe.userId, recipe.title, recipe.sourceUrl, recipe.imageUrl,
    recipe.imagePath ?? null, JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.ingredients),
    JSON.stringify(recipe.steps), recipe.durationMinutes, recipe.notes || '',
    recipe.previewImage ? JSON.stringify(recipe.previewImage) : null,
    recipe.sharedWithFriends ? 1 : 0,
    recipe.provenance ?? null,
    recipe.createdAt, recipe.updatedAt
  ).run();
```

- [ ] **Step 5: Run the create-recipe tests**

Run: `cd apps/worker && npm test -- create-recipe.test`
Expected: all `handleCreateRecipe` tests pass, including the two new provenance tests.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/recipes): accept provenance on POST /recipes

normalizeRecipePayload validates the new field and handleCreateRecipe
writes it as a 14th binding on INSERT. Defaults to null when the client
omits it (share-extension path relies on enrichAfterSave to fill it in).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `handleUpdateRecipe` clears provenance on content edits

**Files:**
- Modify: `apps/worker/src/index.ts:1973-2011` (handleUpdateRecipe)
- Modify: `apps/worker/src/create-recipe.test.ts` (add new describe) OR new file

We'll add the test alongside create-recipe since it uses the same mock harness.

- [ ] **Step 1: Write failing tests in `create-recipe.test.ts`**

At the bottom of `apps/worker/src/create-recipe.test.ts`, add:

```typescript
import { handleUpdateRecipe } from './index';

describe('handleUpdateRecipe provenance', () => {
  function makeUpdateMockDb(existing: { provenance: string | null; ingredients: string[]; steps: string[]; notes: string; title: string }) {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const fullRow = {
      id: 'recipe-1',
      user_id: 'user-abc',
      title: existing.title,
      source_url: 'https://example.com/x',
      image_url: '',
      image_path: null,
      meal_types: JSON.stringify([]),
      ingredients: JSON.stringify(existing.ingredients),
      steps: JSON.stringify(existing.steps),
      duration_minutes: null,
      notes: existing.notes,
      preview_image: null,
      shared_with_friends: 1,
      provenance: existing.provenance,
      created_at: '2026-04-24T00:00:00.000Z',
      updated_at: '2026-04-24T00:00:00.000Z',
    };
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          first: async () => (sql.includes('FROM recipes') ? fullRow : null),
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
        }),
      }),
    };
    return { db, runCalls };
  }

  it('sets provenance=null when ingredients are edited', async () => {
    const { db, runCalls } = makeUpdateMockDb({
      provenance: 'inferred', ingredients: ['old'], steps: ['old step'], notes: '', title: 'Pasta'
    });
    const env = { DB: db as unknown as D1Database } as Env;
    const user = { userId: 'user-abc', email: 'a@b.c' };
    const req = new Request('https://worker/recipes/recipe-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', ingredients: ['new ingredient'] }),
    });
    await handleUpdateRecipe(req, env, user as any, 'recipe-1');
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    // The UPDATE binding list must include null where provenance is set.
    // Because the bindings are positional, we assert null appears and 'inferred' does not.
    expect(update!.binds).toContain(null);
    expect(update!.binds).not.toContain('inferred');
  });

  it('leaves provenance untouched when only title changes', async () => {
    const { db, runCalls } = makeUpdateMockDb({
      provenance: 'inferred', ingredients: ['keep'], steps: ['keep'], notes: 'notes', title: 'Pasta'
    });
    const env = { DB: db as unknown as D1Database } as Env;
    const user = { userId: 'user-abc', email: 'a@b.c' };
    const req = new Request('https://worker/recipes/recipe-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    await handleUpdateRecipe(req, env, user as any, 'recipe-1');
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('inferred');
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `cd apps/worker && npm test -- create-recipe.test`
Expected: both `handleUpdateRecipe provenance` tests fail because the UPDATE SQL does not yet bind provenance.

- [ ] **Step 3: Rewrite `handleUpdateRecipe`**

Replace the body of `handleUpdateRecipe` ([index.ts:1973-2011](apps/worker/src/index.ts#L1973)) with:

```typescript
async function handleUpdateRecipe(request: Request, env: Env, user: AuthenticatedUser, recipeId: string) {
  const existing = await loadRecipe(env, user.userId, recipeId);
  const body = await readJsonBody(request);
  const { recipe, previewImagePayload } = normalizeRecipePayload(body, user.userId, existing);

  const shouldRemoveImage = Boolean(previewImagePayload?.remove);
  if (shouldRemoveImage && existing.previewImage?.objectKey) {
    await deleteSupabaseObject(env, existing.previewImage.objectKey);
    recipe.previewImage = null;
    recipe.imagePath = null;
  }

  const hasUpload = previewImagePayload && hasPreviewUpload(previewImagePayload);
  if (hasUpload) {
    if (existing.previewImage?.objectKey) {
      await deleteSupabaseObject(env, existing.previewImage.objectKey);
    }
    const preview = await persistPreviewImage(previewImagePayload, env, user.userId, recipe.id);
    if (preview) {
      recipe.previewImage = preview;
      recipe.imagePath = buildImagePath(recipe.id);
      recipe.imageUrl = preview.publicUrl || recipe.imageUrl;
    }
  }

  // Clear provenance when the user has manually touched enrichment-owned
  // fields. The chip should disappear once the content is user-owned.
  const contentEdited = 'ingredients' in body || 'steps' in body || 'notes' in body;
  const effectiveProvenance = contentEdited ? null : (existing.provenance ?? null);

  await env.DB.prepare(
    `UPDATE recipes SET title = ?, source_url = ?, image_url = ?, image_path = ?, meal_types = ?, ingredients = ?, steps = ?, duration_minutes = ?, notes = ?, preview_image = ?, shared_with_friends = ?, provenance = ?, updated_at = ?
     WHERE user_id = ? AND id = ?`
  ).bind(
    recipe.title, recipe.sourceUrl, recipe.imageUrl, recipe.imagePath ?? null,
    JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps),
    recipe.durationMinutes, recipe.notes || '',
    recipe.previewImage ? JSON.stringify(recipe.previewImage) : null,
    recipe.sharedWithFriends ? 1 : 0,
    effectiveProvenance,
    recipe.updatedAt,
    user.userId, recipe.id
  ).run();
  await updateCollectionMeta(env, user.userId, { countDelta: 0 });

  const updated: Recipe = { ...recipe, provenance: effectiveProvenance };
  return json({ recipe: updated });
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && npm test -- create-recipe.test`
Expected: both new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/recipes): clear provenance on content edits in PATCH

handleUpdateRecipe nulls provenance when the body touches ingredients,
steps, or notes — the user has taken ownership of the content so the
"AI-inferred" chip should disappear. Title/image/visibility edits leave
provenance untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `enrichAfterSave` writes provenance

**Files:**
- Modify: `apps/worker/src/index.ts:4392-4438` (enrichAfterSave)
- Modify: `apps/worker/src/enrich.test.ts` (optional — add coverage if not already present via other tests)

This task adds a `deps` parameter to `enrichAfterSave` for chain injection so the test can run without real Gemini credentials.

- [ ] **Step 1: Add a failing test**

Append to `apps/worker/src/enrich.test.ts`:

```typescript
import { enrichAfterSave } from './index';

describe('enrichAfterSave', () => {
  it('binds provenance in the UPDATE when the chain returns a non-empty result', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
        }),
      }),
    };
    const env = { DB: dbMock as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as unknown as Env;
    const fakeChain = async () => ({
      result: {
        title: 'X', imageUrl: '', mealTypes: [], ingredients: ['a'], steps: ['b'],
        durationMinutes: null, notes: '', provenance: 'inferred' as const,
      },
      winningStrategy: 'text-inference' as const,
    });
    await enrichAfterSave(env, 'recipe-1', 'https://e.com/x', 'T', { runEnrichmentChain: fakeChain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('inferred');
  });

  it('does NOT UPDATE when the chain returns empty (B1 silent no-op preserved)', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
        }),
      }),
    };
    const env = { DB: dbMock as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as unknown as Env;
    const fakeChain = async () => ({
      result: {
        title: '', imageUrl: '', mealTypes: [], ingredients: [], steps: [],
        durationMinutes: null, notes: '', provenance: null,
      },
      winningStrategy: null,
    });
    await enrichAfterSave(env, 'recipe-1', 'https://e.com/x', 'T', { runEnrichmentChain: fakeChain as any });
    expect(runCalls.find(c => c.sql.includes('UPDATE recipes'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: the new `enrichAfterSave` test fails because the current UPDATE does not bind `provenance`.

- [ ] **Step 3: Extend `enrichAfterSave` to bind provenance**

Replace the body at [index.ts:4392-4438](apps/worker/src/index.ts#L4392) with:

```typescript
export async function enrichAfterSave(
  env: Env,
  recipeId: string,
  sourceUrl: string,
  title: string,
  deps: { runEnrichmentChain?: typeof runEnrichmentChain } = {}
): Promise<void> {
  if (!sourceUrl || !env.GEMINI_SERVICE_ACCOUNT_B64) return;

  const resolvedUrl = await resolveSourceUrl(sourceUrl);
  const startedAt = Date.now();

  const runChain = deps.runEnrichmentChain ?? runEnrichmentChain;
  const { result, winningStrategy } = await runChain(env, resolvedUrl, title, {
    captionExtract,
    youtubeVideo,
    textInference,
  });

  console.log('[enrichAfterSave]', {
    recipeId,
    url: resolvedUrl,
    winningStrategy: winningStrategy ?? 'none',
    provenance: result.provenance ?? null,
    duration_ms: Date.now() - startedAt,
    ingredients_count: result.ingredients.length,
    steps_count: result.steps.length,
  });

  // B1: silent — if nothing was found, leave the row alone so the user sees
  // their title-only recipe and can hand-fill later.
  if (result.ingredients.length === 0 && result.steps.length === 0) return;

  const now = new Date().toISOString();
  // image_url is intentionally NOT updated here — /recipes/parse sets it during
  // the initial save and Gemini's inferred image is often worse than the og:image.
  await env.DB.prepare(
    `UPDATE recipes
     SET ingredients = ?, steps = ?, meal_types = ?, duration_minutes = ?, notes = ?, provenance = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    JSON.stringify(result.ingredients),
    JSON.stringify(result.steps),
    JSON.stringify(result.mealTypes),
    result.durationMinutes,
    result.notes || '',
    result.provenance ?? null,
    now,
    recipeId
  ).run();
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/enrich): enrichAfterSave persists provenance

Adds provenance to the UPDATE and logs it. Dependency-injectable chain
so unit tests can assert the binding without exercising the real Gemini
path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `handleEnrichRecipe` returns provenance in the sync response

**Files:**
- Modify: `apps/worker/src/index.ts:1923-1971` (handleEnrichRecipe)

- [ ] **Step 1: Write a failing test**

Append to `apps/worker/src/enrich.test.ts`:

```typescript
import { handleEnrichRecipe } from './index';

describe('handleEnrichRecipe response', () => {
  it('includes provenance in the enriched payload', async () => {
    // Stub fetch so both r.jina.ai and Gemini behave. Pass-1 wins with extracted.
    const longText = 'Ingredients:\n- 1 cup flour\n\nInstructions:\n1. Mix.'.padEnd(600, ' ');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('r.jina.ai')) {
        return { ok: true, text: async () => longText };
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            ingredients: ['flour'], steps: ['mix'], mealTypes: [], durationMinutes: null, notes: '', title: ''
          }) }] } }]
        })
      };
    }) as unknown as typeof fetch);

    const req = new Request('https://worker/recipes/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://somerecipeblog.com/pasta', title: 'Pasta' }),
    });

    const env = { GEMINI_SERVICE_ACCOUNT_B64: 'x' } as unknown as Env;
    const res = await handleEnrichRecipe(req, env);
    const body = await res.json() as { enriched: { provenance?: string | null } };
    expect(body.enriched.provenance).toBe('extracted');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: fails because the response shape doesn't include `provenance`.

- [ ] **Step 3: Update the response block at [index.ts:1959-1970](apps/worker/src/index.ts#L1959)**

Replace the `return json(...)` call with:

```typescript
  return json({
    enriched: {
      title: result.title || title,
      sourceUrl, // original input, not resolvedUrl — preserves today's behavior
      imageUrl: ogImage || result.imageUrl || '',
      mealTypes: result.mealTypes,
      ingredients: result.ingredients,
      steps: result.steps,
      durationMinutes: result.durationMinutes,
      notes: result.notes,
      provenance: result.provenance ?? null,
    },
  });
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && npm test -- enrich.test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/enrich): sync /recipes/enrich response carries provenance

Web Add-Recipe drawer needs provenance at draft time so the POST /recipes
body can persist it on first save (share extension path relies on
enrichAfterSave).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `handleReEnrichRecipe` + `POST /recipes/:id/re-enrich` route

**Files:**
- Modify: `apps/worker/src/index.ts` — new handler after `handleDeleteRecipe` ([index.ts:2013-2023](apps/worker/src/index.ts#L2013))
- Modify: `apps/worker/src/index.ts` — new route match near the recipe-match block at [index.ts:477](apps/worker/src/index.ts#L477)
- Create: `apps/worker/src/re-enrich.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/src/re-enrich.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { handleReEnrichRecipe } from './index';
import type { Env } from './index';

function makeRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'recipe-1',
    user_id: 'user-abc',
    title: 'Pasta',
    source_url: 'https://somerecipeblog.com/pasta',
    image_url: 'https://img.example/a.jpg',
    image_path: null,
    meal_types: JSON.stringify([]),
    ingredients: JSON.stringify([]),
    steps: JSON.stringify([]),
    duration_minutes: null,
    notes: '',
    preview_image: null,
    shared_with_friends: 1,
    provenance: null,
    created_at: '2026-04-24T00:00:00.000Z',
    updated_at: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

function makeDb(row: Record<string, any> | null) {
  const runCalls: Array<{ sql: string; binds: any[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: any[]) => ({
        first: async () => (sql.startsWith('SELECT') ? row : null),
        run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
      }),
    }),
  };
  return { db, runCalls };
}

const baseFakeChain = (result: any, winning: any = 'caption-extract') => async () => ({ result, winningStrategy: winning });
const EMPTY = {
  title: '', imageUrl: '', mealTypes: [], ingredients: [], steps: [],
  durationMinutes: null, notes: '', provenance: null,
};

describe('handleReEnrichRecipe', () => {
  const user = { userId: 'user-abc', email: 'a@b.c' } as any;

  it('404 when recipe not found', async () => {
    const { db } = makeDb(null);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    await expect(handleReEnrichRecipe(env, user, 'missing'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('401 when recipe belongs to another user', async () => {
    const { db } = makeDb(makeRow({ user_id: 'someone-else' }));
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    // loadRecipe already filters by user_id so it returns null; handler surfaces that as 404.
    await expect(handleReEnrichRecipe(env, user, 'recipe-1'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('400 when the recipe has no source_url', async () => {
    const { db } = makeDb(makeRow({ source_url: '' }));
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    await expect(handleReEnrichRecipe(env, user, 'recipe-1'))
      .rejects.toMatchObject({ status: 400 });
  });

  it('updates the row when the chain returns extracted content', async () => {
    const { db, runCalls } = makeDb(makeRow());
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({
      ...EMPTY, ingredients: ['flour'], steps: ['mix'], provenance: 'extracted',
    });
    const res = await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const body = await res.json() as { recipe: { provenance: string; ingredients: string[] } };
    expect(body.recipe.provenance).toBe('extracted');
    expect(body.recipe.ingredients).toEqual(['flour']);
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('extracted');
  });

  it('preserve-on-empty: does NOT update the row when chain returns empty', async () => {
    const existing = makeRow({
      ingredients: JSON.stringify(['old-i']),
      steps: JSON.stringify(['old-s']),
      provenance: 'inferred',
    });
    const { db, runCalls } = makeDb(existing);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({ ...EMPTY }, null);
    const res = await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const body = await res.json() as { recipe: { ingredients: string[]; provenance: string | null } };
    expect(body.recipe.ingredients).toEqual(['old-i']);
    expect(body.recipe.provenance).toBe('inferred');
    expect(runCalls.find(c => c.sql.includes('UPDATE recipes'))).toBeUndefined();
  });

  it('does not touch image_url on a successful update', async () => {
    const existing = makeRow({ image_url: 'https://img.example/a.jpg' });
    const { db, runCalls } = makeDb(existing);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({
      ...EMPTY, ingredients: ['x'], steps: ['y'], imageUrl: 'https://gemini-fake.jpg', provenance: 'extracted',
    });
    await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    // image_url should not appear in the SQL or bindings.
    expect(update!.sql).not.toMatch(/image_url/i);
    expect(update!.binds).not.toContain('https://gemini-fake.jpg');
  });
});
```

- [ ] **Step 2: Run to verify the test file fails (handler doesn't exist)**

Run: `cd apps/worker && npm test -- re-enrich.test`
Expected: import error — `handleReEnrichRecipe is not exported from './index'`.

- [ ] **Step 3: Add the handler in `apps/worker/src/index.ts`**

Insert the following function immediately after `handleDeleteRecipe` (i.e., after [index.ts:2023](apps/worker/src/index.ts#L2023)):

```typescript
export async function handleReEnrichRecipe(
  env: Env,
  user: AuthenticatedUser,
  recipeId: string,
  deps: { runEnrichmentChain?: typeof runEnrichmentChain } = {}
) {
  if (!env.GEMINI_SERVICE_ACCOUNT_B64) {
    throw new HttpError(503, 'Enrichment service is not configured');
  }

  // loadRecipe already filters by user_id and throws 404 for missing/other-owner rows.
  const existing = await loadRecipe(env, user.userId, recipeId);

  if (!existing.sourceUrl) {
    throw new HttpError(400, 'source_url required for re-enrich');
  }

  const resolvedUrl = await resolveSourceUrl(existing.sourceUrl);
  const runChain = deps.runEnrichmentChain ?? runEnrichmentChain;
  const { result, winningStrategy } = await runChain(env, resolvedUrl, existing.title, {
    captionExtract,
    youtubeVideo,
    textInference,
  });

  console.log('[re-enrich]', {
    recipeId,
    url: resolvedUrl,
    winningStrategy: winningStrategy ?? 'none',
    provenance: result.provenance ?? null,
    ingredients_count: result.ingredients.length,
    steps_count: result.steps.length,
  });

  // Preserve-on-empty: refuse to overwrite existing content with a blank result.
  if (result.ingredients.length === 0 && result.steps.length === 0) {
    return json({ recipe: existing });
  }

  const now = new Date().toISOString();
  // image_url is intentionally NOT updated (same policy as enrichAfterSave).
  await env.DB.prepare(
    `UPDATE recipes
     SET ingredients = ?, steps = ?, meal_types = ?, duration_minutes = ?, notes = ?, provenance = ?, updated_at = ?
     WHERE user_id = ? AND id = ?`
  ).bind(
    JSON.stringify(result.ingredients),
    JSON.stringify(result.steps),
    JSON.stringify(result.mealTypes),
    result.durationMinutes,
    result.notes || '',
    result.provenance ?? null,
    now,
    user.userId,
    recipeId
  ).run();

  const refreshed: Recipe = {
    ...existing,
    ingredients: result.ingredients,
    steps: result.steps,
    mealTypes: result.mealTypes,
    durationMinutes: result.durationMinutes,
    notes: result.notes || '',
    provenance: result.provenance ?? null,
    updatedAt: now,
  };
  return json({ recipe: refreshed });
}
```

- [ ] **Step 4: Wire the route in the fetch dispatcher**

In the routes block, immediately after the `cookMatch` branch closes at [index.ts:534](apps/worker/src/index.ts#L534) and before `if (recipeMatch) {` at [index.ts:536](apps/worker/src/index.ts#L536), insert:

```typescript
      const reEnrichMatch = url.pathname.match(/^\/recipes\/([^/]+)\/re-enrich$/);
      if (reEnrichMatch && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const recipeId = decodeURIComponent(reEnrichMatch[1]);
        return await handleReEnrichRecipe(env, user, recipeId);
      }
```

(Place this **before** the `recipeMatch` block so the `/:id/re-enrich` suffix is matched first, preventing `recipeMatch` from incorrectly catching the path.)

- [ ] **Step 5: Run the tests**

Run: `cd apps/worker && npm test -- re-enrich.test`
Expected: all 6 tests in the new file pass.

- [ ] **Step 6: Run the full worker suite — no regressions**

Run: `cd apps/worker && npm test`
Expected: all tests across all files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/re-enrich.test.ts
git commit -m "$(cat <<'EOF'
feat(worker/recipes): add POST /recipes/:id/re-enrich

Runs the enrichment chain against an existing recipe's source_url and
overwrites ingredients/steps/meal_types/duration/notes/provenance, with
a preserve-on-empty guard so a rate-limited retry can't wipe content.
image_url is never touched (same policy as enrichAfterSave).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Deploy worker to dev + manual verification

**Files:** none modified — deployment + smoke.

- [ ] **Step 1: Deploy the dev worker**

Run: `cd apps/worker && npx wrangler deploy --env dev`
Expected: `Published recipes-worker-dev (xxx)` with a `Worker Version ID` line. If deploy fails with auth errors, have the user run `npx wrangler login`.

- [ ] **Step 2: Start a tail and smoke-test**

In one terminal: `cd apps/worker && npx wrangler tail --env dev`

In another, exercise the sync enrich endpoint (use a real JWT from a logged-in dev session):

```bash
curl -sS -X POST https://api-dev.recifriend.com/recipes/enrich \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"test"}' | jq .
```

Expected: JSON response includes `enriched.provenance` (one of `"extracted"`, `"inferred"`, or `null`). Tail should log `[enrich] { ... winningStrategy: ... }`.

- [ ] **Step 3: Exercise `/recipes/:id/re-enrich` on a dev recipe**

Pick an existing dev-environment recipe id you own. Run:

```bash
curl -sS -X POST "https://api-dev.recifriend.com/recipes/<ID>/re-enrich" \
  -H "Authorization: Bearer $JWT" | jq .
```

Expected: returns `{ "recipe": { ... } }`. If the original recipe had ingredients, they may or may not change; the `provenance` field should be present.

- [ ] **Step 4: Verify preserve-on-empty**

Use a recipe whose `source_url` points at an Instagram reel that is currently rate-limited (or temporarily point the URL at an invalid domain via a direct D1 UPDATE in the dev DB). Re-run the curl above. Expected: the returned `recipe` object matches the stored row unchanged; `wrangler tail` shows `[re-enrich] { ... provenance: null, ingredients_count: 0 }`.

- [ ] **Step 5: No commit needed; advance to frontend work**

---

## Task 12: Thread `provenance` through the frontend recipe model

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:305-333` (buildApiRecipePayload)
- Modify: `apps/recipe-ui/src/App.jsx:3186-3247` (handleEnhanceActiveRecipe — enriched → draft mapping)

`normalizeRecipeFromApi` already spreads the raw API object, so it preserves any `provenance` field that the worker returns — no change needed there.

- [ ] **Step 1: Update `buildApiRecipePayload` to forward provenance**

At [App.jsx:312-325](apps/recipe-ui/src/App.jsx#L312), change the `payload` literal to include `provenance`:

```javascript
  const payload = {
    title: recipe.title || '',
    sourceUrl: recipe.sourceUrl || '',
    imageUrl: recipe.imageUrl || '',
    mealTypes,
    ingredients,
    steps,
    durationMinutes:
      typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes) && recipe.durationMinutes > 0
        ? Math.round(recipe.durationMinutes)
        : null,
    notes: recipe.notes || '',
    sharedWithFriends: Boolean(recipe.sharedWithFriends),
    provenance:
      recipe.provenance === 'extracted' || recipe.provenance === 'inferred'
        ? recipe.provenance
        : null,
  };
```

- [ ] **Step 2: Propagate provenance into the Add-Recipe draft inside `handleEnhanceActiveRecipe`**

Inside the `setActiveRecipeDraft((prev) => { ... })` block at [App.jsx:3186-3243](apps/recipe-ui/src/App.jsx#L3186), after the `if (!next.notes ...)` block (around [App.jsx:3231](apps/recipe-ui/src/App.jsx#L3231)) and before the `return next;` at the bottom, add:

```javascript
        if (enriched.provenance === 'extracted' || enriched.provenance === 'inferred' || enriched.provenance === null) {
          next.provenance = enriched.provenance;
          changed = true;
        }
```

- [ ] **Step 3: Find the web Add-Recipe save path and ensure it picks up provenance**

The draft save flow uses `buildApiRecipePayload(newRecipe, ...)` around [App.jsx:3999](apps/recipe-ui/src/App.jsx#L3999). Step 1 made that helper forward provenance — no change needed here; just verify the draft carries it.

Search for the draft-to-save merge point for new recipes. In the new-recipe save block around [App.jsx:4014](apps/recipe-ui/src/App.jsx#L4014):

```bash
grep -n "pendingEnrichRef.current" apps/recipe-ui/src/App.jsx
```

Expected lines: 3782, 3848, 4014. The enriched-merge block at L4014 already patches the new recipe with `enriched` fields. Verify it includes provenance: open that block and confirm provenance is either passed through (via the direct spread of `enriched` into the PATCH body) or add an explicit assignment. If the block does a field-by-field merge (similar to Step 2's code), add an analogous block there. If it posts the raw `enriched` object as the PATCH body, no change is needed.

- [ ] **Step 4: Manual smoke in a dev build**

Run:
```bash
cd apps/recipe-ui && npm run dev
```

Open the web app, use Add-Recipe drawer with an Instagram reel URL. Open DevTools → Network. Confirm:
- `POST /recipes/enrich` response body includes `enriched.provenance`.
- Subsequent `POST /recipes` body includes `provenance`.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(ui/recipes): thread provenance through create + draft flows

buildApiRecipePayload forwards the field, the edit-mode Auto-fill path
mirrors it onto the draft so the initial POST /recipes persists it.
Share-extension saves are unaffected — enrichAfterSave fills it in async.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: "AI-inferred" chip at bottom of recipe detail (F2)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — recipe detail block around [App.jsx:5308](apps/recipe-ui/src/App.jsx#L5308) (View Source)
- Modify: `apps/recipe-ui/src/App.jsx` — add local state near the other dialog states

- [ ] **Step 1: Add state for the tap-reveal toggle**

Near the other recipe-detail local state hooks (search `recipeMenuAnchor` at [App.jsx:1050](apps/recipe-ui/src/App.jsx#L1050)), add:

```javascript
  const [isInferredCaveatOpen, setIsInferredCaveatOpen] = useState(false);
```

- [ ] **Step 2: Reset the toggle when the detail dialog closes**

Find the existing effect/callback that handles dialog close (search for `setActiveRecipe(null)` — one occurrence is [App.jsx:3052](apps/recipe-ui/src/App.jsx#L3052)). In **every** place that sets `setActiveRecipe(null)` (dialog close, delete, navigation), also call `setIsInferredCaveatOpen(false)`. There are 3 such places ([App.jsx:3052](apps/recipe-ui/src/App.jsx#L3052), [App.jsx:3399](apps/recipe-ui/src/App.jsx#L3399), and possibly the handleOpenRecipeDetails reset at [App.jsx:2673](apps/recipe-ui/src/App.jsx#L2673)).

Simpler alternative: add a `useEffect` that resets when `activeRecipe?.id` changes:

```javascript
  useEffect(() => {
    setIsInferredCaveatOpen(false);
  }, [activeRecipe?.id]);
```

Place this effect immediately after `handleOpenRecipeDetails` (~[App.jsx:2690](apps/recipe-ui/src/App.jsx#L2690)).

- [ ] **Step 3: Ensure `AutoAwesomeIcon` is imported**

Search for `AutoAwesomeIcon` imports:

```bash
grep -n "AutoAwesomeIcon" apps/recipe-ui/src/App.jsx | head -3
```

If it's not already imported at the top of the file, add it:

```javascript
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
```

(The edit-mode Auto-fill affordance already uses it per [App.jsx:5446](apps/recipe-ui/src/App.jsx#L5446), so it should already be imported. Skip this step if so.)

- [ ] **Step 4: Render the chip above the View Source block**

At [App.jsx:5308-5328](apps/recipe-ui/src/App.jsx#L5308), replace the existing `{activeRecipeView.sourceUrl && (...)}` block with:

```javascript
                {activeRecipeView.sourceUrl && (
                  <Box>
                    {activeRecipeView.provenance === 'inferred' && (
                      <Box sx={{ mb: 1.5 }}>
                        <Chip
                          icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
                          label="AI-inferred"
                          size="small"
                          variant="outlined"
                          onClick={() => setIsInferredCaveatOpen((v) => !v)}
                          sx={{
                            color: 'warning.dark',
                            borderColor: 'warning.light',
                            cursor: 'pointer',
                            '&:hover': { backgroundColor: 'warning.light', opacity: 0.15 }
                          }}
                        />
                        {isInferredCaveatOpen && (
                          <Typography
                            variant="caption"
                            sx={{ display: 'block', color: 'text.secondary', mt: 0.5, maxWidth: 420 }}
                          >
                            We couldn't read the full recipe. Please verify with the source.
                          </Typography>
                        )}
                      </Box>
                    )}
                    <Link href={activeRecipeView.sourceUrl} target="_blank" rel="noopener" underline="hover">
                      View source
                    </Link>
                    {!isEditMode && (() => {
                      const credit = getRecipeCredit(activeRecipeView?.sourceUrl, oembedAuthor);
                      return credit ? (
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}
                        >
                          {credit.prefix}{' '}
                          <Link href={activeRecipeView.sourceUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'text.secondary' }}>
                            {credit.label}
                          </Link>
                        </Typography>
                      ) : null;
                    })()}
                  </Box>
                )}
```

- [ ] **Step 5: Manual smoke**

```bash
cd apps/recipe-ui && npm run dev
```

Log in as a dev user. Temporarily flip a recipe's provenance to `'inferred'` via a direct D1 write on the dev DB:

```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --env dev --command "UPDATE recipes SET provenance='inferred' WHERE id='<id>';"
```

Reload the app. Open the recipe. Confirm the chip renders above "View source". Tap the chip — caveat text toggles below.

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(ui/recipes): AI-inferred chip at bottom of recipe detail

Renders above View source when recipe.provenance === 'inferred'. Tap
reveals the caveat copy. Collapses automatically when switching recipes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Empty-state "Enhance with AI" link (F3)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — ingredients render block around [App.jsx:5235-5246](apps/recipe-ui/src/App.jsx#L5235)
- Modify: `apps/recipe-ui/src/App.jsx` — add state + handler near other detail hooks

- [ ] **Step 1: Add state for in-flight re-enrich**

Near the chip state from Task 13 (`isInferredCaveatOpen`), add:

```javascript
  const [isReEnriching, setIsReEnriching] = useState(false);
```

Reset it in the same `useEffect(..., [activeRecipe?.id])` that resets `isInferredCaveatOpen`:

```javascript
  useEffect(() => {
    setIsInferredCaveatOpen(false);
    setIsReEnriching(false);
  }, [activeRecipe?.id]);
```

- [ ] **Step 2: Add a `handleReEnrichActiveRecipe` callback**

Place this near `handleEnhanceActiveRecipe` at [App.jsx:3152](apps/recipe-ui/src/App.jsx#L3152):

```javascript
  const handleReEnrichActiveRecipe = useCallback(async ({ silent = false, onDone } = {}) => {
    if (!activeRecipe?.id || !isRemoteEnabled) {
      onDone?.({ ok: false, reason: 'no-recipe' });
      return;
    }
    setIsReEnriching(true);
    try {
      const response = await callRecipesApi(
        `/recipes/${encodeURIComponent(activeRecipe.id)}/re-enrich`,
        { method: 'POST' },
        accessToken
      );
      const refreshed = normalizeRecipeFromApi(response?.recipe);
      if (refreshed) {
        setRecipes((prev) => prev.map((r) => (r.id === refreshed.id ? refreshed : r)));
        setActiveRecipe(refreshed);
        setActiveRecipeDraft({
          ...refreshed,
          ingredients: Array.isArray(refreshed.ingredients) ? [...refreshed.ingredients] : [],
          steps: Array.isArray(refreshed.steps) ? [...refreshed.steps] : [],
        });
      }
      onDone?.({ ok: true, recipe: refreshed });
    } catch (err) {
      if (!silent) {
        setSnackbarState({
          open: true,
          message: "Couldn't refresh recipe. Try again later.",
          severity: 'error',
        });
      }
      onDone?.({ ok: false, reason: 'error' });
    } finally {
      setIsReEnriching(false);
    }
  }, [activeRecipe?.id, isRemoteEnabled, accessToken, setRecipes]);
```

- [ ] **Step 3: Replace the view-mode ingredients block with an empty-state-aware version**

At [App.jsx:5235-5246](apps/recipe-ui/src/App.jsx#L5235), replace the `) : (\n                    <>...ingredients heading + map...</>\n                  )` block with:

```javascript
                  ) : (
                    <>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Ingredients
                      </Typography>
                      {(() => {
                        const ingredientsLen = (activeRecipeView.ingredients || []).length;
                        const stepsLen = (activeRecipeView.steps || []).length;
                        const showEmptyState =
                          !activeRecipeView.provenance &&
                          ingredientsLen === 0 &&
                          stepsLen === 0 &&
                          Boolean(activeRecipeView.sourceUrl);
                        if (showEmptyState) {
                          return (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              We couldn't read this recipe.{' '}
                              <Typography
                                component="button"
                                onClick={isReEnriching ? undefined : () => handleReEnrichActiveRecipe({ silent: false })}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 0.25,
                                  background: 'none',
                                  border: 'none',
                                  cursor: isReEnriching ? 'default' : 'pointer',
                                  color: isReEnriching ? 'text.disabled' : 'primary.main',
                                  fontSize: 'inherit',
                                  fontWeight: 500,
                                  p: 0,
                                  verticalAlign: 'baseline',
                                  '&:hover': isReEnriching ? {} : { textDecoration: 'underline' },
                                }}
                              >
                                {isReEnriching ? <CircularProgress size={14} sx={{ mr: 0.5 }} /> : <AutoAwesomeIcon sx={{ fontSize: 14, mr: 0.25 }} />}
                                Enhance with AI
                              </Typography>
                              {' '}or refer to the source.
                            </Typography>
                          );
                        }
                        return (activeRecipeView.ingredients || []).map((item, i) => (
                          <Typography key={i} variant="body1" sx={{ mb: 1 }}>
                            {item}
                          </Typography>
                        ));
                      })()}
                    </>
                  )}
```

Ensure `CircularProgress` is imported near the other MUI imports — it likely already is (used in the edit-mode Auto-fill affordance at [App.jsx:5444](apps/recipe-ui/src/App.jsx#L5444)).

- [ ] **Step 4: Manual smoke**

1. Set a dev recipe to empty + null provenance + source_url via direct D1:
   ```bash
   cd apps/worker && npx wrangler d1 execute recipes-db --remote --env dev --command "UPDATE recipes SET provenance=NULL, ingredients='[]', steps='[]' WHERE id='<id>';"
   ```
2. Open the recipe in the app. Confirm the empty-state copy renders.
3. Tap "Enhance with AI". Confirm the icon swaps to a spinner, the network tab shows `POST /recipes/:id/re-enrich`, and on success the ingredients fill in (or stay empty + button re-enables on failure).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(ui/recipes): empty-state Enhance-with-AI link for title-only recipes

When a recipe has source_url but provenance=null and no ingredients/steps,
render an inline empty-state message with an Auto-fill-styled action
that fires POST /recipes/:id/re-enrich. Matches the edit-mode Auto-fill
affordance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: "Re-enrich with AI" overflow menu item (F4)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — Menu block at [App.jsx:5491-5516](apps/recipe-ui/src/App.jsx#L5491)

- [ ] **Step 1: Add the menu item**

Immediately after the existing `Edit recipe` `MenuItem` at [App.jsx:5508-5511](apps/recipe-ui/src/App.jsx#L5508) and before `Delete`, insert:

```javascript
        {activeRecipe?.sourceUrl && (
          <MenuItem onClick={() => {
            setRecipeMenuAnchor(null);
            setSnackbarState({ open: true, message: 'Refreshing recipe…', severity: 'info' });
            handleReEnrichActiveRecipe({
              silent: true,
              onDone: ({ ok }) => {
                setSnackbarState({
                  open: true,
                  message: ok ? 'Recipe refreshed.' : "Couldn't refresh recipe. Try again later.",
                  severity: ok ? 'success' : 'error',
                });
              },
            });
          }}>
            <ListItemIcon><AutoAwesomeIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Re-enrich with AI</ListItemText>
          </MenuItem>
        )}
```

- [ ] **Step 2: Manual smoke**

1. Open any recipe with a source URL in the dev build.
2. Tap the three-dot menu.
3. Confirm "Re-enrich with AI" appears between "Edit recipe" and "Delete".
4. Tap it. Confirm:
   - Menu closes.
   - Loading toast appears ("Refreshing recipe…").
   - Network tab shows `POST /recipes/:id/re-enrich`.
   - On success: toast flips to "Recipe refreshed." and the detail dialog reflects any new content.

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(ui/recipes): "Re-enrich with AI" overflow menu item

Shown on any recipe with a sourceUrl, regardless of current provenance.
Calls POST /recipes/:id/re-enrich with success/failure toasts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Silent retry on open with session debounce (F5)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — add module-level `Set`, add effect near `handleOpenRecipeDetails`

- [ ] **Step 1: Add a module-level debounce set**

Near the top of `apps/recipe-ui/src/App.jsx`, in the module scope (outside any component, below imports and above the first `function` or `const App = ...`), add:

```javascript
// Tracks recipe ids whose empty-state silent retry has already run in the
// current session. Prevents rapid open/close/open from spamming re-enrich.
// Resets on page reload (intentional — a fresh load is a reasonable signal
// that the user wants another shot).
const silentRetryAttempted = new Set();
```

If the file already has a similar module-scope cache (e.g., `oembedCacheRef`), place the new set adjacent to maintain convention. Search for other module-scope state:

```bash
grep -n "^const .* = new " apps/recipe-ui/src/App.jsx | head
```

- [ ] **Step 2: Add the silent-retry effect**

Immediately after the `useEffect(() => { setIsInferredCaveatOpen(false); setIsReEnriching(false); }, [activeRecipe?.id]);` effect added in Task 13/14, append:

```javascript
  useEffect(() => {
    if (!activeRecipe) return;
    const r = activeRecipe;
    if (silentRetryAttempted.has(r.id)) return;
    const ingredientsLen = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
    const stepsLen = Array.isArray(r.steps) ? r.steps.length : 0;
    const isEmpty = ingredientsLen === 0 && stepsLen === 0;
    const hasSource = Boolean(r.sourceUrl);
    const provenanceIsNull = !r.provenance;
    const createdAtMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    const withinWindow = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) < 24 * 60 * 60 * 1000;
    if (!provenanceIsNull || !isEmpty || !hasSource || !withinWindow) return;
    silentRetryAttempted.add(r.id);
    handleReEnrichActiveRecipe({ silent: true });
  }, [activeRecipe?.id, handleReEnrichActiveRecipe]);
```

- [ ] **Step 3: Surface the silent-retry spinner in the empty-state block**

Update the empty-state block from Task 14 so that while `isReEnriching` is true, the copy swaps to "Checking for ingredients…" with a spinner instead of the tappable empty-state message. Inside the `if (showEmptyState)` return, replace the full `<Typography>` return with:

```javascript
                          return isReEnriching ? (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                              <CircularProgress size={14} />
                              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                Checking for ingredients…
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              We couldn't read this recipe.{' '}
                              <Typography
                                component="button"
                                onClick={() => handleReEnrichActiveRecipe({ silent: false })}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 0.25,
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'primary.main',
                                  fontSize: 'inherit',
                                  fontWeight: 500,
                                  p: 0,
                                  verticalAlign: 'baseline',
                                  '&:hover': { textDecoration: 'underline' },
                                }}
                              >
                                <AutoAwesomeIcon sx={{ fontSize: 14, mr: 0.25 }} />
                                Enhance with AI
                              </Typography>
                              {' '}or refer to the source.
                            </Typography>
                          );
```

- [ ] **Step 4: Manual smoke**

1. Pick a test recipe: `ingredients=[]`, `steps=[]`, `provenance=null`, `source_url` set, `created_at` within the last 24h. Temporarily fake `created_at` to `now` via direct D1 write:
   ```bash
   cd apps/worker && npx wrangler d1 execute recipes-db --remote --env dev --command "UPDATE recipes SET provenance=NULL, ingredients='[]', steps='[]', created_at=datetime('now') WHERE id='<id>';"
   ```
2. Reload the web app. Open the recipe.
3. Confirm the "Checking for ingredients…" spinner flashes briefly.
4. Confirm the network tab shows one `POST /recipes/:id/re-enrich` call.
5. Close the dialog, reopen the same recipe — confirm NO second network call fires (session debounce working).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(ui/recipes): silent retry on open for recent empty recipes

When a recipe detail opens and the recipe is empty, has a source URL,
null provenance, and was created in the last 24h, silently call
/recipes/:id/re-enrich once per session. Empty state shows a
"Checking for ingredients…" spinner while in flight and falls through
to the Enhance-with-AI prompt on failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Deploy to prod + smoke

**Files:** none modified.

- [ ] **Step 1: Apply migration to prod D1**

Run:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --file migrations/0011_add_recipes_provenance.sql
```

Expected: success output. If wrangler prompts about running against prod, confirm.

- [ ] **Step 2: Verify column exists on prod**

```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --command "PRAGMA table_info(recipes);"
```

Expected: `provenance TEXT` present in the output.

- [ ] **Step 3: Deploy worker to prod**

```bash
cd apps/worker && npx wrangler deploy
```

Expected: `Published recipes-worker (xxx)`.

- [ ] **Step 4: Deploy frontend to prod**

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

Expected: pages deploy completes, outputs a URL under `recifriend.com`.

- [ ] **Step 5: Smoke prod**

1. Open recifriend.com in an incognito window. Log in.
2. Save a known-problematic Instagram reel URL via the web Add-Recipe drawer. Wait for the response.
3. Open the saved recipe. Observe one of:
   - **Extracted** — ingredients populated, no chip, no empty-state copy.
   - **Inferred** — ingredients populated, "AI-inferred" chip renders above "View source". Tap chip reveals the caveat.
   - **Empty** — "We couldn't read this recipe. Enhance with AI or refer to the source." Brief "Checking for ingredients…" spinner first (F5).
4. Use the three-dot menu → "Re-enrich with AI" on any other recipe. Confirm the toast sequence and that content either updates or stays (preserve-on-empty).
5. Edit an inferred recipe's ingredients and save. Reopen — chip should be gone (W6 provenance clearing).

- [ ] **Step 6: Watch `wrangler tail` for 60 seconds**

```bash
cd apps/worker && npx wrangler tail
```

Confirm log lines of the form `[enrich]`, `[enrichAfterSave]`, and `[re-enrich]` show `provenance` in their output. No stack traces or unhandled rejections.

- [ ] **Step 7: No commit needed — deployment only**

---

## Self-review — coverage check

Cross-reference every spec section with the task list.

| Spec section | Task(s) |
|---|---|
| Three outcomes + provenance values | Tasks 2, 3, 4 |
| Data model — migration | Task 1 |
| W1 — hallucination gate | Task 4 |
| W2 — provenance propagation | Tasks 2, 3, 4 |
| W3 — enrichAfterSave persists provenance | Task 8 |
| W4 — handleEnrichRecipe returns provenance | Task 9 |
| W5 — handleCreateRecipe accepts provenance | Task 6 |
| W6 — handleUpdateRecipe clears provenance | Task 7 |
| W7 — POST /recipes/:id/re-enrich | Task 10 |
| W8 — no cron / β client retry | Task 16 |
| F1 — carry provenance through frontend model | Task 12 |
| F2 — inferred chip at bottom | Task 13 |
| F3 — empty-state Enhance with AI | Task 14 |
| F4 — overflow menu item | Task 15 |
| F5 — silent retry + session debounce | Task 16 |
| Testing — unit + integration | Tasks 2-10 (inline) |
| Rollout | Tasks 11, 17 |

All spec sections map to at least one task.
