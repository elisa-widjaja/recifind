import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdminEmail } from './admin';
import { writeAuditLog } from './admin';
import { handleAdminMe } from './admin';
import { buildUsersListQuery } from './admin';
import { buildSignupsPerDayQuery, buildViralCoefWeeklyQuery } from './admin';

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

describe('buildUsersListQuery', () => {
  it('returns SQL containing all expected aggregates', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/COUNT\(DISTINCT r\.id\)\s+AS\s+recipe_count/i);
    expect(sql).toMatch(/COUNT\(DISTINCT frs\.to_user_id\)\s+AS\s+invites_sent/i);
    expect(sql).toMatch(/COUNT\(DISTINCT f\.friend_id\)\s+AS\s+invites_accepted/i);
  });

  it('always includes deleted_at IS NULL filter', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/p\.deleted_at IS NULL/);
  });

  it('returns SQL including soft-deleted when activity=soft_deleted', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'soft_deleted' });
    expect(sql).toMatch(/p\.deleted_at IS NOT NULL/);
  });

  it('binds the search term as a LIKE param when provided', () => {
    const { sql, params } = buildUsersListQuery({ limit: 50, offset: 0, search: 'sarah' });
    expect(sql).toMatch(/email LIKE \?/i);
    expect(params).toContain('%sarah%');
  });

  it('applies recipe bucket filter for "0"', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '0' });
    expect(sql).toMatch(/HAVING\s+(\(.*\s)?recipe_count = 0/i);
  });

  it('applies recipe bucket filter for "10-19"', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '10-19' });
    expect(sql).toMatch(/recipe_count BETWEEN 10 AND 19/i);
  });

  it('applies signupAfter bound', () => {
    const { sql, params } = buildUsersListQuery({
      limit: 50, offset: 0, signupAfter: '2026-01-01'
    });
    expect(sql).toMatch(/p\.created_at >= \?/);
    expect(params).toContain('2026-01-01');
  });

  it('respects sort=signup_asc', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, sort: 'signup_asc' });
    expect(sql).toMatch(/ORDER BY p\.created_at ASC/i);
  });

  it('defaults to signup_desc', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/ORDER BY p\.created_at DESC/i);
  });
});

