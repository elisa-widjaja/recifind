# Picked for You Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Picked for you" shelf above Editor's Picks on Discover that recommends 7 shared recipes to signed-in users with 5+ saves, scored from their own saves.

**Architecture:** A pure scoring module (`recommend.ts`) builds a taste profile from the user's saves and ranks a candidate pool; `index.ts` gains one authenticated route that runs the D1 queries, wraps the result in a 24-hour per-user KV cache, and invalidates on save. `DiscoverPage.jsx` fetches the route when signed in and renders the shelf with the same list cards as Editor's Picks. Shared discovery helpers move out of `index.ts` into `discoveryShared.ts` so `recommend.ts` can import them without a circular dependency.

**Tech Stack:** Cloudflare Worker (TypeScript), D1 (SQLite), KV, vitest; React + MUI + Vite, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-22-picked-for-you-design.md`

## Global Constraints

- **No `git commit` without the user's explicit go-ahead.** Each task's Commit step means: stop and ask. Do not commit on your own.
- **Work directly on `main`.** No branches, no worktrees.
- **No em dashes in user-facing copy.** Code comments are exempt.
- **Every route handler** in `index.ts` uses `return await (async () => { ... })()` inside the existing try/catch. Never `return handler()` without `await`.
- **Threshold 5, limit 7, minimum 3 positive-score candidates**, exactly as the spec states.
- **Recipe item shape** returned by the route must match `/public/editors-pick` items (`id, userId, title, sourceUrl, imageUrl, mealTypes, customTags, durationMinutes, ingredients, steps`, plus `creator`).
- **Do not deploy** without `git status` first; the user runs parallel uncommitted work in other terminals. Smoke-test recipe import (parse + enrich) on the dev worker before any prod worker deploy.
- **Existing tests must keep passing.** `cd apps/worker && npm test` and `cd apps/recipe-ui && npm test`.
- Web only for now. The iOS app bundles the frontend; no iOS work in this plan.

## Review Focus

Inputs the spec implies but no task's tests originally exercised. Each line's test has been added to the owning task.

1. **Malformed JSON in `ingredients`, `cuisines`, `meal_types`, `steps`** on a candidate or a save. Expected: that row is skipped (candidate) or contributes nothing (save); nothing throws. Test in Task 4 (`parseList` tolerance) and Task 5 (`isRecommendableRow` rejects unparseable).
2. **A save with an empty or missing `source_url`.** Expected: it never causes candidates with empty `source_url` to be excluded en masse. Test in Task 5 (exclusion ignores empty keys).
3. **Creator strings that differ only by case or whitespace** (`"Sofia M"` vs `"sofia m "`). Expected: treated as the same creator. Test in Task 4.
4. **KV read throws** (namespace hiccup). Expected: route falls through to compute and still returns 200. Test in Task 6.
5. **Signed-in user whose token expires mid-visit** so the route returns 401. Expected: shelf hides silently, no error UI, Editor's Picks still renders. Test in Task 8 (fetch returns `ok: false`).

---

### Task 1: Extract shared discovery helpers into `discoveryShared.ts`

`recommend.ts` needs the clean-title check, the URL normalizer and the FNV hash. Those live as private functions in `index.ts`; importing `index.ts` from `recommend.ts` would be circular. Move them into a small shared module and re-export from `index.ts` so existing imports keep working.

**Files:**
- Create: `apps/worker/src/discoveryShared.ts`
- Modify: `apps/worker/src/index.ts:2100-2143` (DEDUP_TRACKING_PARAMS + normalizeSourceUrlForDedup), `:2306-2352` (isCleanDiscoveryTitle, isCleanDiscoveryRow, fnv1a32), `:2366-2368` (currentWeekIndex)
- Test: existing `apps/worker/src/search.test.ts`, `apps/worker/src/public.test.ts` (no new tests; this is a move)

**Interfaces:**
- Produces: `export function isCleanDiscoveryTitle(title: string): boolean`, `export function isCleanDiscoveryRow(r: Record<string, unknown>): boolean`, `export function fnv1a32(s: string): number`, `export function currentWeekIndex(now?: number): number`, `export function normalizeSourceUrlForDedup(rawUrl: string): string`, all from `./discoveryShared`.

- [ ] **Step 1: Run the worker suite to record the baseline**

Run: `cd apps/worker && npm test`
Expected: all green. Note the test count.

- [ ] **Step 2: Create `discoveryShared.ts` with the moved code**

Cut the following blocks out of `index.ts` verbatim (keep their comments) and paste them into the new file, adding `export` to each function:

```ts
// apps/worker/src/discoveryShared.ts
// Helpers shared by the public discovery surfaces (discover, search,
// editors' picks, trending) and the picked-for-you recommender. Lives
// outside index.ts so recommend.ts can import it without a cycle.

const DEDUP_TRACKING_PARAMS = new Set([
  'igsh', 'igshid', 'si', 'fbclid', 'mibextid', 'rdid',
  '_r', '_t', 'share_app_id', 'share_link_id', 'share_id',
]);

// (paste the normalizeSourceUrlForDedup comment + function here, prefixed with export)
export function normalizeSourceUrlForDedup(rawUrl: string): string { /* moved body */ }

// (paste isCleanDiscoveryTitle comment + function, prefixed with export)
export function isCleanDiscoveryTitle(title: string): boolean { /* moved body */ }

// (paste isCleanDiscoveryRow comment + function, prefixed with export)
export function isCleanDiscoveryRow(r: Record<string, unknown>): boolean { /* moved body */ }

// (paste fnv1a32 comment + function, prefixed with export)
export function fnv1a32(s: string): number { /* moved body */ }

// (paste currentWeekIndex comment + function, prefixed with export)
export function currentWeekIndex(now: number = Date.now()): number { /* moved body */ }
```

"moved body" means the exact existing implementation. Do not rewrite any logic.

- [ ] **Step 3: Import and re-export from `index.ts`**

Near the top of `index.ts`, next to the other local imports, add:

```ts
import {
  isCleanDiscoveryTitle,
  isCleanDiscoveryRow,
  fnv1a32,
  currentWeekIndex,
  normalizeSourceUrlForDedup,
} from './discoveryShared';
export { normalizeSourceUrlForDedup } from './discoveryShared';
```

The re-export keeps `search.test.ts` (which imports `normalizeSourceUrlForDedup` from `./index`) working. Delete the moved definitions from `index.ts`. Every call site inside `index.ts` (18 of them) keeps working because the names are unchanged.

- [ ] **Step 4: Type-check and run the suite**

Run: `cd apps/worker && npx tsc --noEmit && npm test`
Expected: tsc clean, same test count as Step 1, all green.

- [ ] **Step 5: Commit checkpoint**

Ask the user before committing. Suggested message:

```bash
git add apps/worker/src/discoveryShared.ts apps/worker/src/index.ts
git commit -m "refactor(worker): move discovery helpers to discoveryShared.ts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Ingredient keyword normalization

**Files:**
- Create: `apps/worker/src/recommend.ts`
- Test: `apps/worker/src/recommend.test.ts`

