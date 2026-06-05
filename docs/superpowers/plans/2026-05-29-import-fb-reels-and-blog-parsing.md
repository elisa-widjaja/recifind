# Import flow: Facebook reels + reliable blog content parsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whitelisted recipe-blog imports fill ingredients/steps reliably (not just title+thumbnail), and accept Facebook reel links (`fb.watch` / `facebook.com`) handled like Instagram, without changing the existing Instagram / TikTok / YouTube / blog flows.

**Architecture:** Worker-only, additive change in `apps/worker/src/index.ts`. A new `structuredHtml` enrichment strategy (host-gated to skip social/video platforms) is prepended to `runEnrichmentChain`; it reuses the existing JSON-LD parser (`fetchRecipeHtml` + `extractRecipeDetailsFromHtml`) that the `/recipes/parse` fast path already uses. Facebook support is four small additions mirroring Instagram: allowlist, short-URL resolution, caption extraction, and title cleanup. No frontend changes.

**Tech Stack:** TypeScript, Cloudflare Workers, vitest. All tests live in `apps/worker/src/enrich.test.ts`. Run from `apps/worker`.

**Rollout is dev-first and approval-gated** (see design `docs/superpowers/specs/2026-05-29-import-fb-reels-and-blog-parsing-design.md`): implement + tests → deploy worker to **dev** (`--env dev`) → manual web + Xcode/iOS verification → **explicit user approval** → prod deploy with `wrangler rollback` as the hard stop. Tasks 1–6 are implementation; Tasks 7–8 are the gated rollout.

