export function isAdminEmail(email: string | undefined, adminEmails: string | undefined): boolean {
  if (!email || !adminEmails) return false;
  const target = email.trim().toLowerCase();
  return adminEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

export interface AuditLogEntry {
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetRecipeId?: string;
  payload?: unknown;
}

export async function writeAuditLog(db: D1Database, entry: AuditLogEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO admin_audit_log (admin_email, action, target_user_id, target_recipe_id, payload)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        entry.adminEmail,
        entry.action,
        entry.targetUserId ?? null,
        entry.targetRecipeId ?? null,
        entry.payload == null ? null : JSON.stringify(entry.payload)
      )
      .run();
  } catch (err) {
    console.error('[admin] writeAuditLog failed', { entry, err });
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

export interface AdminCallerCtx {
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
}

export function requireAdmin(ctx: AdminCallerCtx): Response | null {
  if (!isAdminEmail(ctx.user.email, ctx.adminEmails)) {
    return json(403, { code: 'FORBIDDEN', message: 'Not an admin' });
  }
  return null;
}

export async function handleAdminMe(ctx: AdminCallerCtx): Promise<Response> {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return json(200, { email: ctx.user.email, isAdmin: true });
}

// ---------------------------------------------------------------------------
// /admin/test-nudge-email
// ---------------------------------------------------------------------------

import type { Env } from '../index';

export async function handleTestNudgeEmail(args: {
  env: Env;
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  request: Request;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  // Imported lazily to avoid a load-time circular dependency between
  // routes/admin.ts and index.ts (index.ts also imports from this file).
  const { sendEmailNotification, computeHmac, getRecommendedRecipes, buildNudgeEmailHtml } =
    await import('../index');

  const url = new URL(args.request.url);
  const toEmail = url.searchParams.get('to');
  if (!toEmail) {
    return json(400, { error: 'Missing ?to= query param' });
  }

  let profileUserId = url.searchParams.get('userId') || '';
  let displayName = 'there';

  if (profileUserId) {
    const row = await args.env.DB
      .prepare('SELECT display_name FROM profiles WHERE user_id = ?')
      .bind(profileUserId)
      .first();
    if (row) displayName = row.display_name as string;
  } else {
    const row = await args.env.DB
      .prepare('SELECT user_id, display_name FROM profiles WHERE email = ? LIMIT 1')
      .bind(toEmail)
      .first();
    if (row) {
      profileUserId = row.user_id as string;
      displayName = row.display_name as string;
    } else {
      profileUserId = 'test-user';
    }
  }

  const recipes = await getRecommendedRecipes(args.env.DB, profileUserId);
  const gifUrl: string | null = null;

  const secret = args.env.DEV_API_KEY;
  if (!secret) {
    return json(500, { error: 'Server misconfiguration: missing signing key' });
  }
  const unsubToken = await computeHmac(secret, profileUserId);
  let html = buildNudgeEmailHtml(displayName, recipes, gifUrl);
  html = html.replace('__USER_ID__', encodeURIComponent(profileUserId));
  html = html.replace('__TOKEN__', unsubToken);

  const emailResult = await sendEmailNotification(
    args.env,
    toEmail,
    `Your recipes are waiting, ${displayName}!`,
    html
  );

  return json(200, {
    ok: emailResult.ok,
    sentTo: toEmail,
    recipesIncluded: recipes.length,
    resendStatus: emailResult.status,
    resendResponse: emailResult.body,
  });
}

// ---------------------------------------------------------------------------
// /admin/users — list with filters
// ---------------------------------------------------------------------------

export interface UsersListParams {
  limit: number;
  offset: number;
  search?: string;
  recipeBucket?: '0' | '1-9' | '10-19' | '20-49' | '50+';
  activity?: 'active' | 'inactive' | 'ghost' | 'soft_deleted';
  signupAfter?: string;
  signupBefore?: string;
  sort?: 'signup_desc' | 'signup_asc';
}

export interface BuiltQuery { sql: string; params: unknown[] }

const RECIPE_BUCKETS: Record<string, string> = {
  '0': 'recipe_count = 0',
  '1-9': 'recipe_count BETWEEN 1 AND 9',
  '10-19': 'recipe_count BETWEEN 10 AND 19',
  '20-49': 'recipe_count BETWEEN 20 AND 49',
  '50+': 'recipe_count >= 50',
};

export function buildUsersListQuery(p: UsersListParams): BuiltQuery {
  const where: string[] = [];
  const having: string[] = [];
  const params: unknown[] = [];

  if (p.activity === 'soft_deleted') {
    where.push('p.deleted_at IS NOT NULL');
  } else {
    where.push('p.deleted_at IS NULL');
  }

  if (p.search) {
    where.push('p.email LIKE ?');
    params.push(`%${p.search}%`);
  }
  if (p.signupAfter) {
    where.push('p.created_at >= ?');
    params.push(p.signupAfter);
  }
  if (p.signupBefore) {
    where.push('p.created_at <= ?');
    params.push(p.signupBefore);
  }

  if (p.recipeBucket && RECIPE_BUCKETS[p.recipeBucket]) {
    having.push(RECIPE_BUCKETS[p.recipeBucket]);
  }

  const orderBy = p.sort === 'signup_asc' ? 'p.created_at ASC' : 'p.created_at DESC';

  const sql = `
    SELECT
      p.user_id            AS id,
      p.email              AS email,
      p.display_name       AS display_name,
      p.created_at         AS signed_up_at,
      p.deleted_at         AS deleted_at,
      COUNT(DISTINCT r.id) AS recipe_count,
      COUNT(DISTINCT frs.to_user_id) AS invites_sent,
      COUNT(DISTINCT f.friend_id) AS invites_accepted
    FROM profiles p
    LEFT JOIN recipes r ON r.user_id = p.user_id
    LEFT JOIN friend_requests_sent frs ON frs.from_user_id = p.user_id
    LEFT JOIN friends f ON f.user_id = p.user_id
    WHERE ${where.join(' AND ')}
    GROUP BY p.user_id
    ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `.trim();

  params.push(p.limit, p.offset);
  return { sql, params };
}

const ALLOWED_ACTIVITY = new Set(['active', 'inactive', 'ghost', 'soft_deleted']);
const ALLOWED_BUCKET = new Set(['0', '1-9', '10-19', '20-49', '50+']);
const ALLOWED_SORT = new Set(['signup_desc', 'signup_asc']);

export async function handleAdminUsersList(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const rawActivity = args.url.searchParams.get('activity');
  const rawBucket = args.url.searchParams.get('recipeBucket');
  const rawSort = args.url.searchParams.get('sort');

  if (rawActivity && !ALLOWED_ACTIVITY.has(rawActivity)) {
    return json(400, { code: 'BAD_REQUEST', message: `invalid activity: ${rawActivity}` });
  }
  if (rawBucket && !ALLOWED_BUCKET.has(rawBucket)) {
    return json(400, { code: 'BAD_REQUEST', message: `invalid recipeBucket: ${rawBucket}` });
  }
  if (rawSort && !ALLOWED_SORT.has(rawSort)) {
    return json(400, { code: 'BAD_REQUEST', message: `invalid sort: ${rawSort}` });
  }

  const limit = Math.min(parseInt(args.url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(args.url.searchParams.get('offset') || '0', 10);

  const params: UsersListParams = {
    limit,
    offset,
    search: args.url.searchParams.get('search') || undefined,
    recipeBucket: (rawBucket as UsersListParams['recipeBucket']) || undefined,
    activity: (rawActivity as UsersListParams['activity']) || undefined,
    signupAfter: args.url.searchParams.get('signupAfter') || undefined,
    signupBefore: args.url.searchParams.get('signupBefore') || undefined,
    sort: (rawSort as UsersListParams['sort']) || undefined,
  };

  const { sql, params: bindParams } = buildUsersListQuery(params);
  const { results } = await args.env.DB.prepare(sql).bind(...bindParams).all();
  const preFilterCount = (results || []).length;

  const enriched = await enrichWithLastSignIn(results, args.env);
  const filtered = filterByActivity(enriched, params.activity);

  return json(200, {
    users: filtered,
    page: {
      limit,
      offset,
      returned: filtered.length,
      has_more: preFilterCount === limit, // there could be more rows in D1; client should fetch next page
    },
  });
}

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GHOST_WINDOW_MS = 5 * 60 * 1000;

async function enrichWithLastSignIn(rows: any[], env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }) {
  if (rows.length === 0) return rows;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return rows.map((r) => ({ ...r, last_sign_in_at: null, is_active: false }));
  }
  const enriched = await Promise.all(rows.map(async (r) => {
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users/${r.id}`;
    let lastSignInAt: string | null = null;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      if (res.ok) lastSignInAt = (await res.json() as any).last_sign_in_at;
    } catch (err) {
      console.error('[admin] enrichWithLastSignIn fetch failed', { userId: r.id, err });
    }
    const isActive = computeIsActive(r, lastSignInAt);
    return { ...r, last_sign_in_at: lastSignInAt, is_active: isActive };
  }));
  return enriched;
}

function computeIsActive(row: any, lastSignInAt: string | null): boolean {
  if (row.deleted_at) return false;
  if (row.recipe_count < 1) return false;
  if (!lastSignInAt) return false;
  const ageMs = Date.now() - new Date(lastSignInAt).getTime();
  return ageMs <= ACTIVE_WINDOW_MS;
}

function classifyActivity(row: any, lastSignInAt: string | null): 'active' | 'inactive' | 'ghost' | 'soft_deleted' {
  if (row.deleted_at) return 'soft_deleted';
  const signupTime = new Date(row.signed_up_at).getTime();
  const lastSignInTime = lastSignInAt ? new Date(lastSignInAt).getTime() : signupTime;
  const cameBack = (lastSignInTime - signupTime) > GHOST_WINDOW_MS;
  if (row.recipe_count === 0 && !cameBack) return 'ghost';
  if (computeIsActive(row, lastSignInAt)) return 'active';
  return 'inactive';
}

function filterByActivity(rows: any[], activity: UsersListParams['activity']) {
  if (!activity) return rows;
  return rows.filter((r) => classifyActivity(r, r.last_sign_in_at) === activity);
}

// ---------------------------------------------------------------------------
// /admin/users/:id — drill-down
// ---------------------------------------------------------------------------

export async function handleAdminUserDrilldown(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  // 1. Profile (admin can view soft-deleted users)
  const profile = await args.env.DB.prepare(
    `SELECT user_id, email, display_name, created_at, deleted_at
     FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first();
  if (!profile) return json(404, { code: 'NOT_FOUND' });

  // 2. Recipes
  const recipes = await args.env.DB.prepare(
    `SELECT id, title, created_at, hidden_at
     FROM recipes WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(args.userId).all();

  // 3. Last 20 cook events
  const cookEvents = await args.env.DB.prepare(
    `SELECT recipe_id, created_at
     FROM cook_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(args.userId).all();

  // 4. Invites sent: friend_requests_sent + join friends/profile to derive status + email
  const sent = await args.env.DB.prepare(
    `SELECT frs.to_user_id, p.email AS to_email, p.deleted_at,
            CASE WHEN f.user_id IS NOT NULL THEN 'accepted' ELSE 'pending' END AS status,
            COALESCE(f.connected_at, '') AS accepted_at
     FROM friend_requests_sent frs
     LEFT JOIN profiles p ON p.user_id = frs.to_user_id
     LEFT JOIN friends f ON f.user_id = frs.from_user_id AND f.friend_id = frs.to_user_id
     WHERE frs.from_user_id = ?
     ORDER BY accepted_at DESC`
  ).bind(args.userId).all();

  // 5. Pending invites received
  const pendingReceived = await args.env.DB.prepare(
    `SELECT fr.from_user_id, fr.from_email, fr.created_at
     FROM friend_requests fr
     WHERE fr.to_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  ).bind(args.userId).all();

  // Enrich invitees with recipe count + last_sign_in
  const invitees = await Promise.all((sent.results || []).map(async (row: any) => {
    const rc = await args.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM recipes WHERE user_id = ?`
    ).bind(row.to_user_id).first() as { c: number };
    let lastSignInAt: string | null = null;
    if (args.env.SUPABASE_SERVICE_ROLE_KEY && row.to_user_id) {
      try {
        const r = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/users/${row.to_user_id}`, {
          headers: {
            Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        });
        if (r.ok) lastSignInAt = (await r.json() as any).last_sign_in_at;
      } catch (err) {
        console.error('[admin] drilldown invitee enrichment failed', { userId: row.to_user_id, err });
      }
    }
    return { ...row, recipe_count: rc?.c || 0, last_sign_in_at: lastSignInAt };
  }));

  return json(200, {
    profile,
    recipes: recipes.results || [],
    cook_events: cookEvents.results || [],
    invites_sent: invitees,
    pending_received: pendingReceived.results || [],
  });
}

// ---------------------------------------------------------------------------
// /admin/metrics/timeseries — dashboard data (signups, viral, activation, loop)
// ---------------------------------------------------------------------------

export function buildSignupsPerDayQuery(days: number): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return {
    sql: `SELECT DATE(created_at) AS day, COUNT(*) AS n
          FROM profiles WHERE created_at >= ? AND deleted_at IS NULL
          GROUP BY DATE(created_at) ORDER BY day ASC`,
    params: [since],
  };
}

export function buildViralCoefWeeklyQuery(days: number): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return {
    sql: `
      WITH weekly_signups AS (
        SELECT strftime('%Y-%W', created_at) AS wk, COUNT(*) AS signups
        FROM profiles WHERE created_at >= ? AND deleted_at IS NULL
        GROUP BY wk
      ),
      weekly_accepts AS (
        SELECT strftime('%Y-%W', connected_at) AS wk, COUNT(DISTINCT user_id || '|' || friend_id) / 2 AS accepts
        FROM friends WHERE connected_at >= ?
        GROUP BY wk
      )
      SELECT s.wk AS week, s.signups, COALESCE(a.accepts, 0) AS accepts,
             CASE WHEN s.signups > 0 THEN ROUND(1.0 * COALESCE(a.accepts, 0) / s.signups, 3) ELSE 0 END AS viral_coef
      FROM weekly_signups s LEFT JOIN weekly_accepts a ON a.wk = s.wk
      ORDER BY s.wk ASC
    `.trim(),
    params: [since, since],
  };
}

export async function handleAdminMetricsTimeseries(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const days = Math.min(parseInt(args.url.searchParams.get('days') || '90', 10), 365);

  const sQ = buildSignupsPerDayQuery(days);
  const vQ = buildViralCoefWeeklyQuery(days);

  const [signups, viral, totals, recipeTotals] = await Promise.all([
    args.env.DB.prepare(sQ.sql).bind(...sQ.params).all(),
    args.env.DB.prepare(vQ.sql).bind(...vQ.params).all(),
    args.env.DB.prepare(
      `SELECT COUNT(*) AS total_users FROM profiles WHERE deleted_at IS NULL`
    ).first(),
    args.env.DB.prepare(`SELECT COUNT(*) AS total_recipes FROM recipes`).first(),
  ]);

  // Activation curve (cohort): per signup-week, % of users in cohort with >=1 recipe
  const activation = await args.env.DB.prepare(`
    WITH cohort AS (
      SELECT p.user_id, strftime('%Y-%W', p.created_at) AS wk
      FROM profiles p WHERE p.deleted_at IS NULL AND p.created_at >= ?
    ),
    has_recipe AS (
      SELECT DISTINCT user_id FROM recipes
    )
    SELECT c.wk AS week, COUNT(c.user_id) AS cohort_size,
           SUM(CASE WHEN hr.user_id IS NOT NULL THEN 1 ELSE 0 END) AS activated,
           ROUND(100.0 * SUM(CASE WHEN hr.user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(c.user_id), 1) AS pct
    FROM cohort c LEFT JOIN has_recipe hr ON hr.user_id = c.user_id
    GROUP BY c.wk ORDER BY c.wk ASC
  `).bind(new Date(Date.now() - days * 86400000).toISOString()).all();

  // Loop completion: per cohort week, % who sent >=1 invite
  // (friend_requests_sent has no created_at column; use "ever" as a coarser proxy)
  const loopCompletion = await args.env.DB.prepare(`
    WITH cohort AS (
      SELECT p.user_id, strftime('%Y-%W', p.created_at) AS wk
      FROM profiles p WHERE p.deleted_at IS NULL AND p.created_at >= ?
    ),
    has_invite AS (
      SELECT DISTINCT from_user_id AS user_id FROM friend_requests_sent
    )
    SELECT c.wk AS week, COUNT(c.user_id) AS cohort_size,
           SUM(CASE WHEN hi.user_id IS NOT NULL THEN 1 ELSE 0 END) AS invited,
           ROUND(100.0 * SUM(CASE WHEN hi.user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(c.user_id), 1) AS pct
    FROM cohort c LEFT JOIN has_invite hi ON hi.user_id = c.user_id
    GROUP BY c.wk ORDER BY c.wk ASC
  `).bind(new Date(Date.now() - days * 86400000).toISOString()).all();

  // Active users count — approximated as (users with >=1 recipe). Full
  // "AND signed in within 30d" needs Supabase Auth data per-user. The cheap
  // approximation is fine for the dashboard tile; the user table is precise.
  const activeApprox = await args.env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM recipes`
  ).first();

  return json(200, {
    signups_per_day: signups.results || [],
    viral_coef_weekly: viral.results || [],
    activation_curve: activation.results || [],
    loop_completion: loopCompletion.results || [],
    totals: {
      total_users: (totals as any)?.total_users ?? 0,
      active_users_approx: (activeApprox as any)?.n ?? 0,
      total_recipes: (recipeTotals as any)?.total_recipes ?? 0,
      latest_viral_coef: (viral.results || []).at(-1) as any,
    },
  });
}

// ---------------------------------------------------------------------------
// /admin/users/:id/resend-invite — re-send a pending friend invite email
// ---------------------------------------------------------------------------

export interface SendEmailFn {
  (params: { to: string; subject: string; html: string }): Promise<{ ok: boolean }>;
}

async function defaultSendEmail(
  env: { RESEND_API_KEY?: string },
  params: { to: string; subject: string; html: string }
) {
  if (!env.RESEND_API_KEY) return { ok: false };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ReciFriend <hello@recifriend.com>',
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });
  return { ok: res.ok };
}

export async function handleAdminResendInvite(args: {
  env: { DB: D1Database; RESEND_API_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
  body: { inviteId: string };
  sendEmail?: SendEmailFn;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const invite = await args.env.DB.prepare(
    `SELECT p.email AS to_email
     FROM friend_requests_sent frs
     LEFT JOIN profiles p ON p.user_id = frs.to_user_id
     WHERE frs.from_user_id = ? AND frs.to_user_id = ?`
  ).bind(args.userId, args.body.inviteId).first() as { to_email?: string } | null;

  if (!invite || !invite.to_email) return json(404, { code: 'NOT_FOUND' });

  const send = args.sendEmail || ((p) => defaultSendEmail(args.env, p));
  const sendResult = await send({
    to: invite.to_email,
    subject: 'You have an invite waiting on ReciFriend',
    html: `<p>Your friend invited you to ReciFriend. <a href="https://recifriend.com">Open ReciFriend</a></p>`,
  });

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: sendResult.ok ? 'resend_invite' : 'resend_invite_failed',
    targetUserId: args.userId,
    payload: { inviteId: args.body.inviteId, to_email: invite.to_email, email_ok: sendResult.ok },
  });

  if (!sendResult.ok) return json(502, { code: 'EMAIL_SEND_FAILED' });
  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/force-accept
// ---------------------------------------------------------------------------

export async function handleAdminForceAccept(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;             // the user whose pending invite is being accepted (the to_user_id)
  body: { inviteId: string }; // the from_user_id of the friend_request
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  // Look up the inbound pending friend_request: to_user_id = args.userId, from_user_id = inviteId
  const inbound = await args.env.DB.prepare(
    `SELECT to_user_id, from_user_id, from_email, from_name, to_email
     FROM friend_requests
     WHERE to_user_id = ? AND from_user_id = ? AND status = 'pending'`
  ).bind(args.userId, args.body.inviteId).first() as any;

  if (!inbound) return json(404, { code: 'NOT_FOUND' });

  // Target user's display name for the reciprocal friend row
  const toProfile = await args.env.DB.prepare(
    `SELECT display_name FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as any;

  const now = new Date().toISOString();

  // Bilateral friend rows + flip the request status.
  // Mirrors the accept logic in apps/worker/src/index.ts (~line 3119).
  // Deliberate divergence from normal accept (index.ts): UPDATE status instead of DELETE, to preserve the row for the admin audit/drill-down trail. Do not "fix" into a DELETE.
  await args.env.DB.batch([
    args.env.DB.prepare(
      `INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(inbound.to_user_id, inbound.from_user_id, inbound.from_email, inbound.from_name, now),
    args.env.DB.prepare(
      `INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(inbound.from_user_id, inbound.to_user_id, inbound.to_email, toProfile?.display_name || '', now),
    args.env.DB.prepare(
      `UPDATE friend_requests SET status = 'accepted'
       WHERE to_user_id = ? AND from_user_id = ?`
    ).bind(args.userId, args.body.inviteId),
  ]);

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'force_accept',
    targetUserId: args.userId,
    payload: { inviteId: args.body.inviteId, from_user_id: inbound.from_user_id },
  });

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/magic-link — generate a one-time login link
// ---------------------------------------------------------------------------

export async function handleAdminMagicLink(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const profile = await args.env.DB.prepare(
    `SELECT email FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as { email?: string } | null;
  if (!profile?.email) return json(404, { code: 'NOT_FOUND' });

  if (!args.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { code: 'CONFIG' });

  const res = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: profile.email }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json(500, { code: 'SUPABASE_ERROR', detail: text });
  }
  const body = await res.json() as any;
  const url = body.properties?.action_link || body.action_link;

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'generate_magic_link',
    targetUserId: args.userId,
    payload: { email: profile.email },
  });

  return json(200, { url, email: profile.email });
}

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id — edit profile (v1: display_name only)
// ---------------------------------------------------------------------------

export async function handleAdminEditUser(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
  body: { display_name?: string };
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const newName = (args.body.display_name || '').trim();
  if (!newName) return json(400, { code: 'BAD_REQUEST', message: 'display_name required' });
  if (newName.length > 100) return json(400, { code: 'BAD_REQUEST', message: 'display_name too long' });

  const before = await args.env.DB.prepare(
    `SELECT display_name FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as { display_name?: string } | null;
  if (!before) return json(404, { code: 'NOT_FOUND' });

  await args.env.DB.prepare(
    `UPDATE profiles SET display_name = ? WHERE user_id = ?`
  ).bind(newName, args.userId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'edit_profile',
    targetUserId: args.userId,
    payload: { field: 'display_name', from: before.display_name, to: newName },
  });

  return json(200, { ok: true, display_name: newName });
}

export async function handleAdminSoftDelete(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  await args.env.DB.prepare(
    `UPDATE profiles SET deleted_at = ? WHERE user_id = ?`
  ).bind(new Date().toISOString(), args.userId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'soft_delete_user',
    targetUserId: args.userId,
  });

  return json(200, { ok: true });
}
