# Persistent Suggestion Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the "Recipes you might like" editor's-picks shelf visible through the new-user window (< 5 saved recipes) instead of vanishing after the first save, with per-card dismissal (X, inline save, or save-from-detail) persisted in localStorage by editor's-pick id.

**Architecture:** Frontend-only. App.jsx owns a `dismissedSuggestionIds` Set initialized from localStorage (`recifriend-dismissed-suggestions`); it's updated by an X button on suggestion cards and by both suggestion-save handlers, then passed down to RecipesPage which filters the shelf and renders it below the user's own recipes (hidden during active search/filter).

**Tech Stack:** React + Vite + MUI. No worker, no schema, no Gemini, no recipe-import code touched.

**Spec:** `docs/superpowers/specs/2026-05-21-persistent-suggestion-shelf-design.md`

**Deploy gating:** Build 17 is in App Store review. This is a web/frontend change; after implementation, smoke-test the import flow per `feedback_protect_import_flow.md`, deploy to dev only, and hold prod promotion until the user approves after dev/Xcode testing.

---

## File Structure

**Modified:**
- `apps/recipe-ui/src/components/RecipeListCard.jsx` — add optional `onDismiss` prop rendering a top-right corner X. No behavior change when the prop is absent (its default for every existing usage).
- `apps/recipe-ui/src/App.jsx` — module-scope localStorage helpers for the dismissed set; `dismissedSuggestionIds` state + `dismissSuggestion(id)` callback; record dismissal in `handleSavePublicRecipe` and `handleSaveSharedRecipe`; pass `dismissedSuggestionIds` + `onDismissSuggestion` to `<RecipesPage>`.
- `apps/recipe-ui/src/RecipesPage.jsx` — change the editor's-picks fetch gate from `=== 0` to `< 5`; accept the two new props; compute visible (non-dismissed) suggestions and an `isFilteringOrSearching` flag; render the shelf below the user's recipe list (and keep the 0-recipe empty-state shelf); pass `onDismiss` to suggestion cards.

No new files.

---

## Task 1: RecipeListCard — optional top-right dismiss X

**Files:**
- Modify: `apps/recipe-ui/src/components/RecipeListCard.jsx`

- [ ] **Step 1: Add the `CloseIcon` import**

At the top of `RecipeListCard.jsx`, add to the icon imports:

```js
import CloseIcon from '@mui/icons-material/Close';
```

- [ ] **Step 2: Add `onDismiss` to the props and render the corner X**

Change the function signature from:

```js
export default function RecipeListCard({ recipe, onOpen, onSave, onShare, thumbnail, saveIcon, saved, cardSx }) {
  return (
    <Card
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', overflow: 'hidden', ...cardSx }}
    >
```

to:

```js
export default function RecipeListCard({ recipe, onOpen, onSave, onShare, thumbnail, saveIcon, saved, cardSx, onDismiss }) {
  return (
    <Card
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', overflow: 'hidden', position: 'relative', ...cardSx }}
    >
      {onDismiss && (
        <IconButton
          size="small"
          aria-label="Dismiss suggestion"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(recipe); }}
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 2,
            width: 24,
            height: 24,
            backgroundColor: 'rgba(0,0,0,0.5)',
            color: '#fff',
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
          }}
        >
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
```

Notes:
- `position: 'relative'` added to the Card so the absolutely-positioned X anchors to the card corner.
- `IconButton` is already imported in this file.
- `stopPropagation` + `preventDefault` keep the X click from also firing the card's `onOpen`.

- [ ] **Step 3: Build to confirm no syntax errors**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3
```

Expected: `✓ built in ...s`.

- [ ] **Step 4: Run UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm test 2>&1 | grep -E "Test Files|Tests " | tail -2
```

Expected: 116/116 pass (existing usages don't pass `onDismiss`, so nothing changes for them).

- [ ] **Step 5: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/components/RecipeListCard.jsx
git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): optional dismiss X on RecipeListCard

