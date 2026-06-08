# First-Session Activation (0 → 1 recipe) — Design

Date: 2026-06-08
Status: Design approved, pending spec review

## Problem

Activation (a user going from 0 to 1 saved recipe) has been low overall and 0 on
recent days. Analysis of the nudge-email cohort (the users who did NOT save in
their first 24h, n=50 real users) found:

- The drop-off is **before any save**: 46 of 50 nudged users have never saved a
  single recipe, ever.
- The cohort is overwhelmingly cold-start: 88% arrived with no inviter, 86% have
  no friends. Even the warm subset failed (0 of 6 users with an inviter activated).
- The nudge email itself converts ~4% (2 clean conversions within 48h of 50 sent).
- `last_sign_in_at` is unreliable as a "came back" signal (Supabase only updates it
  on fresh re-auth, not session resume), and there is no app-open/view event log, so
  the only trustworthy post-signup behavior we can measure is "did they save a recipe."

Root finding in the product: onboarding collects three preference screens (dietary,
who you cook for, favorite cuisines) and then drops the user on the **home feed**
without ever once offering a recipe to save. The lowest-friction save action
(one-tap save of a curated recipe) lives on the Discover and Recipes tabs, one tab
away from where new users land. The final onboarding screen ("You're all set") is a
passive checklist with decorative checkmarks and a single "Get started" button: the
most engaged moment in the funnel asks the user to do nothing.

## Goal

Get a brand-new user to save their first recipe **inside their first session**.

- Primary lever (A): the first session. Engineer a guaranteed-easy first save into
  onboarding, then land the user on saveable content.
- Secondary lever (B): the comeback nudge. A small change so a returning click lands
  on saveable content too.

## Non-goals / out of scope

- Hard gating (blocking onboarding completion until a save). Considered and rejected:
  a hard wall risks lowering signup→activation by making people quit at the wall.
- Pushing Path 2 (import-your-own) inside onboarding. Per owner decision, the
  "add your own from Instagram/TikTok" prompt is NOT shown in the onboarding flow.
  Import stays reachable via existing entry points (the "+" / Add Recipe surfaces and
  the home checklist), just not forced into the first-session moment.
- Changing nudge-email timing or copy beyond the CTA destination.

Note: an earlier draft fully replaced the "You're all set" checklist screen, which
would have dropped the invite/share prompts from onboarding. The chosen hybrid keeps
the checklist (and therefore the invite/share steps) and instead makes step 1 active,
so that tradeoff no longer applies.

## Design

### 1. Make step 1 of the "You're all set" checklist screen an active tap-to-save carousel

Keep `ChecklistScreen` (apps/recipe-ui/src/components/OnboardingDrawer.jsx:438-481)
and its three-step framing ("You're all set" / "Three quick wins..."). Onboarding
screen order is unchanged: Welcome → Dietary → Cooking-for → Cuisines → Checklist.
The checklist screen becomes interactive:

- **Step 1 — "Save your first recipe":** rendered as an inline **horizontal carousel**
  of curated recipe cards, reusing the existing `RecipeShelf` component
  (apps/recipe-ui/src/components/RecipeShelf.jsx, the same scroll-snap shelf
  DiscoverPage uses) for visual consistency. Cards are kept compact so steps 2/3 and
  the button stay above the fold on small phones inside the 90dvh sheet.
- Tapping a card calls the existing `handleSavePublicRecipe(recipe)`
  (apps/recipe-ui/src/App.jsx:2592), the same one-tap save used by Discover,
  FriendSections, and recipe detail. No new save plumbing. A saved card shows a saved
  state (check + "Saved").
- On the first save, **step 1's circle flips from the decorative grey check to a real
  filled "completed" check**, so the checklist reflects genuine progress rather than a
  fake pre-checked state.
- **Steps 2 ("Invite a friend") and 3 ("Share a recipe with a friend")** stay as the
  current passive list items. They remain visible in onboarding (this is why the
  hybrid was chosen over a full replace).
- **Bottom button adapts (option b):**
  - 0 saved: a low-emphasis **"Skip for now"** text link (still lets the user out, but
    de-emphasized so the carousel is the focus).
  - ≥1 saved: becomes the primary **"Get started"** pill.

This is option C (hybrid encouragement): strongly encourage a save, soft skip, no hard
gate. Either exit path lands the user on the Discover tab (see section 3).

### 2. Content source for the carousel

- v1: reuse the existing curated set (`/public/editors-pick` and/or
  `/public/trending-recipes`), recipes that already carry real images and full
  ingredients/steps, so a saved card is immediately usable.
- Fast-follow: rank/filter the set by the cuisines the user just selected on the
  Cuisines screen. **Dependency:** this requires recipes to carry cuisine metadata.
  To verify during planning. If absent, v1 ships unpersonalized and cuisine matching
  is a separate follow-up.

### 3. Land first-session users on the Discover tab

Change the three onboarding exit handlers in apps/recipe-ui/src/App.jsx to set
`currentView` to `'discover'` instead of `'home'`:

- `handleOnboardingComplete` (App.jsx:2836)
- `handleOnboardingClose` (App.jsx:2847)
- `handleOnboardingSkipForever` (App.jsx:2857)

`'discover'` is already a valid view (App.jsx:1371). Because these handlers fire only
from onboarding (shown only to new users), this is naturally scoped to the first
session: returning users never hit them and keep landing on `'home'` (the friend
feed / retention surface). Discover provides the saveable-content backstop if the
user skips the onboarding save.

### 4. Secondary lever (B): nudge-email CTA

Point the nudge email's primary CTA at the Discover tab (or a single one-tap-save
curated recipe) instead of the generic home, so a returning click lands on saveable
content. Same principle as the first session. No other nudge changes in v1.

### 5. Measurement

So we can distinguish real activation from hollow activation:

- Tag every first save with its source via the existing `trackEvent`:
  `onboarding_save`, `discover_save`, or `import`.
- Headline metric: first-session activation rate (saved ≥1 before leaving).
- Compare D1/D7 retention of curated-save activators vs import activators. If
  curated savers do not return, Path 1 is vanity and we lean harder on Path 2. This
  directly tests the hollow-activation risk.

## Affected files

- apps/recipe-ui/src/components/OnboardingDrawer.jsx — make `ChecklistScreen` step 1
  an inline `RecipeShelf` carousel wired to the save handler; flip step-1 check to a
  real completed state on save; adapt the bottom button per option (b). Keep steps
  2/3 and `CHECKLIST_STEPS` framing.
- apps/recipe-ui/src/App.jsx — pass curated recipes + `handleSavePublicRecipe` into
  the drawer; change the three onboarding handlers to land on `'discover'`.
- apps/recipe-ui/src/components/RecipeShelf.jsx — reused as-is (verify props fit).
- Worker / nudge email (apps/worker/src/index.ts) — change nudge CTA destination.
- Analytics: add `first_save_source` tagging where saves originate.

## Open questions / dependencies

1. Do recipes carry cuisine metadata for the fast-follow personalization? (verify)
2. Which curated endpoint to feed the carousel: editors-pick, trending, or a blend?
3. Exact "Saved" card affordance in `RecipeShelf` (may need a small prop/extension).

## Copy (no em dashes, per house style)

- Screen H1 (unchanged): "You're all set"
- Screen tagline (unchanged): "Three quick wins to get the most out of ReciFriend."
- Step 1 label (unchanged): "Save your first recipe"
- Step 1 carousel prompt (optional helper): "Tap one to add it to your collection."
- Bottom button before any save: "Skip for now"
- Bottom button after ≥1 save: "Get started"
