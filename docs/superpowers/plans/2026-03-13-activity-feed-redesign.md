# Activity Feed Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the logged-in home feed activity section to look like a compact social timeline — grouped card, larger avatars, inline friend-action sentences, and recipe thumbnails.

**Architecture:** Two independent changes: (1) enrich the `/friends/activity` backend response with structured `friendName` and `recipe` fields via a batch recipe lookup; (2) rewrite the `ActivityItem` UI component in `FriendSections.jsx` to consume the enriched data.

**Tech Stack:** React + MUI (frontend), Cloudflare Worker + D1 SQLite (backend), Vitest (worker tests)

---

## Chunk 1: Backend — Enrich `/friends/activity`

### Task 1: Enrich `getFriendActivity` with recipe data and friendName

**Files:**
- Modify: `apps/worker/src/index.ts` — `getFriendActivity` function (~line 1220)
- Modify: `apps/worker/src/index.ts` — cook event `addNotification` call (~line 364)
- Modify: `apps/worker/src/friends-discovery.test.ts` — update existing test, add new tests

---

- [ ] **Step 1: Update the existing `getFriendActivity` test to assert the new response shape**

Open `apps/worker/src/friends-discovery.test.ts`. Replace the `getFriendActivity` describe block with:

```typescript
describe('getFriendActivity', () => {
  it('returns notifications enriched with recipe and friendName', async () => {
    const notificationRows = [
      {
        id: 1,
        type: 'friend_cooked_recipe',
        message: 'Sarah cooked Spicy Thai Noodles 🍳',
        data: JSON.stringify({ cookerId: 'cook-1', recipeId: 'recipe-1', friendName: 'Sarah' }),
        created_at: '2026-03-10T10:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-1', title: 'Spicy Thai Noodles', image_url: 'https://example.com/img.jpg' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result).toHaveLength(1);
    expect(result[0].friendName).toBe('Sarah');
    expect(result[0].recipe?.title).toBe('Spicy Thai Noodles');
    expect(result[0].recipe?.imageUrl).toBe('https://example.com/img.jpg');
  });

  it('falls back to first word of message when friendName not in data blob', async () => {
    const notificationRows = [
      {
        id: 2,
        type: 'friend_cooked_recipe',
        message: 'Marco cooked Margherita Pizza 🍳',
        data: JSON.stringify({ cookerId: 'cook-2', recipeId: 'recipe-2' }), // no friendName
        created_at: '2026-03-10T09:00:00Z',
        read: 0,
      },
    ];
    const recipeRows = [
      { id: 'recipe-2', title: 'Margherita Pizza', image_url: '' },
    ];

    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) })
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: recipeRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].friendName).toBe('Marco');
  });

  it('returns recipe as null when recipeId is absent from data blob', async () => {
    const notificationRows = [
      {
        id: 3,
        type: 'friend_request',
        message: 'Jules sent you a friend request',
        data: JSON.stringify({ fromUserId: 'user-3' }), // no recipeId — second db.prepare is NOT called
        created_at: '2026-03-09T08:00:00Z',
        read: 0,
      },
    ];

    // Only one prepare call happens here: the implementation skips the batch recipe
    // fetch entirely when recipeIds is empty. A second mockReturnValueOnce is intentionally
    // absent to guard against a regression where the implementation fires a second query anyway.
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: notificationRows }) }),
    } as unknown as D1Database;

    const result = await getFriendActivity(mockDb, 'user-123');
    expect(result[0].recipe).toBeNull();
    expect(result[0].friendName).toBe('Jules'); // fallback: message.split(' ')[0]
    expect(mockDb.prepare).toHaveBeenCalledTimes(1); // confirms no spurious second query
  });
});
```

- [ ] **Step 2: Run existing tests to confirm they fail with the new assertions**

```bash
cd apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A5 "getFriendActivity"
```

