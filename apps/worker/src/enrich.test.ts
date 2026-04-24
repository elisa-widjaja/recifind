import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption, captionExtract, youtubeVideo, textInference, runEnrichmentChain } from './index';
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

  it('falls back to inference prompt when extract returns empty', async () => {
    // First Gemini call returns empty arrays; second returns inferred content.
    let callIndex = 0;
    const mockFetch = vi.fn(async () => {
      const responseText = callIndex === 0
        ? JSON.stringify({ ingredients: [], steps: [], mealTypes: [], durationMinutes: null, notes: '', title: '' })
        : JSON.stringify({ ingredients: ['inferred'], steps: ['inferred step'], mealTypes: [], durationMinutes: null, notes: '', title: '' });
      callIndex++;
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] })
      };
    }) as unknown as typeof fetch;

    const result = await textInference(
      fakeEnv,
      'https://example.com/recipe',
      'Pasta',
      { ...baseDeps, fetchRawRecipeText: async () => 'A long food blog post that rambles about family memories and cooking traditions without ever laying out an explicit ingredient list or numbered steps.'.padEnd(600, ' '), fetchImpl: mockFetch }
    );
    expect(result.ingredients).toEqual(['inferred']);

    // Two Gemini calls: extract first, then infer.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(firstBody.contents[0].parts[0].text).toContain('Extract ONLY what is explicitly present');

    const secondBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.contents[0].parts[0].text).toContain('culinary expert');
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

  it('skips both passes when rawText is under 500 chars and not error-page-shaped', async () => {
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
    expect(winningStrategy).toBeNull();
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
