export function isAdminEmail(email: string | undefined, adminEmails: string | undefined): boolean {
  if (!email || !adminEmails) return false;
  const target = email.trim().toLowerCase();
  return adminEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

export type ImageStatus = 'none' | 'hosted' | 'stale';

// Classify a recipe's image_url for the admin UI. The Supabase public-URL marker
// is a stable substring, so no env is needed. Used to gate the per-recipe
// "Re-host" button (only meaningful for a 'stale' external image).
export function deriveImageStatus(imageUrl: string | null | undefined): ImageStatus {
  const u = (imageUrl || '').trim();
  if (!u) return 'none';
  if (u.includes('/storage/v1/object/public/')) return 'hosted';
  return 'stale';
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

  const recipes = await getRecommendedRecipes(args.env.DB, profileUserId, 6);
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
  '0': 'COALESCE(s.recipe_count,0) = 0',
  '1-9': 'COALESCE(s.recipe_count,0) BETWEEN 1 AND 9',
  '10-19': 'COALESCE(s.recipe_count,0) BETWEEN 10 AND 19',
  '20-49': 'COALESCE(s.recipe_count,0) BETWEEN 20 AND 49',
  '50+': 'COALESCE(s.recipe_count,0) >= 50',
};

// Activity expressions (julianday so ISO `…T…Z` values compare correctly vs 'now').
const IS_ACTIVE_EXPR =
  `p.deleted_at IS NULL AND COALESCE(s.recipe_count,0) >= 1 ` +
  `AND s.last_sign_in_at IS NOT NULL ` +
  `AND julianday(s.last_sign_in_at) >= julianday('now','-30 days')`;
const CAME_BACK_EXPR =
  `julianday(COALESCE(s.last_sign_in_at, p.created_at)) - julianday(p.created_at) > (5.0/1440.0)`;
const GHOST_EXPR = `COALESCE(s.recipe_count,0) = 0 AND NOT (${CAME_BACK_EXPR})`;

export function buildUsersListQuery(p: UsersListParams): BuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  if (p.activity === 'soft_deleted') {
    where.push('p.deleted_at IS NOT NULL');
  } else {
    where.push('p.deleted_at IS NULL');
  }

  if (p.search) {
    where.push('(p.email LIKE ? OR p.display_name LIKE ?)');
    params.push(`%${p.search}%`, `%${p.search}%`);
  }
  if (p.signupAfter) { where.push('p.created_at >= ?'); params.push(p.signupAfter); }
  if (p.signupBefore) { where.push('p.created_at <= ?'); params.push(p.signupBefore); }
  if (p.recipeBucket && RECIPE_BUCKETS[p.recipeBucket]) where.push(RECIPE_BUCKETS[p.recipeBucket]);

  if (p.activity === 'active') where.push(`(${IS_ACTIVE_EXPR})`);
  else if (p.activity === 'ghost') where.push(`(${GHOST_EXPR})`);
  else if (p.activity === 'inactive') where.push(`NOT (${IS_ACTIVE_EXPR}) AND NOT (${GHOST_EXPR})`);
  // 'soft_deleted' is already covered by the base deleted_at filter above.

  const orderBy = p.sort === 'signup_asc' ? 'p.created_at ASC' : 'p.created_at DESC';

  const sql = `
    SELECT
      p.user_id      AS id,
      p.email        AS email,
      p.display_name AS display_name,
      p.created_at   AS signed_up_at,
      p.deleted_at   AS deleted_at,
      COALESCE(s.recipe_count, 0) AS recipe_count,
      COALESCE(s.friends_count, 0) AS invites_accepted,
      s.last_sign_in_at AS last_sign_in_at,
      CASE WHEN ${IS_ACTIVE_EXPR} THEN 1 ELSE 0 END AS is_active
    FROM profiles p
    LEFT JOIN admin_user_stats s ON s.user_id = p.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `.trim();

  params.push(p.limit, p.offset);
  return { sql, params };
}

const ALLOWED_ACTIVITY = new Set(['active', 'inactive', 'ghost', 'soft_deleted']);
const ALLOWED_BUCKET = new Set(['0', '1-9', '10-19', '20-49', '50+']);
const ALLOWED_SORT = new Set(['signup_desc', 'signup_asc']);

// Page through Supabase Auth admin users → Map<user_id, last_sign_in_at|null>.
export async function fetchAllSupabaseLastSignIn(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return out;
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!res.ok) throw new Error(`supabase list users failed: ${res.status}`);
    const body = (await res.json()) as { users?: Array<{ id: string; last_sign_in_at?: string | null }> };
    const users = body.users || [];
    for (const u of users) out.set(u.id, u.last_sign_in_at ?? null);
    if (users.length < perPage) break;
  }
  return out;
}

