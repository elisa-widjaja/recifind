# Story 05 — Push Notifications Backend (Worker + APNs)

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Build the server-side half of push notifications: D1 table, device-registration endpoints, APNs JWT signer, and a `sendPushToUser` module used by three triggers (friend request, recipe saved, recipe shared). Verified via unit tests + a dry-run against the APNs development environment.

**Depends on:** Story 01 (rebrand), Story 02 (contracts)
**Blocks:** Gate G2, Story 11 (iOS push client)
**Can develop in parallel with:** Stories 03, 04, 06, 07, 08

**Contracts consumed:** C2 Device registration, C4 APNs payload, C5 iOS identifiers (bundle ID)
**Contracts produced:** `sendPushToUser(env, userId, {title, body, deepLink})` module imported by Story 03, 11, and existing friend-request and save handlers

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/worker/migrations/006_device_tokens.sql` | D1 migration |
| Create | `apps/worker/src/push/apns.ts` | APNs JWT + sender module |
| Create | `apps/worker/src/push/apns.test.ts` | Unit tests (mocks fetch to APNs) |
| Create | `apps/worker/src/routes/devices.ts` | `POST/DELETE /devices/register` handlers |
| Create | `apps/worker/src/routes/devices.test.ts` | Unit tests |
| Modify | `apps/worker/src/index.ts` | Wire endpoints + integrate push into existing triggers. Marker: `// === [S05] Device registration + push triggers ===` … `// === [/S05] ===` |
| Modify | `apps/worker/wrangler.toml` | Declare `APNS_*` secrets (placeholders, no values in git) |

---

## Task 1: D1 migration

- [ ] **Step 1:** Create `apps/worker/migrations/006_device_tokens.sql`

```sql
CREATE TABLE IF NOT EXISTS device_tokens (
  user_id TEXT NOT NULL,
  apns_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, apns_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
```

- [ ] **Step 2:** Apply locally + remotely

```bash
cd apps/worker
npx wrangler d1 execute recipes-db --local  --file=migrations/006_device_tokens.sql
npx wrangler d1 execute recipes-db --remote --file=migrations/006_device_tokens.sql
```

- [ ] **Step 3:** Commit

```bash
git add apps/worker/migrations/006_device_tokens.sql
git commit -m "feat(db): add device_tokens table"
```

## Task 2: APNs module tests (TDD)

- [ ] **Step 1:** Create `apps/worker/src/push/apns.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendPushToUser, signApnsJwt } from './apns';

const ENV = {
  DB: {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: sql.includes('FROM device_tokens')
          ? [{ apns_token: 'a'.repeat(64) }, { apns_token: 'b'.repeat(64) }]
          : [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  },
  APNS_AUTH_KEY_P8: `-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEXAMPLE...\n-----END PRIVATE KEY-----`,
  APNS_KEY_ID: 'ABC1234567',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_BUNDLE_ID: 'com.recifriend.app',
  APNS_HOST: 'api.sandbox.push.apple.com',  // dev env
} as any;

describe('sendPushToUser', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  it('sends one APNs request per device token for that user', async () => {
    await sendPushToUser(ENV, 'u-1', {
      title: 'ReciFriend',
      body: 'test',
      deepLink: 'https://recifriend.com/recipes/r1',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('includes aps.alert.title + body + deep_link in payload', async () => {
    await sendPushToUser(ENV, 'u-1', {
      title: 'ReciFriend', body: 'hi', deepLink: 'https://recifriend.com/friend-requests',
    });
    const firstCall = fetch.mock.calls[0];
    const body = JSON.parse(firstCall[1].body);
    expect(body.aps.alert).toEqual({ title: 'ReciFriend', body: 'hi' });
    expect(body.aps.sound).toBe('default');
    expect(body.deep_link).toBe('https://recifriend.com/friend-requests');
  });

  it('sets apns-topic header to bundle id', async () => {
    await sendPushToUser(ENV, 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' });
    const firstCall = fetch.mock.calls[0];
    expect(firstCall[1].headers['apns-topic']).toBe('com.recifriend.app');
  });

  it('deletes tokens that return BadDeviceToken (410)', async () => {
    const runs: unknown[] = [];
    const env = {
      ...ENV,
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            all: async () => ({ results: [{ apns_token: 'dead' + 'a'.repeat(60) }] }),
            run: async () => { runs.push({ sql, args }); return { success: true, meta: { changes: 1 } }; },
          }),
        }),
      },
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 410 }));
    await sendPushToUser(env, 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' });
    const deleteCall = runs.find(r => (r as any).sql.includes('DELETE FROM device_tokens'));
    expect(deleteCall).toBeTruthy();
  });

  it('is a no-op when user has no device tokens', async () => {
    const env = {
      ...ENV,
      DB: {
        prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
      },
    };
    await sendPushToUser(env, 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('signApnsJwt', () => {
  it('produces a three-segment JWT', async () => {
    const jwt = await signApnsJwt({
      keyId: 'ABC1234567',
      teamId: 'TEAM123456',
      p8: ENV.APNS_AUTH_KEY_P8,
    });
    expect(jwt.split('.').length).toBe(3);
  });
});
```

