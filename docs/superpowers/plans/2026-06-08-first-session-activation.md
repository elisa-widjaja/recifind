# First-Session Activation (0 → 1 recipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the passive final onboarding screen into a live tap-to-save moment so brand-new users save their first recipe before leaving, then land them on the Discover tab.

**Architecture:** The "You're all set" checklist screen (step 1 = "Add your first recipe") becomes interactive: step 1 renders an inline horizontal `RecipeShelf` carousel of curated Editor's-Pick recipes, each tap calling the existing `handleSavePublicRecipe`. Step 1's circle flips to a real "done" check on first save; the bottom control is a low-emphasis "Skip for now" until a save happens, then a primary "Get started". All onboarding exits land first-session users on the Discover tab (returning users are unaffected). A small secondary change points the nudge email at Discover.

**Tech Stack:** React + Vite + MUI (`apps/recipe-ui`, JavaScript), Vitest + React Testing Library for component tests, Cloudflare Worker TypeScript (`apps/worker`) for the nudge email.

**Spec:** `docs/superpowers/specs/2026-06-08-first-session-activation-design.md`

**Conventions for this plan:**
- Frontend test command (run from `apps/recipe-ui`): `npm test -- <path>`
- Worker test command (run from `apps/worker`): `npm test -- <path>`
- No em dashes in any user-facing copy (house rule). Code comments are exempt.
- Do not commit until each task's commit step. Work on `main` (no branches).

---

## File Structure

- **Modify** `apps/recipe-ui/src/components/RecipeShelf.jsx` — add optional `savedIds` (filled bookmark for saved cards) and `hideShare` props. Backwards-compatible defaults.
- **Create** `apps/recipe-ui/src/components/RecipeShelf.test.jsx` — covers the two new props.
- **Modify** `apps/recipe-ui/src/components/OnboardingDrawer.jsx` — export `ChecklistScreen`, make step 1 an inline carousel with done-state + adaptive button; add `firstSaveRecipes` / `onSaveRecipe` props and a `savedIds` state to the drawer.
- **Create** `apps/recipe-ui/src/components/OnboardingDrawer.test.jsx` — unit-tests `ChecklistScreen` directly + one drawer navigation integration test.
- **Modify** `apps/recipe-ui/src/App.jsx` — fetch Editor's-Pick into `firstSaveRecipes`; pass it + `handleSavePublicRecipe` into the drawer; land the three onboarding handlers on `'discover'`; source-tag saves; read `?view=` on mount (secondary).
- **Modify** `apps/worker/src/index.ts` — point the nudge email CTA at Discover (secondary).
- **Create** `apps/worker/src/nudge-email.test.ts` — asserts the nudge CTA destination (secondary). Worker tests live in `src/` and import from `./index`.

---

## Task 1: Extend RecipeShelf with `savedIds` and `hideShare`

**Files:**
- Modify: `apps/recipe-ui/src/components/RecipeShelf.jsx`
- Test: `apps/recipe-ui/src/components/RecipeShelf.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/recipe-ui/src/components/RecipeShelf.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecipeShelf from './RecipeShelf';

const RECIPES = [
  { id: 'r1', title: 'Garlic Pasta', sourceUrl: '', imageUrl: '' },
  { id: 'r2', title: 'Thai Curry', sourceUrl: '', imageUrl: '' },
];

describe('RecipeShelf', () => {
  it('calls onSave when a card save icon is tapped', () => {
    const onSave = vi.fn();
    render(<RecipeShelf recipes={RECIPES} onSave={onSave} />);
    fireEvent.click(screen.getAllByLabelText('Save recipe')[0]);
    expect(onSave).toHaveBeenCalledWith(RECIPES[0]);
  });

  it('shows a "Saved" affordance for recipes whose id is in savedIds', () => {
    render(<RecipeShelf recipes={RECIPES} savedIds={new Set(['r1'])} />);
    // Saved card exposes aria-label "Saved"; unsaved card stays "Save recipe".
    expect(screen.getByLabelText('Saved')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Save recipe')).toHaveLength(1);
  });

  it('hides the share icon when hideShare is set', () => {
    render(<RecipeShelf recipes={RECIPES} hideShare />);
    expect(screen.queryByLabelText('Share recipe')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/recipe-ui && npm test -- src/components/RecipeShelf.test.jsx`
