# Custom Recipe Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-authored per-recipe `customTags` (max 5 per recipe, 30 chars each) with autocomplete from the user's own existing tags. Surface in recipe-detail edit mode, filter drawer, and search bar.

**Architecture:** New `custom_tags TEXT` column on the `recipes` D1 table storing a JSON array. Worker `normalizeRecipePayload` adds a `sanitizeCustomTags` helper that trims, dedupes case-insensitively, and caps. Frontend uses MUI `<Autocomplete multiple freeSolo>` with options computed client-side from already-loaded recipes — zero Gemini involvement, no new endpoints, recipe-import flow untouched.

**Tech Stack:** Cloudflare D1, Cloudflare Workers (TypeScript), Vitest, React + Vite + MUI.

**Spec:** `docs/superpowers/specs/2026-05-20-custom-recipe-tags-design.md`

**Deploy gating:** Build 17 is in App Store review. After implementation, smoke-test then deploy **only the dev worker** (`api-dev.recifriend.com`). Do NOT deploy prod worker or Pages until user explicitly approves after testing on `dev.recifriend.com` + Xcode iOS build.

---

## File Structure

**Created:**
- (none — all changes go into existing files)

**Modified:**
- `apps/worker/src/index.ts` — `Recipe` interface, `sanitizeCustomTags` helper, `normalizeRecipePayload`, all `SELECT … FROM recipes` projections, `handleCreateRecipe` INSERT, `handleUpdateRecipe` UPDATE, the Recipe-row deserializer.
- `apps/worker/src/create-recipe.test.ts` — new test cases for `sanitizeCustomTags` round-trip.
- `apps/recipe-ui/src/App.jsx` — `NEW_RECIPE_TEMPLATE`, `buildApiRecipePayload`, `normalizeRecipeFromApi`, `validateRecipesPayload`, `availableTags` useMemo, recipe-detail view-mode chips, recipe-detail edit-mode Autocomplete, search-bar filter logic.
- `apps/recipe-ui/src/RecipesPage.jsx` — Tags filter section in the filter drawer, tag-filter state, filter logic.

**Live infra change:**
- `recipes-db` D1 — `ALTER TABLE recipes ADD COLUMN custom_tags TEXT DEFAULT '[]'`. Applied via `wrangler d1 execute … --remote`.

---

## Task 1: Apply D1 schema migration

**Files:**
- Live: `recipes-db` on Cloudflare (via wrangler)

- [ ] **Step 1: Confirm column doesn't already exist**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler d1 execute recipes-db --remote --command "PRAGMA table_info(recipes);"
```

Expected: a list of columns. Verify `custom_tags` is NOT in the list. If it already exists, skip Step 2.

- [ ] **Step 2: Apply the ALTER**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler d1 execute recipes-db --remote --command "ALTER TABLE recipes ADD COLUMN custom_tags TEXT DEFAULT '[]';"
```

Expected: success message. The column is online instantly on D1; no rewrite.

- [ ] **Step 3: Verify**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler d1 execute recipes-db --remote --command "PRAGMA table_info(recipes);"
```

Expected: `custom_tags` appears as a TEXT column with default `'[]'`.

Spot-check that existing rows return the default:

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler d1 execute recipes-db --remote --command "SELECT custom_tags FROM recipes LIMIT 3;"
```

Expected: three rows showing `[]` (or `'[]'`).

- [ ] **Step 4: Commit-able artifact**

No code change. Note in the next code commit that this migration was applied.

---

## Task 2: Worker — failing test for `sanitizeCustomTags`

**Files:**
- Modify: `apps/worker/src/create-recipe.test.ts`

- [ ] **Step 1: Find a good spot in the existing test file**

```bash
grep -n "describe\|test(" /Users/elisa/Desktop/VibeCode/apps/worker/src/create-recipe.test.ts | head -10
```

Add the new `describe` block at the bottom of the file, before the final closing brace if there's an outer wrapper, or as a sibling `describe`.

- [ ] **Step 2: Write the failing test**

Add this `describe` block (place it as a sibling to the existing top-level `describe`):

