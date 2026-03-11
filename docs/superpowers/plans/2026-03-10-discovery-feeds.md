# Discovery Feeds & Landing Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static logged-out recipe list with a structured discovery landing page, add personalized sections to the logged-in home feed, add a 3-screen onboarding flow, and start tracking cook mode usage.

**Architecture:** Three independent phases — Phase 1 (public landing) ships first as it has the highest acquisition impact, Phase 2 (logged-in sections + onboarding) builds on shared endpoints from Phase 1, Phase 3 (cook mode tracking) is a tiny addition that can ship alongside either. New frontend UI is extracted into dedicated component files to avoid further bloating App.jsx. New worker endpoints follow the existing if-else routing pattern in index.ts.

**Tech Stack:** React + MUI (frontend), Cloudflare Workers + D1 + KV (backend), Gemini API (AI picks), vitest (worker tests), wrangler (D1 migrations + KV namespace)

---

## Chunk 1: Phase 1 — Public Landing Page

### Task 1: KV namespace + wrangler binding for AI picks cache

**Files:**
- Modify: `apps/worker/wrangler.toml`
- Modify: `apps/worker/src/index.ts` (Env interface only)

- [ ] **Step 1: Create KV namespace**

Run from `apps/worker/`:
```bash
cd apps/worker && npx wrangler kv namespace create AI_PICKS_CACHE
```
Expected output includes a line like:
```
{ binding = "AI_PICKS_CACHE", id = "xxxx-your-namespace-id" }
```
Copy the `id` value.

- [ ] **Step 2: Add KV binding to wrangler.toml**

Add after the `[[d1_databases]]` block. Replace `YOUR_NAMESPACE_ID` with the actual `id` value copied from Step 1's output:
```toml
[[kv_namespaces]]
binding = "AI_PICKS_CACHE"
id = "YOUR_NAMESPACE_ID"   # ← replace this with the real ID before saving
```

- [ ] **Step 3: Add KV to Env interface in index.ts**

Find the `export interface Env {` block (line ~7) and add:
```typescript
AI_PICKS_CACHE: KVNamespace;
```

- [ ] **Step 4: Commit**
```bash
git add apps/worker/wrangler.toml apps/worker/src/index.ts
git commit -m "chore: add KV namespace binding for AI picks cache"
```

---

### Task 2: DB migration — cook_events + profile prefs (combined migration)

**Files:**
- Create: `apps/worker/migrations/0004_discovery.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Cook mode event tracking
CREATE TABLE IF NOT EXISTS cook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  cooked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cook_events_user ON cook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_cook_events_recipe ON cook_events(recipe_id);

-- User onboarding preferences (added to profiles)
ALTER TABLE profiles ADD COLUMN meal_type_prefs TEXT;
ALTER TABLE profiles ADD COLUMN dietary_prefs TEXT;
ALTER TABLE profiles ADD COLUMN skill_level TEXT;
```

- [ ] **Step 2: Apply migration locally**

```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --local
```
Expected: `✅ Migration 0004_discovery.sql applied`

- [ ] **Step 3: Apply migration to production**

```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --remote
```
Expected: `✅ Migration 0004_discovery.sql applied`

- [ ] **Step 4: Commit**
```bash
git add apps/worker/migrations/0004_discovery.sql
git commit -m "feat: add cook_events table and profile preference columns"
```

---

### Task 3: Worker — GET /public/discover

**Files:**
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/worker/src/public.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { getPublicDiscover } from './index';

describe('getPublicDiscover', () => {
  it('returns recipes with social source URLs', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'r1', title: 'Miso Ramen',
              source_url: 'https://www.tiktok.com/@chef/video/123',
              image_url: 'https://img.example.com/ramen.jpg',
              meal_types: '["Dinner"]', duration_minutes: 20
            }
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getPublicDiscover(mockDb);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Miso Ramen');
    expect(result[0].sourceUrl).toBe('https://www.tiktok.com/@chef/video/123');
  });

  it('returns empty array when no social recipes exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] })
      })
    } as unknown as D1Database;

    const result = await getPublicDiscover(mockDb);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: FAIL — `getPublicDiscover` is not exported

- [ ] **Step 3: Implement getPublicDiscover in index.ts**

Add this exported function near the other public handler functions (search for `handleOembedAuthor` to find the right area, add below it):
```typescript
export async function getPublicDiscover(db: D1Database): Promise<Array<{
  id: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
}>> {
  const rows = await db.prepare(
    `SELECT id, title, source_url, image_url, meal_types, duration_minutes
     FROM recipes
     WHERE (source_url LIKE '%tiktok.com%' OR source_url LIKE '%instagram.com%')
     ORDER BY created_at DESC
     LIMIT 10`
  ).all();
  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
  }));
}
```

Then add the route in the `fetch` handler, right after the `/public/oembed-author` route (around line 223):
```typescript
if (url.pathname === '/public/discover' && request.method === 'GET') {
  return await (async () => {
    const recipes = await getPublicDiscover(env.DB);
    return json({ recipes }, 200, withCors());
  })();
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/public.test.ts
git commit -m "feat: add GET /public/discover endpoint"
```

---

### Task 4: Worker — GET /public/editors-pick

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/worker/src/public.test.ts`. Update the existing import line at the top of the file to include `getEditorsPick`:
```typescript
// Update existing import — do NOT add a second import statement
import { getPublicDiscover, getEditorsPick } from './index';
```

Then add after the existing `describe('getPublicDiscover', ...)` block:
```typescript
describe('getEditorsPick', () => {
  const EDITOR_TITLES = ['Beef and Guiness Stew', 'Honey lime chicken bowl'];

  it('returns recipes matching editor titles', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'r1', title: 'Beef and Guiness Stew', source_url: '', image_url: '', meal_types: '["Dinner"]', duration_minutes: 90 },
            { id: 'r2', title: 'Honey lime chicken bowl', source_url: '', image_url: '', meal_types: '["Lunch"]', duration_minutes: 25 },
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, EDITOR_TITLES);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toContain('Beef and Guiness Stew');
  });

  it('returns empty array when no matching recipes exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] })
      })
    } as unknown as D1Database;

    const result = await getEditorsPick(mockDb, EDITOR_TITLES);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: FAIL — `getEditorsPick` is not exported

- [ ] **Step 3: Implement getEditorsPick and the route**