**Conventions observed in this codebase:**
- Strategy functions take `(env, sourceUrl, title, deps = {})` and return `EnrichmentResult`; `deps` injects fetchers so tests avoid network. See `captionExtract` / `textInference`.
- On "cannot extract", a strategy returns `EMPTY_ENRICHMENT` (empty ingredients+steps = the orchestrator's fall-through signal).
- Tests stub `fetch` with `vi.stubGlobal('fetch', vi.fn(...))` and call `vi.restoreAllMocks()` in `afterEach`.
- Per project rule: never `git commit` until the user explicitly says so. The commit steps below are written for the executor, but **only run them after the user has given a commit go-ahead** — otherwise stage the work and pause.

---

## File structure

- **Modify only:** `apps/worker/src/index.ts`
  - Add `StructuredHtmlDeps` type + `structuredHtml` function (near the other strategy fns, ~line 5630).
  - Add `structuredHtml` to the `ChainStrategies` type (~5853) and to `runEnrichmentChain` ordering (~5875, runs first).
  - Add `structuredHtml` to the four `strategies` object literals (parse-import re-enrich ~3048, `handleEnrichRecipe` ~2759, `enrichAfterSave` ~5911) and the `export {}` block (~6514) so tests can import it.
  - Facebook: `ALLOWED_SOURCE_HOSTS` (~5404), `resolveSourceUrl` `needsResolve` (~5441), `fetchOembedCaption` host detection + author label (~5496/5553), `extractRecipeDetailsFromHtml` title fallback (~4997).
- **Test:** `apps/worker/src/enrich.test.ts` (append new `describe` blocks; import `structuredHtml`, `isAllowedSourceHost`, `resolveSourceUrl` as needed).

> **Note on the 4th strategies literal (~6522):** the lines at ~6514-6529 are the module `export {}` block, *not* a strategies object. Verify each `captionExtract,` site before editing: object literals that build a chain are at ~2759, ~3048, ~5911. The export block at ~6522 gets `structuredHtml` added as an *export*, not as a strategy. Read each region first.

---

## Task 1: Add `structuredHtml` strategy (host-gated, JSON-LD reuse)

**Files:**
- Modify: `apps/worker/src/index.ts` (add type + function after `parsedToEnrichmentResult` / before `CaptionExtractDeps`, ~line 5626)
- Modify: `apps/worker/src/index.ts` export block (~6514)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Export the new symbol-to-be so the test can import it**

In the `export { ... }` block at ~6514-6529, add `structuredHtml,` after `textInference,`:

```ts
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
  structuredHtml,
  runEnrichmentChain,
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/worker/src/enrich.test.ts`:

```ts
describe('structuredHtml strategy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const BLOG_JSONLD = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Recipe","name":"Mushroom Soup",
     "recipeIngredient":["2 Tbsp butter","8 oz mushrooms"],
     "recipeInstructions":[{"@type":"HowToStep","text":"Melt butter."},
                           {"@type":"HowToStep","text":"Add mushrooms."}]}
    </script></head><body></body></html>`;

  it('extracts ingredients and steps from blog JSON-LD', async () => {
    const fetchRecipeHtml = vi.fn(async () => BLOG_JSONLD);
    const result = await structuredHtml(
      {} as Env,
      'https://www.allrecipes.com/some-recipe-123',
      '',
      { fetchRecipeHtml }
    );
    expect(fetchRecipeHtml).toHaveBeenCalledTimes(1);
    expect(result.ingredients).toContain('2 Tbsp butter');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.provenance).toBe('extracted');
  });

  it('skips social/video hosts without fetching', async () => {
    const fetchRecipeHtml = vi.fn(async () => BLOG_JSONLD);
    for (const url of [
      'https://www.instagram.com/reel/ABC/',
      'https://www.tiktok.com/@x/video/123',
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://www.facebook.com/reel/123',
      'https://fb.watch/abc/',
    ]) {
      const result = await structuredHtml({} as Env, url, '', { fetchRecipeHtml });
      expect(result.ingredients).toEqual([]);
      expect(result.steps).toEqual([]);
    }
    expect(fetchRecipeHtml).not.toHaveBeenCalled();
  });

  it('returns empty when blog HTML has no JSON-LD recipe', async () => {
    const fetchRecipeHtml = vi.fn(async () => '<html><head><title>x</title></head><body></body></html>');
    const result = await structuredHtml(
      {} as Env,
      'https://www.allrecipes.com/not-a-recipe',
      '',
      { fetchRecipeHtml }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it('returns empty when fetch yields no HTML', async () => {
    const fetchRecipeHtml = vi.fn(async () => null);
    const result = await structuredHtml(
      {} as Env,
      'https://www.allrecipes.com/some-recipe',
      '',
      { fetchRecipeHtml }
    );
    expect(result.ingredients).toEqual([]);
  });
});
```

Also add `structuredHtml` to the import line at the top of the test file:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption, captionExtract, youtubeVideo, textInference, structuredHtml, runEnrichmentChain, enrichAfterSave, handleEnrichRecipe } from './index';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "structuredHtml strategy"`
Expected: FAIL — `structuredHtml is not a function` / not exported.

- [ ] **Step 4: Implement `structuredHtml`**

Insert in `apps/worker/src/index.ts` immediately before `type CaptionExtractDeps = {` (~line 5627):

```ts
type StructuredHtmlDeps = {
  fetchRecipeHtml?: typeof fetchRecipeHtml;
};

// Reads structured recipe data (JSON-LD schema.org/Recipe, falling back to
// microdata/og inside extractRecipeDetailsFromHtml) straight from a recipe
// blog's HTML. This is the SAME extractor the /recipes/parse fast path uses,
// so enrich becomes as reliable as parse for blogs (AllRecipes, Fresh Off The
// Grid, NYT Cooking, Google Docs, Pinterest).
//
// Host-gated: Instagram / TikTok / YouTube / Facebook are caption- or
// video-based and have no usable JSON-LD recipe node, so we return empty
// immediately WITHOUT fetching — leaving their latency and winning strategy
// byte-for-byte unchanged. The chain falls through to captionExtract /
// youtubeVideo / textInference for those hosts exactly as before.
async function structuredHtml(
  _env: Env,
  sourceUrl: string,
  _title: string,
  deps: StructuredHtmlDeps = {}
): Promise<EnrichmentResult> {
  const startedAt = Date.now();
  const fetcher = deps.fetchRecipeHtml ?? fetchRecipeHtml;

  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return EMPTY_ENRICHMENT;
  }

  const isSocialOrVideo =
    host.includes('instagram.com') ||
    host.includes('tiktok.com') ||
    host.includes('youtube.com') ||
    host === 'youtu.be' || host.endsWith('.youtu.be') ||
    host.includes('facebook.com') ||
    host === 'fb.watch' || host.endsWith('.fb.watch');
  if (isSocialOrVideo) return EMPTY_ENRICHMENT;

  let html: string | null = null;
  try {
    html = await fetcher(sourceUrl);
  } catch (err) {
    console.log('[enrich]', { strategy: 'structured-html', url: sourceUrl, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }
  if (!html) {
    console.log('[enrich]', { strategy: 'structured-html', url: sourceUrl, outcome: 'empty', reason: 'no-html', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  const parsed = extractRecipeDetailsFromHtml(html, sourceUrl);
  if (!parsed) {
    console.log('[enrich]', { strategy: 'structured-html', url: sourceUrl, outcome: 'empty', reason: 'no-parse', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  const isEmpty = parsed.ingredients.length === 0 && parsed.steps.length === 0;
  if (isEmpty) {
    console.log('[enrich]', { strategy: 'structured-html', url: sourceUrl, outcome: 'empty', reason: 'no-content', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  console.log('[enrich]', { strategy: 'structured-html', url: sourceUrl, outcome: 'extracted', duration_ms: Date.now() - startedAt });
  return {
    title: parsed.title,
    imageUrl: parsed.imageUrl,
    mealTypes: parsed.mealTypes,
    cuisines: parsed.cuisines,
    ingredients: parsed.ingredients,
    steps: parsed.steps,
    durationMinutes: parsed.durationMinutes,
    notes: '',
    provenance: 'extracted',
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "structuredHtml strategy"`
Expected: PASS (4 tests).

- [ ] **Step 6: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(enrich): add host-gated structuredHtml strategy (JSON-LD reuse)"
```

---

## Task 2: Wire `structuredHtml` into the enrichment chain (runs first)

**Files:**
- Modify: `apps/worker/src/index.ts` — `ChainStrategies` type (~5853), `runEnrichmentChain` (~5859-5894)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker/src/enrich.test.ts`:

```ts
describe('runEnrichmentChain with structuredHtml', () => {
  const filled = (overrides: Partial<EnrichmentResultForTest> = {}) => ({
    title: 'x', imageUrl: '', mealTypes: [], cuisines: [],
    ingredients: ['a'], steps: ['b'], durationMinutes: null, notes: '',
    provenance: 'extracted' as const, ...overrides,
  });
  const empty = () => ({
    title: '', imageUrl: '', mealTypes: [], cuisines: [],
    ingredients: [], steps: [], durationMinutes: null, notes: '', provenance: null,
  });

  it('lets structuredHtml win for a blog url', async () => {
    const strategies = {
      structuredHtml: vi.fn(async () => filled()),
      captionExtract: vi.fn(async () => empty()),
      youtubeVideo: vi.fn(async () => empty()),
      textInference: vi.fn(async () => empty()),
    };
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env, 'https://www.allrecipes.com/r-123', '', strategies as any
    );
    expect(winningStrategy).toBe('structured-html');
    expect(result.ingredients).toEqual(['a']);
    expect(strategies.captionExtract).not.toHaveBeenCalled();
  });

  it('falls through to captionExtract when structuredHtml is empty (IG unchanged)', async () => {
    const strategies = {
      structuredHtml: vi.fn(async () => empty()),
      captionExtract: vi.fn(async () => filled({ provenance: 'extracted' })),
      youtubeVideo: vi.fn(async () => empty()),
      textInference: vi.fn(async () => empty()),
    };
    const { winningStrategy } = await runEnrichmentChain(
      {} as Env, 'https://www.instagram.com/reel/ABC/', '', strategies as any
    );
    expect(winningStrategy).toBe('caption-extract');
  });
});

type EnrichmentResultForTest = {
  title: string; imageUrl: string; mealTypes: string[]; cuisines: string[];
  ingredients: string[]; steps: string[]; durationMinutes: number | null;
  notes: string; provenance: 'extracted' | 'inferred' | 'title-only' | null;
};
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "runEnrichmentChain with structuredHtml"`
Expected: FAIL — `structuredHtml` not in `ChainStrategies`; `winningStrategy` never `'structured-html'`.

- [ ] **Step 3: Add `structuredHtml` to the `ChainStrategies` type**

In `apps/worker/src/index.ts` at ~5853, change:

```ts
type ChainStrategies = {
  structuredHtml: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
  captionExtract: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
  youtubeVideo: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
  textInference: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
};
```

- [ ] **Step 4: Run `structuredHtml` first in `runEnrichmentChain`**

Update the return type union and prepend the strategy. In `runEnrichmentChain` (~5859), change the signature's return union and add the first call. The signature line becomes:

```ts
async function runEnrichmentChain(
  env: Env,
  resolvedUrl: string,
  title: string,
  strategies: ChainStrategies
): Promise<{ result: EnrichmentResult; winningStrategy: 'structured-html' | 'caption-extract' | 'youtube-video' | 'text-inference' | null }> {
```

Then, immediately after the `let firstNonEmptyTitle = '';` line (~5873) and before the existing `const captionResult = ...` line (~5875), insert:

```ts
  const structuredResult = await strategies.structuredHtml(env, resolvedUrl, title);
  if (hasIngredientsOrSteps(structuredResult)) return { result: structuredResult, winningStrategy: 'structured-html' };
  if (!firstNonEmptyTitle && structuredResult.title) firstNonEmptyTitle = structuredResult.title;
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "runEnrichmentChain with structuredHtml"`
Expected: PASS (2 tests).

- [ ] **Step 6: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(enrich): run structuredHtml first in the enrichment chain"
```

---

## Task 3: Pass `structuredHtml` to all three chain call sites

The three `strategies` object literals that build a chain must include the new strategy or TypeScript will fail to compile (the type now requires it). Call sites: `handleEnrichRecipe` (~2759), the parse-import re-enrich path (~3048), and `enrichAfterSave` (~5911).

**Files:**
- Modify: `apps/worker/src/index.ts` (3 object literals)

- [ ] **Step 1: Verify the three call sites and the type-check failure**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: FAIL — errors like `Property 'structuredHtml' is missing in type` at the three `{ captionExtract, youtubeVideo, textInference }` literals.

- [ ] **Step 2: Add `structuredHtml,` to each of the three literals**

At ~2759, ~3048, and ~5911 the literal reads:

```ts
    captionExtract,
    youtubeVideo,
    textInference,
```

Change each to:

```ts
    structuredHtml,
    captionExtract,
    youtubeVideo,
    textInference,
```

Do NOT touch the `export { ... }` block at ~6514 (already handled in Task 1 — it lists exports, not a strategies literal).

- [ ] **Step 3: Verify type-check passes**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: PASS (no output / exit 0).

- [ ] **Step 4: Run the full suite to confirm no regression**

Run: `cd apps/worker && npm test`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 5: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(enrich): wire structuredHtml into enrich/parse/after-save chains"
```

---

## Task 4: Facebook — allowlist + short-URL resolution

**Files:**
- Modify: `apps/worker/src/index.ts` — `ALLOWED_SOURCE_HOSTS` (~5404), `resolveSourceUrl` `needsResolve` (~5441)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Export `isAllowedSourceHost` and `resolveSourceUrl` for tests**

In the `export { ... }` block (~6514), add both names:

```ts
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
  structuredHtml,
  isAllowedSourceHost,
  resolveSourceUrl,
  runEnrichmentChain,
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/worker/src/enrich.test.ts` (and add `isAllowedSourceHost, resolveSourceUrl` to the top import line):

```ts
describe('Facebook allowlist + resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts facebook.com, www.facebook.com, and fb.watch', () => {
    expect(isAllowedSourceHost('facebook.com')).toBe(true);
    expect(isAllowedSourceHost('www.facebook.com')).toBe(true);
    expect(isAllowedSourceHost('fb.watch')).toBe(true);
  });

  it('still rejects a spoofed facebook subdomain attack', () => {
    expect(isAllowedSourceHost('facebook.com.evil.com')).toBe(false);
    expect(isAllowedSourceHost('fb.watch.evil.com')).toBe(false);
  });

  it('resolves an fb.watch short link to its canonical url via HEAD redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      url: 'https://www.facebook.com/reel/123456789',
    })) as unknown as typeof fetch);

    const resolved = await resolveSourceUrl('https://fb.watch/abc123/');
    expect(resolved).toBe('https://www.facebook.com/reel/123456789');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "Facebook allowlist"`
Expected: FAIL — `isAllowedSourceHost('fb.watch')` is `false`; fb.watch not resolved (returns the input unchanged).

- [ ] **Step 4: Add Facebook hosts to the allowlist**

In `ALLOWED_SOURCE_HOSTS` (~5404), add two entries (after `'instagram.com',`):

```ts
const ALLOWED_SOURCE_HOSTS = [
  'tiktok.com',
  'instagram.com',
  // Facebook reels: fb.watch is the short-link host that 302-redirects to a
  // canonical facebook.com/reel/... or /watch URL. Handled like Instagram —
  // title + thumbnail reliable, caption content best-effort.
  'facebook.com',
  'fb.watch',
  'youtube.com',
  'youtu.be',
  'pinterest.com',
  ...
```

- [ ] **Step 5: Add fb.watch (and facebook share short form) to `needsResolve`**

In `resolveSourceUrl` (~5441), extend the `needsResolve` boolean:

```ts
    const needsResolve =
      parsed.hostname === 'vm.tiktok.com' ||
      parsed.hostname === 'vt.tiktok.com' ||
      (parsed.hostname.endsWith('tiktok.com') && parsed.pathname.startsWith('/t/')) ||
      parsed.hostname === 'youtu.be' ||
      parsed.hostname === 'fb.watch' ||
      parsed.hostname.endsWith('.fb.watch') ||
      (parsed.hostname.endsWith('facebook.com') && parsed.pathname.startsWith('/share/'));
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "Facebook allowlist"`
Expected: PASS (3 tests).

- [ ] **Step 7: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): allow facebook.com/fb.watch + resolve fb.watch short links"
```

---

## Task 5: Facebook — caption extraction in `fetchOembedCaption`

**Files:**
- Modify: `apps/worker/src/index.ts` — `fetchOembedCaption` host detection (~5496), early bail (~5499), author label (~5553)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker/src/enrich.test.ts` (add `fetchOembedCaption` to the import line if not already present — it is):

