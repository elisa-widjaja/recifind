import { describe, it, expect, vi } from 'vitest';
import { WHATS_NEW, whatsNewSeenKey, shouldShowWhatsNew, markWhatsNewSeen } from './whatsNew';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-09-21T12:00:00.000Z');
const userCreated = (msAgo) => ({ id: 'u1', created_at: new Date(now - msAgo).toISOString() });
const makeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => { data[k] = String(v); }),
    data,
  };
};
const batch = { version: 7, tips: [] };

describe('WHATS_NEW batch', () => {
  it('has a version and tips with the fields the sheet renders', () => {
    expect(Number.isInteger(WHATS_NEW.version)).toBe(true);
    expect(WHATS_NEW.tips.length).toBeGreaterThan(0);
    for (const tip of WHATS_NEW.tips) {
      expect(tip.id && tip.title && tip.body).toBeTruthy();
      expect(['discover', 'friends', 'recipes']).toContain(tip.action);
    }
  });

  it('uses no em dashes in user-facing copy', () => {
    for (const tip of WHATS_NEW.tips) expect(`${tip.title} ${tip.body}`).not.toContain('—');
  });
});

describe('shouldShowWhatsNew', () => {
  it('is false when logged out', () => {
    expect(shouldShowWhatsNew({ user: null, now, storage: makeStorage(), batch })).toBe(false);
  });

  it('is false for an account younger than 1 hour (first session of a new signup)', () => {
    expect(shouldShowWhatsNew({ user: userCreated(59 * 60 * 1000), now, storage: makeStorage(), batch })).toBe(false);
  });

  it('is true once the account is exactly 1 hour old, and for older accounts', () => {
    expect(shouldShowWhatsNew({ user: userCreated(HOUR), now, storage: makeStorage(), batch })).toBe(true);
    expect(shouldShowWhatsNew({ user: userCreated(90 * 24 * HOUR), now, storage: makeStorage(), batch })).toBe(true);
  });

  it('is false when this batch was already seen on this device', () => {
    const storage = makeStorage({ [whatsNewSeenKey(batch)]: '1' });
    expect(shouldShowWhatsNew({ user: userCreated(5 * HOUR), now, storage, batch })).toBe(false);
  });

  it('shows again for a newer batch version', () => {
    const storage = makeStorage({ [whatsNewSeenKey({ version: 6 })]: '1' });
    expect(shouldShowWhatsNew({ user: userCreated(5 * HOUR), now, storage, batch })).toBe(true);
  });

  it('is false when storage cannot be read (never nag on every launch)', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() };
    expect(shouldShowWhatsNew({ user: userCreated(5 * HOUR), now, storage, batch })).toBe(false);
  });

  it('is false when created_at is missing or unparseable', () => {
    expect(shouldShowWhatsNew({ user: { id: 'u1' }, now, storage: makeStorage(), batch })).toBe(false);
    expect(shouldShowWhatsNew({ user: { id: 'u1', created_at: 'nope' }, now, storage: makeStorage(), batch })).toBe(false);
  });
});

describe('markWhatsNewSeen', () => {
  it('sets the versioned flag', () => {
    const storage = makeStorage();
    markWhatsNewSeen({ storage, batch });
    expect(storage.data[whatsNewSeenKey(batch)]).toBe('1');
    expect(whatsNewSeenKey(batch)).toBe('whats_new_seen_v7');
  });

  it('swallows a storage write error', () => {
    const storage = { getItem: vi.fn(), setItem: () => { throw new Error('quota'); } };
    expect(() => markWhatsNewSeen({ storage, batch })).not.toThrow();
  });
});