// Recompute admin_user_stats for every profile. Counts come from D1 (authoritative);
// last_sign_in from a batched Supabase call. If Supabase fails, counts are still
// written and existing last_sign_in_at values are PRESERVED (not blanked).
export async function syncAdminUserStats(
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }
): Promise<{ users: number }> {
  const now = new Date().toISOString();

  const [recipeRows, friendRows, profileRows] = await Promise.all([
    env.DB.prepare(`SELECT user_id, COUNT(*) AS n FROM recipes GROUP BY user_id`).all(),
    env.DB.prepare(`SELECT user_id, COUNT(DISTINCT friend_id) AS n FROM friends GROUP BY user_id`).all(),
    env.DB.prepare(`SELECT user_id FROM profiles`).all(),
  ]);

  const recipeCounts = new Map<string, number>();
  for (const r of (recipeRows.results as any[]) || []) recipeCounts.set(r.user_id, r.n);
  const friendCounts = new Map<string, number>();
  for (const r of (friendRows.results as any[]) || []) friendCounts.set(r.user_id, r.n);

  let lastSignIn = new Map<string, string | null>();
  let gotSignIn = false;
  try {
    lastSignIn = await fetchAllSupabaseLastSignIn(env);
    gotSignIn = true;
  } catch (err) {
    console.error('[admin] syncAdminUserStats: supabase fetch failed; writing counts only', err);
  }

  // On success, refresh last_sign_in_at too. On failure, leave it untouched for
  // existing rows (and NULL for brand-new ones).
  const upsertSql = gotSignIn
    ? `INSERT INTO admin_user_stats (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         recipe_count = excluded.recipe_count,
         friends_count = excluded.friends_count,
         last_sign_in_at=excluded.last_sign_in_at,
         synced_at = excluded.synced_at`
    : `INSERT INTO admin_user_stats (user_id, recipe_count, friends_count, last_sign_in_at, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         recipe_count = excluded.recipe_count,
         friends_count = excluded.friends_count,
         synced_at = excluded.synced_at`;

  const stmt = env.DB.prepare(upsertSql);
  const profileIds = ((profileRows.results as any[]) || []).map((r) => r.user_id as string);
  const batch = profileIds.map((id) =>
    stmt.bind(id, recipeCounts.get(id) ?? 0, friendCounts.get(id) ?? 0, lastSignIn.get(id) ?? null, now)
  );
  if (batch.length) await env.DB.batch(batch);
  return { users: batch.length };
}

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
  const users = results || [];

  return json(200, {
    users,
    page: {
      limit,
      offset,
      returned: users.length,
      has_more: users.length === limit,
    },
  });
}

// KV key + TTL for the cached global Users-page counts. Written hourly by the
// cron (computeUserCounts) and served by handleAdminUserCounts. 6h TTL is a
// safety net well above the 1h cron cadence.
export const USER_COUNTS_KV_KEY = 'admin:user-counts:v1';
export const USER_COUNTS_TTL = 6 * 60 * 60;

export interface UserCounts {
  total: number;
  recipes: Record<'0' | '1-9' | '10-19' | '20-49' | '50+', number>;
  activity: Record<'active' | 'inactive' | 'ghost' | 'soft_deleted', number>;
  signup: Record<'1' | '7' | '30' | '90', number>;
  computed_at: string;
}

// Single aggregate over every profile. Each tally is scoped to non-deleted rows
// except `soft_deleted`. active/ghost/inactive partition the non-deleted set
// (disjoint, sum to total) using the SAME expressions as the list filters, so a
// bucket's count equals what you'd get by selecting that filter. Signup windows
// are cumulative (last-7d subset of last-30d), matching the list's signupAfter filter.
export function buildUserCountsQuery(): string {
  return `
    SELECT
      SUM(CASE WHEN p.deleted_at IS NULL THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN p.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS soft_deleted,

      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['0']} THEN 1 ELSE 0 END) AS r0,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['1-9']} THEN 1 ELSE 0 END) AS r1_9,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['10-19']} THEN 1 ELSE 0 END) AS r10_19,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['20-49']} THEN 1 ELSE 0 END) AS r20_49,
      SUM(CASE WHEN p.deleted_at IS NULL AND ${RECIPE_BUCKETS['50+']} THEN 1 ELSE 0 END) AS r50p,

      SUM(CASE WHEN ${IS_ACTIVE_EXPR} THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN p.deleted_at IS NULL AND (${GHOST_EXPR}) THEN 1 ELSE 0 END) AS ghost,
      SUM(CASE WHEN p.deleted_at IS NULL AND NOT (${IS_ACTIVE_EXPR}) AND NOT (${GHOST_EXPR}) THEN 1 ELSE 0 END) AS inactive,

      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-1 days') THEN 1 ELSE 0 END) AS d1,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-7 days') THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-30 days') THEN 1 ELSE 0 END) AS d30,
      SUM(CASE WHEN p.deleted_at IS NULL AND julianday(p.created_at) >= julianday('now','-90 days') THEN 1 ELSE 0 END) AS d90
    FROM profiles p
    LEFT JOIN admin_user_stats s ON s.user_id = p.user_id
  `.trim();
}