When an onDismiss prop is provided, render a small translucent X in the
card's top-right corner (stopPropagation so it doesn't open the recipe).
No-op for every existing usage — the prop is absent by default."
```

---

## Task 2: App.jsx — dismissed-suggestions state + dismiss-on-save + props

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Add module-scope localStorage helpers**

Near the other module-scope helpers at the top of the file (e.g. just above `function App() {`), add:

```js
const DISMISSED_SUGGESTIONS_KEY = 'recifriend-dismissed-suggestions';

function readDismissedSuggestions() {
  try {
    const raw = localStorage.getItem(DISMISSED_SUGGESTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissedSuggestions(ids) {
  try {
    localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify(ids));
  } catch {
    // localStorage unavailable (private mode etc.) — dismissal is best-effort.
  }
}
```

- [ ] **Step 2: Add the state + dismiss callback inside App()**

Near the other recipe-related `useState` declarations in `App()` (e.g. close to `activeRecipe` / `activeRecipeDraft`), add:

```js
const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState(() => readDismissedSuggestions());

const dismissSuggestion = useCallback((id) => {
  if (!id) return;
  setDismissedSuggestionIds((prev) => {
    if (prev.includes(id)) return prev;
    const next = [...prev, id];
    writeDismissedSuggestions(next);
    return next;
  });
}, []);
```

(`useCallback` is already imported — it's used elsewhere in this file. If for some reason it isn't, add it to the `react` import.)

- [ ] **Step 3: Record dismissal in `handleSavePublicRecipe`**

Find `const handleSavePublicRecipe = async (recipe) => {`. After the successful-save block — specifically right after the `setSnackbarState({ open: true, message: ... saved to your collection! ...})` line — add:

```js
      dismissSuggestion(recipe.id);
```

So a card inline-save (and any other `handleSavePublicRecipe` caller) clears the matching shelf card. Recording a non-editor's-pick id here is harmless — it just won't match any shelf card.

- [ ] **Step 4: Record dismissal in `handleSaveSharedRecipe`**

Find `const handleSaveSharedRecipe = async () => {`. After its successful-save `setRecipes(...)` block (right after the `saveRecipesToCache(...)` call inside the `setRecipes` updater returns, i.e. after the `setRecipes((prev) => { ... })` statement), add:

```js
      dismissSuggestion(activeRecipe.id);
```

This covers the "open a suggestion → save from the detail view" path. `activeRecipe` is the opened editor's-pick recipe.

- [ ] **Step 5: Pass the new props to `<RecipesPage>`**

Find the `<RecipesPage` JSX. Add these two props alongside the existing ones (e.g. near `onSaveSuggestion` / `onOpenSuggestion` if present there, or anywhere in the prop list):

```jsx
                dismissedSuggestionIds={dismissedSuggestionIds}
                onDismissSuggestion={(recipe) => dismissSuggestion(recipe.id)}
```

- [ ] **Step 6: Build + UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3 && npm test 2>&1 | grep -E "Test Files|Tests " | tail -2
```

Expected: clean build, 116/116 tests pass.

- [ ] **Step 7: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/App.jsx
git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): dismissed-suggestions state + dismiss-on-save wiring

App owns dismissedSuggestionIds (localStorage-backed, keyed by editor's
-pick id). Both suggestion-save paths — handleSavePublicRecipe (card
save) and handleSaveSharedRecipe (detail-view save) — record a dismissal
so a saved pick leaves the shelf. Passed to RecipesPage with an
onDismissSuggestion callback for the card X."
```

---

## Task 3: RecipesPage — visibility, filtering, placement, hide-during-search

**Files:**
- Modify: `apps/recipe-ui/src/RecipesPage.jsx`

- [ ] **Step 1: Accept the new props**

In the `RecipesPage` props destructure, add (near `availableTags` etc.):

```js
  dismissedSuggestionIds = [],
  onDismissSuggestion = () => {},
```

- [ ] **Step 2: Change the editor's-picks fetch gate from `=== 0` to `< 5`**

Find the suggestions fetch effect:

```js
  useEffect(() => {
    if (totalRecipes !== 0) return;
```

Change the guard to:

```js
  useEffect(() => {
    if (totalRecipes >= 5) return;
```

Leave the rest of the effect (fetch `/public/editors-pick`, setSuggestions) unchanged. Update the dep array if it isn't already `[totalRecipes, accessToken]` — keep `totalRecipes` in it so the fetch fires as the count crosses below 5.

- [ ] **Step 3: Compute visible suggestions + an active-search/filter flag**

Just above the `renderRecipeCard` definition (or near the top of the component body after the hooks), add:

```js
  const visibleSuggestions = suggestions.filter((r) => !dismissedSuggestionIds.includes(r.id));
  const isFilteringOrSearching = Boolean(
    (normalizedIngredients && normalizedIngredients.length > 0) ||
    selectedMealType ||
    selectedCuisine ||
    (selectedTags && selectedTags.length > 0) ||
    showFavoritesOnly
  );
  const showSuggestionShelf = totalRecipes < 5 && visibleSuggestions.length > 0 && !isFilteringOrSearching;
```

(`normalizedIngredients`, `selectedMealType`, `selectedCuisine`, `selectedTags`, `showFavoritesOnly` are all already props on this component.)

- [ ] **Step 4: Pass `onDismiss` to suggestion cards in `renderRecipeCard`**

In `renderRecipeCard`, the suggestion variant (`isSuggestion === true`) should pass `onDismiss`. Change the `<RecipeListCard ... />` render to add:

```jsx
        onDismiss={isSuggestion ? onDismissSuggestion : undefined}
```

(Place it alongside the other props like `onShare`. For non-suggestion cards `isSuggestion` is false so `onDismiss` is undefined and the X doesn't render.)

- [ ] **Step 5: Update the 0-recipe empty-state branch to use `visibleSuggestions`**

In the `totalRecipes === 0 ?` branch, change `{suggestions.map((recipe) => renderRecipeCard(recipe, true))}` to:

```jsx
              {visibleSuggestions.map((recipe) => renderRecipeCard(recipe, true))}
```

This keeps the empty-state shelf consistent (dismissed cards stay gone there too). The branch condition `totalRecipes === 0` stays as-is — at zero recipes the shelf is the page.

- [ ] **Step 6: Render the shelf below the user's recipe list (1–4 recipes)**

Find the final `else` branch that renders the user's recipes:

```jsx
      ) : (
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: '10px', sm: '14px' },
            maxWidth: 600,
            mx: 'auto'
          }}
        >
          {displayedRecipes.map((recipe) => renderRecipeCard(recipe))}
        </Box>
      )}
```

Wrap the user's grid and the shelf in a fragment so the shelf renders beneath it:

```jsx
      ) : (
        <>
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: '10px', sm: '14px' },
              maxWidth: 600,
              mx: 'auto'
            }}
          >
            {displayedRecipes.map((recipe) => renderRecipeCard(recipe))}
          </Box>
          {showSuggestionShelf && (
            <Stack spacing={1} sx={{ mt: 5, maxWidth: 600, mx: 'auto', width: '100%' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary', mb: 1 }}>
                Recipes you might like
              </Typography>
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: { xs: '10px', sm: '14px' },
                }}
              >
                {visibleSuggestions.map((recipe) => renderRecipeCard(recipe, true))}
              </Box>
            </Stack>
          )}
        </>
      )}
