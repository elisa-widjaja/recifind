import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdminEmail } from './admin';
import { writeAuditLog } from './admin';
import { handleAdminMe } from './admin';
import { buildUsersListQuery, buildUserCountsQuery, computeUserCounts, handleAdminUserCounts, USER_COUNTS_KV_KEY } from './admin';
import { syncAdminUserStats, fetchAllSupabaseLastSignIn } from './admin';
import { buildSignupsPerDayQuery, buildViralCoefWeeklyQuery, buildGrowthCountersQuery, buildRetentionCohortsQuery, METRICS_EXCLUDED_EMAILS, buildWeeklySignupsActivationQuery, buildWeeklySavesQuery, launchWeeks, LAUNCH_DATE, buildSeedFunnelQuery, SEED_SHELF_LAUNCH, handleAdminSeedConversions } from './admin';
import { buildRecipeSearchQuery } from './admin';
import { deriveImageStatus } from './admin';

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
    // exercises every prepared statement (sent-requests lookup, FOF query, and
    // seed-tier fallback) without short-circuiting on real data.
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

    // Both the FOF query and the seed-tier fallback run because FOF returns
    // empty results (< 5), which triggers the seed query (resolves founder /
    // top-contributor accounts by email). Both queries include deleted_at IS
    // NULL, so the assertion below covers both paths.
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
  it('joins admin_user_stats with no GROUP BY and no recipes/invites_sent', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/LEFT JOIN admin_user_stats s ON s\.user_id = p\.user_id/i);
    expect(sql).not.toMatch(/GROUP BY/i);
    expect(sql).not.toMatch(/LEFT JOIN recipes/i);
    expect(sql).not.toMatch(/invites_sent/i);
    expect(sql).toMatch(/COALESCE\(s\.recipe_count, 0\) AS recipe_count/i);
    expect(sql).toMatch(/COALESCE\(s\.friends_count, 0\) AS invites_accepted/i);
    expect(sql).toMatch(/s\.last_sign_in_at AS last_sign_in_at/i);
    expect(sql).toMatch(/AS is_active/i);
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)/i);
  });

  it('default excludes soft-deleted and paginates', () => {
    const { sql, params } = buildUsersListQuery({ limit: 25, offset: 50 });
    expect(sql).toMatch(/p\.deleted_at IS NULL/i);
    expect(sql).toMatch(/LIMIT \? OFFSET \?/i);
    expect(params).toEqual([25, 50]);
  });

  it('search adds a LIKE clause with two params before limit/offset', () => {
    const { params } = buildUsersListQuery({ limit: 50, offset: 0, search: 'ann' });
    expect(params).toEqual(['%ann%', '%ann%', 50, 0]);
  });

  it('recipeBucket filters on COALESCE(s.recipe_count,0)', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '10-19' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) BETWEEN 10 AND 19/i);
  });

  it('activity=active filters by the is-active expression', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'active' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) >= 1/i);
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)/i);
  });

  it('activity=ghost filters by recipe_count 0 and not-came-back', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'ghost' });
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) = 0/i);
    expect(sql).toMatch(/5\.0\/1440\.0/);
  });

  it('activity=soft_deleted selects deleted rows', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'soft_deleted' });
    expect(sql).toMatch(/p\.deleted_at IS NOT NULL/i);
  });
});

