# Unified Recipe Share — Design

**Date:** 2026-04-19
**Status:** Approved for plan

## Problem

Tapping the share icon on a recipe card today does one of two different things depending on where the card lives:

- **Recipe collection** (`RecipesPage`) and **public landing**: opens an anchored `Menu` with native share / Email / Text. Generates a tokenized share URL via `POST /recipes/:id/share-link`.
- **Friend sections** (logged-in home feed): opens `FriendPicker` Dialog with a multi-select list of ReciFriend connections.

The user has to know in advance which entry point gives which behavior. There is no single tap that surfaces both options.

## Goal

A single, unified share interaction:

1. Tap share icon on any recipe card.
2. Bottom action sheet appears with two clearly-labeled choices:
   - **Share with Friends** — opens the iOS native share sheet (Messages, Mail, WhatsApp, etc.). SMS messages render a rich link preview (recipe thumbnail + title) via the existing OG-tag middleware.
   - **Share with Connections** — opens the bottom-drawer connection picker (multi-select).

Logged-out visitors skip the chooser and go straight to native share — they have no connections, so the chooser would only add friction.

## UX

### Action sheet (new component: `ShareSheet`)

MUI `Drawer` with `anchor="bottom"`. Two large tappable rows, each with an icon + title + small description:

```
┌─────────────────────────────────────────────┐
│  📱  Share with Friends                     │
│       via SMS, email, or other apps         │
├─────────────────────────────────────────────┤
│  👥  Share with Connections                 │
│       pick from your ReciFriend friends     │
└─────────────────────────────────────────────┘
```

- Drawer slides up from the bottom on mobile and desktop.
- Tapping outside or pressing escape dismisses it.
- Honors safe-area-inset-bottom (iOS notch).
- Dark-mode aware (matches existing recipe-detail dialog treatment in App.jsx).

### Connection picker (refactored `FriendPicker`)

Same component, two visual changes:

1. **Dialog → bottom Drawer** for visual consistency with `ShareSheet`. Same props, same controller logic in App.jsx (`handlePickerSend`, `handlePickerClose`).
2. **Checkboxes → avatar-overlay selection (iMessage style)**:
   - Whole row is the tap target (no separate checkbox column).
   - When selected: avatar gets a small filled-circle checkmark badge in the bottom-right corner; row background tints with the brand color at low opacity.
   - When unselected: plain avatar, no badge, neutral background.

Existing functionality is preserved: multi-select list, "Send" / "Cancel" / "Copy link" buttons, success / error alerts, empty-state message.

## Architecture

### Single entry point

Collapse the three existing handlers in [apps/recipe-ui/src/App.jsx](../../../apps/recipe-ui/src/App.jsx) into one:

```js
function openShareSheet(recipe, anchorEvent) {
  const isLoggedIn = Boolean(session);
  if (!isLoggedIn) {
    return triggerNativeShare(recipe, anchorEvent); // skip chooser
  }
  setShareSheetState({ recipe, anchorEvent });
}
```

`openShareSheet` is wired to:
- `RecipesPage` `onShare` (currently calls `handleShare`)
- `FriendSections` `onShareRecipe` (currently calls `openSharePicker`)
- `PublicLanding` `onShare` (currently calls `handleSharePublicRecipe`) — note: logged-out branch makes this functionally identical to current behavior
- Recipe detail dialog Share button

The two existing helpers stay but become internal sub-flows:

- `triggerNativeShare(recipe, anchorEvent)` — wraps the existing `handleShare` body: gets/saves share-link token, then calls `navigator.share(...)` if available, else opens the existing anchored `Menu` (Copy / Email / Text).
- `openConnectionPicker(recipe)` — wraps `openSharePicker`: opens the refactored `FriendPicker` drawer pre-loaded with `friends`.

### File changes

