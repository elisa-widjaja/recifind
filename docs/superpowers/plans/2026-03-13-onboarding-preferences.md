# Onboarding Preferences Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-screen onboarding flow with higher-signal questions (dietary, who you cook for, cuisine preferences) and wire them into AI picks personalization and the logged-in friend feed.

**Architecture:** Three independent layers change in sequence: D1 schema first (nullable columns, no risk), then worker logic (type extensions + new params), then frontend (OnboardingFlow screens + FriendSections AI picks). Each layer is independently deployable and safe to roll back.

**Tech Stack:** Cloudflare Workers (TypeScript), Cloudflare D1 (SQLite), Cloudflare KV, React + MUI, Gemini API

---

## Chunk 1: Data Layer — D1 Migration + Worker Profile

### Task 1: D1 Migration

**Files:**
- Create: `apps/worker/migrations/0005_onboarding_prefs.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0005_onboarding_prefs.sql
-- Add cooking_for and cuisine_prefs columns to profiles.
-- Both are nullable; existing rows default to NULL (treated as "no preference").
ALTER TABLE profiles ADD COLUMN cooking_for TEXT;
ALTER TABLE profiles ADD COLUMN cuisine_prefs TEXT;
```

- [ ] **Step 2: Apply to local D1 (dev)**

```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --local
```

Expected output: `Migrations applied` with `0005_onboarding_prefs` listed.

- [ ] **Commit**

```bash
git add apps/worker/migrations/0005_onboarding_prefs.sql
git commit -m "feat: add cooking_for and cuisine_prefs columns to profiles"
```

---

### Task 2: Extend `UserProfile` type and `getOrCreateProfile`

**Files:**
- Modify: `apps/worker/src/index.ts:40-45` (UserProfile interface)
- Modify: `apps/worker/src/index.ts:2466-2489` (getOrCreateProfile)

The `UserProfile` interface is at line 40. `getOrCreateProfile` is at line 2466.

- [ ] **Step 1: Extend the `UserProfile` interface**

Find:
```typescript
interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
}
```

Replace with:
```typescript
interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  cookingFor: string | null;
  cuisinePrefs: string[];
}
```

- [ ] **Step 2: Update `getOrCreateProfile` to map new columns**

Find the `if (row)` return block inside `getOrCreateProfile` (line ~2470):
```typescript
  if (row) {
    return {
      userId: row.user_id as string,
      email: row.email as string,
      displayName: row.display_name as string,
      createdAt: row.created_at as string,
    };
  }
```

Replace with:
```typescript
  if (row) {
    return {
      userId: row.user_id as string,
      email: row.email as string,
      displayName: row.display_name as string,
      createdAt: row.created_at as string,
      cookingFor: (row.cooking_for as string | null) ?? null,
      cuisinePrefs: row.cuisine_prefs ? JSON.parse(row.cuisine_prefs as string) : [],
    };
  }
```

- [ ] **Step 3: Update the new-profile object to include the new fields**

Find the newly-created profile object inside `getOrCreateProfile` (line ~2479):
```typescript
  const profile: UserProfile = {
    userId,
    email: email || '',
    displayName: email?.split('@')[0] || 'User',
    createdAt: new Date().toISOString()
  };
```

Replace with:
```typescript
  const profile: UserProfile = {
    userId,
    email: email || '',
    displayName: email?.split('@')[0] || 'User',
    createdAt: new Date().toISOString(),
    cookingFor: null,
    cuisinePrefs: [],
  };
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: extend UserProfile with cookingFor and cuisinePrefs"
```

---

### Task 3: Extend `handleGetProfile` and `handleUpdateProfile`

**Files:**
- Modify: `apps/worker/src/index.ts:810-819` (handleGetProfile)
- Modify: `apps/worker/src/index.ts:821-875` (handleUpdateProfile)

- [ ] **Step 1: Return new fields from `handleGetProfile`**

Find:
```typescript
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
  });
```