```ts
describe('fetchOembedCaption for Facebook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads og:description from facebook reel HTML', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () =>
        `<html><head><meta property="og:description" content="Garlic butter shrimp. Ingredients: 1 lb shrimp, 3 tbsp butter. Steps: 1. Melt butter 2. Add shrimp" /></head></html>`,
    })) as unknown as typeof fetch;

    const caption = await fetchOembedCaption('https://www.facebook.com/reel/123', { fetchImpl });
    expect(caption).not.toBeNull();
    expect(caption).toContain('Facebook creator');
    expect(caption).toContain('Garlic butter shrimp');
  });

  it('returns null when facebook serves a login wall with no og tags', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => '<html><head><title>Facebook</title></head><body>Log in</body></html>',
    })) as unknown as typeof fetch;

    const caption = await fetchOembedCaption('https://www.facebook.com/reel/123', { fetchImpl });
    expect(caption).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "fetchOembedCaption for Facebook"`
Expected: FAIL — `fetchOembedCaption` returns `null` for facebook.com (host not recognized, bails at the `if (!isInstagram && !isTikTok && !isYouTube) return null;` guard).

- [ ] **Step 3: Recognize Facebook host**

In `fetchOembedCaption` (~5491-5499), add a `isFacebook` flag:

```ts
  let parsed: URL;
  let isInstagram = false;
  let isTikTok = false;
  let isYouTube = false;
  let isFacebook = false;
  try {
    parsed = new URL(sourceUrl);
    isInstagram = parsed.hostname.includes('instagram.com');
    isTikTok = parsed.hostname.includes('tiktok.com');
    isYouTube = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
    isFacebook = parsed.hostname.includes('facebook.com') || parsed.hostname === 'fb.watch' || parsed.hostname.endsWith('.fb.watch');
    if (!isInstagram && !isTikTok && !isYouTube && !isFacebook) return null;
  } catch {
    return null;
  }
```

