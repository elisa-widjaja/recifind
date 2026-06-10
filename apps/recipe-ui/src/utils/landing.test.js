import { describe, it, expect } from 'vitest';
import { landingViewForRecipeCount } from './landing';

describe('landingViewForRecipeCount', () => {
  it('routes 0-3 recipes to the Discover tab', () => {
    for (const n of [0, 1, 2, 3]) expect(landingViewForRecipeCount(n)).toBe('discover');
  });

  it('routes 4+ recipes to the Home feed', () => {
    for (const n of [4, 5, 10, 100]) expect(landingViewForRecipeCount(n)).toBe('home');
  });

  it('defaults to discover for an unknown/non-numeric count', () => {
    expect(landingViewForRecipeCount(undefined)).toBe('discover');
    expect(landingViewForRecipeCount(null)).toBe('discover');
    expect(landingViewForRecipeCount(NaN)).toBe('discover');
  });
});