Replace with:
```typescript
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
    cookingFor: profile.cookingFor,
    cuisinePrefs: profile.cuisinePrefs,
  });
```

- [ ] **Step 2: Accept new fields in `handleUpdateProfile` body type**

Find:
```typescript
  const body = await request.json() as { displayName?: string; mealTypePrefs?: string[]; dietaryPrefs?: string[]; skillLevel?: string };
```

Replace with:
```typescript
  const body = await request.json() as { displayName?: string; mealTypePrefs?: string[]; dietaryPrefs?: string[]; skillLevel?: string; cookingFor?: string; cuisinePrefs?: string[] };
```

- [ ] **Step 3: Serialize new fields for D1 and add to dynamic UPDATE builder**

Find the block that ends with `if (skillLevel !== undefined)` (line ~855):
```typescript
  if (skillLevel !== undefined) {
    fields.push('skill_level = ?');
    values.push(skillLevel);
  }
```

Add immediately after it:
```typescript
  if (body.cookingFor !== undefined) {
    fields.push('cooking_for = ?');
    values.push(String(body.cookingFor));
  }
  if (body.cuisinePrefs !== undefined) {
    fields.push('cuisine_prefs = ?');
    values.push(JSON.stringify(body.cuisinePrefs));
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: persist cookingFor and cuisinePrefs via PATCH /profile"
```

---

## Chunk 2: AI Picks Personalization

### Task 4: Update `getAiPicks` — new params, cache key v3, Gemini prompt

**Files:**
- Modify: `apps/worker/src/index.ts:250-259` (route handler)
- Modify: `apps/worker/src/index.ts:1133-1175` (getAiPicks function)

- [ ] **Step 1: Parse new query params in the `/public/ai-picks` route handler**

Find (line ~252):
```typescript
          const prefs = {
            mealTypes: url.searchParams.get('meal_types') || undefined,
            diet: url.searchParams.get('diet') || undefined,
            skill: url.searchParams.get('skill') || undefined,
          };
```

Replace with:
```typescript
          const prefs = {
            mealTypes: url.searchParams.get('meal_types') || undefined,
            diet: url.searchParams.get('diet') || undefined,
            skill: url.searchParams.get('skill') || undefined,
            cuisine: url.searchParams.get('cuisine') || undefined,
            cookingFor: url.searchParams.get('cooking_for') || undefined,
          };
```

- [ ] **Step 2: Add new params to `getAiPicks` signature**

Find:
```typescript
  prefs: { mealTypes?: string; diet?: string; skill?: string } = {}
```

Replace with:
```typescript
  prefs: { mealTypes?: string; diet?: string; skill?: string; cuisine?: string; cookingFor?: string } = {}
```

- [ ] **Step 3: Bump the cache key from v2 to v3**

Find:
```typescript
  const cacheKey = `ai-picks:v2:${prefs.mealTypes || 'all'}:${prefs.diet || 'any'}:${prefs.skill || 'any'}`;
```

Replace with:
```typescript
  const cacheKey = `ai-picks:v3:${prefs.diet || 'any'}:${prefs.cuisine || 'all'}:${prefs.cookingFor || 'any'}`;
```

- [ ] **Step 4: Inject user context into the Gemini prompt**

Find:
```typescript
  const prefsNote = prefs.mealTypes || prefs.diet
    ? `User preferences: meal types=${prefs.mealTypes || 'any'}, diet=${prefs.diet || 'any'}, skill=${prefs.skill || 'any'}.`
    : '';
```

