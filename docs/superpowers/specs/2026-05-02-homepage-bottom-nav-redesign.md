# Homepage Redesign + Bottom App Bar

**Date:** 2026-05-02
**Status:** Spec — design approved, implementation plan pending
**Pre-redesign revert anchor:** `91b7061` on `main` (TestFlight Build 6 era)

## Why we're doing this

The current logged-in home is essentially the public landing with a friend strip stacked on top. Editor's Picks and "Trending in Health & Nutrition" appear on **both** pages, and inside the logged-in home a friend saving a recipe is shown in *both* "Friend Activity" *and* "Recently Saved by Friends" — three friend sections that overlap each other.

Goals (in priority order):

1. **Cleaner** — fewer competing surfaces on Home.
2. **Less redundant content** — kill the public/private duplication.
3. **Keep content fresh** — discovery content lives on its own surface where users opt in to browsing it.
4. **Good first-time guidance** — a brand-new user with no friends gets clear "do these 3 things" direction.
5. **Emphasize the social aspect** — Home reads as "your kitchen and your people," not "another recipe site."

## Direction

**Option A** from brainstorm: Home becomes a social-first surface. Editor's Picks and AI/Health picks move off Home onto a new **Discover** tab. A new **bottom app bar** anchors the app, with Home / Recipes / **+** FAB / Friends / Discover. Profile is reached via the user's avatar in the top-right of the header on every tab.

The hamburger drawer is removed entirely. Theme, settings, and sign-out move to Profile. The meal-type filter (currently buried in the hamburger drawer when on Recipes) moves inline onto the Recipes page itself.

## Navigation system

### Bottom app bar

Five slots, in order:

1. **Home** — house icon. Default tab on app open.
2. **Recipes** — list-lines icon. User's saved recipe collection.
3. **+** (Add Recipe) — center FAB, see geometry below. Same dialog as the existing top-right "+ Add" button. Visible on every tab.
4. **Friends** — two-people icon. Tap → opens the Friends slide-up sheet (see Friends section). Pending-request count shown as a red badge.
5. **Discover** — compass / explore icon. New page, see Discover section.

The bar is fixed to the bottom edge with `padding-bottom: env(safe-area-inset-bottom)` so it respects the iOS home indicator. It hides when the soft keyboard is open.

The active tab uses violet (`primary.main`); inactive tabs use a muted neutral. **Profile is not a tab** — when the user is on Profile, no bottom-nav item is active. (Profile is a "modal-like" surface reached via the header avatar, not a peer destination.)

### Header

Per-tab top bar:

- **Left:** "ReciFriend" wordmark in Fraunces (existing).
- **Right:** circular avatar (32px, primary-color background, white initial, white 2px ring) → tap opens Profile. Replaces the current "+ Add" button (which moves to the bottom FAB).

The previous hamburger menu icon is removed. The drawer it opened is removed.

### Add Recipe FAB — geometry

- 56 × 56 px circle.
- Violet gradient `linear-gradient(180deg, #8b5cf6, #7c3aed)`.
- White 4px ring (`border: 4px solid #fff`) so the FAB visually pops off the bar.
- Drop shadow `0 8px 18px rgba(124,58,237,.45), 0 2px 6px rgba(0,0,0,.12)`.
- White "+" glyph, 30px.
- Positioned `position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%)` on the app shell so it overlaps the nav: with a 64px nav height, the FAB top edge sits 28px **above** the nav top edge and the bottom edge sits 28px below it.
- Tap → opens the existing Add Recipe dialog (no new logic).

### Friends slide-up sheet

Replaces the current right-side `Drawer`. A full-page sheet that animates up from the bottom edge:

- `top: ~8% of viewport`, slides up from below.
- Rounded top corners (24px).
- Drag-grabber bar at the top (38 × 4 px, `#d8d8de`).
- Header row: title "Friends" left, circular X button right.
- Tab row inside the sheet: "Friends · *N*" / "+ Add" — the existing two-screen flow (list + Add Friends) preserved as in-sheet tabs.
- Dismiss: X button, swipe-down on grabber, or tap outside the sheet.
- Active bottom-nav tab stays on whatever the user came from (typically Home) — the sheet is a modal overlay, not a destination.

The Friends tab opens the sheet to the **list view** (current default), regardless of where the user last left it.

## Home (logged-in)

### Active user (≥1 friend or any activity)

