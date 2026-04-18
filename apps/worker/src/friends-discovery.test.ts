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

    // Only one prepare call happens here: the implementation skips the batch recipe
    // fetch entirely when recipeIds is empty. A second mockReturnValueOnce is intentionally
    // absent to guard against a regression where the implementation fires a second query anyway.
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].recipe).toBeNull();
    expect(result[0].friendName).toBe('Jules'); // fallback: message.split(' ')[0]
    expect(mockDb.prepare).toHaveBeenCalledTimes(1); // confirms no spurious second query
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