Replace with:
```typescript
  const contextParts: string[] = [];
  if (prefs.diet) contextParts.push(`diet=${prefs.diet}`);
  if (prefs.cuisine) contextParts.push(`preferred cuisines=${prefs.cuisine}`);
  if (prefs.cookingFor) contextParts.push(`cooking for=${prefs.cookingFor}`);
  const prefsNote = contextParts.length > 0
    ? `User context: ${contextParts.join(', ')}.`
    : '';
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Re-seed the dev KV entry for the new v3 key format**

With no prefs, the cache key evaluates to `ai-picks:v3:any:all:any`. Seed a placeholder so local dev doesn't hit Gemini on every page load (optional but convenient):

```bash
cd apps/worker && npx wrangler kv key put "ai-picks:v3:any:all:any" '[]' --binding AI_PICKS_CACHE --local
```

To test with real Gemini output instead, skip this step and let the cache miss trigger a live call.

- [ ] **Step 7: Test the endpoint locally**

Start the worker:
```bash
cd apps/worker && npx wrangler dev --port 8787
```

In another terminal:
```bash
curl "http://localhost:8787/public/ai-picks?diet=vegetarian&cuisine=italian,asian&cooking_for=family"
```

Expected: JSON `{ picks: [...] }` with 3 picks. (May take a few seconds — Gemini call.)

- [ ] **Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: personalize ai-picks with cuisine and cookingFor (cache v3)"
```

---

## Chunk 3: Frontend — OnboardingFlow + FriendSections + App.jsx

### Task 5: Redesign `OnboardingFlow.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/components/OnboardingFlow.jsx`

The current file has 3 screens: meal types (screen 0), dietary (screen 1), skill level (screen 2). Replace all three with: dietary (screen 0), who you cook for (screen 1), cuisine (screen 2). Keep the existing Back button and "Don't show this again" button already in the file.

- [ ] **Step 1: Replace the entire file content**

```jsx
import { useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Button, Stack, Chip, LinearProgress } from '@mui/material';

const DIETARY_PREFS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'High protein', 'Pescatarian', 'Meat lover', 'None / all good'];
const COOKING_FOR = [
  { value: 'solo', label: '👤 Just me', sub: 'Quick meals, single portions' },
  { value: 'couple', label: '👫 Partner or roommate', sub: 'Easy sharing, 2–3 servings' },
  { value: 'family', label: '👨‍👩‍👧 Family', sub: 'Kid-friendly, crowd pleasers' },
  { value: 'entertaining', label: '🎉 I love to entertain', sub: 'Impressive dishes, feeds a crowd' },
];
const CUISINES = ['Italian', 'Asian', 'Mexican', 'Mediterranean', 'American comfort', 'Indian', 'Middle Eastern', 'French', 'Japanese', 'All of the above'];

/**
 * 3-screen onboarding flow.
 * Props:
 *   open: boolean
 *   onComplete: (prefs: { dietaryPrefs, cookingFor, cuisinePrefs }) => void
 *   onSkip: () => void
 */
export default function OnboardingFlow({ open, onComplete, onSkip }) {
  const [screen, setScreen] = useState(0);
  const [dietary, setDietary] = useState([]);
  const [cookingFor, setCookingFor] = useState('');
  const [cuisinePrefs, setCuisinePrefs] = useState([]);

  const toggleDietary = (value) => {
    if (value === 'None / all good') {
      setDietary(prev => prev.includes('None / all good') ? [] : ['None / all good']);
    } else {
      setDietary(prev => {
        const without = prev.filter(v => v !== 'None / all good');
        return without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      });
    }
  };

  const toggleCuisine = (value) => {
    if (value === 'All of the above') {
      setCuisinePrefs(prev => prev.includes('All of the above') ? [] : ['All of the above']);
    } else {
      setCuisinePrefs(prev => {
        const without = prev.filter(v => v !== 'All of the above');
        return without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      });
    }
  };

  const handleNext = () => {
    if (screen < 2) setScreen(s => s + 1);
    else onComplete({ dietaryPrefs: dietary, cookingFor, cuisinePrefs });
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
            <Typography variant="h6" fontWeight={800} mb={0.5}>Any dietary preferences?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>We'll filter out recipes that don't work for you</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {DIETARY_PREFS.map(d => (
                <Chip key={d} label={d} clickable onClick={() => toggleDietary(d)}
                  variant={dietary.includes(d) ? 'filled' : 'outlined'}
                  color={dietary.includes(d) ? 'primary' : 'default'}
                  sx={{ fontWeight: dietary.includes(d) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 1 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>Who are you usually cooking for?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Helps us suggest the right recipes for your table</Typography>
            <Stack spacing={1} mb={3}>
              {COOKING_FOR.map(c => (
                <Box key={c.value} onClick={() => setCookingFor(c.value)}
                  sx={{ p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                    borderColor: cookingFor === c.value ? 'primary.main' : 'divider',
                    bgcolor: cookingFor === c.value ? 'primary.main' + '14' : 'transparent' }}>
                  <Typography variant="body2" fontWeight={cookingFor === c.value ? 700 : 400}>{c.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{c.sub}</Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}

        {screen === 2 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>What cuisines do you love?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Pick all that apply — we'll surface more of what you're into</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {CUISINES.map(c => (
                <Chip key={c} label={c} clickable onClick={() => toggleCuisine(c)}
                  variant={cuisinePrefs.includes(c) ? 'filled' : 'outlined'}
                  color={cuisinePrefs.includes(c) ? 'primary' : 'default'}
                  sx={{ fontWeight: cuisinePrefs.includes(c) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        <Box sx={{ display: 'flex', gap: 1 }}>
          {screen > 0 && (
            <Button variant="outlined" disableElevation onClick={() => setScreen(s => s - 1)}
              sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, flex: '0 0 auto' }}>
              ← Back
            </Button>
          )}
          <Button fullWidth variant="contained" disableElevation onClick={handleNext}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {screen < 2 ? 'Next →' : "Let's cook! 🍳"}
          </Button>
        </Box>
        <Button fullWidth size="small" onClick={onSkip}
          sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12, mt: 0.5 }}>
          Don't show this again
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify in browser**

Start dev server: `cd apps/recipe-ui && npm run dev`

Sign out and create a new account (or clear `onboarding_seen` from localStorage). Verify:
- Screen 1: dietary chips with mutual exclusivity on "None / all good"
- Screen 2: single-select cards for who you cook for
- Screen 3: cuisine chips with mutual exclusivity on "All of the above"
- Back button appears on screens 2 and 3
- "Don't show this again" appears on all screens

- [ ] **Commit**

```bash
git add apps/recipe-ui/src/components/OnboardingFlow.jsx
git commit -m "feat: redesign onboarding — dietary, cookingFor, cuisine screens"
```

---

### Task 6: Update `App.jsx` — fix guard, PATCH body, pass new props to FriendSections

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:1530-1538` (handleOnboardingComplete)
- Modify: `apps/recipe-ui/src/App.jsx:4113` (FriendSections render site)

