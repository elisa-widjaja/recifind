import { describe, expect, it, vi } from 'vitest';
import { getFriendActivity, getFriendsRecentlySaved, getFriendsRecentlyShared } from './index';

const mockUserId = 'user-123';

describe('getFriendActivity', () => {
  it('returns notifications enriched with recipe and friendName', async () => {
    const notificationRows = [
      {
        id: 1,
        type: 'friend_cooked_recipe',
        message: 'Sarah cooked Spicy Thai Noodles 🍳',
        data: JSON.stringify({ cookerId: 'cook-1', recipeId: 'recipe-1', friendName: 'Sarah' }),
        created_at: '2026-03-10T10:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-1', user_id: 'owner-1', shared_with_friends: 1, title: 'Spicy Thai Noodles', image_url: 'https://example.com/img.jpg', source_url: '', ingredients: '["noodles","chili"]', steps: '["boil","mix"]' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests (empty — no pending, so non-friend_request unaffected)
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'cook-1', display_name: 'Sarah' }] }) }), // actor profiles (live name)
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].friendName).toBe('Sarah');
    expect(result[0].recipe?.title).toBe('Spicy Thai Noodles');
    expect(result[0].recipe?.imageUrl).toBe('https://example.com/img.jpg');
    expect(result[0].recipe?.ingredients).toEqual(['noodles', 'chili']);
    expect(result[0].recipe?.steps).toEqual(['boil', 'mix']);
  });

  it('carries the recipe owner id through as recipe.userId so share links resolve', async () => {
    // Regression: the activity feed used to strip the owner id from its recipe
    // projection. Sharing a recipe opened from this feed then fell back to the
    // viewer's own id when building `?recipe={id}&user={owner}`, producing a
    // link that resolved to "recipe not found" with no SMS/OG thumbnail. The
    // owner id (recipes.user_id) must survive as recipe.userId, matching every
    // other feed source.
    const notificationRows = [
      {
        id: 10,
        type: 'friend_shared_recipe',
        message: 'Sarah shared Spicy Thai Noodles',
        data: JSON.stringify({ sharerId: 'cook-1', recipeId: 'recipe-1', friendName: 'Sarah' }),
        created_at: '2026-03-10T10:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-1', user_id: 'owner-1', shared_with_friends: 1, title: 'Spicy Thai Noodles', image_url: 'https://example.com/img.jpg', source_url: '', ingredients: '["noodles"]', steps: '["boil"]' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'cook-1', display_name: 'Sarah' }] }) }), // actor profiles
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].recipe?.userId).toBe('owner-1');
  });

  it('falls back to first word of message when friendName not in data blob', async () => {
    const notificationRows = [
      {
        id: 2,
        type: 'friend_cooked_recipe',
        message: 'Marco cooked Margherita Pizza 🍳',
        data: JSON.stringify({ cookerId: 'cook-2', recipeId: 'recipe-2' }), // no friendName
        created_at: '2026-03-10T09:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-2', user_id: 'owner-2', shared_with_friends: 1, title: 'Margherita Pizza', image_url: '' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }), // actor profiles (none — forces message fallback)
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].friendName).toBe('Marco');
  });

  it('shows the generic name when the actor profile exists but has no display_name (relay signup)', async () => {
    const notificationRows = [
      {
        id: 5,
        type: 'friend_cooked_recipe',
        // Baked message carries the gibberish relay handle — must NOT surface.
        message: '69bzcjwj7k cooked Margherita Pizza 🍳',
        data: JSON.stringify({ cookerId: 'relay-1', recipeId: 'recipe-2' }),
        created_at: '2026-03-10T09:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-2', user_id: 'owner-2', shared_with_friends: 1, title: 'Margherita Pizza', image_url: '' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        // Profile row EXISTS for relay-1 but display_name is null → nameless actor.
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'relay-1', display_name: null, avatar_url: null }] }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].friendName).toBe('ReciFriend cook');
  });

  it('returns recipe as null when recipeId is absent from data blob', async () => {
    const notificationRows = [
      {
        id: 3,
        type: 'friend_request',
        message: 'Jules sent you a friend request',
        data: JSON.stringify({ fromUserId: 'user-3' }), // no recipeId — second db.prepare is NOT called
        created_at: '2026-03-09T08:00:00Z',
        read: 0,
      },
    ];

    // Three prepare calls: notifications (1), pending-requests (2), and the
    // actor-profile lookup (3) — fromUserId is now included so the requester's
    // avatar can be resolved. The batch recipe fetch is still skipped (no
    // recipeId), so there's no fourth query.
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ from_user_id: 'user-3' }] }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }), // actor profiles
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].recipe).toBeNull();
    expect(result[0].friendName).toBe('Jules'); // fallback: message.split(' ')[0]
    expect(mockDb.prepare).toHaveBeenCalledTimes(3); // notifications + pending_requests + actor profiles, no recipe batch
  });

  it('surfaces fromUserId on friend_request notifications', async () => {
    const notificationRows = [
      {
        id: 4,
        type: 'friend_request',
        message: 'Jules sent you a friend request',
        data: JSON.stringify({ fromUserId: 'user-jules', fromEmail: 'jules@example.com' }),
        created_at: '2026-03-09T08:00:00Z',
        read: 0,
      },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ from_user_id: 'user-jules' }] }) }) // still pending
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'user-jules', display_name: 'Jules', avatar_url: 'https://example.com/jules.jpg' }] }) }), // actor profiles
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].fromUserId).toBe('user-jules');
    expect(result[0].type).toBe('friend_request');
    expect(result[0].resolved).toBe(false);
    // Requester's avatar is resolved by fromUserId for the activity feed.
    expect(result[0].avatarUrl).toBe('https://example.com/jules.jpg');
  });

  it('marks friend_request items as resolved when no pending request row remains', async () => {
    const notificationRows = [
      {
        id: 6,
        type: 'friend_request',
        message: 'Jules sent you a friend request',
        data: JSON.stringify({ fromUserId: 'user-jules' }),
        created_at: '2026-03-09T08:00:00Z',
        read: 0,
      },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending list is empty — request was accepted/declined
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }), // actor profiles
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].resolved).toBe(true);
  });

  it('drops notifications whose referenced recipe was deleted', async () => {
    // Two notifications: one for a recipe that still exists, one for a deleted
    // recipe. The deleted-recipe one would render as an untappable feed item
    // if not filtered out — that's the bug this guards against.
    const notificationRows = [
      {
        id: 10,
        type: 'friend_saved_recipe',
        message: 'Alex saved Pasta Carbonara',
        data: JSON.stringify({ recipeId: 'recipe-alive', friendName: 'Alex' }),
        created_at: '2026-04-29T12:00:00Z',
        read: 0,
      },
      {
        id: 11,
        type: 'friend_cooked_recipe',
        message: 'Sarah cooked Deleted Recipe 🍳',
        data: JSON.stringify({ recipeId: 'recipe-deleted', friendName: 'Sarah' }),
        created_at: '2026-04-29T11:00:00Z',
        read: 0,
      },
    ];
    // Only recipe-alive comes back from the batch fetch — recipe-deleted is gone.
    const recipeRows = [
      { id: 'recipe-alive', user_id: 'owner-a', shared_with_friends: 1, title: 'Pasta Carbonara', image_url: '', source_url: '', ingredients: '[]', steps: '[]' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
    expect(result[0].recipe?.id).toBe('recipe-alive');
  });

  it('keeps friend_saved_your_recipe for a PRIVATE recipe but drops generic types', async () => {
    const notificationRows = [
      {
        id: 20,
        type: 'friend_saved_your_recipe',
        message: 'Henny saved your recipe Secret Stew',
        data: JSON.stringify({ saverId: 'saver-1', recipeId: 'recipe-private', friendName: 'Henny' }),
        created_at: '2026-05-17T12:00:00Z',
        read: 0,
      },
      {
        id: 21,
        type: 'friend_saved_recipe',
        message: 'Henny saved Secret Stew',
        data: JSON.stringify({ saverId: 'saver-1', recipeId: 'recipe-private', friendName: 'Henny' }),
        created_at: '2026-05-17T11:00:00Z',
        read: 0,
      },
    ];
    // Recipe is private (shared_with_friends = 0).
    const recipeRows = [
      { id: 'recipe-private', user_id: 'user-123', shared_with_friends: 0, title: 'Secret Stew', image_url: '', source_url: '', ingredients: '[]', steps: '[]' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'saver-1', display_name: 'Henny' }] }) }), // actor profiles
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    // Only the owner-visible "saved your recipe" survives; the generic
    // friend_saved_recipe is dropped because the recipe is private.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(20);
    expect(result[0].recipe?.title).toBe('Secret Stew');
  });

  it('omits fromUserId when notification data blob does not have it', async () => {
    const notificationRows = [
      {
        id: 5,
        type: 'friend_cooked_recipe',
        message: 'Sarah cooked Spicy Thai Noodles 🍳',
        data: JSON.stringify({ cookerId: 'cook-1', friendName: 'Sarah' }),
        created_at: '2026-03-10T10:00:00Z',
        read: 0,
      },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }), // actor profiles (no recipeId → no recipe query; actor query still runs)
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].fromUserId).toBeUndefined();
    expect(result[0].resolved).toBeUndefined(); // only set for friend_request type
  });

  it('uses the live profile name for the actor, overriding a stale baked name', async () => {
    const notificationRows = [
      {
        id: 30,
        type: 'friend_saved_your_recipe',
        // Baked name is the OLD display name at save time.
        message: 'eWid saved your recipe Miso Ramen',
        data: JSON.stringify({ saverId: 'saver-9', recipeId: 'recipe-9', friendName: 'eWid' }),
        created_at: '2026-05-17T12:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-9', user_id: 'user-123', shared_with_friends: 1, title: 'Miso Ramen', image_url: '', source_url: '', ingredients: '[]', steps: '[]' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) })
        // Profile has since been renamed to "Elisa".
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ user_id: 'saver-9', display_name: 'Elisa' }] }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    // Live name wins over the stale baked "eWid".
    expect(result[0].friendName).toBe('Elisa');
  });
});

