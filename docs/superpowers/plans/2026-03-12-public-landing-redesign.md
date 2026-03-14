# Public Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the logged-out public landing page across 5 sections: header copy cleanup, hashtag chips, Editor's Picks card polish, Cook with Friends revolving ticker, and worker API completeness (ingredients/steps/source_url).

**Architecture:** All changes are in the `feature/discovery-feeds` worktree at `.worktrees/discovery-feeds/`. Worker changes go in `apps/worker/src/index.ts`; frontend changes go in `apps/recipe-ui/src/components/`. The worker is tested with vitest unit tests; the frontend is verified manually in the browser.

**Tech Stack:** React + MUI v5, Cloudflare Workers (TypeScript), Cloudflare D1, vitest

---

## File Map

| File | What changes |
|------|-------------|
| `apps/worker/src/index.ts` | `getTrendingRecipes`, `getEditorsPick`, `getAiPicks` — add `ingredients`, `steps`, `source_url` to SELECT + return type |
| `apps/worker/src/public.test.ts` | Update tests to assert `ingredients`, `steps`, `sourceUrl` present; add `getTrendingRecipes` test |
| `apps/recipe-ui/src/components/WatchAndCook.jsx` → `DiscoverRecipes.jsx` | Rename file + export, swap raw `<Typography>` title for `<SectionLabel>` |
| `apps/recipe-ui/src/components/PublicLanding.jsx` | All frontend section changes: labels, filter, EditorCard restructure, hashtag chips, CookWithFriends ticker |

---

## Chunk 1: Worker API — return ingredients, steps, source_url

### Task 1: Update `getTrendingRecipes`

**Files:**
- Modify: `apps/worker/src/index.ts` (lines 1051–1068)
- Modify: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Update the test to assert the new fields**

In `apps/worker/src/public.test.ts`, add a new `describe('getTrendingRecipes')` block. First verify the test file imports `getTrendingRecipes` — add it to the import line at line 2 if not present.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getPublicDiscover, getEditorsPick, getAiPicks, getTrendingRecipes } from './index';
```

Add this describe block:

```typescript
describe('getTrendingRecipes', () => {
  it('returns ingredients, steps, and sourceUrl', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [{
            id: 'r1',
            title: 'Miso Ramen',
            source_url: 'https://www.tiktok.com/@chef/video/123',
            image_url: 'https://img.example.com/ramen.jpg',
            meal_types: '["Dinner"]',
            duration_minutes: 20,
            ingredients: '["noodles","miso paste"]',
            steps: '["Boil noodles","Add miso"]',
          }]
        })
      })
    } as unknown as D1Database;

    const result = await getTrendingRecipes(mockDb);
    expect(result).toHaveLength(1);
    expect(result[0].ingredients).toEqual(['noodles', 'miso paste']);
    expect(result[0].steps).toEqual(['Boil noodles', 'Add miso']);
    expect(result[0].sourceUrl).toBe('https://www.tiktok.com/@chef/video/123');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 'getTrendingRecipes'
```

Expected: test fails because `result[0].ingredients` is undefined.

- [ ] **Step 3: Update `getTrendingRecipes` in `index.ts`**

Find `getTrendingRecipes` at line ~1051. Make these changes:

Update the return type signature:
```typescript
export async function getTrendingRecipes(db: D1Database): Promise<Array<{
  id: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
}>> {
```

Update the SELECT to include the new columns:
```typescript
  const rows = await db.prepare(
    `SELECT id, title, source_url, image_url, meal_types, duration_minutes, ingredients, steps
     FROM recipes WHERE id IN (${placeholders})`
  ).bind(...CURATED_COMMUNITY_IDS).all();
```

Update the `.map()` to include the new fields:
```typescript
  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    ingredients: JSON.parse(String(r.ingredients || '[]')),
    steps: JSON.parse(String(r.steps || '[]')),
  }));
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 'getTrendingRecipes'
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/worker/src/index.ts apps/worker/src/public.test.ts && git commit -m "feat(worker): getTrendingRecipes returns ingredients, steps, sourceUrl"
```

---

### Task 2: Update `getEditorsPick`

**Files:**
- Modify: `apps/worker/src/index.ts` (lines 1081–1100)
- Modify: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Update the existing `getEditorsPick` test to assert new fields**

In the existing `describe('getEditorsPick')` block, update the mock `results` array to include `ingredients` and `steps`, and add assertions:

```typescript
// In the mock results for the first test:
{
  id: 'r1', title: 'Beef and Guiness Stew', source_url: 'https://example.com',
  image_url: '', meal_types: '["Dinner"]', duration_minutes: 90,
  ingredients: '["beef","guinness"]', steps: '["Brown beef","Add stout"]',
},
{
  id: 'r2', title: 'Honey lime chicken bowl', source_url: '',
  image_url: '', meal_types: '["Lunch"]', duration_minutes: 25,
  ingredients: '[]', steps: '[]',
}

