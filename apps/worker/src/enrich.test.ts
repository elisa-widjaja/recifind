import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption, captionExtract, youtubeVideo, textInference, structuredHtml, runEnrichmentChain, enrichAfterSave, handleEnrichRecipe, isAllowedSourceHost, isFacebookLinkShim, resolveSourceUrl, extractRecipeDetailsFromHtml, stripFacebookEngagementPrefix, geminiExtractFromCaption } from './index';
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

  const longCaptionForCache = 'Recipe by chef:\n\nGreat dish.\n\nIngredients:\n- 1 cup flour\n- 2 eggs\n\nInstructions:\n1. Mix\n2. Bake for 20 min';
  const validGeminiFetch = () => vi.fn(async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        ingredients: ['1 cup flour', '2 eggs'], steps: ['Mix', 'Bake'],
        mealTypes: [], durationMinutes: null, notes: '', title: 'Great dish'
      }) }] } }]
    })
  })) as unknown as typeof fetch;

  it('uses a cached caption and skips the IG fetch (preserves re-enrich/auto-fill re-run)', async () => {
    const cacheGet = vi.fn(async () => longCaptionForCache);
    const cachePut = vi.fn(async () => {});
    const env = { AI_PICKS_CACHE: { get: cacheGet, put: cachePut } } as unknown as Env;
    const fetchOembedCaption = vi.fn(async () => 'SHOULD NOT BE CALLED');
    const deps = { ...baseDeps, fetchOembedCaption, fetchImpl: validGeminiFetch() };

    const result = await captionExtract(env, 'https://www.instagram.com/reel/ABC/', '', deps);

    expect(cacheGet).toHaveBeenCalledWith('caption:https://www.instagram.com/reel/ABC/');
    expect(fetchOembedCaption).not.toHaveBeenCalled();      // IG fetch skipped on cache hit
    expect(cachePut).not.toHaveBeenCalled();                // came from cache, no re-write
    expect(result.ingredients).toEqual(['1 cup flour', '2 eggs']); // Gemini still ran
  });

  it('caches a freshly-fetched usable caption for reuse', async () => {
    const cacheGet = vi.fn(async () => null);
    const cachePut = vi.fn(async () => {});
    const env = { AI_PICKS_CACHE: { get: cacheGet, put: cachePut } } as unknown as Env;
    const fetchOembedCaption = vi.fn(async () => longCaptionForCache);
    const deps = { ...baseDeps, fetchOembedCaption, fetchImpl: validGeminiFetch() };

    await captionExtract(env, 'https://www.instagram.com/reel/XYZ/', '', deps);

    expect(fetchOembedCaption).toHaveBeenCalled();
    expect(cachePut).toHaveBeenCalledWith(
      'caption:https://www.instagram.com/reel/XYZ/',
      longCaptionForCache,
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it('does not cache a null/too-short caption (lets the next attempt retry IG)', async () => {
    const cachePut = vi.fn(async () => {});
    const env = { AI_PICKS_CACHE: { get: vi.fn(async () => null), put: cachePut } } as unknown as Env;
    const deps = { ...baseDeps, fetchOembedCaption: async () => null, fetchImpl: vi.fn() as unknown as typeof fetch };

    const result = await captionExtract(env, 'https://www.instagram.com/reel/NUL/', '', deps);

    expect(cachePut).not.toHaveBeenCalled();
    expect(result.ingredients).toEqual([]);
  });

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

  // When the caption came from the FB og:url slug fallback (a lossy, mangled
  // signal), captionExtract must run the LENIENT extractor so admin re-enrich /
  // web paste recovers partial ingredients — the strict prompt rejects the slug.
  // Signalled by fetchOembedCaption invoking deps.onSlugFallback.
  it('uses the lenient prompt when the caption came from the FB slug fallback', async () => {
    const slugCaption = 'Recipe by Facebook creator:\n\nair fryer pork ribs 1 lb pork ribs riblets15 tbsp oyster sauce ½ tbsp brown sugar';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          ingredients: ['1 lb pork ribs', 'oyster sauce'], steps: [],
          mealTypes: [], durationMinutes: null, notes: '', title: 'Air Fryer Pork Ribs'
        }) }] } }]
      })
    })) as unknown as typeof fetch;
    const deps = {
      ...baseDeps,
      // Mimics the real fetchOembedCaption's FB slug-fallback branch.
      fetchOembedCaption: (async (_url: string, d?: { onSlugFallback?: () => void }) => {
        d?.onSlugFallback?.();
        return slugCaption;
      }) as unknown as typeof import('./index').fetchOembedCaption,
      fetchImpl: mockFetch,
    };
    const result = await captionExtract(fakeEnv, 'https://www.facebook.com/reel/123/', 'Ribs', deps);
    expect(result.ingredients.length).toBeGreaterThan(0);
    const parsedBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const promptText = parsedBody.contents[0].parts[0].text;
    expect(promptText).toContain('valid partial recipe'); // lenient-prompt marker
    expect(promptText).not.toContain('Extract ONLY what is explicitly present');
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
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
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
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
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
      { structuredHtml: empty, captionExtract: empty, youtubeVideo: empty, textInference: empty }
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
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: captionStrat, youtubeVideo: videoStrat, textInference: textStrat }
    );
    expect(result.title).toBe('Banana Bread French Toast Bake');
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBe('title-only');
    expect(winningStrategy).toBeNull();
  });

  it('short-circuits Facebook to title-only and never runs a content strategy', async () => {
    // FB is login-walled from the worker; any content the strategies could
    // scrape comes from a truncated og:description preview (partial/misleading).
    // The chain must skip all strategies and keep only the (device-supplied) title.
    const contentful = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['should-not-appear'], steps: ['nope'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://www.facebook.com/reel/123',
      'Triple Chocolate Banana Bread',
      { structuredHtml: contentful, captionExtract: contentful, youtubeVideo: contentful, textInference: contentful }
    );
    expect(result.title).toBe('Triple Chocolate Banana Bread');
    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBe('title-only');
    expect(winningStrategy).toBeNull();
    expect(contentful).not.toHaveBeenCalled();
  });

  it('short-circuits an fb.watch link with no title to empty (null provenance)', async () => {
    const contentful = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['x'], steps: ['y'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env,
      'https://fb.watch/abc123/',
      '',
      { structuredHtml: contentful, captionExtract: contentful, youtubeVideo: contentful, textInference: contentful }
    );
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBeNull();
    expect(winningStrategy).toBeNull();
    expect(contentful).not.toHaveBeenCalled();
  });

  it('FB with a provided caption runs captionProvided and marks extracted', async () => {
    const captionProvided = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['1 cup flour'], steps: ['mix'], provenance: 'extracted' as const }));
    const contentful = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['should-not-run'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env, 'https://www.facebook.com/reel/123', 'Cake',
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
      {} as Env, 'https://www.facebook.com/reel/123', 'Banana Bread',
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: async () => EMPTY_EXPECTED, youtubeVideo: async () => EMPTY_EXPECTED, textInference: async () => EMPTY_EXPECTED, captionProvided }
    );
    expect(result.title).toBe('Banana Bread');
    expect(result.ingredients).toEqual([]);
    expect(result.provenance).toBe('title-only');
    expect(winningStrategy).toBeNull();
    expect(captionProvided).not.toHaveBeenCalled();
  });

  it('caches the FB caption (>=50 chars) before extraction, even when extraction is empty', async () => {
    const put = vi.fn(async () => {});
    const env = { AI_PICKS_CACHE: { put } } as unknown as Env;
    const captionProvided = vi.fn(async () => EMPTY_EXPECTED); // extraction yields nothing
    const cap = 'Semolina Cake. Ingredients: 1 cup semolina, 4 tbsp milk powder, 1/2 cup sugar powder.';
    await runEnrichmentChain(
      env, 'https://www.facebook.com/reel/123', 'T',
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract: async () => EMPTY_EXPECTED, youtubeVideo: async () => EMPTY_EXPECTED, textInference: async () => EMPTY_EXPECTED, captionProvided },
      cap,
    );
    expect(put).toHaveBeenCalledWith('caption:https://www.facebook.com/reel/123', cap, expect.objectContaining({ expirationTtl: expect.any(Number) }));
  });

  it('Instagram with a provided caption runs captionProvided and skips the fetch strategies', async () => {
    // IG often serves a stripped, caption-less page to the worker's datacenter
    // IPs, so an admin paste (or on-device fetch) is the only way to recover it.
    // The provided caption must win before captionExtract re-fetches nothing.
    const captionProvided = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['2 cups rice'], steps: ['cook'], provenance: 'extracted' as const }));
    const contentful = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['should-not-run'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env, 'https://www.instagram.com/reel/DYM3raDBjY2/', 'Garlic Rice',
      { structuredHtml: contentful, captionExtract: contentful, youtubeVideo: contentful, textInference: contentful, captionProvided },
      'Garlic Rice. Ingredients: 2 cups rice. Steps: cook.'
    );
    expect(result.ingredients).toEqual(['2 cups rice']);
    expect(result.provenance).toBe('extracted');
    expect(winningStrategy).toBe('caption-provided');
    expect(captionProvided).toHaveBeenCalledTimes(1);
    expect(contentful).not.toHaveBeenCalled();
  });

  it('Instagram with a provided caption that extracts nothing falls through to the normal chain', async () => {
    // An empty captionProvided result must not short-circuit IG (unlike FB) —
    // the regular fetch chain still runs as the fallback.
    const captionProvided = vi.fn(async () => EMPTY_EXPECTED);
    const captionExtract = vi.fn(async () => ({ ...EMPTY_EXPECTED, ingredients: ['fetched'], steps: ['mix'] }));
    const { result, winningStrategy } = await runEnrichmentChain(
      {} as Env, 'https://www.instagram.com/reel/abc/', 'Recipe',
      { structuredHtml: async () => EMPTY_EXPECTED, captionExtract, youtubeVideo: async () => EMPTY_EXPECTED, textInference: async () => EMPTY_EXPECTED, captionProvided },
      'a short caption with no recipe in it that gemini cannot extract anything from'
    );
    expect(result.ingredients).toEqual(['fetched']);
    expect(winningStrategy).toBe('caption-extract');
    expect(captionProvided).toHaveBeenCalledTimes(1);
    expect(captionExtract).toHaveBeenCalledTimes(1);
  });
});