- [ ] **Step 1: Fix `handleOnboardingComplete` guard and PATCH body**

Find (line 1530):
```javascript
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
```

Replace with:
```javascript
  const handleOnboardingComplete = async (prefs) => {
    setOnboardingOpen(false);
    localStorage.setItem('onboarding_seen', '1');
    if (accessToken && (prefs.dietaryPrefs?.length || prefs.cookingFor || prefs.cuisinePrefs?.length)) {
      await callRecipesApi('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ dietaryPrefs: prefs.dietaryPrefs, cookingFor: prefs.cookingFor, cuisinePrefs: prefs.cuisinePrefs })
      }, accessToken);
      // Re-fetch profile so FriendSections gets the new prefs in the same session
      fetchProfile();
    }
  };
```

- [ ] **Step 2: Pass new profile props to `<FriendSections>`**

Find the `<FriendSections` opening tag (line ~4113):
```jsx
                <FriendSections
                  accessToken={accessToken}
```

Add two new props after `accessToken`:
```jsx
                <FriendSections
                  accessToken={accessToken}
                  cookingFor={userProfile?.cookingFor ?? null}
                  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
```

Note: Pass `null` (not `[]`) when `userProfile` is not yet loaded. This avoids creating a new array reference on every render, which would cause the AI picks `useEffect` in FriendSections to re-fire on each parent re-render before the profile loads.

