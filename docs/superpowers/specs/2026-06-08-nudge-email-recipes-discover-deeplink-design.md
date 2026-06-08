# Nudge Email "Recommended for you" + `/discover` Deep Link — Design

Date: 2026-06-08
Status: Design approved, pending spec review

## Problem / context

The nudge email (sent to users who have not saved a recipe 24h after signup) has a
"Recommended for you" section that currently renders only **2** recipe cards in a
single 2-column row, with 180px-tall thumbnails. The user reviewed a live test email
and wants it richer: more recipes, shorter thumbnails, and a clear "Discover more
recipes" call to action under the cards.

Separately, all email CTAs should open the iOS app if it is installed (Universal
Links). Today the recipe cards already deep-link (they use `shareUrl`,
`/recipes/{id}?user=...`, which is in the AASA), but the "discover" destination is
not: the existing "Save Your First Recipe →" button points at
`https://recifriend.com/?view=discover`, a query-string route that the AASA cannot
match and that the app has no deep-link handler for. There is no `/discover`
deep-link route anywhere.

This work is scoped to the **nudge email** and the **`/discover` deep link**. The
in-app onboarding "You're all set" carousel is unchanged.

## Goal

1. The nudge email "Recommended for you" section shows **6** recipes in a 2-column ×
   3-row grid with thumbnails half their current height.
2. A "Discover more recipes" CTA sits directly below the recipe grid and routes to
   the Discover tab.
3. A real `/discover` route exists end to end: it opens the installed iOS app on the
   Discover tab (Universal Link), and loads the Discover tab on the web when the app
   is not installed. The email's discover CTAs use it.

## Non-goals / out of scope

- The in-app onboarding carousel (it stays as currently shipped).
- True personalization of the recommended recipes beyond the existing
  `getRecommendedRecipes` preference logic (it already weights by the user's prefs;
  we only change the count).
- Email-client swipe/carousel behavior. Email cannot run JavaScript, so the 6 cards
  are a static grid, not swipable. This is inherent and expected.
- Reworking other emails' CTAs. Only the nudge email is in scope. (The recipe cards
  and the "Invite Friends →" CTA already deep-link; no change needed there.)

## Design

### 1. Email "Recommended for you" section (`buildNudgeEmailHtml`, apps/worker/src/index.ts ~4791)

- **Count:** raise the recommended count to 6. `getRecommendedRecipes` (index.ts
  ~4652) currently defaults `limit = 3`; the nudge cron (~1031) and the test endpoint
  (routes/admin.ts ~129) call it without an explicit limit. Change those nudge call
  sites to request 6 (preferred over changing the shared default, so the change is
  scoped to the nudge path). `getRecommendedRecipes` already overfetches `LIMIT 20`
  and filters to email-safe recipes before slicing, so 6 is supported when enough
  image-bearing recipes exist; fewer is gracefully handled.
- **Layout:** the card builder currently maps recipes to `<td width:50%>` cells and
  `.slice(0, 2)` into a single `<tr>`. Change to `.slice(0, 6)` and chunk into rows of
  two, emitting 3 `<tr>` rows (2 cards each). An odd final count renders a trailing
  empty `<td>` so the grid stays aligned.
- **Thumbnail height:** 180px → **90px** (the `<img height="180" ... height:180px>` and
  the emoji-placeholder fallback `height:180px`).
- **Heading:** keep "Recommended for you" (index.ts ~4868) and its existing sub-line
  unchanged.

### 2. "Discover more recipes" CTA (`buildNudgeEmailHtml`)

- A centered button directly below the recipe grid (after the recommended `<table>`,
  ~4876), styled consistently with the existing CTAs (pill, brand purple), label
  **"Discover more recipes"**, href → `https://recifriend.com/discover`.

### 3. The `/discover` deep-link route

- **AASA** (`apps/recipe-ui/public/.well-known/apple-app-site-association`): add
  `/discover` to the associated `paths`/`components`.
- **Deep-link parser** (`apps/shared/deepLink.ts`): add a route mapping the `/discover`
  path (HTTPS Universal Link and the `recifriend://discover` custom scheme) to a new
  `discover` deep-link kind.
- **Dispatcher** (`apps/recipe-ui/src/lib/deepLinkDispatch.js`): add an `onDiscover`
  branch for the new kind.
- **App wiring** (`apps/recipe-ui/src/App.jsx`): pass an `onDiscover` handler that
  calls `setCurrentView('discover')` into the dispatcher.
- **Web path routing** (`apps/recipe-ui/src/App.jsx`): the SPA already reads `?view=`
  on mount; add handling so the `/discover` pathname also selects the Discover tab for
  non-installed users who open the link on the web. Strip/normalize the path the same
  way the recipe-detail deep link is handled.

### 4. CTA href consistency

- Update the existing "Save Your First Recipe →" CTA (index.ts ~4860) from
  `https://recifriend.com/?view=discover` to `https://recifriend.com/discover` so it
  deep-links too. Both discover CTAs then use the canonical path.
- The `?view=` mount effect added earlier stays (harmless backward-compat for any
  already-sent emails that used `/?view=discover`).

## Affected files

- apps/worker/src/index.ts — `buildNudgeEmailHtml` (grid, count, thumbnail, CTA,
  href), nudge cron `getRecommendedRecipes` call site.
- apps/worker/src/routes/admin.ts — test-nudge `getRecommendedRecipes` call site.
- apps/recipe-ui/public/.well-known/apple-app-site-association — add `/discover`.
- apps/shared/deepLink.ts — parse `/discover`.
- apps/recipe-ui/src/lib/deepLinkDispatch.js — `onDiscover` branch.
- apps/recipe-ui/src/App.jsx — `onDiscover` handler + `/discover` web path routing.

## Verification

- Worker unit test (`apps/worker/src/nudge-email.test.ts`, extend existing): asserts
  the email renders up to 6 cards, 90px thumbnails, contains a "Discover more recipes"
  CTA with href `https://recifriend.com/discover`, and that the primary CTA no longer
  uses `/?view=discover`.
- Deep-link parser unit test (`apps/shared/` test): `/discover` HTTPS link and
  `recifriend://discover` both parse to the `discover` kind.
- Manual: send a test nudge to elisa.widjaja@gmail.com and eyeball the grid/CTA.
- Manual (dev iOS, loads dev.recifriend.com live): tapping the email's "Discover more
  recipes" opens the app on the Discover tab.

## Rollout

- AASA + web path routing + deep-link handler ship via **Pages** deploy.
- Email changes ship via **worker** deploy (smoke-test the import/enrich path after,
  per the project rule).

### Open item to resolve in planning

Whether the **production App Store** iOS app picks up the new `/discover` in-app
handler from a web deploy or needs a new build depends on whether that build loads
recifriend.com live or bundled JS. The AASA updates with the Pages deploy regardless.
Verify how the production build loads its web content before assuming the route is
live for App Store users; the dev build (live-loads dev.recifriend.com) gets it
immediately.