In top-down order:

1. **Greeting** (Fraunces serif, ~22px, semibold) — first name only, no emoji. *e.g. "Elisa"*
2. **Subgreeting** (Fraunces italic, ~13px, muted). Dynamic — pulls from latest friend activity when available, falls back to time-of-day. *e.g. "Henny just shared a recipe with you"*. **No emoji.**
3. **StatsTiles** — 2 tiles (Recipes count + add pill, Friends count + invite pill). Existing component, unchanged.
4. **From your friends** — unified feed merging the previously-separate "Friend Activity," "Recently Saved by Friends," and "Recently Shared by Friends" sections. Each row is `Avatar · Name + verb + RecipeName · timestamp · thumbnail`. Verbs from the existing `VERB_MAP` (cooked / saved / shared). Friend-request items remain inline (existing behavior).
5. **Cook with Friends** — the existing `CookWithFriends` + `CwfTicker` module from `FriendSections.jsx`, **unchanged**. Pinned at the bottom of Home, above the bottom nav (with safe-area inset). Same gradient card + cycling ticker + "Invite Friends" outlined button.

Sections currently on Home that are **removed**:

- Editor's Picks (moves to Discover).
- Trending in Health & Nutrition (moves to Discover).
- Suggestions / People-you-may-know — *kept*, between "From your friends" and Cook with Friends. (The existing `SuggestionsShelf` component, unchanged.)
- "Recently Saved by Friends" / "Recently Shared by Friends" — collapsed into the unified "From your friends" feed.

### New user (0 friends, 0 activity)

In top-down order:

1. **Greeting** — first name only. **No "Welcome." No emoji.** *e.g. "Sarah"*
2. **Subgreeting** — *"let's get your kitchen set up"* — no emoji.
3. **Onboarding checklist** — a 3-step card:
   - ① **Add your first recipe**
   - ② **Invite a friend**
   - ③ **Save a friend's recipe**
   - Each step shows a circular checkmark. Completed steps render with a green check + line-through. A progress bar at the bottom of the card fills 0 → 100%. A header counter shows "*N* of 3" in violet.
   - The card disappears permanently once all 3 steps are complete (no collapsed remnant).
   - Completion source-of-truth (per step):
     - ① — user has ≥1 recipe in their collection.
     - ② — user has sent ≥1 friend invite (existing `friend_request` send event).
     - ③ — user has saved ≥1 recipe authored by another user.
4. **StatsTiles** — same component, will likely show "1 RECIPE" and "0 FRIENDS" for a brand-new user.
5. **"From your friends"** is **hidden entirely** when the user has 0 friends. The empty section does not render. It reappears as soon as activity exists.
6. **Cook with Friends** — same module as active state.

## Recipes page

The existing `RecipesPage.jsx` flow is preserved. One change:

