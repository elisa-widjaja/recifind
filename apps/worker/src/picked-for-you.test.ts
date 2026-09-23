import { describe, it, expect, vi } from 'vitest';
import { getPickedForYou, pickedForYouCacheKey } from './index';
import worker from './index';

const NOW = Date.UTC(2026, 8, 22);
const SUPA_IMG = 'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/x.jpg';
const CDN_IMG = 'https://scontent-sjc3-1.cdninstagram.com/v/t51.82787-15/1.jpg?oe=68D0';

function saveRow(i: number, over: Record<string, unknown> = {}) {
  return {
    source_url: `https://www.instagram.com/reel/mine${i}/`, cuisines: '["korean"]',
    meal_types: '["dinner"]', ingredients: '["chicken","rice","egg"]', creator: null, is_food: null,
    ...over,
  };
}

function candRow(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `c${i}`, user_id: 'other', title: 'Spicy Chicken Bowl',
    source_url: `https://www.instagram.com/reel/c${i}/`, image_url: SUPA_IMG,
    meal_types: '["dinner"]', custom_tags: '[]', duration_minutes: 20,
    ingredients: '["2 lbs chicken thighs","3 tbsp gochujang","1 cup rice"]', steps: '["Marinate","Cook"]',
    cuisines: '["korean"]', creator: 'Sofia M', created_at: '2026-09-01T00:00:00Z', is_food: null,
    ...over,
  };
}

// The function issues, in order: saves query (.all), editors' picks query
// (.all, inside getEditorsPick), candidates query (.all).
// The function issues, in order: feedback query (.all, always), then on a
// cache miss: saves query (.all), editors' picks query (.all, inside
// getEditorsPick), candidates query (.all).
function mockDb(saves: unknown[], editors: unknown[], candidates: unknown[], feedback: unknown[] = []) {
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });
  const prepare = vi.fn()
    .mockReturnValueOnce(allMock(feedback))
    .mockReturnValueOnce(allMock(saves))
    .mockReturnValueOnce(allMock(editors))
    .mockReturnValueOnce(allMock(candidates));
  return { prepare } as unknown as D1Database;
}

