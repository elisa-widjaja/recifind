import { describe, it, expect, vi } from 'vitest';
import { handleFriendSuggestions, resolveEmailFromUserId } from './index';

describe('handleFriendSuggestions', () => {
  it('returns FOF suggestions sorted by mutual count', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2, mutualNames: 'Sarah||Tom' },
      { userId: 'user-c', name: 'James T.', mutualCount: 1, mutualNames: 'Sarah' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: fofResults }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ dietary_prefs: '["Vegetarian"]', meal_type_prefs: '["Dinner"]' }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].userId).toBe('user-b');
    expect(result.suggestions[0].reason).toBe('Friend of Sarah and Tom');
  });

  it('returns empty array when no suggestions found', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(0);
  });
});

describe('resolveEmailFromUserId', () => {
  it('returns email string when profile found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ email: 'maya@example.com' }),
      }),
    } as unknown as D1Database;

    const email = await resolveEmailFromUserId(mockDb, 'user-b');
    expect(email).toBe('maya@example.com');
  });

  it('returns null when user not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;

    const email = await resolveEmailFromUserId(mockDb, 'unknown-user');
    expect(email).toBeNull();
  });
});
