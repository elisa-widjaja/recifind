import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCreateRecipe, enrichAfterSave } from './index';
import type { Env } from './index';

function makeMockDb(options: {
  existingRecipe?: { id: string; created_at: string } | null;
  friends?: Array<{ friend_id: string }>;
  profile?: { display_name?: string } | null;
}) {
  const firstCalls: Array<{ sql: string; binds: any[] }> = [];
  const runCalls: Array<{ sql: string; binds: any[] }> = [];
  const allCalls: Array<{ sql: string; binds: any[] }> = [];

  // Full-row shape that loadRecipe's SELECT * requires — must survive rowToRecipe()
  const fullRecipeRow = options.existingRecipe
    ? {
        id: options.existingRecipe.id,
        user_id: 'user-abc',
        title: 'Pasta',
        source_url: 'https://example.com/pasta',
        image_url: '',
        image_path: null,
        meal_types: JSON.stringify([]),
        ingredients: JSON.stringify([]),
        steps: JSON.stringify([]),
        duration_minutes: null,
        notes: '',
        preview_image: null,
        shared_with_friends: 0,
        created_at: options.existingRecipe.created_at,
        updated_at: options.existingRecipe.created_at,
      }
    : null;

  const db = {
    prepare: (sql: string) => {
      const binds: any[] = [];
      return {
        bind: (...args: any[]) => {
          binds.push(...args);
          return {
            first: async () => {
              firstCalls.push({ sql, binds: [...binds] });
              if (sql.includes('FROM recipes')) {
                // Dedup query: SELECT id, created_at ... WHERE ... AND source_url = ?
                // loadRecipe query: SELECT * ... WHERE user_id = ? AND id = ?
                // Use 'AND id = ?' (with leading ' AND') to avoid matching 'user_id = ?'
                if (sql.includes('source_url = ?')) {
                  // Dedup lookup — return the slim row (id + created_at only)
                  return options.existingRecipe ?? null;
                }
                if (sql.includes('AND id = ?')) {
                  // loadRecipe lookup — return a full row so rowToRecipe() works
                  return fullRecipeRow;
                }
              }
              if (sql.includes('FROM profiles')) return options.profile ?? null;
              return null;
            },
            run: async () => {
              runCalls.push({ sql, binds: [...binds] });
              return { success: true };
            },
            all: async () => {
              allCalls.push({ sql, binds: [...binds] });
              if (sql.includes('FROM friends')) return { results: options.friends ?? [] };
              return { results: [] };
            }
          };
        }
      };
    }
  };
  return { db, firstCalls, runCalls, allCalls };
}

describe('handleCreateRecipe dedup', () => {
  it('returns existing recipe when same (user_id, source_url) was inserted within 60s', async () => {
    const dupe = {
      id: 'recipe-existing-123',
      created_at: new Date(Date.now() - 10_000).toISOString(),
    };
    const { db, firstCalls, runCalls } = makeMockDb({ existingRecipe: dupe });

    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    const res = await handleCreateRecipe(req, env, ctx, user as any);
    const body = await res.json() as { recipe: { id: string } };

    expect(res.status).toBe(200);
    expect(body.recipe.id).toBe('recipe-existing-123');

    // loadRecipe must have been called with dupe.id as one of its binds
    const loadRecipeCall = firstCalls.find(c => c.sql.includes('AND id = ?'));
    expect(loadRecipeCall).toBeDefined();
    expect(loadRecipeCall!.binds).toContain(dupe.id);

    // Dedup branch must NOT insert a new recipe row
    expect(runCalls.find(c => c.sql.includes('INSERT INTO recipes'))).toBeUndefined();
    // Dedup branch must NOT insert notifications
    expect(runCalls.find(c => c.sql.includes('INSERT INTO notifications'))).toBeUndefined();
    // Dedup branch must NOT bump collection_meta (updateCollectionMeta emits INSERT OR REPLACE)
    expect(runCalls.find(c => c.sql.includes('collection_meta'))).toBeUndefined();
  });

  it('inserts new recipe when no duplicate exists within 60s window', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });

    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    const res = await handleCreateRecipe(req, env, ctx, user as any);
    expect(res.status).toBe(201);
    expect(runCalls.some(c => c.sql.includes('INSERT INTO recipes'))).toBe(true);
  });
});

// Valid base64-encoded fake service account JSON (satisfies atob + JSON.parse in getGeminiServiceAccount).
// crypto.subtle ops (importKey, sign) are stubbed per-test so no real RSA key is needed.
const FAKE_SA_B64 = btoa(JSON.stringify({
  client_email: 'svc@test.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
  token_uri: 'https://oauth2.googleapis.com/token',
  project_id: 'test-proj',
}));