- [ ] **Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat: wire onboarding prefs to profile PATCH and FriendSections"
```

---

### Task 7: Add AI picks section to `FriendSections.jsx`

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx`

This adds a new "Trending in health & nutrition" section that fetches `/public/ai-picks` personalized with the user's cuisine and cookingFor prefs.

- [ ] **Step 1: Add new props, state, and fetch to `FriendSections`**

Find the function signature:
```jsx
export default function FriendSections({ accessToken, onOpenRecipe, onSaveRecipe, onShareRecipe }) {
```

Replace with:
```jsx
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend }) {
```

Note: `onInviteFriend` is already passed from App.jsx (line ~4123) but was never destructured. Include it here to avoid it being silently swallowed.

Find the existing state declarations block (lines ~33–39) and add `aiPicks` state after `editorsExpanded`:
```jsx
  const [aiPicks, setAiPicks] = useState([]);
```

Find the second `useEffect` (currently the editors-pick fetch, line ~55):
```jsx
  useEffect(() => {
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
  }, []);
```

Replace with:
```jsx
  useEffect(() => {
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    const query = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
  }, [cookingFor, cuisinePrefs]);
  // Note: cuisinePrefs is null (not []) when profile hasn't loaded yet.
  // This prevents the effect re-firing on every render before userProfile is available.
```

- [ ] **Step 2: Render AI picks section**

Find the closing `</Stack>` of the main return (line ~159, just before `}`):
```jsx
    </Stack>
  );
}
```

Insert the AI picks section before the closing `</Stack>`:
```jsx
      {aiPicks.length > 0 && (
        <Box>
          <SectionLabel>Trending in health & nutrition</SectionLabel>
          <Stack spacing={1}>
            {aiPicks.map((pick, i) => (
              <Box key={i} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{pick.topic}</Typography>
                  <Typography variant="caption" sx={{ bgcolor: 'primary.main', color: '#fff', px: 1, py: 0.25, borderRadius: 10, fontWeight: 600, fontSize: 10 }}>
                    {pick.hashtag}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{pick.reason}</Typography>
                {pick.recipe && (
                  <Box
                    onClick={() => onOpenRecipe?.(pick.recipe)}
                    sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: 'action.hover', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    {pick.recipe.imageUrl && (
                      <Box component="img" src={pick.recipe.imageUrl} sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{pick.recipe.title}</Typography>
                  </Box>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
```

- [ ] **Step 3: Verify in browser**

With dev server and worker running, log in, complete onboarding with a cuisine preference (e.g. Italian), and open the home feed. The "Trending in health & nutrition" section should appear after Editor's Picks, with personalized topics.

To test without completing onboarding again: clear `onboarding_seen` from localStorage and re-complete, or call `PATCH /profile` directly:
```bash
curl -X PATCH http://localhost:8787/profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cuisinePrefs":["Italian","Asian"],"cookingFor":"family"}'
```

Then reload the app — AI picks should be biased toward Italian/Asian family-style recipes.

- [ ] **Commit**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
git commit -m "feat: add personalized AI picks section to FriendSections"
```

---

## Chunk 4: Deploy

### Task 8: Apply migration and deploy

- [ ] **Step 1: Deploy the worker**

```bash
cd apps/worker && npx wrangler deploy
```

Expected: `Deployed recifind-worker`

- [ ] **Step 2: Apply migration to prod D1**

```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --remote
```

Expected: `0005_onboarding_prefs` listed as applied.

- [ ] **Step 3: Deploy the frontend**

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

Expected: deployment URL printed, site live at recifind.elisawidjaja.com.

- [ ] **Step 4: Smoke test on prod**

1. Open recifind.elisawidjaja.com in an incognito window
2. Sign in with a new Google account
3. Verify the new 3-screen onboarding appears: dietary → who you cook for → cuisine
4. Complete it and verify the home feed loads with the AI picks section
5. Open DevTools → Network, confirm `PATCH /profile` was called with `cookingFor` and `cuisinePrefs`
6. Confirm `GET /profile` response includes `cookingFor` and `cuisinePrefs`
