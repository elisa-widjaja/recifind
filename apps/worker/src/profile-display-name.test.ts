import { describe, it, expect } from 'vitest';
import { deriveDisplayName, displayNameFromClaims, isAppleRelayEmail, GENERIC_DISPLAY_NAME } from './index';

describe('isAppleRelayEmail', () => {
  it('detects Apple private-relay addresses', () => {
    expect(isAppleRelayEmail('69bzcjwj7k@privaterelay.appleid.com')).toBe(true);
    expect(isAppleRelayEmail('USER@PRIVATERELAY.APPLEID.COM')).toBe(true);
  });
  it('returns false for normal emails and missing values', () => {
    expect(isAppleRelayEmail('jane@gmail.com')).toBe(false);
    expect(isAppleRelayEmail(undefined)).toBe(false);
    expect(isAppleRelayEmail(null)).toBe(false);
  });
});

describe('displayNameFromClaims', () => {
  it('prefers user_metadata.full_name', () => {
    expect(displayNameFromClaims({ user_metadata: { full_name: 'Jane Doe', name: 'jdoe' } })).toBe('Jane Doe');
  });
  it('falls back to user_metadata.name then top-level name', () => {
    expect(displayNameFromClaims({ user_metadata: { name: 'jdoe' } })).toBe('jdoe');
    expect(displayNameFromClaims({ name: 'Top Level' })).toBe('Top Level');
  });
  it('returns null when no usable name present', () => {
    expect(displayNameFromClaims({})).toBeNull();
    expect(displayNameFromClaims({ user_metadata: { full_name: '   ' } })).toBeNull();
    expect(displayNameFromClaims(undefined)).toBeNull();
  });
});

describe('deriveDisplayName', () => {
  it('uses the real OAuth name when available', () => {
    expect(deriveDisplayName('69bzcjwj7k@privaterelay.appleid.com', { user_metadata: { full_name: 'Jane Doe' } }))
      .toBe('Jane Doe');
  });
  it('uses the local part for a normal email with no claims name', () => {
    expect(deriveDisplayName('jane@gmail.com')).toBe('jane');
  });
  it('returns null for a relay email with no name (so reads fall back to the generic)', () => {
    expect(deriveDisplayName('69bzcjwj7k@privaterelay.appleid.com')).toBeNull();
  });
  it('returns null when there is neither email nor name', () => {
    expect(deriveDisplayName(undefined, {})).toBeNull();
  });
});

describe('GENERIC_DISPLAY_NAME', () => {
  it('is the friendly fallback string', () => {
    expect(GENERIC_DISPLAY_NAME).toBe('ReciFriend cook');
  });
});