describe('geminiExtractFromCaption lenient mode', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const sa = {
    getAccessToken: async () => 'fake-token',
    getServiceAccount: async () => ({
      client_email: 'svc@example.com', private_key: 'fake-key',
      token_uri: 'https://oauth2.googleapis.com/token', project_id: 'proj-123',
    }),
  };
  const env = {} as Env;
  // The exact failing case: a bare checkbox ingredient list, no quantities, no steps.
  const captionIngredientsOnly = '▢ coconut sugar\n▢ browned butter\n▢ dark cocoa powder\n▢ vanilla extract\n▢ eggs';

  // Gemini mock: records the prompt it was sent so we can assert which variant
  // ran, and echoes back an ingredients-only extraction.
  const makeFetch = (sent: { body: string }) => vi.fn(async (_url: unknown, init: any) => {
    sent.body = String(init?.body ?? '');
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        ingredients: ['coconut sugar', 'browned butter', 'dark cocoa powder', 'vanilla extract', 'eggs'],
        steps: [], mealTypes: [], cuisines: [], durationMinutes: null, notes: '', title: '',
      }) }] } }] }),
    };
  }) as unknown as typeof fetch;

  it('lenient: uses the partial-recipe prompt and keeps ingredients with no steps', async () => {
    const sent = { body: '' };
    const result = await geminiExtractFromCaption(env, captionIngredientsOnly, { ...sa, fetchImpl: makeFetch(sent), lenient: true });
    expect(sent.body).toContain('valid partial recipe');
    expect(result.ingredients.length).toBeGreaterThan(0);
    expect(result.steps).toEqual([]);
    expect(result.provenance).toBe('extracted');
  });

  it('strict (default): uses the prompt that rejects partial recipes', async () => {
    const sent = { body: '' };
    await geminiExtractFromCaption(env, captionIngredientsOnly, { ...sa, fetchImpl: makeFetch(sent) });
    expect(sent.body).toContain('Do not extract partial recipes');
    expect(sent.body).not.toContain('valid partial recipe');
  });
});

