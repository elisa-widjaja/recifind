// Pure recommendation logic for the "Picked for you" shelf. No I/O; the
// D1/KV orchestration lives in index.ts (getPickedForYou).

import { normalizeSourceUrlForDedup, isCleanDiscoveryTitle, fnv1a32 } from './discoveryShared';

// Words that appear in most recipes and carry no taste signal. Units are
// listed here too so a stray unit token never survives as a keyword.
export const PANTRY_STOPLIST = new Set([
  // staples
  'salt', 'pepper', 'oil', 'olive', 'water', 'sugar', 'butter', 'flour',
  'garlic', 'onion', 'onions', 'egg', 'eggs', 'milk',
  // descriptors
  'black', 'white', 'fresh', 'ground', 'chopped', 'minced', 'sliced', 'diced',
  'large', 'small', 'medium', 'optional', 'taste', 'and', 'the', 'for', 'with',
  'into', 'cut', 'peeled', 'finely', 'roughly', 'thinly', 'divided',
  // units
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'gram', 'grams', 'kg', 'ml', 'liter', 'litre', 'oz', 'ounce', 'ounces', 'lb', 'lbs',
  'pound', 'pounds', 'clove', 'cloves', 'pinch', 'dash', 'piece', 'pieces', 'can', 'cans',
  'package', 'packet', 'bunch', 'handful', 'inch', 'stick', 'sticks',
]);

