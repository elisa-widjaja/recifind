import type { Env } from './index';

export const REFERRAL_FRIENDS_REQUIRED = 3;
export const REFERRAL_RECIPES_REQUIRED = 5;
export const NEW_SIGNUP_WINDOW_DAYS = 2; // profile created within 48h before the accept
export const PROMO_MIN_RECIPES = 10;
export const PROMO_DAILY_CAP = 20;

export type ReferralRow = {
  inviter_user_id: string;
  inviter_email: string;
  inviter_name: string | null;
  accepter_name: string | null;
  accepter_recipes: number;
};

export type Winner = {
  userId: string;
  email: string;
  name: string;
  qualifiedFriends: { name: string; recipes: number }[];
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function selectWinners(rows: ReferralRow[], excludedEmails: string[]): Winner[] {
  const excluded = new Set(excludedEmails.map(e => e.toLowerCase()));
  const byInviter = new Map<string, ReferralRow[]>();
  for (const r of rows) {
    if (excluded.has(r.inviter_email.toLowerCase())) continue;
    const list = byInviter.get(r.inviter_user_id) ?? [];
    list.push(r);
    byInviter.set(r.inviter_user_id, list);
  }
  const winners: Winner[] = [];
  for (const [userId, list] of byInviter) {
    const qualified = list.filter(r => r.accepter_recipes >= REFERRAL_RECIPES_REQUIRED);
    if (qualified.length < REFERRAL_FRIENDS_REQUIRED) continue;
    const first = list[0];
    winners.push({
      userId,
      email: first.inviter_email,
      name: (first.inviter_name || '').trim() || first.inviter_email,
      qualifiedFriends: qualified.map(r => ({ name: (r.accepter_name || '').trim() || 'A friend', recipes: r.accepter_recipes })),
    });
  }
  return winners;
}

export function buildRewardAdminEmail(w: Winner): { subject: string; html: string } {
  const subject = `Founding Chef earned: ${w.name} qualifies for a gift card`;
  const friends = w.qualifiedFriends
    .map(f => `<li>${esc(f.name)}: ${f.recipes} recipes saved</li>`)
    .join('');
  const html = [
    `<p><strong>${esc(w.name)}</strong> (${esc(w.email)}) just completed the Founding Chef milestone.</p>`,
    `<p>Qualified friends they brought to ReciFriend:</p>`,
    `<ul>${friends}</ul>`,
    `<p>Next step: reply to them to ask which gift card they want. Their badge and in-app notification were granted automatically.</p>`,
  ].join('\n');
  return { subject, html };
}

export const REFERRAL_TICK_HOUR_UTC = 17; // clear of the 16:00 nudge-email tick

export function isRewardTick(now: Date): boolean {
  return now.getUTCHours() === REFERRAL_TICK_HOUR_UTC;
}

export function buildWinnerNotification(createdAt: string) {
  return {
    type: 'reward_granted' as const,
    message: 'You earned the Founding Chef badge! Elisa will reach out about your gift card.',
    data: {},
    createdAt,
  };
}

export function buildPromoNotification(createdAt: string) {
  return {
    type: 'reward_granted' as const,
    message: 'Your recipe collection is getting serious. Invite friends who cook and earn a gift card on us.',
    data: { deepLink: 'friends' },
    createdAt,
  };
}

export function shouldShowReferralDialog(p: { recipeCount: number; foundingChefAt: string | null; dialogShownAtCount: number | null; dialogActedAt: string | null }): boolean {
  if (p.foundingChefAt || p.dialogActedAt) return false;
  if (p.recipeCount < 10) return false;
  if (p.dialogShownAtCount == null) return true;
  return p.recipeCount >= p.dialogShownAtCount + 10;
}

export function shapeProgress(rows: ReferralRow[], foundingChefAt: string | null) {
  const friends = rows.map(r => ({
    name: (r.accepter_name || '').trim() || 'A friend',
    savesCount: Math.min(r.accepter_recipes, REFERRAL_RECIPES_REQUIRED),
    qualified: r.accepter_recipes >= REFERRAL_RECIPES_REQUIRED,
  }));
  // SQL row order is arbitrary; the card only renders the first
  // threshold.friends slots, so qualified friends must sort first (then by
  // savesCount desc) or a user whose qualifying friends land later in the
  // unordered result set would render as behind when they're actually done.
  friends.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return b.savesCount - a.savesCount;
  });
  return {
    threshold: { friends: REFERRAL_FRIENDS_REQUIRED, recipes: REFERRAL_RECIPES_REQUIRED },
    friends,
    qualifiedCount: friends.filter(f => f.qualified).length,
    foundingChefAt,
  };
}

