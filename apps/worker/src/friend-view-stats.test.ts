import { describe, it, expect, vi } from 'vitest';
import { handleFriendViewStats } from './index';

describe('handleFriendViewStats', () => {
  // recipeCount and friendCount are single-row reads (.first()); the friends
  // list is a join (.all()). Mocks are returned in that order. The friendCount
  // row also carries viewerIsFriend, which gates the full friends list.
  const countMock = (cnt: number) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ cnt }),
  });
  const friendCountMock = (cnt: number, viewerIsFriend: number) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ cnt, viewerIsFriend }),
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

  it('returns the full friends list, mutuals flagged, when the viewer is a friend', async () => {
    // Rows arrive mutual-first from SQL (ORDER BY isMutual DESC, display_name).
    const friendRows = [
      { userId: 'user-j', name: 'Jordan Lee', avatarUrl: 'https://img/j.png', foundingChefAt: '2026-08-01T00:00:00.000Z', isMutual: 1 },
      { userId: 'user-a', name: 'Alex Kim', avatarUrl: null, foundingChefAt: null, isMutual: 0 },
    ];
    const listMock = allMock(friendRows);
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(42)) // recipeCount (target's shared recipes)
        .mockReturnValueOnce(friendCountMock(28, 1)) // friendCount + viewerIsFriend
        .mockReturnValueOnce(listMock) // target's friends
        .mockReturnValueOnce(badgeMock('2026-08-14T17:00:00.000Z')), // founding_chef_at
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result).toEqual({
      recipeCount: 42,
      friendCount: 28,
      mutualCount: 1,
      mutualFriends: [
        { userId: 'user-j', name: 'Jordan Lee', avatarUrl: 'https://img/j.png', foundingChefAt: '2026-08-01T00:00:00.000Z' },
      ],
      friendsListScope: 'all',
      friends: [
        { userId: 'user-j', name: 'Jordan Lee', avatarUrl: 'https://img/j.png', foundingChefAt: '2026-08-01T00:00:00.000Z', isMutual: true },
        { userId: 'user-a', name: 'Alex Kim', avatarUrl: null, foundingChefAt: null, isMutual: false },
      ],
      foundingChefAt: '2026-08-14T17:00:00.000Z',
    });
    // viewer LEFT JOIN, target filter, viewer exclusion, full-list flag on.
    expect(listMock.bind).toHaveBeenCalledWith('viewer-id', 'target-id', 'viewer-id', 1);
  });

  it('limits the list to mutual friends when the viewer is not a friend', async () => {
    const listMock = allMock([
      { userId: 'user-j', name: 'Jordan Lee', avatarUrl: null, foundingChefAt: null, isMutual: 1 },
    ]);
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(5))
        .mockReturnValueOnce(friendCountMock(9, 0))
        .mockReturnValueOnce(listMock)
        .mockReturnValueOnce(badgeMock(null)),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result.friendsListScope).toBe('mutual');
    // Full-list flag off, so SQL never returns the stranger's non-mutual friends.
    expect(listMock.bind).toHaveBeenCalledWith('viewer-id', 'target-id', 'viewer-id', 0);
    expect(result.friends).toEqual([
      { userId: 'user-j', name: 'Jordan Lee', avatarUrl: null, foundingChefAt: null, isMutual: true },
    ]);
    expect(result.mutualCount).toBe(1);
  });

  it('never leaks a non-mutual row to a non-friend viewer', async () => {
    // Defense in depth: even if the query returned a non-mutual row, a
    // non-friend viewer must not receive it.
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(5))
        .mockReturnValueOnce(friendCountMock(9, 0))
        .mockReturnValueOnce(allMock([
          { userId: 'user-x', name: 'Stranger Pal', avatarUrl: null, foundingChefAt: null, isMutual: 0 },
        ]))
        .mockReturnValueOnce(badgeMock(null)),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result.friends).toEqual([]);
    expect(result.mutualFriends).toEqual([]);
  });

  it('shows the full list when viewing your own drawer', async () => {
    const listMock = allMock([]);
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(countMock(1))
        .mockReturnValueOnce(friendCountMock(2, 0))
        .mockReturnValueOnce(listMock)
        .mockReturnValueOnce(badgeMock(null)),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'same-id', 'same-id');

    expect(result.friendsListScope).toBe('all');
    expect(listMock.bind).toHaveBeenCalledWith('same-id', 'same-id', 'same-id', 1);
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
    expect(result.friends).toEqual([]);
    expect(result.recipeCount).toBe(5);
    expect(result.friendCount).toBe(3);
    expect(result.foundingChefAt).toBeNull();
  });

  it('normalizes null counts and null avatar to safe values', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) })
        .mockReturnValueOnce(allMock([{ userId: 'user-a', name: 'Alex Kim', avatarUrl: undefined, isMutual: 1 }]))
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) }),
    } as unknown as D1Database;

    const result = await handleFriendViewStats(mockDb, 'viewer-id', 'target-id');

    expect(result.recipeCount).toBe(0);
    expect(result.friendCount).toBe(0);
    expect(result.friendsListScope).toBe('mutual');
    expect(result.mutualFriends[0].avatarUrl).toBeNull();
    expect(result.friends[0].avatarUrl).toBeNull();
    expect(result.foundingChefAt).toBeNull();
  });
});
