import { describe, it, expect } from 'vitest';
import {
  ingredientKeywords, recipeKeywords,
  buildProfile, reasonFor, parseList, normalizeCreator, type SaveRow,
  isRecommendableRow, scoreCandidate, pickRecommendations,
  PICKED_LIMIT, type CandidateRow,
} from './recommend';

// Bijective base-26 suffix (a, b, ..., z, aa, ab, ...) so generated fixture
// words stay pure lowercase letters. ingredientKeywords splits on non-letter
// characters, so a digit suffix would collapse distinct words into one token.
function alphaSuffix(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function alphaWords(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${alphaSuffix(i)}`);
}

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
    // Letter suffixes, not digits: ingredientKeywords splits on non-letter
    // characters (verified in Task 2), so a digit suffix like "word1" would
    // collapse every entry to the same token "word". Use distinct alphabetic
    // words instead so the fixture actually exercises 40 distinct keywords.
    const words = alphaWords(40, 'ingredientword');
    const ingredients = JSON.stringify(words);
    const saves = [save({ ingredients })];
    // one more save that repeats a handful so they outrank the singletons
    saves.push(save({ ingredients: JSON.stringify([words[1], words[2]]) }));
    const p = buildProfile(saves);
    expect(p.keywords.size).toBe(30);
    expect(p.keywords.get(words[1])).toBe(2);
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

  it('replaces hyphens with a space before capitalising a cuisine key', () => {
    const p = buildProfile([save({ cuisines: '["middle-eastern"]' }), save({ cuisines: '["middle-eastern"]' })]);
    expect(reasonFor(p)).toBe('Based on your Middle Eastern saves');
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
  it('counts only non-empty ingredient/step entries toward the floor', () => {
    expect(isRecommendableRow(cand({ ingredients: '["","",""]' }))).toBe(false);
    expect(isRecommendableRow(cand({ ingredients: '["a","b","c"]' }))).toBe(true);
  });
  it('rejects malformed meal_types or custom_tags, accepts null/empty', () => {
    expect(isRecommendableRow(cand({ meal_types: '{bad' }))).toBe(false);
    expect(isRecommendableRow(cand({ custom_tags: '"dinner"' }))).toBe(false);
    expect(isRecommendableRow(cand({ meal_types: null }))).toBe(true);
    expect(isRecommendableRow(cand({ custom_tags: '' }))).toBe(true);
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
    // Letter words, not digits: ingredientKeywords splits on non-letter
    // characters, so "kw0".."kw9" would all collapse to token "kw" (and be
    // dropped for being under 3 chars). Use distinct 3+ letter words instead.
    const words = alphaWords(10, 'kw');
    const p = buildProfile(words.map((w) => save({ ingredients: JSON.stringify([w]) })));
    const row = cand({ ingredients: JSON.stringify(words), cuisines: '[]', meal_types: '[]', creator: null });
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
    expect(PICKED_LIMIT).toBe(3);
    // Every returned pick is one of the four Korean (highest-scoring) candidates.
    for (const r of out) expect(['c0', 'c1', 'c2', 'c3']).toContain(r.id);
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