Add after `getPublicDiscover` in index.ts:
```typescript
// IMPORTANT: These titles must exactly match the `title` column values stored in D1.
// Before deploying, verify by running:
//   npx wrangler d1 execute recipes-db --remote --command="SELECT title FROM recipes WHERE title LIKE '%Stew%' OR title LIKE '%moco%' LIMIT 20"
// Adjust casing below to match what is actually stored. SQLite IN() is case-sensitive for ASCII.
const EDITOR_PICK_TITLES = [
  'Beef and Guiness Stew', 'Loco moco', 'Galbi tang',
  'Watermelon salad', 'Broccoli cheddar soup', 'Honey lime chicken bowl',
  'Blueberry cream pancake', 'Banana Bread', 'Swiss croissant bake',
  'Pear puff pastry', 'Berry yogurt bake',
];

export async function getEditorsPick(db: D1Database, titles: string[] = EDITOR_PICK_TITLES): Promise<Array<{
  id: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
}>> {
  const placeholders = titles.map(() => '?').join(', ');
  const rows = await db.prepare(
    `SELECT id, title, source_url, image_url, meal_types, duration_minutes
     FROM recipes
     WHERE title IN (${placeholders})
     ORDER BY created_at ASC`
  ).bind(...titles).all();
  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
  }));
}
```

Add the route after `/public/discover`:
```typescript
if (url.pathname === '/public/editors-pick' && request.method === 'GET') {
  return await (async () => {
    const recipes = await getEditorsPick(env.DB);
    return json({ recipes }, 200, withCors());
  })();
}
```

- [ ] **Step 4: Run tests**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/public.test.ts
git commit -m "feat: add GET /public/editors-pick endpoint"
```

---

### Task 5: Worker — GET /public/ai-picks

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/public.test.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/worker/src/public.test.ts`. Update the existing import line at the top of the file to include `getAiPicks`:
```typescript
// Update existing import — do NOT add a second import statement
import { getPublicDiscover, getEditorsPick, getAiPicks } from './index';
```

Then add after the `describe('getEditorsPick', ...)` block:
```typescript
describe('getAiPicks', () => {
  it('returns cached result from KV without calling Gemini', async () => {
    const cached = JSON.stringify([{ topic: 'Gut health', hashtag: '#GutHealth', recipe: { id: 'r1', title: 'Berry Bake' } }]);
    const mockKV = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
    } as unknown as KVNamespace;
    const mockDb = { prepare: vi.fn() } as unknown as D1Database;
    const mockCallGemini = vi.fn();

    const result = await getAiPicks(mockDb, mockKV, mockCallGemini, {}, {});
    expect(mockCallGemini).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe('Gut health');
  });

  it('calls Gemini and writes to KV when cache is empty', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 'r1', title: 'Berry Bake', source_url: '', image_url: '', meal_types: '[]', duration_minutes: null }),
      })
    } as unknown as D1Database;
    const mockCallGemini = vi.fn().mockResolvedValue(
      '[{"topic":"Gut health","hashtag":"#GutHealth","match":"Berry Bake"}]'
    );

    const result = await getAiPicks(mockDb, mockKV, mockCallGemini, {}, {});
    expect(mockCallGemini).toHaveBeenCalledOnce();
    expect(mockKV.put).toHaveBeenCalledOnce();
    expect(result[0].topic).toBe('Gut health');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: FAIL — `getAiPicks` is not exported

- [ ] **Step 3: Implement getAiPicks and the route**

Add after `getEditorsPick` in index.ts:
```typescript
type AiPick = { topic: string; hashtag: string; recipe: { id: string; title: string; imageUrl: string; mealTypes: string[]; durationMinutes: number | null } };