describe('enrichAfterSave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('updates the D1 row when the chain returns ingredients', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds }); return { success: true }; }
        })
      })
    };
    const env = {
      DB: db as unknown as D1Database,
      GEMINI_SERVICE_ACCOUNT_B64: FAKE_SA_B64,
    } as Env;

    // Stub crypto.subtle so the RSA key import + JWT signing don't fail on the fake key.
    const fakeKey = {} as CryptoKey;
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(fakeKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new ArrayBuffer(32));

    // Stub chain via fetch — captionExtract path returns a verbatim-parseable caption.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('r.jina.ai')) {
        return {
          ok: true,
          // Pad past the 500-char gate in textInference so the chain exercises
          // pass-1 instead of short-circuiting on length.
          text: async () => 'Ingredients: 1 cup flour, 2 eggs\nSteps: 1. Mix. 2. Bake.'.padEnd(600, ' '),
        } as Response;
      }
      // Gemini access token + inference
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'fake' }) } as Response;
      }
      if (url.includes('generativelanguage.googleapis.com') || url.includes('aiplatform.googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              title: 'Pancake',
              ingredients: ['1 cup flour', '2 eggs'],
              steps: ['Mix', 'Bake'],
              mealTypes: ['breakfast'],
              durationMinutes: 15,
              notes: '',
              imageUrl: '',
            }) }] } }],
          }),
        } as Response;
      }
      return { ok: false, text: async () => '' } as Response;
    }) as typeof fetch);

    await enrichAfterSave(env, 'recipe-123', 'https://example.com/pancake', 'Pancake');

    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('recipe-123');
    // ingredients JSON is one of the binds
    expect(update!.binds.some(b => typeof b === 'string' && b.includes('flour'))).toBe(true);
  });

  it('leaves the row unchanged when every strategy returns empty', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds }); return { success: true }; }
        })
      })
    };
    const env = {
      DB: db as unknown as D1Database,
      GEMINI_SERVICE_ACCOUNT_B64: 'fake-b64',
    } as Env;

    // r.jina.ai returns an error page → strategies all short-circuit to empty.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => '<html>HTTP ERROR 429 Too Many Requests</html>',
    })) as typeof fetch);

    await enrichAfterSave(env, 'recipe-456', 'https://instagram.com/reel/abc', 'Mystery');

    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeUndefined();
  });
});

describe('handleCreateRecipe fires ctx.waitUntil(enrichAfterSave)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('schedules enrichAfterSave via ctx.waitUntil on new save', async () => {
    const { db } = makeMockDb({ existingRecipe: null });
    const pending: Array<Promise<any>> = [];
    const waitUntil = vi.fn((p: Promise<any>) => { pending.push(p); });
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
    const ctx = { waitUntil } as unknown as ExecutionContext;
    const user = { userId: 'u1', email: 'a@b.c' };

    // Stub fetch so enrichAfterSave's chain returns empty fast (no UPDATE fires).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })));
    // Capture [enrichAfterSave] log to witness that the enrichment code path actually ran —
    // positional assertions on mock.calls[i][0] are too weak (would pass if only admin
    // email was waitUntil'd).
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://example.com/bread', ingredients: [], steps: [] }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    // Drain background work so assertions below reflect what actually ran.
    await Promise.allSettled(pending);

    expect(waitUntil).toHaveBeenCalled();
    // Every waitUntil argument must be a Promise (protects against raw-value misuse).
    waitUntil.mock.calls.forEach(([arg]) => expect(arg).toBeInstanceOf(Promise));
    // Witness: enrichAfterSave ran and logged its structured line.
    const enrichLog = logSpy.mock.calls.find(([tag]) => tag === '[enrichAfterSave]');
    expect(enrichLog).toBeDefined();
    expect(enrichLog![1]).toMatchObject({ winningStrategy: 'none', ingredients_count: 0, steps_count: 0 });
  });

  it('does NOT fire ctx.waitUntil when dedup returns existing row', async () => {
    const existing = { id: 'r-dupe', created_at: new Date().toISOString() };
    const { db } = makeMockDb({ existingRecipe: existing });
    const waitUntil = vi.fn();
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
    const ctx = { waitUntil } as unknown as ExecutionContext;
    const user = { userId: 'u1', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://example.com/bread' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

describe('handleCreateRecipe provenance', () => {
  it('persists provenance from the POST body into the INSERT binding list', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });
    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta', provenance: 'inferred' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    const insert = runCalls.find(c => c.sql.includes('INSERT INTO recipes'));
    expect(insert).toBeDefined();
    expect(insert!.binds).toContain('inferred');
  });

  it('defaults provenance to null when the POST body omits it', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });
    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    const insert = runCalls.find(c => c.sql.includes('INSERT INTO recipes'));
    expect(insert).toBeDefined();
    expect(insert!.binds).not.toContain('inferred');
    expect(insert!.binds).not.toContain('extracted');
  });
});