function mockKv(cached: unknown = null) {
  return {
    get: vi.fn().mockResolvedValue(cached),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
}

describe('getPickedForYou', () => {
  it('returns cached result, querying D1 only for the feedback map', async () => {
    const cached = { eligible: true, reason: 'Based on your Korean saves', recipes: [], computedAt: 1 };
    const kv = mockKv(cached);
    const prepare = vi.fn().mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) });
    const db = { prepare } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: true, reason: 'Based on your Korean saves', recipes: [], ratings: {} });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toMatch(/recommendation_feedback/);
    expect(kv.get).toHaveBeenCalledWith(pickedForYouCacheKey('u1'), { type: 'json' });
  });

  it('is ineligible under 5 saves, caches that, and never queries the pool', async () => {
    const kv = mockKv();
    const prepare = vi.fn()
      .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) })
      .mockReturnValueOnce({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [saveRow(1), saveRow(2), saveRow(3), saveRow(4)] }),
      });
    const db = { prepare } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: false, reason: null, recipes: [], ratings: {} });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledWith(
      pickedForYouCacheKey('u1'),
      expect.stringContaining('"eligible":false'),
      { expirationTtl: 86400 },
    );
  });

  it('computes, maps to the editors-pick shape, and caches for 24h', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => candRow(i));
    const db = mockDb(saves, [], candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.eligible).toBe(true);
    expect(out.reason).toBe('Based on your Korean saves');
    expect(out.recipes).toHaveLength(3);
    expect(out.recipes[0]).toMatchObject({
      id: expect.any(String), userId: 'other', title: 'Spicy Chicken Bowl',
      sourceUrl: expect.stringContaining('instagram.com'), imageUrl: SUPA_IMG,
      mealTypes: ['dinner'], customTags: [], durationMinutes: 20,
      ingredients: expect.any(Array), steps: expect.any(Array), creator: 'Sofia M',
    });
    expect(kv.put).toHaveBeenCalledWith(pickedForYouCacheKey('u1'), expect.any(String), { expirationTtl: 86400 });
    const stored = JSON.parse(kv.put.mock.calls[0][1] as string);
    expect(stored.recipes).toHaveLength(3);
    expect(typeof stored.computedAt).toBe('number');
  });

  it("excludes this week's editors' picks by id", async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    // Editors' pick rows come from Elisa's account; getEditorsPick maps them itself.
    const editors = [candRow(1, { user_id: '8e4dfd5e-bb6a-4890-98cd-d9ac6ce655a2', is_favorite: 1, shared_with_friends: 1 })];
    const candidates = [1, 2, 3, 4].map((i) => candRow(i));
    const db = mockDb(saves, editors, candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.recipes.map((r) => r.id)).not.toContain('c1');
    expect(out.recipes).toHaveLength(3);
  });

  it('falls through to compute when the KV read throws', async () => {
    const kv = mockKv();
    kv.get = vi.fn().mockRejectedValue(new Error('kv down'));
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const db = mockDb(saves, [], [1, 2, 3].map((i) => candRow(i)));
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.eligible).toBe(true);
    expect(out.recipes).toHaveLength(3);
  });

  it('swallows a KV write failure and still returns the result', async () => {
    const kv = mockKv();
    kv.put = vi.fn().mockRejectedValue(new Error('kv write down'));
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const db = mockDb(saves, [], [1, 2, 3].map((i) => candRow(i)));
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.recipes).toHaveLength(3);
  });

  it('does not throw on a malformed custom_tags in the pool; that row is excluded', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [
      candRow(1, { custom_tags: '{bad' }),
      candRow(2), candRow(3), candRow(4),
    ];
    const db = mockDb(saves, [], candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.eligible).toBe(true);
    expect(out.recipes.map((r) => r.id)).not.toContain('c1');
    expect(out.recipes.map((r) => r.id)).toEqual(expect.arrayContaining(['c2', 'c3', 'c4']));
  });

  it('maps a null source_url to an empty string, not the literal "null"', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [
      candRow(1, { source_url: null }),
      candRow(2), candRow(3),
    ];
    const db = mockDb(saves, [], candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    const row = out.recipes.find((r) => r.id === 'c1');
    expect(row?.sourceUrl).toBe('');
  });

  it('drops candidates whose only image is an expiring CDN link', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [candRow(1, { image_url: CDN_IMG, preview_image: null }), candRow(2), candRow(3), candRow(4)];
    const out = await getPickedForYou(mockDb(saves, [], candidates), kv, 'u1', NOW);
    expect(out.recipes.map((r) => r.id)).not.toContain('c1');
    expect(out.recipes).toHaveLength(3);
  });

  it('uses the durable preview URL when image_url is a CDN link but a Supabase preview exists', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const durable = 'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/durable.jpg';
    const candidates = [
      candRow(1, { image_url: CDN_IMG, preview_image: JSON.stringify({ publicUrl: durable }) }),
      candRow(2), candRow(3),
    ];
    const out = await getPickedForYou(mockDb(saves, [], candidates), kv, 'u1', NOW);
    const c1 = out.recipes.find((r) => r.id === 'c1');
    expect(c1?.imageUrl).toBe(durable);
  });

  it('never returns more than 3 picks', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const out = await getPickedForYou(mockDb(saves, [], [1, 2, 3, 4, 5, 6].map((i) => candRow(i))), kv, 'u1', NOW);
    expect(out.recipes).toHaveLength(3);
  });

  it('attaches the user\'s existing ratings to a cached result', async () => {
    const cached = { eligible: true, reason: 'r', recipes: [{ id: 'c1' }, { id: 'c2' }], computedAt: 1 };
    const kv = mockKv(cached);
    const prepare = vi.fn().mockReturnValueOnce({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [{ recipe_id: 'c1', rating: -1 }, { recipe_id: 'zz', rating: 1 }] }),
    });
    const out = await getPickedForYou({ prepare } as unknown as D1Database, kv, 'u1', NOW);
    expect(out.ratings).toEqual({ c1: -1, zz: 1 });
  });

  it('excludes recipes the user rated "Not for me" from a recompute', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [1, 2, 3, 4].map((i) => candRow(i));
    const db = mockDb(saves, [], candidates, [{ recipe_id: 'c1', rating: -1 }, { recipe_id: 'c2', rating: 1 }]);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    const ids = out.recipes.map((r) => r.id);
    expect(ids).not.toContain('c1');
    expect(ids).toContain('c2');
    expect(out.ratings).toEqual({ c1: -1, c2: 1 });
  });

  it('binds the requesting user id to the saves and pool queries', async () => {
    const kv = mockKv();
    const bindSpy = vi.fn().mockReturnThis();
    const allMock = (results: unknown[]) => ({ bind: bindSpy, all: vi.fn().mockResolvedValue({ results }) });
    const prepare = vi.fn()
      .mockReturnValueOnce(allMock([]))
      .mockReturnValueOnce(allMock([1, 2, 3, 4, 5].map((i) => saveRow(i))))
      .mockReturnValueOnce(allMock([]))
      .mockReturnValueOnce(allMock([1, 2, 3].map((i) => candRow(i))));
    await getPickedForYou({ prepare } as unknown as D1Database, kv, 'user-xyz', NOW);
    expect(bindSpy).toHaveBeenCalledWith('user-xyz');
    const poolSql = prepare.mock.calls[3][0] as string;
    expect(poolSql).toMatch(/user_id != \?/);
    expect(poolSql).toMatch(/shared_with_friends = 1/);
    expect(poolSql).toMatch(/hidden_at IS NULL/);
    expect(poolSql).toMatch(/is_food IS NULL OR is_food = 1/);
    expect(poolSql).toMatch(/provenance IS NULL OR provenance != 'title-only'/);
    expect(poolSql).toMatch(/preview_image/);
  });
});

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const DEV = { Authorization: 'Bearer devkey' };