export async function computeUserCounts(env: { DB: D1Database }): Promise<UserCounts> {
  const row = (await env.DB.prepare(buildUserCountsQuery()).first()) as Record<string, number> | null;
  const n = (k: string): number => Number(row?.[k] ?? 0);
  return {
    total: n('total'),
    recipes: { '0': n('r0'), '1-9': n('r1_9'), '10-19': n('r10_19'), '20-49': n('r20_49'), '50+': n('r50p') },
    activity: { active: n('active'), inactive: n('inactive'), ghost: n('ghost'), soft_deleted: n('soft_deleted') },
    signup: { '1': n('d1'), '7': n('d7'), '30': n('d30'), '90': n('d90') },
    computed_at: new Date().toISOString(),
  };
}

export async function handleAdminUserCounts(args: {
  env: { DB: D1Database; AI_PICKS_CACHE: KVNamespace };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const cached = (await args.env.AI_PICKS_CACHE.get(USER_COUNTS_KV_KEY, { type: 'json' })) as UserCounts | null;
  if (cached) return json(200, cached);

  const counts = await computeUserCounts(args.env);
  await args.env.AI_PICKS_CACHE.put(USER_COUNTS_KV_KEY, JSON.stringify(counts), { expirationTtl: USER_COUNTS_TTL });
  return json(200, counts);
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
    `SELECT id, title, source_url, image_url, created_at, hidden_at, shared_with_friends
     FROM recipes WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(args.userId).all();

  // 3. Last 20 cook events
  const cookEvents = await args.env.DB.prepare(
    `SELECT ce.recipe_id, ce.cooked_at AS created_at, r.title AS recipe_title, r.source_url AS recipe_source_url
     FROM cook_events ce
     JOIN recipes r ON r.id = ce.recipe_id AND r.user_id = ce.user_id
     WHERE ce.user_id = ? ORDER BY ce.cooked_at DESC LIMIT 20`
  ).bind(args.userId).all();

  // 4. Invite conversions: real model is the reusable invite LINK. Each successful
  // claim writes a row to open_invite_used. friend_requests_sent is dormant (0 rows).
  const conversions = await args.env.DB.prepare(
    `SELECT
       oiu.accepter_user_id AS invitee_user_id,
       COALESCE(f.friend_email, p.email) AS invitee_email,
       COALESCE(f.friend_name, p.display_name) AS invitee_name,
       oiu.accepted_at AS accepted_at,
       p.deleted_at AS invitee_deleted_at,
       CASE WHEN f.user_id IS NOT NULL THEN 'accepted' ELSE 'accepted_disconnected' END AS status,
       (SELECT COUNT(*) FROM recipes r WHERE r.user_id = oiu.accepter_user_id) AS invitee_recipe_count
     FROM open_invite_used oiu
     LEFT JOIN friends f ON f.user_id = oiu.inviter_user_id AND f.friend_id = oiu.accepter_user_id
     LEFT JOIN profiles p ON p.user_id = oiu.accepter_user_id
     WHERE oiu.inviter_user_id = ?
     ORDER BY oiu.accepted_at DESC`
  ).bind(args.userId).all();

  // 4b. The user's active reusable invite link (for the summary header)
  const inviteLinkRow = await args.env.DB.prepare(
    `SELECT token, created_at FROM open_invites WHERE inviter_user_id = ? LIMIT 1`
  ).bind(args.userId).first();

  // 5. Pending invites received
  const pendingReceived = await args.env.DB.prepare(
    `SELECT fr.from_user_id, fr.from_email, fr.created_at
     FROM friend_requests fr
     WHERE fr.to_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  ).bind(args.userId).all();

  // 6. Recent shares this user sent. recipe_shares.created_at is epoch ms.
  //    Sharing never copies a recipe — a share row just references an existing
  //    recipe id (which is unique), so join on id alone, the same way the app
  //    looks up a shared recipe. Matching on r.user_id = sharer would miss
  //    re-shares (recipes the user received then shared on, whose id belongs to
  //    the original owner). A deleted recipe still yields a null title. The
  //    recipient profile join is independent. One row per recipient.
  const shares = await args.env.DB.prepare(
    `SELECT rs.recipe_id, rs.created_at, rs.recipient_id,
            r.title AS recipe_title, r.source_url AS recipe_source_url,
            COALESCE(p.display_name, p.email) AS recipient_name
     FROM recipe_shares rs
     LEFT JOIN recipes r ON r.id = rs.recipe_id
     LEFT JOIN profiles p ON p.user_id = rs.recipient_id
     WHERE rs.sharer_id = ?
     ORDER BY rs.created_at DESC LIMIT 50`
  ).bind(args.userId).all();

  // Enrich conversions with last_sign_in (recipe count already comes from SQL)
  const enrichedConversions = await Promise.all((conversions.results || []).map(async (row: any) => {
    let lastSignInAt: string | null = null;
    if (args.env.SUPABASE_SERVICE_ROLE_KEY && row.invitee_user_id) {
      try {
        const r = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/users/${row.invitee_user_id}`, {
          headers: {
            Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        });
        if (r.ok) lastSignInAt = (await r.json() as any).last_sign_in_at;
      } catch (err) {
        console.error('[admin] drilldown invitee enrichment failed', { userId: row.invitee_user_id, err });
      }
    }
    return { ...row, last_sign_in_at: lastSignInAt };
  }));

  // Live last_sign_in_at for this one user (cheap; keeps detail precise vs the
  // hourly-synced list value).
  let profileLastSignInAt: string | null = null;
  if (args.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/users/${args.userId}`, {
        headers: {
          Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      if (r.ok) profileLastSignInAt = ((await r.json()) as any).last_sign_in_at ?? null;
    } catch (err) {
      console.error('[admin] drilldown profile last_sign_in fetch failed', { userId: args.userId, err });
    }
  }

  return json(200, {
    profile: { ...(profile as any), last_sign_in_at: profileLastSignInAt },
    recipes: (recipes.results || []).map((r: any) => ({ ...r, image_status: deriveImageStatus(r.image_url) })),
    cook_events: cookEvents.results || [],
    shares: shares.results || [],
    invite_conversions: enrichedConversions,
    invite_link: inviteLinkRow ? { token: inviteLinkRow.token, created_at: inviteLinkRow.created_at } : null,
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

// Owner / test accounts excluded from all growth & retention metrics so the
// numbers reflect real users only.
export const METRICS_EXCLUDED_EMAILS = [
  'elisa.widjaja@gmail.com',
  'elisa_widjaja@hotmail.com',
  'mochislime02@gmail.com',
];

// Growth counters for a rolling window of `days`. Returns one row:
//   signups, activated_24h, new_saves, re_saves
// new vs re-save: every recipe id is globally unique, so re-saves can't be found
// in the recipes table. A re-save instead leaves one `friend_saved_your_recipe`
// notification whose data JSON carries the saver id + the saver's new copy id.
// A recipe row matches that notification => re-save; otherwise => new save.
// excludeEmails are resolved to user_ids via the `excluded` CTE and removed from
// every count (for re-saves the saver IS recipes.user_id, so this also drops
// re-saves performed by the owner's own accounts).
export function buildGrowthCountersQuery(days: number, excludeEmails: string[] = []): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      saves AS (
        SELECT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.type = 'friend_saved_your_recipe'
            AND json_extract(n.data, '$.recipeId') = r.id
            AND json_extract(n.data, '$.saverId') = r.user_id
        ) AS is_resave
        FROM recipes r
        WHERE r.created_at >= ?
          AND r.user_id NOT IN (SELECT user_id FROM excluded)
      ),
      cohort AS (
        SELECT user_id, created_at AS signup_at
        FROM profiles
        WHERE deleted_at IS NULL AND created_at >= ?
          AND user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT
        (SELECT COUNT(*) FROM cohort) AS signups,
        (SELECT COUNT(*) FROM cohort c
           WHERE EXISTS (
             SELECT 1 FROM recipes r
             WHERE r.user_id = c.user_id
               AND r.created_at >= c.signup_at
               AND r.created_at <= datetime(c.signup_at, '+1 day')
           )) AS activated_24h,
        (SELECT COALESCE(SUM(CASE WHEN is_resave THEN 0 ELSE 1 END), 0) FROM saves) AS new_saves,
        (SELECT COALESCE(SUM(CASE WHEN is_resave THEN 1 ELSE 0 END), 0) FROM saves) AS re_saves
    `.trim(),
    params: [...excludeEmails, since, since],
  };
}

// Daily signup cohorts on/after `sinceIso`, with how many returned to create a
// recipe on a LATER calendar day. Newest cohort first. Excludes the same accounts.
export function buildRetentionCohortsQuery(sinceIso: string, excludeEmails: string[] = []): BuiltQuery {
  const since = sinceIso;
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      cohort AS (
        SELECT user_id, DATE(created_at) AS day
        FROM profiles
        WHERE deleted_at IS NULL AND created_at >= ?
          AND user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT c.day AS day,
             COUNT(*) AS cohort_size,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM recipes r
               WHERE r.user_id = c.user_id AND DATE(r.created_at) > c.day
             ) THEN 1 ELSE 0 END) AS returned
      FROM cohort c
      GROUP BY c.day
      ORDER BY c.day DESC
    `.trim(),
    params: [...excludeEmails, since],
  };
}

// Weekly buckets are anchored to the launch-announcement date so "week 1" is
// always the launch week, regardless of when the dashboard is viewed.
export const LAUNCH_DATE = '2026-05-26';

// SQL: 0-based week index of `col` relative to the anchor (bound param).
// (julianday diff) / 7, floored — week 0 = anchor .. anchor+6 days, etc.
const WEEK_INDEX = (col: string) => `CAST((julianday(${col}) - julianday(?)) / 7 AS INTEGER)`;

// The contiguous list of weeks since the launch anchor (oldest first), as
// { idx, week } where week is the ISO date that starts that bucket. Always
// returns at least `minWeeks` (padding future weeks so the frame is visible).
export function launchWeeks(anchorIso: string, minWeeks: number): Array<{ idx: number; week: string }> {
  const anchor = new Date(anchorIso + 'T00:00:00Z').getTime();
  const currentIdx = Math.floor((Date.now() - anchor) / (7 * 86400000));
  const count = Math.max(minWeeks, currentIdx + 1);
  const out: Array<{ idx: number; week: string }> = [];
  for (let i = 0; i < count; i++) {
    out.push({ idx: i, week: new Date(anchor + i * 7 * 86400000).toISOString().slice(0, 10) });
  }
  return out;
}

// Weekly signups + 24h-activation, bucketed by week-since-launch. Excludes accounts.
export function buildWeeklySignupsActivationQuery(anchorIso: string, excludeEmails: string[] = []): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      cohort AS (
        SELECT user_id, created_at AS signup_at, ${WEEK_INDEX('created_at')} AS week_idx
        FROM profiles
        WHERE deleted_at IS NULL AND created_at >= ?
          AND user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT c.week_idx AS week_idx,
             COUNT(*) AS signups,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM recipes r
               WHERE r.user_id = c.user_id
                 AND r.created_at >= c.signup_at
                 AND r.created_at <= datetime(c.signup_at, '+1 day')
             ) THEN 1 ELSE 0 END) AS activated_24h
      FROM cohort c
      GROUP BY c.week_idx
      ORDER BY c.week_idx ASC
    `.trim(),
    params: [...excludeEmails, anchorIso, anchorIso],
  };
}

// Weekly new vs re-saves, bucketed by week-since-launch. Excludes accounts.
// Re-save = matches a friend_saved_your_recipe notification (see buildGrowthCountersQuery).
export function buildWeeklySavesQuery(anchorIso: string, excludeEmails: string[] = []): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      WITH excluded AS (
        SELECT user_id FROM profiles WHERE ${excludedFilter}
      ),
      saves AS (
        SELECT ${WEEK_INDEX('r.created_at')} AS week_idx,
          EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.type = 'friend_saved_your_recipe'
              AND json_extract(n.data, '$.recipeId') = r.id
              AND json_extract(n.data, '$.saverId') = r.user_id
          ) AS is_resave
        FROM recipes r
        WHERE r.created_at >= ?
          AND r.user_id NOT IN (SELECT user_id FROM excluded)
      )
      SELECT week_idx,
             COALESCE(SUM(CASE WHEN is_resave THEN 0 ELSE 1 END), 0) AS new_saves,
             COALESCE(SUM(CASE WHEN is_resave THEN 1 ELSE 0 END), 0) AS re_saves
      FROM saves
      GROUP BY week_idx
      ORDER BY week_idx ASC
    `.trim(),
    params: [...excludeEmails, anchorIso, anchorIso],
  };
}

// Floor for seed-shelf attribution. The worker shipped the seeded "Suggested
// friends" tier on 2026-06-08 (web gets the correct UX same day; iOS only from a
// post-seed build 31+). Connections before this are the seeds' pre-existing real
// friendships, not shelf-driven. Bump to the App Store approval date if you want
// the official window to start when the full UX is live on iOS.
export const SEED_SHELF_LAUNCH = '2026-06-08';

// Per-seed conversion funnel, floored at `launchIso`:
//   requestsPending -- requests to the seed still awaiting acceptance. Resolved
//                     request rows are deleted on accept/decline, so this is the
//                     live pending set.
//   connections     -- accepted connections to the seed (friends.connected_at).
//   activated       -- connectors who saved >=1 recipe AFTER connecting. Counts
//                     hidden recipes too, matching the existing has_recipe
//                     activation metric (activation = the act of saving).
// Caller derives intent = requestsPending + connections. `excludeEmails` drops
// owner/test requesters & connectors (same idiom as the other metric builders).
export function buildSeedFunnelQuery(
  seedUserId: string,
  launchIso: string,
  excludeEmails: string[] = []
): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM friend_requests fr
         WHERE fr.to_user_id = ? AND fr.created_at >= ? AND fr.status = 'pending'
           AND fr.from_user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      ) AS requestsPending,
      (SELECT COUNT(*) FROM friends f
         WHERE f.friend_id = ? AND f.connected_at >= ?
           AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      ) AS connections,
      (SELECT COUNT(*) FROM friends f
         WHERE f.friend_id = ? AND f.connected_at >= ?
           AND f.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
           AND EXISTS (SELECT 1 FROM recipes r
                       WHERE r.user_id = f.user_id AND r.created_at >= f.connected_at)
      ) AS activated
  `.trim();
  const params = [
    seedUserId, launchIso, ...excludeEmails,
    seedUserId, launchIso, ...excludeEmails,
    seedUserId, launchIso, ...excludeEmails,
  ];
  return { sql, params };
}

// GET /admin/metrics/seed-conversions
// Funnel of cold-start conversions driven by the seeded "Suggested friends"
// shelf, per seed and overall. `seeds` is passed in from index.ts
// (SEEDED_SUGGESTIONS) so this stays a single source of truth without importing
// from index.ts (which would be circular).
export async function handleAdminSeedConversions(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
  seeds: ReadonlyArray<{ email: string; label: string }>;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const emails = args.seeds.map((s) => s.email);
  const ph = emails.map(() => '?').join(', ');
  const resolved = emails.length
    ? await args.env.DB
        .prepare(`SELECT user_id AS userId, email FROM profiles WHERE email IN (${ph})`)
        .bind(...emails)
        .all<{ userId: string; email: string }>()
    : { results: [] as Array<{ userId: string; email: string }> };
  const idByEmail = new Map((resolved.results || []).map((r) => [r.email, r.userId]));

  const seeds: Array<{
    label: string; email: string; userId: string | null;
    requestsPending: number; connections: number; activated: number; intent: number;
  }> = [];
  let tReq = 0, tConn = 0, tAct = 0;

  for (const s of args.seeds) {
    const userId = idByEmail.get(s.email) ?? null;
    let requestsPending = 0, connections = 0, activated = 0;
    if (userId) {
      // METRICS_EXCLUDED_EMAILS is applied to the requester/connector side only
      // (NOT IN from_user_id / user_id), not to the seed target. Both seed emails
      // are in that list, so a request/connection BETWEEN the two seeds (founder <->
      // top contributor) is excluded, while real users connecting TO a seed count.
      const q = buildSeedFunnelQuery(userId, SEED_SHELF_LAUNCH, METRICS_EXCLUDED_EMAILS);
      const row = await args.env.DB.prepare(q.sql).bind(...q.params)
        .first<{ requestsPending: number; connections: number; activated: number }>();
      requestsPending = Number(row?.requestsPending ?? 0);
      connections = Number(row?.connections ?? 0);
      activated = Number(row?.activated ?? 0);
    }
    const intent = requestsPending + connections;
    tReq += requestsPending; tConn += connections; tAct += activated;
    seeds.push({ label: s.label, email: s.email, userId, requestsPending, connections, activated, intent });
  }

  return json(200, {
    launchFloor: SEED_SHELF_LAUNCH,
    seeds,
    totals: { requestsPending: tReq, connections: tConn, activated: tAct, intent: tReq + tConn },
  });
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

  // Growth counters (1d / 7d / 30d) + daily retention cohorts (last 30d).
  // METRICS_EXCLUDED_EMAILS is defined in this same module (no import needed).
  const runCounters = (d: number) => {
    const q = buildGrowthCountersQuery(d, METRICS_EXCLUDED_EMAILS);
    return args.env.DB.prepare(q.sql).bind(...q.params).first();
  };
  const retQ = buildRetentionCohortsQuery(LAUNCH_DATE, METRICS_EXCLUDED_EMAILS);
  // Weekly series anchored at the launch date (week 1 = launch week).
  const wSAQ = buildWeeklySignupsActivationQuery(LAUNCH_DATE, METRICS_EXCLUDED_EMAILS);
  const wSavesQ = buildWeeklySavesQuery(LAUNCH_DATE, METRICS_EXCLUDED_EMAILS);
  const [g1, g7, g30, retention, weeklySARows, weeklySavesRows] = await Promise.all([
    runCounters(1),
    runCounters(7),
    runCounters(30),
    args.env.DB.prepare(retQ.sql).bind(...retQ.params).all(),
    args.env.DB.prepare(wSAQ.sql).bind(...wSAQ.params).all(),
    args.env.DB.prepare(wSavesQ.sql).bind(...wSavesQ.params).all(),
  ]);

  const pct = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : 0);
  const toWindow = (row: any) => {
    const signups = row?.signups ?? 0;
    const activated = row?.activated_24h ?? 0;
    return {
      signups,
      activated_24h: activated,
      activated_pct: pct(activated, signups),
      new_saves: row?.new_saves ?? 0,
      re_saves: row?.re_saves ?? 0,
    };
  };
  const retention_cohorts = ((retention.results as any[]) || []).map((r) => ({
    day: r.day,
    cohort_size: r.cohort_size,
    returned: r.returned,
    returned_pct: pct(r.returned, r.cohort_size),
  }));

  // Weeks since launch (>= 4), zero-filled, keyed by week index from the anchor.
  const weeks = launchWeeks(LAUNCH_DATE, 4);
  const saByIdx = new Map(((weeklySARows.results as any[]) || []).map((r) => [r.week_idx, r]));
  const savesByIdx = new Map(((weeklySavesRows.results as any[]) || []).map((r) => [r.week_idx, r]));
  const weekly_signups_activation = weeks.map(({ idx, week }) => {
    const r = saByIdx.get(idx);
    return { week, signups: r?.signups ?? 0, activated_24h: r?.activated_24h ?? 0 };
  });
  const weekly_saves = weeks.map(({ idx, week }) => {
    const r = savesByIdx.get(idx);
    return { week, new_saves: r?.new_saves ?? 0, re_saves: r?.re_saves ?? 0 };
  });

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
    growth: {
      windows: { '1d': toWindow(g1), '7d': toWindow(g7), '30d': toWindow(g30) },
      retention_cohorts,
      weekly_signups_activation,
      weekly_saves,
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

// ---------------------------------------------------------------------------
// POST /admin/recipes/:id/hide — soft-hide a recipe from public/friend feeds
// ---------------------------------------------------------------------------

export async function handleAdminHideRecipe(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  recipeId: string;
  body: { reason?: string };
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  await args.env.DB.prepare(
    `UPDATE recipes SET hidden_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), args.recipeId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'hide_recipe',
    targetRecipeId: args.recipeId,
    payload: args.body.reason ? { reason: args.body.reason } : undefined,
  });

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// POST /admin/recipes/:id/unhide — restore a soft-hidden recipe to feeds
// ---------------------------------------------------------------------------

