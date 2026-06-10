import { describe, expect, it } from 'vitest';
import { buildNudgeEmailHtml, nudgeVariantBucket, pickNudgeVariant } from './index';

// Shape matches the worker's RecommendedRecipe interface (id, userId, title,
// durationMinutes, mealTypes, imageUrl, shareUrl) so it typechecks structurally.
const mockRecipes = Array.from({ length: 6 }, (_, i) => ({
  id: `r${i + 1}`,
  userId: `u${i + 1}`,
  title: `Recipe ${i + 1}`,
  durationMinutes: 30,
  mealTypes: ['dinner'],
  imageUrl: `https://example.com/img${i + 1}.jpg`,
  shareUrl: `https://recifriend.com/recipes/r${i + 1}?user=u${i + 1}`,
}));

describe('buildNudgeEmailHtml', () => {
  it('renders all 6 recommended recipe cards', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(6);
  });

  it('uses half-height (90px) thumbnails, not 180px', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('height:90px');
    expect(html).not.toContain('height:180px');
  });

  it('has a "Discover more recipes" CTA pointing at /discover', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('Discover more recipes');
    expect(html).toContain('href="https://recifriend.com/discover"');
  });

  it('no longer uses the ?view=discover query route', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).not.toContain('view=discover');
  });

  it('points the Invite Friends CTA at /friends?add=1', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    expect(html).toContain('href="https://recifriend.com/friends?add=1"');
    expect(html).toContain('Invite Friends');
  });

  it('clamps recipe titles to a fixed 2-line height so cards align', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null);
    // Fixed-height 2-line clamp (not a variable max-height) keeps every card the
    // same height regardless of title length.
    expect(html).toContain('-webkit-line-clamp:2');
    expect(html).not.toContain('max-height:33px');
  });
});

describe('nudgeVariantBucket', () => {
  it('is deterministic and in [0,100)', () => {
    const b = nudgeVariantBucket('user-abc');
    expect(b).toBe(nudgeVariantBucket('user-abc'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
  it('spreads across the range for varied ids', () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => nudgeVariantBucket(`u-${i}`)));
    expect(buckets.size).toBeGreaterThan(20);
  });
});

describe('pickNudgeVariant', () => {
  it('all v1 when pct=0', () => {
    expect(pickNudgeVariant('anyone', 0)).toBe('v1');
  });
  it('all v2 when pct=100', () => {
    expect(pickNudgeVariant('anyone', 100)).toBe('v2');
  });
  it('splits by bucket when pct=50', () => {
    const id = 'split-test';
    const expected = nudgeVariantBucket(id) < 50 ? 'v2' : 'v1';
    expect(pickNudgeVariant(id, 50)).toBe(expected);
  });
});
