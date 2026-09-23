// Helpers shared by the public discovery surfaces (discover, search,
// editors' picks, trending) and the picked-for-you recommender. Lives
// outside index.ts so recommend.ts can import it without a cycle.

// Query params that are share/tracking noise, not content identity. Stripped
// when building a dedup key so the same source video saved by different users
// (one URL carrying ?igsh=, another without) collapses to a single card.
// Content-bearing params like YouTube's ?v= or Facebook's ?fbid= are KEPT so
// distinct videos never merge.
const DEDUP_TRACKING_PARAMS = new Set([
  'igsh', 'igshid', 'si', 'fbclid', 'mibextid', 'rdid',
  '_r', '_t', 'share_app_id', 'share_link_id', 'share_id',
]);

// Normalize a source URL into a dedup key: drop scheme, leading www, trailing
// slash, fragment, and tracking params (utm_* and the denylist above). Path
// case is preserved (Instagram/TikTok IDs are case-sensitive). Returns '' for
// an empty/absent URL so sourceless recipes are never merged together.
export function normalizeSourceUrlForDedup(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  try {
    const u = new URL(url);
    const keep: Array<[string, string]> = [];
    for (const [k, v] of u.searchParams.entries()) {
      const lk = k.toLowerCase();
      if (DEDUP_TRACKING_PARAMS.has(lk) || lk.startsWith('utm_')) continue;
      keep.push([k, v]);
    }
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const host = u.host.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const query = keep.length ? '?' + keep.map(([k, v]) => `${k}=${v}`).join('&') : '';
    return `${host}${path}${query}`;
  } catch {
    // Malformed URL: strip fragment + query by hand, keep case (IDs may be
    // case-sensitive), drop trailing slash.
    return url.split('#')[0].split('?')[0].replace(/\/+$/, '');
  }
}

// Title smells common in unedited Instagram/TikTok imports: hashtags,
// @handles, engagement counts, emoji decorations, sentence-style captions,
// ALL-CAPS attention grabbers, ellipses. Trending / Editor's Picks shelves
// filter these so the public surface only shows recipes with clean,
// presentable noun-phrase titles.
export function isCleanDiscoveryTitle(title: string): boolean {
  if (!title || title.length > 40) return false;
  if (/[\p{Extended_Pictographic}]/u.test(title)) return false;  // any emoji
  if (/…|\.{3}/.test(title)) return false;                       // ellipsis (caption marker)
  if (/^\s*#\w+/.test(title)) return false;                      // hashtag-leading
  if (/@\w{3,}/.test(title)) return false;                       // @handle
  if (/\d+[Kk]?\s+likes?/i.test(title)) return false;            // engagement metrics
  if (/\d+\s+comments?/i.test(title)) return false;
  // Caption sentence-starters
  if (/^\s*(i|i'?m|we|we'?re|this|that|welcome|it'?s|part|how|when|why|so|here'?s|the\s+day)\b/i.test(title)) return false;
  // ALL-CAPS captions — > 60% of letters uppercase
  const letters = title.match(/[a-zA-Z]/g) || [];
  if (letters.length >= 6) {
    const upper = letters.filter(c => c === c.toUpperCase()).length;
    if (upper / letters.length > 0.6) return false;
  }
  return true;
}

// Row-level guard before mapping. Requires a thumbnail and structured
// ingredients/steps so detail pages aren't empty when tapped.
export function isCleanDiscoveryRow(r: Record<string, unknown>): boolean {
  const title = String(r.title || '');
  const imageUrl = String(r.image_url || '');
  const ingredientsRaw = String(r.ingredients || '[]');
  const stepsRaw = String(r.steps || '[]');
  if (!isCleanDiscoveryTitle(title)) return false;
  if (!imageUrl) return false;
  let ingredients: unknown;
  let steps: unknown;
  try { ingredients = JSON.parse(ingredientsRaw); } catch { return false; }
  try { steps = JSON.parse(stepsRaw); } catch { return false; }
  if (!Array.isArray(ingredients) || ingredients.length === 0) return false;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return true;
}

// FNV-1a 32-bit string hash. Deterministic across runtimes, no crypto needed.
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Week index for rotation. UTC-anchored weekly buckets so a US/EU/Asia
// reader switches picks at the same instant. now is parameterized for
// deterministic tests.
export function currentWeekIndex(now: number = Date.now()): number {
  return Math.floor(now / (7 * 24 * 60 * 60 * 1000));
}