```ts
import { sanitizeCustomTags } from './index';

describe('sanitizeCustomTags', () => {
  test('returns empty array for non-array input', () => {
    expect(sanitizeCustomTags(undefined)).toEqual([]);
    expect(sanitizeCustomTags(null)).toEqual([]);
    expect(sanitizeCustomTags('hello')).toEqual([]);
    expect(sanitizeCustomTags(42)).toEqual([]);
  });

  test('trims whitespace and drops empty strings', () => {
    expect(sanitizeCustomTags(['  meal prep  ', '   ', '', 'camping'])).toEqual([
      'meal prep',
      'camping',
    ]);
  });

  test('drops non-string elements', () => {
    expect(sanitizeCustomTags(['valid', 123, null, undefined, 'kept'])).toEqual([
      'valid',
      'kept',
    ]);
  });

  test('dedupes case-insensitively, preserves first occurrence casing', () => {
    expect(sanitizeCustomTags(['Meal Prep', 'meal prep', 'MEAL PREP'])).toEqual([
      'Meal Prep',
    ]);
  });

  test('caps each tag at 30 chars', () => {
    const long = 'a'.repeat(50);
    expect(sanitizeCustomTags([long])).toEqual(['a'.repeat(30)]);
  });

  test('caps the array at 5 tags', () => {
    expect(sanitizeCustomTags(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  test('combined: trims, dedupes, truncates, caps', () => {
    const input = [
      '  Meal Prep  ',
      'meal prep',
      'Backpacking',
      'a'.repeat(40),
      '',
      42,
      'Camping',
      'Dog Food',
      'Toddler Meals',
      'Sixth Tag',
    ];
    expect(sanitizeCustomTags(input)).toEqual([
      'Meal Prep',
      'Backpacking',
      'a'.repeat(30),
      'Camping',
      'Dog Food',
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npm test -- --reporter=verbose create-recipe.test.ts 2>&1 | tail -20
```

Expected: FAIL — `sanitizeCustomTags is not exported from './index'` (or similar import error).

- [ ] **Step 4: Commit**

Defer commit to Task 3 — the test and the implementation should land together.

---

## Task 3: Worker — implement `sanitizeCustomTags` + add `customTags` to Recipe type

**Files:**
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Locate the `Recipe` interface**

```bash
grep -n "^interface Recipe " /Users/elisa/Desktop/VibeCode/apps/worker/src/index.ts
```

Add `customTags: string[];` to the interface alongside `mealTypes`, `cuisines`, etc.

- [ ] **Step 2: Locate an existing string-array sanitizer to use as a stylistic reference**

```bash
grep -n "function sanitizeStringArray" /Users/elisa/Desktop/VibeCode/apps/worker/src/index.ts
```

Add `sanitizeCustomTags` right next to it.

- [ ] **Step 3: Implement `sanitizeCustomTags` and export it**

```ts
// User-authored organizational tags on a recipe. Capped at 5 per recipe,
// 30 chars per tag; deduped case-insensitively within the recipe but
// stored with the user's original casing so display is unchanged.
export function sanitizeCustomTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seenLower = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 30);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out.push(trimmed);
    if (out.length >= 5) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npm test -- --reporter=verbose create-recipe.test.ts 2>&1 | tail -20
```

Expected: the new `describe('sanitizeCustomTags', ...)` block has all 7 tests passing. Pre-existing test failures (friends-suggestions, public.test.ts) are unrelated.

- [ ] **Step 5: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(worker): sanitizeCustomTags helper + Recipe.customTags field

Adds the validation helper for user-authored custom_tags: trims, drops
non-strings, dedupes case-insensitively (first casing wins), caps each
tag at 30 chars and the array at 5 entries. Recipe interface gains a
customTags: string[] field.