- [ ] **Step 4: Add the Facebook author label**

In the same function (~5553), extend the author ternary:

```ts
      const author = isInstagram ? 'Instagram creator' : isTikTok ? 'TikTok creator' : isFacebook ? 'Facebook creator' : 'YouTube creator';
```

(The og:description / twitter:description match at ~5528-5530 already runs for all hosts — Facebook reuses it unchanged. No IG-style metadata-prefix stripping is added for FB; the raw caption is fine, mirroring TikTok/YouTube.)

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "fetchOembedCaption for Facebook"`
Expected: PASS (2 tests).

- [ ] **Step 6: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): extract facebook reel caption via og:description"
```

---

## Task 6: Facebook — title cleanup in `extractRecipeDetailsFromHtml`

When Facebook's `og:title` is missing or the generic literal "Facebook", fall back to the `og:description` caption and run it through the existing TikTok-style title extractor (FB captions read like TikTok/IG captions). This gives the parse fast path a real dish-name title instead of "www.facebook.com".

**Files:**
- Modify: `apps/worker/src/index.ts` — `extractRecipeDetailsFromHtml` (~4997-5014)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Export `extractRecipeDetailsFromHtml` for tests**

In the `export { ... }` block (~6514), add `extractRecipeDetailsFromHtml,`:

