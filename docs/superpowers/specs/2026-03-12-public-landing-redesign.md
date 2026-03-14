# Public Landing Redesign

**Date:** 2026-03-12
**Status:** Approved
**Files affected:**
- `apps/recipe-ui/src/components/PublicLanding.jsx`
- `apps/recipe-ui/src/components/WatchAndCook.jsx` → renamed to `DiscoverRecipes.jsx`
- `apps/worker/src/index.ts` (public endpoints to return `ingredients`, `steps`, `source_url`)

## Overview

Redesign the logged-out public landing page across all five sections: copy/header cleanup, hashtag chip styling, Editor's Picks card polish, public endpoint data completeness, and a new revolving ticker animation in Cook with Friends.

---

## Section 1 — Trending Now

**Changes:**
- Remove emoji from the `SectionLabel` call site only (not the helper): `<SectionLabel label="Trending Now" />`
- Layout unchanged (horizontal `RecipeShelf`)
- Verify: tapping a recipe card shows ingredients, steps, and a working source link (requires Data/API change below)

---

## Section 2 — Discover New Recipes

**Changes:**
- Rename file `WatchAndCook.jsx` → `DiscoverRecipes.jsx`, rename the default export to `DiscoverRecipes`. Update the import in `PublicLanding.jsx` to `import DiscoverRecipes from './DiscoverRecipes'`. Verify with a project-wide grep that no other files import `WatchAndCook` before renaming.
- `WatchAndCook.jsx` uses a raw `<Typography>` for its title (not `SectionLabel`). Replace that `<Typography>` with `<SectionLabel label="Discover New Recipes" />` to match the pattern used in `PublicLanding.jsx` for other sections. No emoji.
- Layout unchanged (portrait video cards, horizontal scroll)
- **Update the filter in `PublicLanding`** that computes which recipes feed this section. The current filter (`buildVideoEmbedUrl(r.sourceUrl) !== null`) excludes Instagram. Replace with a new helper that matches all three platforms by URL pattern:
  ```js
  function isSocialVideoRecipe(url) {
    if (!url) return false;
    return url.includes('youtube.com') || url.includes('youtu.be')
      || url.includes('tiktok.com') || url.includes('instagram.com');
  }
  const videoRecipes = trending.filter(r => isSocialVideoRecipe(r.sourceUrl));
  ```
- From the filtered set, prioritise: up to 2 YouTube Shorts (`/shorts/` in URL), up to 2 Instagram (`instagram.com`), up to 1 TikTok (`tiktok.com`). If fewer than the target count are available for any platform, include whatever is present. Pass the resulting array to `DiscoverRecipes`.
- Instagram cards cannot be iframed — `buildVideoEmbedUrl` returns `null` for them. `DiscoverRecipes` already handles this: when `embedUrl` is null, it shows only the thumbnail via `recipe.imageUrl`. This is acceptable.
- Verify: tapping a recipe card shows ingredients, steps, and a working source link

---

## Section 3 — Editor's Picks

**Changes:**
- Update `SectionLabel` call site: `<SectionLabel label="Editor's Picks" />` (no emoji)
- Restructure `EditorCard` to fix invalid nested `<button>` DOM (current Save button is inside `CardActionArea` which renders as `<button>`):
  1. Remove the existing `<Button>Save</Button>` from inside `CardActionArea`
  2. `CardActionArea` wraps only image + title + meta
  3. Add `flexDirection: 'column'` to the `Card` root's `sx` prop so children stack vertically (the default `display: 'flex'` with no direction would place the button box to the right, not below)
  4. Add a `<Box sx={{ display: 'flex', gap: 1, px: 1, pb: 1 }}>` sibling **below** `CardActionArea` containing:
     - `<Button variant="outlined" color="inherit" startIcon={<IosShareOutlinedIcon />} sx={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); onShare?.(recipe); }}>Share</Button>`
     - `<Button variant="contained" color="primary" startIcon={<BookmarkBorderIcon />} sx={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); onSave?.(); }}>Save</Button>`
  4. Both at default MUI Button size (no `size="small"`)
  6. Add `onShare` prop to `EditorCard`: `function EditorCard({ recipe, onSave, onShare, onOpen })`
  7. In `PublicLanding`, pass `onShare={handleShare}` to each `EditorCard` (reuse the `handleShare` already defined in `PublicLanding`)
- Verify: tapping a recipe card shows ingredients, steps, and a working source link

---

## Section 4 — Trending in Health and Nutrition

**Changes:**
- Update `SectionLabel` call site: `<SectionLabel label="Trending in health and nutrition" />` (no emoji)
- Replace the `<Typography>` element displaying `p.hashtag` with a `<Chip>`:
  - Before: `<Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color: 'primary.main', ... }}>{p.hashtag}</Typography>`
  - After: `<Chip label={p.hashtag} size="small" variant="outlined" sx={{ color: darkMode ? '#fff' : 'text.secondary', borderColor: 'divider', fontSize: 11, height: 20, borderRadius: '10px' }} />`
  - `darkMode` is already in scope at this JSX — no threading needed
- Verify: tapping a recipe card shows ingredients, steps, and a working source link

---

## Section 5 — Cook with Friends

### Copy changes
- Remove emoji from title: plain `"Cook with Friends"`
- Remove subtitle: `"Cooking is better together"`
- Move `"Join ReciFind to share recipes and see what your friends are cooking."` directly below the title, before the ticker stages

