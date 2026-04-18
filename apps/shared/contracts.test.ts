import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HOSTS,
  APNS_TOKEN_REGEX,
  CUSTOM_SCHEME_PROTOCOL,
  IOS,
  RECIPE_ID_REGEX,
  UNIVERSAL_LINK_ORIGIN,
} from './contracts';

describe('Shared contracts', () => {
  it('iOS identifiers are consistent', () => {
    expect(IOS.SHARE_EXT_BUNDLE_ID.startsWith(IOS.BUNDLE_ID + '.')).toBe(true);
    expect(UNIVERSAL_LINK_ORIGIN).toBe('https://recifriend.com');
    expect(CUSTOM_SCHEME_PROTOCOL).toBe(`${IOS.URL_SCHEME}:`);
    expect(IOS.ASSOCIATED_DOMAIN).toBe(`applinks:recifriend.com`);
  });

  it('ALLOWED_HOSTS matches Universal Link origin', () => {
    expect(ALLOWED_HOSTS.has(new URL(UNIVERSAL_LINK_ORIGIN).host)).toBe(true);
  });

  it('APNS_TOKEN_REGEX accepts valid tokens', () => {
    expect(APNS_TOKEN_REGEX.test('a'.repeat(64))).toBe(true);
    expect(APNS_TOKEN_REGEX.test('a'.repeat(63))).toBe(false);
    expect(APNS_TOKEN_REGEX.test('g'.repeat(64))).toBe(false);
  });

  it('RECIPE_ID_REGEX accepts realistic ids and rejects path traversal', () => {
    expect(RECIPE_ID_REGEX.test('abc123')).toBe(true);
    expect(RECIPE_ID_REGEX.test('seed-trend-01')).toBe(true);
    expect(RECIPE_ID_REGEX.test('../../../etc/passwd')).toBe(false);
    expect(RECIPE_ID_REGEX.test('')).toBe(false);
  });
});