describe('buildRecipeSearchQuery', () => {
  it('binds the title as a LIKE param', () => {
    const { sql, params } = buildRecipeSearchQuery({ q: 'pad thai', limit: 1000 });
    expect(sql).toMatch(/r\.title LIKE \?/i);
    expect(params[0]).toBe('%pad thai%');
  });

  it('joins profiles for owner identity', () => {
    const { sql } = buildRecipeSearchQuery({ q: 'x', limit: 1000 });
    expect(sql).toMatch(/LEFT JOIN profiles p ON p\.user_id = r\.user_id/i);
    expect(sql).toMatch(/p\.email\s+AS\s+owner_email/i);
  });

  it('selects the fields the page needs (id, source_url, created_at, hidden_at, shared_with_friends)', () => {
    const { sql } = buildRecipeSearchQuery({ q: 'x', limit: 1000 });
    for (const col of ['r.id', 'r.source_url', 'r.created_at', 'r.hidden_at', 'r.shared_with_friends']) {
      expect(sql).toContain(col);
    }
  });

  it('passes the limit as the last bound param', () => {
    const { params } = buildRecipeSearchQuery({ q: 'x', limit: 1000 });
    expect(params[params.length - 1]).toBe(1000);
  });
});

describe('handleAdminSearchRecipes', () => {
  it('returns 403 for non-admin', async () => {
    const { handleAdminSearchRecipes } = await import('./admin');
    const res = await handleAdminSearchRecipes({
      env: { DB: {} as any },
      user: { userId: 'u', email: 'intruder@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/recipes/search?q=pad'),
    });
    expect(res.status).toBe(403);
  });

  it('returns empty groups for a blank query without hitting the DB', async () => {
    const { handleAdminSearchRecipes } = await import('./admin');
    const db = { prepare: vi.fn() } as unknown as D1Database;
    const res = await handleAdminSearchRecipes({
      env: { DB: db },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/recipes/search?q=%20'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [], page: { returned: 0, has_more: false } });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('groups copies that share a source_url and lists every owner', async () => {
    const { handleAdminSearchRecipes } = await import('./admin');
    const rows = [
      { id: 'r1', user_id: 'u1', title: 'Pad Thai', source_url: 'https://x/pad', created_at: '2026-01-01', hidden_at: null, shared_with_friends: 1, owner_email: 'a@x.com', owner_display_name: 'Ann' },
      { id: 'r2', user_id: 'u2', title: 'Pad Thai', source_url: 'https://x/pad', created_at: '2026-02-01', hidden_at: '2026-03-01', shared_with_friends: 1, owner_email: 'b@x.com', owner_display_name: null },
      { id: 'r3', user_id: 'u3', title: 'Soup', source_url: '', created_at: '2026-01-15', hidden_at: null, shared_with_friends: 0, owner_email: 'c@x.com', owner_display_name: 'Cara' },
    ];
    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: rows }) }) }) } as unknown as D1Database;
    const res = await handleAdminSearchRecipes({
      env: { DB: db },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/recipes/search?q=a'),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.groups).toHaveLength(2);
    // Most-saved first: the 2-owner Pad Thai group.
    const padThai = body.groups[0];
    expect(padThai.title).toBe('Pad Thai');
    expect(padThai.owner_count).toBe(2);
    expect(padThai.hidden_count).toBe(1);
    expect(padThai.owners.map((o: any) => o.user_id).sort()).toEqual(['u1', 'u2']);
    // user-typed recipe (no source_url) groups by title and stays its own group.
    const soup = body.groups[1];
    expect(soup.source_url).toBeNull();
    expect(soup.owner_count).toBe(1);
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
    // New call order: profile.first, recipes.all, cook_events.all, conversions.all, inviteLink.first, pending_received.all, shares.all
    const shares = [{ recipe_id: 'r1', created_at: 1738368000000, recipient_id: 'inv1', recipe_title: 'Pie', recipe_source_url: null, recipient_name: 'Inv' }];
    const stubs = [profile, { results: recipes }, { results: cookEvents }, { results: conversions }, inviteLink, { results: pendingReceived }, { results: shares }];
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
    expect(body.shares).toHaveLength(1);
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
      { results: [] }, // shares .all()
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

  it('cook events query inner-JOINs recipes on id AND user_id (excludes deleted recipes, no fan-out)', async () => {
    const captured: string[] = [];
    let callIdx = 0;
    const stubs = [
      { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null }, // profile .first()
      { results: [] }, // recipes .all()
      { results: [] }, // cook_events .all()
      { results: [] }, // conversions .all()
      { token: 'tok', created_at: '2026-02-01' }, // invite link .first()
      { results: [] }, // pending received .all()
      { results: [] }, // shares .all()
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
    expect(cookSql).toMatch(/\bJOIN recipes/i);
    expect(cookSql).not.toMatch(/LEFT JOIN recipes/i);
    expect(cookSql).toMatch(/r\.id\s*=\s*ce\.recipe_id\s+AND\s+r\.user_id\s*=\s*ce\.user_id/i);
    expect(cookSql).toMatch(/r\.title AS recipe_title/i);
    expect(cookSql).toMatch(/r\.source_url AS recipe_source_url/i);
  });

  it('shares query joins recipes by id alone so re-shares resolve a title (not constrained to sharer)', async () => {
    const captured: string[] = [];
    let callIdx = 0;
    const stubs = [
      { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null }, // profile .first
      { results: [] }, // recipes .all
      { results: [] }, // cook_events .all
      { results: [] }, // conversions .all
      { token: 'tok', created_at: '2026-02-01' }, // invite link .first
      { results: [] }, // pending received .all
      { results: [] }, // shares .all
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
    const sharesSql = captured.find((s) => /FROM recipe_shares/i.test(s));
    expect(sharesSql).toBeDefined();
    expect(sharesSql).toMatch(/LEFT JOIN recipes r ON r\.id = rs\.recipe_id/i);
    expect(sharesSql).not.toMatch(/r\.user_id\s*=\s*rs\.sharer_id/i);
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
      { results: [] }, // shares .all
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

const EXCL = ['a@x.com', 'b@x.com', 'c@x.com'];

describe('buildGrowthCountersQuery', () => {
  it('classifies new vs re-saves via a friend_saved_your_recipe notification match and excludes accounts', () => {
    const { sql, params } = buildGrowthCountersQuery(7, EXCL);
    expect(sql).toMatch(/friend_saved_your_recipe/);
    expect(sql).toMatch(/json_extract\(n\.data, ?'\$\.recipeId'\) ?= ?r\.id/i);
    expect(sql).toMatch(/json_extract\(n\.data, ?'\$\.saverId'\) ?= ?r\.user_id/i);
    expect(sql).toMatch(/datetime\(c\.signup_at, '\+1 day'\)/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/WITH excluded AS/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    expect(params).toHaveLength(5);
    expect(params.slice(0, 3)).toEqual(EXCL);
  });

  it('defaults to no exclusions when none provided', () => {
    const { params } = buildGrowthCountersQuery(7);
    expect(params).toHaveLength(2);
  });

  it('ships a non-empty default exclusion list', () => {
    expect(METRICS_EXCLUDED_EMAILS).toContain('elisa.widjaja@gmail.com');
    // Seeded suggestion accounts must stay excluded so founder/top-contributor
    // connections don't inflate the has_friends activation segment.
    expect(METRICS_EXCLUDED_EMAILS).toContain('mochislime02@gmail.com');
  });
});

describe('buildRetentionCohortsQuery', () => {
  it('groups signups by day from the given anchor, counts later-day returners, excludes accounts', () => {
    const { sql, params } = buildRetentionCohortsQuery('2026-05-26', EXCL);
    expect(sql).toMatch(/GROUP BY c\.day/i);
    expect(sql).toMatch(/ORDER BY c\.day DESC/i);
    expect(sql).toMatch(/DATE\(r\.created_at\) > c\.day/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/WITH excluded AS/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    expect(params).toHaveLength(4);
    expect(params.slice(0, 3)).toEqual(EXCL);
    expect(params[3]).toBe('2026-05-26');
  });
});

describe('buildWeeklySignupsActivationQuery', () => {
  it('buckets signups + 24h activation by week-since-launch, excludes accounts', () => {
    const { sql, params } = buildWeeklySignupsActivationQuery('2026-05-26', EXCL);
    expect(sql).toMatch(/julianday\(created_at\) - julianday\(\?\)/i); // anchored week index
    expect(sql).toMatch(/datetime\(c\.signup_at, '\+1 day'\)/i);
    expect(sql).toMatch(/GROUP BY c\.week_idx/i);
    expect(sql).toMatch(/ORDER BY c\.week_idx ASC/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    // 3 excluded emails + anchor (week index) + anchor (since filter)
    expect(params).toHaveLength(5);
    expect(params.slice(0, 3)).toEqual(EXCL);
    expect(params.slice(3)).toEqual(['2026-05-26', '2026-05-26']);
  });
});

describe('buildWeeklySavesQuery', () => {
  it('buckets new vs re-saves by week-since-launch via notifications, excludes accounts', () => {
    const { sql, params } = buildWeeklySavesQuery('2026-05-26', EXCL);
    expect(sql).toMatch(/friend_saved_your_recipe/);
    expect(sql).toMatch(/julianday\(r\.created_at\) - julianday\(\?\)/i);
    expect(sql).toMatch(/GROUP BY week_idx/i);
    expect(sql).toMatch(/ORDER BY week_idx ASC/i);
    expect(sql).toMatch(/user_id NOT IN \(SELECT user_id FROM excluded\)/i);
    expect(params).toHaveLength(5);
    expect(params.slice(0, 3)).toEqual(EXCL);
    expect(params.slice(3)).toEqual(['2026-05-26', '2026-05-26']);
  });
});

describe('launchWeeks', () => {
  it('starts at the launch anchor, 7 days apart, at least minWeeks', () => {
    const ws = launchWeeks('2026-05-26', 4);
    expect(ws.length).toBeGreaterThanOrEqual(4);
    expect(ws[0]).toEqual({ idx: 0, week: '2026-05-26' });
    expect(ws[1].week).toBe('2026-06-02');
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i].idx).toBe(i);
      const gap = (new Date(ws[i].week + 'T00:00:00Z').getTime() - new Date(ws[i - 1].week + 'T00:00:00Z').getTime()) / 86400000;
      expect(gap).toBe(7);
    }
  });

  it('exposes the launch date constant', () => {
    expect(LAUNCH_DATE).toBe('2026-05-26');
  });
});

import { handleAdminMetricsTimeseries } from './admin';

describe('handleAdminMetricsTimeseries growth block', () => {
  it('returns three windows and a retention table with computed percentages', async () => {
    const counterRow = { signups: 33, activated_24h: 21, new_saves: 40, re_saves: 7, total_users: 33, total_recipes: 47, n: 30 };
    const arrayResult = { results: [{ day: '2026-05-28', cohort_size: 33, returned: 10 }] };
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(counterRow),
        all: vi.fn().mockResolvedValue(arrayResult),
      }),
    } as unknown as D1Database;

    const res = await handleAdminMetricsTimeseries({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/metrics/timeseries?days=90'),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.growth.windows)).toEqual(['1d', '7d', '30d']);
    const w = body.growth.windows['7d'];
    expect(w.signups).toBe(33);
    expect(w.activated_24h).toBe(21);
    expect(w.activated_pct).toBe(63.6);
    expect(w.new_saves).toBe(40);
    expect(w.re_saves).toBe(7);
    expect(body.growth.retention_cohorts[0]).toEqual({
      day: '2026-05-28', cohort_size: 33, returned: 10, returned_pct: 30.3,
    });
  });

  it('denies non-admins', async () => {
    const res = await handleAdminMetricsTimeseries({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/metrics/timeseries'),
    });
    expect(res.status).toBe(403);
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

describe('deriveImageStatus', () => {
  it("returns 'none' for empty, null, undefined, or whitespace", () => {
    expect(deriveImageStatus('')).toBe('none');
    expect(deriveImageStatus(null)).toBe('none');
    expect(deriveImageStatus(undefined)).toBe('none');
    expect(deriveImageStatus('   ')).toBe('none');
  });

  it("returns 'hosted' for a Supabase public storage URL", () => {
    expect(
      deriveImageStatus(
        'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/preview/u/r/x.jpg'
      )
    ).toBe('hosted');
  });

  it("returns 'stale' for an external CDN URL", () => {
    expect(
      deriveImageStatus('https://scontent-sjc6-1.cdninstagram.com/v/t51.jpg?oh=abc&oe=def')
    ).toBe('stale');
  });
});

describe('buildRecipeSearchQuery image_url', () => {
  it('selects r.image_url so image status can be derived', () => {
    const { sql } = buildRecipeSearchQuery({ q: 'pie', limit: 10 });
    expect(sql).toContain('r.image_url');
  });
});

describe('syncAdminUserStats', () => {
  function mockDb(captured) {
    const prepare = vi.fn((sql) => ({
      bind: (...args) => ({ __sql: sql, __args: args }),
      all: vi.fn().mockImplementation(() => {
        if (/FROM recipes/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1', n: 3 }] });
        if (/FROM friends/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1', n: 2 }] });
        if (/FROM profiles/i.test(sql)) return Promise.resolve({ results: [{ user_id: 'u1' }, { user_id: 'u2' }] });
        return Promise.resolve({ results: [] });
      }),
    }));
    const batch = vi.fn((stmts) => { captured.push(...stmts); return Promise.resolve([]); });
    return { prepare, batch };
  }

  it('upserts one row per profile with merged counts + last_sign_in', async () => {
    const captured = [];
    const db = mockDb(captured);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [{ id: 'u1', last_sign_in_at: '2026-06-01T00:00:00Z' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await syncAdminUserStats({ DB: db, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });

    expect(res.users).toBe(2);
    const u1 = captured.find((s) => s.__args[0] === 'u1');
    const u2 = captured.find((s) => s.__args[0] === 'u2');
    expect(u1.__args.slice(0, 4)).toEqual(['u1', 3, 2, '2026-06-01T00:00:00Z']);
    expect(u2.__args.slice(0, 4)).toEqual(['u2', 0, 0, null]);
    expect(u1.__sql).toMatch(/last_sign_in_at=excluded\.last_sign_in_at/i);
    vi.unstubAllGlobals();
  });

  it('preserves existing last_sign_in_at when Supabase fetch fails', async () => {
    const captured = [];
    const db = mockDb(captured);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const res = await syncAdminUserStats({ DB: db, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });

    expect(res.users).toBe(2);
    const u1 = captured.find((s) => s.__args[0] === 'u1');
    expect(u1.__args.slice(0, 3)).toEqual(['u1', 3, 2]);
    expect(u1.__sql).not.toMatch(/last_sign_in_at=excluded/i);
    vi.unstubAllGlobals();
  });
});

describe('fetchAllSupabaseLastSignIn', () => {
  it('returns empty map without a service role key (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const m = await fetchAllSupabaseLastSignIn({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(m.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('handleAdminUsersList (denormalized)', () => {
  it('returns joined rows without making any Supabase calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const rows = [
      { id: 'u1', email: 'a@x.com', display_name: 'A', signed_up_at: '2026-05-01', deleted_at: null,
        recipe_count: 5, invites_accepted: 2, last_sign_in_at: '2026-06-01T00:00:00Z', is_active: 1 },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: rows }) }),
    } as unknown as D1Database;

    const { handleAdminUsersList } = await import('./admin');
    const res = await handleAdminUsersList({
      env: { DB: mockDb, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('https://x/admin/users?limit=1'),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].recipe_count).toBe(5);
    expect(body.page.has_more).toBe(true); // returned (1) === limit (1)
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('handleAdminUserDrilldown last_sign_in', () => {
  it('surfaces a live last_sign_in_at on the profile when a key is set', async () => {
    const stubs = [
      { user_id: 'u1', email: 'a@x.com', display_name: 'A', created_at: '2026-01-01', deleted_at: null }, // profile.first
      { results: [] }, // recipes
      { results: [] }, // cook_events
      { results: [] }, // conversions
      null,            // invite link .first
      { results: [] }, // pending_received
      { results: [] }, // shares
    ];
    let i = 0;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => Promise.resolve(stubs[i++])),
        all: vi.fn().mockImplementation(() => Promise.resolve(stubs[i++])),
      }),
    } as unknown as D1Database;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ last_sign_in_at: '2026-06-02T10:00:00Z' }) }));

    const { handleAdminUserDrilldown } = await import('./admin');
    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'u1',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.last_sign_in_at).toBe('2026-06-02T10:00:00Z');
    vi.unstubAllGlobals();
  });
});

describe('buildUserCountsQuery', () => {
  it('aggregates over profiles LEFT JOIN admin_user_stats with no GROUP BY', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/FROM profiles p/i);
    expect(sql).toMatch(/LEFT JOIN admin_user_stats s ON s\.user_id = p\.user_id/i);
    expect(sql).not.toMatch(/GROUP BY/i);
  });

  it('counts total (non-deleted) and soft_deleted separately', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/SUM\(CASE WHEN p\.deleted_at IS NULL THEN 1 ELSE 0 END\) AS total/i);
    expect(sql).toMatch(/SUM\(CASE WHEN p\.deleted_at IS NOT NULL THEN 1 ELSE 0 END\) AS soft_deleted/i);
  });

  it('counts every recipe bucket scoped to non-deleted', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) = 0 THEN 1 ELSE 0 END\) AS r0/i);
    expect(sql).toMatch(/BETWEEN 1 AND 9 THEN 1 ELSE 0 END\) AS r1_9/i);
    expect(sql).toMatch(/BETWEEN 10 AND 19 THEN 1 ELSE 0 END\) AS r10_19/i);
    expect(sql).toMatch(/BETWEEN 20 AND 49 THEN 1 ELSE 0 END\) AS r20_49/i);
    expect(sql).toMatch(/COALESCE\(s\.recipe_count,0\) >= 50 THEN 1 ELSE 0 END\) AS r50p/i);
  });

  it('counts activity buckets reusing the active + ghost expressions', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/julianday\(s\.last_sign_in_at\) >= julianday\('now','-30 days'\)[\s\S]*AS active/i);
    expect(sql).toMatch(/5\.0\/1440\.0[\s\S]*AS ghost/i);
    expect(sql).toMatch(/AS inactive/i);
  });

  it('counts cumulative signup windows (non-deleted)', () => {
    const sql = buildUserCountsQuery();
    expect(sql).toMatch(/julianday\('now','-1 days'\)[\s\S]*AS d1/i);
    expect(sql).toMatch(/julianday\('now','-7 days'\)[\s\S]*AS d7/i);
    expect(sql).toMatch(/julianday\('now','-30 days'\)[\s\S]*AS d30/i);
    expect(sql).toMatch(/julianday\('now','-90 days'\)[\s\S]*AS d90/i);
  });
});

