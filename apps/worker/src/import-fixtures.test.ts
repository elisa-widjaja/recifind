import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractRecipeDetailsFromHtml,
  extractInstagramRecipeTitle,
  extractTikTokRecipeTitle,
  isAllowedSourceHost,
  isFacebookLinkShim,
  fetchOembedCaption,
} from './index';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/import', name), 'utf8');

// NOTE: AllRecipes (www.allrecipes.com) returns HTTP 403 for all curl-based requests
// (Cloudflare bot-protection). The fixture is from freshoffthegrid.com instead,
// which is also in the ALLOWED_SOURCE_HOSTS allowlist and serves real JSON-LD.
// Fixture URL: https://www.freshoffthegrid.com/dutch-oven-chicken/

describe('import regression: recipe blogs (JSON-LD, deterministic)', () => {
  it('extracts ingredients + steps + title from blog JSON-LD (freshoffthegrid.com)', () => {
    const html = fixture('blog-freshoffthegrid.html');
    const result = extractRecipeDetailsFromHtml(html, 'https://www.freshoffthegrid.com/dutch-oven-chicken/');
    expect(result).not.toBeNull();
    expect(result!.title.length).toBeGreaterThan(0);
    expect(result!.ingredients.length).toBeGreaterThan(0);
    expect(result!.steps.length).toBeGreaterThan(0);
    expect(result!.imageUrl ?? '').toMatch(/^https?:\/\//);
  });
});

describe('import regression: IG/TikTok title extraction (deterministic)', () => {
  it('IG: pulls dish name before the first food emoji', () => {
    expect(extractInstagramRecipeTitle('BANANA BREAD FRENCH TOAST BAKE 🍌🍞 the best brunch')).toBe('BANANA BREAD FRENCH TOAST BAKE');
  });
  it('TikTok: strips the "| TikTok" suffix and takes the lead phrase', () => {
    expect(extractTikTokRecipeTitle('Garlic Butter Shrimp Pasta | TikTok')).toBe('Garlic Butter Shrimp Pasta');
  });
});

describe('import regression: caption fetch (mocked fetch, deterministic)', () => {
  it('IG: reads og:description caption from HTML', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      text: async () => `<html><head><meta property="og:description" content="120 likes, 4 comments - chef on June 1, 2026: &quot;Lemon Pasta. Ingredients: pasta, lemon, butter&quot;" /></head></html>`,
    })) as unknown as typeof fetch;
    const caption = await fetchOembedCaption('https://www.instagram.com/reel/abc/', { fetchImpl });
    expect(caption).not.toBeNull();
    expect(caption).toContain('Lemon Pasta');
  });

  // Regression: the two failing fb.watch imports. FB serves the video page NO
  // og:description to our datacenter fetch — only og:image and an og:url whose
  // path slug is the caption. fetchOembedCaption must recover that slug as the
  // caption so Gemini gets something to extract (was: null -> empty recipe).
  it('FB: falls back to the og:url slug caption when og:description is absent', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      text: async () => `<html><head>
        <meta property="og:type" content="video.other" />
        <meta property="og:url" content="https://www.facebook.com/100086743861165/videos/air-fryer-pork-ribs-1-lb-pork-ribs-riblets15-tbsp-oyster-sauce%C2%BD-tbsp-brown-sugar/1357006853131283/" />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/ribs.jpg" />
      </head><body></body></html>`,
    })) as unknown as typeof fetch;
    let slugFallbackFired = false;
    const caption = await fetchOembedCaption('https://www.facebook.com/watch/?v=1357006853131283', {
      fetchImpl,
      onSlugFallback: () => { slugFallbackFired = true; },
    });
    expect(caption).not.toBeNull();
    expect(caption!.toLowerCase()).toContain('pork ribs');
    expect(caption).not.toContain('-'); // hyphens de-slugified
    // Signals the lossy slug source so captionExtract runs the lenient extractor.
    expect(slugFallbackFired).toBe(true);
  });

  // A normal FB caption from og:description must NOT trip the slug-fallback
  // signal (it stays on the strict extractor for junk protection).
  it('FB: does not fire onSlugFallback when og:description is present', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      text: async () => `<html><head><meta property="og:description" content="Garlic Butter Shrimp. Ingredients: 1 lb shrimp, 3 tbsp butter." /></head></html>`,
    })) as unknown as typeof fetch;
    let slugFallbackFired = false;
    const caption = await fetchOembedCaption('https://www.facebook.com/reel/123', {
      fetchImpl,
      onSlugFallback: () => { slugFallbackFired = true; },
    });
    expect(caption).toContain('Garlic Butter Shrimp');
    expect(slugFallbackFired).toBe(false);
  });

  // The bare Watch-hub URL has no descriptive slug — must stay null so we don't
  // caption a recipe with FB chrome.
  it('FB: returns null when there is no og:description and no descriptive slug', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      text: async () => `<html><head>
        <meta property="og:url" content="https://www.facebook.com/watch/?v=123456" />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/x.jpg" />
      </head><body></body></html>`,
    })) as unknown as typeof fetch;
    const caption = await fetchOembedCaption('https://www.facebook.com/watch/?v=123456', { fetchImpl });
    expect(caption).toBeNull();
  });
});

describe('import regression: FB video title/image from og:url slug (deterministic)', () => {
  it('derives a title + keeps the thumbnail from the og:url slug', () => {
    const html = `<html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:url" content="https://www.facebook.com/61551387266783/videos/celery-salad-summer-ingredients-celery-2-cups-dates-3-using-terra-delyssa-walnut/1041889132115337/" />
      <meta property="og:image" content="https://scontent.fbcdn.net/v/celery.jpg" />
    </head><body></body></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/watch/?v=1041889132115337');
    expect(result).not.toBeNull();
    expect((result!.title ?? '').length).toBeGreaterThan(0);
    expect(result!.title!.toLowerCase()).toContain('celery');
    expect(result!.imageUrl).toBe('https://scontent.fbcdn.net/v/celery.jpg');
  });
});

describe('import regression: allowlist + shim (deterministic)', () => {
  it('allows the supported platforms and rejects spoofs', () => {
    for (const h of ['tiktok.com', 'instagram.com', 'facebook.com', 'www.facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'www.allrecipes.com', 'cooking.nytimes.com', 'freshoffthegrid.com', 'docs.google.com']) {
      expect(isAllowedSourceHost(h)).toBe(true);
    }
    for (const h of ['facebook.com.evil.com', 'fb.watch.evil.com', 'evil.com', 'google.com', 'pinterest.com', 'www.pinterest.com', 'pin.it']) {
      expect(isAllowedSourceHost(h)).toBe(false);
    }
  });
  it('flags the FB l.php open redirect but allows real reels', () => {
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/l.php?u=https://evil.com'))).toBe(true);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/reel/123'))).toBe(false);
  });
});