### Layout
The existing `CookWithFriends` component has a gradient card wrapper and inside it a `bgcolor: 'background.paper'` rounded box containing two `ActivityRow` nodes. Remove the inner white box and both `ActivityRow` nodes entirely. The three ticker stages sit directly inside the gradient card (no wrapping box around them).

### Ticker animation
Three ticker stages, each:
```jsx
<Box sx={{ position: 'relative', height: 44, overflow: 'hidden', mb: 0.75 }}>
```

Each stage contains **3 absolutely-positioned pill nodes** (one per activity), all at `position: absolute, inset: 0`. At mount, index 0 is active, indices 1 and 2 are hidden. Set initial state via inline `style` prop so the correct state is in DOM before effects run:
- Index 0: `style={{ opacity: 1, transform: 'translateY(0)' }}`
- Index 1, 2: `style={{ opacity: 0, transform: 'translateY(20px)' }}`

Each pill node:
```jsx
<Box
  ref={el => refs.current[i] = el}
  style={{ opacity: i === 0 ? 1 : 0, transform: i === 0 ? 'translateY(0)' : 'translateY(20px)' }}
  sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper', borderRadius: 2,
        display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
        fontSize: 11, color: 'text.secondary', willChange: 'opacity, transform' }}
>
```

**Ref structure:** Use a single 2D ref array in `CookWithFriends`:
```js
// One array per ticker (3 tickers × 3 activities each)
const tickerRefs = [useRef([]), useRef([]), useRef([])];
// Access: tickerRefs[tickerIndex].current[activityIndex]
```
Each ticker runs its own `setInterval` — all three start simultaneously (no stagger). All three cycle at the same pace.

**Animation cycle** (`useEffect` + `setInterval`, `useRef` arrays, no CSS `@keyframes`):

```js
const HOLD_MS    = 2800;
const OUT_MS     = 550;
const IN_MS      = 650;
const OVERLAP_MS = 220;
const OUT_EASE   = 'cubic-bezier(0.4, 0, 1, 1)';
const IN_EASE    = 'cubic-bezier(0, 0, 0.2, 1)';
```

Per cycle:
1. **Exit current** — set `transition: opacity ${OUT_MS}ms ${OUT_EASE}, transform ${OUT_MS}ms ${OUT_EASE}`, then `opacity: 0, translateY(-12px)`
2. **Enter next** — at `t = OUT_MS - OVERLAP_MS` (330ms), set `transition: opacity ${IN_MS}ms ${IN_EASE}, transform ${IN_MS}ms ${IN_EASE}`, then `opacity: 1, translateY(0)` on next node (which starts at `translateY(20px)`)
3. **Reset exited** — at `t = OUT_MS + 100ms` (650ms), snap exited node: `transition: none`, `opacity: 0`, `translateY(20px)`. Runs while enter animation is still in progress — intentional.

`setInterval` fires every `HOLD_MS + OUT_MS` ms. Clear interval on component unmount.

**Activities per ticker** (emojis in activity strings are intentional):

| Ticker | Avatar | Color | Activities (cycle in order, loop) |
|--------|--------|-------|-----------------------------------|
| Elisa | E | `#7c3aed` | "saved Miso Ramen ❤️ · 2h" → "shared Pad Thai with Sarah · 1d" → "is cooking Bulgogi tonight 🥩 · now" |
| Henny | H | `#10b981` | "shared Beef Stew with you · 5h" → "saved Salmon Bowl 🐟 · 3h" → "cooked Mushroom Risotto 🍚 · 2d" |
| Max | M | `#f59e0b` | "is cooking Tacos tonight 🌮 · now" → "saved Chicken Tikka Masala 🍛 · 6h" → "shared Pasta Carbonara 🍝 with Elisa · 1d" |

### CTA buttons
Remove `size="small"` from "Join free" and "Invite a friend" — use default MUI Button height.

### Out of scope
`onCookWithFriendsVisible` prop exists in `App.jsx` but is not yet wired to `CookWithFriends`. Leave as-is.

### Verify
Tapping a recipe card shows ingredients, steps, and a working source link.

---

## Data / API

All three public endpoints in `apps/worker/src/index.ts` must be updated to return `ingredients`, `steps`, and `source_url`. These fields are currently absent from SELECT queries and TypeScript return types.

### `GET /public/trending-recipes`
- Add `ingredients, steps, source_url` to the D1 SELECT query
- Update the function's TypeScript return type annotation to include these fields

### `GET /public/editors-pick`
- Add `ingredients, steps, source_url` to the D1 SELECT query
- Update the function's TypeScript return type annotation

### `GET /public/ai-picks`
- The matched recipe SELECT currently fetches `id, title, image_url, meal_types, duration_minutes`
- Add `ingredients, steps, source_url` to that SELECT
- Update the `AiPick` type definition's nested `recipe` object to include these three fields

---

## Testing

- Open each section logged out
- Tap a recipe card in each section → detail view shows ingredients list, steps, and source link is tappable
- Watch Cook with Friends ticker for 3+ full cycles → smooth overlapping loop, no flash or blank frames on first render
- Toggle dark mode → hashtag chips text turns white
- Confirm no emojis in any section header label
- Confirm emojis present inside ticker activity strings (intentional)
- Confirm no nested `<button>` DOM warning in browser console for Editor's Picks cards