describe('computeUserCounts', () => {
  function mockDbReturning(row) {
    return {
      prepare: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(row),
      })),
    };
  }

  it('maps the aggregate row into the nested counts shape', async () => {
    const db = mockDbReturning({
      total: 1240, soft_deleted: 12,
      r0: 430, r1_9: 220, r10_19: 90, r20_49: 40, r50p: 8,
      active: 212, ghost: 430, inactive: 586,
      d1: 5, d7: 40, d30: 160, d90: 380,
    });
    const counts = await computeUserCounts({ DB: db });
    expect(counts.total).toBe(1240);
    expect(counts.recipes).toEqual({ '0': 430, '1-9': 220, '10-19': 90, '20-49': 40, '50+': 8 });
    expect(counts.activity).toEqual({ active: 212, inactive: 586, ghost: 430, soft_deleted: 12 });
    expect(counts.signup).toEqual({ '1': 5, '7': 40, '30': 160, '90': 380 });
    expect(typeof counts.computed_at).toBe('string');
  });

  it('coerces null/missing aggregate columns to 0', async () => {
    const db = mockDbReturning(null);
    const counts = await computeUserCounts({ DB: db });
    expect(counts.total).toBe(0);
    expect(counts.recipes['50+']).toBe(0);
    expect(counts.activity.soft_deleted).toBe(0);
    expect(counts.signup['90']).toBe(0);
  });
});