```ts
  structuredHtml,
  isAllowedSourceHost,
  resolveSourceUrl,
  extractRecipeDetailsFromHtml,
  runEnrichmentChain,
```

- [ ] **Step 2: Write the failing test**

Append to `apps/worker/src/enrich.test.ts` (add `extractRecipeDetailsFromHtml` to the top import line):

```ts
describe('extractRecipeDetailsFromHtml Facebook title fallback', () => {
  it('derives a title from og:description when og:title is generic "Facebook"', () => {
    const html = `<html><head>
      <meta property="og:title" content="Facebook" />
      <meta property="og:description" content="Crispy garlic potatoes 🥔 the best side dish ever" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
    </head></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/reel/123');
    expect(result).not.toBeNull();
    expect(result!.title.toLowerCase()).toContain('crispy garlic potatoes');
    expect(result!.title).not.toBe('Facebook');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "Facebook title fallback"`
Expected: FAIL — title comes back as the literal `"Facebook"` (no FB branch yet).

- [ ] **Step 4: Add the Facebook title-fallback branch**

In `extractRecipeDetailsFromHtml` (~4997), just after the existing `const isTikTok = /tiktok\.com/i.test(sourceUrl);` line, add the FB flag and an IG-parallel fallback block. The existing IG block is at ~4999-5009; add the FB equivalent right after it:

```ts
  const isInstagram = /instagram\.com/i.test(sourceUrl);
  const isTikTok = /tiktok\.com/i.test(sourceUrl);
  const isFacebook = /facebook\.com|fb\.watch/i.test(sourceUrl);
  if (isInstagram && (!fallbackTitle || /^instagram$/i.test(fallbackTitle))) {
    // ...existing IG block unchanged...
  }
  if (isFacebook && (!fallbackTitle || /^facebook$/i.test(fallbackTitle))) {
    const ogDesc = extractMetaContent(html, 'property', 'og:description')
      || extractMetaContent(html, 'name', 'twitter:description');
    if (ogDesc) fallbackTitle = ogDesc.trim();
  }
  if (isInstagram && fallbackTitle) {
    fallbackTitle = extractInstagramRecipeTitle(fallbackTitle);
  } else if (isTikTok && fallbackTitle) {
    fallbackTitle = extractTikTokRecipeTitle(fallbackTitle);
  } else if (isFacebook && fallbackTitle) {
    fallbackTitle = extractTikTokRecipeTitle(fallbackTitle);
  }
