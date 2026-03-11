# Inline Video Cards — Design Spec

**Date:** 2026-03-11
**Branch:** feature/discovery-feeds
**Scope:** PublicLanding + RecipeShelf + new WatchAndCook component

---

## Summary

Two separate video-capable sections on the public landing page:

1. **Trending from the community** (updated `RecipeShelf`): enlarged cards with inline autoplay video for TikTok/YouTube recipes, static image for Instagram.
2. **Watch & Cook** (new `WatchAndCook`): full-bleed vertical video cards in an Instagram Suggested-Reels style horizontal shelf, TikTok/YouTube only.

Card sizes are consistent within each section — no mixing of sizes.

---

## Shared Utilities — `src/utils/videoEmbed.js` (new file)

### Embed URL helpers

```js
extractTikTokVideoId(url)
// Matches /video/{numericId} in the URL path. Returns string or null.

extractYouTubeVideoId(url)
// Handles:
//   youtube.com/watch?v={id}
//   youtu.be/{id}
//   youtube.com/shorts/{id}
// Returns string or null.

buildVideoEmbedUrl(sourceUrl)
// Returns an autoplay-muted embed URL string, or null if the platform is not embeddable.
//
// TikTok:  https://www.tiktok.com/embed/v2/{id}?autoplay=1&muted=1
//          (loop=1 omitted — TikTok loops by default)
// YouTube: https://www.youtube.com/embed/{id}?autoplay=1&mute=1&loop=1&playlist={id}
//          (playlist={id} is required for YouTube loop to work)
// Instagram / other: returns null — static image fallback is used instead.
```

### `formatDuration(minutes)` helper

Move `formatDuration` from `App.jsx` into this file and export it so `RecipeShelf` and `WatchAndCook` can import it without depending on `App.jsx`.

```js
export function formatDuration(minutes) {
  if (!minutes || minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}
```

Update the existing `formatDuration` usage in `App.jsx` to import from this file.

### `useInView` hook

```js
export function useInView(ref, threshold = 0.4) {
  // Attaches an IntersectionObserver to `ref.current` inside a useEffect.
  // Returns inView: boolean.
  // The useEffect return calls observer.disconnect() to clean up on unmount.
}
```

Used by `RecipeShelf` per-card. Because React hooks cannot be called inside loops or conditionals, each card must be extracted into a `RecipeCard` sub-component so the hook can be called at the top level of that component. `RecipeCard` holds its own `cardRef`, calls `useInView(cardRef)`, and renders the iframe or image based on `inView`. When `inView` flips to `true`, the card sets its iframe `src` to the embed URL. When it flips to `false`, the card sets `src` to `""` (unloads the iframe). A brief blank flash on re-entry is acceptable.

`WatchAndCook` does **not** use this hook — it uses its own raw `IntersectionObserver` at the section level (see below).

**Autoplay note:** Muted autoplay via iframe is permitted by browsers when the iframe carries `allow="autoplay"`. We rely on this. There is no additional fallback if a browser blocks it — the static image is already shown until the iframe loads, so the degraded state is acceptable.

---

## Updated `RecipeShelf` prop signature

