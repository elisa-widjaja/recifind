# Onboarding Preferences — Design Spec

**Date:** 2026-03-13
**Status:** Approved

## Overview

Redesign the 3-screen onboarding flow in `OnboardingFlow.jsx` to capture higher-signal preference data for personalizing both the AI recipe recommendations and the community/friend feed.

## Goals

- Capture preferences that meaningfully personalize both surfaces: AI picks (Gemini) and the community discovery feed
- Keep the flow at exactly 3 screens to preserve conversion rate
- Store new fields on the user profile via `PATCH /profile`

## Screens

### Screen 1 — Dietary Restrictions (updated)

**Title:** "Any dietary preferences?"
**Subtitle:** "We'll filter out recipes that don't work for you"
**Input:** Multi-select chips

Options:
- Vegetarian
- Vegan *(new — distinct from Vegetarian)*
- Gluten-free
- Dairy-free
- High protein
- Pescatarian
- Meat lover
- None / all good

Selecting "None / all good" deselects all other chips. Selecting any other chip deselects "None / all good."

**Stored as:** `dietary_prefs` (JSON string array) — same field as before

### Screen 2 — Who You Cook For (new)

**Title:** "Who are you usually cooking for?"
**Subtitle:** "Helps us suggest the right recipes for your table"
**Input:** Single-select cards (same card style as current skill level screen)

Options:

| Label | Subtitle | Value |
|---|---|---|
| 👤 Just me | Quick meals, single portions | `solo` |
| 👫 Partner or roommate | Easy sharing, 2–3 servings | `couple` |
| 👨‍👩‍👧 Family | Kid-friendly, crowd pleasers | `family` |
| 🎉 I love to entertain | Impressive dishes, feeds a crowd | `entertaining` |

**Stored as:** `cooking_for` (plain string, one of: `solo`, `couple`, `family`, `entertaining`) — new field, nullable

### Screen 3 — Cuisine Preferences (new, replaces skill level)

**Title:** "What cuisines do you love?"
**Subtitle:** "Pick all that apply — we'll surface more of what you're into"
**Input:** Multi-select chips

Options:
- Italian
- Asian
- Mexican
- Mediterranean
- American comfort
- Indian
- Middle Eastern
- French
- Japanese
- All of the above

Selecting "All of the above" deselects all individual cuisine chips and stores `["all"]`. Selecting any individual chip deselects "All of the above."

**Stored as:** `cuisine_prefs` (JSON string array) — new field, nullable

## Data Schema

Create migration file `apps/worker/migrations/0005_onboarding_prefs.sql`:

```sql
ALTER TABLE profiles ADD COLUMN cooking_for TEXT;
ALTER TABLE profiles ADD COLUMN cuisine_prefs TEXT;
```

Apply to prod after deploying the worker:
```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --remote
```

Both columns are nullable. Existing users with no onboarding data will have `NULL` for both fields — the app must treat `NULL` as "no preference" and fall back to generic AI picks (same as skip behavior).

Note: `skill_level` and `meal_type_prefs` columns remain in D1 but are no longer written by onboarding. No data is lost.

## Skip Behavior

If the user clicks "Skip" at any screen, `onSkip` is called immediately. No `PATCH /profile` request is made. The user gets generic AI picks (current behavior). All new preference fields remain `NULL` in the database. This is the same as existing skip behavior — no change needed to `handleOnboardingSkip` in `App.jsx`.

## Component Changes

### `OnboardingFlow.jsx`
- Replace `MEAL_TYPES` constant and screen 0 with updated dietary chip screen (add Vegan, mutual exclusivity for "None / all good")
- Replace screen 1 (dietary) with new cooking_for card screen
- Replace screen 2 (skill level) with new cuisine chip screen (mutual exclusivity for "All of the above")
- Update `onComplete` payload: `{ dietaryPrefs, cookingFor, cuisinePrefs }` — remove `mealTypePrefs` and `skillLevel`
- State variables: replace `mealTypes` → keep `dietary`, replace `skill` with `cookingFor` (string) and `cuisinePrefs` (array)