// One row per referred NEW signup (accepter profile created within 48h before
// the accept), with the accepter's live recipe count.
const REFERRAL_ROWS_SQL = `
  SELECT oiu.inviter_user_id, ip.email AS inviter_email, ip.display_name AS inviter_name,
         ap.display_name AS accepter_name,
         (SELECT COUNT(*) FROM recipes r WHERE r.user_id = oiu.accepter_user_id AND r.hidden_at IS NULL) AS accepter_recipes
  FROM open_invite_used oiu
  JOIN profiles ip ON ip.user_id = oiu.inviter_user_id AND ip.deleted_at IS NULL
  JOIN profiles ap ON ap.user_id = oiu.accepter_user_id AND ap.deleted_at IS NULL
  WHERE julianday(oiu.accepted_at) - julianday(ap.created_at) BETWEEN 0 AND ${NEW_SIGNUP_WINDOW_DAYS}
`;

export async function getReferralProgress(env: Env, userId: string) {
  const rowsResult = await env.DB.prepare(REFERRAL_ROWS_SQL + ' AND oiu.inviter_user_id = ?').bind(userId).all();
  const profile = await env.DB.prepare(
    'SELECT founding_chef_at, referral_dialog_shown_at_count, referral_dialog_acted_at FROM profiles WHERE user_id = ?'
  ).bind(userId).first();
  const recipeCountRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM recipes WHERE user_id = ? AND hidden_at IS NULL'
  ).bind(userId).first();
  const progress = shapeProgress((rowsResult.results ?? []) as ReferralRow[], (profile?.founding_chef_at as string) ?? null);
  return {
    ...progress,
    recipeCount: Number(recipeCountRow?.n ?? 0),
    dialogShownAtCount: (profile?.referral_dialog_shown_at_count as number) ?? null,
    dialogActedAt: (profile?.referral_dialog_acted_at as string) ?? null,
  };
}

export async function recordReferralDialogEvent(env: Env, userId: string, event: 'shown' | 'acted'): Promise<void> {
  if (event === 'shown') {
    await env.DB.prepare(
      `UPDATE profiles SET referral_dialog_shown_at_count = (SELECT COUNT(*) FROM recipes WHERE user_id = ?1 AND hidden_at IS NULL) WHERE user_id = ?1`
    ).bind(userId).run();
    return;
  }
  await env.DB.prepare('UPDATE profiles SET referral_dialog_acted_at = ? WHERE user_id = ?').bind(new Date().toISOString(), userId).run();
}

