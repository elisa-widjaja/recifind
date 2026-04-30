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
  it('accepts auth callback via custom scheme (PKCE-safe on native)', () => {
    expect(parseDeepLink('recifriend://auth/callback?code=abc123')).toEqual({
      kind: 'auth_callback', code: 'abc123',
    });
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
  it('extracts accept_friend query param into accept_id', () => {
    expect(parseDeepLink('https://recifriend.com/friend-requests?accept_friend=user-abc')).toEqual({
      kind: 'friend_requests',
      accept_id: 'user-abc',
    });
  });
  it('omits accept_id when accept_friend param is absent', () => {
    const result = parseDeepLink('https://recifriend.com/friend-requests?other=x');
    expect(result).toEqual({ kind: 'friend_requests' });
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

describe('parseDeepLink — path prefix confusion guards (security)', () => {
  it('rejects /auth/callback-evil (prefix lookalike)', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback-evil?code=abc')).toBeNull();
  });
  it('rejects /auth/callbackevil (prefix lookalike, no separator)', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callbackevil?code=abc')).toBeNull();
  });
  it('rejects /auth/callback/extra (prefix + extra segment)', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback/extra?code=abc')).toBeNull();
  });
  it('accepts /auth/callback/ (trailing slash is fine)', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback/?code=abc')).toEqual({ kind: 'auth_callback', code: 'abc' });
  });
  it('rejects /add-recipe-evil (prefix lookalike)', () => {
    expect(parseDeepLink('https://recifriend.com/add-recipe-evil?url=https://x')).toBeNull();
  });
  it('rejects /add-recipe/extra (prefix + extra segment)', () => {
    expect(parseDeepLink('https://recifriend.com/add-recipe/extra?url=https://x')).toBeNull();
  });
  it('accepts /add-recipe/ (trailing slash is fine)', () => {
    expect(parseDeepLink('https://recifriend.com/add-recipe/?url=https%3A%2F%2Ftiktok.com%2Fabc')).toEqual({ kind: 'add_recipe', url: 'https://tiktok.com/abc' });
  });
});

describe('parseDeepLink — port + encoding guards', () => {
  it('rejects explicit port on Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com:8080/recipes/abc')).toBeNull();
  });
  it('rejects invalid percent-encoding in recipe id (decode throws)', () => {
    // Shouldn't throw; should return null
    expect(parseDeepLink('https://recifriend.com/recipes/%ZZ')).toBeNull();
  });
  it('rejects custom scheme without // (recifriend:recipes/123)', () => {
    expect(parseDeepLink('recifriend:recipes/123')).toBeNull();
  });
});

describe('parseDeepLink — /add-recipe with optional title', () => {
  it('parses url only (backward compatible)', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x',
    });
  });
  it('parses url and title', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=Creamy%20pasta')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x', title: 'Creamy pasta',
    });
  });
  it('ignores empty title', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x',
    });
  });
  it('caps absurdly long title at 200 chars', () => {
    const long = 'a'.repeat(500);
    const result = parseDeepLink(`recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=${long}`);
    expect(result?.kind).toBe('add_recipe');
    expect((result as { title?: string }).title?.length).toBe(200);
  });
  it('ignores whitespace-only title', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=%20%20%20')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x',
    });
  });
});

describe('parseDeepLink — /open-pending-share', () => {
  it('accepts via custom scheme', () => {
    expect(parseDeepLink('recifriend://open-pending-share')).toEqual({
      kind: 'open_pending_share',
    });
  });
  it('accepts trailing slash', () => {
    expect(parseDeepLink('recifriend://open-pending-share/')).toEqual({
      kind: 'open_pending_share',
    });
  });
  it('ignores query params on this path', () => {
    expect(parseDeepLink('recifriend://open-pending-share?foo=bar')).toEqual({
      kind: 'open_pending_share',
    });
  });
});