describe('handleAdminUserCounts', () => {
  const adminEmails = 'admin@example.com';
  const admin = { userId: 'a1', email: 'admin@example.com' };

  it('returns 403 for a non-admin without touching KV or DB', async () => {
    const env = { DB: {}, AI_PICKS_CACHE: { get: vi.fn(), put: vi.fn() } };
    const res = await handleAdminUserCounts({
      env, adminEmails, user: { userId: 'u1', email: 'nope@example.com' },
    });
    expect(res.status).toBe(403);
    expect(env.AI_PICKS_CACHE.get).not.toHaveBeenCalled();
  });

  it('serves the cached counts without hitting the DB', async () => {
    const cached = { total: 1240, recipes: {}, activity: {}, signup: {}, computed_at: 'x' };
    const env = {
      DB: { prepare: vi.fn() },
      AI_PICKS_CACHE: { get: vi.fn().mockResolvedValue(cached), put: vi.fn() },
    };
    const res = await handleAdminUserCounts({ env, adminEmails, user: admin });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(cached);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.AI_PICKS_CACHE.get).toHaveBeenCalledWith(USER_COUNTS_KV_KEY, { type: 'json' });
  });

  it('computes + caches on a cold cache', async () => {
    const env = {
      DB: { prepare: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ total: 7 }) })) },
      AI_PICKS_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
    };
    const res = await handleAdminUserCounts({ env, adminEmails, user: admin });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(env.AI_PICKS_CACHE.put).toHaveBeenCalledWith(
      USER_COUNTS_KV_KEY, expect.any(String), { expirationTtl: 6 * 60 * 60 }
    );
  });
});

