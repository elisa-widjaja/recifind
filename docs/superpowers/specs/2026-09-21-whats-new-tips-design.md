# "What's new" tips sheet: design

Date: 2026-09-21
Status: implemented 2026-09-21 (uncommitted, not deployed)

## Goal

Introduce new features to logged-in users with a one-time "What's new" bottom
sheet. First batch covers three features: community recipe search on Discover,
friends of friends in the friend drawer, and custom tags.

## Decisions (made with the user)

| Question | Decision |
|---|---|
| Presentation | One "What's new" bottom sheet listing all tips, each with a "Try it" button |
| Seen state | Per device, versioned `localStorage` flag. No worker or D1 change |
| Audience | Any logged-in user whose account is at least 1 hour old |
| New signups | See nothing in their first session; see the sheet on a later open, once the account is 1 hour old |
| Reopen entry point | None (not in Settings) |
| Remote-configured tips | Rejected: the iOS app bundles its frontend, so tips must ship with the build that has the features |

## Eligibility rule

The sheet shows when ALL are true:

1. A user is logged in (`session.user` present).
2. `now - session.user.created_at >= 1 hour`.
3. `localStorage['whats_new_seen_v{version}']` is not set.
4. No other dialog or drawer is open (onboarding, welcome, get started,
   referral dialog, notification soft prompt, review prompt, friend drawer,
   recipe detail, add recipe, settings, share sheet, confirm dialogs).
5. A short settle delay (about 1.5s) has passed since conditions 1 to 4 became
   true, so it never flashes over a screen that is still loading.

6. The App Store review prompt has not opened in this session (added during
   implementation so a user is never asked for attention twice in one visit;
   the sheet then shows on the next open).

Evaluated on app load and whenever the inputs above change. If `localStorage`
throws on read, the sheet does NOT show (safer than showing on every launch).
If `created_at` is missing or unparseable, the sheet does not show.

Edge case accepted: a new user who returns within the first hour sees the sheet
on the visit after that.

## Content

One batch object in `src/lib/whatsNew.js`:

```js
export const WHATS_NEW = {
  version: 1,
  tips: [
    { id: 'discover-search', title: 'Search community recipes',
      body: 'On the Discover tab, search by ingredient or creator.', action: 'discover' },
    { id: 'friends-of-friends', title: "See your friends' friends",
      body: "Open a friend and tap Friends to see everyone they're connected with, not just the friends you share.", action: 'friends' },
    { id: 'custom-tags', title: 'Organize with custom tags',
      body: 'Add your own tags to any recipe, then filter by tag to find it fast.', action: 'recipes' },
  ],
};
```

Copy rules: no em dashes. A future batch bumps `version` and replaces `tips`;
the old flag is simply never read again.

"Try it" destinations: `discover` opens the Discover tab, `friends` opens the
Friends page, `recipes` opens the user's Recipes tab. All three are existing
`currentView` values; no deep focus of a specific control.

## Components

- `src/lib/whatsNew.js`: the batch data plus pure functions:
  - `shouldShowWhatsNew({ user, now, storage, batch })` returns boolean.
  - `markWhatsNewSeen({ storage, batch })` sets the flag, swallowing storage errors.
  - Pure and dependency-injected (`now`, `storage`) so they unit test without a DOM.
- `src/components/WhatsNewSheet.jsx`: presentational MUI bottom sheet
  (`Drawer anchor="bottom"`), props `open`, `tips`, `onTry(action)`, `onClose`.
  Title "What's new", one card per tip (icon, title, body, "Try it" text
  button), a full-width "Got it" button. Safe-area bottom padding like the other
  drawers. Dark-mode colors follow the existing drawer paper.
- `src/App.jsx`: owns `whatsNewOpen` state, runs the eligibility effect (with the
  "no other dialog open" inputs it already has), mounts `WhatsNewSheet`, and maps
  `onTry` actions to `setCurrentView`. Computation must sit below the state it
  reads (`session`, dialog flags) to avoid a temporal-dead-zone crash.

## Dismissal

Closing, swiping down, "Got it", and any "Try it" all call
`markWhatsNewSeen` and close the sheet. "Try it" then navigates.

## Analytics

`trackEvent('whats_new_shown', { version })` once when shown, and
`trackEvent('whats_new_try', { tip })` per "Try it" tap. Nothing else.

## Testing

- `src/lib/whatsNew.test.js`: logged out; account younger than 1 hour; exactly
  1 hour; older account; already seen; storage read throws; missing or bad
  `created_at`; `markWhatsNewSeen` swallows a storage write error.
- `src/components/WhatsNewSheet.test.jsx`: renders all tips; "Try it" calls
  `onTry` with the tip's action; "Got it" calls `onClose`.
- Headless load of the built app to confirm no runtime error at `App` render
  (no test mounts the full `App`).

## Shipping

Frontend only. Web: Pages deploy. iOS: ships inside build 1.1.4 (38), which is
prepped but not yet archived, so `cap copy ios` must be re-run after this lands.
The friends-of-friends feature reaches iOS in that same build, so no iOS user
sees the tip without the feature.

## Out of scope

Reopen entry in Settings, per-account seen state, server-driven tips,
contextual coach marks, images or animation in the cards.