- [ ] **Step 2:** Run — expect all fail

```bash
cd apps/worker && npm test -- apns
```

- [ ] **Step 3:** Commit

```bash
git add apps/worker/src/push/apns.test.ts
git commit -m "test(apns): failing tests for push module"
```

## Task 3: Implement APNs module

- [ ] **Step 1:** Create `apps/worker/src/push/apns.ts`

```typescript
import { SignJWT, importPKCS8 } from 'jose';
import type { ApnsPayload } from '../../../shared/contracts';

type Env = {
  DB: D1Database;
  APNS_AUTH_KEY_P8: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_HOST?: string;  // defaults to api.push.apple.com (prod)
};

// JWT is cached in-memory for up to 50 min (APNs max is 60 min).
let cachedJwt: { token: string; expiresAt: number } | null = null;

export async function signApnsJwt(params: {
  keyId: string;
  teamId: string;
  p8: string;
}): Promise<string> {
  const key = await importPKCS8(params.p8, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: params.keyId })
    .setIssuer(params.teamId)
    .setIssuedAt()
    .sign(key);
  return token;
}

async function getJwt(env: Env): Promise<string> {
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
  env: Env,
  userId: string,
  msg: { title: string; body: string; deepLink: string }
): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT apns_token FROM device_tokens WHERE user_id = ?'
  ).bind(userId).all<{ apns_token: string }>();

  const tokens = rows.results ?? [];
  if (tokens.length === 0) return;

  const jwt = await getJwt(env);
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
      try { reason = (await res.json() as any).reason ?? ''; } catch {}
      if (reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') {
        await env.DB.prepare(
          'DELETE FROM device_tokens WHERE apns_token = ?'
        ).bind(apns_token).run();
      }
    }
    // Non-410/400 errors: log and move on (silent failure is fine; tomorrow's push will retry)
  }));
}
```

- [ ] **Step 2:** Tests pass

```bash
cd apps/worker && npm test -- apns
```

- [ ] **Step 3:** Commit

```bash
git add apps/worker/src/push/apns.ts
git commit -m "feat(apns): implement sendPushToUser with JWT caching"
```

## Task 4: Device registration endpoints

- [ ] **Step 1:** Create `apps/worker/src/routes/devices.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { handleRegisterDevice, handleUnregisterDevice } from './devices';

function mockEnv() {
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (sql.includes('INSERT')) inserts.push(args);
            else if (sql.includes('DELETE')) deletes.push(args);
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    },
    KV_RATE: {
      get: async () => null,
      put: async () => {},
    },
    _inserts: inserts,
    _deletes: deletes,
  } as any;
}

describe('POST /devices/register', () => {
  it('rejects malformed token', async () => {
    const env = mockEnv();
    const res = await handleRegisterDevice({ env, userId: 'u', body: { apns_token: 'not-hex' } });
    expect(res.status).toBe(400);
  });

  it('accepts a valid token and upserts', async () => {
    const env = mockEnv();
    const res = await handleRegisterDevice({ env, userId: 'u', body: { apns_token: 'a'.repeat(64) } });
    expect(res.status).toBe(200);
    expect(env._inserts.length).toBe(1);
  });
});

describe('DELETE /devices/register', () => {
  it('scopes DELETE to the authenticated user', async () => {
    const env = mockEnv();
    await handleUnregisterDevice({ env, userId: 'u', body: { apns_token: 'a'.repeat(64) } });
    expect(env._deletes[0]).toEqual(['u', 'a'.repeat(64)]);
  });
});
```

- [ ] **Step 2:** Create `apps/worker/src/routes/devices.ts`

```typescript
import {
  APNS_TOKEN_REGEX,
  DEVICES_REGISTER_RATE_LIMIT_PER_HOUR,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  type UnregisterDeviceRequest,
} from '../../../shared/contracts';

type Env = { DB: D1Database; KV_RATE: KVNamespace };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleRegisterDevice(args: {
  env: Env; userId: string; body: RegisterDeviceRequest;
}): Promise<Response> {
  const { env, userId, body } = args;
  if (typeof body?.apns_token !== 'string' || !APNS_TOKEN_REGEX.test(body.apns_token)) {
    return json(400, { code: 'BAD_REQUEST' });
  }

  // Rate limit
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
  env: Env; userId: string; body: UnregisterDeviceRequest;
}): Promise<Response> {
  const { env, userId, body } = args;
  if (typeof body?.apns_token !== 'string' || !APNS_TOKEN_REGEX.test(body.apns_token)) {
    return json(400, { code: 'BAD_REQUEST' });
  }
  await env.DB.prepare(
    'DELETE FROM device_tokens WHERE user_id = ? AND apns_token = ?'
  ).bind(userId, body.apns_token).run();
  return json(200, { ok: true });
}
```

