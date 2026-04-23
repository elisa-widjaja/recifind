import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  const db = {
    prepare: (sql: string) => {
      const binds: any[] = [];
      return {
        bind: (...args: any[]) => {
          binds.push(...args);
          return {
            first: async () => {
              firstCalls.push({ sql, binds });
              if (sql.includes('FROM recipes')) return options.existingRecipe ?? null;
              if (sql.includes('FROM profiles')) return options.profile ?? null;
              return null;
            },
            run: async () => {
              runCalls.push({ sql, binds });
              return { success: true };
            },
            all: async () => {
              allCalls.push({ sql, binds });
              if (sql.includes('FROM friends')) return { results: options.friends ?? [] };
              return { results: [] };
            }
          };
        }
      };
    }
  };
  return { db, firstCalls, runCalls };
}

describe('handleCreateRecipe dedup', () => {
  it('returns existing recipe when same (user_id, source_url) was inserted within 60s', async () => {
    const existing = {
      id: 'recipe-existing-123',
      created_at: new Date(Date.now() - 10_000).toISOString(),
    };
    const { db, runCalls } = makeMockDb({ existingRecipe: existing });

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
    // Must NOT insert a new row
    expect(runCalls.find(c => c.sql.includes('INSERT INTO recipes'))).toBeUndefined();
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
