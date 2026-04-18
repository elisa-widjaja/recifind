# Story 03 — Share Backend (Worker + D1)

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Ship `POST /recipes/:id/share` with full validation, friend checks, rate limiting, and authorization. Create `recipe_shares` D1 table. Update `GET /recipes/:id` to grant view access to shared recipients. Update `/friends/recently-shared` to query the new table.

**Depends on:** Story 01 (rebrand), Story 02 (contracts)
**Blocks:** Gate G1 (Web PWA ship)
**Can develop in parallel with:** Stories 04, 05, 06, 07, 08 (all independent of this Worker work)

**Contracts consumed:** C1 Share API (`ShareRecipeRequest`, `ShareRecipeResponse`, `ShareRecipeError`)
**Contracts produced:** HTTP contract of `POST /recipes/:id/share` consumed by Story 04 frontend and Story 05 push backend (recipe_shared push trigger)

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/worker/migrations/005_recipe_shares.sql` | D1 migration: new table + indices |
| Create | `apps/worker/src/routes/share.ts` | Handler for `POST /recipes/:id/share` |
| Create | `apps/worker/src/routes/share.test.ts` | Unit tests |
| Modify | `apps/worker/src/index.ts` | Wire handler + update GET /recipes/:id permission + /friends/recently-shared. Use marker `// === [S03] Recipe share endpoint ===` … `// === [/S03] ===` |

---

## Task 1: D1 migration

- [ ] **Step 1:** Create `apps/worker/migrations/005_recipe_shares.sql`

```sql
CREATE TABLE IF NOT EXISTS recipe_shares (
  id TEXT PRIMARY KEY,
  sharer_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  UNIQUE (sharer_id, recipient_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_shares_recipient
  ON recipe_shares(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipe_shares_sharer
  ON recipe_shares(sharer_id, created_at DESC);
```

**Note:** `UNIQUE (sharer_id, recipient_id, recipe_id)` prevents the same sharer from double-sharing the same recipe to the same recipient. Repeat shares are no-ops on the DB; the endpoint treats them as `skipped`.

- [ ] **Step 2:** Apply locally

```bash
cd apps/worker && npx wrangler d1 execute recipes-db --local --file=migrations/005_recipe_shares.sql
```

- [ ] **Step 3:** Apply remotely (after Task 3 tests pass)

```bash
npx wrangler d1 execute recipes-db --remote --file=migrations/005_recipe_shares.sql
```

- [ ] **Step 4:** Commit

```bash
git add apps/worker/migrations/005_recipe_shares.sql
git commit -m "feat(db): add recipe_shares table"
```

## Task 2: Write failing tests for the share handler

- [ ] **Step 1:** Create `apps/worker/src/routes/share.test.ts`

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { handleShareRecipe } from './share';
import type { ShareRecipeRequest } from '../../../shared/contracts';

// Test fixtures — a minimal D1/env mock
function mockEnv(opts: {
  recipeOwnerId?: string;
  visible?: boolean;
  friendsOfSharer?: string[];
  callsMade?: unknown[];
} = {}) {
  const calls: unknown[] = opts.callsMade ?? [];
  const kv = new Map<string, { count: number; resetAt: number }>();
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            calls.push({ sql, args });
            if (sql.includes('FROM recipes')) {
              return opts.visible
                ? { owner_id: opts.recipeOwnerId ?? 'other' }
                : null;
            }
            if (sql.includes('FROM friendships')) {
              return (opts.friendsOfSharer ?? []).includes(args[1] as string)
                ? { user_a: args[0], user_b: args[1] }
                : null;
            }
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        }),
      }),
    },
    KV_RATE: {
      get: async (k: string) => {
        const v = kv.get(k);
        return v ? JSON.stringify(v) : null;
      },
      put: async (k: string, v: string, opts?: unknown) => { kv.set(k, JSON.parse(v)); },
    },
  } as any;
}