export async function getAiPicks(
  db: D1Database,
  kv: KVNamespace,
  gemini: (env: Env, prompt: string) => Promise<string>,
  env: Partial<Env>,
  prefs: { mealTypes?: string; diet?: string; skill?: string } = {}
): Promise<AiPick[]> {
  const cacheKey = `ai-picks:${prefs.mealTypes || 'all'}:${prefs.diet || 'any'}:${prefs.skill || 'any'}`;
  const cached = await kv.get(cacheKey);
  if (cached) return JSON.parse(cached) as AiPick[];

  const prefsNote = prefs.mealTypes || prefs.diet
    ? `User preferences: meal types=${prefs.mealTypes || 'any'}, diet=${prefs.diet || 'any'}, skill=${prefs.skill || 'any'}.`
    : '';

  const prompt = `You are a cooking trend analyst. ${prefsNote} What are 3 trending health or nutrition topics this week relevant to home cooking? For each topic, suggest one simple recipe name that matches it. Return ONLY a JSON array with this exact shape and no markdown: [{"topic":"string","hashtag":"string","match":"recipe title string"}]`;

  let parsed: Array<{ topic: string; hashtag: string; match: string }> = [];
  try {
    const raw = await gemini(env as Env, prompt);
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const picks: AiPick[] = [];
  for (const item of parsed.slice(0, 3)) {
    const row = await db.prepare(
      `SELECT id, title, image_url, meal_types, duration_minutes FROM recipes WHERE title LIKE ? AND shared_with_friends = 1 LIMIT 1`
    ).bind(`%${item.match}%`).first() as Record<string, unknown> | null;
    if (row) {
      picks.push({
        topic: item.topic,
        hashtag: item.hashtag,
        recipe: {
          id: String(row.id),
          title: String(row.title),
          imageUrl: String(row.image_url),
          mealTypes: JSON.parse(String(row.meal_types || '[]')),
          durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
        }
      });
    }
  }

  await kv.put(cacheKey, JSON.stringify(picks), { expirationTtl: 604800 }); // 7 days
  return picks;
}
```

Add the route after `/public/editors-pick`. Note: `callGemini` is already defined in index.ts (around line 3016) and used by the existing enrichment flow — no import needed, just reference it directly:
```typescript
if (url.pathname === '/public/ai-picks' && request.method === 'GET') {
  return await (async () => {
    const prefs = {
      mealTypes: url.searchParams.get('meal_types') || undefined,
      diet: url.searchParams.get('diet') || undefined,
      skill: url.searchParams.get('skill') || undefined,
    };
    const picks = await getAiPicks(env.DB, env.AI_PICKS_CACHE, callGemini, env, prefs);
    return json({ picks }, 200, withCors());
  })();
}
```

- [ ] **Step 4: Run tests**
```bash
cd apps/worker && npm test -- --testPathPattern=public.test
```
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/public.test.ts
git commit -m "feat: add GET /public/ai-picks endpoint with Gemini + KV cache"
```

---

### Task 6: Frontend — RecipeShelf reusable component

**Files:**
- Create: `apps/recipe-ui/src/components/RecipeShelf.jsx`

This is a horizontal-scroll shelf of recipe cards used by Trending, Editor's Pick, and AI Picks sections. No tests needed — pure UI component.

- [ ] **Step 1: Create the component**

Create `apps/recipe-ui/src/components/RecipeShelf.jsx`:
```jsx
import { Box, Typography, Card, CardActionArea, Chip, Button } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';

/**
 * Horizontal scrollable shelf of recipe cards.
 * Props:
 *   recipes: Array<{ id, title, imageUrl, mealTypes, durationMinutes, sourceUrl?, platform?, saves? }>
 *   onSave: (recipe) => void  — called when Save is clicked
 *   onOpen: (recipe) => void  — called when card is clicked
 *   showPlatformBadge: boolean — show TikTok/Instagram badge
 *   cardWidth: number (default 140)
 */
export default function RecipeShelf({ recipes = [], onSave, onOpen, showPlatformBadge = false, cardWidth = 140 }) {
  if (!recipes.length) return null;

  return (
    <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 1, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
      {recipes.map((recipe) => {
        const platform = showPlatformBadge ? getPlatform(recipe.sourceUrl) : null;
        return (
          <Card
            key={recipe.id}
            elevation={0}
            sx={{ flexShrink: 0, width: cardWidth, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
          >
            <CardActionArea onClick={() => onOpen?.(recipe)} sx={{ p: 0 }}>
              <Box sx={{ width: cardWidth, height: cardWidth, position: 'relative', bgcolor: 'action.hover', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
                {recipe.imageUrl
                  ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🍳</Box>
                }
                {platform && (
                  <Chip
                    label={platform.label}
                    size="small"
                    sx={{ position: 'absolute', top: 6, left: 6, height: 18, fontSize: 9, fontWeight: 700, bgcolor: platform.color, color: '#fff', borderRadius: 1 }}
                  />
                )}
              </Box>
              <Box sx={{ p: 1 }}>
                <Typography variant="caption" display="block" noWrap fontWeight={600} sx={{ color: 'text.primary', fontSize: 11, lineHeight: 1.3, mb: 0.25 }}>
                  {recipe.title}
                </Typography>
                {recipe.durationMinutes && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                    {recipe.durationMinutes} min
                  </Typography>
                )}
              </Box>
            </CardActionArea>
            <Box sx={{ px: 1, pb: 1 }}>
              <Button
                fullWidth size="small" variant="contained" disableElevation
                startIcon={<BookmarkBorderIcon sx={{ fontSize: 14 }} />}
                onClick={(e) => { e.stopPropagation(); onSave?.(recipe); }}
                sx={{ borderRadius: 20, fontSize: 10, py: 0.5, textTransform: 'none' }}
              >
                Save
              </Button>
            </Box>
          </Card>
        );
      })}
    </Box>
  );
}

function getPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('tiktok.com')) return { label: 'TikTok', color: '#000' };
  if (sourceUrl.includes('instagram.com')) return { label: 'Instagram', color: '#c13584' };
  return null;
}
```

- [ ] **Step 2: Verify it renders without errors**

Start dev server and check there are no import errors:
```bash
cd apps/recipe-ui && npm run dev
```
Expected: Vite starts without errors (component isn't rendered yet, just verify no syntax errors on import)

- [ ] **Step 3: Commit**
```bash
git add apps/recipe-ui/src/components/RecipeShelf.jsx
git commit -m "feat: add RecipeShelf reusable horizontal scroll component"
```

---

### Task 7: Frontend — PublicLanding component

**Files:**
- Create: `apps/recipe-ui/src/components/PublicLanding.jsx`

This is the entire logged-out landing page — compact header + 4 sections.

- [ ] **Step 1: Create PublicLanding.jsx**

Create `apps/recipe-ui/src/components/PublicLanding.jsx`:
```jsx
import { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Stack,
  Card, CardActionArea
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RecipeShelf from './RecipeShelf';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Full logged-out landing page.
 * Props:
 *   onJoin: () => void           — opens auth dialog
 *   onOpenRecipe: (recipe) => void — opens recipe detail
 *   darkMode: boolean
 */
export default function PublicLanding({ onJoin, onOpenRecipe, darkMode }) {
  const [trending, setTrending] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);

  useEffect(() => {
    fetchJson('/public/discover').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
    fetchJson('/public/ai-picks').then(d => setAiPicks(d?.picks || []));
  }, []);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  return (
    <Container maxWidth="sm" disableGutters>
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 6 }}>

        {/* ── Compact header ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, mb: 2 }}>
          <Box>
            <Typography fontWeight={800} fontSize={16}>ReciFind 🍳</Typography>
            <Typography variant="caption" color="text.secondary">Your group chat for cooking</Typography>
          </Box>
          <Button variant="contained" size="small" disableElevation onClick={onJoin}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 12 }}>
            Join free
          </Button>
        </Box>

        <Stack spacing={3}>

          {/* ── Section 1: Trending ── */}
          {trending.length > 0 && (
            <Box>
              <SectionLabel emoji="🔥" label="Trending from the community" />
              <RecipeShelf recipes={trending} onSave={onJoin} onOpen={onOpenRecipe} showPlatformBadge cardWidth={148} />
            </Box>
          )}

          {/* ── Section 2: Editor's Pick ── */}
          {editorsPick.length > 0 && (
            <Box>
              <SectionLabel emoji="⭐" label="Editor's Pick" />
              <Stack spacing={1}>
                {visibleEditors.map(recipe => (
                  <EditorCard key={recipe.id} recipe={recipe} onSave={onJoin} onOpen={onOpenRecipe} />
                ))}
              </Stack>
              {editorsPick.length > 3 && (
                <Button size="small" onClick={() => setEditorsExpanded(e => !e)}
                  sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: 'text.secondary' }}>
                  {editorsExpanded ? 'Show less' : `+ ${editorsPick.length - 3} more picks`}
                </Button>
              )}
            </Box>
          )}

          {/* ── Section 3: AI Picks ── */}
          {aiPicks.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <SectionLabel emoji="✨" label="AI Picks this week" inline />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.selected', borderRadius: 1, px: 0.75, py: 0.25 }}>
                  <AutoAwesomeIcon sx={{ fontSize: 11, color: 'info.main' }} />
                  <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 700, color: 'info.main' }}>Gemini</Typography>
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontSize: 11 }}>
                Trending in health &amp; nutrition right now
              </Typography>
              <RecipeShelf
                recipes={aiPicks.map(p => ({ ...p.recipe, _hashtag: p.hashtag, _topic: p.topic }))}
                onSave={onJoin} onOpen={onOpenRecipe} cardWidth={160}
              />
            </Box>
          )}

          {/* ── Section 4: Cook with Friends ── */}
          <CookWithFriends onJoin={onJoin} darkMode={darkMode} />

        </Stack>
      </Box>
    </Container>
  );
}

function SectionLabel({ emoji, label, inline = false }) {
  const el = (
    <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
      {emoji} {label}
    </Typography>
  );
  if (inline) return el;
  return <Box sx={{ mb: 1 }}>{el}</Box>;
}

function EditorCard({ recipe, onSave, onOpen }) {
  return (
    <Card elevation={0} sx={{ display: 'flex', borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
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
        <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); onSave?.(); }}
          sx={{ borderRadius: 20, textTransform: 'none', fontSize: 11, flexShrink: 0 }}>
          Save
        </Button>
      </CardActionArea>
    </Card>
  );
}

function CookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{ borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)' }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>🍳 Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Cooking is better together
      </Typography>
      {/* Social proof teaser — illustrative activity */}
      <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 1.25, mb: 1.5, opacity: 0.85 }}>
        <ActivityRow initial="E" name="Elisa" action="saved your Miso Ramen ❤️" time="2h" color="#7c3aed" />
        <Box sx={{ mt: 0.75 }}>
          <ActivityRow initial="S" name="Sarah" action="shared Beef Stew with you" time="5h" color="#10b981" />
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Join ReciFind to share recipes and see what your friends are cooking.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth variant="contained" size="small" disableElevation onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 11 }}>
          Join free
        </Button>
        <Button fullWidth variant="outlined" size="small" onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontSize: 11 }}>
          Invite a friend
        </Button>
      </Box>
    </Box>
  );
}

function ActivityRow({ initial, name, action, time, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{initial}</Typography>
      </Box>
      <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary' }}>
        <Box component="span" sx={{ color, fontWeight: 600 }}>{name}</Box> {action}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>{time}</Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Run dev server and verify no syntax errors**
```bash
cd apps/recipe-ui && npm run dev
```
Expected: Clean start, no import errors

- [ ] **Step 3: Commit**
```bash
git add apps/recipe-ui/src/components/PublicLanding.jsx
git commit -m "feat: add PublicLanding component with 4 discovery sections"
```

---

### Task 8: Wire PublicLanding into App.jsx

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

Replace the current logged-out recipe display with `<PublicLanding>`.

- [ ] **Step 1: Add import at the top of App.jsx**

Find the imports section at the top of App.jsx (around line 90–100). Add:
```jsx
import PublicLanding from './components/PublicLanding';
```

- [ ] **Step 2: Remove logged-out INITIAL_RECIPES load**

Find in `syncRecipesFromApi` (around line 1774):
```javascript
// If not logged in, show default recipes
if (!userId) {
  setRecipes(INITIAL_RECIPES.filter((r) => r.imageUrl && !r.imageUrl.startsWith('data:')));
  setRemoteState({ status: 'disabled', message: '' });
  return;
}
```
Replace with:
```javascript
// Logged-out users see PublicLanding — no recipes loaded here
if (!userId) {
  setRemoteState({ status: 'disabled', message: '' });
  return;
}
```

- [ ] **Step 3: Render PublicLanding for logged-out users**

Search App.jsx for the string `<Container maxWidth="lg" disableGutters>` — there is one instance, around line 3888. It is the outermost wrapper for the entire recipe list UI. The goal is to conditionally show `PublicLanding` instead when the user is logged out.

Make two surgical edits — do NOT restructure the Container's children:

**Edit A** — Directly before `<Container maxWidth="lg" disableGutters>`, insert:
```jsx
{/* Logged-out: show discovery landing page. Only render after auth is checked to avoid flash. */}
{!session && isAuthChecked && (
  <PublicLanding
    onJoin={openAuthDialog}
    onOpenRecipe={handleOpenRecipeDetails}
    darkMode={darkMode}
  />
)}
```

**Edit B** — Replace only the opening tag `<Container maxWidth="lg" disableGutters>` with:
```jsx
{(session || !isAuthChecked) && <Container maxWidth="lg" disableGutters>}
```
And replace the corresponding closing `</Container>` (the last `</Container>` in the JSX return block, search from the bottom) with:
```jsx
</Container>}
```

All children between the two tags remain completely untouched. The `!isAuthChecked` guard in the logged-in branch prevents a white flash: while auth is resolving, the recipe list skeleton renders as before. Once `isAuthChecked` is true and `!session`, `PublicLanding` shows instead.

- [ ] **Step 4: Verify logged-out view in browser**

Start dev server. Open the app while logged out.
```bash
cd apps/recipe-ui && npm run dev
```
Expected: See the 4-section landing page instead of the flat recipe list. "Join free" button opens auth dialog. Sections load from the worker (make sure worker is running locally: `cd apps/worker && npx wrangler dev` in a separate terminal).

- [ ] **Step 5: Verify logged-in view is unchanged**

Log in. Expected: Existing recipe list, search, and filters work exactly as before.

- [ ] **Step 6: Commit**
```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: show PublicLanding for logged-out users, wire onJoin + onOpenRecipe"
```

---

## Chunk 2: Phase 2 — Logged-in Home Sections + Onboarding

### Task 9: Worker — GET /friends/activity, recently-saved, recently-shared

**Files:**
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/friends-discovery.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/src/friends-discovery.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { getFriendActivity, getFriendsRecentlySaved, getFriendsRecentlyShared } from './index';

const mockUserId = 'user-123';

describe('getFriendActivity', () => {
  it('returns last 10 notifications for user', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 1, type: 'friend_saved_recipe', message: 'Elisa saved your recipe', data: '{}', created_at: '2026-03-10T10:00:00Z', read: 0 }
          ]
        })
      })
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('friend_saved_recipe');
  });
});

describe('getFriendsRecentlySaved', () => {
  it('returns recent recipes from all friends', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn()
          .mockResolvedValueOnce({ results: [{ friend_id: 'friend-1', friend_name: 'Sarah' }] })
          .mockResolvedValueOnce({ results: [
            { id: 'r1', title: 'Berry Bake', source_url: '', image_url: '', meal_types: '[]', duration_minutes: null, created_at: '2026-03-09' }
          ]})
      })
    } as unknown as D1Database;

    const result = await getFriendsRecentlySaved(mockDb, mockUserId);
    expect(result).toHaveLength(1);
    expect(result[0].recipe.title).toBe('Berry Bake');
    expect(result[0].friendName).toBe('Sarah');
  });
});

describe('getFriendsRecentlyShared', () => {
  it('returns only shared_with_friends recipes', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn()
          .mockResolvedValueOnce({ results: [{ friend_id: 'friend-1', friend_name: 'Elisa' }] })
          .mockResolvedValueOnce({ results: [
            { id: 'r2', title: 'Miso Ramen', source_url: '', image_url: '', meal_types: '[]', duration_minutes: 20, created_at: '2026-03-09' }
          ]})
      })
    } as unknown as D1Database;

    const result = await getFriendsRecentlyShared(mockDb, mockUserId);
    expect(result[0].recipe.title).toBe('Miso Ramen');
  });
});
```

- [ ] **Step 2: Run to verify failure**
```bash
cd apps/worker && npm test -- --testPathPattern=friends-discovery.test
```
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement the three functions in index.ts**

Add after the `getEditorsPick` block:
```typescript
type FriendRecipeItem = { friendName: string; friendId: string; recipe: { id: string; title: string; imageUrl: string; mealTypes: string[]; durationMinutes: number | null; createdAt: string } };

export async function getFriendActivity(db: D1Database, userId: string): Promise<Array<{ id: number; type: string; message: string; data: unknown; createdAt: string; read: boolean }>> {
  const rows = await db.prepare(
    `SELECT id, type, message, data, created_at, read FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
  ).bind(userId).all();
  return (rows.results as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    type: String(r.type),
    message: String(r.message),
    data: JSON.parse(String(r.data || '{}')),
    createdAt: String(r.created_at),
    read: Boolean(r.read),
  }));
}

