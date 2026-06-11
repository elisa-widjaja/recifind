import { describe, expect, it } from 'vitest';
import {
  buildNudgeEmailHtml, nudgeVariantBucket, pickNudgeVariant, dedupeFavorites,
  buildFounderCardHtml, buildFluidRecipeGrid, EDITORS_PICK_USER_ID, buildNudgeEmailHtmlV2,
} from './index';

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

describe('buildFluidRecipeGrid', () => {
  it('renders one card per recipe, each linking to its recipe detail (shareUrl)', () => {
    const html = buildFluidRecipeGrid(mockRecipes);
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(6);
    for (const r of mockRecipes) expect(html).toContain(r.shareUrl);
  });

  it('uses the fluid-hybrid column mechanism (3-up desktop, 2-up mobile)', () => {
    const html = buildFluidRecipeGrid(mockRecipes);
    // inline-block + width:33.33% gives 3 columns on a wide canvas; min-width
    // forces a wrap to 2 columns on phones; max-width caps card size.
    expect(html).toContain('display:inline-block');
    expect(html).toContain('33.33%');
    expect(html).toContain('min-width:140px');
    expect(html).toContain('max-width:184px');
  });

  it('clamps titles to a fixed 2-line height so cards align', () => {
    const html = buildFluidRecipeGrid(mockRecipes);
    expect(html).toContain('-webkit-line-clamp:2');
    expect(html).toContain('height:34px'); // fixed 2-line box so uneven titles still align
  });

  it('tags cards with a class so a mobile media query can force 2-up', () => {
    const html = buildFluidRecipeGrid(mockRecipes);
    expect(html).toContain('class="rcard"');
  });

  it('makes relative image URLs absolute so they load in email clients', () => {
    const relative = [{ ...mockRecipes[0], imageUrl: '/images/recipes/x.jpg' }];
    const html = buildFluidRecipeGrid(relative);
    expect(html).toContain('https://recifriend.com/images/recipes/x.jpg');
    expect(html).not.toContain('src="/images/recipes/x.jpg"');
  });

  it('truncates long visible titles with an ellipsis (CSS line-clamp is unreliable in email)', () => {
    const long = [{ ...mockRecipes[0], title: 'Chipotle Chicken Breakfast Smash Tacos with Blueberry Chimichurri' }];
    const html = buildFluidRecipeGrid(long);
    // Visible title is clamped; the full title survives only in the img alt.
    expect(html).toContain('Chipotle Chicken Breakfast Smash…');
    expect(html).not.toContain('Smash Tacos with Blueberry Chimichurri</div>');
  });

  it('leaves short titles untouched (no stray ellipsis)', () => {
    const html = buildFluidRecipeGrid([{ ...mockRecipes[0], title: 'Short Title' }]);
    expect(html).toContain('Short Title');
    expect(html).not.toContain('Short Title…');
  });

  it('renders nothing for an empty list', () => {
    expect(buildFluidRecipeGrid([])).toBe('');
  });
});

describe('buildFounderCardHtml', () => {
  const base = {
    avatarUrl: 'https://x.supabase.co/avatars/elisa.jpg',
    name: 'Elisa',
    recipeCount: 346,
    body: "Connect with me if you'd like to swap recipes.",
  };

  it('renders the founder profile card: avatar, name, role, recipe count', () => {
    const html = buildFounderCardHtml(base);
    expect(html).toContain(base.avatarUrl);
    expect(html).toContain('Elisa');
    expect(html).toContain('ReciFriend Founder');
    expect(html).toContain('346 recipes');
  });

  it('renders the body copy and a short "Connect" CTA to ?add_friend', () => {
    const html = buildFounderCardHtml(base);
    expect(html).toContain("Connect with me if you'd like to swap recipes.");
    expect(html).toContain('>Connect</a>');
    expect(html).not.toContain('Connect with Elisa');
    // Universal-Link-eligible path so it opens the app (if installed) on the
    // Friends → Pending tab; falls back to web otherwise.
    expect(html).toContain(`https://recifriend.com/friend-requests?add_friend=${EDITORS_PICK_USER_ID}`);
  });

  it('has no arrow glyph in the CTA', () => {
    expect(buildFounderCardHtml(base)).not.toContain('→');
  });

  it('is a profile card, not a grid of recipe cards (no recipe thumbnails)', () => {
    const html = buildFounderCardHtml(base);
    expect(html).not.toContain('object-fit:cover');
  });

  it('keeps the body copy and CTA inside the card, split by a divider line', () => {
    const html = buildFounderCardHtml(base);
    // Two dividers: the section separator above the card + the in-card line
    // between the profile row and the body/CTA.
    const dividers = (html.match(/border-top/g) || []).length;
    expect(dividers).toBeGreaterThanOrEqual(2);
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

const REC = (id: string) => ({
  id, userId: 'curator', title: `Rec ${id}`, durationMinutes: 15,
  mealTypes: ['Lunch'], imageUrl: 'https://x.supabase.co/i.jpg',
  shareUrl: `https://recifriend.com/recipes/${id}?user=curator`,
});

describe('dedupeFavorites', () => {
  it('removes ids already shown and caps at the limit', () => {
    const favs = [REC('a'), REC('b'), REC('c'), REC('d')];
    const out = dedupeFavorites(favs, new Set(['b']), 2);
    expect(out.map(f => f.id)).toEqual(['a', 'c']);
  });
});

const FOUNDER_CARD = '<!--FOUNDER-CARD-->';

describe('buildNudgeEmailHtml (v1)', () => {
  it('keeps the step-by-step hook + Save Your First Recipe CTA to /discover', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).toContain('Save Your First Recipe');
    expect(html).toContain('href="https://recifriend.com/discover"');
  });

  it('renders the Recommended grid via the fluid-hybrid layout (6 cards)', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).toContain('Recommended for you');
    expect(html).toContain('display:inline-block');
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(6);
  });

  it('injects the founder card and drops the old invite-rewards block', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).toContain(FOUNDER_CARD);
    expect(html).not.toContain('earn rewards');
    expect(html).not.toContain('?add=1');
  });

  it('keeps the unsubscribe placeholders for the cron to fill', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).toContain('__USER_ID__');
    expect(html).toContain('__TOKEN__');
  });

  it('forces 2-up on mobile via a media query', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).toContain('max-width:480px');
    expect(html).toContain('width:50%!important');
  });

  it('has no arrow glyphs in its own CTAs', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).not.toContain('→');
  });

  it('has no em dash in its copy', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).not.toContain('—');
  });

  it('drops the Recommended subtitle (recs are pinned, not preference-based)', () => {
    const html = buildNudgeEmailHtml('Sam', mockRecipes, null, FOUNDER_CARD);
    expect(html).not.toContain('Based on your preferences');
    expect(html).not.toContain('Popular in the community');
  });
});