export async function runReferralRewards(env: Env, now: Date): Promise<{ granted: number; adminEmailsSent: number; promosSent: number }> {
  const { METRICS_EXCLUDED_EMAILS } = await import('./routes/admin');
  const { sendEmailNotification } = await import('./index');
  const { sendPushToUser } = await import('./push/apns');
  const nowIso = now.toISOString();
  let granted = 0, adminEmailsSent = 0, promosSent = 0;

  // --- 1. New winners: grant anchor only. founding_chef_at (the completion
  // marker) is set later, in the reconciliation pass, so a crash between the
  // grant and the profile/notification side effects self-heals next tick
  // instead of leaving a permanently-incomplete winner. ---
  const rowsResult = await env.DB.prepare(REFERRAL_ROWS_SQL).all();
  const rows = (rowsResult.results ?? []) as ReferralRow[];
  const alreadyGranted = await env.DB.prepare('SELECT user_id FROM referral_rewards').all();
  const grantedIds = new Set((alreadyGranted.results ?? []).map(r => r.user_id as string));
  const winners = selectWinners(rows, METRICS_EXCLUDED_EMAILS).filter(w => !grantedIds.has(w.userId));

  for (const w of winners) {
    await env.DB.prepare('INSERT OR IGNORE INTO referral_rewards (user_id, granted_at) VALUES (?, ?)').bind(w.userId, nowIso).run();
    granted++;
  }

  // --- 2. Reconciliation: complete any grant that hasn't been finalized yet
  // (fresh winners from step 1, plus any prior tick that crashed mid-way).
  // founding_chef_at is set LAST so it doubles as the completion marker; a
  // duplicate notification on a crash between notify and update is accepted. ---
  const pendingCompletion = await env.DB.prepare(
    `SELECT rr.user_id, rr.granted_at FROM referral_rewards rr
     JOIN profiles p ON p.user_id = rr.user_id
     WHERE p.founding_chef_at IS NULL`
  ).all();
  for (const p of (pendingCompletion.results ?? [])) {
    const userId = p.user_id as string;
    const grantedAt = p.granted_at as string;
    const notif = buildWinnerNotification(nowIso);
    await env.DB.prepare('INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(userId, notif.type, notif.message, JSON.stringify(notif.data), notif.createdAt).run();
    try {
      await sendPushToUser(env as any, userId, {
        title: 'Founding Chef',
        body: notif.message,
        deepLink: 'https://recifriend.com/friends',
      });
    } catch (err) {
      console.error('[referrals] push failed', err);
    }
    await env.DB.prepare('UPDATE profiles SET founding_chef_at = ? WHERE user_id = ? AND founding_chef_at IS NULL').bind(grantedAt, userId).run();
  }

  // --- 3. Admin fulfillment emails (fresh winners + retries for past failures) ---
  const pendingEmail = await env.DB.prepare('SELECT user_id FROM referral_rewards WHERE admin_emailed_at IS NULL').all();
  for (const p of (pendingEmail.results ?? [])) {
    const userId = p.user_id as string;
    // Rebuild the winner payload from current data (names/counts may have moved; fine for an admin email).
    const winner = selectWinners(rows.filter(r => r.inviter_user_id === userId), []).find(w => w.userId === userId);
    const profile = await env.DB.prepare('SELECT email, display_name FROM profiles WHERE user_id = ?').bind(userId).first();
    const email = buildRewardAdminEmail(winner ?? {
      userId,
      email: (profile?.email as string) ?? '(unknown)',
      name: ((profile?.display_name as string) || (profile?.email as string) || userId),
      qualifiedFriends: [],
    });
    const sent = await sendEmailNotification(env, 'elisa.widjaja@gmail.com', email.subject, email.html);
    if (sent.ok) {
      await env.DB.prepare('UPDATE referral_rewards SET admin_emailed_at = ? WHERE user_id = ?').bind(nowIso, userId).run();
      adminEmailsSent++;
    }
  }

  // --- 4. One-time promo nudge for heavy solo users ---
  // Kill switch: the promo is a ONE-SHOT send per user (referral_promo_at
  // burns forever) and most targets are App Store users, so it stays OFF
  // until an iOS build with the program UI is live. Flip
  // REFERRAL_PROMO_ENABLED="true" in wrangler.toml [vars] to arm it.
  // Grants/admin emails above are unaffected.
  if (env.REFERRAL_PROMO_ENABLED !== 'true') {
    return { granted, adminEmailsSent, promosSent };
  }
  const excludedPlaceholders = METRICS_EXCLUDED_EMAILS.map(() => '?').join(',');
  const promoTargets = await env.DB.prepare(
    `SELECT p.user_id FROM profiles p
     WHERE p.deleted_at IS NULL AND p.referral_promo_at IS NULL
       AND LOWER(p.email) NOT IN (${excludedPlaceholders})
       AND (SELECT COUNT(*) FROM recipes r WHERE r.user_id = p.user_id AND r.hidden_at IS NULL) >= ${PROMO_MIN_RECIPES}
       AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.user_id = p.user_id)
     ORDER BY p.created_at
     LIMIT ${PROMO_DAILY_CAP}`
  ).bind(...METRICS_EXCLUDED_EMAILS.map(e => e.toLowerCase())).all();

  for (const t of (promoTargets.results ?? [])) {
    const userId = t.user_id as string;
    const notif = buildPromoNotification(nowIso);
    await env.DB.prepare('INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(userId, notif.type, notif.message, JSON.stringify(notif.data), notif.createdAt).run();
    await env.DB.prepare('UPDATE profiles SET referral_promo_at = ? WHERE user_id = ?').bind(nowIso, userId).run();
    try {
      await sendPushToUser(env as any, userId, {
        title: 'ReciFriend',
        body: notif.message,
        deepLink: 'https://recifriend.com/friends',
      });
    } catch (err) {
      console.error('[referrals] promo push failed', err);
    }
    promosSent++;
  }

  return { granted, adminEmailsSent, promosSent };
}
