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
});

describe('import regression: allowlist + shim (deterministic)', () => {
  it('allows the supported platforms and rejects spoofs', () => {
    for (const h of ['tiktok.com', 'instagram.com', 'facebook.com', 'www.facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'www.allrecipes.com', 'cooking.nytimes.com', 'freshoffthegrid.com', 'docs.google.com']) {
      expect(isAllowedSourceHost(h)).toBe(true);
    }
    for (const h of ['facebook.com.evil.com', 'fb.watch.evil.com', 'evil.com', 'google.com']) {
      expect(isAllowedSourceHost(h)).toBe(false);
    }
  });
  it('flags the FB l.php open redirect but allows real reels', () => {
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/l.php?u=https://evil.com'))).toBe(true);
    expect(isFacebookLinkShim(new URL('https://www.facebook.com/reel/123'))).toBe(false);
  });
});
