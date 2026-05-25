import { describe, it, expect } from 'vitest';
import { buildRecipeShareUrl, buildRecipeAppDeepLink, SHARE_PUBLIC_URL } from './shareUrl';

describe('buildRecipeShareUrl', () => {
  it('emits the path form with recipe in the path + user query', () => {
    expect(buildRecipeShareUrl('r1', 'u1')).toBe(
      'https://recifriend.com/recipes/r1?user=u1'
    );
  });

  it('omits ?user= when there is no owner', () => {
    expect(buildRecipeShareUrl('r1', null)).toBe('https://recifriend.com/recipes/r1');
    expect(buildRecipeShareUrl('r1')).toBe('https://recifriend.com/recipes/r1');
  });

  it('falls back to the site URL when there is no recipe id', () => {
    expect(buildRecipeShareUrl(null, 'u1')).toBe(SHARE_PUBLIC_URL);
    expect(buildRecipeShareUrl(undefined)).toBe(SHARE_PUBLIC_URL);
  });

  it('URL-encodes ids/owners with special chars', () => {
    expect(buildRecipeShareUrl('a b/c', 'u@x')).toBe(
      'https://recifriend.com/recipes/a%20b%2Fc?user=u%40x'
    );
  });

  it('uses /recipes/{id} path so iOS treats it as a Universal Link', () => {
    const u = new URL(buildRecipeShareUrl('r1', 'u1'));
    expect(u.pathname).toBe('/recipes/r1');
    expect(u.searchParams.get('user')).toBe('u1');
  });
});

describe('buildRecipeAppDeepLink', () => {
  it('deep-links to the recipe detail with owner', () => {
    expect(buildRecipeAppDeepLink('r1', 'u1')).toBe('recifriend://recipes/r1?user=u1');
  });

  it('omits ?user= when there is no owner', () => {
    expect(buildRecipeAppDeepLink('r1', null)).toBe('recifriend://recipes/r1');
    expect(buildRecipeAppDeepLink('r1')).toBe('recifriend://recipes/r1');
  });

  it('falls back to the recipes list when there is no recipe id', () => {
    expect(buildRecipeAppDeepLink(null, 'u1')).toBe('recifriend://recipes');
    expect(buildRecipeAppDeepLink(undefined)).toBe('recifriend://recipes');
  });

  it('URL-encodes ids/owners with special chars', () => {
    expect(buildRecipeAppDeepLink('a b/c', 'u@x')).toBe('recifriend://recipes/a%20b%2Fc?user=u%40x');
  });
});
