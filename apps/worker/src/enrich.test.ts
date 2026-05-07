import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption, captionExtract, youtubeVideo, textInference, runEnrichmentChain, enrichAfterSave, handleEnrichRecipe } from './index';
import type { Env } from './index';

describe('fetchRawRecipeText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Jina AI text when fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => 'Ingredients: eggs, butter\n\nSteps: 1. Crack eggs'
    })));

    const result = await fetchRawRecipeText('https://somerecipeblog.com/scrambled-eggs');
    expect(result).toContain('eggs');
  });

  it('falls back to Instagram oEmbed caption when Jina AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('r.jina.ai')) {
        return { ok: false, text: async () => '' };
      }
      if ((url as string).includes('instagram.com/oembed')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Creamy pasta 🍝 Ingredients: 200g pasta, 100ml cream Steps: 1. Cook pasta 2. Add cream',
            author_name: 'chef_elisa'
          })
        };
      }
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://www.instagram.com/reel/DTBOQTNkmD2/');
    expect(result).not.toBeNull();
    expect(result).toContain('chef_elisa');
    expect(result).toContain('Creamy pasta');
  });

  it('returns null when both Jina AI and Instagram oEmbed fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://www.instagram.com/reel/XXXX/');
    expect(result).toBeNull();
  });

  it('falls back to TikTok oEmbed caption when Jina AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('r.jina.ai')) {
        return { ok: false, text: async () => '' };
      }
      if ((url as string).includes('tiktok.com/oembed')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Easy stir fry! Ingredients: chicken, soy sauce Steps: 1. Heat pan 2. Add chicken',
            author_name: 'cooktok'
          })
        };
      }
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://www.tiktok.com/@chef/video/123');
    expect(result).not.toBeNull();
    expect(result).toContain('cooktok');
  });

  it('returns null for non-social URLs when Jina AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://somerecipeblog.com/pasta');
    expect(result).toBeNull();
  });

  it('falls back to YouTube oEmbed title when Jina AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('r.jina.ai')) {
        return { ok: false, text: async () => '' };
      }
      if ((url as string).includes('youtube.com/oembed')) {
        return {
          ok: true,
          json: async () => ({
            title: 'One Pan Creamy Tuscan Chicken Recipe',
            author_name: 'RecipeChannel'
          })
        };
      }
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://www.youtube.com/watch?v=abc123');
    expect(result).not.toBeNull();
    expect(result).toContain('RecipeChannel');
    expect(result).toContain('Tuscan Chicken');
  });

  it('falls back to YouTube oEmbed for youtu.be short links', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('r.jina.ai')) {
        return { ok: false, text: async () => '' };
      }
      if ((url as string).includes('youtube.com/oembed')) {
        return {
          ok: true,
          json: async () => ({ title: 'Quick Pasta Recipe', author_name: 'ChefJohn' })
        };
      }
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://youtu.be/abc123');
    expect(result).not.toBeNull();
    expect(result).toContain('Quick Pasta Recipe');
  });

  it('returns null when both Jina AI and YouTube oEmbed fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch);

    const result = await fetchRawRecipeText('https://www.youtube.com/watch?v=xyz');
    expect(result).toBeNull();
  });
});