describe('handleAdminUsersList input validation', () => {
  it('returns 400 for invalid activity', async () => {
    const { handleAdminUsersList } = await import('./admin');
    const url = new URL('http://x/admin/users?activity=garbage');
    const res = await handleAdminUsersList({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid recipeBucket', async () => {
    const { handleAdminUsersList } = await import('./admin');
    const url = new URL('http://x/admin/users?recipeBucket=999');
    const res = await handleAdminUsersList({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url,
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 before validating params (security: never leak param shape to non-admins)', async () => {
    const { handleAdminUsersList } = await import('./admin');
    const url = new URL('http://x/admin/users?activity=garbage');
    const res = await handleAdminUsersList({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u', email: 'intruder@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url,
    });
    expect(res.status).toBe(403);
  });
});

import { handleAdminUserDrilldown } from './admin';

describe('handleAdminUserDrilldown', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminUserDrilldown({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target-user',
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when user not found', async () => {
    const firstMock = vi.fn().mockResolvedValue(null);
    const allMock = vi.fn().mockResolvedValue({ results: [] });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: firstMock,
        all: allMock,
      }),
    } as unknown as D1Database;

    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'missing-user',
    });
    expect(res.status).toBe(404);
  });

  it('returns full payload for an existing user', async () => {
    const profile = { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null };
    const recipes = [{ id: 'r1', title: 'Pie', created_at: '2026-02-01', hidden_at: null }];
    const cookEvents = [{ recipe_id: 'r1', created_at: '2026-02-02' }];
    const conversions = [{ invitee_user_id: 'inv1', invitee_email: 'inv@x.com', invitee_name: 'Inv', accepted_at: '2026-01-15', invitee_deleted_at: null, status: 'accepted', invitee_recipe_count: 2 }];
    const inviteLink = { token: 'tok-abc', created_at: '2026-01-10' };
    const pendingReceived = [{ from_user_id: 'src1', from_email: 's@x.com', created_at: '2026-02-10' }];

    let callIdx = 0;
    // New call order: profile.first, recipes.all, cook_events.all, conversions.all, inviteLink.first, pending_received.all
    const stubs = [profile, { results: recipes }, { results: cookEvents }, { results: conversions }, inviteLink, { results: pendingReceived }];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
        all: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
      }),
    } as unknown as D1Database;

    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.email).toBe('t@x.com');
    expect(body.recipes).toHaveLength(1);
    expect(Array.isArray(body.invite_conversions)).toBe(true);
    expect(body.invite_conversions).toHaveLength(1);
    expect(body.invite_link).toEqual({ token: 'tok-abc', created_at: '2026-01-10' });
    expect(body.pending_received).toHaveLength(1);
  });

  it('queries cook_events by cooked_at (not a nonexistent created_at column)', async () => {
    const captured: string[] = [];
    let callIdx = 0;
    const stubs = [
      { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null }, // profile .first()
      { results: [] }, // recipes .all()
      { results: [] }, // cook_events .all()
      { results: [] }, // conversions .all()
      { token: 'tok', created_at: '2026-02-01' }, // invite link .first()
      { results: [] }, // pending received .all()
    ];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
          all: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
        };
      }),
    } as unknown as D1Database;

    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target',
    });
    expect(res.status).toBe(200);
    const cookSql = captured.find((s) => /FROM cook_events/i.test(s));
    expect(cookSql).toBeDefined();
    expect(cookSql).toMatch(/cooked_at/i);
    expect(cookSql).not.toMatch(/SELECT\s+recipe_id,\s*created_at\s+FROM cook_events/i);
  });

  it('cook events query LEFT JOINs recipes on id AND user_id to resolve title (no fan-out)', async () => {
    const captured: string[] = [];
    let callIdx = 0;
    const stubs = [
      { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null }, // profile .first()
      { results: [] }, // recipes .all()
      { results: [] }, // cook_events .all()
      { results: [] }, // conversions .all()
      { token: 'tok', created_at: '2026-02-01' }, // invite link .first()
      { results: [] }, // pending received .all()
    ];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
          all: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
        };
      }),
    } as unknown as D1Database;
    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target',
    });
    expect(res.status).toBe(200);
    const cookSql = captured.find((s) => /FROM cook_events/i.test(s));
    expect(cookSql).toBeDefined();
    expect(cookSql).toMatch(/LEFT JOIN recipes/i);
    expect(cookSql).toMatch(/r\.id\s*=\s*ce\.recipe_id\s+AND\s+r\.user_id\s*=\s*ce\.user_id/i);
    expect(cookSql).toMatch(/r\.title AS recipe_title/i);
  });

  it('invite conversions query reads open_invite_used joined to friends/profiles (not dormant friend_requests_sent)', async () => {
    const captured: string[] = [];
    let i = 0;
    const stubs = [
      { user_id:'t', email:'t@x.com', display_name:'T', created_at:'2026-01-01', deleted_at:null }, // profile .first
      { results: [] }, // recipes .all
      { results: [] }, // cook_events .all
      { results: [] }, // conversions .all
      { token:'tok', created_at:'2026-02-01' }, // invite link .first
      { results: [] }, // pending_received .all
    ];
    const mockDb = { prepare: vi.fn((sql:string)=>{ captured.push(sql); return {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(()=>Promise.resolve(stubs[i++])),
      all: vi.fn().mockImplementation(()=>Promise.resolve(stubs[i++])),
    };}) } as unknown as D1Database;
    const res = await handleAdminUserDrilldown({
      env:{ DB:mockDb, SUPABASE_URL:'', SUPABASE_SERVICE_ROLE_KEY:undefined },
      user:{ userId:'u', email:'elisa.widjaja@gmail.com' },
      adminEmails:'elisa.widjaja@gmail.com', userId:'t',
    });
    expect(res.status).toBe(200);
    const convSql = captured.find(s => /FROM open_invite_used/i.test(s));
    expect(convSql).toBeDefined();
    expect(convSql).toMatch(/LEFT JOIN friends/i);
    expect(convSql).toMatch(/LEFT JOIN profiles/i);
    expect(convSql).toMatch(/accepted_disconnected/i);
    expect(captured.some(s => /FROM open_invites WHERE inviter_user_id/i.test(s))).toBe(true);
    expect(captured.some(s => /FROM friend_requests_sent/i.test(s))).toBe(false); // dormant table no longer used
    const body = await res.json();
    expect(Array.isArray(body.invite_conversions)).toBe(true);
    expect(body.invite_link).toEqual({ token:'tok', created_at:'2026-02-01' });
  });
});