```

> Implementer: keep the existing IG block body exactly as-is; only ADD the `isFacebook` flag line, the new `if (isFacebook ...)` block, and the new `else if (isFacebook ...)` branch. `extractTikTokRecipeTitle` already strips emoji/marketing tails and is the right shared cleaner for FB captions.

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "Facebook title fallback"`
Expected: PASS.

- [ ] **Step 6: Run the full suite + type-check**

Run: `cd apps/worker && npx tsc --noEmit && npm test`
Expected: PASS — everything green.

- [ ] **Step 7: Stage + commit (only after user commit go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): derive facebook reel title from caption when og:title is generic"
```

---

## Task 7: Pre-deploy smoke test + deploy to DEV

Per the protect-import-flow rule, smoke-test parse + enrich before any worker ship. Deploy to the **dev** worker only — prod stays untouched until Task 8.

**Files:** none (operational).

- [ ] **Step 1: Confirm clean working tree baseline**

Run: `git status`
Expected: only the intended `apps/worker/src/index.ts` + `apps/worker/src/enrich.test.ts` changes are staged/committed; no unrelated edits about to ship (deploy ships the working tree).

- [ ] **Step 2: Deploy the worker to dev**

Run: `cd apps/worker && npx wrangler deploy --env dev`
Expected: deploys `recipes-worker-dev` on `api-dev.recifriend.com`. Prod (`recipes-worker`) is NOT touched.

- [ ] **Step 3: Smoke-test `/recipes/parse` against dev (no regression + blog content)**

Run (one at a time, against `https://api-dev.recifriend.com`):

