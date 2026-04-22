import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption, captionExtract } from './index';
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