**Interfaces:**
- Produces: `export function ingredientKeywords(line: string): string[]`, `export function recipeKeywords(ingredients: string[]): Set<string>`, `export const PANTRY_STOPLIST: Set<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/recommend.test.ts
import { describe, it, expect } from 'vitest';
import { ingredientKeywords, recipeKeywords } from './recommend';

describe('ingredientKeywords', () => {
  it('strips quantities and units, keeps the food word', () => {
    expect(ingredientKeywords('2 lbs chicken thighs')).toEqual(['chicken', 'thighs']);
    expect(ingredientKeywords('1 1/2 cups jasmine rice')).toEqual(['jasmine', 'rice']);
    expect(ingredientKeywords('3 tbsp gochujang')).toEqual(['gochujang']);
  });

  it('drops pantry staples and descriptors', () => {
    expect(ingredientKeywords('1 tbsp olive oil')).toEqual([]);
    expect(ingredientKeywords('salt and black pepper to taste')).toEqual([]);
    expect(ingredientKeywords('2 cloves garlic, minced')).toEqual([]);
    expect(ingredientKeywords('1 large onion, diced')).toEqual([]);
  });

  it('strips parentheticals and short tokens', () => {
    expect(ingredientKeywords('200g (7 oz) firm tofu')).toEqual(['firm', 'tofu']);
    expect(ingredientKeywords('1 lb pork belly')).toEqual(['pork', 'belly']);
  });

  it('is case-insensitive and de-duplicates within a line', () => {
    expect(ingredientKeywords('Chicken stock or chicken broth')).toEqual(['chicken', 'stock', 'broth']);
  });

  it('returns [] for empty or non-string input', () => {
    expect(ingredientKeywords('')).toEqual([]);
    expect(ingredientKeywords(undefined as unknown as string)).toEqual([]);
  });
});

describe('recipeKeywords', () => {
  it('unions keywords across lines', () => {
    const set = recipeKeywords(['2 lbs chicken thighs', '3 tbsp gochujang', '1 tbsp olive oil']);
    expect([...set].sort()).toEqual(['chicken', 'gochujang', 'thighs']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: FAIL, "Failed to resolve import ./recommend".

- [ ] **Step 3: Implement**

```ts
// apps/worker/src/recommend.ts
// Pure recommendation logic for the "Picked for you" shelf. No I/O; the
// D1/KV orchestration lives in index.ts (getPickedForYou).

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
```

Note the unit test for `'200g (7 oz) firm tofu'`: `200g` splits into `g` (dropped, under 3 chars) and the parenthetical is removed first.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/worker/src/recommend.ts apps/worker/src/recommend.test.ts
git commit -m "feat(worker): ingredient keyword normalization for recommendations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Taste profile and reason line

**Files:**
- Modify: `apps/worker/src/recommend.ts`
- Test: `apps/worker/src/recommend.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SaveRow = {
    source_url: string | null; cuisines: string | null; meal_types: string | null;
    ingredients: string | null; creator: string | null; is_food: number | null;
  };
  export type TasteProfile = {
    cuisines: Map<string, number>; mealTypes: Map<string, number>;
    creators: Map<string, number>; keywords: Map<string, number>;
    savedUrlKeys: Set<string>;
  };
  export function parseList(raw: unknown): string[];
  export function normalizeCreator(raw: unknown): string;
  export function buildProfile(saves: SaveRow[]): TasteProfile;
  export function reasonFor(profile: TasteProfile): string;
  export const PROFILE_KEYWORD_CAP = 30;
  ```
- Consumes: `recipeKeywords` from Task 2, `normalizeSourceUrlForDedup` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `recommend.test.ts`:

```ts
import { buildProfile, reasonFor, parseList, normalizeCreator, type SaveRow } from './recommend';

function save(over: Partial<SaveRow> = {}): SaveRow {
  return {
    source_url: 'https://www.instagram.com/reel/abc/',
    cuisines: '[]', meal_types: '[]', ingredients: '[]', creator: null, is_food: null,
    ...over,
  };
}

describe('parseList', () => {
  it('parses a JSON array of strings, lowercased and trimmed', () => {
    expect(parseList('["Japanese"," korean "]')).toEqual(['japanese', 'korean']);
  });
  it('returns [] for null, malformed JSON, or non-array JSON', () => {
    expect(parseList(null)).toEqual([]);
    expect(parseList('not json')).toEqual([]);
    expect(parseList('{"a":1}')).toEqual([]);
    expect(parseList('[1, null, "ok"]')).toEqual(['ok']);
  });
});

describe('normalizeCreator', () => {
  it('lowercases and trims; empty for null', () => {
    expect(normalizeCreator(' Sofia M ')).toBe('sofia m');
    expect(normalizeCreator(null)).toBe('');
  });
});

describe('buildProfile', () => {
  it('counts cuisines, meal types, creators and keywords across saves', () => {
    const p = buildProfile([
      save({ cuisines: '["japanese"]', meal_types: '["dinner"]', creator: 'Sofia M', ingredients: '["2 lbs chicken thighs"]' }),
      save({ cuisines: '["Japanese","korean"]', meal_types: '["dinner","lunch"]', creator: 'sofia m ', ingredients: '["1 lb chicken breast","1 tbsp olive oil"]' }),
    ]);
    expect(p.cuisines.get('japanese')).toBe(2);
    expect(p.cuisines.get('korean')).toBe(1);
    expect(p.mealTypes.get('dinner')).toBe(2);
    expect(p.creators.get('sofia m')).toBe(2);
    expect(p.keywords.get('chicken')).toBe(2);
    expect(p.keywords.get('thighs')).toBe(1);
    expect(p.keywords.has('oil')).toBe(false);
  });

  it('skips saves flagged is_food = 0 but still records their url key', () => {
    const p = buildProfile([
      save({ cuisines: '["japanese"]', is_food: 0, source_url: 'https://www.tiktok.com/@x/video/9?_t=abc' }),
    ]);
    expect(p.cuisines.size).toBe(0);
    expect(p.savedUrlKeys.has('tiktok.com/@x/video/9')).toBe(true);
  });

  it('ignores empty source urls in savedUrlKeys', () => {
    const p = buildProfile([save({ source_url: '' }), save({ source_url: null })]);
    expect(p.savedUrlKeys.size).toBe(0);
  });

  it('caps keywords at the 30 most frequent', () => {
    const ingredients = JSON.stringify(Array.from({ length: 40 }, (_, i) => `ingredientword${i}`));
    const saves = [save({ ingredients })];
    // one more save that repeats a handful so they outrank the singletons
    saves.push(save({ ingredients: '["ingredientword1","ingredientword2"]' }));
    const p = buildProfile(saves);
    expect(p.keywords.size).toBe(30);
    expect(p.keywords.get('ingredientword1')).toBe(2);
  });

  it('tolerates malformed JSON on a save', () => {
    const p = buildProfile([save({ cuisines: '{{bad', ingredients: 'nope' })]);
    expect(p.cuisines.size).toBe(0);
    expect(p.keywords.size).toBe(0);
  });
});

