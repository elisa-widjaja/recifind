import { describe, it, expect, vi } from 'vitest';
import { handleFriendSuggestions, resolveEmailFromUserId } from './index';

describe('handleFriendSuggestions', () => {
  it('returns FOF suggestions tagged kind="fof" with mutualCount, sorted desc', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
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
    expect(result.suggestions[0]).toEqual({
      userId: 'user-b',
      name: 'Maya R.',
      kind: 'fof',
      mutualCount: 2,
    });
    expect(result.suggestions[1]).toEqual({
      userId: 'user-c',
      name: 'James T.',
      kind: 'fof',
      mutualCount: 1,
    });
  });

  it('returns empty array when no FOF and no prefs', async () => {
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

  it('falls back to pref-match when FOF < 5 and tags rows kind="pref" with sharedPref', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 1 },
    ];
    const prefResults = [
      { userId: 'user-d', name: 'Priya S.', dietary_prefs: '["Vegetarian","Gluten-free"]', meal_type_prefs: null },
      { userId: 'user-e', name: 'Nora K.', dietary_prefs: null, meal_type_prefs: '["Dinner"]' },
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
          all: vi.fn().mockResolvedValue({ results: prefResults }),
        }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].kind).toBe('fof');
    expect(result.suggestions[1]).toEqual({
      userId: 'user-d',
      name: 'Priya S.',
      kind: 'pref',
      sharedPref: 'Vegetarian',
    });
    expect(result.suggestions[2]).toEqual({
      userId: 'user-e',
      name: 'Nora K.',
      kind: 'pref',
      sharedPref: 'Dinner',
    });
  });

  it('skips pref-match when FOF >= 5', async () => {
    const fofResults = [
      { userId: 'u1', name: 'A', mutualCount: 3 },
      { userId: 'u2', name: 'B', mutualCount: 2 },
      { userId: 'u3', name: 'C', mutualCount: 2 },
      { userId: 'u4', name: 'D', mutualCount: 1 },
      { userId: 'u5', name: 'E', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValueOnce({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: fofResults }),
      }),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.every(s => s.kind === 'fof')).toBe(true);
    // Only the FOF query should have been prepared (no profile fetch, no pref query)
    expect((mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
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
