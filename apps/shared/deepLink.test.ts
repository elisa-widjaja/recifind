import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './deepLink';

describe('parseDeepLink — reject anything outside our scheme + host', () => {
  it('rejects javascript: URL', () => {
    expect(parseDeepLink('javascript:alert(1)')).toBeNull();
  });
  it('rejects data: URL', () => {
    expect(parseDeepLink('data:text/html,<script>alert(1)</script>')).toBeNull();
  });
  it('rejects file: URL', () => {
    expect(parseDeepLink('file:///etc/passwd')).toBeNull();
  });
  it('rejects http:// (not our origin)', () => {
    expect(parseDeepLink('http://evil.com/add-recipe?url=x')).toBeNull();
  });
  it('rejects https:// on wrong host', () => {
    expect(parseDeepLink('https://evil.com/add-recipe?url=https://foo')).toBeNull();
  });
  it('rejects unknown custom scheme', () => {
    expect(parseDeepLink('otherapp://recipes/123')).toBeNull();
  });
  it('rejects completely malformed URL', () => {
    expect(parseDeepLink('not-a-url')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
  });
});

describe('parseDeepLink — /recipes/:id', () => {
  it('accepts valid recipe id via Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('accepts valid recipe id via www subdomain', () => {
    expect(parseDeepLink('https://www.recifriend.com/recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('accepts valid recipe id via custom scheme (non-sensitive)', () => {
    expect(parseDeepLink('recifriend://recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('rejects path traversal in recipe id', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/../../etc/passwd')).toBeNull();
  });
  it('rejects overly long recipe id', () => {
    const long = 'a'.repeat(65);
    expect(parseDeepLink(`https://recifriend.com/recipes/${long}`)).toBeNull();
  });
  it('rejects recipe id with special chars', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/abc!def')).toBeNull();
    expect(parseDeepLink('https://recifriend.com/recipes/abc%20def')).toBeNull();
  });
});

describe('parseDeepLink — /auth/callback', () => {
  it('accepts via Universal Link with code', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback?code=abc123')).toEqual({
      kind: 'auth_callback', code: 'abc123',
    });
  });
  it('REJECTS auth callback via custom scheme (security: S1)', () => {
    expect(parseDeepLink('recifriend://auth/callback?code=abc123')).toBeNull();
  });
  it('rejects if code missing', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback')).toBeNull();
  });
});

describe('parseDeepLink — /add-recipe', () => {
  it('accepts http URL in url param', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fabc')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/abc',
    });
  });
  it('rejects non-http url param', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=javascript%3Aalert(1)')).toBeNull();
    expect(parseDeepLink('recifriend://add-recipe?url=file%3A%2F%2Fetc%2Fpasswd')).toBeNull();
  });
  it('rejects missing url param', () => {
    expect(parseDeepLink('recifriend://add-recipe')).toBeNull();
    expect(parseDeepLink('recifriend://add-recipe?url=')).toBeNull();
  });
});

describe('parseDeepLink — /friend-requests', () => {
  it('accepts via Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com/friend-requests')).toEqual({ kind: 'friend_requests' });
  });
  it('accepts via custom scheme', () => {
    expect(parseDeepLink('recifriend://friend-requests')).toEqual({ kind: 'friend_requests' });
  });
});

describe('parseDeepLink — unknown paths', () => {
  it('rejects /admin', () => {
    expect(parseDeepLink('https://recifriend.com/admin')).toBeNull();
  });
  it('rejects /../etc/passwd', () => {
    expect(parseDeepLink('https://recifriend.com/../etc/passwd')).toBeNull();
  });
});