- **Meal-type filter chips move inline** onto the page. They render as a horizontal scrolling chip row directly below the search bar (always visible). Existing data: `availableMealTypes`, `selectedMealType`, `MEAL_TYPE_LABELS`, `MEAL_TYPE_ICONS`, `handleMealTypeSelect` — all reused unchanged.
- The chip row gets the same fade-mask styling currently in the drawer's chip row.
- Tapping a chip filters the list inline (no drawer dismiss timeout needed since there's no drawer).
- Favorites toggle (currently in hamburger drawer) is preserved — moves to a heart icon in the Recipes page header (next to the search bar).

The currently-misnamed `mobileFilterDrawerOpen` state and the entire left `Drawer` component are deleted.

## Discover page (new)

Reachable from the Discover bottom-nav tab. Page header in Fraunces ("Discover"). Sections in this order:

1. **Trending Now** — `RecipeShelf` of curated community recipes. Uses existing `GET /public/trending-recipes`.
2. **Watch & Cook** — TikTok / Instagram reels via existing `DiscoverRecipes` component, fed by `GET /public/discover` (with the same trending-id and YouTube-exclusion filtering currently in `PublicLanding.jsx`).
3. **Editor's Picks** — `RecipeListCard` list with "+ N more picks" expand. Uses existing `GET /public/editors-pick`. Identical to current logged-in Home rendering — just relocated.
4. **Trending in Health & Nutrition** — `TrendingHealthCarouselB` with hashtag chips. Uses existing `GET /public/ai-picks?...` (passing user prefs as today).

No new endpoints or data. The existing four data sources are reused; only the location of where they render changes.

## Profile page (shell)

A new full-page surface. **Detail content beyond what's listed here is TBD and will be designed in a separate brainstorming session.**

In top-down order:

1. **Header chevron + "Profile" title** — small back-style header.
2. **Profile hero** — large 72px circular avatar (primary-color background, white initial), small pencil glyph in the bottom-right corner of the avatar for tap-to-upload, name in bold with an inline edit pencil, email in muted text below. Tapping the pencil on the avatar opens an image picker (TBD scope — capture only the affordance for now, hook up later). Tapping the name pencil reuses the existing inline-name-edit flow from the hamburger drawer.
3. **Settings section label** ("SETTINGS") — small uppercase muted.
4. **Theme** — the existing iOS-style pill segmented control (System / Light / Dark) lifted from the hamburger drawer. Same `ToggleButtonGroup` + same `themePref` state.
5. **Cooking preferences** — line-icon settings cog → opens the existing `OnboardingFlow` (or its preferences view) for re-editing meal/diet/skill prefs. Right chevron.
6. **Notifications** — line-icon bell → toggles or routes to the notification soft-prompt / settings. Currently surfaces `On` / `Off` based on existing notification state. Right value.
7. **More** section label.
8. **Send feedback** — line-icon message bubble → opens the existing feedback widget. Right chevron.
9. **About** — line-icon info circle → simple page with version + links. Right chevron.
10. **Sign out** — line-icon sign-out arrow, in red. Reuses existing `handleLogout`.

**Iconography:** all icons are line-style inline SVGs matching the existing hamburger drawer style — `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, 18-22px. **No emoji anywhere on Profile.**

The hamburger drawer (currently `mobileFilterDrawerOpen` + the entire left `Drawer`) is fully removed once Profile owns: theme, friends-from-drawer (now bottom-tab), invite-a-friend (now Friends tab "+ Add" sub-tab), favorites toggle (moves to Recipes header), and logout.

## Public landing — trimmed

Today's `PublicLanding.jsx` shows: "Save, cook, share" carousel + Trending Now + Discover Videos + Editor's Picks + Trending in Health & Nutrition + floating "Join Free" FAB.

After this redesign, public landing keeps:

- "Save, cook, share" 3-card carousel (unchanged).
- **Trending Now** (`RecipeShelf` from `/public/trending-recipes`).
- **Watch & Cook** (`DiscoverRecipes` from `/public/discover`).
- "Join Free" floating FAB.

Removed from public landing (these now live only on the logged-in Discover tab):

- **Editor's Picks**
- **Trending in Health & Nutrition**

Rationale: Editor's Picks and Trending Health are the two sections that previously appeared on *both* public and logged-in. Removing them from public eliminates the duplication and gives logged-in members exclusive access — a small but real "you got something for joining" signal. Public landing remains a focused taste-of-the-app for conversion.

## What is NOT in scope

- Profile page **content beyond the shell** (full preferences UI, account-management actions, profile-pic upload pipeline, etc.) — separate brainstorm.
- A weekly-rotating "This Week on ReciFriend" curation strip — explored as Option C in brainstorm; deferred until Discover is shipped.
- Google Contacts import or any new social-graph data sources.
- Changes to the friend-request / invite *email* flow — only the in-app UI moves.
- New analytics/instrumentation beyond what already exists. (User noted Google Analytics is the source of truth for engagement; instrumentation can be a follow-on.)

## Files affected (preview — final list will be in the implementation plan)

Frontend:

- `apps/recipe-ui/src/App.jsx` — remove hamburger `Drawer`, remove `mobileFilterDrawerOpen` plumbing, add bottom app bar component, add center FAB component, add new `currentView` values for `'discover'` and `'profile'`, route the avatar tap-target to `'profile'`. Move favorites-toggle into Recipes header. Move theme controls reference into Profile.
- `apps/recipe-ui/src/components/FriendSections.jsx` — collapse the three friend shelves into one unified "From your friends" feed; remove Editor's Picks and Trending Health rendering (move to Discover); keep Cook with Friends pinned at the bottom of Home.
- `apps/recipe-ui/src/components/PublicLanding.jsx` — remove Editor's Picks and Trending Health sections.
- `apps/recipe-ui/src/RecipesPage.jsx` — add inline meal-type chip row under the search; add favorites toggle to header.
- **New** `apps/recipe-ui/src/components/BottomAppBar.jsx` — the 5-slot nav with center FAB.
- **New** `apps/recipe-ui/src/components/DiscoverPage.jsx` — Trending Now / Watch & Cook / Editor's Picks / Trending Health.
- **New** `apps/recipe-ui/src/components/ProfilePage.jsx` — the shell described above.
- **New** `apps/recipe-ui/src/components/FriendsSheet.jsx` — full-page slide-up replacing the current friends `Dialog`.
- **New** `apps/recipe-ui/src/components/OnboardingChecklist.jsx` — 3-step checklist card for new-user Home.

Worker / data:

- No new endpoints. All four discovery endpoints (`/public/trending-recipes`, `/public/discover`, `/public/editors-pick`, `/public/ai-picks`) and friend feed endpoints (`/friends/activity`, `/friends/recently-saved`, `/friends/recently-shared`) are reused as-is.
- Onboarding-checklist completion is computed entirely from existing client-side data: recipe count, sent-invite events from `/friends/activity` or a small client-tracked flag, and "saved a friend's recipe" derivable from `recipe.ownerId !== currentUserId && favorites.has(recipe.id)`. No DB schema changes.

## Implementation phases (rough — to be refined in the plan)

1. Bottom app bar + center FAB + remove hamburger drawer (largest single touch on `App.jsx`).
2. Profile page shell (lifts theme + sign-out + name-edit out of the drawer).
3. Friends slide-up sheet (replaces the existing right-side drawer).
4. Discover page + relocate Editor's Picks / Trending Health out of Home and PublicLanding.
5. Home redesign — unified "From your friends" feed; new-user onboarding checklist; Cook-with-Friends pinned.
6. Recipes inline meal-type chips + favorites in header.
7. PublicLanding trim.

Each phase is shippable on its own (the app remains usable between phases) — but the bottom app bar (phase 1) and removing the hamburger (which depends on Profile + Friends sheet existing) are tightly coupled, so phases 1–3 likely land together.

## Risks / things to watch

- **Capacitor + iOS safe-area:** the bottom nav must respect `env(safe-area-inset-bottom)` and hide on keyboard open. The existing share-extension handoff drops users into specific views; they need to land on the correct tab.
- **Deeplinks:** existing friend-accept Universal Link and share-extension entry points currently set `currentView`; they need to be updated to the new tab values. Verify by walking the deeplink test harness after phase 1.
- **Hamburger removal touches a lot of state:** `mobileFilterDrawerOpen`, `isDrawerEditingName`, `editNameValue`, `themePref` setter wiring — none should be deleted until Profile is hosting them.
- **Onboarding checklist visibility flicker:** completion state must be computed before render, otherwise a returning user sees the checklist briefly. Cache "all 3 done" in `localStorage` once detected.

## Decisions log (so the plan inherits the "why")

| Decision | Why |
|---|---|
| Option A over B/C | A is the only option that genuinely makes Home distinct from public — both B and C still mix discovery onto Home, which is the original redundancy complaint. |
| Profile reached via header avatar, not a 5th nav tab | Bottom nav already has 5 slots once we add the FAB. Avatar-tap is a recognized iOS pattern (Twitter, Threads). |
| Onboarding checklist over hero invite or fallback discovery | Checklist directly addresses Goal #4 (first-time guidance) *and* drives social activation (step 2 = invite a friend) without polluting Home with discovery content. |
| "From your friends" hidden when 0 friends | Empty-state strip would be a dead pixel. Checklist's step 2 already tells the user what to do. |
| Friends as full-page slide-up, not right-side drawer | User preference. iOS-native bottom-modal pattern. |
| Reuse production CWF module unchanged | Already designed and approved; pinning at the bottom is a layout change, not a redesign. |
| Editor's Picks + Trending Health removed from public landing | Eliminates the public/private duplication that prompted this redesign in the first place; public stays focused on conversion. |
| Hamburger drawer removed entirely | All its destinations now have first-class homes (Profile owns settings/theme/sign-out; Friends owns friend list + invite; Recipes owns the meal-type filter inline; Recipes/Home own favorites). |
| Add Recipe surfaces as a center FAB on every tab | Adding a recipe is the most-frequent user action; making it tab-independent and visually elevated keeps it always one tap away. |
