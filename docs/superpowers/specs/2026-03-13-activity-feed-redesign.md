# Activity Feed Redesign — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Scope:** `FriendSections.jsx` — the "Friend Activity" section only

---

## Goal

Make the logged-in home feed activity section look more modern and social media-style while staying compact and scannable.

---

## Visual Design

### Container

All activity items live inside a single grouped card:

- White background, `border-radius: 12px`, `box-shadow: 0 1px 4px rgba(0,0,0,.08)`
- Thin divider (`1px solid #f0f0f0`) between rows, inset 12px from the left and right edges
- No per-item card or shadow

### Each Activity Row

Single horizontal row, left to right:

| Element | Detail |
|---|---|
| **Avatar** | 32×32px circle, solid fill from existing `AVATAR_COLORS` palette (no gradient change needed), white initial letter, 13px bold. Initial comes from `friendName.charAt(0)`, replacing the old `item.message.charAt(0)` derivation. |
| **Sentence** | `<Typography>` at 12px: **[friendName]** (fontWeight 600, color `#111`) + action verb (color `#666`) + **[recipe.title]** (fontWeight 600, color `#111`). Single line, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the full sentence element. |
| **Timestamp** | Right-aligned, 10px, `color: #bbb`, `flex-shrink: 0`. Uses existing `timeAgo(item.createdAt)`. |
| **Thumbnail** | 44×44px, `border-radius: 8px`, `object-fit: cover`. Shows `item.recipe?.imageUrl` or emoji fallback `🍳` if image is absent or recipe is null. |

Row padding: `8px 10px`. The entire row is tappable and calls `onOpenRecipe(item.recipe)` when `item.recipe` is present; no-op if recipe is null.

### Action verb mapping

| `item.type` | Verb shown |
|---|---|
| `friend_cooked_recipe` | `cooked` |
| `friend_saved_recipe` | `saved` |
| `friend_shared_recipe` | `shared` |
| anything else | `interacted with` |

### Section Header

Change label from `"Activity Feeds"` → `"Friend Activity"` (the `SectionLabel` component renders children as-is, so no CSS change needed — just update the string).

### Expand / Collapse

- Default: show 2 rows
- When `activity.length > 2`: show `"+ N more"` link (N = total minus 2). Intentional change from current `"Show more"` — the count is more informative.
- Expanded: show up to 5 rows, show `"Show less"` to collapse
- Link style: 12px, `color: primary.main`, no underline, `background: none; border: none; cursor: pointer`

### Loading / Empty States

- Loading: keep existing `return null` while `loaded` is false — no skeleton needed for this iteration. Note: a pre-existing bug in the `friend_cooked_recipe` notification writer stores `created_at` under the wrong key, so some older activity rows may have an invalid timestamp. Guard `timeAgo` against `NaN`: `if (isNaN(diffMs)) return ''`.
- Zero items: keep existing `hasActivity` guard — section is hidden entirely if no activity
- Missing recipe: row still renders but thumbnail shows fallback emoji; `onOpenRecipe` is skipped (guard with `if (item.recipe)`)

---

## Data — Backend Enrichment

### Current shape

`GET /friends/activity` returns items from the `notifications` table:

```json
{ "id": 1, "type": "friend_cooked_recipe", "message": "Sarah cooked Spicy Thai Noodles 🍳", "data": { "cookerId": "uuid", "recipeId": "uuid" }, "createdAt": "..." }
```

### New shape

Add three fields to each item:

```json
{
  "id": 1,
  "type": "friend_cooked_recipe",
  "message": "Sarah cooked Spicy Thai Noodles 🍳",
  "friendName": "Sarah",
  "data": { "cookerId": "uuid", "recipeId": "uuid" },
  "recipe": { "id": "uuid", "title": "Spicy Thai Noodles", "imageUrl": "https://..." },
  "createdAt": "..."
}
```

### How to enrich (backend)

In `getFriendActivity` in `apps/worker/src/index.ts`:

1. Fetch notifications as today (LIMIT 10, ordered by `created_at DESC`).
2. Extract unique `recipeId`s from each row's `data` JSON blob: `JSON.parse(r.data).recipeId`.
3. Batch-fetch those recipes in a single query: `SELECT id, title, image_url FROM recipes WHERE id IN (?, ?, ...)`.
4. Build a `Map<recipeId, recipe>` and attach to each notification item.
5. For `friendName`: **Simpler path**: add `friendName` to the `data` blob at notification write time (update the `addNotification` call for `friend_cooked_recipe` to include `friendName` in `data`). For existing rows without `friendName` in `data`, fall back to `message.split(' ')[0]` — note this only works correctly for single-word first names; multi-word display names (e.g. "Mary Jane") will be truncated to the first word. This is acceptable for the fallback path since it only affects old rows and a partial name is still recognisable.
6. Update the `getFriendActivity` return type to include `friendName: string | null` and `recipe: { id, title, imageUrl } | null`.
7. Keep LIMIT 10 (UI shows max 5; headroom is fine, no need to tighten).

### Frontend changes

`ActivityItem` receives the enriched item. Remove `item.message.charAt(0)` — use `item.friendName?.charAt(0) ?? '?'` for the avatar initial. Use `item.type` to look up the action verb from the mapping table above.

`FriendSections` must pass `onOpenRecipe` down to `ActivityItem` at the render site (currently it is not passed). Update:

```jsx
// Before:
<ActivityItem key={item.id} item={item} />

// After:
<ActivityItem key={item.id} item={item} onOpenRecipe={onOpenRecipe} />
```

---

## Files Changed

| File | Change |
|---|---|
| `apps/recipe-ui/src/components/FriendSections.jsx` | Rewrite `ActivityItem` component with new layout; update grouped-card container markup; pass `onOpenRecipe` to `ActivityItem` at render site; update section header string; update expand label |
| `apps/worker/src/index.ts` | Enrich `getFriendActivity` with `recipe` batch fetch and `friendName` extraction; update `addNotification` call for `friend_cooked_recipe` to store `friendName` in `data` blob |

No new files. No schema migration needed.
