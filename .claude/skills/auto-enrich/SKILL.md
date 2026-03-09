---
name: auto-enrich
description: Wire up automatic Gemini enrichment (ingredients, steps, image) when a user pastes a URL into the Add Recipe form. Enrichment runs before Save so data is ready when the user views the recipe.
allowed-tools: Read, Edit, Bash
---

Auto-enrich recipes with Gemini when users paste a URL into the Add Recipe form.

## What this does

When a user pastes a URL into the Add Recipe dialog:
1. `/recipes/parse` runs first (fast — og: tags, structured data, no AI)
2. If parse returns no ingredients/steps, `/recipes/enrich` (Gemini) fires immediately while the user is still on the form
3. The form pre-populates with title, image, ingredients, steps, meal types, and duration
4. By the time the user hits Save, all fields are already filled — no lag when viewing the recipe

## Key files

- `apps/recipe-ui/src/App.jsx` — the `useEffect` that watches `newRecipeForm.sourceUrl` (search for `fetchRecipeDetailsFromSource`)
- `apps/worker/src/index.ts` — `/recipes/parse` and `/recipes/enrich` route handlers

## Implementation pattern

In the `useEffect` for `newRecipeForm.sourceUrl`, use an async IIFE so you can await sequentially:

```js
(async () => {
  // Step 1: fast parse
  let localResult = null;
  try {
    localResult = await fetchRecipeDetailsFromSource(sourceUrl, { signal: controller.signal, token: accessToken });
  } catch (e) { /* may fail for Instagram/TikTok — continue to enrich */ }

  if (!isActive) return;

  // populate form with parse result (title, image, etc.)

  const hasIngredients = Array.isArray(localResult?.ingredients) && localResult.ingredients.length > 0;
  const hasSteps = Array.isArray(localResult?.steps) && localResult.steps.length > 0;

  if (hasIngredients || hasSteps) {
    setSourceParseState({ status: 'success', message: 'Recipe details parsed from source.' });
    return;
  }

  // Step 2: Gemini enrichment
  setSourceParseState({ status: 'loading', message: 'Fetching ingredients and steps with AI…' });
  try {
    const enrichResponse = await callRecipesApi('/recipes/enrich', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, title: localResult?.title || '' })
    }, accessToken);
    const enriched = enrichResponse?.enriched;
    if (enriched) {
      // populate form fields (ingredients, steps, mealTypes, durationMinutes, imageUrl, title)
      setSourceParseState({ status: 'success', message: 'Recipe details filled in with AI.' });
    }
  } catch (err) {
    // fall back gracefully
  }
})();
```

## Status messages shown to user

- `"Parsing recipe details…"` — og: fetch in progress
- `"Fetching ingredients and steps with AI…"` — Gemini running
- `"Recipe details filled in with AI."` — success
- `"Recipe title and preview parsed. Add details manually or enhance later."` — parse ok but enrich got nothing

## Notes

- Always check `isActive` after every await (cleanup cancels in-flight calls on URL change)
- The `lastParseResultRef` tracks `{ url, status }` to avoid re-fetching the same URL
- Set `lastParseResultRef.current = { url: sourceUrl, status: 'success' }` only after the full flow (parse + enrich) completes
- For Instagram/TikTok, parse often fails — enrich still runs and uses Gemini's culinary knowledge from the title alone
- Do NOT add a post-save background enrichment — the pre-save approach eliminates the need for it
