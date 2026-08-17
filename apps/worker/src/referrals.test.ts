import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  selectWinners, buildRewardAdminEmail,
  REFERRAL_FRIENDS_REQUIRED, REFERRAL_RECIPES_REQUIRED,
  isRewardTick, REFERRAL_TICK_HOUR_UTC, buildWinnerNotification, buildPromoNotification,
  runReferralRewards, shapeProgress, shouldShowReferralDialog,
  type ReferralRow,
} from './referrals';

// vitest intercepts dynamic imports too, so mocking these modules here covers
// the `await import(...)` calls inside runReferralRewards.
vi.mock('./index', () => ({
  sendEmailNotification: vi.fn(),
}));
vi.mock('./push/apns', () => ({
  sendPushToUser: vi.fn(),
}));
vi.mock('./routes/admin', () => ({
  METRICS_EXCLUDED_EMAILS: ['elisa.widjaja@gmail.com'],
}));

import { sendEmailNotification } from './index';
import { sendPushToUser } from './push/apns';

const row = (over: Partial<ReferralRow>): ReferralRow => ({
  inviter_user_id: 'inv-1', inviter_email: 'inv@example.com', inviter_name: 'Inga',
  accepter_name: 'Ana', accepter_recipes: 5, ...over,
});

describe('selectWinners', () => {
  it('grants when 3 referred friends each have >= 5 recipes', () => {
    const rows = [
      row({ accepter_name: 'Ana' }),
      row({ accepter_name: 'Ben', accepter_recipes: 7 }),
      row({ accepter_name: 'Cal', accepter_recipes: 5 }),
    ];
    const w = selectWinners(rows, []);
    expect(w).toHaveLength(1);
    expect(w[0].userId).toBe('inv-1');
    expect(w[0].qualifiedFriends.map(f => f.name)).toEqual(['Ana', 'Ben', 'Cal']);
  });

  it('does not grant with 3 friends when only 2 are qualified', () => {
    const rows = [row({}), row({ accepter_name: 'Ben' }), row({ accepter_name: 'Cal', accepter_recipes: 4 })];
    expect(selectWinners(rows, [])).toHaveLength(0);
  });

  it('excludes owner/test inviters case-insensitively', () => {
    const rows = [row({}), row({ accepter_name: 'B' }), row({ accepter_name: 'C' })]
      .map(r => ({ ...r, inviter_email: 'Elisa.Widjaja@gmail.com' }));
    expect(selectWinners(rows, ['elisa.widjaja@gmail.com'])).toHaveLength(0);
  });

  it('groups rows by inviter and can return multiple winners', () => {
    const a = [row({}), row({ accepter_name: 'B' }), row({ accepter_name: 'C' })];
    const b = a.map(r => ({ ...r, inviter_user_id: 'inv-2', inviter_email: 'two@example.com' }));
    expect(selectWinners([...a, ...b], []).map(w => w.userId).sort()).toEqual(['inv-1', 'inv-2']);
  });

  it('falls back to email when inviter_name is null/empty', () => {
    const rows = [row({ inviter_name: '' }), row({ inviter_name: '', accepter_name: 'B' }), row({ inviter_name: '', accepter_name: 'C' })];
    expect(selectWinners(rows, [])[0].name).toBe('inv@example.com');
  });
});

