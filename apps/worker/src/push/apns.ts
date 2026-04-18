import type { ApnsPayload } from '../../../shared/contracts';

export type ApnsEnv = {
  DB: D1Database;
  APNS_AUTH_KEY_P8: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_HOST?: string; // defaults to api.push.apple.com (prod)
};

// JWT is cached in-memory for up to 50 min (APNs max is 60 min).
let cachedJwt: { token: string; expiresAt: number } | null = null;

// Exported so tests can inject a no-op signer without a real P8 key
export type JwtSigner = (env: ApnsEnv) => Promise<string>;

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeBase64UrlJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  const buf = new TextEncoder().encode(json);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

export async function signApnsJwt(params: {
  keyId: string;
  teamId: string;
  p8: string;
}): Promise<string> {
  const keyBuf = pemToArrayBuffer(params.p8);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuf,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const header = encodeBase64UrlJson({ alg: 'ES256', kid: params.keyId });
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeBase64UrlJson({ iss: params.teamId, iat: now });

  const signingInput = `${header}.${payload}`;
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(sigBuf)}`;
}

async function defaultGetJwt(env: ApnsEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;
  const token = await signApnsJwt({
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    p8: env.APNS_AUTH_KEY_P8,
  });
  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

export async function sendPushToUser(
  env: ApnsEnv,
  userId: string,
  msg: { title: string; body: string; deepLink: string },
  _getJwt: JwtSigner = defaultGetJwt
): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT apns_token FROM device_tokens WHERE user_id = ?'
  ).bind(userId).all<{ apns_token: string }>();

  const tokens = rows.results ?? [];
  if (tokens.length === 0) return;

  const jwt = await _getJwt(env);
  const host = env.APNS_HOST ?? 'api.push.apple.com';
  const payload: ApnsPayload = {
    aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' },
    deep_link: msg.deepLink,
  };

  await Promise.all(tokens.map(async ({ apns_token }) => {
    const res = await fetch(`https://${host}/3/device/${apns_token}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': env.APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 410 || res.status === 400) {
      // BadDeviceToken or Unregistered — clean up
      let reason = '';
      try { reason = (await res.json() as { reason?: string }).reason ?? ''; } catch { /* ignore */ }
      if (
        reason === 'BadDeviceToken' ||
        reason === 'Unregistered' ||
        reason === 'DeviceTokenNotForTopic'
      ) {
        await env.DB.prepare(
          'DELETE FROM device_tokens WHERE apns_token = ?'
        ).bind(apns_token).run();
      }
    }
    // Non-410/400 errors: log and move on (silent failure is fine; next push will retry)
  }));
}