// Add to existing assertions:
expect(result[0].ingredients).toEqual(['beef', 'guinness']);
expect(result[0].steps).toEqual(['Brown beef', 'Add stout']);
expect(result[0].sourceUrl).toBe('https://example.com');
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 'getEditorsPick'
```

Expected: FAIL — `result[0].ingredients` is undefined.

- [ ] **Step 3: Update `getEditorsPick` in `index.ts`**

Update the return type (lines ~1081–1083):
```typescript
export async function getEditorsPick(db: D1Database, titles: string[] = EDITOR_PICK_TITLES): Promise<Array<{
  id: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
}>> {
```

Update the SELECT:
```typescript
  const rows = await db.prepare(
    `SELECT id, title, source_url, image_url, meal_types, duration_minutes, ingredients, steps
     FROM recipes
     WHERE title IN (${placeholders})
     ORDER BY created_at ASC`
  ).bind(...titles).all();
```

Update the `.map()`:
```typescript
  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    ingredients: JSON.parse(String(r.ingredients || '[]')),
    steps: JSON.parse(String(r.steps || '[]')),
  }));
```

- [ ] **Step 4: Run to confirm it passes**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 'getEditorsPick'
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/worker/src/index.ts apps/worker/src/public.test.ts && git commit -m "feat(worker): getEditorsPick returns ingredients, steps, sourceUrl"
```

---

### Task 3: Update `getAiPicks`

**Files:**
- Modify: `apps/worker/src/index.ts` (lines 1102–1150)
- Modify: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Update the `getAiPicks` test to assert new fields**

In the `describe('getAiPicks')` block:

**"calls Gemini" test** — update mock `first()` and add assertions:
```typescript
// Update mock first() return:
first: vi.fn().mockResolvedValue({
  id: 'r1', title: 'Berry Bake',
  source_url: 'https://example.com/berry',
  image_url: '', meal_types: '[]', duration_minutes: null,
  ingredients: '["berries","yogurt"]',
  steps: '["Mix","Bake"]',
}),

// Add to assertions after result[0].topic check:
expect(result[0].recipe.sourceUrl).toBe('https://example.com/berry');
expect(result[0].recipe.ingredients).toEqual(['berries', 'yogurt']);
expect(result[0].recipe.steps).toEqual(['Mix', 'Bake']);
```

**"cached result" test** — update the cached JSON string to include the new fields so the shape round-trips correctly:
```typescript
const cached = JSON.stringify([{
  topic: 'Gut health',
  hashtag: '#GutHealth',
  recipe: {
    id: 'r1', title: 'Berry Bake', imageUrl: '',
    mealTypes: [], durationMinutes: null,
    sourceUrl: 'https://example.com/berry',
    ingredients: ['berries'], steps: ['Mix'],
  }
}]);

// Add assertions:
expect(result[0].recipe.sourceUrl).toBe('https://example.com/berry');
expect(result[0].recipe.ingredients).toEqual(['berries']);
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 'getAiPicks'
```

Expected: FAIL — `result[0].recipe.sourceUrl` etc. are undefined.

- [ ] **Step 3: Update the `AiPick` type and `getAiPicks` function in `index.ts`**

Update `AiPick` type at line ~1102:
```typescript
type AiPick = {
  topic: string;
  hashtag: string;
  recipe: {
    id: string; title: string; imageUrl: string;
    mealTypes: string[]; durationMinutes: number | null;
    sourceUrl: string; ingredients: string[]; steps: string[];
  }
};
```

Update the SELECT inside `getAiPicks` at line ~1135:
```typescript
    const row = await db.prepare(
      `SELECT id, title, image_url, meal_types, duration_minutes, source_url, ingredients, steps
       FROM recipes WHERE title LIKE ? AND shared_with_friends = 1 LIMIT 1`
    ).bind(`%${item.match}%`).first() as Record<string, unknown> | null;
```