describe('buildRewardAdminEmail', () => {
  const winner = {
    userId: 'inv-1', email: 'inv@example.com', name: 'Inga',
    qualifiedFriends: [{ name: 'Ana', recipes: 6 }, { name: 'Ben', recipes: 5 }, { name: 'Cal', recipes: 9 }],
  };
  it('includes winner identity, all qualified friends, and no em dashes', () => {
    const { subject, html } = buildRewardAdminEmail(winner);
    expect(subject).toContain('Founding Chef');
    expect(subject).toContain('Inga');
    expect(html).toContain('inv@example.com');
    for (const f of winner.qualifiedFriends) expect(html).toContain(f.name);
    expect(html).not.toContain('—');
    expect(subject).not.toContain('—');
  });
  it('HTML-escapes names', () => {
    const { html } = buildRewardAdminEmail({ ...winner, name: '<b>x</b>' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('thresholds', () => {
  it('exports the spec constants', () => {
    expect(REFERRAL_FRIENDS_REQUIRED).toBe(3);
    expect(REFERRAL_RECIPES_REQUIRED).toBe(5);
  });
});

describe('isRewardTick', () => {
  it('fires only on the 17:00 UTC tick', () => {
    expect(isRewardTick(new Date('2026-08-14T17:05:00Z'))).toBe(true);
    expect(isRewardTick(new Date('2026-08-14T16:05:00Z'))).toBe(false);
    expect(REFERRAL_TICK_HOUR_UTC).toBe(17);
  });
});

describe('notification builders', () => {
  it('winner notification mentions the badge and gift card, no em dashes', () => {
    const n = buildWinnerNotification('2026-08-14T17:00:00.000Z');
    expect(n.type).toBe('reward_granted');
    expect(n.message).toContain('Founding Chef');
    expect(n.message).toContain('gift card');
    expect(n.message).not.toContain('—');
  });
  it('promo notification pitches inviting friends, no em dashes', () => {
    const n = buildPromoNotification('2026-08-14T17:00:00.000Z');
    expect(n.type).toBe('reward_granted');
    expect(n.message).toContain('gift card');
    expect(n.message).not.toContain('—');
  });
});

// --- runReferralRewards orchestrator ---
// A scripted fake D1 that routes on SQL substring (repo style: see
// src/routes/admin.test.ts). It's not a real SQL engine: the promo-targets
// query's recipe-count/friends-count filtering is precomputed per-row into
// `eligibleForPromo` rather than derived from a fake recipes/friends table,
// since these unit tests exercise runReferralRewards's D1 call sequencing and
// idempotency, not SQLite semantics (that's covered on dev per the brief).

type FakeProfile = {
  email: string;
  display_name: string;
  founding_chef_at: string | null;
  referral_promo_at: string | null;
  deleted_at: string | null;
  created_at: string;
  eligibleForPromo?: boolean;
};
type FakeReward = { granted_at: string; admin_emailed_at: string | null };
type FakeNotification = { user_id: string; type: string; message: string; data: string; created_at: string };

function makeFakeDb(opts: {
  openInviteRows?: ReferralRow[];
  referralRewards?: Record<string, FakeReward>;
  profiles?: Record<string, FakeProfile>;
}) {
  const openInviteRows = opts.openInviteRows ?? [];
  const referralRewards: Record<string, FakeReward> = { ...(opts.referralRewards ?? {}) };
  const profiles: Record<string, FakeProfile> = { ...(opts.profiles ?? {}) };
  const notifications: FakeNotification[] = [];

  function handleAll(sql: string, args: unknown[]): { results: Record<string, unknown>[] } {
    if (sql.includes('FROM open_invite_used')) {
      return { results: openInviteRows as unknown as Record<string, unknown>[] };
    }
    if (sql.includes('JOIN profiles p ON p.user_id = rr.user_id')) {
      return {
        results: Object.entries(referralRewards)
          .filter(([uid]) => profiles[uid] && profiles[uid].founding_chef_at == null)
          .map(([uid, r]) => ({ user_id: uid, granted_at: r.granted_at })),
      };
    }
    if (sql.trim() === 'SELECT user_id FROM referral_rewards WHERE admin_emailed_at IS NULL') {
      return {
        results: Object.entries(referralRewards)
          .filter(([, r]) => r.admin_emailed_at == null)
          .map(([uid]) => ({ user_id: uid })),
      };
    }
    if (sql.trim() === 'SELECT user_id FROM referral_rewards') {
      return { results: Object.keys(referralRewards).map(uid => ({ user_id: uid })) };
    }
    if (sql.includes('referral_promo_at IS NULL')) {
      const excluded = new Set((args as string[]).map(e => e.toLowerCase()));
      const eligible = Object.entries(profiles)
        .filter(([, p]) => p.deleted_at == null && p.referral_promo_at == null && p.eligibleForPromo && !excluded.has(p.email.toLowerCase()))
        .sort((a, b) => a[1].created_at.localeCompare(b[1].created_at))
        .map(([uid]) => ({ user_id: uid }));
      return { results: eligible };
    }
    return { results: [] };
  }

  function handleFirst(sql: string, args: unknown[]): Record<string, unknown> | null {
    if (sql.trim() === 'SELECT email, display_name FROM profiles WHERE user_id = ?') {
      const uid = args[0] as string;
      const p = profiles[uid];
      return p ? { email: p.email, display_name: p.display_name } : null;
    }
    return null;
  }

  function handleRun(sql: string, args: unknown[]): { success: true } {
    if (sql.includes('INSERT OR IGNORE INTO referral_rewards')) {
      const [uid, grantedAt] = args as [string, string];
      if (!referralRewards[uid]) referralRewards[uid] = { granted_at: grantedAt, admin_emailed_at: null };
    } else if (sql.includes('INSERT INTO notifications')) {
      const [user_id, type, message, data, created_at] = args as [string, string, string, string, string];
      notifications.push({ user_id, type, message, data, created_at });
    } else if (sql.includes('UPDATE profiles SET founding_chef_at')) {
      const [grantedAt, uid] = args as [string, string];
      if (profiles[uid] && profiles[uid].founding_chef_at == null) profiles[uid].founding_chef_at = grantedAt;
    } else if (sql.includes('UPDATE referral_rewards SET admin_emailed_at')) {
      const [emailedAt, uid] = args as [string, string];
      if (referralRewards[uid]) referralRewards[uid].admin_emailed_at = emailedAt;
    } else if (sql.includes('UPDATE profiles SET referral_promo_at')) {
      const [promoAt, uid] = args as [string, string];
      if (profiles[uid]) profiles[uid].referral_promo_at = promoAt;
    }
    return { success: true };
  }

  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      all: async () => handleAll(sql, args),
      first: async () => handleFirst(sql, args),
      run: async () => handleRun(sql, args),
    }),
    all: async () => handleAll(sql, []),
    first: async () => handleFirst(sql, []),
    run: async () => handleRun(sql, []),
  });

  const db = { prepare } as unknown as import('./index').Env['DB'];
  return { db, state: { referralRewards, profiles, notifications } };
}

const qualifyingRows = (inviterId = 'inv-1', inviterEmail = 'inv@example.com', inviterName = 'Inga'): ReferralRow[] => [
  { inviter_user_id: inviterId, inviter_email: inviterEmail, inviter_name: inviterName, accepter_name: 'Ana', accepter_recipes: 5 },
  { inviter_user_id: inviterId, inviter_email: inviterEmail, inviter_name: inviterName, accepter_name: 'Ben', accepter_recipes: 6 },
  { inviter_user_id: inviterId, inviter_email: inviterEmail, inviter_name: inviterName, accepter_name: 'Cal', accepter_recipes: 7 },
];

describe('runReferralRewards', () => {
  beforeEach(() => {
    vi.mocked(sendEmailNotification).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(sendPushToUser).mockReset().mockResolvedValue([]);
  });

  it('happy path: grants, notifies, marks complete, and emails the admin', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: qualifyingRows(),
      profiles: {
        'inv-1': { email: 'inv@example.com', display_name: 'Inga', founding_chef_at: null, referral_promo_at: null, deleted_at: null, created_at: '2026-01-01' },
      },
    });
    const env = { DB: db, REFERRAL_PROMO_ENABLED: 'true' } as unknown as import('./index').Env;
    const result = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));

    expect(result.granted).toBe(1);
    expect(state.referralRewards['inv-1']).toBeDefined();
    expect(state.profiles['inv-1'].founding_chef_at).toBe('2026-08-14T17:00:00.000Z');
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].user_id).toBe('inv-1');
    expect(state.notifications[0].type).toBe('reward_granted');
    expect(sendEmailNotification).toHaveBeenCalledWith(env, 'elisa.widjaja@gmail.com', expect.stringContaining('Inga'), expect.any(String));
    expect(result.adminEmailsSent).toBe(1);
    expect(state.referralRewards['inv-1'].admin_emailed_at).toBe('2026-08-14T17:00:00.000Z');
  });

  it('idempotent re-run: an already-completed winner produces no new grant, notification, or email', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: qualifyingRows(),
      referralRewards: { 'inv-1': { granted_at: '2026-08-13T17:00:00.000Z', admin_emailed_at: '2026-08-13T17:00:00.000Z' } },
      profiles: {
        'inv-1': { email: 'inv@example.com', display_name: 'Inga', founding_chef_at: '2026-08-13T17:00:00.000Z', referral_promo_at: null, deleted_at: null, created_at: '2026-01-01' },
      },
    });
    const env = { DB: db, REFERRAL_PROMO_ENABLED: 'true' } as unknown as import('./index').Env;
    const result = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));

    expect(result.granted).toBe(0);
    expect(result.adminEmailsSent).toBe(0);
    expect(state.notifications).toHaveLength(0);
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('crash-heal: a grant row with founding_chef_at still NULL is completed without a new grant', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: qualifyingRows(),
      referralRewards: { 'inv-1': { granted_at: '2026-08-13T17:00:00.000Z', admin_emailed_at: '2026-08-13T17:00:00.000Z' } },
      profiles: {
        // founding_chef_at NULL simulates a crash between the grant insert and completion on a prior tick.
        'inv-1': { email: 'inv@example.com', display_name: 'Inga', founding_chef_at: null, referral_promo_at: null, deleted_at: null, created_at: '2026-01-01' },
      },
    });
    const env = { DB: db, REFERRAL_PROMO_ENABLED: 'true' } as unknown as import('./index').Env;
    const result = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));

    expect(result.granted).toBe(0); // no new referral_rewards insert
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].user_id).toBe('inv-1');
    // founding_chef_at is set from the reward row's granted_at, not "now".
    expect(state.profiles['inv-1'].founding_chef_at).toBe('2026-08-13T17:00:00.000Z');
  });

  it('admin email retry: a failed send leaves admin_emailed_at NULL; a later successful run sets it', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: qualifyingRows(),
      referralRewards: { 'inv-1': { granted_at: '2026-08-13T17:00:00.000Z', admin_emailed_at: null } },
      profiles: {
        'inv-1': { email: 'inv@example.com', display_name: 'Inga', founding_chef_at: '2026-08-13T17:00:00.000Z', referral_promo_at: null, deleted_at: null, created_at: '2026-01-01' },
      },
    });
    const env = { DB: db, REFERRAL_PROMO_ENABLED: 'true' } as unknown as import('./index').Env;

    vi.mocked(sendEmailNotification).mockResolvedValueOnce({ ok: false, status: 500 });
    const first = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));
    expect(first.adminEmailsSent).toBe(0);
    expect(state.referralRewards['inv-1'].admin_emailed_at).toBeNull();

    vi.mocked(sendEmailNotification).mockResolvedValueOnce({ ok: true });
    const second = await runReferralRewards(env, new Date('2026-08-14T18:00:00.000Z'));
    expect(second.adminEmailsSent).toBe(1);
    expect(state.referralRewards['inv-1'].admin_emailed_at).toBe('2026-08-14T18:00:00.000Z');
  });

  it('promo dedup: an already-nudged user is skipped; an eligible user is notified and marked', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: [],
      profiles: {
        'u1': { email: 'u1@example.com', display_name: 'U1', founding_chef_at: null, referral_promo_at: '2026-08-01T00:00:00.000Z', deleted_at: null, created_at: '2026-01-01', eligibleForPromo: true },
        'u2': { email: 'u2@example.com', display_name: 'U2', founding_chef_at: null, referral_promo_at: null, deleted_at: null, created_at: '2026-01-02', eligibleForPromo: true },
      },
    });
    const env = { DB: db, REFERRAL_PROMO_ENABLED: 'true' } as unknown as import('./index').Env;
    const result = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));

    expect(result.promosSent).toBe(1);
    expect(state.profiles['u1'].referral_promo_at).toBe('2026-08-01T00:00:00.000Z'); // untouched
    expect(state.profiles['u2'].referral_promo_at).toBe('2026-08-14T17:00:00.000Z');
    expect(state.notifications.filter(n => n.user_id === 'u2')).toHaveLength(1);
    expect(state.notifications.filter(n => n.user_id === 'u1')).toHaveLength(0);
  });

  it('promo kill switch: no promos sent and no state written unless REFERRAL_PROMO_ENABLED is "true"', async () => {
    const { db, state } = makeFakeDb({
      openInviteRows: [],
      profiles: {
        'u2': { email: 'u2@example.com', display_name: 'U2', founding_chef_at: null, referral_promo_at: null, deleted_at: null, created_at: '2026-01-02', eligibleForPromo: true },
      },
    });
    const env = { DB: db } as unknown as import('./index').Env; // flag unset
    const result = await runReferralRewards(env, new Date('2026-08-14T17:00:00.000Z'));

    expect(result.promosSent).toBe(0);
    expect(state.profiles['u2'].referral_promo_at).toBeNull();
    expect(state.notifications).toHaveLength(0);
  });
});

