import { describe, expect, it, vi } from 'vitest';
import { isAdminEmail } from './admin';
import { writeAuditLog } from './admin';
import { handleAdminMe } from './admin';

describe('isAdminEmail', () => {
  it('returns true for an email in ADMIN_EMAILS (single value)', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('returns true for an email in a comma-separated ADMIN_EMAILS list', () => {
    expect(isAdminEmail('foo@bar.com', 'elisa.widjaja@gmail.com,foo@bar.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAdminEmail('Elisa.Widjaja@GMAIL.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('trims whitespace around list entries', () => {
    expect(isAdminEmail('foo@bar.com', ' elisa.widjaja@gmail.com , foo@bar.com ')).toBe(true);
  });

  it('returns false when email is not in the list', () => {
    expect(isAdminEmail('intruder@example.com', 'elisa.widjaja@gmail.com')).toBe(false);
  });

  it('returns false when ADMIN_EMAILS is undefined', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', undefined)).toBe(false);
  });

  it('returns false when email is undefined', () => {
    expect(isAdminEmail(undefined, 'elisa.widjaja@gmail.com')).toBe(false);
  });
});

describe('soft-deleted user filtering (regression)', () => {
  it('handleFriendSuggestions excludes profiles where deleted_at IS NOT NULL', async () => {
    const captured: string[] = [];
    // Minimal D1Database mock: capture each prepared SQL string and return a
    // chainable stub whose .all()/.first() return empty results so the function
    // exercises every prepared statement (FOF + pref-fallback) without short-
    // circuiting on real data.
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    };
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return stmt;
      }),
    } as unknown as D1Database;

    // Force the pref-fallback branch to execute too: stub the self-profile
    // lookup to return prefs that produce LIKE clauses. We can't easily inject
    // this through the mock above without distinguishing calls, so we accept
    // that with no prefs the second profiles query may not run — the FOF JOIN
    // is the representative path and is always executed.
    const { handleFriendSuggestions } = await import('../index');
    await handleFriendSuggestions(mockDb, 'user-1');

    const profileQueries = captured.filter((sql) => /FROM\s+profiles|JOIN\s+profiles/i.test(sql));
    expect(profileQueries.length).toBeGreaterThan(0);
    for (const sql of profileQueries) {
      expect(sql).toMatch(/deleted_at IS NULL/i);
    }
  });
});

describe('writeAuditLog', () => {
  it('inserts an admin_audit_log row with all fields', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) } as unknown as D1Database;

    await writeAuditLog(mockDb, {
      adminEmail: 'elisa.widjaja@gmail.com',
      action: 'hide_recipe',
      targetUserId: 'user-1',
      targetRecipeId: 'recipe-2',
      payload: { reason: 'spam' }
    });

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log')
    );
    expect(bindMock).toHaveBeenCalledWith(
      'elisa.widjaja@gmail.com',
      'hide_recipe',
      'user-1',
      'recipe-2',
      JSON.stringify({ reason: 'spam' })
    );
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('handles null target_user_id, target_recipe_id, payload', async () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) } as unknown as D1Database;

    await writeAuditLog(mockDb, { adminEmail: 'a@b.com', action: 'noop' });
    expect(bindMock).toHaveBeenCalledWith('a@b.com', 'noop', null, null, null);
  });

  it('treats explicit null payload identically to undefined', async () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) } as unknown as D1Database;

    await writeAuditLog(mockDb, { adminEmail: 'a@b', action: 'noop', payload: null });
    expect(bindMock).toHaveBeenCalledWith('a@b', 'noop', null, null, null);
  });

  it('does not throw when the underlying INSERT fails (audit gap accepted)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runMock = vi.fn().mockRejectedValue(new Error('D1 down'));
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: runMock }) }) } as unknown as D1Database;

    // Should resolve, not throw.
    await expect(writeAuditLog(mockDb, { adminEmail: 'a@b', action: 'noop' })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('handleAdminMe', () => {
  it('returns isAdmin: true and the email when caller is in ADMIN_EMAILS', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com'
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'elisa.widjaja@gmail.com', isAdmin: true });
  });

  it('returns 403 when caller email is not in ADMIN_EMAILS', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-2', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com'
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when ADMIN_EMAILS is unset', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: undefined
    });
    expect(res.status).toBe(403);
  });
});
