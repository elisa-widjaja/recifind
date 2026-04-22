# Recipe Enrichment Fallback Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `handleEnrichRecipe` into an explicit fallback chain — caption-extract → YouTube-video → text-inference — with console logging so future enrichment issues can be diagnosed without re-running them live.

**Architecture:** Three pure async strategy functions, each returning the same enrichment shape or empty if it can't extract. An orchestrator runs them in sequence, stops at the first non-empty result, and runs `fetchOgImage` in parallel with the chain. Response shape unchanged; zero frontend changes.

**Tech Stack:** Cloudflare Workers + TypeScript + vitest. Gemini 2.5 Flash (`generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`) for both text and video understanding. `r.jina.ai` proxy + platform oEmbed endpoints for text sources (unchanged from today).

**Spec:** [docs/superpowers/specs/2026-04-22-enrichment-fallback-chain-design.md](../specs/2026-04-22-enrichment-fallback-chain-design.md)

**Test framework note:** `apps/worker` uses vitest. Tests mock `fetch` + `callGemini`'s dependency-injection points (`fetchImpl`, `getAccessToken`, `getServiceAccount`). Each strategy function takes an optional deps arg for testability, matching the existing `CallGeminiDeps` pattern at [index.ts:4311](apps/worker/src/index.ts#L4311).

---

## File Structure

- **Modify:** `apps/worker/src/index.ts` — add `fetchOembedCaption`, `buildExtractOnlyPrompt`, `buildVideoExtractOnlyPrompt`, `captionExtract`, `youtubeVideo`, `textInference`, extend `callGemini` with optional video parts, rewrite `handleEnrichRecipe` body.
- **Create:** `apps/worker/src/enrich.test.ts` — unit tests for each strategy + orchestrator fall-through.
- **No frontend changes.** No schema changes. No new env vars or secrets.

All strategies live in `index.ts` alongside `callGemini` and `buildGeminiPrompt` (follows existing convention — `apps/worker/src/index.ts` is the single worker file). Each is exported at the bottom of the file for test access.

---

## Task 1: Extract `fetchOembedCaption` helper (refactor, no behavior change)