describe('fetchOembedCaption', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for non-social hosts', async () => {
    const result = await fetchOembedCaption('https://example.com/recipe');
    expect(result).toBeNull();
  });

  it('reads og:description from TikTok page HTML and prepends author', async () => {
    const html = `<html><head><meta property="og:description" content="Best pasta recipe ever"></head></html>`;
    const mockFetch = vi.fn(async () => ({ ok: true, text: async () => html })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.tiktok.com/@chef_jane/video/12345',
      { fetchImpl: mockFetch }
    );
    expect(result).toBe('Recipe by TikTok creator:\n\nBest pasta recipe ever');
    // Direct page fetch — not oEmbed roundtrip.
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://www.tiktok.com/@chef_jane/video/12345');
    // Browser User-Agent — Instagram/TikTok strip og: tags for bot UAs.
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'User-Agent': expect.stringContaining('Safari'),
    });
  });

  it('strips Instagram metadata prefix and decodes HTML entities + emoji', async () => {
    // og:description on a real Instagram reel arrives wrapped in metadata
    // and double-quoted, with HTML entities + numeric entities for emoji.
    const html = `<html><head><meta property="og:description" content="1,075 likes, 23 comments - alicelovesbreakfast on May 6, 2026: &quot;BANANA BREAD &amp; FRENCH TOAST BAKE &#x1f34c;&#x1f35e; INGREDIENTS&quot;."></head></html>`;
    const mockFetch = vi.fn(async () => ({ ok: true, text: async () => html })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.instagram.com/reel/abc123/',
      { fetchImpl: mockFetch }
    );
    expect(result).toBe('Recipe by Instagram creator:\n\nBANANA BREAD & FRENCH TOAST BAKE 🍌🍞 INGREDIENTS');
  });

  it('falls back to twitter:description when og:description is absent', async () => {
    const html = `<html><head><meta name="twitter:description" content="Spicy Thai noodles"></head></html>`;
    const mockFetch = vi.fn(async () => ({ ok: true, text: async () => html })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.youtube.com/watch?v=abc',
      { fetchImpl: mockFetch }
    );
    expect(result).toBe('Recipe by YouTube creator:\n\nSpicy Thai noodles');
  });

  it('returns null when the page fetch fails', async () => {
    const mockFetch = vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.tiktok.com/@chef_jane/video/12345',
      { fetchImpl: mockFetch }
    );
    expect(result).toBeNull();
  });

  it('returns null when neither og:description nor twitter:description is present', async () => {
    const html = `<html><head><title>Empty</title></head></html>`;
    const mockFetch = vi.fn(async () => ({ ok: true, text: async () => html })) as unknown as typeof fetch;
    const result = await fetchOembedCaption(
      'https://www.instagram.com/reel/abc/',
      { fetchImpl: mockFetch }
    );
    expect(result).toBeNull();
  });
});

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
    expect(result.provenance).toBe('extracted');
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
    expect(result.provenance).toBeNull();
  });
});

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
    expect(result.provenance).toBeNull();
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
    expect(result.provenance).toBe('extracted');

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

  it('calls Gemini with extract-only prompt first and returns result when extract succeeds', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['verbatim 1'], steps: ['verbatim step'], mealTypes: [], durationMinutes: null, notes: '', title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/recipe',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'Ingredients:\n- 1 cup flour\n\nInstructions:\n1. Mix.'.padEnd(600, ' '), fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['verbatim 1']);

    // Only one Gemini call (extract pass won).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const parsedBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const promptText = parsedBody.contents[0].parts[0].text;
    expect(promptText).toContain('Extract ONLY what is explicitly present');
  });

  it('returns empty + null provenance when extract finds no recipe (no inference fallback)', async () => {
    // Inference-mode pass-2 was removed. When the extract-only call returns
    // empty arrays from a long unstructured page, we return empty rather
    // than fabricating ingredients via a permissive prompt.
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: [], steps: [], mealTypes: [], durationMinutes: null, notes: '', title: ''
        }) }] } }]
      })
    })) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/recipe',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'A long food blog post that rambles about family memories without ever laying out an explicit ingredient list or numbered steps.'.padEnd(600, ' '), fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBeNull();

    // Single Gemini call — no inference fallback.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain('Extract ONLY what is explicitly present');
  });

  it('short-circuits without calling Gemini when raw text is an HTTP 429 error page', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    // Pad to > 500 chars so we test the error-page regex gate, not the length gate.
    const errorText = ('Title: www.instagram.com\n\nURL Source: https://www.instagram.com/reel/xyz/\n\nWarning: Target URL returned error 429: Too Many Requests\n\nMarkdown Content:\n## This page isn\u2019t working\n\nHTTP ERROR 429').padEnd(600, ' ');
    const result = await textInference(
      fakeEnv,
      'https://www.instagram.com/reel/xyz/',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => errorText, fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips Gemini when rawText is under 500 chars and not error-page-shaped', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    const result = await textInference(
      fakeEnv,
      'https://example.com/x',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'short body text', fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
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

  it('returns null provenance when extract returns empty (single Gemini call)', async () => {
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
    // Inference-mode pass-2 removed → only one Gemini call.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('runEnrichmentChain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const EMPTY_EXPECTED = {
    title: '', imageUrl: '', mealTypes: [], ingredients: [], steps: [], durationMinutes: null, notes: ''
  };

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
    expect(result.provenance).toBeNull();
    expect(winningStrategy).toBeNull();
  });

  it('promotes a title-only caption-extract result when no strategy yields ingredients', async () => {
    // Caption-extract pulled a dish name out of an unstructured paragraph
    // (no Ingredients / Method headers in the caption). The orchestrator
    // should keep that title with provenance:'title-only' rather than
    // discarding the whole row — the UI uses this signal to render a
    // "Tap to add ingredients manually" affordance.
    const captionStrat = vi.fn(async () => ({ ...EMPTY_EXPECTED, title: 'Banana Bread French Toast Bake' }));
    const videoStrat = vi.fn(async () => EMPTY_EXPECTED);
    const textStrat = vi.fn(async () => EMPTY_EXPECTED);
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://www.instagram.com/reel/abc/',
      'placeholder-title-from-og',
      { captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
    );
    expect(result.title).toBe('Banana Bread French Toast Bake');
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBe('title-only');
    expect(winningStrategy).toBeNull();
  });
});

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

  it('writes a bookkeeping-only UPDATE for title-only — preserves user-supplied meal_types / cuisines / duration_minutes / notes', async () => {
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
        title: 'Banana Bread French Toast Bake', imageUrl: '', mealTypes: [], cuisines: [],
        ingredients: [], steps: [], durationMinutes: null, notes: '',
        provenance: 'title-only' as const,
      },
      winningStrategy: null,
    });
    await enrichAfterSave(env, 'recipe-1', 'https://www.instagram.com/reel/abc/', 'T', { runEnrichmentChain: fakeChain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('title-only');
    // Title-only must update ONLY provenance + updated_at. If we wrote
    // ingredients / steps / meal_types / cuisines / duration_minutes /
    // notes, we'd clobber values the user (or /recipes/parse) set on the
    // initial save.
    expect(update!.sql).not.toMatch(/SET\s+title\s*=/i);
    expect(update!.sql).not.toMatch(/meal_types\s*=/i);
    expect(update!.sql).not.toMatch(/cuisines\s*=/i);
    expect(update!.sql).not.toMatch(/duration_minutes\s*=/i);
    expect(update!.sql).not.toMatch(/ingredients\s*=/i);
    expect(update!.sql).not.toMatch(/steps\s*=/i);
    expect(update!.sql).not.toMatch(/notes\s*=/i);
    expect(update!.sql).toMatch(/SET\s+provenance\s*=\s*\?,\s*updated_at\s*=\s*\?/i);
  });
});

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

