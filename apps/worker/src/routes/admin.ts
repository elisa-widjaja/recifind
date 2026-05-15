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