describe('buildSignupsPerDayQuery', () => {
  it('groups by date and applies a since-date filter', () => {
    const { sql, params } = buildSignupsPerDayQuery(90);
    expect(sql).toMatch(/GROUP BY DATE\(created_at\)/i);
    expect(sql).toMatch(/created_at >= \?/);
    expect(params).toHaveLength(1);
  });
});

describe('buildViralCoefWeeklyQuery', () => {
  it('produces SQL with weekly buckets', () => {
    const { sql } = buildViralCoefWeeklyQuery(90);
    expect(sql).toMatch(/strftime\('%Y-%W', /i);
  });
});

import { handleAdminResendInvite } from './admin';

describe('handleAdminResendInvite', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminResendInvite({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if invite does not exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
      }),
    } as unknown as D1Database;
    const res = await handleAdminResendInvite({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'missing' },
    });
    expect(res.status).toBe(404);
  });

  it('writes an audit log entry on success', async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const firstMock = vi.fn().mockResolvedValue({ to_email: 'invitee@x.com' });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: firstMock, run: runMock,
      }),
    } as unknown as D1Database;
    const emailSends: any[] = [];
    const res = await handleAdminResendInvite({
      env: { DB: mockDb, RESEND_API_KEY: 're_test' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
      sendEmail: async (params: any) => { emailSends.push(params); return { ok: true }; },
    });
    expect(res.status).toBe(200);
    expect(emailSends).toHaveLength(1);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'));
  });

  it('looks up invitee email by joining profiles (not a bogus friend_requests_sent.to_email column)', async () => {
    const captured: string[] = [];
    const firstMock = vi.fn().mockResolvedValue({ to_email: 'invitee@x.com' });
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return { bind: vi.fn().mockReturnThis(), first: firstMock, run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminResendInvite({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
      sendEmail: async () => ({ ok: true }),
    });
    expect(res.status).toBe(200);
    const lookupSql = captured.find((s) => /friend_requests_sent/i.test(s));
    expect(lookupSql).toBeDefined();
    expect(lookupSql).toMatch(/JOIN profiles/i);
    expect(lookupSql).not.toMatch(/SELECT\s+to_email\s+FROM\s+friend_requests_sent/i);
  });

  it('returns 502 and logs resend_invite_failed when the email send fails', async () => {
    const captured: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ to_email: 'x@y.com' }), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminResendInvite({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
      sendEmail: async () => ({ ok: false }),
    });
    expect(res.status).toBe(502);
  });
});

import { handleAdminForceAccept } from './admin';

describe('handleAdminForceAccept', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminForceAccept({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if friend_request not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;
    const res = await handleAdminForceAccept({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'missing' },
    });
    expect(res.status).toBe(404);
  });

  it('inserts bilateral friend rows on success and audit logs', async () => {
    const calls: string[] = [];
    const firstMock = vi.fn()
      .mockResolvedValueOnce({
        to_user_id: 't', from_user_id: 'src',
        from_email: 's@x.com', from_name: 'Src', to_email: 't@x.com',
      })
      .mockResolvedValue({ display_name: 'Target' });
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), first: firstMock, run: vi.fn().mockResolvedValue({}) };
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;

    const res = await handleAdminForceAccept({
      env: { DB: mockDb } as any,
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'src' },
    });
    expect(res.status).toBe(200);
    const inserts = calls.filter((s) => /INSERT OR IGNORE INTO friends/i.test(s));
    expect(inserts.length).toBe(2); // bilateral
    expect(calls.some((s) => /INSERT INTO admin_audit_log/i.test(s))).toBe(true);
  });

  it('uses INSERT OR IGNORE and batches the writes (idempotent force-accept)', async () => {
    const calls: string[] = [];
    const firstMock = vi.fn()
      .mockResolvedValueOnce({ to_user_id: 't', from_user_id: 'src', from_email: 's@x.com', from_name: 'Src', to_email: 't@x.com' })
      .mockResolvedValue({ display_name: 'Target' });
    const mockDb = {
      prepare: vi.fn((sql: string) => { calls.push(sql); return { bind: vi.fn().mockReturnThis(), first: firstMock, run: vi.fn().mockResolvedValue({}) }; }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;
    const res = await handleAdminForceAccept({
      env: { DB: mockDb } as any,
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'src' },
    });
    expect(res.status).toBe(200);
    expect((mockDb as any).batch).toHaveBeenCalledOnce();
    const insertSqls = calls.filter((s) => /INSERT OR IGNORE INTO friends/i.test(s));
    expect(insertSqls.length).toBe(2);
  });
});

