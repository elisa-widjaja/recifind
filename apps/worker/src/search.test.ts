import { describe, expect, it, vi } from 'vitest';
import { escapeLikeTerm, searchPublicRecipes, normalizeSourceUrlForDedup, dedupeSearchResults } from './index';

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
    // Distinct source URLs so the cap (not dedup) is what trims to 30.
    const rows = Array.from({ length: 45 }, (_, i) =>
      okRow(`r${i}`, { source_url: `https://example.com/${i}` }));
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

  it('collapses the same source video saved by different users to one card', async () => {
    const src = 'https://www.instagram.com/reel/DJlzaYiIsII/';
    const { db } = mockDbReturning([
      okRow('userA', { user_id: 'a', source_url: src }),
      okRow('userB', { user_id: 'b', source_url: src }),
      okRow('userC', { user_id: 'c', source_url: src }),
    ]);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out).toHaveLength(1);
  });

  it('collapses across an ?igsh tracking param', async () => {
    const { db } = mockDbReturning([
      okRow('withParam', { source_url: 'https://www.instagram.com/reel/DXfCVrKD1Iq/?igsh=abc123' }),
      okRow('noParam', { source_url: 'https://www.instagram.com/reel/DXfCVrKD1Iq/' }),
    ]);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out).toHaveLength(1);
  });

  it('keeps genuinely different sources with the same title', async () => {
    const { db } = mockDbReturning([
      okRow('ig', { title: 'Japanese milk bread', source_url: 'https://www.instagram.com/reel/DUoFyNXjV6C/' }),
      okRow('tt', { title: 'Japanese milk bread', source_url: 'https://www.tiktok.com/t/ZP8xa1oNV/' }),
    ]);
    const out = await searchPublicRecipes(db, 'bread');
    expect(out.map(r => r.id).sort()).toEqual(['ig', 'tt']);
  });

  it('picks the cleanest representative (content + clean title) for a group', async () => {
    const src = 'https://www.instagram.com/reel/DRfMJfGjN-y/';
    const { db } = mockDbReturning([
      // First in rank order but generic title + no content.
      okRow('generic', { title: 'Bread', source_url: src, ingredients: '[]', steps: '[]' }),
      // Later, but a clean title with real content — should win.
      okRow('rich', { title: 'Japanese Milk Bread', source_url: src,
        ingredients: '["flour","milk"]', steps: '["mix","bake"]' }),
    ]);
    const out = await searchPublicRecipes(db, 'bread');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('rich');
    expect(out[0].title).toBe('Japanese Milk Bread');
  });

  it('dedups before the cap, so duplicates do not eat result slots', async () => {
    // 10 copies of one source, then 50 distinct sources. Without dedup-before-cap
    // the 10 copies would consume 10 of the 30 slots; with it we get 30 distinct.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => okRow(`dup${i}`, { source_url: 'https://example.com/same' })),
      ...Array.from({ length: 50 }, (_, i) => okRow(`u${i}`, { source_url: `https://example.com/${i}` })),
    ];
    const { db } = mockDbReturning(rows);
    const out = await searchPublicRecipes(db, 'recipe');
    expect(out).toHaveLength(30);
    const fromSameSource = out.filter(r => r.sourceUrl === 'https://example.com/same');
    expect(fromSameSource).toHaveLength(1);
  });
});

describe('normalizeSourceUrlForDedup', () => {
  it('strips scheme, www, trailing slash, and an igsh tracking param', () => {
    expect(normalizeSourceUrlForDedup('https://www.instagram.com/reel/ABC/?igsh=xyz'))
      .toBe('instagram.com/reel/ABC');
  });

  it('keeps content-bearing query params like youtube v=', () => {
    expect(normalizeSourceUrlForDedup('https://www.youtube.com/watch?v=AAA'))
      .toBe('youtube.com/watch?v=AAA');
    // Distinct videos must not collapse.
    expect(normalizeSourceUrlForDedup('https://www.youtube.com/watch?v=AAA'))
      .not.toBe(normalizeSourceUrlForDedup('https://www.youtube.com/watch?v=BBB'));
  });

  it('keeps facebook fbid but strips utm_*', () => {
    expect(normalizeSourceUrlForDedup('https://www.facebook.com/photo.php?fbid=1&utm_source=ig'))
      .toBe('facebook.com/photo.php?fbid=1');
  });

  it('drops the fragment and preserves path case', () => {
    expect(normalizeSourceUrlForDedup('https://tiktok.com/t/ZP8xa1oNV/#section'))
      .toBe('tiktok.com/t/ZP8xa1oNV');
  });

  it('returns empty string for an empty url', () => {
    expect(normalizeSourceUrlForDedup('')).toBe('');
    expect(normalizeSourceUrlForDedup('   ')).toBe('');
  });
});

describe('dedupeSearchResults', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'x', userId: 'u', title: 'A Recipe', sourceUrl: 'https://example.com/a',
    imageUrl: 'https://img/x.jpg', mealTypes: [], customTags: [],
    durationMinutes: 20, ingredients: ['a'], steps: ['b'], ...over,
  });

  it('never merges recipes that have no source URL', () => {
    const out = dedupeSearchResults([
      rec({ id: '1', sourceUrl: '' }),
      rec({ id: '2', sourceUrl: '' }),
    ]);
    expect(out.map(r => r.id)).toEqual(['1', '2']);
  });

  it('keeps distinct youtube videos apart', () => {
    const out = dedupeSearchResults([
      rec({ id: 'a', sourceUrl: 'https://youtube.com/watch?v=AAA' }),
      rec({ id: 'b', sourceUrl: 'https://youtube.com/watch?v=BBB' }),
    ]);
    expect(out.map(r => r.id).sort()).toEqual(['a', 'b']);
  });
});