Update the recipe object mapping:
```typescript
      picks.push({
        topic: item.topic,
        hashtag: item.hashtag,
        recipe: {
          id: String(row.id),
          title: String(row.title),
          imageUrl: String(row.image_url),
          mealTypes: JSON.parse(String(row.meal_types || '[]')),
          durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
          sourceUrl: String(row.source_url || ''),
          ingredients: JSON.parse(String(row.ingredients || '[]')),
          steps: JSON.parse(String(row.steps || '[]')),
        }
      });
```

- [ ] **Step 4: Run all worker tests to confirm everything passes**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test
```

Expected: all tests PASS, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/worker/src/index.ts apps/worker/src/public.test.ts && git commit -m "feat(worker): getAiPicks returns ingredients, steps, sourceUrl"
```

---

## Chunk 2: Frontend — Section 2 (Discover New Recipes)

### Task 4: Rename WatchAndCook → DiscoverRecipes, update filter

**Files:**
- Rename: `apps/recipe-ui/src/components/WatchAndCook.jsx` → `DiscoverRecipes.jsx`
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Verify no other imports before renaming**

```bash
grep -r "WatchAndCook" .worktrees/discovery-feeds/apps/recipe-ui/src/
```

Expected: only one result — the import in `PublicLanding.jsx`. If other files import it, update them too before proceeding.

- [ ] **Step 2: Rename the file and remove the title from inside it**

`SectionLabel` is a private function in `PublicLanding.jsx` and is not exported. The cleanest fix is to remove the title entirely from `DiscoverRecipes.jsx` — `PublicLanding.jsx` will render the `SectionLabel` above the component, just like it does for every other section.

```bash
cd .worktrees/discovery-feeds && git mv apps/recipe-ui/src/components/WatchAndCook.jsx apps/recipe-ui/src/components/DiscoverRecipes.jsx
```

Open `apps/recipe-ui/src/components/DiscoverRecipes.jsx`. Make two changes:

1. **Remove** the raw `<Typography>` title block entirely:
```jsx
// Delete this:
<Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>
  📺 Watch &amp; Cook
</Typography>
```

2. Rename the default export:
```jsx
// Before: export default function WatchAndCook(...)
// After:  export default function DiscoverRecipes(...)
```

- [ ] **Step 3: Update the import and filter in `PublicLanding.jsx`**

In `apps/recipe-ui/src/components/PublicLanding.jsx`:

1. Update the import line:
```jsx
// Before:
import WatchAndCook from './WatchAndCook';
// After:
import DiscoverRecipes from './DiscoverRecipes';
```

2. Add the `isSocialVideoRecipe` helper function near the top of the file (after imports, before the component):
```jsx
function isSocialVideoRecipe(url) {
  if (!url) return false;
  return url.includes('youtube.com') || url.includes('youtu.be')
    || url.includes('tiktok.com') || url.includes('instagram.com');
}
```

3. Replace the `videoRecipes` computation (currently at line ~57):
```jsx
// Before:
const videoRecipes = trending.filter(r => buildVideoEmbedUrl(r.sourceUrl) !== null);
// After:
const allVideoRecipes = trending.filter(r => isSocialVideoRecipe(r.sourceUrl));
const youtubeShorts = allVideoRecipes.filter(r => r.sourceUrl?.includes('/shorts/')).slice(0, 2);
const instagramRecipes = allVideoRecipes.filter(r => r.sourceUrl?.includes('instagram.com')).slice(0, 2);
const tiktokRecipes = allVideoRecipes.filter(r => r.sourceUrl?.includes('tiktok.com')).slice(0, 1);
const videoRecipes = [...youtubeShorts, ...instagramRecipes, ...tiktokRecipes];
```

4. Update the JSX block that renders this section. The current code is:
```jsx
{videoRecipes.length > 0 && (
  <Box>
    <WatchAndCook recipes={videoRecipes} onOpen={onOpenRecipe} />
  </Box>
)}
```
Replace with (add `SectionLabel` above the component, which no longer renders its own title):
```jsx
{videoRecipes.length > 0 && (
  <Box>
    <SectionLabel label="Discover New Recipes" />
    <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
  </Box>
)}
```

