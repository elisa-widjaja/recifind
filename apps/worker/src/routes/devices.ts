import {
  APNS_TOKEN_REGEX,
  DEVICES_REGISTER_RATE_LIMIT_PER_HOUR,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  type UnregisterDeviceRequest,
} from '../../../shared/contracts';

type Env = { DB: D1Database; KV_RATE: KVNamespace };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleRegisterDevice(args: {
  env: Env;
  userId: string;
  body: RegisterDeviceRequest;
}): Promise<Response> {
  const { env, userId, body } = args;

  if (typeof body?.apns_token !== 'string' || !APNS_TOKEN_REGEX.test(body.apns_token)) {
    return json(400, { code: 'BAD_REQUEST', message: 'Invalid apns_token: must be 64 hex characters' });
  }

  // Rate limit: 20 registrations per user per hour
  const key = `dev_reg_rl:${userId}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await env.KV_RATE.get(key);
  const rl = raw ? JSON.parse(raw) as { count: number; resetAt: number } : null;
  const resetAt = rl && rl.resetAt > now ? rl.resetAt : now + 3600;
  const count = (rl && rl.resetAt > now ? rl.count : 0) + 1;

  if (count > DEVICES_REGISTER_RATE_LIMIT_PER_HOUR) {
    return json(429, { code: 'RATE_LIMITED', retry_after_seconds: resetAt - now });
  }

  await env.KV_RATE.put(key, JSON.stringify({ count, resetAt }), { expirationTtl: 3600 });

  await env.DB.prepare(
    `INSERT INTO device_tokens (user_id, apns_token, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, apns_token) DO UPDATE SET created_at = excluded.created_at`
  ).bind(userId, body.apns_token, Date.now()).run();

  const res: RegisterDeviceResponse = { ok: true };
  return json(200, res);
}

export async function handleUnregisterDevice(args: {
  env: Env;
  userId: string;
  body: UnregisterDeviceRequest;
}): Promise<Response> {
  const { env, userId, body } = args;

  if (typeof body?.apns_token !== 'string' || !APNS_TOKEN_REGEX.test(body.apns_token)) {
    return json(400, { code: 'BAD_REQUEST', message: 'Invalid apns_token: must be 64 hex characters' });
  }

  await env.DB.prepare(
    'DELETE FROM device_tokens WHERE user_id = ? AND apns_token = ?'
  ).bind(userId, body.apns_token).run();

  return json(200, { ok: true });
}