Expected: FAIL. The `savedIds` and `hideShare` tests fail (no "Saved" label, share icon still present). The first test may pass already.

- [ ] **Step 3: Add the props and saved/hideShare rendering**

In `apps/recipe-ui/src/components/RecipeShelf.jsx`:

Add the filled-bookmark import after line 2 (`import BookmarkBorderIcon ...`):

```jsx
import BookmarkIcon from '@mui/icons-material/Bookmark';
```

Change the component signature (currently lines 19-28) to accept the new props and thread them to each card:

```jsx
export default function RecipeShelf({
  recipes = [],
  onSave = () => {},
  onShare = () => {},
  onOpen = () => {},
  cardWidth = 140,
  cardHeight,
  gap = '12px',
  peek = false,
  savedIds = new Set(),
  hideShare = false,
}) {
```

In the `recipes.map(...)` block (currently lines 51-62), pass the per-card flags:

```jsx
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onSave={onSave}
            onShare={onShare}
            onOpen={onOpen}
            cardWidth={cardWidth}
            thumbHeight={thumbHeight}
            peek={peek}
            saved={savedIds.has(recipe.id)}
            hideShare={hideShare}
          />
        ))}
```

Update the `RecipeCard` signature (currently line 82) to accept them:

```jsx
function RecipeCard({ recipe, onSave, onShare, onOpen, cardWidth, thumbHeight, peek, saved = false, hideShare = false }) {
```

Replace the save IconButton (currently lines 172-179) with a saved-aware version:

```jsx
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onSave(recipe); }}
            aria-label={saved ? 'Saved' : 'Save recipe'}
            sx={{ p: 0.5, mr: '9px' }}
          >
            {saved
              ? <BookmarkIcon sx={{ fontSize: 18, color: 'primary.main' }} />
              : <BookmarkBorderIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />}
          </IconButton>
```

Wrap the share IconButton (currently lines 180-187) so it can be hidden:

```jsx
          {!hideShare && (
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onShare(recipe, e); }}
              aria-label="Share recipe"
              sx={{ p: 0.5 }}
            >
              <IosShareOutlinedIcon sx={{ fontSize: 18, color: '#9E9E9E' }} />
            </IconButton>
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/recipe-ui && npm test -- src/components/RecipeShelf.test.jsx`
Expected: PASS (3 passing).

- [ ] **Step 5: Verify no existing RecipeShelf consumers broke**

