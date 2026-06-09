import { describe, it, expect, vi } from 'vitest';
import { handleFriendSuggestions, resolveEmailFromUserId } from './index';

describe('handleFriendSuggestions', () => {
  // Helper: every call to handleFriendSuggestions starts with a query against
  // friend_requests_sent. Tests that don't care about that flag should mock it
  // as empty results.
  const sentQueryMock = (toIds: string[] = []) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: toIds.map(id => ({ to_user_id: id })) }),
  });
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });

  it('returns FOF suggestions tagged kind="fof" with mutualCount, sorted desc', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        // FOF < 5 -> seed query runs; no seeded accounts match here.
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toEqual({
      userId: 'user-b',
      name: 'Maya R.',
      avatarUrl: null,
      kind: 'fof',
      mutualCount: 2,
      requestSent: false,
    });
    expect(result.suggestions[1]).toEqual({
      userId: 'user-c',
      name: 'James T.',
      avatarUrl: null,
      kind: 'fof',
      mutualCount: 1,
      requestSent: false,
    });
  });

  it('flags suggestions with requestSent=true when a pending sent-request exists', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        // user-a has already sent a request to user-b
        .mockReturnValueOnce(sentQueryMock(['user-b']))
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    // Both still surfaced (not excluded) so the "Requested" card persists.
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].requestSent).toBe(true);
    expect(result.suggestions[1].requestSent).toBe(false);
  });

  it('hides nameless suggestions (null/blank display_name) so no gibberish card renders', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-x', name: null, mutualCount: 5 },
      { userId: 'user-y', name: '   ', mutualCount: 4 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].userId).toBe('user-b');
  });

  it('returns empty array when no FOF and no seeded accounts match', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock([]))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');
    expect(result.suggestions).toHaveLength(0);
  });

  it('falls back to seeded accounts when FOF < 5, tagged kind="seed" with label, founder first', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 1 },
    ];
    // Returned out of config order to prove the handler re-orders founder first.
    const seedResults = [
      { userId: 'user-mochi', name: 'Mochi', avatarUrl: null, email: 'mochislime02@gmail.com' },
      { userId: 'user-elisa', name: 'Elisa W.', avatarUrl: null, email: 'elisa.widjaja@gmail.com' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock(seedResults)),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].kind).toBe('fof');
    // Founder ordered before top contributor regardless of row order.
    expect(result.suggestions[1]).toEqual({
      userId: 'user-elisa',
      name: 'Elisa W.',
      avatarUrl: null,
      kind: 'seed',
      label: 'ReciFriend Founder',
      requestSent: false,
    });
    expect(result.suggestions[2]).toEqual({
      userId: 'user-mochi',
      name: 'Mochi',
      avatarUrl: null,
      kind: 'seed',
      label: 'Top contributor',
      requestSent: false,
    });
  });

  it('skips the seeded fallback when FOF >= 5', async () => {
    const fofResults = [
      { userId: 'u1', name: 'A', mutualCount: 3 },
      { userId: 'u2', name: 'B', mutualCount: 2 },
      { userId: 'u3', name: 'C', mutualCount: 2 },
      { userId: 'u4', name: 'D', mutualCount: 1 },
      { userId: 'u5', name: 'E', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults)),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.every(s => s.kind === 'fof')).toBe(true);
    // Only the sent-set + FOF queries — no seed query.
    expect((mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
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