```bash
for u in \
  "https://www.allrecipes.com/rotisserie-chicken-mushroom-soup-recipe-11946422" \
  "https://www.instagram.com/reel/DTBOQTNkmD2/" \
  "https://www.tiktok.com/@gordonramsayofficial/video/7000000000000000000"; do
  echo "=== $u ==="
  curl -s -X POST https://api-dev.recifriend.com/recipes/parse \
    -H 'Content-Type: application/json' -d "{\"sourceUrl\":\"$u\"}" --max-time 30 \
    | head -c 400; echo
done
```

Expected: AllRecipes returns non-empty `ingredients`+`steps`; IG/TikTok return at least a title (unchanged behavior).

- [ ] **Step 4: Smoke-test `/recipes/enrich` against dev (the actual bug fix)**

`/recipes/enrich` requires auth — use the dev `DEV_API_KEY` bearer. Run:

```bash
curl -s -X POST https://api-dev.recifriend.com/recipes/enrich \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DEV_API_KEY" \
  -d '{"sourceUrl":"https://www.allrecipes.com/rotisserie-chicken-mushroom-soup-recipe-11946422","title":""}' \
  --max-time 40 | head -c 600; echo
```

Expected: `enriched.ingredients` and `enriched.steps` are non-empty with `provenance:"extracted"` (previously empty for blogs). If `DEV_API_KEY` is not exported locally, ask the user to run this with `! curl ...` so the key stays in their shell.

- [ ] **Step 5: Report results to the user and pause for the Task 8 gate**

Summarize the smoke-test output. Do not proceed to prod.

---

## Task 8: Manual verification gate (web + Xcode/iOS) → approval → PROD deploy

This task is **user-driven**; the agent assists and waits for explicit approval before the prod deploy step.

- [ ] **Step 1: Point the dev frontend at the dev API and run web checks**

Per the dev-tunnel setup (`dev.recifriend.com` + Vite). User verifies on web/dev:
- Paste the AllRecipes URL into Add Recipe → ingredients+steps fill.
- Paste a `fb.watch` reel → accepted; title+thumbnail land; content best-effort.
- IG + TikTok + YouTube paste → unchanged.

- [ ] **Step 2: Xcode/iOS on-device share-sheet test (dev build)**

User runs the iOS app build pointed at the dev API and tests the real share sheet:
- Safari → share AllRecipes URL → ReciFriend → after save, ingredients+steps appear (immediately or within the existing t+6s/t+18s silent refetch).
- Share a `fb.watch` reel → accepted; title+thumbnail; content best-effort.
- Regression: share one IG reel + one TikTok → still work as today.

- [ ] **Step 3: GATE — wait for explicit user approval to deploy to prod**

Do not run any prod deploy command until the user says to proceed.

- [ ] **Step 4: Record the current live PROD worker deployment id (rollback anchor)**

Run: `cd apps/worker && npx wrangler deployments list`
Note the top (current) deployment id BEFORE deploying — this is the `wrangler rollback` target.

- [ ] **Step 5: Deploy the worker to prod**

Run: `cd apps/worker && npx wrangler deploy`
Expected: deploys `recipes-worker` (prod, `api.recifriend.com`). No frontend deploy is needed (worker-only change).

- [ ] **Step 6: Prod smoke test**

Repeat Task 7 Step 3 against `https://api.recifriend.com` (the AllRecipes URL must return non-empty ingredients+steps; IG/TikTok unchanged).

- [ ] **Step 7: Hard stop / rollback if anything is unexpected**

If any smoke test or on-device check regresses:

```bash
cd apps/worker && npx wrangler rollback <previous-deployment-id-from-step-4>
```

Previous version is live in seconds. Frontend is untouched, so nothing to roll back there.

- [ ] **Step 8: Final commit (only after user commit go-ahead), if not already committed per-task**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): facebook reels + reliable blog content parsing"
```

---

## Self-review notes (spec coverage)

- Spec §1 (structuredHtml strategy) → Tasks 1–3.
- Spec §2.1 allowlist + §2.2 resolution → Task 4.
- Spec §2.3 caption extraction → Task 5.
- Spec §2.4 title cleanup → Task 6.
- Spec test plan (unit + regression + pre-deploy smoke) → Tasks 1–6 tests + Task 7.
- Spec rollout (dev-first, approval gate, prod, instant rollback) → Tasks 7–8.
- Out-of-scope items (FB video transcription, frontend one-tap timing, new blog domains) → not implemented, by design.
