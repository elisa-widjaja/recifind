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
function mockDb(saves: unknown[], editors: unknown[], candidates: unknown[]) {
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });
  const prepare = vi.fn()
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
  it('returns cached result without touching D1', async () => {
    const cached = { eligible: true, reason: 'Based on your Korean saves', recipes: [], computedAt: 1 };
    const kv = mockKv(cached);
    const db = { prepare: vi.fn() } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: true, reason: 'Based on your Korean saves', recipes: [] });
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith(pickedForYouCacheKey('u1'), { type: 'json' });
  });

  it('is ineligible under 5 saves, caches that, and never queries the pool', async () => {
    const kv = mockKv();
    const prepare = vi.fn().mockReturnValueOnce({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [saveRow(1), saveRow(2), saveRow(3), saveRow(4)] }),
    });
    const db = { prepare } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: false, reason: null, recipes: [] });
    expect(prepare).toHaveBeenCalledTimes(1);
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

  it('binds the requesting user id to the saves and pool queries', async () => {
    const kv = mockKv();
    const bindSpy = vi.fn().mockReturnThis();
    const allMock = (results: unknown[]) => ({ bind: bindSpy, all: vi.fn().mockResolvedValue({ results }) });
    const prepare = vi.fn()
      .mockReturnValueOnce(allMock([1, 2, 3, 4, 5].map((i) => saveRow(i))))
      .mockReturnValueOnce(allMock([]))
      .mockReturnValueOnce(allMock([1, 2, 3].map((i) => candRow(i))));
    await getPickedForYou({ prepare } as unknown as D1Database, kv, 'user-xyz', NOW);
    expect(bindSpy).toHaveBeenCalledWith('user-xyz');
    const poolSql = prepare.mock.calls[2][0] as string;
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
    // dev-user has no saves -> one D1 query, ineligible.
    const prepare = vi.fn().mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) });
    const env = { DB: { prepare }, AI_PICKS_CACHE: kv, DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/picked-for-you', { headers: DEV }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(await res.json()).toEqual({ eligible: false, reason: null, recipes: [] });
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
