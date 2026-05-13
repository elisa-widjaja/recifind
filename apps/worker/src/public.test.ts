import { describe, expect, it, vi } from 'vitest';
import { getPublicDiscover, getEditorsPick, getAiPicks, getTrendingRecipes } from './index';

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
      image_url: '', meal_types: '[]', duration_minutes: null,
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
