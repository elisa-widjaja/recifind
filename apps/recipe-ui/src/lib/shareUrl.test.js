import { describe, it, expect } from 'vitest';
import { buildRecipeShareUrl, SHARE_PUBLIC_URL } from './shareUrl';

describe('buildRecipeShareUrl', () => {
  it('emits the query form with recipe + user', () => {
    expect(buildRecipeShareUrl('r1', 'u1')).toBe(
      'https://recifriend.com?recipe=r1&user=u1'
    );
  });

  it('omits ?user= when there is no owner', () => {
    expect(buildRecipeShareUrl('r1', null)).toBe('https://recifriend.com?recipe=r1');
    expect(buildRecipeShareUrl('r1')).toBe('https://recifriend.com?recipe=r1');
  });

  it('falls back to the site URL when there is no recipe id', () => {
    expect(buildRecipeShareUrl(null, 'u1')).toBe(SHARE_PUBLIC_URL);
    expect(buildRecipeShareUrl(undefined)).toBe(SHARE_PUBLIC_URL);
  });

  it('URL-encodes ids/owners with special chars', () => {
    expect(buildRecipeShareUrl('a b/c', 'u@x')).toBe(
      'https://recifriend.com?recipe=a%20b%2Fc&user=u%40x'
    );
  });

  it('stays on path "/" (NOT /recipes/*) so iOS does not Universal-Link it', () => {
    const u = new URL(buildRecipeShareUrl('r1', 'u1'));
    expect(u.pathname).toBe('/');
    expect(u.searchParams.get('recipe')).toBe('r1');
    expect(u.searchParams.get('user')).toBe('u1');
  });
});