describe('reasonFor', () => {
  it('names the top two cuisines with 2+ saves', () => {
    const p = buildProfile([
      save({ cuisines: '["japanese"]' }), save({ cuisines: '["japanese","korean"]' }),
      save({ cuisines: '["korean"]' }), save({ cuisines: '["thai"]' }),
    ]);
    expect(reasonFor(p)).toBe('Based on your Japanese and Korean saves');
  });

  it('uses a single cuisine when only one has 2+ saves', () => {
    const p = buildProfile([save({ cuisines: '["japanese"]' }), save({ cuisines: '["japanese"]' }), save({ cuisines: '["thai"]' })]);
    expect(reasonFor(p)).toBe('Based on your Japanese saves');
  });

  it('falls back to creator with 2+ saves', () => {
    const p = buildProfile([save({ creator: 'Brandon Frohne' }), save({ creator: 'Brandon Frohne' })]);
    expect(reasonFor(p)).toBe('Because you save recipes from Brandon Frohne');
  });

  it('falls back to a keyword with 3+ saves', () => {
    const p = buildProfile([
      save({ ingredients: '["chicken"]' }), save({ ingredients: '["chicken"]' }), save({ ingredients: '["chicken"]' }),
    ]);
    expect(reasonFor(p)).toBe('Because you save a lot of chicken recipes');
  });

  it('uses the generic fallback when nothing is strong enough', () => {
    const p = buildProfile([save({ cuisines: '["thai"]' }), save({ creator: 'x' })]);
    expect(reasonFor(p)).toBe("Based on what you've saved");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: FAIL, `buildProfile is not a function` (or import error).

- [ ] **Step 3: Implement**

Append to `recommend.ts`:

```ts
import { normalizeSourceUrlForDedup } from './discoveryShared';

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
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
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
```

Note: `parseList(s.ingredients)` lowercases ingredient lines before keyword extraction, which is harmless because `ingredientKeywords` lowercases anyway.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/worker/src/recommend.ts apps/worker/src/recommend.test.ts
git commit -m "feat(worker): taste profile and reason line for picked-for-you

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Candidate filter, scoring, and ranking

**Files:**
- Modify: `apps/worker/src/recommend.ts`
- Test: `apps/worker/src/recommend.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CandidateRow = Record<string, unknown> & {
    id: string; user_id: string; title: string; source_url: string | null;
    image_url: string | null; meal_types: string | null; custom_tags: string | null;
    duration_minutes: number | null; ingredients: string | null; steps: string | null;
    cuisines: string | null; creator: string | null; created_at: string | null;
    is_food?: number | null;
  };
  export const PICKED_MIN_SAVES = 5;
  export const PICKED_LIMIT = 7;
  export const PICKED_MIN_POSITIVE = 3;
  export function isRecommendableRow(row: CandidateRow): boolean;
  export function scoreCandidate(profile: TasteProfile, row: CandidateRow): number;
  export function pickRecommendations(args: {
    profile: TasteProfile; candidates: CandidateRow[]; excludeIds: Set<string>; now?: number;
  }): CandidateRow[];
  ```
- Consumes: `isCleanDiscoveryTitle`, `fnv1a32`, `normalizeSourceUrlForDedup` from Task 1; `TasteProfile`, `parseList`, `normalizeCreator`, `recipeKeywords` from Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Append to `recommend.test.ts`:

```ts
import {
  isRecommendableRow, scoreCandidate, pickRecommendations,
  PICKED_LIMIT, type CandidateRow,
} from './recommend';

function cand(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: over.id ?? 'c1', user_id: 'other', title: 'Spicy Chicken Bowl',
    source_url: `https://www.instagram.com/reel/${over.id ?? 'c1'}/`,
    image_url: 'https://img/x.jpg',
    meal_types: '["dinner"]', custom_tags: '[]', duration_minutes: 20,
    ingredients: '["2 lbs chicken thighs","3 tbsp gochujang","1 cup rice"]',
    steps: '["Marinate","Cook"]', cuisines: '["korean"]', creator: 'Sofia M',
    created_at: '2026-09-01T00:00:00Z', is_food: null,
    ...over,
  };
}

describe('isRecommendableRow', () => {
  it('accepts a clean row with 3 ingredients and 2 steps', () => {
    expect(isRecommendableRow(cand())).toBe(true);
  });
  it('rejects is_food = 0', () => {
    expect(isRecommendableRow(cand({ is_food: 0 }))).toBe(false);
  });
  it('rejects fewer than 3 ingredients or fewer than 2 steps', () => {
    expect(isRecommendableRow(cand({ ingredients: '["a","b"]' }))).toBe(false);
    expect(isRecommendableRow(cand({ steps: '["only"]' }))).toBe(false);
  });
  it('rejects a missing image or caption-style title', () => {
    expect(isRecommendableRow(cand({ image_url: '' }))).toBe(false);
    expect(isRecommendableRow(cand({ title: 'I made this for my mom and she cried 😭 #recipe' }))).toBe(false);
  });
  it('rejects unparseable ingredients or steps', () => {
    expect(isRecommendableRow(cand({ ingredients: '{bad' }))).toBe(false);
    expect(isRecommendableRow(cand({ steps: 'nope' }))).toBe(false);
  });
});

describe('scoreCandidate', () => {
  const profile = buildProfile([
    save({ cuisines: '["korean"]', meal_types: '["dinner"]', creator: 'Sofia M', ingredients: '["chicken thighs","gochujang"]' }),
    save({ cuisines: '["korean"]', meal_types: '["dinner"]', ingredients: '["chicken breast"]' }),
  ]);

  it('weights creator 4, cuisine 3 per save, keyword 1 each, meal type 1 per save', () => {
    // creator match (4) + korean x2 saves (6) + keywords chicken(2)+thighs(1)+gochujang(1)=4 + dinner x2 (2)
    expect(scoreCandidate(profile, cand())).toBe(16);
  });

  it('creator match is case and whitespace insensitive', () => {
    expect(scoreCandidate(profile, cand({ creator: ' sofia m ' }))).toBe(16);
  });

  it('caps keyword overlap at 6', () => {
    const p = buildProfile(Array.from({ length: 10 }, (_, i) => save({ ingredients: `["kw${i}"]` })));
    const row = cand({ ingredients: JSON.stringify(Array.from({ length: 10 }, (_, i) => `kw${i}`)), cuisines: '[]', meal_types: '[]', creator: null });
    expect(scoreCandidate(p, row)).toBe(6);
  });

  it('scores 0 with no overlap', () => {
    expect(scoreCandidate(profile, cand({ cuisines: '["thai"]', meal_types: '[]', creator: null, ingredients: '["tofu","basil","lime"]' }))).toBe(0);
  });
});

describe('pickRecommendations', () => {
  const profile = buildProfile([
    save({ cuisines: '["korean"]', ingredients: '["chicken"]', source_url: 'https://www.instagram.com/reel/mine/?igsh=abc' }),
    save({ cuisines: '["korean"]', ingredients: '["chicken"]' }),
  ]);
  const NOW = Date.UTC(2026, 8, 22);

  it('returns the top scoring candidates, highest first, at most PICKED_LIMIT', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      cand({ id: `c${i}`, cuisines: i < 4 ? '["korean"]' : '[]', ingredients: i < 8 ? '["chicken","rice","egg"]' : '["tofu","basil","lime"]', creator: null }),
    );
    const out = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW });
    expect(out.length).toBe(PICKED_LIMIT);
    const korean = out.slice(0, 4).map((r) => r.id).sort();
    expect(korean).toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  it('drops zero-score rows and returns [] when fewer than 3 score positive', () => {
    const candidates = [
      cand({ id: 'a' }), cand({ id: 'b' }),
      cand({ id: 'z1', cuisines: '[]', creator: null, ingredients: '["tofu","basil","lime"]', meal_types: '[]' }),
    ];
    expect(pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW })).toEqual([]);
  });

  it('excludes candidates the user already saved (tracking params ignored)', () => {
    const candidates = [
      cand({ id: 'dupe', source_url: 'https://instagram.com/reel/mine?utm_source=x' }),
      cand({ id: 'k1' }), cand({ id: 'k2' }), cand({ id: 'k3' }),
    ];
    const ids = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW }).map((r) => r.id);
    expect(ids).not.toContain('dupe');
    expect(ids).toHaveLength(3);
  });

  it('excludes ids in excludeIds (this week\'s editors\' picks)', () => {
    const candidates = [cand({ id: 'e1' }), cand({ id: 'k1' }), cand({ id: 'k2' }), cand({ id: 'k3' })];
    const ids = pickRecommendations({ profile, candidates, excludeIds: new Set(['e1']), now: NOW }).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['k1', 'k2', 'k3']));
    expect(ids).not.toContain('e1');
  });

  it('collapses duplicate source urls to the best copy, newest on tie', () => {
    const candidates = [
      cand({ id: 'old', source_url: 'https://www.tiktok.com/@x/video/1', created_at: '2026-01-01T00:00:00Z' }),
      cand({ id: 'new', source_url: 'https://www.tiktok.com/@x/video/1?_t=z', created_at: '2026-09-01T00:00:00Z' }),
      cand({ id: 'k1' }), cand({ id: 'k2' }),
    ];
    const ids = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW }).map((r) => r.id);
    expect(ids).toContain('new');
    expect(ids).not.toContain('old');
  });

  it('does not exclude candidates with empty source urls when a save has none', () => {
    const p = buildProfile([save({ source_url: '', cuisines: '["korean"]' }), save({ source_url: null, cuisines: '["korean"]' })]);
    const candidates = [cand({ id: 'n1', source_url: '' }), cand({ id: 'n2', source_url: null }), cand({ id: 'k1' })];
    const ids = pickRecommendations({ profile: p, candidates, excludeIds: new Set(), now: NOW }).map((r) => r.id);
    expect(ids).toHaveLength(3);
  });

  it('breaks ties deterministically per day and differently on another day', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => cand({ id: `t${i}` }));
    const day1 = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW }).map((r) => r.id);
    const day1Again = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW + 1000 }).map((r) => r.id);
    const day2 = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW + 86_400_000 }).map((r) => r.id);
    expect(day1Again).toEqual(day1);
    expect(day2).not.toEqual(day1);
  });

  it('skips non-recommendable rows before scoring', () => {
    const candidates = [cand({ id: 'bad', is_food: 0 }), cand({ id: 'k1' }), cand({ id: 'k2' }), cand({ id: 'k3' })];
    const ids = pickRecommendations({ profile, candidates, excludeIds: new Set(), now: NOW }).map((r) => r.id);
    expect(ids).not.toContain('bad');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: FAIL, `isRecommendableRow is not a function`.

- [ ] **Step 3: Implement**

Append to `recommend.ts` (and extend the import from `./discoveryShared`):

```ts
import { normalizeSourceUrlForDedup, isCleanDiscoveryTitle, fnv1a32 } from './discoveryShared';

export type CandidateRow = Record<string, unknown> & {
  id: string; user_id: string; title: string; source_url: string | null;
  image_url: string | null; meal_types: string | null; custom_tags: string | null;
  duration_minutes: number | null; ingredients: string | null; steps: string | null;
  cuisines: string | null; creator: string | null; created_at: string | null;
  is_food?: number | null;
};

export const PICKED_MIN_SAVES = 5;
export const PICKED_LIMIT = 7;
export const PICKED_MIN_POSITIVE = 3;
const KEYWORD_OVERLAP_CAP = 6;

function parseArrayLength(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch { return 0; }
}

// Stricter than isCleanDiscoveryRow: a non-recipe that slipped past the
// Gemini is_food verdict almost never has 3+ ingredients and 2+ steps.
export function isRecommendableRow(row: CandidateRow): boolean {
  if (row.is_food === 0) return false;
  if (!isCleanDiscoveryTitle(String(row.title || ''))) return false;
  if (!row.image_url) return false;
  if (parseArrayLength(row.ingredients) < 3) return false;
  if (parseArrayLength(row.steps) < 2) return false;
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/worker && npx vitest run src/recommend.test.ts`
Expected: PASS, 37 tests. If the "weights" test's expected 16 is off, recount: creator 4 + cuisine 3x2 + keywords min(6, 2+1+1)=4 + meal type 1x2 = 16. Fix the implementation, not the expectation.

- [ ] **Step 5: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/worker/src/recommend.ts apps/worker/src/recommend.test.ts
git commit -m "feat(worker): score and rank picked-for-you candidates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `getPickedForYou` with D1 queries and KV cache

**Files:**
- Modify: `apps/worker/src/index.ts` (add next to `getEditorsPick`, around line 2420 after Task 1's edits)
- Test: `apps/worker/src/picked-for-you.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export type PickedForYouResult = { eligible: boolean; reason: string | null; recipes: DiscoverRecipe[] };
  export function pickedForYouCacheKey(userId: string): string; // `picked:v1:${userId}`
  export async function getPickedForYou(
    db: D1Database, kv: KVNamespace, userId: string, now?: number,
  ): Promise<PickedForYouResult>;
  ```
- Consumes: `buildProfile`, `reasonFor`, `pickRecommendations`, `PICKED_MIN_SAVES`, types from Tasks 2 to 4; `getEditorsPick`, `mapDiscoverRow`, `DiscoverRecipe` already in `index.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/picked-for-you.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getPickedForYou, pickedForYouCacheKey } from './index';

const NOW = Date.UTC(2026, 8, 22);

function saveRow(i: number, over: Record<string, unknown> = {}) {
  return {
    source_url: `https://www.instagram.com/reel/mine${i}/`, cuisines: '["korean"]',
    meal_types: '["dinner"]', ingredients: '["chicken","rice","egg"]', creator: null, is_food: null,
    ...over,
  };
}

function candRow(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `c${i}`, user_id: 'other', title: 'Spicy Chicken Bowl',
    source_url: `https://www.instagram.com/reel/c${i}/`, image_url: 'https://img/x.jpg',
    meal_types: '["dinner"]', custom_tags: '[]', duration_minutes: 20,
    ingredients: '["2 lbs chicken thighs","3 tbsp gochujang","1 cup rice"]', steps: '["Marinate","Cook"]',
    cuisines: '["korean"]', creator: 'Sofia M', created_at: '2026-09-01T00:00:00Z', is_food: null,
    ...over,
  };
}

