import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureRegistered, getCurrentApnsToken, hasPromptedForPermission } from './pushClient';

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn((event, cb) => {
      globalThis.__pushCb = globalThis.__pushCb ?? {};
      globalThis.__pushCb[event] = cb;
      return Promise.resolve({ remove: () => {} });
    }),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';

describe('ensureRegistered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__pushCb = {};
  });

  it('does not prompt if already granted', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    expect(PushNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(PushNotifications.register).toHaveBeenCalled();
  });

  it('prompts once if permission is prompt-able', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    PushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
    Preferences.get.mockResolvedValue({ value: null });
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    expect(PushNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'push_prompted', value: 'true' });
  });

  it('does not re-prompt on prior denial, but still registers so the app shows in Settings', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'denied' });
    Preferences.get.mockResolvedValue({ value: 'true' });
    const api = { register: vi.fn() };
    await ensureRegistered({ api, jwt: 't' });
    // Denied: never re-prompt — Apple only shows the native dialog once.
    expect(PushNotifications.requestPermissions).not.toHaveBeenCalled();
    // But always register, so ReciFriend appears in Settings → Notifications and
    // the user can re-enable later. Skipping this was a re-grant dead-end.
    expect(PushNotifications.register).toHaveBeenCalled();
  });

  it('registers token with backend on `registration` event', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    await globalThis.__pushCb['registration']({ value: 'a'.repeat(64) });
    expect(api.register).toHaveBeenCalledWith({ apns_token: 'a'.repeat(64) });
  });
});

describe('getCurrentApnsToken', () => {
  it('returns the most recent token registered in this session', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    const tok = 'b'.repeat(64);
    await globalThis.__pushCb['registration']({ value: tok });
    expect(getCurrentApnsToken()).toBe(tok);
  });
});