D1 migration applied separately (ALTER TABLE ... ADD COLUMN custom_tags).
"
```

---

## Task 4: Worker — wire `customTags` through normalize, INSERT, UPDATE, SELECT

**Files:**
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Locate `normalizeRecipePayload`**

```bash
grep -n "function normalizeRecipePayload" /Users/elisa/Desktop/VibeCode/apps/worker/src/index.ts
```

- [ ] **Step 2: Add `customTags` handling next to the existing `cuisines` block**

Find the line `if ('cuisines' in payload || !existing) { recipe.cuisines = sanitizeStringArray(payload.cuisines); }` (or similar). Add an adjacent block:

```ts
if ('customTags' in payload || !existing) {
  recipe.customTags = sanitizeCustomTags(payload.customTags);
}
```

Also make sure the `existing ? { ...existing }` initializer in `normalizeRecipePayload` defaults `customTags` to `[]` for new recipes (the initializer literal at the top of the function — add `customTags: [],` next to `cuisines: [],`).

- [ ] **Step 3: Update `handleCreateRecipe` INSERT statement**

Find the `INSERT INTO recipes` SQL in `handleCreateRecipe`. Add `custom_tags` to the column list and `?` to the placeholders. Pass `JSON.stringify(recipe.customTags)` in the bind list (adjacent to where `JSON.stringify(recipe.cuisines || [])` is bound).

- [ ] **Step 4: Update `handleUpdateRecipe` UPDATE statement**

Same change in the `UPDATE recipes SET ...` SQL — add `custom_tags = ?` and bind `JSON.stringify(recipe.customTags)`.

- [ ] **Step 5: Find every `SELECT … FROM recipes` and add `custom_tags`**

```bash
grep -n "SELECT.*FROM recipes\b" /Users/elisa/Desktop/VibeCode/apps/worker/src/index.ts | head -30
```

For each match where the projection is a comma-separated column list (not `SELECT *`), add `custom_tags` to the column list. Pay attention to:

- `loadRecipe`
- `handleListRecipes`
- `getPublicDiscover` / `DISCOVER_SELECT` constant
- `getTrendingRecipes`
- `getEditorsPick`
- `getFriendsRecentlySaved`
- `getFriendsRecentlyShared`
- `getFriendActivity`'s recipe lookup (the `recipeMap` block)
- Any other lookups in admin handlers

- [ ] **Step 6: Find every Recipe-row deserializer and parse `custom_tags`**

```bash
grep -n "mealTypes: JSON.parse\|cuisines: JSON.parse" /Users/elisa/Desktop/VibeCode/apps/worker/src/index.ts | head -20
```

For each deserialization site, add an adjacent line:

```ts
customTags: JSON.parse(String(r.custom_tags || '[]')),
```

(In TypeScript-typed contexts where `r.custom_tags` is `string | null`, the `String(... || '[]')` pattern handles both.)

- [ ] **Step 7: Add a round-trip integration test**

In `apps/worker/src/create-recipe.test.ts`, find the existing "creates a recipe" test (or similar) and either extend it or add a new test:

```ts
test('round-trips customTags through POST and GET', async () => {
  // Setup uses the existing test scaffolding pattern — copy the closest
  // existing POST→GET roundtrip test and adapt it. Send a recipe with
  // customTags: ['Meal Prep', 'meal prep', 'Camping']. Assert the GET
  // returns customTags: ['Meal Prep', 'Camping'].
});
```

If the existing test file uses fixtures/mocks that make a full round-trip awkward, instead test the `normalizeRecipePayload` path directly:

```ts
test('normalizeRecipePayload sanitizes customTags', () => {
  const body = { title: 'X', customTags: ['Meal Prep', 'meal prep', '  Camping  ', 42, ''] };
  const { recipe } = normalizeRecipePayload(body, 'user-1');
  expect(recipe.customTags).toEqual(['Meal Prep', 'Camping']);
});
```

(Pick whichever style fits the test file's existing patterns.)

- [ ] **Step 8: Run all worker tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npm test 2>&1 | grep -E "FAIL |Test Files|Tests " | tail -8
```

Expected: 4 pre-existing failures (`friends-suggestions`, `public.test.ts`) remain. Total test count goes up by the new sanitize tests + roundtrip. No new failures.

- [ ] **Step 9: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(worker): persist customTags through normalize, INSERT, UPDATE, SELECT