// The function issues, in order: saves query (.all), editors' picks query
// (.all, inside getEditorsPick), candidates query (.all).
function mockDb(saves: unknown[], editors: unknown[], candidates: unknown[]) {
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });
  const prepare = vi.fn()
    .mockReturnValueOnce(allMock(saves))
    .mockReturnValueOnce(allMock(editors))
    .mockReturnValueOnce(allMock(candidates));
  return { prepare } as unknown as D1Database;
}

function mockKv(cached: unknown = null) {
  return {
    get: vi.fn().mockResolvedValue(cached),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
}

describe('getPickedForYou', () => {
  it('returns cached result without touching D1', async () => {
    const cached = { eligible: true, reason: 'Based on your Korean saves', recipes: [], computedAt: 1 };
    const kv = mockKv(cached);
    const db = { prepare: vi.fn() } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: true, reason: 'Based on your Korean saves', recipes: [] });
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith(pickedForYouCacheKey('u1'), { type: 'json' });
  });

  it('is ineligible under 5 saves, caches that, and never queries the pool', async () => {
    const kv = mockKv();
    const prepare = vi.fn().mockReturnValueOnce({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [saveRow(1), saveRow(2), saveRow(3), saveRow(4)] }),
    });
    const db = { prepare } as unknown as D1Database;
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out).toEqual({ eligible: false, reason: null, recipes: [] });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(
      pickedForYouCacheKey('u1'),
      expect.stringContaining('"eligible":false'),
      { expirationTtl: 86400 },
    );
  });

  it('computes, maps to the editors-pick shape, and caches for 24h', async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => candRow(i));
    const db = mockDb(saves, [], candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.eligible).toBe(true);
    expect(out.reason).toBe('Based on your Korean saves');
    expect(out.recipes).toHaveLength(7);
    expect(out.recipes[0]).toMatchObject({
      id: expect.any(String), userId: 'other', title: 'Spicy Chicken Bowl',
      sourceUrl: expect.stringContaining('instagram.com'), imageUrl: 'https://img/x.jpg',
      mealTypes: ['dinner'], customTags: [], durationMinutes: 20,
      ingredients: expect.any(Array), steps: expect.any(Array), creator: 'Sofia M',
    });
    expect(kv.put).toHaveBeenCalledWith(pickedForYouCacheKey('u1'), expect.any(String), { expirationTtl: 86400 });
    const stored = JSON.parse(kv.put.mock.calls[0][1] as string);
    expect(stored.recipes).toHaveLength(7);
    expect(typeof stored.computedAt).toBe('number');
  });

  it("excludes this week's editors' picks by id", async () => {
    const kv = mockKv();
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    // Editors' pick rows come from Elisa's account; getEditorsPick maps them itself.
    const editors = [candRow(1, { user_id: '8e4dfd5e-bb6a-4890-98cd-d9ac6ce655a2', is_favorite: 1, shared_with_friends: 1 })];
    const candidates = [1, 2, 3, 4].map((i) => candRow(i));
    const db = mockDb(saves, editors, candidates);
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.recipes.map((r) => r.id)).not.toContain('c1');
    expect(out.recipes).toHaveLength(3);
  });

  it('falls through to compute when the KV read throws', async () => {
    const kv = mockKv();
    kv.get = vi.fn().mockRejectedValue(new Error('kv down'));
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const db = mockDb(saves, [], [1, 2, 3].map((i) => candRow(i)));
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.eligible).toBe(true);
    expect(out.recipes).toHaveLength(3);
  });

  it('swallows a KV write failure and still returns the result', async () => {
    const kv = mockKv();
    kv.put = vi.fn().mockRejectedValue(new Error('kv write down'));
    const saves = [1, 2, 3, 4, 5].map((i) => saveRow(i));
    const db = mockDb(saves, [], [1, 2, 3].map((i) => candRow(i)));
    const out = await getPickedForYou(db, kv, 'u1', NOW);
    expect(out.recipes).toHaveLength(3);
  });

  it('binds the requesting user id to the saves and pool queries', async () => {
    const kv = mockKv();
    const bindSpy = vi.fn().mockReturnThis();
    const allMock = (results: unknown[]) => ({ bind: bindSpy, all: vi.fn().mockResolvedValue({ results }) });
    const prepare = vi.fn()
      .mockReturnValueOnce(allMock([1, 2, 3, 4, 5].map((i) => saveRow(i))))
      .mockReturnValueOnce(allMock([]))
      .mockReturnValueOnce(allMock([1, 2, 3].map((i) => candRow(i))));
    await getPickedForYou({ prepare } as unknown as D1Database, kv, 'user-xyz', NOW);
    expect(bindSpy).toHaveBeenCalledWith('user-xyz');
    const poolSql = prepare.mock.calls[2][0] as string;
    expect(poolSql).toMatch(/user_id != \?/);
    expect(poolSql).toMatch(/shared_with_friends = 1/);
    expect(poolSql).toMatch(/hidden_at IS NULL/);
    expect(poolSql).toMatch(/is_food IS NULL OR is_food = 1/);
    expect(poolSql).toMatch(/provenance IS NULL OR provenance != 'title-only'/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && npx vitest run src/picked-for-you.test.ts`
Expected: FAIL, `getPickedForYou` not exported.

- [ ] **Step 3: Implement in `index.ts`**

Add the import near the other local imports:

```ts
import {
  buildProfile, reasonFor, pickRecommendations, PICKED_MIN_SAVES,
  type SaveRow, type CandidateRow,
} from './recommend';
```

Add after `getEditorsPick` (after its closing brace):

```ts
// === Picked for you ===
// Save-based recommendations for signed-in users with PICKED_MIN_SAVES+
// saves. Pure scoring lives in recommend.ts; this function owns the D1
// reads and the per-user KV cache. See
// docs/superpowers/specs/2026-09-22-picked-for-you-design.md.

export type PickedForYouResult = {
  eligible: boolean;
  reason: string | null;
  recipes: DiscoverRecipe[];
};

const PICKED_CACHE_VERSION = 'v1';
const PICKED_CACHE_TTL_SECONDS = 24 * 60 * 60;

export function pickedForYouCacheKey(userId: string): string {
  return `picked:${PICKED_CACHE_VERSION}:${userId}`;
}

const PICKED_CANDIDATE_SELECT = `SELECT id, user_id, title, source_url, image_url, meal_types, custom_tags,
  duration_minutes, ingredients, steps, cuisines, creator, created_at, is_food
  FROM recipes
  WHERE user_id != ?
    AND shared_with_friends = 1
    AND hidden_at IS NULL
    AND (is_food IS NULL OR is_food = 1)
    AND (provenance IS NULL OR provenance != 'title-only')`;

export async function getPickedForYou(
  db: D1Database,
  kv: KVNamespace,
  userId: string,
  now: number = Date.now(),
): Promise<PickedForYouResult> {
  const key = pickedForYouCacheKey(userId);

  let cached: (PickedForYouResult & { computedAt?: number }) | null = null;
  try {
    cached = await kv.get(key, { type: 'json' }) as (PickedForYouResult & { computedAt?: number }) | null;
  } catch (err) {
    console.log('[picked-for-you] kv read failed', { userId, error: String(err) });
  }
  if (cached && typeof cached.eligible === 'boolean' && Array.isArray(cached.recipes)) {
    return { eligible: cached.eligible, reason: cached.reason ?? null, recipes: cached.recipes };
  }

  const result = await computePickedForYou(db, userId, now);

  try {
    await kv.put(key, JSON.stringify({ ...result, computedAt: now }), { expirationTtl: PICKED_CACHE_TTL_SECONDS });
  } catch (err) {
    console.log('[picked-for-you] kv write failed', { userId, error: String(err) });
  }
  return result;
}

async function computePickedForYou(db: D1Database, userId: string, now: number): Promise<PickedForYouResult> {
  const savesRes = await db.prepare(
    `SELECT source_url, cuisines, meal_types, ingredients, creator, is_food
     FROM recipes WHERE user_id = ? AND hidden_at IS NULL`
  ).bind(userId).all();
  const saves = (savesRes.results as SaveRow[]) || [];
  if (saves.length < PICKED_MIN_SAVES) {
    return { eligible: false, reason: null, recipes: [] };
  }

  const profile = buildProfile(saves);

  // Never show the same recipe twice on Discover.
  const editors = await getEditorsPick(db, EDITORS_PICK_USER_ID, now);
  const excludeIds = new Set(editors.map((r) => r.id));

  const poolRes = await db.prepare(PICKED_CANDIDATE_SELECT).bind(userId).all();
  const candidates = (poolRes.results as CandidateRow[]) || [];

  const picked = pickRecommendations({ profile, candidates, excludeIds, now });
  if (picked.length === 0) {
    return { eligible: true, reason: null, recipes: [] };
  }
  return {
    eligible: true,
    reason: reasonFor(profile),
    recipes: picked.map((r) => mapDiscoverRow(r as Record<string, unknown>)),
  };
}
```

`mapDiscoverRow` already produces the editors-pick item shape plus `creator`. Confirm its field list at `index.ts:2014` includes `creator`; if it reads `r.creator`, nothing else is needed.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/worker && npx vitest run src/picked-for-you.test.ts && npx tsc --noEmit`
Expected: PASS, 7 tests; tsc clean.

- [ ] **Step 5: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/worker/src/index.ts apps/worker/src/picked-for-you.test.ts
git commit -m "feat(worker): getPickedForYou with D1 queries and 24h KV cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Route, removal of `/recipes/for-you`, and save invalidation

**Files:**
- Modify: `apps/worker/src/index.ts:693-700` (replace the `for-you` route), `:5364-5415` (delete `getRecipesForUser`), `handleCreateRecipe` after the successful INSERT (around `:3043`, the `updateCollectionMeta` line)
- Test: `apps/worker/src/picked-for-you.test.ts` (route), `apps/worker/src/create-recipe.test.ts` (invalidation)

**Interfaces:**
- Produces: `GET /recipes/picked-for-you` (auth) returning `PickedForYouResult` JSON with CORS headers.
- Consumes: `getPickedForYou`, `pickedForYouCacheKey` from Task 5.

- [ ] **Step 1: Write the failing route test**

Routing in `index.ts` calls `authenticateRequest` before any `/recipes/*` route (`index.ts:410`), so a missing header 401s before route matching, and the `DEV_API_KEY` bypass (`index.ts:1273`) resolves to a fixed user `dev-user`. The tests use that bypass to get past auth without a JWT.

Append to `picked-for-you.test.ts`:

```ts
import worker from './index';

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const DEV = { Authorization: 'Bearer devkey' };

describe('GET /recipes/picked-for-you', () => {
  it('returns 401 with CORS headers when no Authorization header is sent', async () => {
    const env = { DB: { prepare: vi.fn() }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/picked-for-you'), env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('returns the result JSON with CORS headers for an authenticated user', async () => {
    const kv = mockKv();
    // dev-user has no saves -> one D1 query, ineligible.
    const prepare = vi.fn().mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) });
    const env = { DB: { prepare }, AI_PICKS_CACHE: kv, DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/picked-for-you', { headers: DEV }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(await res.json()).toEqual({ eligible: false, reason: null, recipes: [] });
    expect(kv.get).toHaveBeenCalledWith(pickedForYouCacheKey('dev-user'), { type: 'json' });
  });

  it('GET /recipes/for-you no longer exists', async () => {
    const env = { DB: { prepare: vi.fn() }, AI_PICKS_CACHE: mockKv(), DEV_API_KEY: 'devkey' } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('https://worker/recipes/for-you', { headers: DEV }), env, ctx);
    expect(res.status).toBe(404);
  });
});
```

If the 401 response lacks CORS headers, that is a pre-existing bug in the catch block, not this feature; report it rather than fixing it here.

- [ ] **Step 2: Write the failing invalidation test**

Append to `create-recipe.test.ts` inside the existing `describe('handleCreateRecipe dedup', ...)` or a new describe:

```ts
describe('handleCreateRecipe picked-for-you invalidation', () => {
  it('deletes the user cache entry after a genuine insert', async () => {
    const { db } = makeMockDb({ existingRecipe: null });
    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const env = { DB: db as unknown as D1Database, AI_PICKS_CACHE: { delete: kvDelete } } as unknown as Env;
    const waitUntil = vi.fn((p: Promise<unknown>) => p);
    const ctx = { waitUntil } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };
    const req = new Request('https://worker/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://www.tiktok.com/@u/video/pasta' }),
    });
    const res = await handleCreateRecipe(req, env, ctx, user as any);
    expect(res.status).toBe(201);
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    expect(kvDelete).toHaveBeenCalledWith('picked:v1:user-abc');
  });

  it('does not touch the cache on a dedup hit', async () => {
    const dupe = { id: 'recipe-existing-123', created_at: new Date(Date.now() - 5 * 86400_000).toISOString() };
    const { db } = makeMockDb({ existingRecipe: dupe, existingIngredients: ['1 cup flour'], existingSteps: ['Mix'] });
    const kvDelete = vi.fn();
    const env = { DB: db as unknown as D1Database, AI_PICKS_CACHE: { delete: kvDelete } } as unknown as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };
    const req = new Request('https://worker/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://www.tiktok.com/@u/video/pasta', ingredients: ['1 cup flour'], steps: ['Mix'] }),
    });
    await handleCreateRecipe(req, env, ctx, user as any);
    expect(kvDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/worker && npx vitest run src/picked-for-you.test.ts src/create-recipe.test.ts`
Expected: the 401 test may already pass; the authenticated route test FAILS with 404 (route not yet added); the for-you test FAILS with 200 instead of 404 (old route still there); the invalidation test FAILS because `kvDelete` was not called.

- [ ] **Step 4: Replace the route**

In `index.ts`, replace the `/recipes/for-you` block:

```ts
      if (url.pathname === '/recipes/picked-for-you' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await (async () => {
          const result = await getPickedForYou(env.DB, env.AI_PICKS_CACHE, user.userId);
          return json(result, 200, withCors());
        })();
      }
```

Delete the whole `getRecipesForUser` function (`index.ts` around 5364 to 5415, the one that reads `profiles` prefs and falls back to `getEditorsPick`). Search for any other reference with `grep -n getRecipesForUser apps/worker/src` and confirm none remain.

- [ ] **Step 5: Add the invalidation**

In `handleCreateRecipe`, directly after the line `await updateCollectionMeta(env, user.userId, { countDelta: 1 });`:

```ts
  // A new save changes the taste profile; drop the cached picked-for-you
  // shelf so the next Discover visit recomputes. Best-effort: the entry
  // expires in 24h regardless. Guarded because some test envs omit KV.
  if (env.AI_PICKS_CACHE && typeof env.AI_PICKS_CACHE.delete === 'function') {
    ctx.waitUntil(
      env.AI_PICKS_CACHE.delete(pickedForYouCacheKey(user.userId))
        .catch((err: unknown) => console.log('[picked-for-you] kv delete failed', { userId: user.userId, error: String(err) }))
    );
  }
```

- [ ] **Step 6: Run to verify pass and the full worker suite**

Run: `cd apps/worker && npx vitest run src/picked-for-you.test.ts src/create-recipe.test.ts && npx tsc --noEmit && npm test`
Expected: all PASS, tsc clean. Existing create-recipe tests whose `env` lacks `AI_PICKS_CACHE` still pass because of the guard.

- [ ] **Step 7: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/worker/src/index.ts apps/worker/src/picked-for-you.test.ts apps/worker/src/create-recipe.test.ts
git commit -m "feat(worker): GET /recipes/picked-for-you route; invalidate on save; drop /recipes/for-you

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Deploy the worker to dev and verify against real data

No code in this task; it verifies Tasks 1 to 6 on the deployed dev worker before frontend work starts.

**Files:**
- None modified.

- [ ] **Step 1: Check the working tree**

Run: `git status --short`
Expected: only this feature's files (plus the pre-existing untracked files and `apps/worker/wrangler.toml` modification the user already had). If unrelated tracked files are modified, stop and ask the user before deploying, since a deploy ships the working tree.

- [ ] **Step 2: Deploy to the dev worker**

Run: `cd apps/worker && npx wrangler deploy --env dev`
Expected: success line naming `recipes-worker-dev`.

- [ ] **Step 3: Call the route as a real user and as the dev key**

The `DEV_API_KEY` bypass always resolves to user id `dev-user`, which has no saves, so it only proves the ineligible path:

```bash
curl -s https://api-dev.recifriend.com/recipes/picked-for-you -H "Authorization: Bearer $DEV_API_KEY"
```

Expected: `{"eligible":false,"reason":null,"recipes":[]}`. `DEV_API_KEY` is in `apps/worker/.dev.vars`.

For the eligible path, use the admin account's Supabase JWT. Sign in on dev.recifriend.com, open the browser console and run `JSON.parse(localStorage.getItem('recifriend-auth')).access_token` (the storage key is `recifriend-auth`, not the Supabase default), then:

```bash
curl -s https://api-dev.recifriend.com/recipes/picked-for-you -H "Authorization: Bearer <jwt>" | head -c 1500
```

Expected: `eligible: true`, a non-null `reason`, 7 recipes, none of them from the admin account itself, none matching a source URL the admin already saved. If the user cannot hand over a JWT in this session, ask them to run the curl with `!` and paste the output.

- [ ] **Step 4: Confirm the cache**

Call the route twice and compare wall time; the second call should be well under the first. Then save one recipe on dev as the admin account and call again; `computedAt` in KV should change. Inspect with:

```bash
cd apps/worker && npx wrangler kv key get --namespace-id d5c0419e6a2e4b5aadc271a376a73b01 "picked:v1:<adminUserId>"
```

The admin user id is `EDITORS_PICK_USER_ID` in `index.ts` (`8e4dfd5e-bb6a-4890-98cd-d9ac6ce655a2`). Note that for the admin account specifically, the pool excludes their own rows and this week's Editor's Picks are their own favorites, so the shelf is drawn entirely from other users' recipes.

- [ ] **Step 5: Import smoke test**

Save one fresh Instagram or TikTok link through the dev worker and confirm parse + enrich still complete (ingredients and steps populate). This is the project's protect-import-flow rule.

- [ ] **Step 6: Report**

Tell the user what the admin account's shelf looks like (reason line, 7 titles) and whether anything non-food slipped through. Ask for a go/no-go on the frontend before continuing.

---

### Task 8: Discover shelf in the frontend

**Files:**
- Modify: `apps/recipe-ui/src/components/DiscoverPage.jsx:75-125` (props, state, fetch) and `:241` (render, insert before Editor's Picks)
- Modify: `apps/recipe-ui/src/App.jsx:6435-6446` (pass `savedCount`)
- Test: `apps/recipe-ui/src/components/DiscoverPage.test.jsx`

**Interfaces:**
- Consumes: `GET /recipes/picked-for-you` from Task 6 (`{ eligible, reason, recipes }`).
- Produces: `DiscoverPage` prop `savedCount: number`.

- [ ] **Step 1: Write the failing tests**

In `DiscoverPage.test.jsx`, extend the fetch mock inside `beforeEach` with a branch for the new route (place it before the final `return Promise.resolve({ ok: false })`):

```js
      if (url.includes('/recipes/picked-for-you')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          eligible: true, reason: 'Based on your Korean saves',
          recipes: [{ id: 'p1', title: 'Gochujang Chicken' }, { id: 'p2', title: 'Kimchi Fried Rice' }],
        }) });
      }
```

Also make the mock capture request options so the auth header can be asserted: change the signature to `global.fetch = vi.fn((url, opts) => { ... })`.

Then add these tests inside the `describe('DiscoverPage', ...)`:

```js
  it('signed in: renders Picked for you above Editor\'s Picks with the reason line', async () => {
    render(<DiscoverPage accessToken="tok" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/picked for you/i)).toBeInTheDocument());
    expect(screen.getByText('Based on your Korean saves')).toBeInTheDocument();
    expect(screen.getByText('Gochujang Chicken')).toBeInTheDocument();
    const picked = screen.getByText(/picked for you/i);
    const editors = screen.getByText(/editor's picks/i);
    // DOCUMENT_POSITION_FOLLOWING (4): editors comes after picked
    expect(picked.compareDocumentPosition(editors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/recipes/picked-for-you'),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('signed out: no Picked for you shelf and no request to the route', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/editor's picks/i)).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/recipes/picked-for-you'), expect.anything());
  });

  it('signed in but ineligible: shelf stays hidden', async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/recipes/picked-for-you')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ eligible: false, reason: null, recipes: [] }) });
      }
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    });
    render(<DiscoverPage accessToken="tok" savedCount={3} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/editor's picks/i)).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });

  it('shows the shelf skeleton while loading only when savedCount >= 5', () => {
    // Never-resolving fetch keeps every section in its loading state.
    global.fetch.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<DiscoverPage accessToken="tok" savedCount={5} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    expect(screen.getByText(/picked for you/i)).toBeInTheDocument();
    unmount();
    render(<DiscoverPage accessToken="tok" savedCount={4} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });

  it('hides the shelf when the route fails (expired token)', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/recipes/picked-for-you')) return Promise.resolve({ ok: false, status: 401 });
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    });
    render(<DiscoverPage accessToken="tok" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText('Editor Pasta')).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });
```

The existing test `fetches all four discovery endpoints on mount` asserts calls with a single string argument. Because `fetchJson` calls `fetch(url)` with one argument when signed out, those assertions still hold.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/recipe-ui && npx vitest run src/components/DiscoverPage.test.jsx`
Expected: the five new tests FAIL (no "Picked for you" text); existing tests PASS.

- [ ] **Step 3: Implement the shelf**

In `DiscoverPage.jsx`:

Props and state (the component signature and the state block near line 75):

```jsx
export default function DiscoverPage({
  accessToken,
  savedCount = 0,
  cookingFor,
  cuisinePrefs,
  dietaryPrefs,
  onOpenRecipe,
  onSaveRecipe,
  onShareRecipe,
}) {
  // ...existing state...
  const [picked, setPicked] = useState([]);
  const [pickedReason, setPickedReason] = useState(null);
  const [pickedLoaded, setPickedLoaded] = useState(!accessToken);
```

Fetch (add a new effect after the mount effect that fetches the three public feeds):

```jsx
  // Save-based picks for signed-in users. The route returns eligible:false
  // under 5 saves; either way an empty list hides the shelf.
  useEffect(() => {
    if (!accessToken) {
      setPicked([]);
      setPickedReason(null);
      setPickedLoaded(true);
      return undefined;
    }
    let cancelled = false;
    setPickedLoaded(false);
    fetchJson('/recipes/picked-for-you', accessToken).then(d => {
      if (cancelled) return;
      setPicked(Array.isArray(d?.recipes) ? d.recipes : []);
      setPickedReason(d?.reason || null);
      setPickedLoaded(true);
    });
    return () => { cancelled = true; };
  }, [accessToken]);
```

Render (insert between the "From the Community" block and the Editor's Picks block, inside the `<Stack sx={{ gap: '32px' }}>`):

```jsx
        {accessToken && (pickedLoaded ? picked.length > 0 : savedCount >= 5) && (
          <Box>
            <SectionLabel>Picked for you</SectionLabel>
            {pickedLoaded ? (
              <>
                {pickedReason && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: '-6px', mb: '10px' }}>
                    {pickedReason}
                  </Typography>
                )}
                <Stack spacing={1}>
                  {picked.map(recipe => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
                  ))}
                </Stack>
              </>
            ) : (
              <ListSkeleton count={7} />
            )}
          </Box>
        )}
```

The `mt: '-6px'` pulls the caption up under the label, whose `mb` is 10px. If it looks cramped in the browser, drop the negative margin; it's cosmetic.

- [ ] **Step 4: Pass `savedCount` from App**

In `App.jsx` at the `<DiscoverPage` element (around line 6436), add one prop:

```jsx
                savedCount={recipes.length}
```

`recipes` is the user's own list state declared at `App.jsx:1536`; `RecipesPage` already receives `totalRecipes={recipes.length}` the same way.

- [ ] **Step 5: Run to verify pass and the full UI suite**

Run: `cd apps/recipe-ui && npx vitest run src/components/DiscoverPage.test.jsx && npm test`
Expected: all PASS. If `FriendSections.test.jsx` or `PublicLanding.test.jsx` assert absence of Editor's Picks, they are untouched and still pass.

- [ ] **Step 6: Build and look at it**

Run: `cd apps/recipe-ui && npm run build`
Expected: clean build. Then run the dev stack (Vite + tunnel per the project's tunnel skill, or `npm run dev`) pointed at the dev worker, sign in as the admin account, open Discover, and confirm: "Picked for you" sits above "Editor's Picks", the caption reads correctly, cards open/save/share like Editor's Picks cards, and pull-to-refresh keeps it. Sign in as an under-5 test account and confirm no shelf and no skeleton flash.

- [ ] **Step 7: Commit checkpoint**

Ask the user before committing.

```bash
git add apps/recipe-ui/src/components/DiscoverPage.jsx apps/recipe-ui/src/components/DiscoverPage.test.jsx apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): Picked for you shelf above Editor's Picks on Discover

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Production deploy

