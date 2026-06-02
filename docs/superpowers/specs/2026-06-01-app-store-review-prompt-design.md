# App Store review prompt (two-step sentiment gate)

Date: 2026-06-01
Status: Design approved

## Summary

Proactively prompt engaged users to rate/review ReciFriend on the App Store,
via a two-step sentiment gate: ask if they're enjoying the app first, send happy
users to the App Store Write-a-Review screen, and route unhappy users to the
existing private feedback form instead. iOS-only. Frontend-only (no worker/API
change). Ships in build 27.

## Reuses existing plumbing

- `handleRateOnAppStore()` in `App.jsx` already deep-links to
  `itms-apps://itunes.apple.com/app/id6763828182?action=write-review`.
- `isIOSEnv` already detects iOS (native app + iOS Safari/PWA).
- The feedback widget's `localStorage` visit-gating is the pattern to mirror.

## Flow (two MUI dialogs)

1. **Step 1 — sentiment:** "Enjoying ReciFriend?" → `[Not really]` / `[Yes!]`
   - **Yes** → Step 2.
   - **Not really** → close, open the existing feedback drawer, snooze the rate
     prompt 90 days.
2. **Step 2 — review ask:** "Glad to hear it! Mind leaving a quick review?" →
   `[Maybe later]` / `[Rate on the App Store]`
   - **Rate** → `handleRateOnAppStore()`, mark `rated` (never ask again).
   - **Maybe later** → snooze 90 days.

## Trigger / gating (all must hold)

- `isIOSEnv` (App Store review only).
- **≥ 5 saved recipes** (recipe-collection count).
- **Return visit, not the triggering session:** the first load where count ≥ 5
  only *arms* the prompt (store `armedAt`, set a `sessionStorage` marker). It
  shows only on a later cold launch (fresh session = no `sessionStorage` marker),
  so it never pops the instant the 5th recipe is saved.
- Not already `rated`, and `now >= snoozedUntil`.
- At most once per session.

State: `localStorage['review_prompt'] = { armedAt, rated, snoozedUntil }` (JSON).

## Coexistence with the feedback widget

At most one prompt per session. The review prompt is evaluated on load; if it
will show this session it suppresses the feedback widget, and if the feedback
widget is already open the review prompt stands down. (The "Not really" branch
intentionally hands off to the feedback drawer.)

## Components

- `src/components/ReviewPrompt.jsx` — presentational two-step dialog
  (`open`, `step`, `onYes`, `onNot`, `onRate`, `onLater`, `onClose`).
- `decideReviewPrompt({ count, now, state, armedThisSession, isIOS }) →
  'arm' | 'show' | 'skip'` — pure decision helper (unit-testable), in
  `src/reviewPrompt.js` with thin `localStorage`/`sessionStorage` read-write
  wrappers.
- `App.jsx` wiring: evaluate on load (after recipes are loaded), drive
  `ReviewPrompt` state, call `handleRateOnAppStore()` / open feedback, persist
  state, and suppress the feedback widget when showing.

## Testing

- Unit-test `decideReviewPrompt` per branch: below threshold → `skip`; ≥5 first
  time / armed this session → `arm`/`skip`; armed in a prior session, not rated,
  not snoozed → `show`; rated → `skip`; within snooze → `skip`; non-iOS → `skip`.
- `npm run build` green.
- Manual on-device: with ≥5 recipes, cold-relaunch → prompt appears; verify the
  Yes→App Store and Not-really→feedback branches; confirm it doesn't re-show
  after rating, and that the feedback widget and review prompt never both appear.

## Out of scope

- The native `SKStoreReviewController` system prompt (we use a custom deep-link
  by design).
- Android / Play Store.
- Server-side tracking of who was prompted (all gating is client-side localStorage).
