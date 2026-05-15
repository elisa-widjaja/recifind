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
