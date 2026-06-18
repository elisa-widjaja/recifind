import { describe, expect, it, vi } from 'vitest';
import { getPublicDiscover, getEditorsPick, getAiPicks, getTrendingRecipes, durablePreviewUrl } from './index';

const SUPA = 'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/x.jpg';

describe('getPublicDiscover', () => {
  it('returns recipes with social source URLs', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'r1', title: 'Miso Ramen',
              source_url: 'https://www.tiktok.com/@chef/video/123',
              image_url: 'https://img.example.com/ramen.jpg',
              meal_types: '["Dinner"]', duration_minutes: 20
            }
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getPublicDiscover(mockDb);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Miso Ramen');
    expect(result[0].sourceUrl).toBe('https://www.tiktok.com/@chef/video/123');
  });

  it('returns empty array when no social recipes exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] })
      })
    } as unknown as D1Database;

    const result = await getPublicDiscover(mockDb);
    expect(result).toHaveLength(0);
  });

  it('filters out broken cards: no image, no title, or generic FB title', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'ok', title: '🌮 Crispy Verde Shrimp Tacos', source_url: 'https://www.facebook.com/reel/1', image_url: 'https://img/x.jpg' },
            { id: 'noimg', title: 'Real Recipe', source_url: 'https://www.facebook.com/reel/2', image_url: '' },
            { id: 'notitle', title: '', source_url: 'https://www.facebook.com/reel/3', image_url: 'https://img/y.jpg' },
            { id: 'fbreel', title: 'Facebook Reel', source_url: 'https://www.facebook.com/reel/4', image_url: 'https://img/z.jpg' },
            { id: 'redir', title: 'Redirecting...', source_url: 'https://www.facebook.com/photo.php?fbid=5', image_url: 'https://img/w.jpg' },
            { id: 'fbwatch', title: 'fb.watch', source_url: 'https://www.facebook.com/reel/6', image_url: 'https://img/v.jpg' },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getPublicDiscover(mockDb);
    expect(result.map(r => r.id)).toEqual(['ok']);
  });
});

describe('getEditorsPick', () => {
  const CURATOR_ID = 'curator-user-id';

  it('returns curator\'s favorited public recipes', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'r1', user_id: CURATOR_ID, title: 'Beef and Guiness Stew', source_url: 'https://example.com',
              image_url: 'https://example.com/stew.jpg', meal_types: '["Dinner"]', duration_minutes: 90,
              ingredients: '["beef","guinness"]', steps: '["Brown beef","Add stout"]',
            },
            {
              id: 'r2', user_id: CURATOR_ID, title: 'Honey lime chicken bowl', source_url: '',
              image_url: 'https://example.com/bowl.jpg', meal_types: '["Lunch"]', duration_minutes: 25,
              ingredients: '["chicken","lime"]', steps: '["Marinate","Bowl it"]',
            },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, CURATOR_ID);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toContain('Beef and Guiness Stew');
    expect(result[0].userId).toBe(CURATOR_ID);
    // Order is week-shuffled, so locate by id instead of by index
    const stew = result.find(r => r.id === 'r1')!;
    expect(stew.ingredients).toEqual(['beef', 'guinness']);
    expect(stew.steps).toEqual(['Brown beef', 'Add stout']);
    expect(stew.sourceUrl).toBe('https://example.com');
  });

  it('filters out recipes with missing thumbnail, empty content, or caption-style titles', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            // Clean — keep
            {
              id: 'clean', user_id: CURATOR_ID, title: 'Honey lime chicken bowl', source_url: '',
              image_url: 'https://example.com/bowl.jpg', meal_types: '[]', duration_minutes: 25,
              ingredients: '["chicken"]', steps: '["Cook"]',
            },
            // No image — drop
            {
              id: 'noimg', user_id: CURATOR_ID, title: 'No image recipe', source_url: '',
              image_url: '', meal_types: '[]', duration_minutes: null,
              ingredients: '["a"]', steps: '["b"]',
            },
            // Empty ingredients — drop
            {
              id: 'noing', user_id: CURATOR_ID, title: 'Empty ingredients', source_url: '',
              image_url: 'https://example.com/x.jpg', meal_types: '[]', duration_minutes: null,
              ingredients: '[]', steps: '["b"]',
            },
            // Caption-style title (#hashtag) — drop
            {
              id: 'hash', user_id: CURATOR_ID, title: '#easyrecipe weeknight pasta', source_url: '',
              image_url: 'https://example.com/x.jpg', meal_types: '[]', duration_minutes: null,
              ingredients: '["a"]', steps: '["b"]',
            },
            // Long caption-style title — drop
            {
              id: 'long', user_id: CURATOR_ID, title: 'IT\'S GOT TO BE QUICK and this is a very long caption that goes on and on past 60 chars',
              source_url: '', image_url: 'https://example.com/x.jpg', meal_types: '[]', duration_minutes: null,
              ingredients: '["a"]', steps: '["b"]',
            },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, CURATOR_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('clean');
  });

  it('returns empty array when curator has no favorited public recipes', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, CURATOR_ID);
    expect(result).toHaveLength(0);
  });
});

