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
