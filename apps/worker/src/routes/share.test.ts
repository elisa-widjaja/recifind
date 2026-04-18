import { describe, expect, it } from 'vitest';
import { handleShareRecipe } from './share';
import type { ShareRecipeRequest } from '../../../shared/contracts';

// Minimal D1/KV mock
function mockEnv(opts: {
  recipeExists?: boolean;
  recipeOwnerId?: string;
  friendsOfSharer?: string[];
  callsMade?: unknown[];
} = {}) {
  const kv = new Map<string, string>();
  // By default recipe is visible (shared_with_friends = 1), owned by 'other-owner'
  const recipeExists = opts.recipeExists ?? true;
  const ownerId = opts.recipeOwnerId ?? 'other-owner';
  const friends = new Set(opts.friendsOfSharer ?? []);

  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            // Recipe lookup
            if (sql.includes('FROM recipes') && sql.includes('id = ?')) {
              return recipeExists
                ? { owner_id: ownerId, user_id: ownerId, shared_with_friends: 1 }
                : null;
            }
            // recipe_shares lookup (sharer already has access via share)
            if (sql.includes('FROM recipe_shares') && sql.includes('recipient_id = ?')) {
              return null;
            }
            // Friend check: SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?
            if (sql.includes('FROM friends')) {
              const userId = args[0] as string;
              const friendId = args[1] as string;
              return friends.has(friendId) ? { user_id: userId, friend_id: friendId } : null;
            }
            // Profiles lookup
            if (sql.includes('FROM profiles')) {
              return { display_name: 'Test Sharer' };
            }
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        }),
      }),
    },
    KV_RATE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string, _opts?: unknown) => { kv.set(k, v); },
    },
  } as any;
}

describe('POST /recipes/:id/share', () => {
  const BASE_BODY: ShareRecipeRequest = { recipient_user_ids: ['u-friend'] };
  const SHARER = 'u-sharer';
  const RECIPE = 'rec-123';

  it('rejects if recipient list is empty', async () => {
    const env = mockEnv({ recipeExists: true });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: [] },
    });
    expect(res.status).toBe(400);
  });

  it('rejects if recipient list exceeds 50', async () => {
    const env = mockEnv({ recipeExists: true });
    const ids = Array.from({ length: 51 }, (_, i) => `u-${i}`);
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: ids },
    });
    expect(res.status).toBe(400);
  });

  it('rejects self-share', async () => {
    const env = mockEnv({ recipeExists: true });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: [SHARER] },
    });
    expect(res.status).toBe(400);
  });

  it('rejects if sharer cannot view the recipe (recipe not found)', async () => {
    const env = mockEnv({ recipeExists: false });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: BASE_BODY,
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.code).toBe('FORBIDDEN');
  });

  it('skips non-friend recipients (400 NOT_FRIENDS)', async () => {
    const env = mockEnv({ recipeExists: true, friendsOfSharer: [] });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: ['u-stranger'] },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('NOT_FRIENDS');
    expect(body.non_friend_user_ids).toEqual(['u-stranger']);
  });

  it('deduplicates recipient_user_ids', async () => {
    const env = mockEnv({ recipeExists: true, friendsOfSharer: ['u-friend'] });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: ['u-friend', 'u-friend', 'u-friend'] },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // After dedup, only 1 unique recipient → 1 share
    expect(body.shared_with).toBe(1);
  });

  it('rate limits at 20 shares per hour per user', async () => {
    const env = mockEnv({ recipeExists: true, friendsOfSharer: ['u-friend'] });
    // Make 20 individual shares (each sharing 1 recipient = 1 share counted)
    for (let i = 0; i < 20; i++) {
      await handleShareRecipe({
        env,
        sharerId: SHARER,
        recipeId: RECIPE,
        body: BASE_BODY,
      });
    }
    // 21st should be rate limited
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: BASE_BODY,
    });
    expect(res.status).toBe(429);
    const body = await res.json() as any;
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  it('success path returns shared_with and skipped', async () => {
    const env = mockEnv({ recipeExists: true, friendsOfSharer: ['u-a', 'u-b'] });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: ['u-a', 'u-b'] },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.shared_with).toBe('number');
    expect(typeof body.skipped).toBe('number');
    expect(body.shared_with + body.skipped).toBe(2);
  });

  it('rejects whole batch if any recipient is a non-friend', async () => {
    const env = mockEnv({ recipeExists: true, friendsOfSharer: ['u-a', 'u-b'] });
    const res = await handleShareRecipe({
      env,
      sharerId: SHARER,
      recipeId: RECIPE,
      body: { recipient_user_ids: ['u-a', 'u-b', 'u-stranger'] },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('NOT_FRIENDS');
    expect(body.non_friend_user_ids).toContain('u-stranger');
  });
});