Expected: failures on `friendName` and `recipe` assertions (properties don't exist yet).

- [ ] **Step 3: Rewrite `getFriendActivity` in `apps/worker/src/index.ts`**

Replace the current function (lines 1220–1232) with:

```typescript
export async function getFriendActivity(
  db: D1Database,
  userId: string
): Promise<Array<{
  id: number;
  type: string;
  message: string;
  friendName: string | null;
  recipe: { id: string; title: string; imageUrl: string } | null;
  data: unknown;
  createdAt: string;
  read: boolean;
}>> {
  const rows = await db.prepare(
    `SELECT id, type, message, data, created_at, read FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
  ).bind(userId).all();

  const parsed = (rows.results as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    type: String(r.type),
    message: String(r.message),
    data: JSON.parse(String(r.data || '{}')),
    createdAt: String(r.created_at),
    read: Boolean(r.read),
  }));

  // Collect unique recipeIds for batch fetch
  const recipeIds = [...new Set(
    parsed
      .map(item => (item.data as Record<string, unknown>).recipeId as string | undefined)
      .filter((id): id is string => Boolean(id))
  )];

  // Batch fetch recipes in one query
  const recipeMap = new Map<string, { id: string; title: string; imageUrl: string }>();
  if (recipeIds.length > 0) {
    const placeholders = recipeIds.map(() => '?').join(', ');
    const recipeRows = await db.prepare(
      `SELECT id, title, image_url FROM recipes WHERE id IN (${placeholders})`
    ).bind(...recipeIds).all();
    for (const r of (recipeRows.results as Array<Record<string, unknown>>)) {
      recipeMap.set(String(r.id), {
        id: String(r.id),
        title: String(r.title),
        imageUrl: String(r.image_url || ''),
      });
    }
  }

  return parsed.map(item => {
    const d = item.data as Record<string, unknown>;
    const recipeId = d.recipeId as string | undefined;
    const friendName: string | null =
      (d.friendName as string | undefined) ?? item.message.split(' ')[0] ?? null;

    return {
      ...item,
      friendName,
      recipe: recipeId ? (recipeMap.get(recipeId) ?? null) : null,
    };
  });
}
```

- [ ] **Step 4: Run tests — verify all `getFriendActivity` tests pass**

```bash
cd apps/worker && npm test -- --reporter=verbose 2>&1 | grep -A3 "getFriendActivity"
```

Expected: all 3 `getFriendActivity` tests pass. Other test suites should be unaffected.

- [ ] **Step 5: Fix the cook-event `addNotification` call — add `friendName` and fix `createdAt` key**

In `apps/worker/src/index.ts`, find the full `addNotification` call for cook events (~line 364–369). Replace it in one edit:

```typescript
// Before:
await addNotification(env, f.friend_id as unknown as string, {
  type: 'friend_cooked_recipe',
  message: `${cookerName} cooked ${recipeName} 🍳`,
  data: { cookerId: user.userId, recipeId },
  created_at: new Date().toISOString(),
});

// After (adds friendName to data; fixes created_at → createdAt bug):
await addNotification(env, f.friend_id as unknown as string, {
  type: 'friend_cooked_recipe',
  message: `${cookerName} cooked ${recipeName} 🍳`,
  data: { cookerId: user.userId, recipeId, friendName: cookerName },
  createdAt: new Date().toISOString(),
});
```

Note: `cookerName` is already in scope (line 361). The `created_at` key was a pre-existing bug — confirm by checking the `addNotification` signature at ~line 2491: it accepts `Omit<NotificationItem, 'read'>` and reads `notification.createdAt` (camelCase). The old `created_at` key was silently ignored, causing `undefined` to be stored in the DB timestamp column.

- [ ] **Step 6: Run full test suite to confirm nothing is broken**

```bash
cd apps/worker && npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd apps/worker
git add src/index.ts src/friends-discovery.test.ts
git commit -m "feat(worker): enrich /friends/activity with recipe and friendName fields"
```

---

## Chunk 2: Frontend — Redesign ActivityItem

### Task 2: Rewrite `ActivityItem` and update `FriendSections` container

**Files:**
- Modify: `apps/recipe-ui/src/components/FriendSections.jsx` — `ActivityItem` component, container markup, section label, expand logic, `timeAgo` guard

---

- [ ] **Step 1: Fix the `timeAgo` NaN guard**

In `apps/recipe-ui/src/components/FriendSections.jsx`, update the `timeAgo` function (lines 16–23):

```jsx
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return '';
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'yesterday' : `${diffD}d`;
}
```

- [ ] **Step 2: Update the section header label**

Find the `SectionLabel` usage for activity (line 74):

```jsx
// Before:
<SectionLabel>Activity Feeds</SectionLabel>