- [ ] **Step 3:** Tests pass

```bash
npm test -- devices
```

- [ ] **Step 4:** Commit

```bash
git add apps/worker/src/routes/devices.ts apps/worker/src/routes/devices.test.ts
git commit -m "feat(devices): register/unregister endpoints with rate limit"
```

## Task 5: Secrets setup

- [ ] **Step 1:** Download `.p8` from Apple Developer → Certificates → Keys → create new key with APNs enabled.

- [ ] **Step 2:** Save `.p8` to 1Password (or offline secure storage) — this is the **only** copy Apple allows.

- [ ] **Step 3:** Set Cloudflare Worker secrets (dev/sandbox first)

```bash
cd apps/worker
cat /path/to/AuthKey_ABC1234567.p8 | npx wrangler secret put APNS_AUTH_KEY_P8
echo 'ABC1234567' | npx wrangler secret put APNS_KEY_ID
echo 'TEAM123456' | npx wrangler secret put APNS_TEAM_ID
echo 'com.recifriend.app' | npx wrangler secret put APNS_BUNDLE_ID
# APNS_HOST is only set if you want sandbox; otherwise default to api.push.apple.com
```

- [ ] **Step 4:** Do NOT add any of these to `wrangler.toml` as plaintext. Only the names exist in config; values live in Cloudflare secrets.

- [ ] **Step 5:** Record in `docs/runbooks/apns-setup.md`:
  - Key ID
  - Team ID (public info, still)
  - Date the key was created
  - Location of .p8 backup (1Password vault reference, NOT the key itself)

## Task 6: Wire endpoints + existing trigger points

- [ ] **Step 1:** Edit `apps/worker/src/index.ts`:

```typescript
// === [S05] Device registration + push triggers ===
import { handleRegisterDevice, handleUnregisterDevice } from './routes/devices';
import { sendPushToUser } from './push/apns';

// ...inside the router:
if (url.pathname === '/devices/register') {
  const body = await request.json();
  if (request.method === 'POST') return await handleRegisterDevice({ env, userId, body });
  if (request.method === 'DELETE') return await handleUnregisterDevice({ env, userId, body });
}
// === [/S05] ===
```

- [ ] **Step 2:** Integrate push into friend-request handler (existing) — find the POST friend-request handler and add, inside S05 markers:

```typescript
// === [S05] ===
const requester = await env.DB.prepare('SELECT display_name FROM profiles WHERE id = ?').bind(userId).first<{ display_name?: string }>();
await sendPushToUser(env, targetUserId, {
  title: 'ReciFriend',
  body: `${requester?.display_name ?? 'Someone'} wants to connect on ReciFriend`,
  deepLink: 'https://recifriend.com/friend-requests',
});
// === [/S05] ===
```

- [ ] **Step 3:** Integrate into save handler — find `POST /recipes/:id/save`:

```typescript
// === [S05] ===
const saver = await env.DB.prepare('SELECT display_name FROM profiles WHERE id = ?').bind(userId).first<{ display_name?: string }>();
const recipe = await env.DB.prepare('SELECT owner_id, title FROM recipes WHERE id = ?').bind(recipeId).first<{ owner_id: string; title?: string }>();
if (recipe && recipe.owner_id !== userId) {
  await sendPushToUser(env, recipe.owner_id, {
    title: 'ReciFriend',
    body: `${saver?.display_name ?? 'Someone'} saved your ${recipe.title ?? 'recipe'}`,
    deepLink: `https://recifriend.com/recipes/${recipeId}`,
  });
}
// === [/S05] ===
```

- [ ] **Step 4:** Deploy + smoke test

```bash
cd apps/worker && npx wrangler deploy
# Register a device token via curl (simulate iOS registration)
curl -X POST https://api.recifriend.com/devices/register \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d "{\"apns_token\":\"$(openssl rand -hex 32)\"}"
# Expected: { ok: true }
```

- [ ] **Step 5:** Commit

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): wire device registration + integrate push into triggers"
```

## Acceptance criteria (Gate G2)

- [ ] All apns.test.ts and devices.test.ts tests pass
- [ ] Migration applied locally + remotely
- [ ] `POST /devices/register` accepts valid APNs token (64 hex chars), rejects malformed
- [ ] Rate limit works (21st registration/hour returns 429)
- [ ] `DELETE /devices/register` scoped to authenticated user only
- [ ] `sendPushToUser` calls APNs with correct headers (`apns-topic`, `apns-push-type`, ES256 JWT)
- [ ] BadDeviceToken response deletes the row
- [ ] Secrets set in Cloudflare Workers; nothing in git
- [ ] S05 markers wrap all edits in `apps/worker/src/index.ts`

## Commit checklist

- `feat(db): add device_tokens table`
- `test(apns): failing tests ...`
- `feat(apns): implement sendPushToUser ...`
- `feat(devices): register/unregister endpoints ...`
- `feat(worker): wire device registration + integrate push ...`