describe('buildNudgeEmailHtmlV2', () => {
  const hero = REC('hero');
  const shelf = Array.from({ length: 6 }, (_, i) => REC(`s${i}`));

  it('renders the hook + pinned hero with a Save-this-recipe CTA', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('one good recipe to get you started');
    expect(html).toContain('Save this recipe');
    expect(html).toContain(hero.shareUrl);
  });

  it('drops the "One tap..." subtext and the "More picks for you" grid', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).not.toContain('One tap');
    expect(html).not.toContain('More picks for you');
  });

  it('keeps the Browse more recipes CTA to /discover, at the very bottom', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('Browse more recipes');
    expect(html).toContain('https://recifriend.com/discover');
    // Browse-more lives below the founder card + shelf, not between hero and card.
    expect(html.indexOf('Browse more recipes')).toBeGreaterThan(html.indexOf(FOUNDER_CARD));
    expect(html.indexOf('Browse more recipes')).toBeGreaterThan(html.indexOf(shelf[shelf.length - 1].shareUrl));
  });

  it('renders the cooking emoji in the header, not a literal unicode escape', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('🍳');
    expect(html).not.toContain('U0001f373');
  });

  it('caps the hero card at 482px and centers it', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('max-width:482px;margin:0 auto');
  });

  it('puts the Save this recipe button inside the hero card', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    // The old standalone save block below the card is gone.
    expect(html).not.toContain('padding:16px 24px 36px');
    // Save sits within the 482 hero wrapper, before the founder card.
    const save = html.indexOf('Save this recipe');
    expect(save).toBeGreaterThan(html.indexOf('max-width:482px'));
    expect(save).toBeLessThan(html.indexOf(FOUNDER_CARD));
  });

  it('puts the "Recipes from the founder" heading above the shelf, below the founder card', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    const h = html.indexOf('Recipes from the founder');
    expect(h).toBeGreaterThan(html.indexOf(FOUNDER_CARD));
    expect(h).toBeLessThan(html.indexOf(shelf[0].shareUrl));
  });

  it('forces 2-up on mobile via a media query', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('max-width:480px');
    expect(html).toContain('width:50%!important');
  });

  it('has no arrow glyphs in CTAs', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).not.toContain('→');
  });

  it('injects the founder card and a 6-card founder shelf below it', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain(FOUNDER_CARD);
    // hero image + 6 shelf images = 7 thumbnails total.
    const imgCount = html.split('object-fit:cover').length - 1;
    expect(imgCount).toBe(7);
    for (const r of shelf) expect(html).toContain(r.shareUrl);
  });

  it('keeps unsubscribe placeholders and never shows the old v1 hook', () => {
    const html = buildNudgeEmailHtmlV2('Sam', hero, FOUNDER_CARD, shelf);
    expect(html).toContain('__USER_ID__');
    expect(html).toContain('__TOKEN__');
    expect(html).not.toContain('Save Your First Recipe');
  });

  it('degrades gracefully with no hero (no Save-this-recipe, still founder card)', () => {
    const html = buildNudgeEmailHtmlV2('Sam', null, FOUNDER_CARD, shelf);
    expect(html).toContain(FOUNDER_CARD);
    expect(html).not.toContain('Save this recipe');
  });
});
