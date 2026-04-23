import { describe, expect, it, vi } from 'vitest';
import { handleCreateRecipe } from './index';
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
