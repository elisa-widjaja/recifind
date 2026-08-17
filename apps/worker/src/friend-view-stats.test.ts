import { describe, it, expect, vi } from 'vitest';
import { handleFriendViewStats } from './index';

describe('handleFriendViewStats', () => {
  // recipeCount and friendCount are single-row COUNT(*) reads (.first());
  // the mutual list is a self-join (.all()). Mocks are returned in that order.
  const countMock = (cnt: number) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ cnt }),
  });
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });
  // 4th query: the target's founding_chef_at from profiles (.first()).
  const badgeMock = (foundingChefAt: string | null) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ founding_chef_at: foundingChefAt }),
  });

  it('returns recipe count, friend count, mutual count and the mutual list', async () => {
    const mutualRows = [
      { userId: 'user-j', name: 'Jordan Lee', avatarUrl: 'https://img/j.png', foundingChefAt: '2026-08-01T00:00:00.000Z' },
      { userId: 'user-a', name: 'Alex Kim', avatarUrl: null, foundingChefAt: null },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(42)) // recipeCount (target's shared recipes)
        .mockReturnValueOnce(countMock(28)) // friendCount (target's friends)
        .mockReturnValueOnce(allMock(mutualRows)) // mutual friends of viewer + target
        .mockReturnValueOnce(badgeMock('2026-08-14T17:00:00.000Z')), // founding_chef_at
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result).toEqual({
      recipeCount: 42,
      friendCount: 28,
      mutualCount: 2,
      mutualFriends: [
        { userId: 'user-j', name: 'Jordan Lee', avatarUrl: 'https://img/j.png', foundingChefAt: '2026-08-01T00:00:00.000Z' },
        { userId: 'user-a', name: 'Alex Kim', avatarUrl: null, foundingChefAt: null },
      ],
      foundingChefAt: '2026-08-14T17:00:00.000Z',
    });
  });

  it('reports zero mutual friends with an empty list', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(5))
        .mockReturnValueOnce(countMock(3))
        .mockReturnValueOnce(allMock([]))
        .mockReturnValueOnce(badgeMock(null)),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result.mutualCount).toBe(0);
    expect(result.mutualFriends).toEqual([]);
    expect(result.recipeCount).toBe(5);
    expect(result.friendCount).toBe(3);
    expect(result.foundingChefAt).toBeNull();
  });

  it('normalizes null counts and null avatar to safe values', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) })
        .mockReturnValueOnce(allMock([{ userId: 'user-a', name: 'Alex Kim', avatarUrl: undefined }]))
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) }),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result.recipeCount).toBe(0);
    expect(result.friendCount).toBe(0);
    expect(result.mutualFriends[0].avatarUrl).toBeNull();
    expect(result.foundingChefAt).toBeNull();
  });
});
