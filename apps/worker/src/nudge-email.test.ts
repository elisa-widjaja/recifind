import { describe, expect, it } from 'vitest';
import { buildNudgeEmailHtml, nudgeVariantBucket, pickNudgeVariant, dedupeFavorites, buildFounderModuleHtml, EDITORS_PICK_USER_ID, buildNudgeEmailHtmlV2 } from './index';

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
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(6);
  });

  it('uses half-height (90px) thumbnails, not 180px', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
    expect(html).toContain('height:90px');
    expect(html).not.toContain('height:180px');
  });

  it('has a "Discover more recipes" CTA pointing at /discover', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
    expect(html).toContain('Discover more recipes');
    expect(html).toContain('href="https://recifriend.com/discover"');
  });

  it('no longer uses the ?view=discover query route', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
    expect(html).not.toContain('view=discover');
  });

  it('no longer has the invite-rewards block (replaced by founder module)', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
    expect(html).not.toContain('earn rewards');
    expect(html).not.toContain('?add=1');
  });

  it('clamps recipe titles to a fixed 2-line height so cards align', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, '');
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

const FAV = (id: string) => ({
  id, userId: EDITORS_PICK_USER_ID, title: `Fav ${id}`,
  durationMinutes: 20, mealTypes: ['Dinner'], imageUrl: 'https://x.supabase.co/i.jpg',
  shareUrl: `https://recifriend.com/recipes/${id}?user=${EDITORS_PICK_USER_ID}`,
});

describe('dedupeFavorites', () => {
  it('removes ids already shown and caps at the limit', () => {
    const favs = [FAV('a'), FAV('b'), FAV('c'), FAV('d')];
    const out = dedupeFavorites(favs, new Set(['b']), 2);
    expect(out.map(f => f.id)).toEqual(['a', 'c']);
  });
});

describe('buildFounderModuleHtml', () => {
  it('renders heading, body, favorite cards, and the Connect CTA to ?add_friend', () => {
    const html = buildFounderModuleHtml([FAV('a'), FAV('b')]);
    expect(html).toContain('Recipes from the founder');
    expect(html).toContain("Hi, I'm Elisa");
    expect(html).toContain('Fav a');
    expect(html).toContain(`/recipes/a?user=${EDITORS_PICK_USER_ID}`);
    expect(html).toContain(`?add_friend=${EDITORS_PICK_USER_ID}`);
    expect(html).toContain('Connect with Elisa');
  });
  it('keeps heading/body/CTA but no cards when favorites is empty', () => {
    const html = buildFounderModuleHtml([]);
    expect(html).toContain('Recipes from the founder');
    expect(html).toContain('Connect with Elisa');
    expect(html).not.toContain('<img');
  });
});

const REC = (id: string) => ({
  id, userId: 'curator', title: `Rec ${id}`, durationMinutes: 15,
  mealTypes: ['Lunch'], imageUrl: 'https://x.supabase.co/i.jpg',
  shareUrl: `https://recifriend.com/recipes/${id}?user=curator`,
});

describe('buildNudgeEmailHtml (v1) founder swap', () => {
  it('keeps the original hook + injects founder module, drops the invite-rewards block', () => {
    const html = buildNudgeEmailHtml('Sam', [REC('a')], null, '<!--FOUNDER-->');
    expect(html).toContain('Save Your First Recipe');   // original v1 hook intact
    expect(html).toContain('<!--FOUNDER-->');            // founder module injected
    expect(html).not.toContain('earn rewards');          // invite-rewards block gone
    expect(html).not.toContain('?add=1');                // invite CTA gone
  });
});

describe('buildNudgeEmailHtmlV2', () => {
  it('renders the hook, hero save link, browse CTA, and injects the founder module', () => {
    const html = buildNudgeEmailHtmlV2('Sam', [REC('h'), REC('m1'), REC('m2')], '<!--FOUNDER-->');
    expect(html).toContain('one good recipe to get you started');
    expect(html).toContain('Save this recipe');
    expect(html).toContain('/recipes/h?user=curator');
    expect(html).toContain('https://recifriend.com/discover');
    expect(html).toContain('<!--FOUNDER-->');
    expect(html).not.toContain('Save Your First Recipe');
    // Unsubscribe placeholders must survive (cron .replace()s them).
    expect(html).toContain('__USER_ID__');
    expect(html).toContain('__TOKEN__');
  });
  it('degrades gracefully with no recipes (no hero/grid, still founder module)', () => {
    const html = buildNudgeEmailHtmlV2('Sam', [], '<!--FOUNDER-->');
    expect(html).toContain('<!--FOUNDER-->');
    expect(html).not.toContain('Save this recipe');
  });
});
