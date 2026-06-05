# FB Full-Caption Import + Per-Platform Strategy & Regression Net — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the real recipe from a Facebook reel when the creator wrote it in the caption (device fetches the full caption on its residential IP, worker runs the existing Gemini extraction), behind a deterministic per-platform regression net that guarantees the other platforms don't regress.

**Architecture:** FB-only code change. The iOS Share Extension extracts the full caption from FB's page HTML (anchored on the truncated `og:description`) and passes it to the worker on the existing `/recipes/enrich` call; the worker runs the same `callGeminiExtract` path it already uses for Instagram/TikTok. Phase 1 lands a regression net first (worker `vitest` fixtures + an iOS XCTest target + a strategy doc) pinning current behavior; Phase 2 builds the FB feature on top.

**Tech Stack:** TypeScript (Cloudflare Worker, vitest), Swift (iOS Share Extension, XCTest), wrangler, Xcode.

**Spec:** `docs/superpowers/specs/2026-06-01-fb-caption-import-and-per-platform-strategy-design.md`

**Conventions (read before starting):**
- Work directly on `main`. No branches/worktrees.
- Do NOT `git commit` until the user approves. Commit steps are written out; hold each until told to go.
- Worker tests: `cd apps/worker && npm test` (4 pre-existing failures in `public.test.ts` + `friends-suggestions.test.ts` are unrelated — verified failing at clean HEAD).
- iOS XCTest can only run in Xcode / `xcodebuild` on a Mac (the user drives it). Worker `vitest` runs anywhere.
- The working tree already carries the prior FB session's changes (committed worker `84da3e5`; uncommitted: worker stripper/short-circuit/copy, iOS on-device fetch + diagnostics, `WorkerClient` pointed at dev). This plan builds on that tree.

## File structure

- `docs/import-platform-strategy.md` — NEW living reference doc (Phase 1).
- `apps/worker/src/fixtures/import/` — NEW captured-input fixtures + expected outputs (Phase 1).
- `apps/worker/src/import-fixtures.test.ts` — NEW deterministic fixture suite (Phase 1).
- `apps/ios/ios/App/ShareExtensionTests/` — NEW XCTest target for the Swift extractor/helpers (Phase 1 infra, Phase 2 tests).
- `apps/worker/src/index.ts` — MODIFY: `geminiExtractFromCaption` helper, `providedCaption` in `runEnrichmentChain`, `caption` in `handleEnrichRecipe` (Phase 2).
- `apps/worker/src/enrich.test.ts` — MODIFY: provided-caption wiring tests (Phase 2).
- `apps/ios/.../DeviceMetadataFetcher.swift` — MODIFY: `extractFullCaption`, return caption for FB (Phase 2).
- `apps/ios/.../WorkerClient.swift` — MODIFY: `ParsePreview.caption`, `enrichRecipe` caption param (Phase 2).
- `apps/ios/.../ShareFormView.swift` — MODIFY: carry caption from preview into `save()` (Phase 2).

---

# PHASE 1 — Regression safety net (no behavior change)

## Task 1: Per-platform strategy reference doc

**Files:**
- Create: `docs/import-platform-strategy.md`

- [ ] **Step 1: Write the doc**

Create `docs/import-platform-strategy.md` with this content:

```markdown
# Recipe import: per-platform strategy

How each source platform is parsed, where title/image/content come from, the
fallback chain, and known ceilings. The deterministic regression suite
(`apps/worker/src/import-fixtures.test.ts` + iOS `ShareExtensionTests`) pins
this behavior.

| Platform | Title / Image | Content (ingredients/steps) | Fetched where | Fallback chain | Known ceiling |
|---|---|---|---|---|---|
| Recipe blogs (AllRecipes, NYT Cooking, Fresh Off The Grid, Google Docs, Pinterest) | og/twitter meta | JSON-LD (`recipeIngredient`/`recipeInstructions`) via `extractRecipeDetailsFromHtml` | Worker | `structuredHtml` → `textInference` → title-only | reliable |
| Instagram | og:description caption → `extractInstagramRecipeTitle`; device fallback | caption → Gemini (`captionExtract`) | Worker (caption); device (title/image fallback) | `captionExtract` → `textInference` → title-only | datacenter rate-limiting; caption-less → title-only |
| TikTok | og caption → `extractTikTokRecipeTitle`; device fallback | caption → Gemini | Worker (caption); device fallback | `captionExtract` → `textInference` → title-only | caption-less → title-only |
| YouTube | og meta | Gemini video understanding (`youtubeVideo`) | Worker (Gemini reads the video URL) | `youtubeVideo` → `textInference` → title-only | non-cooking → title-only |
| Facebook | device caption → dish-name extract; `og:image` entity-decoded | device full caption → Gemini, only when provided | Device (residential IP); worker login-walled | device caption → Gemini → title-only / "Facebook Reel" placeholder | login-wall/rate-limit inconsistency; recipe-in-video (no caption) → title-only |

## Cross-cutting invariants
- `isAllowedSourceHost` gates `/recipes/parse`, `/recipes/enrich`, `/recipes` create.
- `isFacebookLinkShim` blocks the `facebook.com/l.php?u=` open redirector.
- `og:image` is re-hosted to Supabase (`recipe-previews`).
- Preview precedence: device-first for Facebook (worker login-walled), worker-first for all other platforms.
- Facebook content is title-only unless the iOS Share Extension supplies a full caption (device residential fetch).
```

- [ ] **Step 2: Commit (HOLD for user go-ahead)**

```bash
git add docs/import-platform-strategy.md
git commit -m "docs(import): per-platform import strategy reference"
```

## Task 2: Worker deterministic fixtures — blogs (JSON-LD)

**Files:**
- Create: `apps/worker/src/fixtures/import/blog-allrecipes.html` (captured real input)
- Create: `apps/worker/src/import-fixtures.test.ts`

- [ ] **Step 1: Capture a real blog input**

Run (saves a real AllRecipes page as a fixture; this is captured data, not fabricated):
```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && mkdir -p src/fixtures/import && \
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" \
"https://www.allrecipes.com/rotisserie-chicken-mushroom-soup-recipe-11946422" -o src/fixtures/import/blog-allrecipes.html
```
Confirm it contains JSON-LD: `grep -c "recipeIngredient" src/fixtures/import/blog-allrecipes.html` → expect `≥1`.

- [ ] **Step 2: Write the failing test**

Create `apps/worker/src/import-fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractRecipeDetailsFromHtml } from './index';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/import', name), 'utf8');

describe('import regression: recipe blogs (JSON-LD, deterministic)', () => {
  it('extracts ingredients + steps + title from AllRecipes JSON-LD', () => {
    const html = fixture('blog-allrecipes.html');
    const result = extractRecipeDetailsFromHtml(html, 'https://www.allrecipes.com/rotisserie-chicken-mushroom-soup-recipe-11946422');
    expect(result).not.toBeNull();
    expect(result!.title.length).toBeGreaterThan(0);
    expect(result!.ingredients.length).toBeGreaterThan(0);
    expect(result!.steps.length).toBeGreaterThan(0);
    expect(result!.imageUrl ?? '').toMatch(/^https?:\/\//);
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd apps/worker && npx vitest run src/import-fixtures.test.ts`
Expected: PASS (the parser already supports this; the test pins it as a regression baseline). If it FAILS, the captured fixture lacks JSON-LD — recapture a recipe URL that has it.

- [ ] **Step 4: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/fixtures/import/blog-allrecipes.html apps/worker/src/import-fixtures.test.ts
git commit -m "test(import): regression fixture for blog JSON-LD extraction"
```

## Task 3: Worker deterministic fixtures — IG/TikTok title + caption, YouTube, URL/allowlist

**Files:**
- Modify: `apps/worker/src/import-fixtures.test.ts`

- [ ] **Step 1: Add the deterministic cases**

Append to `apps/worker/src/import-fixtures.test.ts`. Import the extra functions at the top by changing the import line to:

```ts
import { extractRecipeDetailsFromHtml, extractInstagramRecipeTitle, extractTikTokRecipeTitle, isAllowedSourceHost, isFacebookLinkShim, fetchOembedCaption } from './index';
```

Then append:

```ts
describe('import regression: IG/TikTok title extraction (deterministic)', () => {
  it('IG: pulls dish name before the first food emoji', () => {
    expect(extractInstagramRecipeTitle('BANANA BREAD FRENCH TOAST BAKE 🍌🍞 the best brunch')).toBe('BANANA BREAD FRENCH TOAST BAKE');
  });
  it('TikTok: strips the "| TikTok" suffix and takes the lead phrase', () => {
    expect(extractTikTokRecipeTitle('Garlic Butter Shrimp Pasta | TikTok')).toBe('Garlic Butter Shrimp Pasta');
  });
});