describe('getFriendsRecentlySaved', () => {
  it('returns recent recipes from all friends', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn()
          .mockResolvedValueOnce({ results: [{ friend_id: 'friend-1', friend_name: 'Sarah' }] })
          .mockResolvedValueOnce({ results: [
            { id: 'r1', title: 'Berry Bake', source_url: '', image_url: '', meal_types: '[]', duration_minutes: null, created_at: '2026-03-09', ingredients: '["berries"]', steps: '["bake"]' }
          ]})
      })
    } as unknown as D1Database;

    const result = await getFriendsRecentlySaved(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].recipe.title).toBe('Berry Bake');
    expect(result[0].friendName).toBe('Sarah');
    expect(result[0].recipe.ingredients).toEqual(['berries']);
  });
});

describe('getFriendsRecentlyShared', () => {
  it('returns recipes shared directly with the user via recipe_shares JOIN', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValueOnce({
          results: [
            {
              id: 'r2',
              user_id: 'friend-1',
              title: 'Miso Ramen',
              source_url: '',
              image_url: '',
              meal_types: '[]',
              duration_minutes: 20,
              created_at: '2026-03-09T00:00:00Z',
              ingredients: '["miso","ramen"]',
              steps: '["boil","serve"]',
              shared_at: '2026-03-10T08:00:00Z',
              sharer_id: 'friend-1',
              sharer_name: 'Elisa',
            },
          ],
        }),
      }),
    } as unknown as D1Database;

    const result = await getFriendsRecentlyShared(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].recipe.title).toBe('Miso Ramen');
    expect(result[0].recipe.ingredients).toEqual(['miso', 'ramen']);
    expect(result[0].friendId).toBe('friend-1');
    expect(result[0].friendName).toBe('Elisa');
  });
});
