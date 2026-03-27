# Dietary Pref → AI Picks Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dietary preferences collected in onboarding through to the `/public/ai-picks` call so Gemini generates diet-appropriate recipe suggestions.

**Architecture:** Three-file change along an existing data pipeline — expose `dietaryPrefs` in the worker's profile response, pass it down through App.jsx props, include it as a `diet` query param in FriendSections' AI picks fetch. No new endpoints, no DB migrations, no cache changes needed.

**Tech Stack:** TypeScript (Cloudflare Worker), React (Vite), Cloudflare D1

---

## File Map

| File | Change |
|---|---|
| `apps/worker/src/index.ts` | Add `dietaryPrefs` to `UserProfile` type, `getOrCreateProfile`, and `handleGetProfile` |
| `apps/recipe-ui/src/App.jsx` | Pass `dietaryPrefs` prop to `<FriendSections>` |
| `apps/recipe-ui/src/components/FriendSections.jsx` | Accept `dietaryPrefs` prop, include `diet` in AI picks query |

---

## Task 1: Add `dietaryPrefs` to `UserProfile` type and `getOrCreateProfile`

**Files:**
- Modify: `apps/worker/src/index.ts:40-47` (UserProfile interface)
- Modify: `apps/worker/src/index.ts:2745-2753` (getOrCreateProfile return)

- [ ] **Step 1: Update `UserProfile` interface**

In `apps/worker/src/index.ts`, find the `UserProfile` interface at line 40 and add `dietaryPrefs`:

```typescript
interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  cookingFor: string | null;
  cuisinePrefs: string[];
  dietaryPrefs: string[];
}
```

- [ ] **Step 2: Update `getOrCreateProfile` to parse `dietaryPrefs` from D1**

In `getOrCreateProfile` (around line 2745), the `if (row)` branch currently returns:

```typescript
return {
  userId: row.user_id as string,
  email: row.email as string,
  displayName: row.display_name as string,
  createdAt: row.created_at as string,
  cookingFor: (row.cooking_for as string | null | undefined) ?? null,
  cuisinePrefs: (() => { try { return row.cuisine_prefs ? JSON.parse(row.cuisine_prefs as string) : []; } catch { return []; } })(),
};
```

Add `dietaryPrefs` using the same pattern as `cuisinePrefs`:

```typescript
return {
  userId: row.user_id as string,
  email: row.email as string,
  displayName: row.display_name as string,
  createdAt: row.created_at as string,
  cookingFor: (row.cooking_for as string | null | undefined) ?? null,
  cuisinePrefs: (() => { try { return row.cuisine_prefs ? JSON.parse(row.cuisine_prefs as string) : []; } catch { return []; } })(),
  dietaryPrefs: (() => { try { return row.dietary_prefs ? JSON.parse(row.dietary_prefs as string) : []; } catch { return []; } })(),
};
```

- [ ] **Step 3: Update the new-profile fallback in `getOrCreateProfile`**

The `profile` object created for new users (around line 2756) also needs `dietaryPrefs`:

```typescript
const profile: UserProfile = {
  userId,
  email: email || '',
  displayName: email?.split('@')[0] || 'User',
  createdAt: new Date().toISOString(),
  cookingFor: null,
  cuisinePrefs: [],
  dietaryPrefs: [],
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

Expected: no errors. If you see errors about `dietaryPrefs` missing anywhere `UserProfile` is constructed or destructured, add `dietaryPrefs: []` as the default.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): add dietaryPrefs to UserProfile type and getOrCreateProfile"
```

---

## Task 2: Expose `dietaryPrefs` in GET `/profile` response

**Files:**
- Modify: `apps/worker/src/index.ts:843-854` (handleGetProfile)

- [ ] **Step 1: Add `dietaryPrefs` to `handleGetProfile` response**

Find `handleGetProfile` (around line 843):

```typescript
async function handleGetProfile(env: Env, user: AuthenticatedUser) {
  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const meta = await getCollectionMeta(env, user.userId);
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
    cookingFor: profile.cookingFor,
    cuisinePrefs: profile.cuisinePrefs,
  });
}
```

Add `dietaryPrefs`:

```typescript
async function handleGetProfile(env: Env, user: AuthenticatedUser) {
  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const meta = await getCollectionMeta(env, user.userId);
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
    cookingFor: profile.cookingFor,
    cuisinePrefs: profile.cuisinePrefs,
    dietaryPrefs: profile.dietaryPrefs,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): return dietaryPrefs in GET /profile response"
```

---

## Task 3: Pass `dietaryPrefs` from App.jsx to FriendSections

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (FriendSections render site, around line 4170)

- [ ] **Step 1: Add `dietaryPrefs` prop to the `<FriendSections>` render**

Find the `<FriendSections>` usage in `App.jsx` (around line 4170). It currently has:

```jsx
<FriendSections
  accessToken={accessToken}
  cookingFor={userProfile?.cookingFor ?? null}
  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
  onOpenRecipe={handleOpenEditorPickRecipe}
  ...
/>
```

Add `dietaryPrefs`:

```jsx
<FriendSections
  accessToken={accessToken}
  cookingFor={userProfile?.cookingFor ?? null}
  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
  dietaryPrefs={userProfile?.dietaryPrefs ?? null}
  onOpenRecipe={handleOpenEditorPickRecipe}
  ...
/>
```

- [ ] **Step 2: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): pass dietaryPrefs to FriendSections"
```

---

## Task 4: Wire `dietaryPrefs` into the AI picks call in FriendSections

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx:34,62-70`

- [ ] **Step 1: Add `dietaryPrefs` to the component's prop destructuring**

Find the function signature at line 34:

```js
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend })
```

Add `dietaryPrefs`:

```js
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, dietaryPrefs, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend })
```

- [ ] **Step 2: Include `diet` in the AI picks query params**

Find the `useEffect` that calls `/public/ai-picks` (around line 62):

```js
useEffect(() => {
  const params = new URLSearchParams();
  if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
    params.set('cuisine', cuisinePrefs.join(','));
  }
  if (cookingFor) params.set('cooking_for', cookingFor);
  const query = params.toString() ? `?${params.toString()}` : '';
  fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
}, [cookingFor, cuisinePrefs]);
```

Add `diet` param and `dietaryPrefs` dependency:

```js
useEffect(() => {
  const params = new URLSearchParams();
  if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
    params.set('cuisine', cuisinePrefs.join(','));
  }
  if (cookingFor) params.set('cooking_for', cookingFor);
  if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));
  const query = params.toString() ? `?${params.toString()}` : '';
  fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
}, [cookingFor, cuisinePrefs, dietaryPrefs]);
```

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
git commit -m "feat(ui): send dietary prefs as diet param to AI picks"
```

---

## Task 5: Deploy and verify

- [ ] **Step 1: Deploy the worker**

```bash
cd apps/worker && npx wrangler deploy
```

Expected: `Deployed recifind-worker` with no errors.

- [ ] **Step 2: Deploy the frontend**

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

Expected: build succeeds, deploy URL printed.

- [ ] **Step 3: Manual smoke test**

1. Log in to recifind.elisawidjaja.com as a user who has dietary prefs set (e.g. "🌱 Vegan")
2. Open browser DevTools → Network tab, filter by `ai-picks`
3. Confirm the request includes `diet=%F0%9F%8C%B1+Vegan` (or similar URL-encoded form)
4. Confirm the AI Picks section shows vegan-appropriate recipes

- [ ] **Step 4: Test with no prefs (regression)**

Log in as a user with no dietary prefs set. Confirm AI Picks still loads — the `diet` param should be absent from the request, and the section renders normally.