export async function handleAdminUnhideRecipe(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  recipeId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  await args.env.DB.prepare(
    `UPDATE recipes SET hidden_at = NULL WHERE id = ?`
  ).bind(args.recipeId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'unhide_recipe',
    targetRecipeId: args.recipeId,
  });

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// GET /admin/recipes/search — find recipes by title, grouped by recipe identity
// ---------------------------------------------------------------------------
//
// There is no canonical "recipe" entity: saving a recipe inserts a fresh row
// per user (composite PK user_id+id). Copies are linked only by a shared
// source_url (imported recipes); user-typed recipes have no link, so we fall
// back to grouping by exact (case-insensitive) title. Grouping happens in JS so
// a recipe's owners are never split across the SQL LIMIT boundary.

export function buildRecipeSearchQuery(p: { q: string; limit: number }): BuiltQuery {
  const sql = `
    SELECT
      r.id                  AS id,
      r.user_id             AS user_id,
      r.title               AS title,
      r.source_url          AS source_url,
      r.image_url           AS image_url,
      r.created_at          AS created_at,
      r.hidden_at           AS hidden_at,
      r.shared_with_friends AS shared_with_friends,
      p.email               AS owner_email,
      p.display_name        AS owner_display_name
    FROM recipes r
    LEFT JOIN profiles p ON p.user_id = r.user_id
    WHERE r.title LIKE ?
    ORDER BY r.title COLLATE NOCASE ASC, r.created_at DESC
    LIMIT ?
  `.trim();
  return { sql, params: [`%${p.q}%`, p.limit] };
}

