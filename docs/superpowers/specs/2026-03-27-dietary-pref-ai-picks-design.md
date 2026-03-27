# Dietary Preference Wiring for AI Picks

**Date:** 2026-03-27
**Scope:** Wire collected dietary preferences into the AI Picks personalization call

## Problem

Dietary preferences are collected in onboarding and saved to D1 via `PATCH /profile`, but are never returned by `GET /profile` and never sent to the `/public/ai-picks` endpoint. As a result, a vegan user sees the same AI-picked recipes as a meat lover.

The backend already accepts a `diet` query param in `/public/ai-picks` and passes it to Gemini. The KV cache key already partitions on `diet`. The pipeline is half-built — it just needs to be wired end-to-end.

## Out of Scope

- Editor's Pick — left as-is (curated hardcoded list, no dietary filtering)
- Trending recipes — left as-is
- Friend activity / recently saved / recently shared feeds — no filtering
- Dietary tagging of existing D1 recipes

## Changes

### 1. Worker — `handleGetProfile` (`apps/worker/src/index.ts`)

Add `dietaryPrefs` to the GET `/profile` response. `getOrCreateProfile` already reads `dietary_prefs` from D1; parse it as a JSON array and include it alongside `cookingFor` and `cuisinePrefs`.

```ts
return json({
  displayName: profile.displayName,
  email: profile.email,
  createdAt: profile.createdAt,
  recipeCount: meta?.count ?? 0,
  cookingFor: profile.cookingFor,
  cuisinePrefs: profile.cuisinePrefs,
  dietaryPrefs: profile.dietaryPrefs,  // add this
}, 200, withCors());
```

### 2. Worker — `UserProfile` type (`apps/worker/src/index.ts`)

```ts
interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  cookingFor: string | null;
  cuisinePrefs: string[];
  dietaryPrefs: string[];  // add this
}
```

Also ensure `getOrCreateProfile` parses `dietary_prefs` from the D1 row (same pattern as `cuisinePrefs`).

### 3. App.jsx — FriendSections render

Pass the new field as a prop:

```jsx
<FriendSections
  accessToken={accessToken}
  cookingFor={userProfile?.cookingFor ?? null}
  cuisinePrefs={userProfile?.cuisinePrefs ?? null}
  dietaryPrefs={userProfile?.dietaryPrefs ?? null}  // add this
  ...
/>
```

### 4. FriendSections.jsx — AI picks call

Add `dietaryPrefs` to props and include `diet` in the query params:

```js
export default function FriendSections({ accessToken, cookingFor, cuisinePrefs, dietaryPrefs, ... }) {
  useEffect(() => {
    const params = new URLSearchParams();
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));  // add this
    const query = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${query}`).then(d => setAiPicks(d?.picks || []));
  }, [cookingFor, cuisinePrefs, dietaryPrefs]);  // add dietaryPrefs to deps
```

Dietary pref strings are stored with emojis (e.g. `"🌱 Vegan"`) — passed as-is to Gemini, which handles them correctly.

## Cache Behavior

No changes needed. The KV cache key is already:
```
ai-picks:v4:{diet}:{cuisineSorted}:{cookingFor}
```
A vegan user automatically gets their own cache slot distinct from a meat lover's.

## Testing

1. Complete onboarding as a vegan user — select "🌱 Vegan"
2. Log in and view home feed
3. Confirm the AI Picks section shows vegan-appropriate recipes
4. Check worker logs / network tab to verify `diet=%F0%9F%8C%B1%20Vegan` appears in the `/public/ai-picks` request