**Files:**
- None modified.

- [ ] **Step 1: Working tree check**

Run: `git status --short`
Expected: same as Task 7 Step 1. If anything unrelated is modified, stop and ask.

- [ ] **Step 2: Deploy the worker**

Run: `cd apps/worker && npx wrangler deploy`
Expected: success naming the prod worker. Immediately after, hit `https://recifriend.com` Discover signed out to confirm Editor's Picks still loads (public routes unaffected), then run the import smoke test once against prod with a fresh social link.

- [ ] **Step 3: Deploy the frontend**

Run: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
Expected: a deployment URL. Open recifriend.com, hard-refresh, sign in as the admin account, confirm the shelf.

- [ ] **Step 4: Note the iOS gap**

Tell the user the App Store app will show the shelf only after the next build (1.1.5, CFBundleVersion 39+), and that the worker side is already live for it.

- [ ] **Step 5: Memory note**

Write a short project memory (`project_picked_for_you.md`) recording: shipped date, threshold 5 / limit 7, cache key `picked:v1:{userId}` in `AI_PICKS_CACHE`, bump `v1` when scoring changes, and that the old `/recipes/for-you` route is gone. Add its line to `MEMORY.md`.

---

## Self-review notes

- **Spec coverage:** scoring, layered non-recipe filter, exclusions, dedup, daily tie-break, reason line, threshold, route, cache key/TTL, invalidation, frontend placement, skeleton gating, `savedCount` prop, tests, manual checks, quota (verified at Task 7 by observing one recompute), iOS note. The spec's "fewer than 3 positive" rule is `PICKED_MIN_POSITIVE` in Task 4.
- **Type consistency:** `SaveRow`, `CandidateRow`, `TasteProfile`, `PickedForYouResult`, `pickedForYouCacheKey`, `getPickedForYou`, `pickRecommendations({ profile, candidates, excludeIds, now })` are used with the same names and shapes in Tasks 3 to 8. `creatorDisplay` was added to `TasteProfile` so the reason line can show the original casing; it is set in `buildProfile` and read in `reasonFor`.
- **Deviation from spec:** the route response item includes `creator` in addition to the editors-pick fields, because `mapDiscoverRow` already emits it and `RecipeListCard` can use it. Harmless superset.
- **Review Focus:** all five lines have tests in Tasks 4, 5, 6 and 8.