export async function getFriendsRecentlySaved(db: D1Database, userId: string): Promise<FriendRecipeItem[]> {
  const friends = await db.prepare(
    `SELECT friend_id, friend_name FROM friends WHERE user_id = ?`
  ).bind(userId).all();
  const items: FriendRecipeItem[] = [];
  for (const friend of (friends.results as Array<Record<string, unknown>>)) {
    const rows = await db.prepare(
      // No shared_with_friends filter — show any recipe the friend has, all visible to friends
      `SELECT id, title, source_url, image_url, meal_types, duration_minutes, created_at FROM recipes WHERE user_id = ? ORDER BY created_at DESC LIMIT 2`
    ).bind(String(friend.friend_id)).all();
    for (const r of (rows.results as Array<Record<string, unknown>>)) {
      items.push({
        friendName: String(friend.friend_name),
        friendId: String(friend.friend_id),
        recipe: { id: String(r.id), title: String(r.title), imageUrl: String(r.image_url), mealTypes: JSON.parse(String(r.meal_types || '[]')), durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null, createdAt: String(r.created_at) }
      });
    }
  }
  return items.sort((a, b) => b.recipe.createdAt.localeCompare(a.recipe.createdAt)).slice(0, 8);
}

export async function getFriendsRecentlyShared(db: D1Database, userId: string): Promise<FriendRecipeItem[]> {
  const friends = await db.prepare(
    `SELECT friend_id, friend_name FROM friends WHERE user_id = ?`
  ).bind(userId).all();
  const items: FriendRecipeItem[] = [];
  for (const friend of (friends.results as Array<Record<string, unknown>>)) {
    const rows = await db.prepare(
      // shared_with_friends = 1 filter only — ORDER BY created_at (updated_at not in schema)
      `SELECT id, title, source_url, image_url, meal_types, duration_minutes, created_at FROM recipes WHERE user_id = ? AND shared_with_friends = 1 ORDER BY created_at DESC LIMIT 2`
    ).bind(String(friend.friend_id)).all();
    for (const r of (rows.results as Array<Record<string, unknown>>)) {
      items.push({
        friendName: String(friend.friend_name),
        friendId: String(friend.friend_id),
        recipe: { id: String(r.id), title: String(r.title), imageUrl: String(r.image_url), mealTypes: JSON.parse(String(r.meal_types || '[]')), durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null, createdAt: String(r.created_at) }
      });
    }
  }
  return items.sort((a, b) => b.recipe.createdAt.localeCompare(a.recipe.createdAt)).slice(0, 8);
}
```

Add the three routes (auth-required, after the existing `/friends` routes area):
```typescript
if (url.pathname === '/friends/activity' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Unauthorized');
  return await (async () => {
    const activity = await getFriendActivity(env.DB, user.id);
    return json({ activity }, 200, withCors());
  })();
}