| File | Change |
|------|--------|
| [apps/recipe-ui/src/components/ShareSheet.jsx](../../../apps/recipe-ui/src/components/ShareSheet.jsx) | **New.** Bottom Drawer with two rows. Props: `open`, `onClose`, `onPickFriends`, `onPickConnections`. |
| [apps/recipe-ui/src/components/FriendPicker.jsx](../../../apps/recipe-ui/src/components/FriendPicker.jsx) | Refactor: `Dialog` → `Drawer anchor="bottom"`. Replace MUI `Checkbox` + `ListItem` with custom rows using `Avatar` + overlay badge. Props unchanged. |
| [apps/recipe-ui/src/components/FriendPicker.test.jsx](../../../apps/recipe-ui/src/components/FriendPicker.test.jsx) | Update selectors that targeted `Checkbox` / `Dialog` roles to match new structure. Test behavior (multi-select, send, copy-link) is unchanged. |
| [apps/recipe-ui/src/App.jsx](../../../apps/recipe-ui/src/App.jsx) | Add `openShareSheet` + `shareSheetState`. Wire `<ShareSheet>` near existing `<FriendPicker>` mount. Replace the three call-sites listed above. Keep existing `handleShare` body as `triggerNativeShare` (renamed). Keep existing share `Menu` as the desktop fallback inside `triggerNativeShare`. |

No worker changes. No new endpoints. OG middleware untouched.

## Data flow

### Share with Friends (logged-in, mobile with `navigator.share`)

```
[Card share icon]
   → openShareSheet(recipe)
   → ShareSheet drawer opens
   → user taps "Share with Friends"
   → ShareSheet closes
   → triggerNativeShare(recipe)
       → POST /recipes/:id/share-link  (existing endpoint)
       → URL = `${origin}?share=${token}`
       → navigator.share({ title, text, url })
       → iOS share sheet appears
       → user taps Messages
       → iMessage fetches the URL
           → Cloudflare Pages Functions middleware (_middleware.js) detects iMessageLinkExtension UA
           → returns OG tags (recipe title + image)
       → iMessage renders rich card with thumbnail + title
```

### Share with Friends (logged-out)

```
[PublicLanding card share icon]
   → openShareSheet(recipe)  (sees no session)
   → triggerNativeShare(recipe) directly  (no chooser shown)
   → URL = `${origin}?recipe=${id}&user=${userId}`  (no token, no auth required)
   → navigator.share or fallback Menu
```

### Share with Connections (logged-in)

```
[Card share icon]
   → openShareSheet(recipe)
   → ShareSheet drawer opens
   → user taps "Share with Connections"
   → ShareSheet closes
   → openConnectionPicker(recipe)
   → FriendPicker drawer opens, pre-loaded with friends
   → user multi-selects + taps Send
   → POST /recipes/:id/share with recipient_user_ids
   → success alert; drawer dismissed
```

## SMS rich preview

This is the "earlier implementation" the user wants brought back. It already exists end-to-end:

- [apps/recipe-ui/functions/_middleware.js](../../../apps/recipe-ui/functions/_middleware.js) detects `iMessageLinkExtension` (and other bot UAs), fetches the recipe via `GET /public/share/:token` or `GET /public/recipe/:userId/:recipeId`, and returns HTML with `og:title` + `og:image` + `og:description`.
- iMessage renders the OG card on the receiving device: thumbnail + title + site name.

What the redesign needs to verify:

1. **`navigator.share` URL format must match** what the middleware handles. `?share={token}` (logged-in) and `?recipe={id}&user={userId}` (logged-out) are both already covered.
2. **Cache-Control on the OG response** — currently `public, max-age=3600`. Acceptable; if a recipe is edited within an hour the SMS preview shows stale data. Out of scope to change here.

No code change required for the SMS path. Document it in the implementation plan as a verification step (manual phone test on tunnel).

## Out of scope

- Adding `@capacitor/share`. The current `navigator.share` works in Capacitor 8's WebView. If a future iOS release breaks this, swap in a separate change.
- Modifying the OG middleware or share-link endpoint.
- Changing `FriendPicker` business logic (multi-select, send, error handling, copy-link fallback).
- Replacing the small anchored share `Menu` used as the desktop fallback. It stays as-is.
- Logged-out connection sharing (no connections exist).

## Verification plan (for the implementation phase)

1. Tunnel preview on phone (per CLAUDE.md "Mobile preview" section in MEMORY.md).
2. From the recipe collection: tap share → confirm bottom drawer with two rows.
3. Tap "Share with Friends" → confirm iOS share sheet opens → tap Messages → confirm rich preview (thumbnail + title) renders in the message bubble.
4. Tap "Share with Connections" → confirm bottom drawer opens with friends list, avatar-overlay selection state, multi-select works, Send succeeds.
5. From the friend sections home feed: same two checks.
6. From the public landing (logged-out): tap share → confirm it skips the chooser and opens iOS share sheet directly.
7. Recipe detail dialog Share button: same as #2.