describe('enrichAfterSave', () => {
  it('binds provenance in the UPDATE when the chain returns a non-empty result', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
          // first() supports updateCollectionMeta's SELECT — return null so
          // it takes the INSERT path with a fresh version=1.
          first: async () => null,
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
    await enrichAfterSave(env, 'user-1', 'recipe-1', 'https://e.com/x', 'T', { runEnrichmentChain: fakeChain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('inferred');
  });

  it('heals a bare FB recipe from the cached caption and replaces a broken title', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
          first: async () => null,
        }),
      }),
    };
    const get = vi.fn(async () => 'Semolina Cake caption with a full recipe and ingredients listed.');
    const env = { DB: dbMock as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x', AI_PICKS_CACHE: { get } } as unknown as Env;
    let seenCaption: string | undefined;
    const fakeChain = async (_e: any, _u: string, _t: string, _s: any, providedCaption?: string) => {
      seenCaption = providedCaption;
      return {
        result: { title: 'Semolina Cake', imageUrl: '', mealTypes: [], ingredients: ['a'], steps: ['b'], durationMinutes: null, notes: '', provenance: 'extracted' as const },
        winningStrategy: 'caption-provided' as const,
      };
    };
    // 'Facebook Reel' is a broken title → replaced with the extracted dish name.
    await enrichAfterSave(env, 'user-1', 'recipe-1', 'https://www.facebook.com/reel/123', 'Facebook Reel', { runEnrichmentChain: fakeChain as any });
    expect(get).toHaveBeenCalled();
    expect(seenCaption).toBe('Semolina Cake caption with a full recipe and ingredients listed.');
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('Semolina Cake');
  });

  it('writes a bookkeeping-only UPDATE with provenance="title-only" when the chain returns fully empty', async () => {
    // Even when the orchestrator returns no title from any strategy
    // (e.g., Instagram stripped login wall + r.jina.ai also failed),
    // we stamp provenance:'title-only' on the row so the UI knows
    // enrichment was attempted and won't surface Auto-fill or the
    // misleading "rate-limited, try again" snackbar.
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
          // first() supports updateCollectionMeta's SELECT — return null so
          // it takes the INSERT path with a fresh version=1.
          first: async () => null,
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
    await enrichAfterSave(env, 'user-1', 'recipe-1', 'https://e.com/x', 'T', { runEnrichmentChain: fakeChain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('title-only');
    // Bookkeeping-only — content fields must NOT be in the SET clause.
    expect(update!.sql).not.toMatch(/ingredients\s*=/i);
    expect(update!.sql).not.toMatch(/meal_types\s*=/i);
    expect(update!.sql).toMatch(/SET\s+provenance\s*=\s*\?,\s*updated_at\s*=\s*\?/i);
  });

  it('writes a bookkeeping-only UPDATE for title-only — preserves user-supplied meal_types / cuisines / duration_minutes / notes', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const dbMock = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
          // first() supports updateCollectionMeta's SELECT — return null so
          // it takes the INSERT path with a fresh version=1.
          first: async () => null,
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
    await enrichAfterSave(env, 'user-1', 'recipe-1', 'https://www.instagram.com/reel/abc/', 'T', { runEnrichmentChain: fakeChain as any });
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
      body: JSON.stringify({ sourceUrl: 'https://www.tiktok.com/@u/video/pasta', title: 'Pasta' }),
    });

    const env = { GEMINI_SERVICE_ACCOUNT_B64: FAKE_SA_B64 } as unknown as Env;
    const res = await handleEnrichRecipe(req, env);
    const body = await res.json() as { enriched: { provenance?: string | null } };
    expect(body.enriched.provenance).toBe('extracted');
  });
});

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
    expect(result.steps).toEqual([]);
  });
});

