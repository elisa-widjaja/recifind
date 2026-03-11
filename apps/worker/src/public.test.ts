import { describe, expect, it, vi } from 'vitest';
import { getPublicDiscover, getEditorsPick } from './index';

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
            { id: 'r1', title: 'Beef and Guiness Stew', source_url: '', image_url: '', meal_types: '["Dinner"]', duration_minutes: 90 },
            { id: 'r2', title: 'Honey lime chicken bowl', source_url: '', image_url: '', meal_types: '["Lunch"]', duration_minutes: 25 },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, EDITOR_TITLES);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toContain('Beef and Guiness Stew');
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
