# Inline Video Cards — Design Spec

**Date:** 2026-03-11
**Branch:** feature/discovery-feeds
**Scope:** PublicLanding + RecipeShelf + new WatchAndCook component

---

## Summary

Two separate video-capable sections on the public landing page:

1. **Section 1 — Trending shelf** (`RecipeShelf`): enlarged cards with inline autoplay video for TikTok/YouTube recipes, static image for Instagram.
2. **Section 2 — Watch & Cook** (`WatchAndCook`): full-bleed vertical video cards in an Instagram Suggested-Reels style horizontal shelf, TikTok/YouTube only.

Card sizes are consistent within each section — no mixing.

---

## Shared Utilities

### `src/utils/videoEmbed.js` (new file)

**Helpers:**

```js
extractTikTokVideoId(url)
// Matches /video/{numericId} in the path. Returns string or null.

extractYouTubeVideoId(url)
// Handles youtube.com/watch?v=, youtu.be/, youtube.com/shorts/. Returns string or null.

buildVideoEmbedUrl(sourceUrl)
// Returns embed URL string or null.
// TikTok:  https://www.tiktok.com/embed/v2/{id}?autoplay=1&muted=1&loop=1
// YouTube: https://www.youtube.com/embed/{id}?autoplay=1&mute=1&loop=1&playlist={id}
// Instagram / other: null
```

**Hook:**

```js
useInView(ref, threshold = 0.4)
// Wraps IntersectionObserver on the given ref.
// Returns inView: boolean.
// When inView flips true  → caller sets iframe src (starts playback).
// When inView flips false → caller clears iframe src (stops playback, frees memory).
```

**Embeddable platforms:** TikTok, YouTube only. Instagram always falls back to static image.

---

## Section 1 — Trending Shelf (updated `RecipeShelf`)

### Card dimensions

| Part | Size |
|---|---|
| Card width | 190 px (fixed, consistent across shelf) |
| Thumbnail height | 200 px |
| Text + action bar | ~60 px |
| Total card height | ~260 px |

Border-radius: top corners only on thumbnail, full card rounded at 8 px.

### Scroll / bleed behaviour

```
Outer wrapper:  mx: -2   (extends scroll container to screen edges)
Scroll row:     px: 2    (first card aligns with page content indent)
                overflowX: auto, scrollbarWidth: none
```

Effect: the first card starts flush with page content. As the user scrolls right, the left card bleeds off the screen edge with no residual padding. The second card is ~65 % visible on a 375 px screen, signalling more content.

### Top padding

Add `pt: 2` to the outer `Stack` in `PublicLanding` to increase space between the nav bar and the first section.

### Card anatomy (top → bottom)

**1. Thumbnail area (190 × 200 px)**

- `position: relative`, `overflow: hidden`, top border-radius only.
- **TikTok / YouTube**: `<iframe>` with:
  - `src` set only when `inView` (via `useInView` on the card ref), cleared when out of view.
  - `allow="autoplay; fullscreen"`, `allowFullScreen`.
  - `pointer-events: none` — tapping the card area opens recipe detail, not the iframe.
  - `width: 100%`, `height: 100%`, `border: none`.
- **Instagram / no embed**: `<img>` (same as current behaviour).

**2. Text + action bar (px: 1, py: 0.75)**

- Title: 2-line clamp, `fontSize: 11`, `fontWeight: 700`.
- Row below title:
  - Left: `AccessTimeIcon` (12 px) + `formatDuration(durationMinutes)` — already handles `> 60 min` → `"1 hr 30 min"`.
  - Right: `FavoriteBorderIcon` IconButton + `IosShareOutlinedIcon` IconButton. No solid/contained button style — icon-only, same pattern as prod recipe list cards.

### Interaction

Tapping anywhere on the card (including the video area, which has `pointer-events: none` on the iframe) calls `onOpen(recipe)` to open the recipe detail sheet.
Save/share icons call `onSave(recipe)` / `onShare(recipe)` with `stopPropagation`.

---

## Section 2 — Watch & Cook (new `WatchAndCook.jsx`)

### Purpose

Instagram Suggested-Reels style: full-bleed vertical video cards, horizontal scroll, 2 cards fully visible + ~20 px sliver of a third.

### Data source

Filters the existing `trending` recipes already fetched in `PublicLanding` — no new API call. Only recipes where `buildVideoEmbedUrl(sourceUrl)` returns a non-null value are included.

### Card dimensions (responsive)

```
Card width:  calc((100vw - 44px) / 2)
             ≈ 166 px on a 375 px screen
Card height: card-width × (16/9)
             ≈ 295 px on a 375 px screen
Gap between cards: 8 px
Left padding: 16 px (aligns with page content)
```

Cards are full-bleed (image/video fills entire card). Rounded corners: `borderRadius: 2` (8 px).

### Title overlay

`linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 50%)` over the bottom 50 % of the card. Title text in white, `fontSize: 11`, `fontWeight: 700`, 2-line clamp, positioned `absolute bottom: 8px left: 8px right: 8px`.

### Video loading strategy

IntersectionObserver at the **section level** (one observer on the `WatchAndCook` root element, not per-card):
- When the section enters the viewport → set `src` on all iframes in the section.
- When the section exits the viewport → clear all `src` values.

This avoids the overhead of N observers for N cards.

### Actions

No save/share icons. Tapping a card calls `onOpen(recipe)` to open the recipe detail sheet.

### Placement in `PublicLanding`

Between Section 1 (Trending) and Section 2 (Editor's Pick). Only rendered if there is at least one embeddable video recipe.

```
Stack order:
  1. 🔥 Trending from the community   ← Section 1 (updated RecipeShelf)
  2. 📺 Watch & Cook                   ← Section 2 (new WatchAndCook)
  3. ⭐ Editor's Pick
  4. 🥦 Trending in health and nutrition
  5. 🍳 Cook with Friends
```

---

## Files changed

| File | Change |
|---|---|
| `src/utils/videoEmbed.js` | New — embed URL helpers + `useInView` hook |
| `src/components/RecipeShelf.jsx` | Updated — larger cards, video iframe, icon actions, bleed scroll |
| `src/components/WatchAndCook.jsx` | New — Watch & Cook section |
| `src/components/PublicLanding.jsx` | Updated — add `pt: 2`, insert `WatchAndCook`, pass `onShare` |

---

## Out of scope

- Logged-in home feed (FriendSections) — not changed in this spec.
- Instagram embedding — not possible due to `X-Frame-Options`; static image used.
- Unmute button / sound toggle — not in this iteration.
- New API endpoints — none needed.