describe('POST /recipes/:id/share', () => {
  const BASE_BODY: ShareRecipeRequest = { recipient_user_ids: ['u-friend'] };
  const SHARER = 'u-sharer';
  const RECIPE = 'rec-123';

  it('rejects if recipient list is empty', async () => {
    const env = mockEnv({ visible: true });
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: { recipient_user_ids: [] } });
    expect(res.status).toBe(400);
  });

  it('rejects if recipient list exceeds 50', async () => {
    const env = mockEnv({ visible: true });
    const ids = Array.from({ length: 51 }, (_, i) => `u-${i}`);
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: { recipient_user_ids: ids } });
    expect(res.status).toBe(400);
  });

  it('rejects self-share', async () => {
    const env = mockEnv({ visible: true });
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: { recipient_user_ids: [SHARER] } });
    expect(res.status).toBe(400);
  });

  it('rejects if sharer cannot view the recipe', async () => {
    const env = mockEnv({ visible: false });
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: BASE_BODY });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('skips non-friend recipients', async () => {
    const env = mockEnv({ visible: true, friendsOfSharer: [] });  // no friends
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: { recipient_user_ids: ['u-stranger'] } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('NOT_FRIENDS');
    expect(body.non_friend_user_ids).toEqual(['u-stranger']);
  });

  it('deduplicates recipient_user_ids', async () => {
    const env = mockEnv({ visible: true, friendsOfSharer: ['u-friend'] });
    const res = await handleShareRecipe({
      env, sharerId: SHARER, recipeId: RECIPE,
      body: { recipient_user_ids: ['u-friend', 'u-friend', 'u-friend'] },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shared_with).toBe(1);
  });

  it('rate limits at 20 shares per hour per user', async () => {
    const env = mockEnv({ visible: true, friendsOfSharer: ['u-friend'] });
    for (let i = 0; i < 20; i++) {
      await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: BASE_BODY });
    }
    const res = await handleShareRecipe({ env, sharerId: SHARER, recipeId: RECIPE, body: BASE_BODY });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  it('success path returns shared_with and skipped', async () => {
    const env = mockEnv({ visible: true, friendsOfSharer: ['u-a', 'u-b'] });
    const res = await handleShareRecipe({
      env, sharerId: SHARER, recipeId: RECIPE,
      body: { recipient_user_ids: ['u-a', 'u-b', 'u-stranger'] },
    });
    expect(res.status).toBe(400);  // any stranger → reject whole batch per spec
    // Alternative: if spec allows partial success, change to 200 and assert shared_with=2, skipped=1
  });
});
```

**Note:** the last test documents an ambiguity. Decision: **reject whole batch if any recipient is a non-friend** (safer — avoids silently dropping). Update spec §3 if this differs.

- [ ] **Step 2:** Run to confirm all fail

```bash
cd apps/worker && npm test -- share
```

Expected: 8 fails, mostly `handleShareRecipe is not defined`.

- [ ] **Step 3:** Commit the failing tests

```bash
git add apps/worker/src/routes/share.test.ts
git commit -m "test(share): failing tests for POST /recipes/:id/share"
```

## Task 3: Implement the handler

- [ ] **Step 1:** Create `apps/worker/src/routes/share.ts`

```typescript
import {
  SHARE_RECIPE_MAX_RECIPIENTS,
  SHARE_RECIPE_MIN_RECIPIENTS,
  SHARE_RECIPE_RATE_LIMIT_PER_HOUR,
  type ShareRecipeRequest,
  type ShareRecipeResponse,
  type ShareRecipeError,
} from '../../../shared/contracts';