normalizeRecipePayload calls sanitizeCustomTags; handleCreateRecipe and
handleUpdateRecipe include custom_tags in their SQL. Every SELECT that
returns a recipe row now projects custom_tags and deserializes via
JSON.parse(... || '[]'). No new endpoints; no Gemini-prompt changes —
the recipe-import flow stays byte-for-byte untouched.
"
```

---

## Task 5: Frontend — Recipe state plumbing (NEW_RECIPE_TEMPLATE, payloads, normalize, JSON import)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Locate `NEW_RECIPE_TEMPLATE`**

```bash
grep -n "NEW_RECIPE_TEMPLATE = {" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx
```

Add `customTags: [],` to the object literal (adjacent to `cuisines: ''` — note that several fields in the template are stored as strings then split on save; `customTags` is just an array all the way through).

- [ ] **Step 2: Locate `buildApiRecipePayload`**

```bash
grep -n "async function buildApiRecipePayload" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx
```

Inside the function, find the `payload` object literal. Next to `cuisines,`, add:

```js
customTags: Array.isArray(recipe.customTags) ? recipe.customTags : [],
```

- [ ] **Step 3: Locate `normalizeRecipeFromApi`**

```bash
grep -n "function normalizeRecipeFromApi" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx
```

The function should pass through `customTags` from the API response. Since it currently does `result = recipe` then mutates, the field should flow through automatically if the API returns it. Verify by reading the function — if it strips fields, add a passthrough. Most likely no change needed; just confirm.

- [ ] **Step 4: Locate `validateRecipesPayload` (JSON bulk import)**

```bash
grep -n "function validateRecipesPayload" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx
```

Inside the `.map((recipe, index) => { return { ... } })` block, add to the returned object literal:

```js
customTags: Array.isArray(recipe.customTags) ? recipe.customTags : [],
```

- [ ] **Step 5: Build to confirm no syntax errors**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3
```

