# Discovery Feeds & Landing Page — Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Scope:** Public landing page, logged-in home sections, onboarding, cook mode tracking

---

## Overview

Replace the current logged-out experience (flat static recipe list from `recipes.json`) with a structured discovery landing page. Add personalized sections to the logged-in home feed. Introduce a 3-screen onboarding flow for new users. Start tracking cook mode usage for future activity feeds.

**Primary goal:** Get a new visitor to save a recipe or invite a friend within 60 seconds.

---

## Structure

### Page layout (both views)

**C — Hybrid:** Compact header (tagline + CTA, ~56px), followed immediately by content sections. No full marketing hero — content leads.

---

## Phase 1: Public Landing Page (logged-out)

### Structure

```
[Compact header] — sticky
  "ReciFind 🍳 · Your group chat for cooking"  [Join free →]

[Section 1] 🔥 Trending from the community
[Section 2] ⭐ Editor's Pick
[Section 3] ✨ AI Picks — powered by Gemini
[Section 4] 🍳 Cook with Friends
```

### Section details

#### 1. Compact header
- Logo + tagline left, "Join free" button right
- Sticky at top, ~56px tall
- Tapping "Join free" opens existing auth dialog

#### 2. 🔥 Trending from the community
- **Source:** `GET /public/discover` — recipes whose `source_url` domain is `tiktok.com` or `instagram.com`, ordered by `created_at DESC`, max 10
- **Rendering:** Horizontal scroll shelf. oEmbed iframe first, B-style card fallback if blocked
- **oEmbed fallback chain:**
  1. Fetch oEmbed HTML from TikTok/IG API → render as iframe
  2. If iframe blocked → B-style card with platform badge (TikTok / Instagram logo)
  3. If no social URL → recipe appears in Editor's Pick instead
- **CTA:** "Save to ReciFind" button on each card → triggers auth dialog

#### 3. ⭐ Editor's Pick
- **Source:** `GET /public/editors-pick` — 11 hardcoded recipe IDs pulled from D1
- **Rendering:** Vertical list, 3 visible + "Show 8 more" expand
- **Card style:** B-style (thumbnail, title, meal type chip, duration). "Save" → auth dialog

The 11 Editor's Pick recipes (matching existing `STARTER_RECIPE_TITLES` in App.jsx):
- Beef and Guinness Stew, Loco Moco, Galbi Tang (Dinner)
- Watermelon Salad, Broccoli Cheddar Soup, Honey Lime Chicken Bowl (Lunch)
- Blueberry Cream Pancake, Banana Bread, Swiss Croissant Bake (Breakfast)
- Pear Puff Pastry, Berry Yogurt Bake (Dessert)

#### 4. ✨ AI Picks — powered by Gemini
- **Source:** `GET /public/ai-picks` — Worker calls Gemini: "What are 3 trending health/nutrition topics this week?" → matches topics to recipes in D1 by ingredients/title/meal type → returns `[{topic, hashtag, recipe}]`
- **Cache:** KV, 7-day TTL. Cache key: `ai-picks:public` (no personalisation on public page)
- **Rendering:** Horizontal shelf, teal accent, Gemini badge

#### 5. 🍳 Cook with Friends
- **No API call** — static section
- **Social proof teaser:** 2 realistic activity items (e.g. "Elisa saved your Miso Ramen", "Sarah shared Beef Stew with you") — illustrative, not real data
- **CTAs:** "Join free" (primary) + "Invite a friend" (secondary, opens auth then invite flow)

### New worker endpoints (Phase 1)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /public/discover` | None | Top social-source recipes for trending shelf |
| `GET /public/editors-pick` | None | 11 hardcoded seeded recipe IDs from D1 |
| `GET /public/ai-picks` | None | Gemini-powered trending topics + matched recipes, KV-cached 7d |

All three are fully public — no JWT, no DEV_API_KEY required.

---

## Phase 2: Logged-in Home Sections

### Empty state (new user)

#### Welcome modal (B — full-screen, dismissible)
- **Trigger:** First load after sign-up. Check `localStorage` for `onboarding_seen` flag; if not set, show modal.
- **With inviter:** If `pending_accept_friend` or `pending_invite_token` was processed → "👋 [Inviter] invited you!" + 3 of inviter's public recipes as mini cards
- **Without inviter:** "👋 Welcome to ReciFind!" + 3 Editor's Pick recipes
- **CTAs:** "Add your first recipe →" (primary) + "Explore" (dismiss)
- **On dismiss:** Set `localStorage.onboarding_seen = true`, proceed to onboarding flow

#### Onboarding flow (3 screens, each skippable)

```
[Screen 1] What do you love to cook?
  Chips: Breakfast · Lunch · Dinner · Dessert · Drinks · Meal prep
  (multi-select)

[Screen 2] Any dietary preferences?
  Chips: Vegetarian · Meat lover · Gluten-free · Dairy-free · High protein · Pescatarian · None / all good
  (multi-select)

[Screen 3] How confident are you in the kitchen?
  Radio: Beginner / Home cook / Confident
```

