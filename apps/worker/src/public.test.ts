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
  const EDITOR_TITLES = ['Beef and Guiness Stew', 'Honey lime chicken bowl'];

  it('returns recipes matching editor titles', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'r1', title: 'Beef and Guiness Stew', source_url: 'https://example.com',
              image_url: '', meal_types: '["Dinner"]', duration_minutes: 90,
              ingredients: '["beef","guinness"]', steps: '["Brown beef","Add stout"]',
            },
            {
              id: 'r2', title: 'Honey lime chicken bowl', source_url: '',
              image_url: '', meal_types: '["Lunch"]', duration_minutes: 25,
              ingredients: '[]', steps: '[]',
            },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, EDITOR_TITLES);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toContain('Beef and Guiness Stew');
    expect(result[0].ingredients).toEqual(['beef', 'guinness']);
    expect(result[0].steps).toEqual(['Brown beef', 'Add stout']);
    expect(result[0].sourceUrl).toBe('https://example.com');
  });

  it('returns empty array when no matching recipes exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, EDITOR_TITLES);
    expect(result).toHaveLength(0);
  });
});

describe('getAiPicks', () => {
  it('returns cached result from KV without calling Gemini', async () => {
    const cached = JSON.stringify([{
      topic: 'Gut health',
      hashtag: '#GutHealth',
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
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 'r1', title: 'Berry Bake',
          source_url: 'https://example.com/berry',
          image_url: '', meal_types: '[]', duration_minutes: null,
          ingredients: '["berries","yogurt"]',
          steps: '["Mix","Bake"]',
        }),
      })
    } as unknown as D1Database;
    const mockCallGemini = vi.fn().mockResolvedValue(
      '[{"topic":"Gut health","hashtag":"#GutHealth","match":"Berry Bake"}]'
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
  it('returns ingredients, steps, and sourceUrl', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [{
            id: 'r1',
            title: 'Miso Ramen',
            source_url: 'https://www.tiktok.com/@chef/video/123',
            image_url: 'https://img.example.com/ramen.jpg',
            meal_types: '["Dinner"]',
            duration_minutes: 20,
            ingredients: '["noodles","miso paste"]',
            steps: '["Boil noodles","Add miso"]',
          }]
        })
      })
    } as unknown as D1Database;

    const result = await getTrendingRecipes(mockDb);
    expect(result).toHaveLength(1);
    expect(result[0].ingredients).toEqual(['noodles', 'miso paste']);
    expect(result[0].steps).toEqual(['Boil noodles', 'Add miso']);
    expect(result[0].sourceUrl).toBe('https://www.tiktok.com/@chef/video/123');
  });
});
