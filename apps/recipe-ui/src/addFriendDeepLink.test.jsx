import { describe, it, expect, beforeEach } from 'vitest';
import { captureAddFriendParam } from './App.jsx';

describe('add_friend deep link capture', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('stashes pending_add_friend and strips the param from the URL', () => {
    const url = new URL('https://recifriend.com/?add_friend=elisa-id');
    const storage = { items: {}, setItem(k, v) { this.items[k] = v; }, getItem(k) { return this.items[k] ?? null; } };
    const result = captureAddFriendParam(url, storage);
    expect(result).toBe('elisa-id');
    expect(storage.items['pending_add_friend']).toBe('elisa-id');
    expect(url.searchParams.has('add_friend')).toBe(false);
  });

  it('returns null and sets nothing when the param is absent', () => {
    const url = new URL('https://recifriend.com/');
    const storage = { items: {}, setItem(k, v) { this.items[k] = v; }, getItem(k) { return this.items[k] ?? null; } };
    const result = captureAddFriendParam(url, storage);
    expect(result).toBeNull();
    expect(Object.keys(storage.items)).toHaveLength(0);
  });
});
