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
- Vegan *(new — was missing, distinct from Vegetarian)*
- Gluten-free
- Dairy-free
- High protein
- Pescatarian
- Meat lover
- None / all good

**Stored as:** `dietary_prefs` (string array) — same field as before

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

**Stored as:** `cooking_for` (enum string) — new field

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

**Stored as:** `cuisine_prefs` (string array) — new field

## Data Schema

Two new columns on the user profile:

```sql
ALTER TABLE profiles ADD COLUMN cooking_for TEXT;
ALTER TABLE profiles ADD COLUMN cuisine_prefs TEXT; -- JSON array stored as text
```

The existing `dietary_prefs` and `skill_level` columns remain. `skill_level` is no longer populated by onboarding but can stay in the schema for now.

## How Preferences Are Used

### AI Picks (Gemini — `GET /public/ai-picks`)
The Gemini prompt currently uses `mealTypes`, `diet`, and `skill`. Update to use:
- `dietary_prefs` → filter/exclude incompatible recipes
- `cuisine_prefs` → bias topic suggestions toward preferred cuisines
- `cooking_for` → influence serving size context and complexity (e.g., `family` → kid-friendly, `entertaining` → impressive/shareable)

### Community & Friend Feed
- Recipes tagged with cuisines matching `cuisine_prefs` rank higher in discovery sections
- `cooking_for = family` surfaces kid-friendly or crowd-pleaser tagged recipes more prominently
- Friend activity feed: no mechanical change, but future ranking can factor in `cuisine_prefs` alignment

## Component Changes

### `OnboardingFlow.jsx`
- Replace `MEAL_TYPES` constant and screen 0 with dietary chip screen (updated options)
- Replace screen 1 (dietary) with cooking_for card screen (new)
- Replace screen 2 (skill level) with cuisine chip screen (new)
- Update `onComplete` payload: `{ dietaryPrefs, cookingFor, cuisinePrefs }` (remove `mealTypePrefs`, `skillLevel`)

### `PATCH /profile` (worker)
- Accept `cooking_for` and `cuisine_prefs` in addition to existing fields
- Write new columns to D1

### AI picks prompt (`GET /public/ai-picks` or equivalent)
- Pass `cuisinePrefs` and `cookingFor` into Gemini prompt
- Update prompt template to use these signals

## Out of Scope

- Skill level is removed from onboarding but column is not dropped
- Meal type prefs are removed from onboarding but column is not dropped
- No changes to WelcomeModal
- No changes to friend discovery or invite flow