- [ ] **Step 4: Start the dev server and verify**

```bash
cd .worktrees/discovery-feeds/apps/recipe-ui && npm run dev -- --host
```

Open the app logged out. Confirm the "Discover New Recipes" section header shows (no emoji, correct text). Confirm the video cards still render.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/recipe-ui/src/components/DiscoverRecipes.jsx apps/recipe-ui/src/components/PublicLanding.jsx && git commit -m "feat(ui): rename WatchAndCook to DiscoverRecipes, update filter to include Instagram"
```

---

## Chunk 3: Frontend — Sections 1, 3, 4 (Labels + EditorCard + Hashtag Chips)

### Task 5: Section 1 — rename label

**Files:**
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Update the Trending section label call site**

Find this line in `PublicLanding.jsx` (around line 68):
```jsx
<SectionLabel emoji="🔥" label="Trending from the community" />
```
Replace with:
```jsx
<SectionLabel label="Trending Now" />
```

- [ ] **Step 2: Fix `SectionLabel` to avoid leading space when `emoji` prop is absent**

The helper currently renders `{emoji} {label}` — when `emoji` is `undefined`, this produces a leading space before the label. Fix the helper in `PublicLanding.jsx` (around line 133):

```jsx
// Before:
<Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
  {emoji} {label}
</Typography>
// After:
<Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
  {emoji ? `${emoji} ` : ''}{label}
</Typography>
```

- [ ] **Step 3: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/recipe-ui/src/components/PublicLanding.jsx && git commit -m "feat(ui): rename Trending section header, remove emoji, fix SectionLabel spacing"
```

---

### Task 6: Section 3 — Editor's Picks label + EditorCard restructure

**Files:**
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Update the Editor's Pick section label**

Find (around line 90):
```jsx
<SectionLabel emoji="⭐" label="Editor's Pick" />
```
Replace with:
```jsx
<SectionLabel label="Editor's Picks" />
```

- [ ] **Step 2: Restructure `EditorCard`**

Find the `EditorCard` function (around line 143). Replace it entirely:

```jsx
function EditorCard({ recipe, onSave, onShare, onOpen }) {
  return (
    <Card elevation={0} sx={{
      borderRadius: 2, border: 1, borderColor: 'divider',
      bgcolor: 'background.paper', display: 'flex', flexDirection: 'column'
    }}>
      <CardActionArea onClick={() => onOpen?.(recipe)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, pr: 1.5 }}>
        <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
          {recipe.imageUrl
            ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🍳</Box>
          }
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{recipe.title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {recipe.mealTypes?.[0]} {recipe.durationMinutes ? `· ${recipe.durationMinutes} min` : ''}
          </Typography>
        </Box>
      </CardActionArea>
      <Box sx={{ display: 'flex', gap: 1, px: 1, pb: 1 }}>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<IosShareOutlinedIcon />}
          sx={{ flex: 1 }}
          onClick={(e) => { e.stopPropagation(); onShare?.(recipe); }}
        >
          Share
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={<BookmarkBorderIcon />}
          sx={{ flex: 1 }}
          onClick={(e) => { e.stopPropagation(); onSave?.(); }}
        >
          Save
        </Button>
      </Box>
    </Card>
  );
}
```

- [ ] **Step 3: Add missing icon imports to `PublicLanding.jsx`**

`IosShareOutlinedIcon` and `BookmarkBorderIcon` are not currently imported in `PublicLanding.jsx`. Add them unconditionally:
```jsx
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
```

`Button` is already in the MUI import line — no change needed there.

- [ ] **Step 4: Pass `onShare` to `EditorCard` call sites**

Find the `EditorCard` usage (around line 93):
```jsx
<EditorCard key={recipe.id} recipe={recipe} onSave={onJoin} onOpen={onOpenRecipe} />
```
Replace with:
```jsx
<EditorCard key={recipe.id} recipe={recipe} onSave={onJoin} onShare={handleShare} onOpen={onOpenRecipe} />
```

- [ ] **Step 5: Verify in browser**

