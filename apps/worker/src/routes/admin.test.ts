import { describe, expect, it } from 'vitest';
import { isAdminEmail } from './admin';

describe('isAdminEmail', () => {
  it('returns true for an email in ADMIN_EMAILS (single value)', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('returns true for an email in a comma-separated ADMIN_EMAILS list', () => {
    expect(isAdminEmail('foo@bar.com', 'elisa.widjaja@gmail.com,foo@bar.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAdminEmail('Elisa.Widjaja@GMAIL.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('trims whitespace around list entries', () => {
    expect(isAdminEmail('foo@bar.com', ' elisa.widjaja@gmail.com , foo@bar.com ')).toBe(true);
  });

  it('returns false when email is not in the list', () => {
    expect(isAdminEmail('intruder@example.com', 'elisa.widjaja@gmail.com')).toBe(false);
  });

  it('returns false when ADMIN_EMAILS is undefined', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', undefined)).toBe(false);
  });

  it('returns false when email is undefined', () => {
    expect(isAdminEmail(undefined, 'elisa.widjaja@gmail.com')).toBe(false);
  });
});