describe('import regression: caption fetch (mocked fetch, deterministic)', () => {
  it('IG: reads og:description caption from HTML', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      text: async () => `<html><head><meta property="og:description" content="120 likes, 4 comments - chef on June 1, 2026: \\"Lemon Pasta. Ingredients: pasta, lemon, butter\\"" /></head></html>`,
    })) as unknown as typeof fetch;
    const caption = await fetchOembedCaption('https://www.instagram.com/reel/abc/', { fetchImpl });
    expect(caption).not.toBeNull();
    expect(caption).toContain('Lemon Pasta');
  });
});

describe('import regression: allowlist + shim (deterministic)', () => {
  it('allows the five platforms and rejects spoofs', () => {
    for (const h of ['tiktok.com', 'instagram.com', 'facebook.com', 'www.facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'www.allrecipes.com', 'cooking.nytimes.com', 'freshoffthegrid.com', 'docs.google.com']) {
      expect(isAllowedSourceHost(h)).toBe(true);
    }
    for (const h of ['facebook.com.evil.com', 'fb.watch.evil.com', 'evil.com', 'google.com']) {
      expect(isAllowedSourceHost(h)).toBe(false);
    }
  });
  it('flags the FB l.php open redirect but allows real reels', () => {
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/l.php?u=https://evil.com'))).toBe(true);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/reel/123'))).toBe(false);
  });
});
```

(Note: `docs.google.com` passes `isAllowedSourceHost` but bare `google.com` must not — the assertion above pins that.)

- [ ] **Step 2: Run it**

Run: `cd apps/worker && npx vitest run src/import-fixtures.test.ts`
Expected: PASS. If the IG/TikTok title expectations differ from current behavior, adjust the EXPECTED string to match what the function returns today (this suite pins current behavior, it does not change it).

- [ ] **Step 3: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/import-fixtures.test.ts
git commit -m "test(import): regression net for IG/TikTok titles, caption fetch, allowlist"
```

## Task 4: iOS XCTest target (infra) + first Swift test

**Files:**
- Create (via Xcode): `apps/ios/ios/App/ShareExtensionTests/` target
- Create: `apps/ios/ios/App/ShareExtensionTests/DeviceMetadataFetcherTests.swift`

This task is **Xcode-driven** (the agent cannot create an Xcode target or run XCTest). Hand to the user.

- [ ] **Step 1: Create the unit-test target in Xcode**

In Xcode: File → New → Target → **Unit Testing Bundle**. Name it `ShareExtensionTests`. Set its **Target to be Tested** to `ShareExtension`. Confirm it's added to the `App` project and a scheme can run it.

- [ ] **Step 2: Make the tested types visible to the test target**

For each Swift file under test (`DeviceMetadataFetcher.swift`, `WorkerClient.swift` for `ParsePreview`), in the File Inspector add `ShareExtensionTests` to its **Target Membership** (or mark the symbols `internal` and use `@testable import ShareExtension`). Build the test target (Cmd-U scheme) once to confirm it compiles with zero tests.

- [ ] **Step 3: Add a baseline test that exercises the existing helpers**

Create `apps/ios/ios/App/ShareExtensionTests/DeviceMetadataFetcherTests.swift`:

```swift
import XCTest
@testable import ShareExtension

final class DeviceMetadataFetcherTests: XCTestCase {
    func testStripFacebookEngagementPrefix_passesCleanCaptionThrough() {
        // looksLikeEngagementNoise should be false for a real dish caption.
        XCTAssertFalse(DeviceMetadataFetcher.looksLikeEngagementNoise("Triple Chocolate Banana Bread"))
    }
    func testLooksLikeEngagementNoise_trueForStatsString() {
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeEngagementNoise("562K views 5K reactions"))
    }
}
```

(If `looksLikeEngagementNoise` is `private`, change it to `internal` for testability — it has no reason to be private beyond convention.)

- [ ] **Step 4: Run the test target in Xcode**

Cmd-U on the `ShareExtensionTests` scheme. Expected: 2 tests pass. Report any target-membership/compile issues.

- [ ] **Step 5: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/App.xcodeproj/project.pbxproj apps/ios/ios/App/ShareExtensionTests
git commit -m "test(ios-share): add ShareExtensionTests XCTest target"
```

---

# PHASE 2 — Facebook full-caption feature

## Task 5: Worker — `geminiExtractFromCaption` helper (refactor extract-from-caption core)

**Files:**
- Modify: `apps/worker/src/index.ts` (inside/near `captionExtract`, ~5823-5838)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/src/enrich.test.ts` (and add `geminiExtractFromCaption` to the import from `'./index'` at line 2):

```ts
describe('geminiExtractFromCaption', () => {
  afterEach(() => vi.restoreAllMocks());
  it('runs Gemini extract on a provided caption and marks provenance extracted', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ingredients: ['1 cup flour'], steps: ['mix'], mealTypes: [], durationMinutes: null, notes: '', title: 'Cake' }) }] } }] })
    })) as unknown as typeof fetch;
    const result = await geminiExtractFromCaption({} as any, 'Cake. Ingredients: 1 cup flour. Steps: mix.', {
      fetchImpl, getAccessToken: async () => 'tok', getServiceAccount: async () => ({}) as any,
    });
    expect(result.ingredients).toEqual(['1 cup flour']);
    expect(result.provenance).toBe('extracted');
  });
  it('returns null provenance when Gemini finds nothing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ingredients: [], steps: [], mealTypes: [], durationMinutes: null, notes: '', title: '' }) }] } }] })
    })) as unknown as typeof fetch;
    const result = await geminiExtractFromCaption({} as any, 'just a vibe, no recipe here', {
      fetchImpl, getAccessToken: async () => 'tok', getServiceAccount: async () => ({}) as any,
    });
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "geminiExtractFromCaption"`
Expected: FAIL — `geminiExtractFromCaption is not a function`.

- [ ] **Step 3: Extract the helper and reuse it in `captionExtract`**

In `apps/worker/src/index.ts`, add this function immediately above `captionExtract` (before line 5771):

```ts
// Shared core: a caption string -> Gemini extract -> EnrichmentResult.
// Used by captionExtract (after it fetches the caption) and by the
// provided-caption path (FB, where the device supplies the caption).
async function geminiExtractFromCaption(
  env: Env,
  caption: string,
  deps: { fetchImpl?: typeof fetch; getAccessToken?: (env: Env) => Promise<string>; getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount> } = {}
): Promise<EnrichmentResult> {
  const parsed = await callGeminiExtract(env, buildExtractOnlyPrompt(caption), {
    fetchImpl: deps.fetchImpl,
    getAccessToken: deps.getAccessToken,
    getServiceAccount: deps.getServiceAccount,
  });
  const base = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
  const isEmpty = base.ingredients.length === 0 && base.steps.length === 0;
  return { ...base, provenance: isEmpty ? null : 'extracted' };
}
```

Then in `captionExtract`, replace the try-block body at lines 5823-5833 (the `callGeminiExtract` + result assembly) with a call to the helper:

```ts
  try {
    const result = await geminiExtractFromCaption(env, caption, {
      fetchImpl: deps.fetchImpl,
      getAccessToken: deps.getAccessToken,
      getServiceAccount: deps.getServiceAccount,
    });
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }
```

Add `geminiExtractFromCaption` to the `export { ... }` test-export block (near `stripFacebookEngagementPrefix`).

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts`
Expected: PASS — the new `geminiExtractFromCaption` cases pass AND the existing `captionExtract` cases stay green (the refactor is behavior-preserving).

- [ ] **Step 5: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "refactor(import): extract geminiExtractFromCaption shared core"
```

## Task 6: Worker — `providedCaption` in the chain + `caption` in the enrich endpoint

**Files:**
- Modify: `apps/worker/src/index.ts` — `ChainStrategies` type, `runEnrichmentChain` (~6000), `handleEnrichRecipe` (~2773)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Write the failing wiring tests**

Append to the `describe('runEnrichmentChain', ...)` block in `apps/worker/src/enrich.test.ts`:

```ts
  it('FB with a provided caption runs captionProvided and marks extracted', async () => {
    const captionProvided = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['1 cup flour'], steps: ['mix'], provenance: 'extracted' }));
    const contentful = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['should-not-run'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://www.facebook.com/reel/123',
      'Cake',
      { structuredHtml: contentful, captionExtract: contentful, youtubeVideo: contentful, textInference: contentful, captionProvided },
      'Cake. Ingredients: 1 cup flour. Steps: mix.'
    );
    expect(result.ingredients).toEqual(['1 cup flour']);
    expect(result.provenance).toBe('extracted');
    expect(winningStrategy).toBe('caption-provided');
    expect(captionProvided).toHaveBeenCalledTimes(1);
    expect(contentful).not.toHaveBeenCalled();
  });

  it('FB with no provided caption stays title-only', async () => {
    const captionProvided = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['x'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://www.facebook.com/reel/123',
      'Banana Bread',
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: async () => EMPTY_EXPECTED, youtubeVideo: async () => EMPTY_EXPECTED, textInference: async () => EMPTY_EXPECTED, captionProvided }
    );
    expect(result.title).toBe('Banana Bread');
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBe('title-only');
    expect(winningStrategy).toBeNull();
    expect(captionProvided).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "provided caption"`
Expected: FAIL — `runEnrichmentChain` ignores the 5th arg and the FB branch is still unconditional title-only.

- [ ] **Step 3: Implement**

In `apps/worker/src/index.ts`:

(a) Add `captionProvided` to the `ChainStrategies` type and `'caption-provided'` to the `winningStrategy` union (find the `type ChainStrategies = {` definition and the `runEnrichmentChain` return type):

```ts
// in ChainStrategies:
  captionProvided?: (env: Env, caption: string, title: string) => Promise<EnrichmentResult>;
```
```ts
// runEnrichmentChain return type union — add 'caption-provided':
): Promise<{ result: EnrichmentResult; winningStrategy: 'structured-html' | 'caption-extract' | 'youtube-video' | 'text-inference' | 'caption-provided' | null }>
```

(b) Add `providedCaption` as a 5th parameter to `runEnrichmentChain`:

```ts
async function runEnrichmentChain(
  env: Env,
  resolvedUrl: string,
  title: string,
  strategies: ChainStrategies,
  providedCaption?: string
): Promise<{ result: EnrichmentResult; winningStrategy: 'structured-html' | 'caption-extract' | 'youtube-video' | 'text-inference' | 'caption-provided' | null }> {
```

(c) Replace the existing FB title-only short-circuit (currently at ~6005-6017, the `if (/facebook\.com|fb\.watch/i.test(resolvedUrl))` block) with the caption-driven version:

```ts
  // Facebook reels: the worker is login-walled by FB from datacenter IPs, so
  // the iOS Share Extension fetches the full caption on-device (residential IP)
  // and passes it here. When a caption is provided, run the same Gemini
  // extraction Instagram/TikTok use; otherwise stay title-only (the device got
  // a login wall / no caption). The worker never fetches FB itself.
  if (/facebook\.com|fb\.watch/i.test(resolvedUrl)) {
    const cap = (providedCaption ?? '').trim();
    if (cap && strategies.captionProvided) {
      const r = await strategies.captionProvided(env, cap, title);
      if (r.ingredients.length > 0 || r.steps.length > 0) {
        return { result: r, winningStrategy: 'caption-provided' };
      }
    }
    return {
      result: { ...EMPTY_ENRICHMENT, title, provenance: title ? 'title-only' : null },
      winningStrategy: null,
    };
  }
```

(d) In `handleEnrichRecipe` (~2722), read the caption from the body and wire the strategy. After `const title = ...` (line 2724) add:

```ts
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 10_000) : '';
```

Then change the `runEnrichmentChain` call (~2773) to pass `captionProvided` and `caption`:

```ts
  const { result, winningStrategy } = await runEnrichmentChain(env, resolvedUrl, title, {
    structuredHtml,
    captionExtract,
    youtubeVideo,
    textInference,
    captionProvided: (e, cap) => geminiExtractFromCaption(e, cap),
  }, caption);
```

- [ ] **Step 4: Run the full enrich suite**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts`
Expected: PASS — new provided-caption tests pass; the existing FB title-only test (the no-caption case) still passes; IG/TikTok/blog chain tests unchanged.

- [ ] **Step 5: Run the full worker suite + the regression net**

Run: `cd apps/worker && npm test`
Expected: only the 4 known pre-existing failures; `import-fixtures.test.ts` green (no regression).

- [ ] **Step 6: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): FB caption-driven enrichment via provided caption"
```

## Task 7: iOS — `extractFullCaption` (anchored) + XCTest

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift`
- Modify: `apps/ios/ios/App/ShareExtensionTests/DeviceMetadataFetcherTests.swift`

- [ ] **Step 1: Write the failing XCTest**

Append to `DeviceMetadataFetcherTests.swift`:

```swift
    func testExtractFullCaption_recoversFullCaptionFromInlineJson() {
        // og:description is truncated; the full caption lives in inline JSON.
        let og = "Lemon Pasta. Ingredients: pasta, lemon..."
        let html = """
        <html><head><meta property="og:description" content="Lemon Pasta. Ingredients: pasta, lemon..." /></head>
        <body><script>{"message":{"text":"Lemon Pasta. Ingredients: pasta, lemon, butter, parmesan. Steps: 1) boil pasta 2) toss with lemon butter"}}</script></body></html>
        """
        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertTrue(full.contains("parmesan"))
        XCTAssertTrue(full.contains("boil pasta"))
        XCTAssertGreaterThan(full.count, og.count)
    }

    func testExtractFullCaption_fallsBackToOgWhenAnchorMissing() {
        let og = "Some Caption That Is Not In The Body"
        let html = "<html><head><meta property=\"og:description\" content=\"x\" /></head><body>nothing relevant</body></html>"
        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertEqual(full, og)
    }
```

- [ ] **Step 2: Run it (Xcode, Cmd-U)** — Expected: FAIL (`extractFullCaption` undefined).

- [ ] **Step 3: Implement `extractFullCaption`**

In `DeviceMetadataFetcher.swift`, add this `internal static` function in the helpers section (near `looksLikeEngagementNoise`):

```swift
    /// Recovers the full caption from FB's page HTML. `og:description` is a
    /// TRUNCATED prefix of the full caption, so we use its first ~40 chars as an
    /// anchor: find that text in the raw HTML (the full caption lives in FB's
    /// inline JSON), read out to the enclosing JSON string boundary, and
    /// unescape. Falls back to `ogDescription` if the anchor isn't found or the
    /// result isn't longer. Depends on no FB-specific JSON keys (durable).
    static func extractFullCaption(html: String, ogDescription: String) -> String {
        let trimmedOg = ogDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedOg.count >= 12 else { return trimmedOg }
        // Anchor on a leading slice unlikely to contain JSON-escapable chars.
        let anchorLen = min(40, trimmedOg.count)
        let anchor = String(trimmedOg.prefix(anchorLen))
        guard let anchorRange = html.range(of: anchor) else { return trimmedOg }
        // Walk forward to the next unescaped double-quote (JSON string end).
        var idx = anchorRange.upperBound
        var end = idx
        while idx < html.endIndex {
            let c = html[idx]
            if c == "\"" && (idx == html.startIndex || html[html.index(before: idx)] != "\\") {
                end = idx
                break
            }
            idx = html.index(after: idx)
            end = idx
        }
        let rawSlice = String(html[anchorRange.lowerBound..<end])
        let unescaped = unescapeJsonString(rawSlice)
        let cleaned = decodeHtmlEntities(unescaped).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.count > trimmedOg.count ? cleaned : trimmedOg
    }

    /// Unescapes a JSON string body: \n \t \" \/ \\ and \uXXXX.
    private static func unescapeJsonString(_ s: String) -> String {
        var out = ""
        var i = s.startIndex
        while i < s.endIndex {
            let c = s[i]
            if c == "\\", let next = s.index(i, offsetBy: 1, limitedBy: s.endIndex), next < s.endIndex {
                let e = s[next]
                switch e {
                case "n": out += "\n"; i = s.index(after: next)
                case "t": out += "\t"; i = s.index(after: next)
                case "r": i = s.index(after: next)
                case "\"": out += "\""; i = s.index(after: next)
                case "/": out += "/"; i = s.index(after: next)
                case "\\": out += "\\"; i = s.index(after: next)
                case "u":
                    let hexStart = s.index(after: next)
                    if let hexEnd = s.index(hexStart, offsetBy: 4, limitedBy: s.endIndex),
                       let code = UInt32(s[hexStart..<hexEnd], radix: 16),
                       let scalar = Unicode.Scalar(code) {
                        out.append(Character(scalar)); i = hexEnd
                    } else { out.append(c); i = s.index(after: i) }
                default: out.append(e); i = s.index(after: next)
                }
            } else {
                out.append(c); i = s.index(after: i)
            }
        }
        return out
    }
```

- [ ] **Step 4: Wire it into the FB block and return the caption**

In the `if isFacebook { ... }` block (after the engagement-prefix strip + noise gate), set the caption to the full extraction. Change the block so that, after the existing strip/guard, it computes the full caption from the raw HTML:

```swift
            if isFacebook {
                os_log("FB og:description RAW: %{public}@", log: fbCaptureLog, type: .default, caption)
                caption = caption.replacingOccurrences(
                    of: #"^(?:[\d.,]+\s*[KMB]?\s+(?:views?|reactions?|likes?|comments?|shares?)\s*[·•|,]?\s*)+"#,
                    with: "",
                    options: [.regularExpression, .caseInsensitive]
                ).trimmingCharacters(in: .whitespacesAndNewlines)
                if caption.isEmpty || Self.looksLikeEngagementNoise(caption) {
                    return nil
                }
                // Recover the FULL caption from the page HTML (og:description is
                // truncated). Used as the dish-name source AND passed to the
                // worker for Gemini ingredient/step extraction.
                fullCaption = Self.extractFullCaption(html: html, ogDescription: caption)
            }
```

Declare `var fullCaption: String? = nil` before the `if isInstagram` block, and at the end change the return to include it (see Step 5 for the ParsePreview field). The title still comes from `extractDishName(from: caption)` (the stripped, short caption — keeps the clean dish-name behavior); `fullCaption` is the long text for Gemini.

- [ ] **Step 5: Run the XCTest (Cmd-U)** — Expected: PASS (the 2 new `extractFullCaption` tests + the existing ones).

- [ ] **Step 6: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift apps/ios/ios/App/ShareExtensionTests/DeviceMetadataFetcherTests.swift
git commit -m "feat(ios-share): extract full FB caption (og-anchored) with XCTest"
```

## Task 8: iOS — thread the caption through `ParsePreview` → `save()` → worker

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/WorkerClient.swift` (`ParsePreview`, `enrichRecipe`)
- Modify: `apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift` (return caption)
- Modify: `apps/ios/ios/App/ShareExtension/ShareFormView.swift` (carry caption into save)

- [ ] **Step 1: Add `caption` to `ParsePreview`**

`WorkerClient.swift` lines 10-13:

```swift
struct ParsePreview {
    let title: String
    let imageUrl: String?
    var caption: String? = nil
}
```

- [ ] **Step 2: Return the full caption from the device fetcher**

In `DeviceMetadataFetcher.swift`, the final return becomes:

```swift
            let title = extractDishName(from: caption)
            guard !title.isEmpty else { return nil }
            return ParsePreview(title: title, imageUrl: ogImage, caption: fullCaption)
```

(`fullCaption` is nil for non-FB hosts, so this is FB-only data.)

- [ ] **Step 3: Add a `caption` param to `WorkerClient.enrichRecipe`**

`WorkerClient.swift` — change the signature and body:

```swift
    static func enrichRecipe(
        sourceUrl: String,
        title: String,
        caption: String? = nil,
        jwt: String
    ) async -> EnrichResult? {
```
and change the body dict (line 118):
```swift
        var body: [String: Any] = ["sourceUrl": sourceUrl, "title": title]
        if let caption = caption, !caption.isEmpty { body["caption"] = caption }
```

- [ ] **Step 4: Carry the caption from preview into save()**

In `ShareFormView.swift`: add a stored property on the view model `@Published var caption: String? = nil`. In `loadPreview()`, after computing `resolvedTitle`, capture the FB caption: `if isFacebook { caption = deviceResult?.caption }`. In `save()`, pass it to enrich — change the `WorkerClient.enrichRecipe(...)` call (~144) to:

```swift
                let enriched = await WorkerClient.enrichRecipe(
                    sourceUrl: urlSnapshot,
                    title: enrichTitle,
                    caption: self.caption,
                    jwt: jwt
                )
```

- [ ] **Step 5: Build the ShareExtension scheme (Cmd-B)** — Expected: compiles. (XCTest target still green via Cmd-U.)

- [ ] **Step 6: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/WorkerClient.swift apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift apps/ios/ios/App/ShareExtension/ShareFormView.swift
git commit -m "feat(ios-share): pass FB full caption to worker enrich"
```

---

# Verification & rollout (the gate)

## Task 9: Deploy dev + on-device verification

- [ ] **Step 1: Deploy worker to dev**

Run: `cd apps/worker && npx wrangler deploy --env dev`
(If auth `10000`: `npx wrangler logout && npx wrangler login`, then retry.)

- [ ] **Step 2: Worker suite + regression net green**

Run: `cd apps/worker && npm test`
Expected: only the 4 known pre-existing failures; `import-fixtures.test.ts` + `enrich.test.ts` green.

- [ ] **Step 3: Pre-deploy smoke test (protect-import-flow)**

Against dev API, `POST /recipes/parse` for an IG reel, a TikTok, the AllRecipes URL, an FB reel — none regress. `POST /recipes/enrich` (DEV_API_KEY) with a `caption` for an FB URL → returns ingredients/steps; without caption → title-only.

- [ ] **Step 4: Manual on-device Xcode test (the gate)**

Build on a real device (WorkerClient already at dev). Verify:
- FB reel **with** a written-out recipe caption → ingredients + steps appear.
- FB reel **without** a caption (recipe-in-video) → title-only / "Facebook Reel".
- One IG reel + one TikTok → unchanged (regression).
**Explicit user approval required before prod.**

## Task 10: Phase D cleanup + prod (after approval)

- [ ] **Step 1: Remove temp diagnostics** from `DeviceMetadataFetcher.swift`: `import os`, `#if DEBUG import UIKit`, `fbCaptureLog`, the `FB fetch`/`RAW`/`STRIPPED` `os_log`s, and the clipboard `Task`. Keep `extractFullCaption`, the strip, and the noise gate.

- [ ] **Step 2: Revert `WorkerClient.swift`** line 8 → `https://api.recifriend.com`. Verify: `grep -n "api-dev" apps/ios/ios/App/ShareExtension/WorkerClient.swift` → no output.

- [ ] **Step 3: Commit cleanup (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift apps/ios/ios/App/ShareExtension/WorkerClient.swift
git commit -m "chore(ios-share): remove FB capture diagnostics, revert API base to prod"
```

- [ ] **Step 4: Record prod rollback anchor + deploy**

Run: `cd apps/worker && npx wrangler deployments list` (note current active id), confirm clean `git status`, then `npx wrangler deploy`.

- [ ] **Step 5: Archive build 27 / 1.0.7 in Xcode** and upload to TestFlight/App Store. Confirm `APNS_HOST` left at prod/unset.

- [ ] **Step 6: Rollback if needed** — `cd apps/worker && npx wrangler rollback <prev-id>` (worker change is additive; frontend untouched).

---

## Deferred (Phase 3, not in this plan)

Gemini quality **eval set**: labeled real captions/URLs per platform + `npm run eval:import` against real Gemini reporting per-platform precision/recall. Build when tuning extraction quality. Size-capped, run manually (not CI).

## Self-review notes (for the executor)

- The Swift `extractFullCaption` regex/string logic and the worker stripper must stay in sync conceptually; the regression net (XCTest + vitest) is what catches drift.
- Update memory `project_import_fb_blog_enhancement.md` once FB caption import ships (FB now imports content when caption present; build 27).
- After Task 6, `runEnrichmentChain`'s FB branch is caption-driven; the Phase-1-era title-only short-circuit is fully replaced (not just supplemented).