Open the app logged out. Check the Editor's Picks section shows "Editor's Picks" (no emoji). Confirm cards now show both Share and Save buttons stacked below the title/thumbnail row. Open browser DevTools console — confirm no "validateDOMNesting" warnings for nested buttons.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/recipe-ui/src/components/PublicLanding.jsx && git commit -m "feat(ui): Editor's Picks label + restructure EditorCard with Share/Save buttons"
```

---

### Task 7: Section 4 — hashtag chips

**Files:**
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Update the AI picks section label**

Find (around line 108):
```jsx
<SectionLabel emoji="🥦" label="Trending in health and nutrition" />
```
Replace with:
```jsx
<SectionLabel label="Trending in health and nutrition" />
```

- [ ] **Step 2: Add `Chip` to MUI imports**

Find the MUI import line at the top of `PublicLanding.jsx`:
```jsx
import { Box, Container, Typography, Button, Stack, Card, CardActionArea } from '@mui/material';
```
Add `Chip`:
```jsx
import { Box, Container, Typography, Button, Stack, Card, CardActionArea, Chip } from '@mui/material';
```

- [ ] **Step 3: Replace the hashtag `<Typography>` with `<Chip>`**

Find this block (around line 111–114):
```jsx
<Box key={p.topic} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
  <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color: 'primary.main', flexShrink: 0, mt: '1px' }}>{p.hashtag}</Typography>
  <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>{p.reason}</Typography>
</Box>
```

Replace with:
```jsx
<Box key={p.topic} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
  <Chip
    label={p.hashtag}
    size="small"
    variant="outlined"
    sx={{ color: darkMode ? '#fff' : 'text.secondary', borderColor: 'divider', fontSize: 11, height: 20, borderRadius: '10px', flexShrink: 0 }}
  />
  <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>{p.reason}</Typography>
</Box>
```

- [ ] **Step 4: Verify in browser — both light and dark mode**

Open the app logged out. The "Trending in health and nutrition" section should show pill-shaped chips for hashtags. Toggle dark mode (hamburger → dark mode switch) — chip text should turn white.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/recipe-ui/src/components/PublicLanding.jsx && git commit -m "feat(ui): hashtag pills in AI picks section, remove section header emojis"
```

---

## Chunk 4: Frontend — Section 5 (Cook with Friends Ticker)

### Task 8: Cook with Friends — revolving ticker animation

**Files:**
- Modify: `apps/recipe-ui/src/components/PublicLanding.jsx`

- [ ] **Step 1: Add `useRef` to React imports**

At the top of `PublicLanding.jsx`, ensure `useRef` is imported:
```jsx
import { useState, useEffect, useRef } from 'react';
```

- [ ] **Step 2: Replace `CookWithFriends` and `ActivityRow` components**

Find `CookWithFriends` (around line 169) and `ActivityRow` (around line 201). Replace both functions entirely with the following:

```jsx
const TICKER_DATA = [
  {
    initial: 'E', name: 'Elisa', color: '#7c3aed',
    activities: [
      { text: 'saved Miso Ramen ❤️', time: '2h' },
      { text: 'shared Pad Thai with Sarah', time: '1d' },
      { text: 'is cooking Bulgogi tonight 🥩', time: 'now' },
    ],
  },
  {
    initial: 'H', name: 'Henny', color: '#10b981',
    activities: [
      { text: 'shared Beef Stew with you', time: '5h' },
      { text: 'saved Salmon Bowl 🐟', time: '3h' },
      { text: 'cooked Mushroom Risotto 🍚', time: '2d' },
    ],
  },
  {
    initial: 'M', name: 'Max', color: '#f59e0b',
    activities: [
      { text: 'is cooking Tacos tonight 🌮', time: 'now' },
      { text: 'saved Chicken Tikka Masala 🍛', time: '6h' },
      { text: 'shared Pasta Carbonara 🍝 with Elisa', time: '1d' },
    ],
  },
];

const HOLD_MS    = 2800;
const OUT_MS     = 550;
const IN_MS      = 650;
const OVERLAP_MS = 220;
const OUT_EASE   = 'cubic-bezier(0.4, 0, 1, 1)';
const IN_EASE    = 'cubic-bezier(0, 0, 0.2, 1)';

// Note: TickerStage owns its own refs and interval (per-component pattern).
// The spec described a 2D ref array owned by CookWithFriends — this is a deliberate
// deviation: per-component is simpler and produces identical visible behavior.
function TickerStage({ ticker }) {
  const refs = useRef([]);
  const currentIdx = useRef(0);

  useEffect(() => {
    const items = refs.current;
    if (!items.length) return;

    // Declare timer IDs outside cycle() so the cleanup closure can clear them
    let enterTimer = null;
    let resetTimer = null;

    const cycle = () => {
      const prev = currentIdx.current;
      const next = (prev + 1) % items.length;
      currentIdx.current = next;

      // Exit current
      const prevEl = items[prev];
      prevEl.style.transition = `opacity ${OUT_MS}ms ${OUT_EASE}, transform ${OUT_MS}ms ${OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-12px)';

      // Enter next — overlap with exit
      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${IN_MS}ms ${IN_EASE}, transform ${IN_MS}ms ${IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, OUT_MS - OVERLAP_MS);

      // Reset exited node (snap it back below, ready for reuse)
      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, OUT_MS + 100);
    };

    const interval = setInterval(cycle, HOLD_MS + OUT_MS);
    // Clean up interval AND any pending timers on unmount
    return () => {
      clearInterval(interval);
      clearTimeout(enterTimer);
      clearTimeout(resetTimer);
    };
  }, []);

  return (
    <Box sx={{ position: 'relative', height: 44, overflow: 'hidden', mb: 0.75 }}>
      {ticker.activities.map((activity, i) => (
        <Box
          key={i}
          ref={el => { refs.current[i] = el; }}
          style={{
            opacity: i === 0 ? 1 : 0,
            transform: i === 0 ? 'translateY(0)' : 'translateY(20px)',
          }}
          sx={{
            position: 'absolute', inset: 0,
            bgcolor: 'background.paper', borderRadius: 2,
            display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
            fontSize: 11, color: 'text.secondary',
            willChange: 'opacity, transform',
          }}
        >
          <Box sx={{
            width: 26, height: 26, borderRadius: '50%',
            bgcolor: ticker.color, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>
            <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{ticker.initial}</Typography>
          </Box>
          <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary' }}>
            <Box component="span" sx={{ color: ticker.color, fontWeight: 600 }}>{ticker.name}</Box>{' '}{activity.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>{activity.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function CookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{
      borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)',
    }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Join ReciFind to share recipes and see what your friends are cooking.
      </Typography>
      {TICKER_DATA.map((ticker, i) => (
        <TickerStage key={i} ticker={ticker} />
      ))}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button fullWidth variant="contained" disableElevation onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
          Join free
        </Button>
        <Button fullWidth variant="outlined" onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none' }}>
          Invite a friend
        </Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Verify in browser**

Open the app logged out. Scroll to "Cook with Friends". Confirm:
- Title is "Cook with Friends" (no emoji)
- No "Cooking is better together" subtitle
- "Join ReciFind..." text appears before the tickers
- 3 ticker rows visible, each cycling through activities with smooth fade-up-out / slide-in-from-below animation
- Buttons are taller than before (default MUI size, not small)
- Wait 3+ full cycles — no flash, no blank frames

- [ ] **Step 4: Commit**

```bash
cd .worktrees/discovery-feeds && git add apps/recipe-ui/src/components/PublicLanding.jsx && git commit -m "feat(ui): Cook with Friends revolving ticker animation"
```

---

## Final: End-to-end verification

- [ ] **Step 1: Run all worker tests**

```bash
cd .worktrees/discovery-feeds/apps/worker && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Start worker in remote mode and frontend dev server**

In two terminals:
```bash
# Terminal 1 — worker
cd .worktrees/discovery-feeds/apps/worker && npx wrangler dev --port 8787 --remote

# Terminal 2 — frontend
cd .worktrees/discovery-feeds/apps/recipe-ui && npm run dev -- --host
```

- [ ] **Step 3: Full manual checklist (logged out)**

- [ ] Trending Now: no emoji in header, tap a card → ingredients + steps + source link visible in detail view
- [ ] Discover New Recipes: no emoji, video cards render, tap a card → ingredients + steps + source link visible
- [ ] Editor's Picks: header says "Editor's Picks", cards show Share + Save buttons below thumbnail row, no nested button warning in console
- [ ] Trending in health and nutrition: no emoji, hashtags are pill chips; toggle dark mode → chips text is white
- [ ] Cook with Friends: no emoji in title, no "Cooking is better together", "Join ReciFind..." text before tickers, 3 separate ticker rows animate smoothly, buttons are default height
- [ ] Tap an AI picks recipe → ingredients + steps + source link visible