// After:
<SectionLabel>Friend Activity</SectionLabel>
```

- [ ] **Step 3: Update the expand/collapse label to show count**

Find the expand button inside the activity section (lines 80–96). Replace the button text:

```jsx
// Before (lines 84–96):
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

// After:
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
  {activityExpanded ? 'Show less' : `+ ${activity.length - 2} more`}
</Typography>
```

- [ ] **Step 4: Wrap activity items in a grouped card and pass `onOpenRecipe`**

Find the `Stack` that renders activity items (lines 75–79). Replace:

```jsx
// Before:
<Stack spacing={0.75}>
  {activity.slice(0, activityExpanded ? 5 : 2).map(item => (
    <ActivityItem key={item.id} item={item} />
  ))}
</Stack>

// After:
<Box sx={{
  bgcolor: 'background.paper',
  borderRadius: '12px',
  boxShadow: '0 1px 4px rgba(0,0,0,.08)',
  overflow: 'hidden',
}}>
  {activity.slice(0, activityExpanded ? 5 : 2).map((item, index, arr) => (
    <Box key={item.id}>
      <ActivityItem item={item} onOpenRecipe={onOpenRecipe} />
      {index < arr.length - 1 && (
        <Box sx={{ height: '1px', bgcolor: '#f0f0f0', mx: '12px' }} />
      )}
    </Box>
  ))}
</Box>
```

- [ ] **Step 5: Rewrite `ActivityItem`**

Find the `ActivityItem` function (lines 169–187) and the `AVATAR_COLORS` constant (line 167). Replace both:

```jsx
const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

const VERB_MAP = {
  friend_cooked_recipe: 'cooked',
  friend_saved_recipe: 'saved',
  friend_shared_recipe: 'shared',
};

function ActivityItem({ item, onOpenRecipe }) {
  const friendName = item.friendName ?? '?';
  const colorIndex = item.id % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[Math.abs(colorIndex)];
  const initial = friendName.charAt(0).toUpperCase();
  const verb = VERB_MAP[item.type] ?? 'interacted with';
  const recipeTitle = item.recipe?.title ?? '';

  function handleClick() {
    if (item.recipe) onOpenRecipe?.(item.recipe);
  }

  return (
    <Box
      onClick={handleClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        px: '10px',
        py: '8px',
        cursor: item.recipe ? 'pointer' : 'default',
        '&:hover': item.recipe ? { bgcolor: 'action.hover' } : {},
      }}
    >
      {/* Avatar */}
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{initial}</Typography>
      </Box>

      {/* Sentence */}
      <Typography sx={{
        flex: 1,
        fontSize: 12,
        lineHeight: 1.4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        <Box component="span" sx={{ fontWeight: 600, color: '#111' }}>{friendName}</Box>
        <Box component="span" sx={{ color: '#666' }}> {verb} </Box>
        <Box component="span" sx={{ fontWeight: 600, color: '#111' }}>{recipeTitle}</Box>
      </Typography>

      {/* Timestamp */}
      <Typography sx={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>

      {/* Thumbnail */}
      <Box sx={{
        width: 44, height: 44, borderRadius: '8px', flexShrink: 0,
        overflow: 'hidden', bgcolor: 'action.hover',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.recipe?.imageUrl
          ? <Box component="img" src={item.recipe.imageUrl} alt={recipeTitle}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Typography sx={{ fontSize: 20 }}>🍳</Typography>
        }
      </Box>
    </Box>
  );
}
```

- [ ] **Step 6: Verify the app renders correctly in dev**

Start the dev server (or check an already-running one):

```bash
cd apps/recipe-ui && npm run dev
```

Open the app in the browser, log in, and verify:
- "Friend Activity" section label appears (not "Activity Feeds")
- Each activity row shows: gradient avatar circle, inline sentence, timestamp, thumbnail
- All rows are inside one grouped card with dividers
- "Show less" / "+ N more" expand/collapse works
- Tapping a row opens the recipe detail

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-ui/src/components/FriendSections.jsx
git commit -m "feat(ui): redesign activity feed as compact social timeline"
```