// Lowercase an ingredient line, drop parentheticals, split on non-letters,
// drop tokens under 3 chars and stoplisted words, de-duplicate in order.
export function ingredientKeywords(line: string): string[] {
  if (typeof line !== 'string' || !line) return [];
  const cleaned = line.toLowerCase().replace(/\([^)]*\)/g, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of cleaned.split(/[^a-z]+/)) {
    if (tok.length < 3) continue;
    if (PANTRY_STOPLIST.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export function recipeKeywords(ingredients: string[]): Set<string> {
  const set = new Set<string>();
  for (const line of ingredients) {
    for (const k of ingredientKeywords(line)) set.add(k);
  }
  return set;
}

export type SaveRow = {
  source_url: string | null; cuisines: string | null; meal_types: string | null;
  ingredients: string | null; creator: string | null; is_food: number | null;
};

export type TasteProfile = {
  cuisines: Map<string, number>;
  mealTypes: Map<string, number>;
  creators: Map<string, number>;   // normalized -> count
  creatorDisplay: Map<string, string>; // normalized -> first display form seen
  keywords: Map<string, number>;
  savedUrlKeys: Set<string>;
};

export const PROFILE_KEYWORD_CAP = 30;

// JSON text column -> lowercase trimmed string list. Anything unparseable
// or non-array yields []. Non-string entries are dropped.
export function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeCreator(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

export function buildProfile(saves: SaveRow[]): TasteProfile {
  const profile: TasteProfile = {
    cuisines: new Map(), mealTypes: new Map(), creators: new Map(),
    creatorDisplay: new Map(), keywords: new Map(), savedUrlKeys: new Set(),
  };
  const keywordCounts = new Map<string, number>();
  for (const s of saves) {
    const urlKey = normalizeSourceUrlForDedup(s.source_url || '');
    if (urlKey) profile.savedUrlKeys.add(urlKey);
    // Non-food saves still count toward exclusion (never recommend the same
    // link back) but contribute nothing to taste.
    if (s.is_food === 0) continue;
    for (const c of parseList(s.cuisines)) bump(profile.cuisines, c);
    for (const m of parseList(s.meal_types)) bump(profile.mealTypes, m);
    const creatorKey = normalizeCreator(s.creator);
    if (creatorKey) {
      bump(profile.creators, creatorKey);
      if (!profile.creatorDisplay.has(creatorKey)) profile.creatorDisplay.set(creatorKey, String(s.creator).trim());
    }
    // Each save counts a keyword once, regardless of how many lines mention it.
    for (const k of recipeKeywords(parseList(s.ingredients))) bump(keywordCounts, k);
  }
  const top = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PROFILE_KEYWORD_CAP);
  profile.keywords = new Map(top);
  return profile;
}

function displayCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function topEntries(map: Map<string, number>, min: number, take: number): Array<[string, number]> {
  return [...map.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, take);
}

// One line for the shelf caption. Strongest signal wins. No em dashes.
export function reasonFor(profile: TasteProfile): string {
  const cuisines = topEntries(profile.cuisines, 2, 2).map(([c]) => displayCase(c));
  if (cuisines.length === 2) return `Based on your ${cuisines[0]} and ${cuisines[1]} saves`;
  if (cuisines.length === 1) return `Based on your ${cuisines[0]} saves`;
  const creator = topEntries(profile.creators, 2, 1)[0];
  if (creator) return `Because you save recipes from ${profile.creatorDisplay.get(creator[0]) ?? creator[0]}`;
  const keyword = topEntries(profile.keywords, 3, 1)[0];
  if (keyword) return `Because you save a lot of ${keyword[0]} recipes`;
  return "Based on what you've saved";
}

export type CandidateRow = Record<string, unknown> & {
  id: string; user_id: string; title: string; source_url: string | null;
  image_url: string | null; meal_types: string | null; custom_tags: string | null;
  duration_minutes: number | null; ingredients: string | null; steps: string | null;
  cuisines: string | null; creator: string | null; created_at: string | null;
  is_food?: number | null;
};

export const PICKED_MIN_SAVES = 5;
export const PICKED_LIMIT = 3;
export const PICKED_MIN_POSITIVE = 3;
const KEYWORD_OVERLAP_CAP = 6;

// A JSON text column is acceptable when it's null/empty (treated as []) or
// parses to a JSON array. Used for columns we don't otherwise inspect
// (meal_types, custom_tags) so a malformed value rejects the row instead of
// throwing later when it's mapped for display.
function parsesToArrayOrEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return true;
  if (typeof raw !== 'string') return false;
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

// Stricter than isCleanDiscoveryRow: a non-recipe that slipped past the
// Gemini is_food verdict almost never has 3+ ingredients and 2+ steps.
// Counts only non-empty entries (parseList already drops blanks), so a row
// padded with empty strings doesn't count toward the floor.
export function isRecommendableRow(row: CandidateRow): boolean {
  if (row.is_food === 0) return false;
  if (!isCleanDiscoveryTitle(String(row.title || ''))) return false;
  if (!row.image_url) return false;
  if (parseList(row.ingredients).length < 3) return false;
  if (parseList(row.steps).length < 2) return false;
  if (!parsesToArrayOrEmpty(row.meal_types)) return false;
  if (!parsesToArrayOrEmpty(row.custom_tags)) return false;
  return true;
}

export function scoreCandidate(profile: TasteProfile, row: CandidateRow): number {
  let score = 0;
  const creatorKey = normalizeCreator(row.creator);
  if (creatorKey && profile.creators.has(creatorKey)) score += 4;
  for (const c of parseList(row.cuisines)) score += 3 * (profile.cuisines.get(c) ?? 0);
  let overlap = 0;
  for (const k of recipeKeywords(parseList(row.ingredients))) overlap += profile.keywords.get(k) ?? 0;
  score += Math.min(KEYWORD_OVERLAP_CAP, overlap);
  for (const m of parseList(row.meal_types)) score += profile.mealTypes.get(m) ?? 0;
  return score;
}

function dayIndex(now: number): number {
  return Math.floor(now / 86_400_000);
}

export function pickRecommendations(args: {
  profile: TasteProfile; candidates: CandidateRow[]; excludeIds: Set<string>; now?: number;
}): CandidateRow[] {
  const { profile, candidates, excludeIds } = args;
  const now = args.now ?? Date.now();
  const day = dayIndex(now);

  type Scored = { row: CandidateRow; score: number; tie: number; urlKey: string };
  const scored: Scored[] = [];
  for (const row of candidates) {
    if (excludeIds.has(String(row.id))) continue;
    if (!isRecommendableRow(row)) continue;
    const urlKey = normalizeSourceUrlForDedup(row.source_url || '');
    if (urlKey && profile.savedUrlKeys.has(urlKey)) continue;
    const score = scoreCandidate(profile, row);
    if (score <= 0) continue;
    scored.push({ row, score, tie: fnv1a32(`${day}:${String(row.id)}`), urlKey });
  }

  // Collapse copies of the same source: keep the best score, newest on tie.
  const bestByUrl = new Map<string, Scored>();
  const unique: Scored[] = [];
  for (const s of scored) {
    if (!s.urlKey) { unique.push(s); continue; }
    const prev = bestByUrl.get(s.urlKey);
    if (!prev) { bestByUrl.set(s.urlKey, s); continue; }
    const newer = String(s.row.created_at || '') > String(prev.row.created_at || '');
    if (s.score > prev.score || (s.score === prev.score && newer)) bestByUrl.set(s.urlKey, s);
  }
  unique.push(...bestByUrl.values());

  if (unique.length < PICKED_MIN_POSITIVE) return [];
  unique.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return unique.slice(0, PICKED_LIMIT).map((s) => s.row);
}