- Progress indicator (3 dots) at top of each screen
- "Skip →" on every screen — jumps straight to home feed, preferences left null
- On completion → `PATCH /profile` with `meal_type_prefs`, `dietary_prefs`, `skill_level`

**DB change:** Add 3 columns to `profiles` table:
```sql
ALTER TABLE profiles ADD COLUMN meal_type_prefs TEXT;   -- JSON array
ALTER TABLE profiles ADD COLUMN dietary_prefs TEXT;     -- JSON array
ALTER TABLE profiles ADD COLUMN skill_level TEXT;       -- 'beginner' | 'home_cook' | 'confident'
```

**After onboarding:** `GET /public/ai-picks` called with user prefs as query params:
`?meal_types=dinner,breakfast&diet=high-protein&skill=beginner`
KV cache key includes a hash of prefs so different preference sets get independently cached results.

### Non-empty state (has recipes, returning user)

```
[Section 1] 📣 Friend activity feed        (if has friends)
[Section 2] 🔖 Recently saved by friends   (if friends have saved recipes)
[Section 3] 📤 Recently shared by friends  (if friends have shared recipes)
[Section 4] ⭐ Editor's Pick               (always, checkmark if already saved)
[Section 5] ✨ AI Picks — Gemini           (always, personalised if prefs set)
[Section 6] 🍳 Cook with Friends           (always; real invite link, no fake data)
```

#### Conditional display rules
- **No friends** → skip sections 1–3, show Cook with Friends CTA prominently as nudge
- **Has friends, no activity** → show Cook with Friends first ("Get cooking together!")
- **Invited user, first load** → welcome modal appears before any sections
- **Recipe already saved (Editor's Pick)** → show ✓ checkmark instead of Save button

#### Section details

**1. 📣 Friend activity feed**
- `GET /friends/activity` — queries `notifications` table for the logged-in user, last 10 events
- Event types: `friend_saved_recipe`, `friend_shared_recipe`, `friend_cooked_recipe` (future)
- Display: avatar initial + name + action text + time-ago. Tapping opens the recipe.

**2. 🔖 Recently saved by friends**
- `GET /friends/recently-saved` — for each friend, `SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC LIMIT 2`. Up to 8 recipes total, deduped, sorted by recency.
- Horizontal scroll shelf, B-style cards with "by [name]" label

**3. 📤 Recently shared by friends**
- `GET /friends/recently-shared` — same as above but `AND shared_with_friends = 1`
- Can collapse with "Recently saved" into one "From friends" shelf if both are sparse (< 3 recipes each)

**4–6:** Reuse Phase 1 endpoints + Cook with Friends section (no fake social proof; real invite link generation from existing flow).

### New worker endpoints (Phase 2)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /friends/activity` | Required | Last 10 notifications for logged-in user |
| `GET /friends/recently-saved` | Required | Recent recipes from each friend by created_at |
| `GET /friends/recently-shared` | Required | Same, filtered to shared_with_friends=1 |
| `PATCH /profile` | Required | Already exists — add meal_type_prefs, dietary_prefs, skill_level fields |

---

## Phase 3: Cook Mode Tracking

### Goal
Seed the `cook_events` table so future "Recently Cooked by friends" shelf has real data from day one.

### DB migration
```sql
CREATE TABLE cook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  cooked_at TEXT NOT NULL
);
CREATE INDEX idx_cook_events_user ON cook_events(user_id);
```

No deduplication — multiple cook sessions for the same recipe are valid signal.

### New endpoint
`POST /recipes/:id/cook` — auth required. Inserts one row into `cook_events`. Also writes a `friend_cooked_recipe` notification to each friend of the user.

### Frontend change
In `toggleCookMode` (App.jsx:2889), when turning cook mode ON:
```js
// Fire-and-forget — does not block cook mode UI
callRecipesApi(`/recipes/${activeRecipe.id}/cook`, { method: 'POST' }, accessToken);
```

### What this enables immediately
- Friends see "James cooked Honey Lime Chicken 🍳" in their activity feed (Phase 2, section 1)
- `friend_cooked_recipe` notification type is already supported by the `notifications` table

### Future (Phase 4+)
- "Recently Cooked by friends" shelf on home feed
- "Your most cooked recipes" personal stats
- Trending by cook count (not just saves)
- "X friends cooked this" social proof on recipe cards

---

## What's NOT changing

- Logged-in recipe list, search, filters — unchanged
- Existing friend invite, accept, open-invite flows — unchanged
- Auth dialog — unchanged
- `recipes.json` bundled data — kept for dev/fallback, but no longer shown to logged-out users

---

## Implementation order

1. **Phase 1** — Public landing page (highest acquisition impact, independently shippable)
2. **Phase 2** — Logged-in home sections + onboarding
3. **Phase 3** — Cook mode tracking (small, can ship alongside either phase)