describe('buildSeedFunnelQuery', () => {
  it('exposes the launch floor constant', () => {
    expect(SEED_SHELF_LAUNCH).toBe('2026-06-08');
  });

  it('builds the 3-step funnel with exclusions and per-subquery binds', () => {
    const { sql, params } = buildSeedFunnelQuery('seed-1', '2026-06-08', ['owner@x.com', 'test@x.com']);
    expect(sql).toContain('AS requestsPending');
    expect(sql).toContain('AS connections');
    expect(sql).toContain('AS activated');
    // requestsPending must exclude force-accepted rows (admin force-accept UPDATEs
    // status rather than deleting), else they'd double-count in connections too.
    expect(sql).toContain("fr.status = 'pending'");
    // each subquery floors on the launch param
    expect(sql).toContain('fr.created_at >= ?');
    expect(sql).toContain('f.connected_at >= ?');
    // activation = saved AFTER connecting
    expect(sql).toContain('r.created_at >= f.connected_at');
    // exclusion subselect present with one placeholder per excluded email
    expect(sql).toContain('email IN (?, ?)');
    // params: [seed, launch, ...excl] repeated once per subquery (3x)
    expect(params).toEqual([
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
      'seed-1', '2026-06-08', 'owner@x.com', 'test@x.com',
    ]);
  });

  it('degrades the exclusion filter to constant-false with no excludeEmails', () => {
    const { sql, params } = buildSeedFunnelQuery('seed-1', '2026-06-08', []);
    expect(sql).toContain('WHERE 0');
    expect(sql).not.toContain('email IN');
    expect(params).toEqual([
      'seed-1', '2026-06-08',
      'seed-1', '2026-06-08',
      'seed-1', '2026-06-08',
    ]);
  });
});
