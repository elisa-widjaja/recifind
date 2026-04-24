import { describe, expect, it, vi } from 'vitest';
import { handleReEnrichRecipe } from './index';
import type { Env } from './index';

function makeRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'recipe-1',
    user_id: 'user-abc',
    title: 'Pasta',
    source_url: 'https://somerecipeblog.com/pasta',
    image_url: 'https://img.example/a.jpg',
    image_path: null,
    meal_types: JSON.stringify([]),
    ingredients: JSON.stringify([]),
    steps: JSON.stringify([]),
    duration_minutes: null,
    notes: '',
    preview_image: null,
    shared_with_friends: 1,
    provenance: null,
    created_at: '2026-04-24T00:00:00.000Z',
    updated_at: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

function makeDb(row: Record<string, any> | null) {
  const runCalls: Array<{ sql: string; binds: any[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: any[]) => ({
        first: async () => (sql.startsWith('SELECT') ? row : null),
        run: async () => { runCalls.push({ sql, binds: [...binds] }); return { success: true }; },
      }),
    }),
  };
  return { db, runCalls };
}

const baseFakeChain = (result: any, winning: any = 'caption-extract') => async () => ({ result, winningStrategy: winning });
const EMPTY = {
  title: '', imageUrl: '', mealTypes: [], ingredients: [], steps: [],
  durationMinutes: null, notes: '', provenance: null,
};

describe('handleReEnrichRecipe', () => {
  const user = { userId: 'user-abc', email: 'a@b.c' } as any;

  it('404 when recipe not found', async () => {
    const { db } = makeDb(null);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    await expect(handleReEnrichRecipe(env, user, 'missing'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('404 when recipe belongs to another user (loadRecipe filters by user_id)', async () => {
    const { db } = makeDb(null); // loadRecipe SELECT with wrong user_id returns nothing
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    await expect(handleReEnrichRecipe(env, user, 'recipe-1'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('400 when the recipe has no source_url', async () => {
    const { db } = makeDb(makeRow({ source_url: '' }));
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    await expect(handleReEnrichRecipe(env, user, 'recipe-1'))
      .rejects.toMatchObject({ status: 400 });
  });

  it('updates the row when the chain returns extracted content', async () => {
    const { db, runCalls } = makeDb(makeRow());
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({
      ...EMPTY, ingredients: ['flour'], steps: ['mix'], provenance: 'extracted',
    });
    const res = await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const body = await res.json() as { recipe: { provenance: string; ingredients: string[] } };
    expect(body.recipe.provenance).toBe('extracted');
    expect(body.recipe.ingredients).toEqual(['flour']);
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('extracted');
  });

  it('preserve-on-empty: does NOT update the row when chain returns empty', async () => {
    const existing = makeRow({
      ingredients: JSON.stringify(['old-i']),
      steps: JSON.stringify(['old-s']),
      provenance: 'inferred',
    });
    const { db, runCalls } = makeDb(existing);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({ ...EMPTY }, null);
    const res = await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const body = await res.json() as { recipe: { ingredients: string[]; provenance: string | null } };
    expect(body.recipe.ingredients).toEqual(['old-i']);
    expect(body.recipe.provenance).toBe('inferred');
    expect(runCalls.find(c => c.sql.includes('UPDATE recipes'))).toBeUndefined();
  });

  it('does not touch image_url on a successful update', async () => {
    const existing = makeRow({ image_url: 'https://img.example/a.jpg' });
    const { db, runCalls } = makeDb(existing);
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    const chain = baseFakeChain({
      ...EMPTY, ingredients: ['x'], steps: ['y'], imageUrl: 'https://gemini-fake.jpg', provenance: 'extracted',
    });
    await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any });
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.sql).not.toMatch(/image_url/i);
    expect(update!.binds).not.toContain('https://gemini-fake.jpg');
  });
});