### `App.jsx` — `handleOnboardingComplete`
Current guard (line ~1533):
```js
if (accessToken && (prefs.mealTypePrefs.length || prefs.dietaryPrefs.length || prefs.skillLevel))
```
Update to:
```js
if (accessToken && (prefs.dietaryPrefs.length || prefs.cookingFor || prefs.cuisinePrefs.length))
```
Update the PATCH body from `{ mealTypePrefs, dietaryPrefs, skillLevel }` to `{ dietaryPrefs, cookingFor, cuisinePrefs }`.

### Worker — `PATCH /profile`
Accept and persist two new fields from the request body:

- `body.cookingFor` — plain string, store directly as `cooking_for` in D1 (no JSON encoding)
- `body.cuisinePrefs` — string array, store as `JSON.stringify(body.cuisinePrefs)` in the `cuisine_prefs` column (same pattern as `dietary_prefs`)

Both fields are optional. If absent, do not include them in the dynamic `UPDATE` statement. Add them to the body type definition alongside the existing fields.

### Worker — `GET /profile`
Currently returns only `displayName`, `email`, `createdAt`, and `recipeCount`. Must be extended to also return `cookingFor` and `cuisinePrefs`:

- In `getOrCreateProfile`: read `cooking_for` and `cuisine_prefs` columns from the D1 row and map them into the returned object. Parse `cuisine_prefs` with `JSON.parse` (it is stored as a JSON string); default to `[]` if null.
- Extend the `UserProfile` type to include `cookingFor: string | null` and `cuisinePrefs: string[]`.
- In `handleGetProfile`: include `cookingFor` and `cuisinePrefs` in the JSON response.

### Worker — `GET /public/ai-picks`
Query param format (already accepted by the handler):
```
GET /public/ai-picks?diet=vegetarian,gluten-free&cuisine=italian,asian&cooking_for=family
```

- Worker handler: parse `cooking_for` and `cuisine` query params alongside the existing `diet`, `mealTypes`, `skill` params
- KV cache key: bump from `ai-picks:v2:...` to `ai-picks:v3:{diet}:{cuisine}:{cookingFor}` to avoid serving stale cached responses generated without these signals
- Re-seed dev KV entry if needed: `ai-picks:v3:all:all:any`

`PublicLanding.jsx` calls `/public/ai-picks` without user prefs (no change needed — logged-out users get generic picks).

### `FriendSections.jsx` — add AI picks section (new work)
`FriendSections.jsx` currently does **not** call `/public/ai-picks`. This is entirely new work, not a modification of an existing call.

Current props: `{ accessToken }`. Add two new props: `cookingFor` (string | null) and `cuisinePrefs` (string[]).

`App.jsx` already fetches `GET /profile` — pass `profile.cookingFor` and `profile.cuisinePrefs` down as props when rendering `<FriendSections>`. Do not add a second `GET /profile` call inside `FriendSections`.

Inside `FriendSections`:
- Add state: `const [aiPicks, setAiPicks] = useState([])`
- On mount, fetch `/public/ai-picks` with `cuisine` and `cooking_for` query params derived from props (omit if null/empty)
- Render AI picks as the "Trending in health & nutrition" section (the section already exists in the memory doc as a planned always-visible section with hashtag + reason UI)

### Gemini prompt update
Append a user context line to the existing prompt template:

```
User context: Cooking for: {cookingFor}. Preferred cuisines: {cuisineList}.
```

Example: `"User context: Cooking for: family. Preferred cuisines: Italian, Asian."`

If `cookingFor` or `cuisinePrefs` are absent/null, omit those parts of the context line gracefully.

## Out of Scope

- Skill level is removed from onboarding but the column is not dropped
- Meal type prefs are removed from onboarding but the column is not dropped
- No changes to `WelcomeModal`
- No changes to friend discovery or invite flow
- No changes to `PublicLanding.jsx` (logged-out AI picks remain unaffected)