export async function handleAdminSearchRecipes(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const q = (args.url.searchParams.get('q') || '').trim();
  if (!q) {
    return json(200, { groups: [], page: { returned: 0, has_more: false } });
  }

  // Title search is selective; cap the raw scan and group the rows in memory.
  const ROW_CAP = 1000;
  const MAX_GROUPS = 100;
  const { sql, params } = buildRecipeSearchQuery({ q, limit: ROW_CAP });
  const { results } = await args.env.DB.prepare(sql).bind(...params).all();
  const rows = (results || []) as any[];

  const groups = new Map<string, any>();
  for (const r of rows) {
    const src = (r.source_url || '').trim();
    const key = src ? `url:${src}` : `title:${(r.title || '').trim().toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, title: r.title, source_url: src || null, owner_count: 0, hidden_count: 0, owners: [] };
      groups.set(key, g);
    }
    g.owners.push({
      id: r.id,
      user_id: r.user_id,
      email: r.owner_email || null,
      display_name: r.owner_display_name || null,
      created_at: r.created_at,
      shared_with_friends: r.shared_with_friends,
      hidden_at: r.hidden_at || null,
      image_status: deriveImageStatus(r.image_url),
    });
    g.owner_count += 1;
    if (r.hidden_at) g.hidden_count += 1;
  }

  const all = Array.from(groups.values());
  for (const g of all) {
    g.owners.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  // Most-saved recipes first, then alphabetical.
  all.sort((a, b) => b.owner_count - a.owner_count || String(a.title).localeCompare(String(b.title)));
  const limited = all.slice(0, MAX_GROUPS);

  return json(200, {
    groups: limited,
    page: {
      returned: limited.length,
      has_more: all.length > MAX_GROUPS || rows.length === ROW_CAP,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /admin/audit-log — read-only reverse-chron list of admin mutations
// ---------------------------------------------------------------------------

export async function handleAdminAuditLog(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const limit = Math.min(parseInt(args.url.searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(args.url.searchParams.get('offset') || '0', 10);
  const adminEmail = args.url.searchParams.get('adminEmail') || undefined;
  const action = args.url.searchParams.get('action') || undefined;

  const where: string[] = [];
  const params: unknown[] = [];
  if (adminEmail) { where.push('admin_email = ?'); params.push(adminEmail); }
  if (action) { where.push('action = ?'); params.push(action); }
  const sql = `SELECT id, admin_email, action, target_user_id, target_recipe_id, payload, created_at
               FROM admin_audit_log
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await args.env.DB.prepare(sql).bind(...params).all();
  return json(200, { entries: rows.results || [], page: { limit, offset } });
}

// ---------------------------------------------------------------------------
// POST /admin/nudge/requeue — reset still-0-recipe previously-sent nudge rows so the
// cron re-sends them with a fresh A/B variant. Idempotent.
// ---------------------------------------------------------------------------

export async function handleAdminNudgeRequeue(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;
  const now = new Date().toISOString();
  const r = await args.env.DB.prepare(
    `UPDATE nudge_emails
     SET sent = 0, sent_at = NULL, variant = NULL, send_after = ?
     WHERE sent = 1 AND user_id NOT IN (SELECT DISTINCT user_id FROM recipes)`
  ).bind(now).run();
  const requeued = (r as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  return json(200, { requeued });
}

// ---------------------------------------------------------------------------
// GET /admin/metrics/nudge-ab — per-variant (v1/v2) nudge activation funnel
// ---------------------------------------------------------------------------

export function buildNudgeAbQuery(excludeEmails: string[] = []): BuiltQuery {
  const ph = excludeEmails.map(() => '?').join(', ');
  const excludedFilter = excludeEmails.length ? `email IN (${ph})` : '0';
  return {
    sql: `
      SELECT n.variant AS variant,
             COUNT(*) AS sent,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM recipes r
               WHERE r.user_id = n.user_id AND r.created_at >= n.sent_at
             ) THEN 1 ELSE 0 END) AS activated
      FROM nudge_emails n
      WHERE n.sent = 1
        AND n.variant IN ('v1','v2')
        AND n.user_id NOT IN (SELECT user_id FROM profiles WHERE ${excludedFilter})
      GROUP BY n.variant
    `.trim(),
    params: [...excludeEmails],
  };
}

export async function handleAdminNudgeAb(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;
  const q = buildNudgeAbQuery(METRICS_EXCLUDED_EMAILS);
  const rows = await args.env.DB.prepare(q.sql).bind(...q.params)
    .all<{ variant: string; sent: number; activated: number }>();
  const rate = (a: number, s: number) => (s > 0 ? Math.round((a / s) * 1000) / 1000 : 0);
  const variants = (rows.results || []).map(r => ({
    variant: r.variant, sent: Number(r.sent), activated: Number(r.activated),
    rate: rate(Number(r.activated), Number(r.sent)),
  }));
  const sent = variants.reduce((a, v) => a + v.sent, 0);
  const activated = variants.reduce((a, v) => a + v.activated, 0);
  return json(200, { variants, totals: { sent, activated, rate: rate(activated, sent) } });
}