Run: `cd apps/recipe-ui && npm test -- src/components/DiscoverPage.test.jsx`
Expected: PASS (DiscoverPage uses RecipeShelf with default props; behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-ui/src/components/RecipeShelf.jsx apps/recipe-ui/src/components/RecipeShelf.test.jsx
git commit -m "feat(ui): add savedIds + hideShare props to RecipeShelf

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Make ChecklistScreen interactive (carousel + done-state + adaptive button)

**Files:**
- Modify: `apps/recipe-ui/src/components/OnboardingDrawer.jsx` (the `ChecklistScreen` function, currently lines 438-481; export it)
- Test: `apps/recipe-ui/src/components/OnboardingDrawer.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/recipe-ui/src/components/OnboardingDrawer.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChecklistScreen } from './OnboardingDrawer';

const RECIPES = [
  { id: 'r1', title: 'Garlic Pasta', sourceUrl: '', imageUrl: '' },
  { id: 'r2', title: 'Thai Curry', sourceUrl: '', imageUrl: '' },
];

describe('ChecklistScreen', () => {
  it('renders the three checklist step labels', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/invite a friend/i)).toBeInTheDocument();
    expect(screen.getByText(/share a recipe with a friend/i)).toBeInTheDocument();
  });

  it('renders a tap-to-save carousel card for each recipe under step 1', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText('Garlic Pasta')).toBeInTheDocument();
    expect(screen.getByText('Thai Curry')).toBeInTheDocument();
  });

  it('shows "Skip for now" (not "Get started") when nothing is saved yet', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^get started$/i })).not.toBeInTheDocument();
  });

  it('swaps to a primary "Get started" once at least one recipe is saved', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
  });

  it('marks step 1 done (data-done=true) once a recipe is saved', () => {
    const { rerender } = render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i).closest('[data-step]')).toHaveAttribute('data-done', 'false');
    rerender(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i).closest('[data-step]')).toHaveAttribute('data-done', 'true');
  });

  it('calls onGetStarted from both the skip and the get-started states', () => {
    const onGetStarted = vi.fn();
    const { rerender } = render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    rerender(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }));
    expect(onGetStarted).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/recipe-ui && npm test -- src/components/OnboardingDrawer.test.jsx`
Expected: FAIL with an import error: `ChecklistScreen` is not exported (and the step-1 label is currently "Add your first recipe", not "Save your first recipe").

- [ ] **Step 3: Update the step-1 label**

In `apps/recipe-ui/src/components/OnboardingDrawer.jsx`, change the first entry of `CHECKLIST_STEPS` (currently lines 21-24) so its label matches the active step:

```jsx
  {
    label: 'Save your first recipe',
    sub: 'Tap one below to add it to your collection.',
  },
```

- [ ] **Step 4: Add a StepCircle helper**

In `apps/recipe-ui/src/components/OnboardingDrawer.jsx`, add this helper next to the other helpers (after the `H2` helper, around line 227):

```jsx
// Checklist step bullet. Decorative grey-tinted circle until the step is
// actually completed, then a filled primary circle with a white check.
function StepCircle({ done }) {
  return (
    <Box sx={(theme) => ({
      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
      bgcolor: done
        ? 'primary.main'
        : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'),
      color: done
        ? '#fff'
        : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      mt: '1px',
      transition: 'background-color 180ms ease',
    })}>
      <CheckIcon sx={{ fontSize: 16 }} />
    </Box>
  );
}
```

- [ ] **Step 5: Rewrite ChecklistScreen**

In `apps/recipe-ui/src/components/OnboardingDrawer.jsx`, replace the entire `ChecklistScreen` function (currently lines 438-481) with:

```jsx
export function ChecklistScreen({ recipes = [], savedIds = new Set(), onSave = () => {}, onGetStarted, onBack }) {
  const savedCount = savedIds.size;
  return (
    <>
      <H1>You're all set</H1>
      <Tagline>Three quick wins to get the most out of ReciFriend.</Tagline>

      <Stack spacing={2.25} sx={{ mb: 2 }}>
        {CHECKLIST_STEPS.map((step, i) => {
          const done = i === 0 && savedCount > 0;
          return (
            <Box key={step.label} data-step data-done={done ? 'true' : 'false'}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <StepCircle done={done} />
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
                    {step.label}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
                    {step.sub}
                  </Typography>
                </Box>
              </Box>
              {/* Step 1 is interactive: an inline tap-to-save carousel. Tapping
                  a card (or its bookmark) saves it; saved cards show a filled
                  bookmark. Share icon hidden to keep the action unambiguous. */}
              {i === 0 && recipes.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <RecipeShelf
                    recipes={recipes}
                    savedIds={savedIds}
                    onSave={onSave}
                    onOpen={onSave}
                    hideShare
                    cardWidth={150}
                    peek
                  />
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>

      {savedCount > 0 ? (
        <Button
          fullWidth
          variant="contained"
          onClick={onGetStarted}
          sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, py: 1.25, fontSize: 15, mt: 2 }}
        >
          Get started
        </Button>
      ) : (
        <Button
          fullWidth
          onClick={onGetStarted}
          sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 13, mt: 2 }}
        >
          Skip for now
        </Button>
      )}
    </>
  );
}
```

- [ ] **Step 6: Add the RecipeShelf import**

At the top of `apps/recipe-ui/src/components/OnboardingDrawer.jsx` (after line 7, the cuisines import), add:

```jsx
import RecipeShelf from './RecipeShelf';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd apps/recipe-ui && npm test -- src/components/OnboardingDrawer.test.jsx`
Expected: PASS (6 passing).

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-ui/src/components/OnboardingDrawer.jsx apps/recipe-ui/src/components/OnboardingDrawer.test.jsx
git commit -m "feat(ui): interactive first-save carousel in onboarding checklist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire OnboardingDrawer to track saves and feed the carousel

**Files:**
- Modify: `apps/recipe-ui/src/components/OnboardingDrawer.jsx` (the `OnboardingDrawer` component, currently lines 41-215)
- Test: `apps/recipe-ui/src/components/OnboardingDrawer.test.jsx` (append one integration test)

- [ ] **Step 1: Write the failing integration test**

Append to `apps/recipe-ui/src/components/OnboardingDrawer.test.jsx`:

```jsx
import OnboardingDrawer from './OnboardingDrawer';

describe('OnboardingDrawer first-save wiring', () => {
  const RECIPES_D = [{ id: 'r1', title: 'Garlic Pasta', sourceUrl: '', imageUrl: '' }];

  async function gotoChecklist() {
    // Welcome -> Dietary -> Cooking-for -> Cuisines -> Checklist. Each Next runs
    // an async goNext (saves prefs), so await each screen's unique heading
    // before clicking again, otherwise synchronous clicks race the transition.
    fireEvent.click(screen.getByRole('button', { name: /get started/i })); // welcome CTA
    await screen.findByText('Dietary preferences');
    fireEvent.click(screen.getByLabelText('Next'));
    await screen.findByText('I am cooking for');
    fireEvent.click(screen.getByLabelText('Next'));
    await screen.findByText('Favorite cuisines');
    fireEvent.click(screen.getByLabelText('Next'));
    await screen.findByText("You're all set");
  }

  it('saves a tapped card via onSaveRecipe and flips the button to Get started', async () => {
    const onSaveRecipe = vi.fn().mockResolvedValue(undefined);
    render(
      <OnboardingDrawer
        open
        initialPrefs={{ dietaryPrefs: [], cookingFor: '', cuisinePrefs: [] }}
        onSavePrefs={vi.fn().mockResolvedValue(undefined)}
        onComplete={vi.fn()}
        firstSaveRecipes={RECIPES_D}
        onSaveRecipe={onSaveRecipe}
      />
    );
    await gotoChecklist();
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Save recipe'));
    expect(onSaveRecipe).toHaveBeenCalledWith(RECIPES_D[0]);
    expect(await screen.findByRole('button', { name: /^get started$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/recipe-ui && npm test -- src/components/OnboardingDrawer.test.jsx`
Expected: FAIL. The drawer does not yet accept `firstSaveRecipes`/`onSaveRecipe`, so no card renders on the checklist screen and the button never flips.

- [ ] **Step 3: Add props, savedIds state, and a save handler to OnboardingDrawer**

In `apps/recipe-ui/src/components/OnboardingDrawer.jsx`, extend the `OnboardingDrawer` signature (currently lines 41-49) with two new props:

```jsx
export default function OnboardingDrawer({
  open,
  inviterName,
  initialPrefs,
  onSavePrefs,
  onComplete,
  onSkipForever,
  onClose,
  firstSaveRecipes = [],
  onSaveRecipe,
}) {
```

Add `savedIds` state next to the other `useState` declarations (after line 54, `const [saving, setSaving] = useState(false);`):

```jsx
  const [savedIds, setSavedIds] = useState(() => new Set());
```

Reset it in the once-per-open initializer effect. Inside the `if (initializedRef.current) return;` block (after line 69, `setCuisinePrefs(...)`), add:

```jsx
    setSavedIds(new Set());
```

Add the save handler just before the `return (` at line 112:

```jsx
  // Save a tapped card via the parent, then record its id locally so the
  // card shows its saved state and step 1 flips to done. Optimistic: we add
  // the id immediately; a failed save still surfaces the parent's error
  // snackbar, and a retry tap is harmless (server upserts by source_url).
  const handleCardSave = async (recipe) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.add(recipe.id);
      return next;
    });
    try { await onSaveRecipe?.(recipe); } catch { /* parent surfaces errors */ }
  };
```

- [ ] **Step 4: Pass the new props into ChecklistScreen**

In `apps/recipe-ui/src/components/OnboardingDrawer.jsx`, replace the checklist render line (currently line 210):

```jsx
        {screen === SCREEN_CHECKLIST && (
          <ChecklistScreen onGetStarted={onComplete} onBack={goBack} />
        )}
```

with:

```jsx
        {screen === SCREEN_CHECKLIST && (
          <ChecklistScreen
            recipes={firstSaveRecipes}
            savedIds={savedIds}
            onSave={handleCardSave}
            onGetStarted={onComplete}
            onBack={goBack}
          />
        )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/recipe-ui && npm test -- src/components/OnboardingDrawer.test.jsx`
Expected: PASS (7 passing total).

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-ui/src/components/OnboardingDrawer.jsx apps/recipe-ui/src/components/OnboardingDrawer.test.jsx
git commit -m "feat(ui): thread first-save recipes + save tracking through OnboardingDrawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire App.jsx — fetch curated recipes, land on Discover, tag save source

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

App.jsx is a single large file with no unit-test harness (no existing App.test.jsx). Per the codebase's established pattern, this task is verified by the test suite still passing plus a build, with a manual smoke note. Each edit uses a unique anchor string so it is unambiguous.

- [ ] **Step 1: Add `firstSaveRecipes` state and a fetch for Editor's-Pick**

In `apps/recipe-ui/src/App.jsx`, find the `currentView` state declaration (line ~1365, `const [currentView, setCurrentView] = useState(() => {`). Immediately ABOVE it, add:

```jsx
  // Curated recipes shown on the final onboarding screen for one-tap "first
  // save". Public endpoint, no auth needed. Fetched lazily when the
  // onboarding drawer opens (see effect below).
  const [firstSaveRecipes, setFirstSaveRecipes] = useState([]);
```

Then find the onboarding drawer open state (search for `onboardingDrawerOpen`). After the existing effects near it, add a fetch effect (place it directly after the `currentView` sessionStorage effect at line ~1375):

```jsx
  // Lazy-load the curated first-save carousel the first time the onboarding
  // drawer opens. /public/editors-pick returns { recipes: [...] } with real
  // images + full ingredients/steps, so a saved card is immediately usable.
  useEffect(() => {
    if (!onboardingDrawerOpen || firstSaveRecipes.length) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/public/editors-pick`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setFirstSaveRecipes((d?.recipes || []).slice(0, 8)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onboardingDrawerOpen, firstSaveRecipes.length]);
