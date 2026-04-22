import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRawRecipeText, fetchOembedCaption } from './index';

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