describe('shouldShowReferralDialog', () => {
  const base = { recipeCount: 0, foundingChefAt: null as string | null, dialogShownAtCount: null as number | null, dialogActedAt: null as string | null };

  it('below 10 recipes never shows, even if never shown before', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 9 })).toBe(false);
  });

  it('10+ recipes, never shown before, shows', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 10 })).toBe(true);
  });

  it('shown at 10, count still 15 does not re-show', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 15, dialogShownAtCount: 10 })).toBe(false);
  });

  it('shown at 10, count reaches 20 re-shows', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 20, dialogShownAtCount: 10 })).toBe(true);
  });

  it('acted stops re-surfacing regardless of recipe count', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 100, dialogShownAtCount: 10, dialogActedAt: '2026-08-14T00:00:00.000Z' })).toBe(false);
  });

  it('badge earned stops re-surfacing regardless of recipe count', () => {
    expect(shouldShowReferralDialog({ ...base, recipeCount: 100, dialogShownAtCount: 10, foundingChefAt: '2026-08-14T00:00:00.000Z' })).toBe(false);
  });
});

describe('shapeProgress', () => {
  it('caps savesCount at the threshold and marks qualified friends', () => {
    const rows = [
      row({ accepter_name: 'Ana', accepter_recipes: 12 }),
      row({ accepter_name: 'Ben', accepter_recipes: 3 }),
    ];
    const p = shapeProgress(rows, null);
    expect(p.threshold).toEqual({ friends: 3, recipes: 5 });
    expect(p.friends).toEqual([
      { name: 'Ana', savesCount: 5, qualified: true },
      { name: 'Ben', savesCount: 3, qualified: false },
    ]);
    expect(p.qualifiedCount).toBe(1);
    expect(p.foundingChefAt).toBeNull();
  });
  it('passes through the badge timestamp', () => {
    expect(shapeProgress([], '2026-08-14T17:00:00.000Z').foundingChefAt).toBe('2026-08-14T17:00:00.000Z');
  });
  it('sorts qualified friends first regardless of input (SQL row) order', () => {
    // Ana is the LOW-saves (not yet qualified) friend but appears FIRST in
    // the input; Ben qualifies but appears second. The card only renders the
    // first `threshold.friends` slots, so a naive pass-through here would
    // render the qualified friend as if they hadn't qualified yet.
    const rows = [
      row({ accepter_name: 'Ana', accepter_recipes: 3 }),
      row({ accepter_name: 'Ben', accepter_recipes: 12 }),
    ];
    const p = shapeProgress(rows, null);
    expect(p.friends).toEqual([
      { name: 'Ben', savesCount: 5, qualified: true },
      { name: 'Ana', savesCount: 3, qualified: false },
    ]);
  });
  it('puts all qualified friends ahead of unqualified ones with more than 3 referrals, independent of input order', () => {
    // 5 referred friends, only 2 qualified, and neither qualified friend is
    // first in the input — pins that sorting isn't accidentally limited to
    // the 2-row case above.
    const rows = [
      row({ accepter_name: 'Ana', accepter_recipes: 1 }),
      row({ accepter_name: 'Ben', accepter_recipes: 2 }),
      row({ accepter_name: 'Cal', accepter_recipes: 5 }),   // qualified
      row({ accepter_name: 'Dee', accepter_recipes: 4 }),
      row({ accepter_name: 'Eve', accepter_recipes: 8 }),   // qualified
    ];
    const p = shapeProgress(rows, null);
    expect(p.friends.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { name: 'Cal', savesCount: 5, qualified: true },
        { name: 'Eve', savesCount: 5, qualified: true },
      ])
    );
    expect(p.friends.slice(0, 2).every(f => f.qualified)).toBe(true);
    expect(p.friends.slice(2).every(f => !f.qualified)).toBe(true);
    expect(p.qualifiedCount).toBe(2);
  });
});