```

Note: if `onboardingDrawerOpen` is declared textually below this point, move the effect to just after its `useState`. The effect only needs `onboardingDrawerOpen`, `firstSaveRecipes.length`, and `API_BASE_URL` in scope.

- [ ] **Step 2: Pass the new props into the rendered OnboardingDrawer**

Find the `<OnboardingDrawer` render (line ~5556). It currently ends with:

```jsx
        onComplete={handleOnboardingComplete}
        onClose={handleOnboardingClose}
        onSkipForever={handleOnboardingSkipForever}
      />
```

Add the two new props before the closing `/>`:

```jsx
        onComplete={handleOnboardingComplete}
        onClose={handleOnboardingClose}
        onSkipForever={handleOnboardingSkipForever}
        firstSaveRecipes={firstSaveRecipes}
        onSaveRecipe={(recipe) => handleSavePublicRecipe(recipe, 'onboarding')}
      />
```

- [ ] **Step 3: Land first-session users on Discover**

In `apps/recipe-ui/src/App.jsx`, change the three onboarding exit handlers (lines ~2834-2860) from `setCurrentView('home')` to `setCurrentView('discover')`. There are exactly three, inside `handleOnboardingComplete`, `handleOnboardingClose`, and `handleOnboardingSkipForever`. Each currently reads:

```jsx
    setOnboardingDrawerOpen(false);
    setCurrentView('home');
    setChecklistKey((k) => k + 1);
    await markOnboardingSeen();