```

Note: the `filteredRecipes.length === 0` branch (the "No recipes found" dashed box) is only reached when the user HAS recipes but a search/filter matched none — and in that state `isFilteringOrSearching` is true, so we intentionally do NOT show the shelf there. No change needed to that branch.

- [ ] **Step 7: Build + UI tests**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run build 2>&1 | tail -3 && npm test 2>&1 | grep -E "Test Files|Tests " | tail -2
```

Expected: clean build, 116/116 tests pass.

- [ ] **Step 8: Commit**

```bash
git -C /Users/elisa/Desktop/VibeCode add apps/recipe-ui/src/RecipesPage.jsx
git -C /Users/elisa/Desktop/VibeCode commit -m "feat(ui): persistent suggestion shelf below recipes (< 5 saved)

Editor's-picks fetch gate widens from ==0 to <5 saved recipes. Shelf
renders below the user's own recipes, filtered by the dismissed-id set,
hidden during active search/filter. Suggestion cards get the dismiss X.
At 0 recipes the shelf remains the empty state (now also honoring
dismissals)."
```

---

## Task 4: Smoke-test + deploy dev only (STOP)

**Files:**
- Live: `recipes-worker-dev` (no worker change this time, but redeploy keeps dev in lockstep) and the dev frontend via the user's Vite tunnel.