**Files:**
- Modify: `apps/worker/src/index.ts` (around lines [4001-4045](apps/worker/src/index.ts#L4001) — the oEmbed fallback branches inside `fetchRawRecipeText`)
- Test: `apps/worker/src/enrich.test.ts` (new file)

**Why:** The caption-extract strategy needs clean access to the oEmbed caption for TikTok/Instagram/YouTube. Today that logic is tangled inside `fetchRawRecipeText` as a fallback. Extract it into a reusable helper.

- [ ] **Step 1: Create the test file with the first failing test**

Create `apps/worker/src/enrich.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOembedCaption } from './index';

describe('fetchOembedCaption', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for non-social hosts', async () => {
    const result = await fetchOembedCaption('https://example.com/recipe');
    expect(result).toBeNull();
  });

  it('returns the caption for a TikTok URL via oEmbed', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: 'Best pasta recipe ever', author_name: 'chef_jane' })
    })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.tiktok.com/@chef_jane/video/12345',
      { fetchImpl: mockFetch }
    );
    expect(result).toBe('Recipe by chef_jane:\n\nBest pasta recipe ever');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain('tiktok.com/oembed');
  });

  it('returns null when oEmbed returns a non-OK response', async () => {
    const mockFetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.tiktok.com/@chef_jane/video/12345',
      { fetchImpl: mockFetch }
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: FAIL with `fetchOembedCaption` not exported from `./index`.

- [ ] **Step 3: Add the helper + export it**

In `apps/worker/src/index.ts`, locate `fetchRawRecipeText` at [line 3987](apps/worker/src/index.ts#L3987). Immediately **before** it, add:

```ts
type FetchOembedCaptionDeps = {
  fetchImpl?: typeof fetch;
};

// Returns the oEmbed "title" field (which is usually the post caption on social
// platforms), formatted as "Recipe by <author>: <caption>". Returns null for
// hosts without an oEmbed endpoint we know about, or when the fetch fails.
async function fetchOembedCaption(
  sourceUrl: string,
  deps: FetchOembedCaptionDeps = {}
): Promise<string | null> {
  const { fetchImpl = fetch } = deps;
  try {
    const parsed = new URL(sourceUrl);
    let oembedUrl: string | null = null;
    let normalizedUrl = sourceUrl;

    if (parsed.hostname.includes('tiktok.com')) {
      oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
    } else if (parsed.hostname.includes('instagram.com')) {
      normalizedUrl = sourceUrl.split('?')[0].replace(/\/?$/, '/');
      oembedUrl = `https://www.instagram.com/oembed/?omitscript=true&url=${encodeURIComponent(normalizedUrl)}`;
    } else if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
    }

    if (!oembedUrl) return null;

    const response = await fetchImpl(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
        'Accept': 'application/json'
      }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { title?: string; author_name?: string };
    const caption = (payload.title || '').trim();
    if (!caption) return null;
    const author = payload.author_name || (parsed.hostname.includes('tiktok.com') ? 'TikTok creator' :
                                           parsed.hostname.includes('instagram.com') ? 'Instagram creator' :
                                           'YouTube creator');
    return `Recipe by ${author}:\n\n${caption}`;
  } catch {
    return null;
  }
}
```

At the bottom `export { ... }` block at [line 4492](apps/worker/src/index.ts#L4492), add `fetchOembedCaption`:

```ts
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: PASS (3/3). The existing pre-session failures in `public.test.ts` are unrelated.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "refactor(worker): extract fetchOembedCaption helper"
```

---

## Task 2: Extend `callGemini` to accept a video URL (backwards-compatible)

**Files:**
- Modify: `apps/worker/src/index.ts` (around [line 4311](apps/worker/src/index.ts#L4311) — `callGemini` signature + body)
- Test: `apps/worker/src/gemini.test.ts` (extend existing file)

**Why:** The YouTube-video strategy needs to send a multi-part request with a `fileData` part pointing at the YouTube URL. `callGemini` currently only sends a single text part.

- [ ] **Step 1: Add a failing test to `gemini.test.ts`**

Open `apps/worker/src/gemini.test.ts` and add a second `it(...)` inside the existing `describe('callGemini', ...)` block:

```ts
  it('includes a fileData part when videoUrl option is provided', async () => {
    const prompt = 'extract recipe from video';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: '{"ingredients":[]}' }] }
          }
        ]
      })
    })) as unknown as typeof fetch;

    await callGemini(
      {} as Env,
      prompt,
      {
        fetchImpl: mockFetch,
        getAccessToken: async () => 'fake-token',
        getServiceAccount: async () => ({
          client_email: 'svc@example.com',
          private_key: 'fake-key',
          token_uri: 'https://oauth2.googleapis.com/token',
          project_id: 'proj-123'
        }),
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
      }
    );

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse((options as RequestInit).body as string);
    expect(parsedBody.contents[0].parts).toHaveLength(2);
    expect(parsedBody.contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=abc123', mimeType: 'video/*' }
    });
    expect(parsedBody.contents[0].parts[1]).toEqual({ text: prompt });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npm test -- --run gemini.test.ts`
Expected: FAIL. The request body won't have 2 parts because `callGemini` doesn't yet handle `videoUrl`.

- [ ] **Step 3: Extend `callGemini`**

Modify `callGemini` at [line 4311](apps/worker/src/index.ts#L4311). Update the `CallGeminiDeps` type and the function body:

Locate the `CallGeminiDeps` type definition (search for `type CallGeminiDeps` — it's near `callGemini`). Add `videoUrl?: string`:

```ts
type CallGeminiDeps = {
  fetchImpl?: typeof fetch;
  getAccessToken?: (env: Env) => Promise<string>;
  getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount>;
  videoUrl?: string;
};
```

(Keep existing fields exactly as they are. Only add `videoUrl`.)

Inside `callGemini`, change the `contents` array construction. Replace:

```ts
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
```

with:

```ts
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: deps.videoUrl
              ? [
                  { fileData: { fileUri: deps.videoUrl, mimeType: 'video/*' } },
                  { text: prompt }
                ]
              : [{ text: prompt }]
          }
        ],
        generationConfig: {
```

(Note: you'll need to destructure `deps` at the top too, but currently the function destructures individual fields. Change the destructure line from `const { fetchImpl = fetch, ... } = deps;` to keep `deps` available — the simplest fix is to reference `deps.videoUrl` directly without destructuring it. Leave the other destructures alone.)

- [ ] **Step 4: Run both existing and new tests**

Run: `cd apps/worker && npm test -- --run gemini.test.ts`
Expected: PASS (2/2). The original test (text-only) still passes because `deps.videoUrl` is undefined → falls back to the single text-part branch.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/gemini.test.ts
git commit -m "feat(worker): callGemini accepts optional videoUrl for multi-part content"
```

---

## Task 3: Implement `captionExtract` strategy

**Files:**
- Modify: `apps/worker/src/index.ts` (add new helpers + strategy function)
- Test: `apps/worker/src/enrich.test.ts` (extend)

**Why:** Strategy 1 of the fallback chain — try to pull structured recipe content out of the oEmbed caption using a strict extract-only Gemini prompt.

- [ ] **Step 1: Add failing tests for `captionExtract`**

Append to `apps/worker/src/enrich.test.ts`:

```ts
import { captionExtract } from './index';

describe('captionExtract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeEnv = {} as Env;
  const baseDeps = {
    getAccessToken: async () => 'fake-token',
    getServiceAccount: async () => ({
      client_email: 'svc@example.com',
      private_key: 'fake-key',
      token_uri: 'https://oauth2.googleapis.com/token',
      project_id: 'proj-123'
    })
  };

  it('returns empty result when caption fetch returns null', async () => {
    const deps = {
      ...baseDeps,
      fetchOembedCaption: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    };
    const result = await captionExtract(fakeEnv, 'https://example.com/recipe', 'Pasta', deps);
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(deps.fetchImpl).not.toHaveBeenCalled(); // no Gemini call
  });

  it('returns empty result when caption is shorter than 50 chars', async () => {
    const deps = {
      ...baseDeps,
      fetchOembedCaption: async () => 'too short',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    };
    const result = await captionExtract(fakeEnv, 'https://tiktok.com/x', 'Pasta', deps);
    expect(result.ingredients).toEqual([]);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('passes caption to Gemini and returns parsed result', async () => {
    const longCaption = 'Recipe by chef_jane:\n\nBest pasta ever. Ingredients:\n- 1 cup flour\n- 2 eggs\n\nInstructions:\n1. Mix flour and eggs\n2. Knead for 5 min';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['1 cup flour', '2 eggs'],
          steps: ['Mix flour and eggs', 'Knead for 5 min'],
          mealTypes: [],
          durationMinutes: null,
          notes: '',
          title: 'Best pasta ever'
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const deps = {
      ...baseDeps,
      fetchOembedCaption: async () => longCaption,
      fetchImpl: mockFetch,
    };
    const result = await captionExtract(fakeEnv, 'https://tiktok.com/@chef/video/1', 'Pasta', deps);
    expect(result.ingredients).toEqual(['1 cup flour', '2 eggs']);
    expect(result.steps).toEqual(['Mix flour and eggs', 'Knead for 5 min']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Prompt should explicitly ask for extract-only, not inference
    const parsedBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const promptText = parsedBody.contents[0].parts[0].text;
    expect(promptText).toContain('Extract ONLY what is explicitly present');
    expect(promptText).toContain(longCaption);
  });

  it('returns empty result when Gemini returns empty arrays', async () => {
    const longCaption = 'Recipe by chef_jane:\n\nLove this pasta so good yum yum. Tried it last weekend.';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: [],
          steps: [],
          mealTypes: [],
          durationMinutes: null,
          notes: '',
          title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const deps = {
      ...baseDeps,
      fetchOembedCaption: async () => longCaption,
      fetchImpl: mockFetch,
    };
    const result = await captionExtract(fakeEnv, 'https://tiktok.com/x', 'Pasta', deps);
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: FAIL — `captionExtract` not exported.

- [ ] **Step 3: Add the strategy function + prompt builder**

In `apps/worker/src/index.ts`, add **after** `fetchOembedCaption` (which you added in Task 1):

```ts
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
};

const EMPTY_ENRICHMENT: EnrichmentResult = {
  title: '',
  imageUrl: '',
  mealTypes: [],
  ingredients: [],
  steps: [],
  durationMinutes: null,
  notes: '',
};

function buildExtractOnlyPrompt(captionText: string): string {
  return `You are extracting a recipe from a social-media caption. Extract ONLY what is explicitly present. DO NOT invent ingredients, quantities, or steps.

Rules:
- If the caption lists ingredients (bullet points, numbered, or comma-separated after "Ingredients:"), extract each one verbatim.
- If the caption describes steps (numbered, "Step 1:", "Method:", etc.), extract each step verbatim. Preserve the creator's voice and phrasing.
- Minor normalization is OK: "tbs" -> "tbsp", "1c" -> "1 cup".
- If the caption does NOT contain explicit ingredients OR explicit steps, return empty arrays. DO NOT guess from the title or general culinary knowledge.

Return JSON matching this schema:
{ "ingredients": [], "steps": [], "mealTypes": [], "durationMinutes": null, "notes": "", "title": "" }

Caption:
${captionText}`;
}

function parsedToEnrichmentResult(parsed: any): EnrichmentResult {
  return {
    title: typeof parsed?.title === 'string' ? parsed.title.trim() : '',
    imageUrl: typeof parsed?.imageUrl === 'string' ? parsed.imageUrl.trim() : '',
    mealTypes: Array.isArray(parsed?.mealTypes) ? sanitizeStringArray(parsed.mealTypes) : [],
    ingredients: Array.isArray(parsed?.ingredients) ? sanitizeStringArray(parsed.ingredients) : [],
    steps: Array.isArray(parsed?.steps) ? sanitizeStringArray(parsed.steps) : [],
    durationMinutes:
      typeof parsed?.durationMinutes === 'number' && Number.isFinite(parsed.durationMinutes)
        ? Math.max(0, Math.round(parsed.durationMinutes))
        : null,
    notes: typeof parsed?.notes === 'string' ? parsed.notes.trim() : '',
  };
}

type CaptionExtractDeps = {
  fetchOembedCaption?: typeof fetchOembedCaption;
  fetchImpl?: typeof fetch;
  getAccessToken?: (env: Env) => Promise<string>;
  getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount>;
};

async function captionExtract(
  env: Env,
  sourceUrl: string,
  _title: string,
  deps: CaptionExtractDeps = {}
): Promise<EnrichmentResult> {
  const startedAt = Date.now();
  const captionFetcher = deps.fetchOembedCaption ?? fetchOembedCaption;
  let caption: string | null = null;
  try {
    caption = await captionFetcher(sourceUrl, { fetchImpl: deps.fetchImpl });
  } catch (err) {
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }

  if (!caption || caption.length < 50) {
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption?.length ?? 0, outcome: 'empty', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  try {
    const completion = await callGemini(env, buildExtractOnlyPrompt(caption), {
      fetchImpl: deps.fetchImpl,
      getAccessToken: deps.getAccessToken,
      getServiceAccount: deps.getServiceAccount,
    });
    const parsed = parseGeminiRecipeJson(completion);
    const result = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    console.log('[enrich]', { strategy: 'caption-extract', url: sourceUrl, captionLength: caption.length, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }
}
```

Update the export block at the bottom of the file to include `captionExtract`:

```ts
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: PASS — all `captionExtract` tests green. The earlier `fetchOembedCaption` tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(worker): captionExtract strategy for oEmbed caption parsing"
```

---

## Task 4: Implement `youtubeVideo` strategy

**Files:**
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/src/enrich.test.ts`

**Why:** Strategy 2 — use Gemini 2.5 Flash's native YouTube URL support for videos where the caption lacks ingredients.

- [ ] **Step 1: Add failing tests**

Append to `apps/worker/src/enrich.test.ts`:

```ts
import { youtubeVideo } from './index';

describe('youtubeVideo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeEnv = {} as Env;
  const baseDeps = {
    getAccessToken: async () => 'fake-token',
    getServiceAccount: async () => ({
      client_email: 'svc@example.com',
      private_key: 'fake-key',
      token_uri: 'https://oauth2.googleapis.com/token',
      project_id: 'proj-123'
    })
  };

  it('returns empty without a Gemini call for non-YouTube URLs', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    const result = await youtubeVideo(fakeEnv, 'https://www.tiktok.com/@x/video/1', 'Pasta', { ...baseDeps, fetchImpl: mockFetch });
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends a multi-part Gemini request with the YouTube URL and returns parsed result', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['pasta', 'olive oil'],
          steps: ['Boil water', 'Cook pasta'],
          mealTypes: ['dinner'],
          durationMinutes: 15,
          notes: '',
          title: 'Video pasta'
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await youtubeVideo(
      fakeEnv,
      'https://www.youtube.com/watch?v=abc123',
      'Pasta',
      { ...baseDeps, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['pasta', 'olive oil']);
    expect(result.steps).toEqual(['Boil water', 'Cook pasta']);

    const parsedBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(parsedBody.contents[0].parts).toHaveLength(2);
    expect(parsedBody.contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=abc123', mimeType: 'video/*' }
    });
  });

  it('accepts youtu.be, youtube.com/shorts, and m.youtube.com hosts', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['x'], steps: ['y'], mealTypes: [], durationMinutes: null, notes: '', title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    for (const url of [
      'https://youtu.be/abc',
      'https://www.youtube.com/shorts/xyz',
      'https://m.youtube.com/watch?v=mno',
    ]) {
      const result = await youtubeVideo(fakeEnv, url, '', { ...baseDeps, fetchImpl: mockFetch });
      expect(result.ingredients).toEqual(['x']);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns empty when Gemini throws', async () => {
    const mockFetch = vi.fn(async () => { throw new Error('network fail'); }) as unknown as typeof fetch;
    const result = await youtubeVideo(
      fakeEnv,
      'https://www.youtube.com/watch?v=abc',
      '',
      { ...baseDeps, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it('returns empty when the Gemini call exceeds the timeout', async () => {
    // Resolve fetch after 100ms, but give the strategy only a 10ms timeout.
    const mockFetch = vi.fn(
      async () => new Promise((r) => setTimeout(() => r({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })
      }), 100))
    ) as unknown as typeof fetch;

    const result = await youtubeVideo(
      fakeEnv,
      'https://www.youtube.com/watch?v=abc',
      '',
      { ...baseDeps, fetchImpl: mockFetch, timeoutMs: 10 }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: FAIL — `youtubeVideo` not exported.

- [ ] **Step 3: Add the strategy function + video prompt**

In `apps/worker/src/index.ts`, add **after** `captionExtract`:

```ts
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com']);

function buildVideoExtractOnlyPrompt(): string {
  return `You are watching a cooking video. Extract the ingredients the chef shows or says, and the steps they follow.

Rules:
- Extract only what is demonstrated or spoken in the video.
- Preserve the chef's voice and phrasing for step descriptions.
- Minor normalization of units and spelling is allowed.
- If the video has no explicit ingredient list or steps (e.g., it is not a cooking video, or no recipe is demonstrated), return empty arrays. DO NOT invent ingredients.

Return JSON matching this schema:
{ "ingredients": [], "steps": [], "mealTypes": [], "durationMinutes": null, "notes": "", "title": "" }`;
}

type YoutubeVideoDeps = {
  fetchImpl?: typeof fetch;
  getAccessToken?: (env: Env) => Promise<string>;
  getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount>;
  timeoutMs?: number;
};

async function youtubeVideo(
  env: Env,
  sourceUrl: string,
  _title: string,
  deps: YoutubeVideoDeps = {}
): Promise<EnrichmentResult> {
  const startedAt = Date.now();
  const timeoutMs = deps.timeoutMs ?? 30_000;
  let host: string;
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    return EMPTY_ENRICHMENT;
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return EMPTY_ENRICHMENT;
  }

  // Race the Gemini call against a timeout so a stalled video call doesn't
  // block the orchestrator from falling through to text-inference.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    const raced = await Promise.race([
      callGemini(env, buildVideoExtractOnlyPrompt(), {
        fetchImpl: deps.fetchImpl,
        getAccessToken: deps.getAccessToken,
        getServiceAccount: deps.getServiceAccount,
        videoUrl: sourceUrl,
      }),
      timeoutPromise,
    ]);

    if (raced === 'timeout') {
      console.log('[enrich]', { strategy: 'youtube-video', url: sourceUrl, outcome: 'timeout', duration_ms: Date.now() - startedAt });
      return EMPTY_ENRICHMENT;
    }

    const parsed = parseGeminiRecipeJson(raced);
    const result = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'youtube-video', url: sourceUrl, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    console.log('[enrich]', { strategy: 'youtube-video', url: sourceUrl, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

Update the export block:

```ts
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: PASS — all `youtubeVideo` tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(worker): youtubeVideo strategy for Gemini video understanding"
```

---

## Task 5: Implement `textInference` strategy (refactor of existing code)

**Files:**
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/src/enrich.test.ts`

**Why:** Strategy 3 — extract the existing `handleEnrichRecipe` text-path into a named strategy function so the orchestrator can call it cleanly. Behavior must be byte-for-byte identical to today's `rawText → buildGeminiPrompt → callGemini` flow, minus the og:image fetch (which moves to the orchestrator).

- [ ] **Step 1: Add failing tests**

Append to `apps/worker/src/enrich.test.ts`:

```ts
import { textInference } from './index';

describe('textInference', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeEnv = {} as Env;
  const baseDeps = {
    getAccessToken: async () => 'fake-token',
    getServiceAccount: async () => ({
      client_email: 'svc@example.com',
      private_key: 'fake-key',
      token_uri: 'https://oauth2.googleapis.com/token',
      project_id: 'proj-123'
    })
  };

  it('returns empty when raw text fetch returns null and title is empty', async () => {
    const deps = {
      ...baseDeps,
      fetchRawRecipeText: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    };
    const result = await textInference(fakeEnv, 'https://example.com/x', '', deps);
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('calls Gemini with culinary-expert prompt when raw text is available', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['inferred1'], steps: ['inferred step'], mealTypes: [], durationMinutes: null, notes: '', title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/recipe',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'some rendered HTML text about pasta', fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['inferred1']);

    const parsedBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const promptText = parsedBody.contents[0].parts[0].text;
    // This is the inference-allowing prompt (existing buildGeminiPrompt text)
    expect(promptText).toContain('culinary expert');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: FAIL — `textInference` not exported.

- [ ] **Step 3: Add the strategy function**

In `apps/worker/src/index.ts`, add **after** `youtubeVideo`:

```ts
type TextInferenceDeps = {
  fetchRawRecipeText?: typeof fetchRawRecipeText;
  fetchImpl?: typeof fetch;
  getAccessToken?: (env: Env) => Promise<string>;
  getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount>;
};

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

  const textForGemini = rawText || (title ? `Recipe: ${title}` : null);
  if (!textForGemini) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: 0, outcome: 'empty', duration_ms: Date.now() - startedAt });
    return EMPTY_ENRICHMENT;
  }

  // Reuse the existing "culinary expert" prompt (allows inference on weak text).
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
    const completion = await callGemini(env, buildGeminiPrompt(recipeForPrompt, textForGemini), {
      fetchImpl: deps.fetchImpl,
      getAccessToken: deps.getAccessToken,
      getServiceAccount: deps.getServiceAccount,
    });
    const parsed = parseGeminiRecipeJson(completion);
    const result = parsed ? parsedToEnrichmentResult(parsed) : EMPTY_ENRICHMENT;
    const isEmpty = result.ingredients.length === 0 && result.steps.length === 0;
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText?.length ?? 0, outcome: isEmpty ? 'empty' : 'extracted', duration_ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    console.log('[enrich]', { strategy: 'text-inference', url: sourceUrl, rawTextLength: rawText?.length ?? 0, outcome: 'error', duration_ms: Date.now() - startedAt, error: String(err) });
    return EMPTY_ENRICHMENT;
  }
}
```

Update the export block:

```ts
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: PASS — `textInference` tests green, previous tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(worker): textInference strategy wraps the existing Gemini text path"
```

---

## Task 6: Rewrite `handleEnrichRecipe` to use the orchestrator

**Files:**
- Modify: `apps/worker/src/index.ts` ([line 1874](apps/worker/src/index.ts#L1874) — `handleEnrichRecipe` body)
- Test: `apps/worker/src/enrich.test.ts` (orchestrator-level test)

**Why:** Wire the three strategies together, run `fetchOgImage` in parallel with the chain, return the unchanged response shape, and log the winning strategy.

- [ ] **Step 1: Add orchestrator integration tests**

Append to `apps/worker/src/enrich.test.ts`:

```ts
import { runEnrichmentChain } from './index';

describe('runEnrichmentChain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns caption-extract result and skips subsequent strategies when caption yields ingredients', async () => {
    const captionStrat = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['flour'], steps: ['mix'] }));
    const videoStrat = vi.fn(async () => EMPTY_EXPECTED);
    const textStrat = vi.fn(async () => EMPTY_EXPECTED);
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://tiktok.com/x',
      'Pasta',
      { captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
    );
    expect(result.ingredients).toEqual(['flour']);
    expect(winningStrategy).toBe('caption-extract');
    expect(videoStrat).not.toHaveBeenCalled();
    expect(textStrat).not.toHaveBeenCalled();
  });

  it('falls through caption → video → text when each returns empty', async () => {
    const captionStrat = vi.fn(async () => EMPTY_EXPECTED);
    const videoStrat = vi.fn(async () => EMPTY_EXPECTED);
    const textStrat = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['inferred'], steps: ['step'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://example.com/x',
      'Recipe',
      { captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
    );
    expect(result.ingredients).toEqual(['inferred']);
    expect(winningStrategy).toBe('text-inference');
    expect(captionStrat).toHaveBeenCalledTimes(1);
    expect(videoStrat).toHaveBeenCalledTimes(1);
    expect(textStrat).toHaveBeenCalledTimes(1);
  });

  it('returns winningStrategy=null when all three strategies return empty', async () => {
    const empty = async () => EMPTY_EXPECTED;
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://example.com/x',
      '',
      { captionExtract: empty, youtubeVideo: empty, textInference: empty }
    );
    expect(result.ingredients).toEqual([]);
    expect(winningStrategy).toBeNull();
  });
});

const EMPTY_EXPECTED = {
  title: '', imageUrl: '', mealTypes: [], ingredients: [], steps: [], durationMinutes: null, notes: ''
};
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && npm test -- --run enrich.test.ts`
Expected: FAIL — `runEnrichmentChain` not exported.

- [ ] **Step 3: Replace the body of `handleEnrichRecipe` + add `runEnrichmentChain`**

In `apps/worker/src/index.ts`:

**a.** Add `runEnrichmentChain` immediately **after** `textInference` (before the `export { ... }` block):

```ts
type ChainStrategies = {
  captionExtract: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
  youtubeVideo: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
  textInference: (env: Env, url: string, title: string) => Promise<EnrichmentResult>;
};

async function runEnrichmentChain(
  env: Env,
  resolvedUrl: string,
  title: string,
  strategies: ChainStrategies
): Promise<{ result: EnrichmentResult; winningStrategy: 'caption-extract' | 'youtube-video' | 'text-inference' | null }> {
  const isEmpty = (r: EnrichmentResult) => r.ingredients.length === 0 && r.steps.length === 0;

  let result = await strategies.captionExtract(env, resolvedUrl, title);
  if (!isEmpty(result)) return { result, winningStrategy: 'caption-extract' };

  result = await strategies.youtubeVideo(env, resolvedUrl, title);
  if (!isEmpty(result)) return { result, winningStrategy: 'youtube-video' };

  result = await strategies.textInference(env, resolvedUrl, title);
  if (!isEmpty(result)) return { result, winningStrategy: 'text-inference' };

  return { result, winningStrategy: null };
}
```

**b.** Replace the current `handleEnrichRecipe` body (from [line 1874](apps/worker/src/index.ts#L1874) to the closing `}` at line 1942-ish) with:

```ts
async function handleEnrichRecipe(request: Request, env: Env) {
  const body = await readJsonBody(request);
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!sourceUrl) {
    throw new HttpError(400, 'sourceUrl is required');
  }

  if (!env.GEMINI_SERVICE_ACCOUNT_B64) {
    throw new HttpError(503, 'Enrichment service is not configured');
  }

  // Resolve short URLs once up front so every strategy sees the canonical form.
  const resolvedUrl = await resolveSourceUrl(sourceUrl);

  const startedAt = Date.now();
  // og:image runs in parallel with the strategy chain — it is never blocked by
  // (and never blocks) strategy fall-through.
  const ogImagePromise = fetchOgImage(resolvedUrl);

  const { result, winningStrategy } = await runEnrichmentChain(env, resolvedUrl, title, {
    captionExtract,
    youtubeVideo,
    textInference,
  });
  const ogImage = await ogImagePromise;

  console.log('[enrich]', {
    url: resolvedUrl,
    winningStrategy: winningStrategy ?? 'none',
    total_duration_ms: Date.now() - startedAt,
    ingredients_count: result.ingredients.length,
    steps_count: result.steps.length,
  });

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
    },
  });
}
```

**c.** Update the export block to add `runEnrichmentChain`:

```ts
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
  runEnrichmentChain,
};
```

- [ ] **Step 4: Run all worker tests**

Run: `cd apps/worker && npm test -- --run`
Expected: PASS — all enrich/gemini tests pass. The pre-existing `public.test.ts > getPublicDiscover` failures (2) remain unrelated.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(worker): fallback chain orchestrator in handleEnrichRecipe"
```

---

## Task 7: Deploy to dev + manual verification

**Files:** None modified. This task verifies behavior end-to-end.

- [ ] **Step 1: Deploy the worker to dev env**

Run: `cd apps/worker && npx wrangler deploy --env dev`
Expected: `Deployed recipes-worker-dev triggers` with new Version ID. Live at `api-dev.recifriend.com`.

- [ ] **Step 2: Start `wrangler tail --env dev` in a second terminal**

Run: `cd apps/worker && npx wrangler tail --env dev`
Expected: streams logs from the dev worker. Leave this running for the tests below.

- [ ] **Step 3: Scenario 1 — TikTok reel with ingredients in caption**

On iOS (dev build) or `dev.recifriend.com`: share a TikTok reel whose caption contains an explicit ingredient list and numbered steps. Save the recipe.

Expected in `wrangler tail`: a `[enrich]` log line with `winningStrategy: "caption-extract"` and `ingredients_count > 0`. In the app: ingredients match the caption verbatim (up to minor normalization).

- [ ] **Step 4: Scenario 2 — Instagram reel with just a caption title**

Share a recipe reel whose caption is only a title (e.g., "My favorite pasta"). Save.

Expected: `winningStrategy: "text-inference"` (caption was too short / not structured, YouTube strategy skipped, falls to text inference). Ingredients will be Gemini's best guess — acceptable for this spec.

- [ ] **Step 5: Scenario 3 — YouTube cooking video (3-10 min)**

Paste a YouTube cooking video URL on web (or share on iOS).

Expected: `winningStrategy: "youtube-video"` (caption-extract returns empty from the YouTube video's description; video strategy watches the video and extracts). `total_duration_ms` will be longer (~5-15s) than the other scenarios. Ingredients should be rich and match what the chef describes.

- [ ] **Step 6: Scenario 4 — YouTube Short**

Paste a YouTube Shorts URL (`youtube.com/shorts/<id>`).

Expected: `winningStrategy: "youtube-video"`, ingredients extracted from the short.

- [ ] **Step 7: Scenario 5 — non-recipe URL**

Paste a news article URL or a non-cooking YouTube video.

Expected: `winningStrategy: "none"` or `"text-inference"` with empty/minimal arrays. The request must NOT crash. App shows no ingredients — acceptable.

- [ ] **Step 8: Scenario 6 — previously-working URL (regression check)**

Pick a URL that enriched well on the OLD worker (before this plan). Re-paste it on the NEW worker.

Expected: ingredients look at least as good as before. If caption had structured recipe, `winningStrategy: "caption-extract"`. If not, `"text-inference"` behaves identically to the old pipeline.

- [ ] **Step 9: Record results**

If all six scenarios pass, proceed to rollout. If any fail with a clear bug, stop and return to the relevant Task.

- [ ] **Step 10: No code change — no commit**

---

## Rollout

After Task 7 passes cleanly on dev:

```
cd apps/worker && npx wrangler deploy
```

(No `--env` flag = deploys to prod worker `recipes-worker`. Serves `api.recifriend.com`.)

Monitor `wrangler tail` (no `--env`, prod) for the first few real share-extension saves to confirm the fallback chain is working in prod.

No frontend deploy needed.
