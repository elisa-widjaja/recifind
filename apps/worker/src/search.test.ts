import { describe, expect, it, vi } from 'vitest';
import { escapeLikeTerm, searchPublicRecipes } from './index';

describe('escapeLikeTerm', () => {
  it('escapes percent, underscore, and backslash', () => {
    expect(escapeLikeTerm('50%')).toBe('50\\%');
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    expect(escapeLikeTerm('c\\d')).toBe('c\\\\d');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLikeTerm('chicken')).toBe('chicken');
  });

  it('escapes backslash before wildcards so escaping is not double-applied', () => {
    // input `\%` -> backslash becomes `\\`, percent becomes `\%`
    expect(escapeLikeTerm('\\%')).toBe('\\\\\\%');
  });
});

function mockDbReturning(results: Array<Record<string, unknown>>) {
  const all = vi.fn().mockResolvedValue({ results });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, prepare, bind, all };
}

describe('searchPublicRecipes', () => {
  const okRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, user_id: 'u1', title: `Recipe ${id}`,
    source_url: 'https://example.com', image_url: 'https://img/x.jpg',
    meal_types: '["Dinner"]', custom_tags: '[]', duration_minutes: 20,
    ingredients: '["chicken"]', steps: '["cook"]', ...over,
  });

  it('returns [] without hitting the DB for queries under 2 chars', async () => {
    const { db, prepare } = mockDbReturning([okRow('r1')]);
    expect(await searchPublicRecipes(db, 'a')).toEqual([]);
    expect(await searchPublicRecipes(db, '   ')).toEqual([]);
    expect(await searchPublicRecipes(db, '')).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('maps matching rows to the DiscoverRecipe shape', async () => {
    const { db } = mockDbReturning([okRow('r1', { title: 'Garlic Chicken' })]);
    const out = await searchPublicRecipes(db, 'chicken');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'r1', title: 'Garlic Chicken', imageUrl: 'https://img/x.jpg' });
    expect(out[0].mealTypes).toEqual(['Dinner']);
  });

  it('filters out broken rows (no image)', async () => {
    const { db } = mockDbReturning([okRow('good'), okRow('noimg', { image_url: '' })]);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out.map(r => r.id)).toEqual(['good']);
  });

  it('caps results at 30, preserving DB order', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => okRow(`r${i}`));
    const { db } = mockDbReturning(rows);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out).toHaveLength(30);
    expect(out[0].id).toBe('r0');
    expect(out[29].id).toBe('r29');
  });

  it('skips a row with malformed JSON instead of throwing', async () => {
    const { db } = mockDbReturning([
      okRow('good'),
      okRow('bad', { meal_types: 'not-json' }),
    ]);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out.map(r => r.id)).toEqual(['good']);
  });

  it('binds the escaped wrapped term for every LIKE slot', async () => {
    const { db, bind } = mockDbReturning([]);
    await searchPublicRecipes(db, '50%');
    // 4 WHERE columns + 1 ORDER BY CASE = 5 binds of the same escaped term
    expect(bind).toHaveBeenCalledWith('%50\\%%', '%50\\%%', '%50\\%%', '%50\\%%', '%50\\%%');
  });
});
