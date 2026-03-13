# Friend Sections Polish — Design Spec
**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Polish the logged-in home feed (`FriendSections.jsx`) to match the visual style of the Public Landing page: remove emojis from section headers, align header typography, add show more/less to Friend Activity, and use larger card widths for Recently Saved/Shared shelves.

**File changed:** `apps/recipe-ui/src/components/FriendSections.jsx` only. No other files touched.

---

## Changes

### 1. Section headers — remove emojis + add explicit color

**Current `SectionLabel`:**
```jsx
function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} mb={1}>{children}</Typography>;
}
```

**Updated `SectionLabel`:**
```jsx
function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: 1 }}>{children}</Typography>;
}
```

**Current header strings → updated:**
| Before | After |
|--------|-------|
| `📣 Friend activity` | `Friend activity` |
| `🔖 Recently saved by friends` | `Recently saved by friends` |
| `📤 Recently shared by friends` | `Recently shared by friends` |

This matches PublicLanding's `SectionLabel` exactly (`fontWeight 700, fontSize 13, color: text.primary`).

---

### 2. Friend Activity — show more / show less

Add `const [activityExpanded, setActivityExpanded] = useState(false)` inside `FriendSections`.

**Rendering logic:**
- Default: render `.slice(0, 2)` activity items
- Expanded: render `.slice(0, 5)` activity items
- Show "Show more" link when `activity.length > 2` and `!activityExpanded`
- Show "Show less" link when `activityExpanded`
- Both links sit below the activity list, left-aligned, using a `<Typography>` with `component="button"` styling (consistent with existing button patterns in the codebase)

**"Show more" / "Show less" button style:**
```jsx
<Typography
  component="button"
  onClick={() => setActivityExpanded((prev) => !prev)}
  sx={{
    background: 'none',
    border: 'none',
    p: 0,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    color: 'primary.main',
    fontFamily: 'inherit',
  }}
>
  {activityExpanded ? 'Show less' : 'Show more'}
</Typography>
```

The toggle is a single element that switches label. It appears only when `activity.length > 2`. Place it immediately after the `<Stack>` of activity items, inside the same wrapping `<Box>` as the `<SectionLabel>` and activity stack.

Note: the button uses `color: 'primary.main'` (blue link style), intentionally more prominent than PublicLanding's muted `<Button size="small" color="text.secondary">` pattern — this is a deliberate choice for discoverability in the feed.

---

### 3. Recently Saved & Recently Shared — larger card shelf

Change both `RecipeShelf` instances from `cardWidth={130}` to `cardWidth={180}` and add `gap="8px"` to match the Trending shelf in PublicLanding.

**Before:**
```jsx
<RecipeShelf cardWidth={130} recipes={recentlySaved} ... />
<RecipeShelf cardWidth={130} recipes={recentlyShared} ... />
```

**After:**
```jsx
<RecipeShelf cardWidth={180} gap="8px" recipes={recentlySaved} ... />
<RecipeShelf cardWidth={180} gap="8px" recipes={recentlyShared} ... />
```

---

## What Does NOT Change

- `ActivityItem` component and its styling
- Data fetching logic (`/friends/activity`, `/friends/recently-saved`, `/friends/recently-shared`)
- Section visibility conditions (sections only render when data exists)
- The trailing `<Divider />` at the end of FriendSections
- Any other sections (Editor's Pick, AI Picks, Cook with Friends) rendered elsewhere
- PublicLanding.jsx — zero changes
