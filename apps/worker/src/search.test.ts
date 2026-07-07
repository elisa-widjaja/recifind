import { describe, expect, it } from 'vitest';
import { escapeLikeTerm } from './index';

describe('escapeLikeTerm', () => {
  it('escapes percent, underscore, and backslash', () => {
    expect(escapeLikeTerm('50%')).toBe('50\\%');
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    expect(escapeLikeTerm('c\\d')).toBe('c\\\\d');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLikeTerm('chicken')).toBe('chicken');
  });

  it('escapes backslash before wildcards so escaping is not double-applied', () => {
    // input `\%` -> backslash becomes `\\`, percent becomes `\%`
    expect(escapeLikeTerm('\\%')).toBe('\\\\\\%');
  });
});