The existing `RecipeShelf` accepts `cardWidth` (default 140) and uses it for both card width and thumbnail height (square cards). A new `cardHeight` prop is added for thumbnail height; its default is `cardWidth` so all existing callers (Editor's Pick, AI Picks) keep their current square appearance without needing changes.

**Full updated prop list:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `recipes` | array | `[]` | Recipe objects |
| `onSave` | function | `() => {}` | Called with recipe when save icon tapped |
| `onShare` | function | `() => {}` | Called with recipe when share icon tapped (new prop) |
| `onOpen` | function | `() => {}` | Called with recipe when card tapped |
| `showPlatformBadge` | boolean | false | Show TikTok/YouTube badge |
| `cardWidth` | number | 140 | Card width in px |
| `cardHeight` | number | 140 | Thumbnail height in px |

The solid `Save` Button is removed. Save and share are now icon-only `IconButton`s (`FavoriteBorderIcon` + `IosShareOutlinedIcon`), matching prod card style.

**`onShare` behavior:** `PublicLanding` passes a handler that calls `navigator.share({ title, url: recipe.sourceUrl })` if available, falling back to `navigator.clipboard.writeText(recipe.sourceUrl)` with a toast confirmation. This matches the existing share pattern in `App.jsx`.

---

## Trending Shelf — updated `RecipeShelf`

### Dimensions (Trending instance only)

| Part | Value |
|---|---|
| `cardWidth` | 190 px |
| `cardHeight` (thumbnail) | 200 px |
| Text + action bar | ~60 px |
| Total card height | ~260 px |
| Gap between cards | 12 px |

With these values on a 375 px screen:
`375 - 16 (left padding) - 190 (first card) - 12 (gap) = 157 px` of the second card visible ≈ 83 % — signals more content to the right.

Border-radius: 8 px on all card corners; thumbnail clips to top corners only via `overflow: hidden` on the card.

### Scroll / bleed behaviour

The bleed wrapper is rendered **inside `RecipeShelf.jsx`** (not by the caller):

```jsx
// Inside RecipeShelf — outer wrapper extends container to screen edges
<Box sx={{ mx: -2, overflow: 'hidden' }}>
  {/* Inner scroll row — left padding aligns first card with page content */}
  <Box sx={{ display: 'flex', gap: '12px', overflowX: 'auto', px: 2, pb: 1,
             scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
    {cards}
  </Box>
</Box>
```

Effect: first card is flush with page content (16 px from screen edge). As the user scrolls right, the left card scrolls off the screen edge with no residual padding (left-bleed). The `overflow: hidden` on the outer wrapper prevents the negative margin from expanding the page layout.

The Files Changed note "caller wraps in `mx: -2` box" is incorrect — this wrapper lives inside `RecipeShelf`.

### Top padding

Add `pt: 2` to the outer `Stack` in `PublicLanding` to increase space between the nav bar and the Trending section.

### Card anatomy

**1. Thumbnail area (`cardWidth × cardHeight`)**

- `position: relative`, `overflow: hidden`, top border-radius only.
- **TikTok / YouTube:** `<iframe>` with:
  - `src` controlled by `useInView` on the card's root ref. Set to embed URL when `inView`, set to `""` when not.
  - `allow="autoplay; fullscreen"`, `allowFullScreen`, `border: 0`.
  - `width: 100%`, `height: 100%`.
  - A transparent `<div>` overlay (`position: absolute, inset: 0, zIndex: 1, cursor: pointer`) fully covers the iframe with `pointer-events: auto`. This intercepts all taps and calls `onOpen(recipe)`. Autoplay is controlled by the `allow="autoplay"` attribute and muted state — it is not affected by the overlay covering the iframe.
- **Instagram / no embed:** `<img>` (current behaviour, unchanged).

**2. Text + action bar (`px: 1, py: 0.75`)**

- Title: 2-line clamp, `fontSize: 11`, `fontWeight: 700`.
- Row below title:
  - Left: `AccessTimeIcon` (12 px) + `formatDuration(durationMinutes)`. Only rendered when `durationMinutes > 0` — the `durationMinutes > 0` guard in the card prevents `formatDuration` from ever being called with `0`, `null`, or `undefined`. Those values hide the row entirely (treated as unknown duration).
  - Right: `FavoriteBorderIcon` `IconButton` (size `small`) calls `onSave(recipe)` with `stopPropagation`. `IosShareOutlinedIcon` `IconButton` (size `small`) calls `onShare(recipe)` with `stopPropagation`. Icon size: 18 px. Color: `text.secondary` (grey), matching prod.

### Interaction

Tapping anywhere on the card calls `onOpen(recipe)`. The transparent overlay div on the thumbnail area handles this for the video zone.

---

## Watch & Cook — new `WatchAndCook.jsx`

### Purpose

Instagram Suggested-Reels style: full-bleed portrait video cards, horizontal scroll, 2 cards fully visible + ~20 px sliver of a third.

### Data source

Passed in as a `recipes` prop from `PublicLanding` — the parent filters `trending` recipes to only those where `buildVideoEmbedUrl(recipe.sourceUrl)` returns non-null. No new API call. If no embeddable recipes exist, `PublicLanding` does not render `WatchAndCook` at all.

**Loading state:** While `trending` is still fetching (empty array), `WatchAndCook` is not rendered (same condition as Trending shelf: `trending.length > 0 && videoRecipes.length > 0`).

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `recipes` | array | `[]` | Pre-filtered embeddable recipes |
| `onOpen` | function | `() => {}` | Called with recipe when card tapped |

### Card dimensions (portrait, responsive)

```
Card width:   calc((100vw - 44px) / 2)  ≈ 166 px on a 375 px screen
Card height:  via CSS `aspect-ratio: 9 / 16`  ≈ 295 px on a 375 px screen
              (portrait — height is taller than width)
Gap:          8 px
Left padding: 16 px
```

**Visibility check:** `16 + 166 + 8 + 166 + 8 + 20 (sliver) = 384 px` — the sliver of the third card is visible on a standard 375 px screen when scroll is at 0.

Cards are full-bleed (video/image fills the entire card area). Rounded corners: `borderRadius: 2` (8 px MUI spacing).

### Title overlay

Absolute-positioned over the bottom of the card:
- Background: `linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)`
- Title: white text, `fontSize: 11`, `fontWeight: 700`, 2-line clamp
- Position: `bottom: 8px, left: 8px, right: 8px`

### Video loading — section-level IntersectionObserver

`WatchAndCook` uses a single raw `IntersectionObserver` (not the `useInView` hook) on its own root `div` ref:

```js
useEffect(() => {
  const el = rootRef.current;
  const observer = new IntersectionObserver(
    ([entry]) => setSectionInView(entry.isIntersecting),
    { threshold: 0.1 }
  );
  observer.observe(el);
  return () => observer.disconnect();
}, []);
```

`sectionInView` (boolean state) is passed into each card. Each card renders its iframe `src` as the embed URL when `sectionInView` is true, and `""` when false. This is one observer total regardless of number of cards.

**Simultaneous autoplay is intentional.** All visible cards in the shelf autoplay at once when the section is in view, matching the Instagram Suggested Reels behaviour. All videos are muted, so there is no audio conflict. When `sectionInView` becomes `false`, each card sets its iframe `src` to `""`, unloading the video.

### Tap interaction

Each `WatchAndCook` card has a transparent full-card overlay div (`position: absolute, inset: 0, zIndex: 1, cursor: pointer`) covering the full-bleed iframe — identical in pattern to `RecipeShelf`. This intercepts taps and calls `onOpen(recipe)`. Without this overlay, taps on the video area would go into the iframe instead of the React handler.

`onOpen` is the same handler passed from `PublicLanding` to both sections — it opens the full recipe detail view (bottom sheet with ingredients, steps, and save option). No save/share icons on the card itself — viewer-only in this section.

If `recipes` is empty, `WatchAndCook` renders `null`.

### Placement in `PublicLanding`

```
Stack order:
  1. 🔥 Trending from the community   ← updated RecipeShelf
  2. 📺 Watch & Cook                   ← new WatchAndCook (only if videoRecipes.length > 0)
  3. ⭐ Editor's Pick
  4. 🥦 Trending in health and nutrition
  5. 🍳 Cook with Friends
```

---

## Files changed

| File | Change |
|---|---|
| `src/utils/videoEmbed.js` | New — `buildVideoEmbedUrl`, `extractTikTokVideoId`, `extractYouTubeVideoId`, `formatDuration`, `useInView` |
| `src/components/RecipeShelf.jsx` | Updated — `cardHeight` prop, video iframe with overlay div, icon-only save/share actions, bleed scroll wrapper inside component |
| `src/components/WatchAndCook.jsx` | New — Watch & Cook section with section-level observer |
| `src/components/PublicLanding.jsx` | Updated — `pt: 2` on Stack, filter embeddable recipes, render WatchAndCook, pass `onShare` to RecipeShelf |
| `src/App.jsx` | Updated — import `formatDuration` from utils instead of defining it inline |

---

## Out of scope

- Logged-in home feed (`FriendSections`) — not changed in this spec.
- Instagram embedding — blocked by `X-Frame-Options`; static image used.
- Unmute / sound toggle — not in this iteration.
- New API endpoints — none needed.
