import { describe, expect, it, vi } from 'vitest';
import { getFriendActivity, getFriendsRecentlySaved, getFriendsRecentlyShared } from './index';

const mockUserId = 'user-123';

describe('getFriendActivity', () => {
  it('returns last 10 notifications for user', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 1, type: 'friend_saved_recipe', message: 'Elisa saved your recipe', data: '{}', created_at: '2026-03-10T10:00:00Z', read: 0 }
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('friend_saved_recipe');
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
            { id: 'r1', title: 'Berry Bake', source_url: '', image_url: '', meal_types: '[]', duration_minutes: null, created_at: '2026-03-09' }
          ]})
      })
    } as unknown as D1Database;

    const result = await getFriendsRecentlySaved(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].recipe.title).toBe('Berry Bake');
    expect(result[0].friendName).toBe('Sarah');
  });
});

describe('getFriendsRecentlyShared', () => {
  it('returns only shared_with_friends recipes', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn()
          .mockResolvedValueOnce({ results: [{ friend_id: 'friend-1', friend_name: 'Elisa' }] })
          .mockResolvedValueOnce({ results: [
            { id: 'r2', title: 'Miso Ramen', source_url: '', image_url: '', meal_types: '[]', duration_minutes: 20, created_at: '2026-03-09' }
          ]})
      })
    } as unknown as D1Database;

    const result = await getFriendsRecentlyShared(mockDb, mockUserId);
    expect(result[0].recipe.title).toBe('Miso Ramen');
  });
});
