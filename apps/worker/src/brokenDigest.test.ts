import { describe, expect, it } from 'vitest';
import { isGenericFacebookTitle, selectBrokenRecipes, buildBrokenDigestEmail, type DigestRow } from './brokenDigest';

describe('isGenericFacebookTitle', () => {
  it('is true for generic / empty Facebook titles', () => {
    for (const t of ['', '   ', 'Facebook Reel', 'facebook reel', 'Redirecting...', 'Redirecting…',
                     'fb.watch', 'Facebook', 'Discover Popular Videos', 'Discover Popular Videos | Facebook']) {
      expect(isGenericFacebookTitle(t)).toBe(true);
    }
  });

  it('is false for real recipe titles (including emoji/caption titles)', () => {
    for (const t of ['\u{1F32E} Crispy Verde Shrimp Tacos', 'Mango Coconut Laddoo', 'Slow Cooker Lasagna']) {
      expect(isGenericFacebookTitle(t)).toBe(false);
    }
  });
});

describe('selectBrokenRecipes', () => {
  const base: DigestRow = {
    id: 'x', user_id: 'u', title: 'Good Title',
    source_url: 'https://www.facebook.com/reel/1',
    image_url: 'https://img/x.jpg', image_path: null, preview_image: null,
    owner_email: 'a@b.com',
  };

  it('flags a generic title', () => {
    const r = selectBrokenRecipes([{ ...base, title: 'Facebook Reel' }]);
    expect(r).toHaveLength(1);
    expect(r[0].reasons).toContain('generic-title');
  });

  it('flags no-image only when all three image fields are empty', () => {
    expect(selectBrokenRecipes([{ ...base, image_url: '', image_path: '', preview_image: '' }])[0].reasons)
      .toContain('no-image');
    // image_path present => not no-image
    expect(selectBrokenRecipes([{ ...base, image_url: '', image_path: '/images/x', preview_image: '' }]))
      .toHaveLength(0);
  });

  it('does not flag a clean FB recipe with an image', () => {
    expect(selectBrokenRecipes([base])).toHaveLength(0);
  });

  it('excludes non-Facebook sources even when broken', () => {
    expect(selectBrokenRecipes([{ ...base, title: '', source_url: 'https://www.tiktok.com/@x/video/1' }]))
      .toHaveLength(0);
  });

  it('maps owner email and falls back to (unknown)', () => {
    const r = selectBrokenRecipes([{ ...base, title: 'Facebook Reel', owner_email: null }]);
    expect(r[0].ownerEmail).toBe('(unknown)');
  });
});

describe('buildBrokenDigestEmail', () => {
  it('renders one entry per recipe, shows (no title), lists reasons, no em dashes', () => {
    const { subject, html } = buildBrokenDigestEmail([
      { id: '1', title: '', ownerEmail: 'a@b.com', sourceUrl: 'https://www.facebook.com/reel/1', reasons: ['generic-title', 'no-image'] },
      { id: '2', title: 'Mango Coconut Laddoo', ownerEmail: 'c@d.com', sourceUrl: 'https://www.facebook.com/reel/2', reasons: ['no-image'] },
    ]);
    expect(subject).toContain('2');
    expect(html).toContain('(no title)');
    expect(html).toContain('Mango Coconut Laddoo');
    expect(html).toContain('a@b.com');
    expect(html).not.toContain('—'); // no em dashes in user-facing copy
  });

  it('uses singular phrasing for one recipe', () => {
    const { subject } = buildBrokenDigestEmail([
      { id: '1', title: 'X', ownerEmail: 'a@b.com', sourceUrl: 'u', reasons: ['no-image'] },
    ]);
    expect(subject).toContain('1 broken Facebook import ');
  });
});