describe('getAiPicks', () => {
  it('returns cached result from KV without calling Gemini', async () => {
    const cached = JSON.stringify([{
      topic: 'Gut health',
      hashtag: '#GutHealth',
      reason: 'Great for gut health.',
      recipe: {
        id: 'r1', title: 'Berry Bake', imageUrl: '',
        mealTypes: [], durationMinutes: null,
        sourceUrl: 'https://example.com/berry',
        ingredients: ['berries'], steps: ['Mix'],
      }
    }]);
    const mockKV = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
    } as unknown as KVNamespace;
    const mockDb = { prepare: vi.fn() } as unknown as D1Database;
    const mockCallGemini = vi.fn();

    const result = await getAiPicks(mockDb, mockKV, mockCallGemini, {}, {});
    expect(mockCallGemini).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe('Gut health');
    expect(result[0].recipe.sourceUrl).toBe('https://example.com/berry');
    expect(result[0].recipe.ingredients).toEqual(['berries']);
  });

  it('calls Gemini and writes to KV when cache is empty', async () => {
    const candidate = {
      id: 'r1', title: 'Berry Bake',
      source_url: 'https://example.com/berry',
      image_url: SUPA, preview_image: '', meal_types: '[]', duration_minutes: null,
      ingredients: '["berries","yogurt"]',
      steps: '["Mix","Bake"]',
    };
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [candidate] }),
      })
    } as unknown as D1Database;
    const mockCallGemini = vi.fn().mockResolvedValue(
      '[{"topic":"Gut health","hashtag":"#GutHealth","reason":"Berries support gut health.","match":"Berry Bake"}]'
    );

    const result = await getAiPicks(mockDb, mockKV, mockCallGemini, {}, {});
    expect(mockCallGemini).toHaveBeenCalledOnce();
    expect(mockKV.put).toHaveBeenCalledOnce();
    expect(result[0].topic).toBe('Gut health');
    expect(result[0].recipe.sourceUrl).toBe('https://example.com/berry');
    expect(result[0].recipe.ingredients).toEqual(['berries', 'yogurt']);
    expect(result[0].recipe.steps).toEqual(['Mix', 'Bake']);
    expect(result[0].recipe.imageUrl).toBe(SUPA);
  });

  it('uses the Supabase preview when image_url is external, and skips external-only recipes', async () => {
    const PREVIEW_SUPA = 'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/y.jpg';
    const withPreview = {
      id: 'r2', title: 'Tofu Waffle', source_url: 'https://example.com/tofu',
      image_url: 'https://scontent.cdninstagram.com/x.jpg',
      preview_image: JSON.stringify({ publicUrl: PREVIEW_SUPA }),
      meal_types: '[]', duration_minutes: null, ingredients: '["tofu"]', steps: '["Cook"]',
    };
    const externalOnly = {
      id: 'r3', title: 'IG Only', source_url: 'https://example.com/ig',
      image_url: 'https://scontent.cdninstagram.com/z.jpg', preview_image: '',
      meal_types: '[]', duration_minutes: null, ingredients: '["x"]', steps: '["y"]',
    };
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [withPreview, externalOnly] }),
      })
    } as unknown as D1Database;
    // Gemini "picks" both; only the durable-image candidate survives filtering.
    const mockCallGemini = vi.fn().mockResolvedValue(
      '[{"topic":"T","hashtag":"#T","reason":"r","match":"Tofu Waffle"},{"topic":"T2","hashtag":"#T2","reason":"r2","match":"IG Only"}]'
    );

    const result = await getAiPicks(mockDb, mockKV, mockCallGemini, {}, {});
    expect(result.map(p => p.recipe.title)).toEqual(['Tofu Waffle']);
    expect(result[0].recipe.imageUrl).toBe(PREVIEW_SUPA);
  });
});

describe('durablePreviewUrl', () => {
  it('returns a Supabase image_url as-is', () => {
    expect(durablePreviewUrl({ image_url: SUPA })).toBe(SUPA);
  });
  it('returns null for an external image_url with no preview', () => {
    expect(durablePreviewUrl({ image_url: 'https://scontent.cdninstagram.com/x.jpg' })).toBeNull();
  });
  it('falls back to the Supabase publicUrl inside preview_image', () => {
    expect(durablePreviewUrl({ image_url: 'https://cdninstagram.com/x.jpg', preview_image: JSON.stringify({ publicUrl: SUPA }) })).toBe(SUPA);
  });
  it('returns null for empty or malformed input', () => {
    expect(durablePreviewUrl({ image_url: '' })).toBeNull();
    expect(durablePreviewUrl({ image_url: '', preview_image: 'not json' })).toBeNull();
    expect(durablePreviewUrl({})).toBeNull();
  });
});

describe('getTrendingRecipes', () => {
  // Trending excludes the week's Editor's Picks set (top 7), so the mock
  // needs at least 8 clean rows: 7 will go to Editor's Picks, the rest
  // (capped at 5) populate Trending.
  function mockRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `r${i + 1}`,
      user_id: 'curator',
      title: `Recipe ${i + 1}`,
      source_url: i === 0 ? 'https://www.tiktok.com/@chef/video/123' : '',
      image_url: 'https://img.example.com/x.jpg',
      meal_types: '["Dinner"]',
      duration_minutes: 20,
      ingredients: '["a","b"]',
      steps: '["s1","s2"]',
    }));
  }

  it('returns ingredients, steps, and sourceUrl shape', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: mockRows(10) })
      })
    } as unknown as D1Database;

    const result = await getTrendingRecipes(mockDb);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result[0].ingredients).toEqual(['a', 'b']);
    expect(result[0].steps).toEqual(['s1', 's2']);
  });

  it('never overlaps with Editor\'s Picks in the same week', async () => {
    const rows = mockRows(15);
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: rows })
      })
    } as unknown as D1Database;

    const editors = await getEditorsPick(mockDb, 'curator');
    const trending = await getTrendingRecipes(mockDb, 'curator');
    const editorsIds = new Set(editors.map(r => r.id));
    for (const t of trending) expect(editorsIds.has(t.id)).toBe(false);
  });
});