if (url.pathname === '/friends/recently-saved' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Unauthorized');
  return await (async () => {
    const items = await getFriendsRecentlySaved(env.DB, user.id);
    return json({ items }, 200, withCors());
  })();
}

if (url.pathname === '/friends/recently-shared' && request.method === 'GET') {
  if (!user) throw new HttpError(401, 'Unauthorized');
  return await (async () => {
    const items = await getFriendsRecentlyShared(env.DB, user.id);
    return json({ items }, 200, withCors());
  })();
}
```

- [ ] **Step 4: Run tests**
```bash
cd apps/worker && npm test -- --testPathPattern=friends-discovery.test
```
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/friends-discovery.test.ts
git commit -m "feat: add friend activity, recently-saved, recently-shared endpoints"
```

---

### Task 10: Worker — PATCH /profile preference fields

**Files:**
- Modify: `apps/worker/src/index.ts`

The `PATCH /profile` endpoint already exists. Extend it to accept and save the 3 new preference fields.

- [ ] **Step 1: Read the existing PATCH /profile handler**

Search index.ts for `url.pathname === '/profile' && request.method === 'PATCH'` and read the handler body carefully. Note:
- What fields it currently reads from the request body
- The exact SQL UPDATE statement (column names, bind order)
- Any existing validation logic

Do not proceed to Step 2 until you have read the full handler.

- [ ] **Step 2: Extend the handler to accept preference fields**

In the handler body, after the existing field-reading logic, add the 3 new fields. Then replace the single UPDATE SQL with a dynamic builder that only sets provided fields (to avoid overwriting existing values with undefined). For example, if the existing handler has:
```typescript
await db.prepare(`UPDATE profiles SET display_name = ? WHERE user_id = ?`).bind(displayName, user.id).run();
```
Replace it with:
```typescript
const mealTypePrefs = typeof body.mealTypePrefs !== 'undefined' ? JSON.stringify(body.mealTypePrefs) : undefined;
const dietaryPrefs = typeof body.dietaryPrefs !== 'undefined' ? JSON.stringify(body.dietaryPrefs) : undefined;
const skillLevel = typeof body.skillLevel !== 'undefined' ? String(body.skillLevel) : undefined;

// Build dynamic UPDATE for only provided fields
const fields: string[] = [];
const values: unknown[] = [];
if (body.displayName) { fields.push('display_name = ?'); values.push(String(body.displayName).trim()); }
if (mealTypePrefs !== undefined) { fields.push('meal_type_prefs = ?'); values.push(mealTypePrefs); }
if (dietaryPrefs !== undefined) { fields.push('dietary_prefs = ?'); values.push(dietaryPrefs); }
if (skillLevel !== undefined) { fields.push('skill_level = ?'); values.push(skillLevel); }

if (fields.length > 0) {
  values.push(user.id);
  await db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE user_id = ?`).bind(...values).run();
}
```

> **Note:** Read the existing handler carefully before editing. The exact shape may differ — adapt accordingly while keeping existing field handling intact.

- [ ] **Step 3: Verify existing profile PATCH still works**

```bash
cd apps/worker && npx wrangler dev
```
Use curl or browser dev tools to verify an existing profile update (e.g., display name) still works.

- [ ] **Step 4: Commit**
```bash
git add apps/worker/src/index.ts
git commit -m "feat: extend PATCH /profile to accept meal_type_prefs, dietary_prefs, skill_level"
```

---

### Task 11: Frontend — WelcomeModal component

**Files:**
- Create: `apps/recipe-ui/src/components/WelcomeModal.jsx`

- [ ] **Step 1: Create WelcomeModal.jsx**

```jsx
import { Dialog, DialogContent, Box, Typography, Button, Stack } from '@mui/material';