describe('GET /recipes/picked-for-you', () => {
  it('returns 401 with CORS headers when no Authorization header is sent', async () => {
    const env = { DB: { prepare: vi.fn() }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/picked-for-you'), env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('returns the result JSON with CORS headers for an authenticated user', async () => {
    const kv = mockKv();
    // dev-user has no feedback and no saves -> two D1 queries, ineligible.
    const emptyAll = () => ({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) });
    const prepare = vi.fn().mockReturnValueOnce(emptyAll()).mockReturnValueOnce(emptyAll());
    const env = { DB: { prepare }, AI_PICKS_CACHE: kv, DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/picked-for-you', { headers: DEV }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(await res.json()).toEqual({ eligible: false, reason: null, recipes: [], ratings: {} });
    expect(kv.get).toHaveBeenCalledWith(pickedForYouCacheKey('dev-user'), { type: 'json' });
  });

  it('GET /recipes/for-you no longer exists', async () => {
    // No route matches the literal path '/recipes/for-you' any more, so it
    // falls through to the generic '/recipes/:id' GET handler and is looked
    // up as a (nonexistent) recipe id -> loadRecipe's natural 404. The DB
    // stub below supports that lookup chain (and the share-fallback check
    // inside handleGetRecipe) resolving to "not found" rather than crashing.
    const dbStub = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    };
    const env = { DB: dbStub, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/for-you', { headers: DEV }), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('POST /recipes/picked-for-you/feedback', () => {
  const runMock = () => ({ bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({ success: true }) });
  const post = (body: unknown, headers: Record<string, string> = DEV) =>
    new Request('https://worker/recipes/picked-for-you/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });

  it('returns 401 without auth', async () => {
    const env = { DB: { prepare: vi.fn() }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(post({ recipeId: 'c1', rating: 1 }, {}), env, ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a missing recipeId or a rating other than 1 / -1 with 400', async () => {
    const env = { DB: { prepare: vi.fn() }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    expect((await worker.fetch(post({ rating: 1 }), env, ctx)).status).toBe(400);
    expect((await worker.fetch(post({ recipeId: 'c1', rating: 5 }), env, ctx)).status).toBe(400);
    expect((await worker.fetch(post({ recipeId: 'c1', rating: '1' }), env, ctx)).status).toBe(400);
  });

  it('upserts one row per (user, recipe) and returns ok with CORS', async () => {
    const stmt = runMock();
    const prepare = vi.fn().mockReturnValue(stmt);
    const env = { DB: { prepare }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(post({ recipeId: 'c1', rating: -1, reason: 'Based on your Korean saves' }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true });
    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toMatch(/INSERT INTO recommendation_feedback/);
    expect(sql).toMatch(/ON CONFLICT\s*\(user_id, recipe_id\)/);
    const binds = stmt.bind.mock.calls[0];
    expect(binds.slice(0, 4)).toEqual(['dev-user', 'c1', -1, 'Based on your Korean saves']);
  });

  it('truncates an over-long reason and stores null when absent', async () => {
    const stmt = runMock();
    const prepare = vi.fn().mockReturnValue(stmt);
    const env = { DB: { prepare }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    await worker.fetch(post({ recipeId: 'c1', rating: 1, reason: 'x'.repeat(500) }), env, ctx);
    expect((stmt.bind.mock.calls[0][3] as string).length).toBe(200);
    await worker.fetch(post({ recipeId: 'c2', rating: 1 }), env, ctx);
    expect(stmt.bind.mock.calls[1][3]).toBeNull();
  });
});