```

Change the `setCurrentView('home')` line in each of those three handlers to:

```jsx
    setCurrentView('discover');
```

Do NOT change any other `setCurrentView('home')` in the file (only the three inside those onboarding handlers).

- [ ] **Step 4: Tag the save source for measurement**

In `apps/recipe-ui/src/App.jsx`, update `handleSavePublicRecipe` (line ~2605) to accept a `source` and emit an analytics event on success.

Change the signature (line ~2605):

```jsx
  const handleSavePublicRecipe = async (recipe, source = 'discover') => {
```

Then, right after the successful-save snackbar line (currently line ~2638, `setSnackbarState({ open: true, message: \`"${recipe.title}" saved...`), add:

```jsx
      trackEvent('save_public_recipe', { source, first_save: recipes.length === 0 });
```

`recipes` is the current collection state in closure scope; `recipes.length === 0` at save time means this was their 0 -> 1 activation. This lets us segment activation by source (`onboarding` vs `discover`) and isolate true first saves.

- [ ] **Step 5: Run the full frontend test suite and build**

Run: `cd apps/recipe-ui && npm test`
Expected: PASS (all existing tests plus Tasks 1-3 tests; nothing regressed).

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Manual smoke (local dev), per the protect-import-flow house rule**

Start dev (`cd apps/recipe-ui && npm run dev -- --host`), sign in as a brand-new test user (or clear `onboarding_seen` for an existing one), and confirm:
- The final onboarding screen ("You're all set") shows a horizontal carousel under "Save your first recipe".
- The bottom control reads "Skip for now" until a card is tapped, then becomes "Get started".
- Tapping a card shows the saved snackbar and the card's bookmark fills in; step 1's circle turns into a filled check.
- Pressing "Get started" (or "Skip for now") lands on the Discover tab, not home.

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ui): first-session lands on Discover with curated first-save carousel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 (Secondary): Point the nudge email at Discover + read ?view= on load

This is the secondary lever (B). It is self-contained and can be deferred without affecting Tasks 1-4. Do it only after the primary flow is verified.

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (read `?view=` on mount)
- Modify: `apps/worker/src/index.ts` (nudge CTA href)
- Test: `apps/worker/src/nudge-email.test.ts` (create)

- [ ] **Step 1: Read `?view=` on mount (frontend)**

In `apps/recipe-ui/src/App.jsx`, add a mount effect directly after the `currentView` sessionStorage-persist effect (line ~1375). This lets an inbound link select the landing tab once, then strips the param:

```jsx
  // One-shot landing-tab override from an inbound link (e.g. the nudge email
  // CTA: recifriend.com/?view=discover). Validated against known views, then
  // the param is removed so it doesn't stick across in-app navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    const VALID = ['home', 'recipes', 'friends', 'discover', 'profile'];
    if (v && VALID.includes(v)) {
      setCurrentView(v);
      params.delete('view');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);
```

- [ ] **Step 2: Write the failing worker test**

Create `apps/worker/src/nudge-email.test.ts` (worker tests live alongside source in `src/` and import from `./index`):

```ts
import { describe, expect, it } from 'vitest';
import { buildNudgeEmailHtml } from './index';

describe('buildNudgeEmailHtml', () => {
  it('points the primary CTA at the Discover tab', () => {
    const html = buildNudgeEmailHtml('Sam', [], null);
    expect(html).toContain('view=discover');
    // It must not still point at the bare /recipes tab.
    expect(html).not.toContain('href="https://recifriend.com/recipes"');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/worker && npm test -- src/nudge-email.test.ts`
Expected: FAIL. The current CTA is `https://recifriend.com/recipes` (no `view=discover`).

- [ ] **Step 4: Update the nudge CTA href**

In `apps/worker/src/index.ts`, find the nudge CTA (line ~4860):

```ts
    <a href="https://recifriend.com/recipes" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Save Your First Recipe →</a>
```

Change the `href` to land on Discover, where one-tap-save curated recipes live:

```ts
    <a href="https://recifriend.com/?view=discover" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Save Your First Recipe →</a>
```

- [ ] **Step 5: Run the worker test to verify it passes**

Run: `cd apps/worker && npm test -- src/nudge-email.test.ts`
Expected: PASS.

- [ ] **Step 6: Build the frontend to confirm the ?view= effect compiles**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-ui/src/App.jsx apps/worker/src/index.ts apps/worker/src/nudge-email.test.ts
git commit -m "feat: nudge email CTA + inbound ?view= land on Discover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deferred / out of scope (do NOT build in this plan)

- **Cuisine personalization** of the carousel: requires `/public/editors-pick` (or a new endpoint) to filter by the user's `cuisinePrefs`. v1 ships unpersonalized. Revisit once first-session activation lift is confirmed.
- **Hard gating** of onboarding completion. Explicitly rejected in the spec.
- **Pushing Path 2 (import-your-own)** inside onboarding. Stays out per owner decision.
- **Retention dashboard** comparing curated-save vs import-save cohorts: the `save_public_recipe` event with `source` + `first_save` is emitted here (Task 4) so the data exists; building the admin view is a separate effort.

## Deployment note (after merge, when the user asks)

Per `CLAUDE.md`, nothing auto-deploys. The frontend change ships via
`cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
and the worker change via `cd apps/worker && npx wrangler deploy`. The Discover-landing
and carousel are web-immediate; the iOS app picks them up on its next build. Do not deploy
without the user's go-ahead and a `git status` check (working-tree deploy rule).
