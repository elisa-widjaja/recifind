import { describe, expect, it, vi } from 'vitest';
import { handleReEnrichRecipe, handleAdminReEnrichRecipe } from './index';
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

  it('503 when GEMINI_SERVICE_ACCOUNT_B64 is not configured', async () => {
    const { db } = makeDb(makeRow());
    const env = { DB: db as unknown as D1Database } as Env; // no GEMINI key
    await expect(handleReEnrichRecipe(env, user, 'recipe-1'))
      .rejects.toMatchObject({ status: 503 });
  });

  it('threads a provided caption + captionProvided strategy into the chain (FB on-device recovery)', async () => {
    // FB reels are login-walled from the worker; the only way content reaches
    // re-enrich is an admin/caller-supplied caption. The chain must receive it
    // as providedCaption AND get a captionProvided strategy wired.
    const { db } = makeDb(makeRow({ source_url: 'https://www.facebook.com/reel/777779878458348' }));
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x' } as Env;
    let seenStrategies: any;
    let seenCaption: string | undefined;
    const chain = (async (_e: any, _u: string, _t: string, strategies: any, providedCaption?: string) => {
      seenStrategies = strategies;
      seenCaption = providedCaption;
      return { result: { ...EMPTY, ingredients: ['basmati rice'], steps: ['boil'], provenance: 'extracted' }, winningStrategy: 'caption-provided' };
    });
    const caption = '✨ Persian Jeweled Rice ✨ Ingredients: 2 cups basmati rice';
    const res = await handleReEnrichRecipe(env, user, 'recipe-1', { runEnrichmentChain: chain as any }, caption);
    const body = await res.json() as { recipe: { ingredients: string[] } };
    expect(seenCaption).toContain('Persian Jeweled Rice');
    expect(typeof seenStrategies.captionProvided).toBe('function');
    expect(body.recipe.ingredients).toEqual(['basmati rice']);
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

describe('handleAdminReEnrichRecipe', () => {
  const admin = { userId: 'admin-1', email: 'admin@x.com', claims: {} } as any;

  it('403 when the caller is not an admin', async () => {
    const { db } = makeDb(makeRow());
    const env = {
      DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x',
      ADMIN_EMAILS: 'someone-else@x.com',
    } as Env;
    const res = await handleAdminReEnrichRecipe(env, admin, 'recipe-1', {
      runEnrichmentChain: baseFakeChain({ ...EMPTY, ingredients: ['x'], steps: ['y'] }) as any,
    });
    expect(res.status).toBe(403);
  });

  it('404 when the recipe does not exist', async () => {
    const { db } = makeDb(null);
    const env = {
      DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x',
      ADMIN_EMAILS: 'admin@x.com',
    } as Env;
    await expect(handleAdminReEnrichRecipe(env, admin, 'missing'))
      .rejects.toMatchObject({ status: 404 });
  });

  it("re-enriches as the recipe's owner (not the admin) and updates the row", async () => {
    const { db, runCalls } = makeDb(makeRow({ user_id: 'owner-xyz' }));
    const env = {
      DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x',
      ADMIN_EMAILS: 'admin@x.com',
    } as Env;
    const chain = baseFakeChain({
      ...EMPTY, ingredients: ['real-ing'], steps: ['real-step'], provenance: 'extracted',
    });
    const res = await handleAdminReEnrichRecipe(env, admin, 'recipe-1', { runEnrichmentChain: chain as any });
    const body = await res.json() as { recipe: { ingredients: string[]; provenance: string } };
    expect(body.recipe.ingredients).toEqual(['real-ing']);
    expect(body.recipe.provenance).toBe('extracted');
    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    // The UPDATE must be scoped to the OWNER's id, never the admin's.
    expect(update!.binds).toContain('owner-xyz');
    expect(update!.binds).not.toContain('admin-1');
  });

  it('threads an admin-supplied caption through to the owner re-enrich', async () => {
    const { db } = makeDb(makeRow({ user_id: 'owner-xyz', source_url: 'https://www.facebook.com/reel/777779878458348' }));
    const env = {
      DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'x',
      ADMIN_EMAILS: 'admin@x.com',
    } as Env;
    let seenCaption: string | undefined;
    const chain = (async (_e: any, _u: string, _t: string, _s: any, providedCaption?: string) => {
      seenCaption = providedCaption;
      return { result: { ...EMPTY, ingredients: ['real-ing'], steps: ['real-step'], provenance: 'extracted' }, winningStrategy: 'caption-provided' };
    });
    const caption = '✨ Persian Jeweled Rice ✨ Ingredients: 2 cups basmati rice';
    const res = await handleAdminReEnrichRecipe(env, admin, 'recipe-1', { runEnrichmentChain: chain as any }, caption);
    const body = await res.json() as { recipe: { ingredients: string[] } };
    expect(seenCaption).toContain('Persian Jeweled Rice');
    expect(body.recipe.ingredients).toEqual(['real-ing']);
  });
});
