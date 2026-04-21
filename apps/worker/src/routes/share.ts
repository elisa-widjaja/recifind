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
  [key: string]: unknown;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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

  // 2. Rate limit via KV (counts total recipients per hour)
  const rateKey = `share_rl:${sharerId}`;
  const now = Math.floor(Date.now() / 1000);
  const hourWindow = 3600;
  const raw = await env.KV_RATE.get(rateKey);
  const rl = raw ? (JSON.parse(raw) as { count: number; resetAt: number }) : null;
  const resetAt = rl && rl.resetAt > now ? rl.resetAt : now + hourWindow;
  const currentCount = rl && rl.resetAt > now ? rl.count : 0;
  const newCount = currentCount + ids.length;
  if (newCount > SHARE_RECIPE_RATE_LIMIT_PER_HOUR) {
    const error: ShareRecipeError = { code: 'RATE_LIMITED', retry_after_seconds: resetAt - now };
    return json(429, error);
  }
  await env.KV_RATE.put(rateKey, JSON.stringify({ count: newCount, resetAt }), {
    expirationTtl: hourWindow,
  });

  // 3. Sharer must be able to view the recipe:
  //    - owner (user_id matches sharer), OR
  //    - shared_with_friends = 1 (public to friends), OR
  //    - sharer has a recipe_shares row as recipient (received it via share)
  const recipe = await env.DB.prepare(
    'SELECT user_id, shared_with_friends FROM recipes WHERE id = ?'
  )
    .bind(recipeId)
    .first<{ user_id: string; shared_with_friends: number }>();

  let canView = false;
  if (recipe) {
    canView =
      recipe.user_id === sharerId ||
      recipe.shared_with_friends === 1 ||
      // === [S03] Recipe share endpoint ===
      !!(await env.DB.prepare(
        'SELECT 1 FROM recipe_shares WHERE recipient_id = ? AND recipe_id = ? LIMIT 1'
      )
        .bind(sharerId, recipeId)
        .first());
    // === [/S03] ===
  }

  if (!canView) {
    const error: ShareRecipeError = { code: 'FORBIDDEN' };
    return json(403, error);
  }

  // 4. Every recipient must be a confirmed friend
  //    (friends table is bidirectional: one row per direction)
  const nonFriends: string[] = [];
  for (const rid of ids) {
    const row = await env.DB.prepare(
      'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
    )
      .bind(sharerId, rid)
      .first();
    if (!row) nonFriends.push(rid);
  }
  if (nonFriends.length > 0) {
    const error: ShareRecipeError = { code: 'NOT_FRIENDS', non_friend_user_ids: nonFriends };
    return json(400, error);
  }

  // 5. INSERT OR IGNORE — UNIQUE constraint handles duplicate shares as no-ops
  let sharedWith = 0;
  let skipped = 0;
  const createdAt = Date.now();
  for (const rid of ids) {
    const { meta } = await env.DB.prepare(
      'INSERT OR IGNORE INTO recipe_shares (id, sharer_id, recipient_id, recipe_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), sharerId, rid, recipeId, createdAt)
      .run();
    if (meta.changes && meta.changes > 0) {
      sharedWith++;
    } else {
      skipped++;
    }
  }

  // 6. Fire push notifications — dynamic import to avoid hard coupling with Story 05
  //    No-op until Story 05 merges; share rows are already durable.
  try {
    const { sendPushToUser } = await import('../push/apns');
    const sharer = await env.DB.prepare(
      'SELECT display_name FROM profiles WHERE user_id = ?'
    )
      .bind(sharerId)
      .first<{ display_name?: string }>();
    const recipeRow = await env.DB.prepare(
      'SELECT title FROM recipes WHERE id = ?'
    )
      .bind(recipeId)
      .first<{ title?: string }>();
    await Promise.all(
      ids.map((rid) =>
        sendPushToUser(env as any, rid, {
          title: 'ReciFriend',
          body: `${sharer?.display_name ?? 'A friend'} just shared ${recipeRow?.title ?? 'a recipe'} with you`,
          deepLink: `https://recifriend.com/recipes/${recipeId}`,
        })
      )
    );
  } catch (e) {
    // Story 05 not merged yet — push module unavailable. Share is still durable.
    console.warn('push module not available yet:', (e as Error).message);
  }

  const response: ShareRecipeResponse = { shared_with: sharedWith, skipped };
  return json(200, response);
}