/**
 * Full-screen welcome modal shown once to new users.
 * Props:
 *   open: boolean
 *   onDismiss: () => void
 *   inviterName: string | null
 *   recipes: Array<{ id, title, imageUrl }>   — 3 recipes to preview
 */
export default function WelcomeModal({ open, onDismiss, inviterName, recipes = [] }) {
  const hasInviter = Boolean(inviterName);

  return (
    <Dialog open={open} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogContent sx={{ pt: 4, pb: 3, px: 3, textAlign: 'center' }}>
        <Typography fontSize={40} mb={1}>👋</Typography>
        <Typography variant="h6" fontWeight={800} mb={0.5}>
          {hasInviter ? `${inviterName} invited you to ReciFind` : 'Welcome to ReciFind!'}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2.5}>
          {hasInviter
            ? `${inviterName} cooks some great stuff. Save their recipes to your collection.`
            : 'Discover and save recipes. Share them with friends.'}
        </Typography>

        {recipes.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 3, justifyContent: 'center' }}>
            {recipes.slice(0, 3).map(recipe => (
              <Box key={recipe.id} sx={{ flex: 1, maxWidth: 90, textAlign: 'center' }}>
                <Box sx={{ width: '100%', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', mb: 0.5 }}>
                  {recipe.imageUrl
                    ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🍳</Box>
                  }
                </Box>
                <Typography variant="caption" display="block" noWrap sx={{ fontSize: 10, color: 'text.secondary' }}>
                  {recipe.title}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        <Stack spacing={1}>
          <Button fullWidth variant="contained" disableElevation onClick={onDismiss}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {hasInviter ? 'Explore ReciFind →' : 'Get started →'}
          </Button>
          <Button fullWidth size="small" onClick={onDismiss}
            sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12 }}>
            Skip for now
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd apps/recipe-ui && npm run dev
```
Open browser devtools console. Expected: no import or runtime errors.

- [ ] **Step 3: Commit**
```bash
git add apps/recipe-ui/src/components/WelcomeModal.jsx
git commit -m "feat: add WelcomeModal for invited and new users"
```

---

### Task 12: Frontend — OnboardingFlow component

**Files:**
- Create: `apps/recipe-ui/src/components/OnboardingFlow.jsx`

- [ ] **Step 1: Create OnboardingFlow.jsx**

```jsx
import { useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Button, Stack, Chip, LinearProgress } from '@mui/material';

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Drinks', 'Meal prep'];
const DIETARY_PREFS = ['Vegetarian', 'Meat lover', 'Gluten-free', 'Dairy-free', 'High protein', 'Pescatarian', 'None / all good'];
const SKILL_LEVELS = [
  { value: 'beginner', label: '🐣 Beginner', sub: 'I follow recipes step by step' },
  { value: 'home_cook', label: '🍳 Home cook', sub: "I'm comfortable in the kitchen" },
  { value: 'confident', label: '👨‍🍳 Confident', sub: 'I improvise and experiment' },
];

/**
 * 3-screen onboarding flow, each screen skippable.
 * Props:
 *   open: boolean
 *   onComplete: (prefs: { mealTypePrefs, dietaryPrefs, skillLevel }) => void
 *   onSkip: () => void
 */
export default function OnboardingFlow({ open, onComplete, onSkip }) {
  const [screen, setScreen] = useState(0);
  const [mealTypes, setMealTypes] = useState([]);
  const [dietary, setDietary] = useState([]);
  const [skill, setSkill] = useState('');

  const toggle = (list, setList, value) => {
    setList(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const handleNext = () => {
    if (screen < 2) setScreen(s => s + 1);
    else onComplete({ mealTypePrefs: mealTypes, dietaryPrefs: dietary, skillLevel: skill });
  };

  const progress = ((screen + 1) / 3) * 100;

  return (
    <Dialog open={open} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
      <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: '12px 12px 0 0', height: 3 }} />
      <DialogContent sx={{ pt: 3, pb: 3, px: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size="small" onClick={onSkip} sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 11, minWidth: 0 }}>
            Skip →
          </Button>
        </Box>

        {screen === 0 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>What do you love to cook?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Pick all that apply</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {MEAL_TYPES.map(t => (
                <Chip key={t} label={t} clickable onClick={() => toggle(mealTypes, setMealTypes, t)}
                  variant={mealTypes.includes(t) ? 'filled' : 'outlined'}
                  color={mealTypes.includes(t) ? 'primary' : 'default'}
                  sx={{ fontWeight: mealTypes.includes(t) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 1 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>Any dietary preferences?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>We'll tailor your AI picks</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {DIETARY_PREFS.map(d => (
                <Chip key={d} label={d} clickable onClick={() => toggle(dietary, setDietary, d)}
                  variant={dietary.includes(d) ? 'filled' : 'outlined'}
                  color={dietary.includes(d) ? 'primary' : 'default'}
                  sx={{ fontWeight: dietary.includes(d) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 2 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>How confident are you in the kitchen?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>No right answer — helps us suggest recipes</Typography>
            <Stack spacing={1} mb={3}>
              {SKILL_LEVELS.map(s => (
                <Box key={s.value} onClick={() => setSkill(s.value)}
                  sx={{ p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                    borderColor: skill === s.value ? 'primary.main' : 'divider',
                    bgcolor: skill === s.value ? 'primary.main' + '14' : 'transparent' }}>
                  <Typography variant="body2" fontWeight={skill === s.value ? 700 : 400}>{s.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{s.sub}</Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}

        <Button fullWidth variant="contained" disableElevation onClick={handleNext}
          sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
          {screen < 2 ? 'Next →' : "Let's cook! 🍳"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd apps/recipe-ui && npm run dev
```
Open browser devtools console. Expected: no import or runtime errors.

- [ ] **Step 3: Commit**
```bash
git add apps/recipe-ui/src/components/OnboardingFlow.jsx
git commit -m "feat: add 3-screen OnboardingFlow modal with meal types, diet prefs, skill level"
```

---

### Task 13: Frontend — FriendSections component

**Files:**
- Create: `apps/recipe-ui/src/components/FriendSections.jsx`

Encapsulates friend activity feed + recently saved + recently shared shelves.

- [ ] **Step 1: Create FriendSections.jsx**

```jsx
import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Divider } from '@mui/material';
import RecipeShelf from './RecipeShelf';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  return res.json();
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'yesterday' : `${diffD}d`;
}

/**
 * Logged-in friend discovery sections.
 * Props:
 *   accessToken: string
 *   onOpenRecipe: (recipe) => void
 *   onSaveRecipe: (recipe) => void
 */
export default function FriendSections({ accessToken, onOpenRecipe, onSaveRecipe }) {
  const [activity, setActivity] = useState([]);
  const [recentlySaved, setRecentlySaved] = useState([]);
  const [recentlyShared, setRecentlyShared] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      fetchJson('/friends/activity', accessToken),
      fetchJson('/friends/recently-saved', accessToken),
      fetchJson('/friends/recently-shared', accessToken),
    ]).then(([act, saved, shared]) => {
      setActivity(act?.activity || []);
      setRecentlySaved((saved?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setRecentlyShared((shared?.items || []).map(i => ({ ...i.recipe, _friendName: i.friendName })));
      setLoaded(true);
    });
  }, [accessToken]);

  if (!loaded) return null;

  const hasActivity = activity.length > 0;
  const hasSaved = recentlySaved.length > 0;
  const hasShared = recentlyShared.length > 0;

  if (!hasActivity && !hasSaved && !hasShared) return null;

  return (
    <Stack spacing={2.5}>
      {hasActivity && (
        <Box>
          <SectionLabel>📣 Friend activity</SectionLabel>
          <Stack spacing={0.75}>
            {activity.slice(0, 5).map(item => (
              <ActivityItem key={item.id} item={item} />
            ))}
          </Stack>
        </Box>
      )}

      {hasSaved && (
        <Box>
          <SectionLabel>🔖 Recently saved by friends</SectionLabel>
          <RecipeShelf recipes={recentlySaved} onSave={onSaveRecipe} onOpen={onOpenRecipe} cardWidth={130} />
        </Box>
      )}

      {hasShared && (
        <Box>
          <SectionLabel>📤 Recently shared by friends</SectionLabel>
          <RecipeShelf recipes={recentlyShared} onSave={onSaveRecipe} onOpen={onOpenRecipe} cardWidth={130} />
        </Box>
      )}

      <Divider />
    </Stack>
  );
}

function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} mb={1}>{children}</Typography>;
}

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function ActivityItem({ item }) {
  const colorIndex = Math.abs(item.id) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[colorIndex];
  const initial = item.message.charAt(0).toUpperCase();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.5 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{initial}</Typography>
      </Box>
      <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>
        {item.message}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
git commit -m "feat: add FriendSections component (activity feed + recently saved/shared)"
```

---

### Task 14: Wire welcome modal, onboarding, and friend sections into App.jsx

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Add imports**

Near the top of App.jsx, add:
```jsx
import WelcomeModal from './components/WelcomeModal';
import OnboardingFlow from './components/OnboardingFlow';
import FriendSections from './components/FriendSections';
```

- [ ] **Step 2: Add welcome + onboarding state**

Near the top of the main component where other `useState` hooks live (around line 1019), add:
```jsx
const [welcomeOpen, setWelcomeOpen] = useState(false);
const [onboardingOpen, setOnboardingOpen] = useState(false);
const [welcomeRecipes, setWelcomeRecipes] = useState([]);
const [inviterName, setInviterName] = useState(null);
```

- [ ] **Step 3: Trigger welcome modal and populate inviter data after sign-in**

The existing invite accept flow resolves the inviter's name from the API response and stores it in a local `const name = res?.inviterName` (see lines ~2249, ~2297 in App.jsx — both the token-invite and open-invite accept paths). These currently only show a snackbar. Extend each success path to also capture the name into state and trigger the welcome modal.

In each `.then(res => { ... })` callback where `const name = res?.inviterName` is already set, add:
```jsx
// Capture inviter name for welcome modal
if (name) {
  setInviterName(name);
  // Fetch inviter's public recipes for the modal preview
  // The inviter's userId is in res.inviterUserId (check actual response shape)
  // If unavailable, fall back to editors-pick via the public endpoint
}
```

Then add a `useEffect` that watches `session` and `isAuthChecked` to show the modal once sign-in completes:
```jsx
useEffect(() => {
  if (!isAuthChecked || !session) return;
  const onboardingSeen = localStorage.getItem('onboarding_seen');
  if (onboardingSeen) return;

  // Fetch welcome recipes: try editors-pick as fallback (works even without inviter)
  fetch(`${API_BASE_URL}/public/editors-pick`)
    .then(r => r.json())
    .then(d => setWelcomeRecipes((d?.recipes || []).slice(0, 3)))
    .catch(() => {});

  setWelcomeOpen(true);
}, [isAuthChecked, session]);
```

> **Note:** Check the actual shape of the invite accept API response (search index.ts for the `accept-invite` and `accept-open-invite` handlers) to confirm whether `inviterUserId` or similar is returned. If the inviter's userId is available, fetch their recipes via `GET /friends/:id/recipes` or the existing friend recipe endpoint instead of falling back to editors-pick.

- [ ] **Step 4: Add welcome modal dismiss handler**

```jsx
const handleWelcomeDismiss = () => {
  setWelcomeOpen(false);
  const onboardingSeen = localStorage.getItem('onboarding_seen');
  if (!onboardingSeen) {
    setOnboardingOpen(true); // proceed to onboarding
  }
};
```

- [ ] **Step 5: Add onboarding complete handler**

```jsx
const handleOnboardingComplete = async (prefs) => {
  setOnboardingOpen(false);
  localStorage.setItem('onboarding_seen', '1');
  if (accessToken && (prefs.mealTypePrefs.length || prefs.dietaryPrefs.length || prefs.skillLevel)) {
    await callRecipesApi('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ mealTypePrefs: prefs.mealTypePrefs, dietaryPrefs: prefs.dietaryPrefs, skillLevel: prefs.skillLevel })
    }, accessToken);
  }
};

const handleOnboardingSkip = () => {
  setOnboardingOpen(false);
  localStorage.setItem('onboarding_seen', '1');
};
```

- [ ] **Step 6: Render modals and FriendSections**

Find where the logged-in content renders (the `{(session || !isAuthChecked) && <Container>...}` block added in Task 8). Add modals before the Container:
```jsx
<WelcomeModal
  open={welcomeOpen}
  onDismiss={handleWelcomeDismiss}
  inviterName={inviterName}
  recipes={welcomeRecipes}
/>
<OnboardingFlow
  open={onboardingOpen}
  onComplete={handleOnboardingComplete}
  onSkip={handleOnboardingSkip}
/>
```

Inside the logged-in Container, find the `<Stack spacing={1.5}>` that wraps the search bar and recipe list (around line 3895). Add `<FriendSections>` at the top, before the search bar, wrapped in a session check:
```jsx
{session && (
  <FriendSections
    accessToken={accessToken}
    onOpenRecipe={handleOpenRecipeDetails}
    onSaveRecipe={handleOpenRecipeDetails}
  />
)}
```

> **Note:** `onSaveRecipe` passes `handleOpenRecipeDetails` — this opens the recipe detail dialog where the user can save it using the existing Save button. This reuses the established save UX rather than duplicating save logic in FriendSections.
```

- [ ] **Step 7: Verify in browser**

Start both worker and UI dev servers. Test:
1. New user (clear localStorage) → welcome modal appears → dismiss → onboarding appears → complete → home feed shown
2. Returning user → no modals
3. User with friends → friend sections appear above the search bar
4. User without friends → friend sections hidden entirely

- [ ] **Step 8: Commit**
```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: wire WelcomeModal, OnboardingFlow, FriendSections into App.jsx"
```

---

## Chunk 3: Phase 3 — Cook Mode Tracking

### Task 15: Worker — POST /recipes/:id/cook

**Files:**
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/cook.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/worker/src/cook.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { logCookEvent } from './index';

describe('logCookEvent', () => {
  it('inserts a cook_event row', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), run: runMock })
    } as unknown as D1Database;

    await logCookEvent(mockDb, 'user-1', 'recipe-1');
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cook_events')
    );
    expect(runMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure**
```bash
cd apps/worker && npx vitest run cook.test
```
Expected: FAIL — `logCookEvent` not exported

- [ ] **Step 3: Implement logCookEvent and the route**

Add the exported function in index.ts:
```typescript
export async function logCookEvent(db: D1Database, userId: string, recipeId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO cook_events (user_id, recipe_id, cooked_at) VALUES (?, ?, ?)`
  ).bind(userId, recipeId, new Date().toISOString()).run();
}
```

Add the route (find the pattern `url.pathname.match(/^\/recipes\/([^/]+)$/)` area for the existing recipe GET/PATCH/DELETE routes and add nearby):
```typescript
const cookMatch = url.pathname.match(/^\/recipes\/([^/]+)\/cook$/);
if (cookMatch && request.method === 'POST') {
  if (!user) throw new HttpError(401, 'Unauthorized');
  return await (async () => {
    const recipeId = decodeURIComponent(cookMatch[1]);
    await logCookEvent(env.DB, user.id, recipeId);
    // Notify each friend
    const friends = await env.DB.prepare(`SELECT friend_id FROM friends WHERE user_id = ?`).bind(user.id).all();
    const recipe = await env.DB.prepare(`SELECT title FROM recipes WHERE user_id = ? AND id = ?`).bind(user.id, recipeId).first() as { title?: string } | null;
    const recipeName = recipe?.title || 'a recipe';
    const profile = await env.DB.prepare(`SELECT display_name FROM profiles WHERE user_id = ?`).bind(user.id).first() as { display_name?: string } | null;
    const cookerName = profile?.display_name || 'Someone';
    // Use the existing addNotification helper — it handles the 50-row trim side-effect
    for (const f of (friends.results as Array<{ friend_id: string }>)) {
      await addNotification(env, f.friend_id, {
        type: 'friend_cooked_recipe',
        message: `${cookerName} cooked ${recipeName} 🍳`,
        data: JSON.stringify({ cookerId: user.id, recipeId }),
        created_at: new Date().toISOString(),
      });
    }
    return json({ ok: true }, 200, withCors());
  })();
}
```

- [ ] **Step 4: Run tests**
```bash
cd apps/worker && npm test
```
Expected: All tests PASS (including existing enrich.test.ts)

- [ ] **Step 5: Commit**
```bash
git add apps/worker/src/index.ts apps/worker/src/cook.test.ts
git commit -m "feat: add POST /recipes/:id/cook endpoint with friend notifications"
```

---

### Task 16: Frontend — Hook cook mode into the API

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Find toggleCookMode**

Open App.jsx and find `const toggleCookMode = async () => {` (around line 2889). Inside it, find the block that runs when cook mode turns ON — it's after the `if (cookMode) {` branch ends, around line 2900:
```javascript
trackEvent('cook_mode', { action: 'on' });
```

- [ ] **Step 2: Add the API call directly after trackEvent**

```javascript
trackEvent('cook_mode', { action: 'on' });
// Fire-and-forget — log cook event server-side for future activity feed
if (session && activeRecipe?.id) {
  callRecipesApi(`/recipes/${encodeURIComponent(activeRecipe.id)}/cook`, { method: 'POST' }, accessToken);
}
```

No `await` — this must not block the cook mode UI toggling.

- [ ] **Step 3: Verify in browser**

1. Open any recipe that has steps
2. Toggle cook mode ON
3. Check worker logs (`npx wrangler tail` in apps/worker) — should see the POST request
4. Check D1 locally: `npx wrangler d1 execute recipes-db --local --command="SELECT * FROM cook_events LIMIT 5"`

Expected: A row appears in cook_events.

- [ ] **Step 4: Run all worker tests one final time**
```bash
cd apps/worker && npm test
```
Expected: All PASS

- [ ] **Step 5: Final commit**
```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: log cook event to API when cook mode is activated"
```

---

## Deployment

After each phase is complete and tested locally:

**Deploy worker:**
```bash
cd apps/worker && npx wrangler deploy
```

**Deploy frontend:**
```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

**Apply D1 migration to production** (Task 2, Step 3 — already included in Task 2):
```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --remote
```

**Verify live site:**
- Open recifind.elisawidjaja.com while logged out → should see PublicLanding with 4 sections
- Log in as a new user → should see welcome modal → onboarding
- Toggle cook mode on any recipe → verify no errors in Cloudflare dashboard