- [ ] **Step 1: Full UI test suite**

```bash
cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm test 2>&1 | grep -E "Test Files|Tests " | tail -2
```

Expected: 116/116.

- [ ] **Step 2: Import-flow smoke test (per `feedback_protect_import_flow.md`)**

This change touches no worker code, but run the guardrail check anyway against prod:

```bash
python3 - <<'PY'
import json, subprocess
for label, src in [
  ('AllRecipes','https://www.allrecipes.com/recipe/16354/easy-meatloaf/'),
  ('TikTok','https://www.tiktok.com/t/ZP8pXhA2B/'),
  ('Instagram','https://www.instagram.com/reel/DYfuEfogc1p/'),
]:
    r = subprocess.run(['curl','-s','-X','POST','-H','Content-Type: application/json',
        '-d', json.dumps({'sourceUrl': src}),
        'https://api.recifriend.com/recipes/parse','-w','\nTIME=%{time_total} HTTP=%{http_code}'],
        capture_output=True, text=True, timeout=30)
    body, meta = r.stdout.rsplit('\n',1)
    p = (json.loads(body).get('parsed') or {})
    print(f"{label:<11} {meta}  title='{(p.get('title') or '')[:30]}' ing={len(p.get('ingredients') or [])} steps={len(p.get('steps') or [])}")
PY
```

Expected: AllRecipes 9 ing / 5 steps; TikTok + Instagram return a title. (Confirms nothing in the shared frontend bundle broke the worker — trivially true here, but the guardrail requires it.)

- [ ] **Step 3: Hand off to user for dev testing**

Tell the user the frontend change is committed and ready to test on the dev tunnel + Xcode. Do NOT deploy prod worker. Do NOT deploy Pages. (No worker redeploy is strictly needed since the worker is unchanged; the dev frontend is served from the user's local Vite, which already has the code.)

---

## Task 5 (deferred — user-gated): Promote to prod

**Run only after the user approves dev testing.**

- [ ] **Step 1:** `git push origin main`
- [ ] **Step 2:** Build + deploy Pages: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind --commit-dirty=true`
- [ ] **Step 3:** (No worker deploy needed — no worker changes. Skip unless other pending worker commits exist.)
- [ ] **Step 4:** Post-deploy: load `recifriend.com` as a new/low-recipe-count user, confirm the shelf shows below recipes with working X + save dismissal.

---

## Self-Review

**Spec coverage:**
- Visibility (`< 5` saved, ≥1 un-dismissed, not searching/filtering) → Task 3 Step 3 + Step 6. ✅
- Placement below user's recipes → Task 3 Step 6. ✅
- Dismissal via X → Task 1 + Task 3 Step 4. ✅
- Dismissal via inline save → Task 2 Step 3. ✅
- Dismissal via save-from-detail → Task 2 Step 4. ✅
- localStorage id-set persistence → Task 2 Step 1-2. ✅
- Hide during search/filter → Task 3 Step 3 (`isFilteringOrSearching`). ✅
- Weekly rotation (new ids unaffected) → inherent in id-based filtering; no code needed. ✅
- 0-recipe empty state keeps shelf + honors dismissals → Task 3 Step 5. ✅
- Frontend-only, import flow untouched → no worker tasks; Task 4 Step 2 guardrail. ✅

**Placeholder scan:** No TBD/TODO/"similar to"/vague steps — every code step has concrete code. ✅

**Type/name consistency:**
- `dismissedSuggestionIds` (array of string ids) — defined Task 2 Step 2, consumed Task 3 Step 1/3. ✅
- `dismissSuggestion(id)` in App.jsx (takes id string); `onDismissSuggestion(recipe)` prop passed to RecipesPage takes a recipe and calls `dismissSuggestion(recipe.id)` (Task 2 Step 5); `RecipeListCard.onDismiss(recipe)` calls `onDismiss(recipe)` (Task 1 Step 2); RecipesPage passes `onDismiss={isSuggestion ? onDismissSuggestion : undefined}` (Task 3 Step 4). The recipe→id unwrapping happens in App's inline arrow. Consistent. ✅
- `visibleSuggestions` / `showSuggestionShelf` / `isFilteringOrSearching` — defined and used within Task 3. ✅
