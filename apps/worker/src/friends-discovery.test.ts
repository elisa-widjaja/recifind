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
      { id: 'recipe-1', title: 'Spicy Thai Noodles', image_url: 'https://example.com/img.jpg', source_url: '', ingredients: '["noodles","chili"]', steps: '["boil","mix"]' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests (empty — no pending, so non-friend_request unaffected)
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].friendName).toBe('Sarah');
    expect(result[0].recipe?.title).toBe('Spicy Thai Noodles');
    expect(result[0].recipe?.imageUrl).toBe('https://example.com/img.jpg');
    expect(result[0].recipe?.ingredients).toEqual(['noodles', 'chili']);
    expect(result[0].recipe?.steps).toEqual(['boil', 'mix']);
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
      { id: 'recipe-2', title: 'Margherita Pizza', image_url: '' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }) // pending_requests
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].friendName).toBe('Marco');
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

    // Two prepare calls happen: notifications (1) and pending-requests (2).
    // The implementation skips the batch recipe fetch when recipeIds is empty,
    // so no third query fires. A missing third mock would surface a regression.
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ from_user_id: 'user-3' }] }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].recipe).toBeNull();
    expect(result[0].friendName).toBe('Jules'); // fallback: message.split(' ')[0]
    expect(mockDb.prepare).toHaveBeenCalledTimes(2); // notifications + pending_requests, no spurious recipe batch
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
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ from_user_id: 'user-jules' }] }) }), // still pending
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].fromUserId).toBe('user-jules');
    expect(result[0].type).toBe('friend_request');
    expect(result[0].resolved).toBe(false);
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
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }), // pending list is empty — request was accepted/declined
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
      { id: 'recipe-alive', title: 'Pasta Carbonara', image_url: '', source_url: '', ingredients: '[]', steps: '[]' },
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
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].fromUserId).toBeUndefined();
    expect(result[0].resolved).toBeUndefined(); // only set for friend_request type
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
