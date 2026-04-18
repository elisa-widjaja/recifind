import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendPushToUser, signApnsJwt } from './apns';

// Stub JWT signer — avoids needing a real P8 key in unit tests
const stubGetJwt = async () => 'stub-header.stub-payload.stub-sig';

function makeEnv(overrideDB?: object) {
  return {
    DB: overrideDB ?? {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => ({ results: sql.includes('FROM device_tokens')
            ? [{ apns_token: 'a'.repeat(64) }, { apns_token: 'b'.repeat(64) }]
            : [] }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }),
    },
    APNS_AUTH_KEY_P8: 'FAKE_KEY',
    APNS_KEY_ID: 'ABC1234567',
    APNS_TEAM_ID: 'TEAM123456',
    APNS_BUNDLE_ID: 'com.recifriend.app',
    APNS_HOST: 'api.sandbox.push.apple.com',
  } as any;
}

describe('sendPushToUser', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  it('sends one APNs request per device token for that user', async () => {
    await sendPushToUser(makeEnv(), 'u-1', {
      title: 'ReciFriend',
      body: 'test',
      deepLink: 'https://recifriend.com/recipes/r1',
    }, stubGetJwt);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('includes aps.alert.title + body + deep_link in payload', async () => {
    await sendPushToUser(makeEnv(), 'u-1', {
      title: 'ReciFriend', body: 'hi', deepLink: 'https://recifriend.com/friend-requests',
    }, stubGetJwt);
    const firstCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(firstCall[1].body);
    expect(body.aps.alert).toEqual({ title: 'ReciFriend', body: 'hi' });
    expect(body.aps.sound).toBe('default');
    expect(body.deep_link).toBe('https://recifriend.com/friend-requests');
  });

  it('sets apns-topic header to bundle id', async () => {
    await sendPushToUser(makeEnv(), 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' }, stubGetJwt);
    const firstCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[1].headers['apns-topic']).toBe('com.recifriend.app');
  });

  it('deletes tokens that return BadDeviceToken (410)', async () => {
    const runs: { sql: string; args: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: [{ apns_token: 'dead' + 'a'.repeat(60) }] }),
          run: async () => { runs.push({ sql, args }); return { success: true, meta: { changes: 1 } }; },
        }),
      }),
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 410 })
    );
    await sendPushToUser(makeEnv(db), 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' }, stubGetJwt);
    const deleteCall = runs.find(r => r.sql.includes('DELETE FROM device_tokens'));
    expect(deleteCall).toBeTruthy();
  });

  it('is a no-op when user has no device tokens', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    };
    await sendPushToUser(makeEnv(db), 'u-1', { title: 'x', body: 'y', deepLink: 'https://recifriend.com/a' }, stubGetJwt);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('signApnsJwt', () => {
  it('produces a three-segment JWT', async () => {
    // Generate a real EC P-256 key for testing
    const key = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', key.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;

    const jwt = await signApnsJwt({
      keyId: 'ABC1234567',
      teamId: 'TEAM123456',
      p8: pem,
    });
    expect(jwt.split('.').length).toBe(3);
  });
});