describe('handleEnrichRecipe response', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('includes provenance in the enriched payload', async () => {
    const longText = 'Ingredients:\n- 1 cup flour\n\nInstructions:\n1. Mix.'.padEnd(600, ' ');

    // Stub crypto so fake service-account keys don't fail the import/sign path.
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new ArrayBuffer(32));

    const FAKE_SA_B64 = btoa(JSON.stringify({
      client_email: 'svc@test.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
      token_uri: 'https://oauth2.googleapis.com/token',
      project_id: 'test-proj',
    }));

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('r.jina.ai')) {
        return { ok: true, text: async () => longText } as Response;
      }
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'fake' }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            ingredients: ['flour'], steps: ['mix'], mealTypes: [], durationMinutes: null, notes: '', title: ''
          }) }] } }]
        })
      } as Response;
    }) as unknown as typeof fetch);

    const req = new Request('https://worker/recipes/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://somerecipeblog.com/pasta', title: 'Pasta' }),
    });

    const env = { GEMINI_SERVICE_ACCOUNT_B64: FAKE_SA_B64 } as unknown as Env;
    const res = await handleEnrichRecipe(req, env);
    const body = await res.json() as { enriched: { provenance?: string | null } };
    expect(body.enriched.provenance).toBe('extracted');
  });
});