import { handleAdminMagicLink } from './admin';

describe('handleAdminMagicLink', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 403 for non-admin', async () => {
    const res = await handleAdminMagicLink({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if user not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;
    const res = await handleAdminMagicLink({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'missing',
    });
    expect(res.status).toBe(404);
  });

  it('calls Supabase generateLink and returns the URL', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ email: 't@x.com' }),
        run: vi.fn().mockResolvedValue({}),
      }),
    } as unknown as D1Database;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ properties: { action_link: 'https://example.com/magiclink-abc' } }),
    }) as any;

    const res = await handleAdminMagicLink({
      env: { DB: mockDb, SUPABASE_URL: 'https://sb.example.com', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('magiclink');
  });
});

import { handleAdminEditUser } from './admin';

describe('handleAdminEditUser', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminEditUser({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: 'X' },
    });
    expect(res.status).toBe(403);
  });

  it('updates display_name and audit logs', async () => {
    const captured: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ display_name: 'OldName' }),
          run: vi.fn().mockResolvedValue({}),
        };
      }),
    } as unknown as D1Database;
    const res = await handleAdminEditUser({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: 'NewName' },
    });
    expect(res.status).toBe(200);
    expect(captured.some((s) => /UPDATE profiles SET display_name/i.test(s))).toBe(true);
    expect(captured.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });

  it('returns 400 for empty display_name', async () => {
    const mockDb = { prepare: vi.fn() } as unknown as D1Database;
    const res = await handleAdminEditUser({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: '' },
    });
    expect(res.status).toBe(400);
  });
});

import { handleAdminSoftDelete } from './admin';

describe('handleAdminSoftDelete', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminSoftDelete({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(403);
  });

  it('sets deleted_at and audit logs', async () => {
    const calls: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminSoftDelete({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(200);
    expect(calls.some((s) => /UPDATE profiles SET deleted_at/i.test(s))).toBe(true);
    expect(calls.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });
});

import { handleAdminHideRecipe } from './admin';

describe('handleAdminHideRecipe', () => {
  it('403 for non-admin', async () => {
    const res = await handleAdminHideRecipe({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1', body: {},
    });
    expect(res.status).toBe(403);
  });

  it('updates hidden_at and audit logs', async () => {
    const calls: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminHideRecipe({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1', body: { reason: 'nsfw' },
    });
    expect(res.status).toBe(200);
    expect(calls.some((s) => /UPDATE recipes SET hidden_at/i.test(s))).toBe(true);
    expect(calls.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });
});

import { handleAdminUnhideRecipe } from './admin';

describe('handleAdminUnhideRecipe', () => {
  it('403 for non-admin', async () => {
    const res = await handleAdminUnhideRecipe({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1',
    });
    expect(res.status).toBe(403);
  });

  it('clears hidden_at and audit logs', async () => {
    const calls: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminUnhideRecipe({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1',
    });
    expect(res.status).toBe(200);
    expect(calls.some((s) => /UPDATE recipes SET hidden_at = NULL/i.test(s))).toBe(true);
    expect(calls.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });
});

import { handleAdminAuditLog } from './admin';

describe('handleAdminAuditLog', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminAuditLog({
      env: { DB: {} as any },
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/audit-log'),
    });
    expect(res.status).toBe(403);
  });

  it('returns paginated entries', async () => {
    const allMock = vi.fn().mockResolvedValue({ results: [
      { id: 1, admin_email: 'a@b', action: 'hide_recipe', target_user_id: null, target_recipe_id: 'r1', payload: '{}', created_at: '2026-05-14' },
    ]});
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), all: allMock }) } as unknown as D1Database;
    const res = await handleAdminAuditLog({
      env: { DB: mockDb },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/audit-log?limit=10&offset=0'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });
});