Expected: `✓ built in ...s` with no errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): plumb customTags through recipe state + API payloads + JSON import"
```

---

## Task 6: Frontend — Recipe-detail view mode tag chips

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Locate the cuisines view-mode chip rendering**

```bash
grep -n "Cuisines" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx
```

Look for the block that renders the Cuisines section in the recipe-detail dialog (around the `<Typography>Cuisines</Typography>` header followed by the chip rendering).

- [ ] **Step 2: Add a Tags section directly below Cuisines**

Use this template, placed immediately after the closing of the Cuisines `<Box>` block, before the Notes section:

```jsx
{((activeRecipeView.customTags || []).length > 0 || isEditMode) && (
  <Box sx={{ pb: isEditMode ? 3 : 0 }}>
    <Divider sx={{ borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : '#E0E0E0', mb: 3 }} />
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      Tags
    </Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {!isEditMode && (activeRecipeView.customTags || []).map((t) => (
        <Chip key={t} label={t} size="small" variant="filled" color="primary" />
      ))}
      {/* edit-mode Autocomplete fills in during Task 7 */}
    </Box>
  </Box>
)}
```

The conditional `length > 0 || isEditMode` keeps view-mode hidden when empty (per spec) but always shows edit-mode (so the user can add the first tag).

- [ ] **Step 3: Build**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3
```

Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): recipe-detail view-mode Tags section (hidden when empty)"
```

---

## Task 7: Frontend — Recipe-detail edit-mode Autocomplete

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Add `Autocomplete` to MUI imports**

Find the `from '@mui/material';` import block at the top. Add `Autocomplete` to the alphabetical position. Example:

```js
import {
  // ...
  Autocomplete,
  // ...
} from '@mui/material';
```

- [ ] **Step 2: Add `availableTags` useMemo**

Inside the `App()` function, near the other `useMemo` declarations (e.g., near `activeRecipeImageUrl` or `newRecipePreviewImageUrl`), add:

```js
const availableTags = useMemo(() => {
  const seenLower = new Set();
  const out = [];
  for (const r of recipes) {
    const tags = r.customTags || [];
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      const lower = tag.toLowerCase();
      if (seenLower.has(lower)) continue;
      seenLower.add(lower);
      out.push(tag);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}, [recipes]);
```

- [ ] **Step 3: Add the Autocomplete inside the Tags section's edit-mode branch**

Update the Tags section from Task 6 so its inner `<Box>` renders an Autocomplete when in edit mode:

```jsx
{((activeRecipeView.customTags || []).length > 0 || isEditMode) && (
  <Box sx={{ pb: isEditMode ? 3 : 0 }}>
    <Divider sx={{ borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : '#E0E0E0', mb: 3 }} />
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      Tags
    </Typography>
    {isEditMode ? (
      <Autocomplete
        multiple
        freeSolo
        options={availableTags}
        value={activeRecipeDraft?.customTags ?? []}
        onChange={(_, newValue) => {
          // Apply the same 30-char + dedup + 5-cap rules client-side so
          // the user sees the truncation before the worker repeats it.
          const cleaned = [];
          const seenLower = new Set();
          for (const item of newValue) {
            if (typeof item !== 'string') continue;
            const trimmed = item.trim().slice(0, 30);
            if (!trimmed) continue;
            const lower = trimmed.toLowerCase();
            if (seenLower.has(lower)) continue;
            seenLower.add(lower);
            cleaned.push(trimmed);
            if (cleaned.length >= 5) break;
          }
          setActiveRecipeDraft((prev) => prev ? { ...prev, customTags: cleaned } : prev);
        }}
        disabled={isSharedRecipeView}
        renderTags={(tags, getTagProps) =>
          tags.map((t, i) => (
            <Chip key={t} label={t} size="small" {...getTagProps({ index: i })} />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={(activeRecipeDraft?.customTags ?? []).length >= 5 ? 'Max 5 tags' : 'Add a tag…'}
            inputProps={{
              ...params.inputProps,
              maxLength: 30,
              disabled: (activeRecipeDraft?.customTags ?? []).length >= 5,
            }}
          />
        )}
      />
    ) : (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {(activeRecipeView.customTags || []).map((t) => (
          <Chip key={t} label={t} size="small" variant="filled" color="primary" />
        ))}
      </Box>
    )}
  </Box>
)}
```

- [ ] **Step 4: Build**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3
```

Expected: builds clean.

- [ ] **Step 5: Run UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm test 2>&1 | tail -5
```

Expected: all 116 tests pass (no test currently covers the new component; this confirms we haven't broken existing tests).

- [ ] **Step 6: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): recipe-detail edit-mode tag Autocomplete

MUI Autocomplete with multiple + freeSolo. Options are the user's own
distinct tags computed from in-state recipes — no AI involvement, no
network call. Client mirrors the worker sanitize (trim, 30-char cap,
case-insensitive dedupe, 5-tag cap) so the user sees rule enforcement
in the UI before the worker repeats it.
"
```

---

## Task 8: Frontend — Search bar matches tag text

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Locate the search/filter `useMemo`**

```bash
grep -n "filteredRecipes\|searchQuery.*toLowerCase\|filter(.*recipe =>" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/App.jsx | head -10
```

Look for the `useMemo` that filters recipes by the search-bar query — typically matching `recipe.title.toLowerCase().includes(q)` and ingredient text.

- [ ] **Step 2: Add a tag-match clause to the filter expression**

In the `||`-chained condition for the text match, append:

```js
|| (recipe.customTags || []).some(t => t.toLowerCase().includes(q))
```

so the full clause becomes (example shape — match the existing pattern):

```js
recipe.title.toLowerCase().includes(q)
  || recipe.ingredients.some(i => i.toLowerCase().includes(q))
  || (recipe.customTags || []).some(t => t.toLowerCase().includes(q))
```

- [ ] **Step 3: Build + UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -3
```

Expected: clean build, 116/116 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): search bar matches customTags text"
```

---

## Task 9: Frontend — Filter drawer Tags section

**Files:**
- Modify: `apps/recipe-ui/src/RecipesPage.jsx`
- Modify: `apps/recipe-ui/src/App.jsx` (to pass `availableTags` + `selectedTags` state + handler)

- [ ] **Step 1: Hoist tag-filter state into App.jsx**

In `App.jsx`, near the other filter state (`selectedMealType`, `selectedCuisine`), add:

```js
const [selectedTags, setSelectedTags] = useState([]);
```

`availableTags` already exists from Task 7.

- [ ] **Step 2: Pass `availableTags` + `selectedTags` + setter as props to `<RecipesPage>`**

Find the `<RecipesPage ... />` render in App.jsx. Add:

```jsx
availableTags={availableTags}
selectedTags={selectedTags}
onTagToggle={(t) => setSelectedTags((prev) => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
```

- [ ] **Step 3: Apply the tag filter in App.jsx's filtered-recipes `useMemo`**

In the same `useMemo` from Task 8, before returning, add:

```js
if (selectedTags.length > 0) {
  filtered = filtered.filter(r => (r.customTags || []).some(t => selectedTags.includes(t)));
}
```

(Adapt the variable name `filtered` to whatever the existing code uses.)

Add `selectedTags` to the `useMemo` dependency array.

- [ ] **Step 4: Accept the new props in `RecipesPage.jsx`**

Find the function signature:

```bash
grep -n "function RecipesPage\|export default function RecipesPage" /Users/elisa/Desktop/VibeCode/apps/recipe-ui/src/RecipesPage.jsx
```

Add to the destructured props:

```js
availableTags = [],
selectedTags = [],
onTagToggle = () => {},
```

- [ ] **Step 5: Add the Tags section to the filter drawer**

Find the Cuisine section in the filter drawer (look for `availableCuisines.map`). Below that section's closing tag, add a parallel Tags section:

```jsx
{availableTags.length > 0 && (
  <Box sx={{ mt: 2 }}>
    <Typography component="div" variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
      Tags
    </Typography>
    <Box
      sx={{
        display: 'flex', flexWrap: 'nowrap', overflowX: 'auto',
        gap: 1, mt: 1,
        mx: -2, px: 2,
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
        maskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
      }}
    >
      {availableTags.map((t) => {
        const selected = selectedTags.includes(t);
        return (
          <Box
            key={t}
            component="button"
            role="button"
            aria-pressed={selected}
            onClick={() => onTagToggle(t)}
            sx={(theme) => ({
              display: 'inline-flex', alignItems: 'center',
              height: 36, px: 1.75, border: 'none', borderRadius: '999px',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
              whiteSpace: 'nowrap', flexShrink: 0,
              backgroundColor: selected ? theme.palette.primary.main : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'),
              color: selected ? '#fff' : 'text.primary',
            })}
          >
            {t}
          </Box>
        );
      })}
    </Box>
  </Box>
)}
```

Match the visual treatment of the existing Cuisine chip strip — copy its `sx` block if the snippet above diverges from the actual cuisine styling.

- [ ] **Step 6: Build + UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -3
```

Expected: clean build, 116/116 tests pass.

- [ ] **Step 7: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx apps/recipe-ui/src/RecipesPage.jsx && git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): filter drawer Tags section + selectedTags filter

Renders only when the user has at least one tagged recipe (matches the
existing Cuisines section's hide-when-empty pattern). Multi-select OR
filter — recipes matching any selected tag pass through. State lives in
App.jsx alongside selectedCuisine/selectedMealType; RecipesPage receives
availableTags/selectedTags/onTagToggle as props.
"
```

---

## Task 10: Smoke test + deploy to dev worker only

**Files:**
- Live: `recipes-worker-dev` on `api-dev.recifriend.com`

- [ ] **Step 1: Run full worker test suite**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npm test 2>&1 | grep -E "FAIL |Test Files|Tests " | tail -8
```

Expected: 4 pre-existing failures (friends-suggestions × 2, public.test.ts × 2). Plus the new `sanitizeCustomTags` tests pass. No new failures.

- [ ] **Step 2: Run full UI test suite**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm test 2>&1 | tail -5
```

Expected: 116/116 pass.

- [ ] **Step 3: Smoke-test the import flow (per `feedback_protect_import_flow.md`)** — against current prod, BEFORE deploying dev

```bash
# AllRecipes (structured HTML path)
curl -s -X POST -H "Content-Type: application/json" -d '{"sourceUrl": "https://www.allrecipes.com/recipe/16354/easy-meatloaf/"}' https://api.recifriend.com/recipes/parse | python3 -c "
import json, sys
d = json.load(sys.stdin)
p = d.get('parsed') or {}
print('ingredients:', len(p.get('ingredients') or []), 'steps:', len(p.get('steps') or []))
"
```

Expected: 9 ingredients, 5 steps.

Repeat with one TikTok URL and one IG URL from `feedback_protect_import_flow.md` — confirm they return non-empty `parsed.title` (cache hit) or null with completion in <4s (cache miss).

This baseline establishes that we know what "working" looks like before the dev deploy.

- [ ] **Step 4: Deploy dev worker**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler deploy --env dev 2>&1 | tail -6
```

Expected: deploy success message including `api-dev.recifriend.com` as a route.

- [ ] **Step 5: Re-run smoke tests against DEV worker**

```bash
# Same calls but against api-dev.recifriend.com
curl -s -X POST -H "Content-Type: application/json" -d '{"sourceUrl": "https://www.allrecipes.com/recipe/16354/easy-meatloaf/"}' https://api-dev.recifriend.com/recipes/parse | python3 -c "
import json, sys
d = json.load(sys.stdin)
p = d.get('parsed') or {}
print('dev ingredients:', len(p.get('ingredients') or []), 'steps:', len(p.get('steps') or []))
"
```

Expected: same 9 ingredients, 5 steps. Proves the dev worker hasn't regressed import.

- [ ] **Step 6: Do NOT deploy prod worker. Do NOT deploy Pages.**

Stop here. Tell the user the dev environment is ready, with the URLs to test on.

---

## Task 11 (deferred — user-gated): Promote to prod

**Run only after user explicitly approves dev testing.**

- [ ] **Step 1: Final smoke test against prod (pre-deploy baseline)**

Same AllRecipes + IG + TikTok parse calls against `api.recifriend.com`. Confirm pre-deploy state.

- [ ] **Step 2: Deploy prod worker**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler deploy 2>&1 | tail -6
```

- [ ] **Step 3: Build + deploy frontend**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind --commit-dirty=true 2>&1 | tail -6
```

- [ ] **Step 4: Post-deploy smoke test against prod**

Re-run the AllRecipes / IG / TikTok parse calls against `api.recifriend.com`. Confirm no regression.

---

## Self-Review

**Spec coverage check:**
- ✅ Data model & schema (Task 1, Task 3, Task 4)
- ✅ Worker API & validation (Task 2 → Task 4)
- ✅ Frontend edit mode (Task 7)
- ✅ Frontend view mode hidden-when-empty (Task 6)
- ✅ Filter drawer Tags section (Task 9)
- ✅ Search bar tag match (Task 8)
- ✅ JSON import normalization (Task 5)
- ✅ Tests for sanitizer (Task 2)
- ✅ Smoke-test guardrail (Task 10)
- ✅ Dev-first deploy with user-gated prod promotion (Task 10 + Task 11)

**Type consistency check:**
- `Recipe.customTags: string[]` declared in Task 3, used in Task 4 (INSERT/UPDATE/SELECT), passed through frontend (`customTags` array) in Task 5, rendered in Task 6/7, filtered in Task 8/9. Consistent.
- `sanitizeCustomTags(value: unknown): string[]` exported in Task 3, called in Task 4. Matches.
- `availableTags` derived once in App.jsx (Task 7), passed as prop to RecipesPage (Task 9). Matches.

**Placeholder scan:**
- No "TBD"s, no "implement later", no "similar to Task N", no "add error handling" without spec.
- The round-trip integration test in Task 4 Step 7 offers two alternative shapes (full POST→GET vs direct `normalizeRecipePayload` call) — both are concrete; the implementer picks whichever fits the existing test file. This is intentional flexibility, not a placeholder.
