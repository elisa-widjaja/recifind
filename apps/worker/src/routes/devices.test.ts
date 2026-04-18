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
  it('rejects malformed token with 400', async () => {
    const env = mockEnv();
    const res = await handleRegisterDevice({
      env,
      userId: 'u',
      body: { apns_token: 'not-hex' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('accepts a valid 64-char hex token and upserts', async () => {
    const env = mockEnv();
    const res = await handleRegisterDevice({
      env,
      userId: 'u',
      body: { apns_token: 'a'.repeat(64) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(env._inserts.length).toBe(1);
  });

  it('returns 429 when rate limit exceeded', async () => {
    const env = {
      DB: {
        prepare: () => ({ bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }) }),
      },
      KV_RATE: {
        // Simulate already at limit
        get: async () => JSON.stringify({ count: 20, resetAt: Math.floor(Date.now() / 1000) + 3600 }),
        put: async () => {},
      },
    } as any;
    const res = await handleRegisterDevice({
      env,
      userId: 'u',
      body: { apns_token: 'a'.repeat(64) },
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('RATE_LIMITED');
  });
});

describe('DELETE /devices/register', () => {
  it('rejects malformed token with 400', async () => {
    const env = mockEnv();
    const res = await handleUnregisterDevice({
      env,
      userId: 'u',
      body: { apns_token: 'bad' },
    });
    expect(res.status).toBe(400);
  });

  it('scopes DELETE to the authenticated user', async () => {
    const env = mockEnv();
    await handleUnregisterDevice({
      env,
      userId: 'u',
      body: { apns_token: 'a'.repeat(64) },
    });
    expect(env._deletes[0]).toEqual(['u', 'a'.repeat(64)]);
  });
});