type Env = {
  DB: D1Database;
  KV_RATE: KVNamespace;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleShareRecipe(args: {
  env: Env;
  sharerId: string;
  recipeId: string;
  body: ShareRecipeRequest;
}): Promise<Response> {
  const { env, sharerId, recipeId, body } = args;

  // 1. Basic request validation
  if (!Array.isArray(body.recipient_user_ids)) return json(400, { code: 'BAD_REQUEST' });
  const ids = Array.from(new Set(body.recipient_user_ids));
  if (ids.length < SHARE_RECIPE_MIN_RECIPIENTS || ids.length > SHARE_RECIPE_MAX_RECIPIENTS) {
    return json(400, { code: 'BAD_REQUEST' });
  }
  if (ids.includes(sharerId)) return json(400, { code: 'BAD_REQUEST' });

  // 2. Rate limit
  const rateKey = `share_rl:${sharerId}`;
  const now = Math.floor(Date.now() / 1000);
  const hourWindow = 3600;
  const raw = await env.KV_RATE.get(rateKey);
  const rl = raw ? JSON.parse(raw) as { count: number; resetAt: number } : null;
  const resetAt = rl && rl.resetAt > now ? rl.resetAt : now + hourWindow;
  const count = (rl && rl.resetAt > now ? rl.count : 0) + ids.length;
  if (count > SHARE_RECIPE_RATE_LIMIT_PER_HOUR) {
    const error: ShareRecipeError = { code: 'RATE_LIMITED', retry_after_seconds: resetAt - now };
    return json(429, error);
  }
  await env.KV_RATE.put(rateKey, JSON.stringify({ count, resetAt }), { expirationTtl: hourWindow });

  // 3. Sharer must be able to view the recipe
  const recipe = await env.DB.prepare(
    'SELECT owner_id, visibility FROM recipes WHERE id = ?'
  ).bind(recipeId).first<{ owner_id: string; visibility?: string }>();

  if (!recipe) return json(404, { code: 'NOT_FOUND' });

  const canView =
    recipe.owner_id === sharerId ||
    recipe.visibility === 'public' ||
    // NEW: allow if sharer already received this recipe via a share
    !!(await env.DB.prepare(
      'SELECT 1 FROM recipe_shares WHERE recipient_id = ? AND recipe_id = ? LIMIT 1'
    ).bind(sharerId, recipeId).first());

  if (!canView) {
    const error: ShareRecipeError = { code: 'FORBIDDEN' };
    return json(403, error);
  }

  // 4. Every recipient must be a confirmed friend
  const friendship = env.DB.prepare(
    'SELECT 1 FROM friendships WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)) AND status = ?'
  );
  const nonFriends: string[] = [];
  for (const rid of ids) {
    const row = await friendship.bind(sharerId, rid, rid, sharerId, 'accepted').first();
    if (!row) nonFriends.push(rid);
  }
  if (nonFriends.length > 0) {
    const error: ShareRecipeError = { code: 'NOT_FRIENDS', non_friend_user_ids: nonFriends };
    return json(400, error);
  }

  // 5. Insert. Use UNIQUE constraint to handle redundant shares as no-ops.
  let sharedWith = 0;
  let skipped = 0;
  const id = () => crypto.randomUUID();
  const createdAt = Date.now();
  for (const rid of ids) {
    const { meta } = await env.DB.prepare(
      'INSERT OR IGNORE INTO recipe_shares (id, sharer_id, recipient_id, recipe_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id(), sharerId, rid, recipeId, createdAt).run();
    if (meta.changes && meta.changes > 0) sharedWith++; else skipped++;
  }

  // 6. Fire push notifications — imported dynamically to avoid coupling with Story 05
  //    See Story 05 for actual implementation. No-op until Story 05 merges.
  try {
    const { sendPushToUser } = await import('../push/apns');
    const sharer = await env.DB.prepare(
      'SELECT display_name FROM profiles WHERE id = ?'
    ).bind(sharerId).first<{ display_name?: string }>();
    const recipeTitle = await env.DB.prepare(
      'SELECT title FROM recipes WHERE id = ?'
    ).bind(recipeId).first<{ title?: string }>();
    await Promise.all(ids.map((rid) =>
      sendPushToUser(env, rid, {
        title: 'ReciFriend',
        body: `${sharer?.display_name ?? 'A friend'} just shared a ${recipeTitle?.title ?? 'recipe'} with you. View >`,
        deepLink: `https://recifriend.com/recipes/${recipeId}`,
      })
    ));
  } catch (e) {
    // Story 05 not merged yet — log and continue. The share row is already durable.
    console.warn('push module not available yet:', (e as Error).message);
  }

  const response: ShareRecipeResponse = { shared_with: sharedWith, skipped };
  return json(200, response);
}
```

- [ ] **Step 2:** Run tests

```bash
cd apps/worker && npm test -- share
```

Expected: 8 tests pass. If failures, fix handler (do NOT relax tests).

- [ ] **Step 3:** Commit

```bash
git add apps/worker/src/routes/share.ts
git commit -m "feat(share): implement POST /recipes/:id/share"
```

## Task 4: Wire handler into index.ts + update GET /recipes/:id

- [ ] **Step 1:** Edit `apps/worker/src/index.ts` — add section with S03 markers:

```typescript
// === [S03] Recipe share endpoint ===
import { handleShareRecipe } from './routes/share';
// ...inside the router (match your existing style):
if (request.method === 'POST' && url.pathname.match(/^\/recipes\/[^/]+\/share$/)) {
  const recipeId = url.pathname.split('/')[2];
  const body = await request.json();
  return await handleShareRecipe({ env, sharerId: userId, recipeId, body });
}
// === [/S03] ===
```

- [ ] **Step 2:** Update `GET /recipes/:id` permission check — find the existing handler and extend the "can view" logic to include a check against `recipe_shares`. Wrap the new check in S03 markers inside the existing handler.

- [ ] **Step 3:** Update `/friends/recently-shared` to query the new table:

```typescript
// Replace existing query with:
SELECT r.*, rs.created_at as shared_at, rs.sharer_id
FROM recipe_shares rs
JOIN recipes r ON r.id = rs.recipe_id
WHERE rs.recipient_id = ?
ORDER BY rs.created_at DESC
LIMIT 10
```

- [ ] **Step 4:** Local integration smoke

```bash
cd apps/worker && npx wrangler dev --port 8787 --remote
# In another shell:
curl -X POST http://localhost:8787/recipes/seed-edit-01/share \
  -H "Authorization: Bearer $DEV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"recipient_user_ids":["existing-friend-id"]}'
```

- [ ] **Step 5:** Commit

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): wire POST /recipes/:id/share + update view permission"
```

## Task 5: Deploy

- [ ] **Step 1:** Apply migration remotely (if not already)

```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --file=migrations/005_recipe_shares.sql
```

- [ ] **Step 2:** Deploy worker

```bash
npx wrangler deploy
```

- [ ] **Step 3:** Smoke test against prod

```bash
curl -X POST https://api.recifriend.com/recipes/seed-edit-01/share \
  -H "Authorization: Bearer <a-real-JWT>" \
  -H "Content-Type: application/json" \
  -d '{"recipient_user_ids":["a-real-friend-id"]}'
```

Expected: `200 { shared_with: 1, skipped: 0 }` (or `404`/`400`/`403` for the appropriate case).

## Acceptance criteria

- [ ] All 8 unit tests pass (`npm test -- share`)
- [ ] Migration applied locally and remotely
- [ ] `POST /recipes/:id/share` returns shaped responses per C1 contract
- [ ] Rate limit works (21st call within an hour → 429)
- [ ] Self-share rejected with 400
- [ ] Non-friend recipient rejected with 400 + non_friend_user_ids list
- [ ] Sharer without view permission rejected with 403
- [ ] Shared recipient gains view permission on private recipe (via `GET /recipes/:id` check)
- [ ] `/friends/recently-shared` returns rows from `recipe_shares`
- [ ] All S03-marked edits live inside `// === [S03] ===` marker pairs in `apps/worker/src/index.ts`

## Commit checklist

- `feat(db): add recipe_shares table`
- `test(share): failing tests ...`
- `feat(share): implement POST /recipes/:id/share`
- `feat(worker): wire POST /recipes/:id/share + update view permission`