describe('Facebook allowlist + resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Facebook is allowlisted: the iOS Share Extension fetches FB og data
  // on-device (residential IP), so reels can be saved with a clean title +
  // thumbnail even though the worker itself is login-walled by FB.
  it('allowlists facebook.com / fb.watch', () => {
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

describe('Facebook link-shim rejection', () => {
  it('flags facebook.com/l.php and u-param redirect shims', () => {
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/l.php?u=https://evil.com'))).toBe(true);
    expect(isFacebookLinkShim(new URL('https://l.facebook.com/l.php?u=https://evil.com'))).toBe(true);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/somepath?u=https://evil.com'))).toBe(true);
  });
  it('allows real facebook reel/watch/share urls', () => {
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/reel/123456789'))).toBe(false);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/watch/?v=123'))).toBe(false);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/share/r/abcDEF/'))).toBe(false);
  });
  it('ignores non-facebook hosts even with a u param', () => {
    expect(isFacebookLinkShim(new URL('https://www.instagram.com/reel/ABC/?u=x'))).toBe(false);
  });
});

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

  // FB caps og:description at ~200 chars but serves the FULL recipe (ingredients
  // AND steps) in og:title, wrapped as "<views> · <reactions> | <caption> |
  // <Page> | Facebook". The caption must come from the cleaned og:title when it
  // is longer than og:description. (Verified live on /reel/1357006853131283:
  // og:title=1158 chars full recipe, og:description=200-char prefix.)
  it('prefers the full recipe in og:title over the truncated og:description', async () => {
    const fullTitle = '5.1M views &#xb7; 105K reactions | AIR FRYER PORK RIBS 1 lb pork ribs 1.5 TBSP oyster sauce 1 tsp bouillon 0.5 TBSP minced shallots 2 cloves garlic 1. Cut the ribs between the bones 2. Marinate with oyster sauce and brown sugar 3. Air fry at 380F for 18 minutes flipping halfway | Alissa Nguyen | Facebook';
    const truncDesc = 'AIR FRYER PORK RIBS 1 lb pork ribs 1.5 TBSP oyster sauce 1 tsp bouillon...';
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `<html><head>
        <meta property="og:title" content="${fullTitle}" />
        <meta property="og:description" content="${truncDesc}" />
      </head></html>`,
    })) as unknown as typeof fetch;

    const caption = await fetchOembedCaption('https://www.facebook.com/reel/1357006853131283/', { fetchImpl });
    expect(caption).not.toBeNull();
    expect(caption).toContain('shallots');            // beyond the og:description cut
    expect(caption).toContain('Marinate');            // steps recovered
    expect(caption).not.toContain('5.1M views');      // engagement prefix stripped
    expect(caption).not.toContain('Alissa Nguyen');   // page chrome stripped
    expect(caption).not.toMatch(/Facebook\s*$/);      // trailing "| Facebook" stripped
  });

  // Group/permalink posts: og:title is just "Group | Dish | Facebook" (cleans to
  // the short group name) — og:description must still win there.
  it('keeps the og:description when the cleaned og:title is shorter', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `<html><head>
        <meta property="og:title" content="Anti-inflammatory Recipes | Baked Squash with Feta | Facebook" />
        <meta property="og:description" content="Baked Squash with Feta INGREDIENTS Squash: 1 medium squash 1 tsp olive oil salt pepper Filling: feta spinach bacon..." />
      </head></html>`,
    })) as unknown as typeof fetch;

    const caption = await fetchOembedCaption('https://www.facebook.com/groups/514/permalink/1048/', { fetchImpl });
    expect(caption).toContain('INGREDIENTS');
    expect(caption).not.toContain('Anti-inflammatory Recipes');
  });

  // A generic Watch-hub og:title must never become the caption.
  it('ignores a generic hub og:title', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `<html><head>
        <meta property="og:title" content="Discover Popular Videos | Facebook" />
        <meta property="og:description" content="Video is the place to enjoy videos and shows together. Watch the latest reels and catch up on your favorite creators and shows." />
      </head></html>`,
    })) as unknown as typeof fetch;

    const caption = await fetchOembedCaption('https://www.facebook.com/watch/?v=123456', { fetchImpl });
    expect(caption).toBeNull();
  });

  // FB gets the iPhone Safari UA (desktop UAs draw the walled/stripped variant
  // far more often); IG keeps the Mac Safari UA that works for it.
  it('sends an iPhone UA to facebook and keeps the Mac UA for instagram', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)?.['User-Agent'] ?? '');
      return {
        ok: true,
        text: async () => '<html><head><meta property="og:description" content="Lemon Pasta. Ingredients: pasta, lemon, butter, parmesan cheese." /></head></html>',
      };
    }) as unknown as typeof fetch;

    await fetchOembedCaption('https://www.facebook.com/reel/123', { fetchImpl });
    await fetchOembedCaption('https://www.instagram.com/reel/abc/', { fetchImpl });
    expect(seen[0]).toContain('iPhone');
    expect(seen[1]).toContain('Macintosh');
    expect(seen[1]).not.toContain('iPhone');
  });

  // The /watch/?v= and /<page>/videos/<slug>/<id>/ forms serve a stripped stub
  // far more often than /reel/<id>/ — normalize before fetching.
  it('normalizes watch?v= and /videos/ URLs to the /reel/ form before fetching', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return {
        ok: true,
        text: async () => '<html><head><meta property="og:description" content="Garlic Butter Shrimp. Ingredients: 1 lb shrimp, 3 tbsp butter, parsley." /></head></html>',
      };
    }) as unknown as typeof fetch;

    await fetchOembedCaption('https://www.facebook.com/watch/?v=1357006853131283', { fetchImpl });
    await fetchOembedCaption('https://www.facebook.com/100086743861165/videos/air-fryer-pork-ribs/1357006853131283/', { fetchImpl });
    expect(urls[0]).toBe('https://www.facebook.com/reel/1357006853131283/');
    expect(urls[1]).toBe('https://www.facebook.com/reel/1357006853131283/');
  });

  // fb.watch can't be normalized without a fetch, but when the first attempt
  // returns the stripped stub (no caption, og:url carrying the video id), the
  // remaining retries must switch to the /reel/<id>/ form and win.
  it('upgrades to the /reel/ form mid-retry when the stub og:url reveals the video id', async () => {
    const urls: string[] = [];
    const stub = `<html><head>
      <meta property="og:url" content="https://www.facebook.com/100086743861165/videos/air-fryer-pork-ribs-1-lb-pork-ribs/1357006853131283/" />
      <meta property="og:image" content="https://scontent.fbcdn.net/v/ribs.jpg" />
    </head></html>`;
    const full = `<html><head>
      <meta property="og:title" content="AIR FRYER PORK RIBS 1 lb pork ribs 1.5 TBSP oyster sauce 2 minced cloves garlic 1. Cut the ribs 2. Marinate 3. Air fry at 380F | Alissa Nguyen | Facebook" />
    </head></html>`;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return { ok: true, text: async () => (String(url).includes('/reel/') ? full : stub) };
    }) as unknown as typeof fetch;

    let slugFallbackFired = false;
    const caption = await fetchOembedCaption('https://fb.watch/I7Vf_a_iv_/', {
      fetchImpl,
      onSlugFallback: () => { slugFallbackFired = true; },
    });
    expect(urls[0]).toBe('https://fb.watch/I7Vf_a_iv_/');
    expect(urls[1]).toBe('https://www.facebook.com/reel/1357006853131283/');
    expect(caption).toContain('Marinate');       // full recipe, not the slug
    expect(slugFallbackFired).toBe(false);       // slug not needed
  });

  // When every retry serves the stub, the slug fallback must still fire (the
  // lenient-extraction path) — the /reel/ upgrade must not break it.
  it('still falls back to the og:url slug when every attempt serves the stub', async () => {
    const stub = `<html><head>
      <meta property="og:url" content="https://www.facebook.com/100086743861165/videos/air-fryer-pork-ribs-1-lb-pork-ribs-riblets15-tbsp-oyster-sauce/1357006853131283/" />
    </head></html>`;
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => stub })) as unknown as typeof fetch;

    let slugFallbackFired = false;
    const caption = await fetchOembedCaption('https://fb.watch/I7Vf_a_iv_/', {
      fetchImpl,
      onSlugFallback: () => { slugFallbackFired = true; },
    });
    expect(caption).not.toBeNull();
    expect(caption!.toLowerCase()).toContain('pork ribs');
    expect(slugFallbackFired).toBe(true);
  });
});

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
  it('strips the engagement-stat prefix before extracting the title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Facebook" />
      <meta property="og:description" content="562K views · 5K reactions · Crispy garlic potatoes 🥔" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
    </head></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/reel/123');
    expect(result).not.toBeNull();
    expect(result!.title.toLowerCase()).toContain('crispy garlic potatoes');
    expect(result!.title.toLowerCase()).not.toContain('views');
    expect(result!.title.toLowerCase()).not.toContain('reactions');
  });
  it('does not set a stats-only og:description as the title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Facebook" />
      <meta property="og:description" content="562K views · 5K reactions ·" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
    </head></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/reel/123');
    // og:title was the generic "Facebook" and the description stripped to empty,
    // so the title must NOT contain engagement stats.
    if (result && result.title) {
      expect(result.title.toLowerCase()).not.toContain('views');
      expect(result.title.toLowerCase()).not.toContain('reactions');
    }
  });

  it('strips the engagement prefix when FB puts the stats in og:title itself', () => {
    const html = `<html><head>
      <meta property="og:title" content="649K views · 6.1K reactions | Triple Chocolate Banana Bread" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
    </head></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/reel/123');
    expect(result).not.toBeNull();
    expect(result!.title.toLowerCase()).toContain('triple chocolate banana bread');
    expect(result!.title.toLowerCase()).not.toContain('views');
    expect(result!.title.toLowerCase()).not.toContain('reactions');
  });
});

describe('stripFacebookEngagementPrefix', () => {
  it('strips a leading run of engagement-stat segments', () => {
    expect(stripFacebookEngagementPrefix('562K views · 5K reactions · Pasta Carbonara 🍝'))
      .toBe('Pasta Carbonara 🍝');
  });
  it('strips comma-separated stats, last segment with no trailing separator', () => {
    expect(stripFacebookEngagementPrefix('1.2M views, 45K likes, 320 comments, 89 shares Garlic Shrimp'))
      .toBe('Garlic Shrimp');
  });
  it('leaves a caption with no engagement prefix unchanged', () => {
    expect(stripFacebookEngagementPrefix('Crispy garlic potatoes 🥔 the best side dish ever'))
      .toBe('Crispy garlic potatoes 🥔 the best side dish ever');
  });
  it('trims surrounding whitespace', () => {
    expect(stripFacebookEngagementPrefix('  3 reactions   Lemon Cake  ')).toBe('Lemon Cake');
  });
  it('returns empty string when the description is only engagement stats', () => {
    expect(stripFacebookEngagementPrefix('562K views · 5K reactions ·')).toBe('');
  });
});

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
