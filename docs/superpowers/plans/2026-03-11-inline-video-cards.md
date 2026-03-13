# Inline Video Cards Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline autoplay-muted video to the public landing page via two sections: an enlarged Trending shelf (TikTok/YouTube iframes in-card) and a new "Watch & Cook" Suggested-Reels-style shelf.

**Architecture:** All work is frontend-only in the `apps/recipe-ui/` directory of the `feature/discovery-feeds` worktree. A new `src/utils/videoEmbed.js` provides shared helpers. `RecipeShelf.jsx` gains a `RecipeCard` sub-component with per-card IntersectionObserver. `WatchAndCook.jsx` is a new component with a section-level observer. `PublicLanding.jsx` wires it all together.

**Tech Stack:** React 18, MUI v5, Vite. No new npm packages needed. No backend changes. No test framework for frontend — verification is manual via the dev server.

**Working directory:** `/Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui`

**Dev server:** `npm run dev -- --host` (already configured for tunnel)

---

## Chunk 1: Shared utilities (`src/utils/videoEmbed.js`)

**Files:**
- Create: `src/utils/videoEmbed.js`
- Modify: `src/App.jsx` (import `formatDuration` from utils)

---

### Task 1: Create `src/utils/videoEmbed.js`

**Files:**
- Create: `src/utils/videoEmbed.js`

- [ ] **Step 1: Create the file with all helpers**

Create `src/utils/videoEmbed.js` with this exact content:

```js
import { useEffect, useState } from 'react';

// ─── TikTok ───────────────────────────────────────────────────────────────────

export function extractTikTokVideoId(url) {
  if (!url) return null;
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

export function extractYouTubeVideoId(url) {
  if (!url) return null;
  const patterns = [
    /[?&]v=([^&#]+)/,          // youtube.com/watch?v=ID
    /youtu\.be\/([^?&#]+)/,    // youtu.be/ID
    /\/shorts\/([^?&#]+)/,     // youtube.com/shorts/ID
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Embed URL ────────────────────────────────────────────────────────────────

/**
 * Returns an autoplay-muted embed URL for TikTok or YouTube, or null for
 * any other platform (including Instagram, which blocks iframing).
 */
export function buildVideoEmbedUrl(sourceUrl) {
  if (!sourceUrl) return null;

  if (sourceUrl.includes('tiktok.com')) {
    const id = extractTikTokVideoId(sourceUrl);
    return id
      ? `https://www.tiktok.com/embed/v2/${id}?autoplay=1&muted=1`
      : null;
  }

  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) {
    const id = extractYouTubeVideoId(sourceUrl);
    return id
      ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`
      : null;
  }

  return null;
}

// ─── Duration formatting ──────────────────────────────────────────────────────

/**
 * Formats a duration in minutes to a human-readable string.
 * Returns null for falsy or zero values — callers guard with `durationMinutes > 0`.
 */
export function formatDuration(minutes) {
  if (!minutes || minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// ─── useInView hook ───────────────────────────────────────────────────────────

/**
 * Observes `ref.current` with IntersectionObserver.
 * Returns inView: boolean.
 * Disconnects on unmount.
 */
export function useInView(ref, threshold = 0.4) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return inView;
}
```

- [ ] **Step 2: Verify the file renders no import errors**

Start the dev server if not running:
```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/recipe-ui
npm run dev -- --host
```

Open the browser console. There should be no import errors from this file yet (it's not imported anywhere).

- [ ] **Step 3: Commit**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add apps/recipe-ui/src/utils/videoEmbed.js
git commit -m "feat: add videoEmbed utils — buildVideoEmbedUrl, formatDuration, useInView"
```

---

### Task 2: Update `App.jsx` to import `formatDuration` from utils

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Find the existing `formatDuration` definition**

It's at line ~427 in `App.jsx`:
```js
function formatDuration(minutes) {
  if (!minutes || minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}
```

- [ ] **Step 2: Add the import at the top of `App.jsx`**

Find the block of local imports near the top of `App.jsx` (after the MUI/icon imports). Add:

```js
import { formatDuration } from './utils/videoEmbed';
```

- [ ] **Step 3: Delete the local `formatDuration` function**

Remove the entire `function formatDuration(minutes) { ... }` block from `App.jsx` (the one found in Step 1). The imported version is identical.

- [ ] **Step 4: Verify no runtime errors**

Check the browser — the app should still load and duration values (e.g. "45 min", "1 hr 30 min") should still display correctly on recipe cards in the main logged-in view.

- [ ] **Step 5: Commit**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add apps/recipe-ui/src/App.jsx
git commit -m "refactor: import formatDuration from utils/videoEmbed in App.jsx"
```

---

## Chunk 2: Updated `RecipeShelf.jsx`

**Files:**
- Modify: `src/components/RecipeShelf.jsx`

Context: The current `RecipeShelf` renders cards in a `.map()` loop. We need to extract each card into a `RecipeCard` sub-component (so `useInView` can be called at the top level of a component, not inside a loop — React hooks rule).

---

### Task 3: Rewrite `RecipeShelf.jsx`

**Files:**
- Modify: `src/components/RecipeShelf.jsx`

- [ ] **Step 1: Read the current file**

Read `src/components/RecipeShelf.jsx` to understand what you're replacing. Key things to note:
- It currently uses a solid `Button` for Save (remove this)
- `cardWidth` is used for both width and height of the thumbnail (square)
- `getPlatform()` helper is at the bottom

- [ ] **Step 2: Replace the file with the new implementation**

Replace the entire contents of `src/components/RecipeShelf.jsx` with:

```jsx
import { useRef } from 'react';
import { Box, Typography, IconButton, Chip } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { buildVideoEmbedUrl, formatDuration, useInView } from '../utils/videoEmbed';

/**
 * Horizontal scrollable shelf of recipe cards.
 *
 * Props:
 *   recipes        — array of recipe objects
 *   onSave         — (recipe) => void, called when save icon tapped
 *   onShare        — (recipe) => void, called when share icon tapped (new)
 *   onOpen         — (recipe) => void, called when card tapped
 *   showPlatformBadge — boolean, show TikTok/YouTube badge on thumbnail
 *   cardWidth      — number (default 140), card width in px
 *   cardHeight     — number (default = cardWidth), thumbnail height in px
 */
export default function RecipeShelf({
  recipes = [],
  onSave = () => {},
  onShare = () => {},
  onOpen = () => {},
  showPlatformBadge = false,
  cardWidth = 140,
  cardHeight,
}) {
  if (!recipes.length) return null;

  const thumbHeight = cardHeight ?? cardWidth;

  return (
    // Outer wrapper: negative margin extends the scroll container to screen edges
    <Box sx={{ mx: -2, overflow: 'hidden' }}>
      {/* Inner scroll row: px:2 aligns first card with page content */}
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          px: 2,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onSave={onSave}
            onShare={onShare}
            onOpen={onOpen}
            showPlatformBadge={showPlatformBadge}
            cardWidth={cardWidth}
            thumbHeight={thumbHeight}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single card sub-component. Extracted so useInView can be called at the
 * top level of a component (React hooks cannot be called inside a loop).
 */
function RecipeCard({
  recipe,
  onSave,
  onShare,
  onOpen,
  showPlatformBadge,
  cardWidth,
  thumbHeight,
}) {
  const cardRef = useRef(null);
  const inView = useInView(cardRef);
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);
  const platform = showPlatformBadge ? getPlatform(recipe.sourceUrl) : null;

  return (
    <Box
      ref={cardRef}
      onClick={() => onOpen(recipe)}
      sx={{
        flexShrink: 0,
        width: cardWidth,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {/* ── Thumbnail ── */}
      <Box
        sx={{
          position: 'relative',
          width: cardWidth,
          height: thumbHeight,
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        {embedUrl ? (
          <>
            <Box
              component="iframe"
              src={inView ? embedUrl : ''}
              title={recipe.title}
              allow="autoplay; fullscreen"
              allowFullScreen
              sx={{
                width: '100%',
                height: '100%',
                border: 'none',
                display: 'block',
              }}
            />
            {/* Transparent overlay intercepts taps so onOpen fires, not the iframe */}
            <Box
              onClick={(e) => { e.stopPropagation(); onOpen(recipe); }}
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                cursor: 'pointer',
              }}
            />
          </>
        ) : recipe.imageUrl ? (
          <Box
            component="img"
            src={recipe.imageUrl}
            alt={recipe.title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
            }}
          >
            🍳
          </Box>
        )}

        {platform && (
          <Chip
            label={platform.label}
            size="small"
            sx={{
              position: 'absolute',
              top: 6,
              left: 6,
              zIndex: 2,
              height: 18,
              fontSize: 9,
              fontWeight: 700,
              bgcolor: platform.color,
              color: '#fff',
              borderRadius: 1,
            }}
          />
        )}
      </Box>

      {/* ── Text + actions ── */}
      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.35,
            color: 'text.primary',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 0.5,
          }}
        >
          {recipe.title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {recipe.durationMinutes > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                {formatDuration(recipe.durationMinutes)}
              </Typography>
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onSave(recipe); }}
            aria-label="Save recipe"
            sx={{ p: 0.5 }}
          >
            <BookmarkBorderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onShare(recipe); }}
            aria-label="Share recipe"
            sx={{ p: 0.5 }}
          >
            <IosShareOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

function getPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('tiktok.com')) return { label: 'TikTok', color: '#000' };
  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be'))
    return { label: 'YouTube', color: '#ff0000' };
  if (sourceUrl.includes('instagram.com')) return { label: 'Instagram', color: '#c13584' };
  return null;
}
```

- [ ] **Step 3: Verify in browser — existing shelves look correct**

Open the public landing page (logged out). Check:
- Editor's Pick shelf still renders (uses `RecipeShelf` with default props)
- AI Picks shelf still renders
- Cards show image, title, and now show icon buttons instead of the old solid Save button
- No console errors

- [ ] **Step 4: Verify the Trending shelf with large card size**

The Trending shelf is passed `cardWidth={148}` currently in `PublicLanding.jsx`. We'll update that to 190/200 in Task 5. For now, verify no crashes.

- [ ] **Step 5: Commit**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add apps/recipe-ui/src/components/RecipeShelf.jsx
git commit -m "feat: rewrite RecipeShelf — RecipeCard sub-component, video iframe, icon actions, bleed scroll"
```

---

## Chunk 3: New `WatchAndCook.jsx`

**Files:**
- Create: `src/components/WatchAndCook.jsx`

---

### Task 4: Create `WatchAndCook.jsx`

**Files:**
- Create: `src/components/WatchAndCook.jsx`

- [ ] **Step 1: Create the file**

Create `src/components/WatchAndCook.jsx` with this content:

```jsx
import { useRef, useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { buildVideoEmbedUrl } from '../utils/videoEmbed';

/**
 * "Watch & Cook" — Instagram Suggested-Reels style horizontal shelf.
 * Shows only TikTok/YouTube recipes as full-bleed portrait video cards.
 *
 * Props:
 *   recipes — pre-filtered embeddable recipes (parent already called buildVideoEmbedUrl)
 *   onOpen  — (recipe) => void, opens full recipe detail
 */
export default function WatchAndCook({ recipes = [], onOpen = () => {} }) {
  const rootRef = useRef(null);
  const [sectionInView, setSectionInView] = useState(false);

  // Section-level observer — one observer for all cards
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSectionInView(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!recipes.length) return null;

  return (
    <Box ref={rootRef}>
      <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>
        📺 Watch &amp; Cook
      </Typography>

      {/* Horizontal scroll row — no bleed wrapper; cards start at left edge of content */}
      <Box
        sx={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {recipes.map((recipe) => (
          <WatchCard
            key={recipe.id}
            recipe={recipe}
            sectionInView={sectionInView}
            onOpen={onOpen}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Single portrait video card for the Watch & Cook shelf.
 * Width = calc((100vw - 44px) / 2) so 2 cards are fully visible with a
 * sliver of the 3rd peeking on a 375 px screen.
 * Height derived from width via aspect-ratio: 9/16 (portrait).
 */
function WatchCard({ recipe, sectionInView, onOpen }) {
  const embedUrl = buildVideoEmbedUrl(recipe.sourceUrl);

  return (
    <Box
      onClick={() => onOpen(recipe)}
      sx={{
        flexShrink: 0,
        width: 'calc((100vw - 44px) / 2)',
        aspectRatio: '9 / 16',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: 'action.hover',
        cursor: 'pointer',
      }}
    >
      {/* Video iframe */}
      {embedUrl && (
        <Box
          component="iframe"
          src={sectionInView ? embedUrl : ''}
          title={recipe.title}
          allow="autoplay; fullscreen"
          allowFullScreen
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      )}

      {/* Static image fallback (should not appear since parent pre-filters, but safe) */}
      {!embedUrl && recipe.imageUrl && (
        <Box
          component="img"
          src={recipe.imageUrl}
          alt={recipe.title}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {/* Gradient + title overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
          zIndex: 1,
        }}
      />
      <Typography
        sx={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 2,
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {recipe.title}
      </Typography>

      {/* Transparent tap overlay — intercepts taps so onOpen fires, not the iframe */}
      <Box
        onClick={(e) => { e.stopPropagation(); onOpen(recipe); }}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          cursor: 'pointer',
        }}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Verify the file has no syntax errors**

Import it temporarily in `PublicLanding.jsx` and confirm no console errors in the browser. (The wiring step is Task 5 — just checking imports work.)

Add temporarily at the top of `PublicLanding.jsx`:
```js
import WatchAndCook from './WatchAndCook';
```

Check browser console. Remove this temporary import — the real wiring happens in Task 5.

- [ ] **Step 3: Commit**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add apps/recipe-ui/src/components/WatchAndCook.jsx
git commit -m "feat: add WatchAndCook component — portrait video shelf with section-level observer"
```

---

## Chunk 4: Wire it all together in `PublicLanding.jsx`

**Files:**
- Modify: `src/components/PublicLanding.jsx`

---

### Task 5: Update `PublicLanding.jsx`

**Files:**
- Modify: `src/components/PublicLanding.jsx`

- [ ] **Step 1: Read the current `PublicLanding.jsx`**

Familiarise yourself with the current structure. Key things:
- `trending`, `editorsPick`, `aiPicks` state
- `Stack spacing={3}` wrapping all sections
- Trending shelf uses `<RecipeShelf recipes={trending} onSave={onJoin} onOpen={onOpenRecipe} showPlatformBadge cardWidth={148} />`

- [ ] **Step 2: Add imports**

At the top of `PublicLanding.jsx`, add:

```js
import WatchAndCook from './WatchAndCook';
import { buildVideoEmbedUrl } from '../utils/videoEmbed';
```

- [ ] **Step 3: Add `onShare` handler inside the component**

Inside `PublicLanding` (after the `useState` declarations), add:

```js
const handleShare = async (recipe) => {
  const url = recipe.sourceUrl || window.location.href;
  const title = recipe.title || 'Recipe';
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch {
      // user cancelled or share failed — ignore
    }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      // No toast infrastructure in PublicLanding — silent success is fine
    } catch {
      // clipboard blocked — ignore
    }
  }
};
```

- [ ] **Step 4: Derive `videoRecipes` for Watch & Cook**

After the existing state declarations, add:

```js
const videoRecipes = trending.filter(r => buildVideoEmbedUrl(r.sourceUrl) !== null);
```

- [ ] **Step 5: Update the Stack — add `pt`, update Trending shelf, insert WatchAndCook**

Find the `<Stack spacing={3}>` in the JSX. Make these changes:

1. Add `pt: 2` to the Stack:
   ```jsx
   <Stack spacing={3} sx={{ pt: 2 }}>
   ```

2. Update the Trending `RecipeShelf` call — change `cardWidth={148}` to `cardWidth={190}` and add `cardHeight={200}` and `onShare`:
   ```jsx
   <RecipeShelf
     recipes={trending}
     onSave={onJoin}
     onShare={handleShare}
     onOpen={onOpenRecipe}
     showPlatformBadge
     cardWidth={190}
     cardHeight={200}
   />
   ```

3. After the Trending section `</Box>` closing tag, insert the Watch & Cook section:
   ```jsx
   {/* ── Watch & Cook ── */}
   {videoRecipes.length > 0 && (
     <Box>
       <WatchAndCook recipes={videoRecipes} onOpen={onOpenRecipe} />
     </Box>
   )}
   ```

The full updated Trending + WatchAndCook block should look like:

```jsx
{/* ── Section 1: Trending ── */}
{trending.length > 0 && (
  <Box>
    <SectionLabel emoji="🔥" label="Trending from the community" />
    <RecipeShelf
      recipes={trending}
      onSave={onJoin}
      onShare={handleShare}
      onOpen={onOpenRecipe}
      showPlatformBadge
      cardWidth={190}
      cardHeight={200}
    />
  </Box>
)}

{/* ── Watch & Cook ── */}
{videoRecipes.length > 0 && (
  <Box>
    <WatchAndCook recipes={videoRecipes} onOpen={onOpenRecipe} />
  </Box>
)}
```

- [ ] **Step 6: Verify in browser — full flow**

Open the public landing page (logged out). Check:

1. **Top padding** — extra space between nav bar and Trending section (vs before).
2. **Trending cards** — wider (190 px) and taller (200 px thumbnail). Clock icon + duration visible. Save + share icon buttons visible (no solid button).
3. **Left bleed scroll** — scroll right; first card bleeds off the left edge with no residual padding.
4. **Second card visible** — ~83% of the second Trending card is visible at rest.
5. **TikTok/YouTube Trending cards** — if any exist in the trending data, an iframe loads when the card scrolls into view. The video autoplays muted. Tapping the card opens the recipe detail, not the video app.
6. **Watch & Cook section** — appears below Trending if `videoRecipes.length > 0`. Two portrait cards visible + sliver of a third. Videos autoplay when section scrolls into view. Tapping a card opens recipe detail.
7. **Instagram Trending cards** — show static image (no iframe).
8. **Editor's Pick and AI Picks shelves** — unchanged (still square cards, no solid button regression — actually these now show icon buttons too, which is the intended style change).

- [ ] **Step 7: Commit**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add apps/recipe-ui/src/components/PublicLanding.jsx
git commit -m "feat: wire inline video cards into PublicLanding — enlarged Trending shelf + Watch & Cook section"
```

---

## Chunk 5: Final check and seed data verification

**Files:** No new file changes — verification only.

---

### Task 6: Verify with real seed data

- [ ] **Step 1: Check what recipes the local dev has**

The local D1 has seed recipes. Run the worker and check what `sourceUrl` values the trending endpoint returns:

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/worker
npx wrangler dev --port 8787
```

In another terminal:
```bash
curl http://localhost:8787/public/trending-recipes | jq '.recipes[] | {title, sourceUrl}'
```

Identify which (if any) are TikTok or YouTube URLs. These should show iframes; others should show static images.

- [ ] **Step 2: Add a test TikTok recipe to local D1 if none exist**

If no TikTok/YouTube recipes exist in trending, insert one temporarily for testing:

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds/apps/worker
npx wrangler d1 execute recipes-db --local --command "
INSERT INTO recipes (id, user_id, title, source_url, image_url, duration_minutes, created_at, updated_at)
VALUES (
  'test-tiktok-1',
  'seed-user',
  'Test TikTok Recipe',
  'https://www.tiktok.com/@test/video/7227802377073649926',
  NULL,
  30,
  datetime('now'),
  datetime('now')
);
"
```

Then verify it appears in trending (you may need to add it to `CURATED_TRENDING_IDS` in the worker or temporarily adjust the endpoint to include it).

- [ ] **Step 3: Visual QA checklist on phone via tunnel**

Open the tunnel URL (`https://dev-recifind.elisawidjaja.com`) on your phone:

- [ ] Trending section has extra top padding vs before
- [ ] Trending cards are wider and taller than before
- [ ] Clock icon shows before cook time on cards with duration
- [ ] Duration > 60 min shows "1 hr 30 min" format
- [ ] Save and share are icon buttons (no solid button)
- [ ] Horizontal scroll: right edge shows second card mostly visible, third card peeking
- [ ] Scroll right → first card bleeds off left edge cleanly
- [ ] TikTok card: iframe loads, video autoplays muted
- [ ] Tap on video area → recipe detail opens (not TikTok app)
- [ ] Watch & Cook section appears below Trending
- [ ] Watch & Cook cards are portrait (tall), 2 visible + sliver of 3rd
- [ ] Tap Watch & Cook card → recipe detail opens

- [ ] **Step 4: Final commit if any minor tweaks were made**

```bash
cd /Users/elisa/Desktop/VibeCode/.worktrees/discovery-feeds
git add -p  # stage only intentional changes
git commit -m "fix: visual QA tweaks for inline video cards"
```

---

## Summary of all files changed

| File | Status |
|---|---|
| `apps/recipe-ui/src/utils/videoEmbed.js` | New |
| `apps/recipe-ui/src/components/RecipeShelf.jsx` | Rewritten |
| `apps/recipe-ui/src/components/WatchAndCook.jsx` | New |
| `apps/recipe-ui/src/components/PublicLanding.jsx` | Updated |
| `apps/recipe-ui/src/App.jsx` | Minor — import formatDuration |
