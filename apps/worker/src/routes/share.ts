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

  // 5. INSERT OR IGNORE — UNIQUE constraint handles duplicate shares as no-ops.
  //    Track which recipients were *newly* shared with so notifications /
  //    emails fire once per share, not again on every re-share no-op.
  let sharedWith = 0;
  let skipped = 0;
  const newlyShared: string[] = [];
  const createdAt = Date.now();
  for (const rid of ids) {
    const { meta } = await env.DB.prepare(
      'INSERT OR IGNORE INTO recipe_shares (id, sharer_id, recipient_id, recipe_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), sharerId, rid, recipeId, createdAt)
      .run();
    if (meta.changes && meta.changes > 0) {
      sharedWith++;
      newlyShared.push(rid);
    } else {
      skipped++;
    }
  }

  // Sharer name + recipe title — used by push, notification rows, and email.
  const sharer = await env.DB.prepare(
    'SELECT display_name FROM profiles WHERE user_id = ?'
  ).bind(sharerId).first<{ display_name?: string }>();
  const recipeRow = await env.DB.prepare(
    'SELECT title, image_url FROM recipes WHERE id = ?'
  ).bind(recipeId).first<{ title?: string; image_url?: string }>();
  const sharerName = sharer?.display_name ?? 'A friend';
  const recipeTitle = recipeRow?.title ?? 'a recipe';
  const recipeImage = recipeRow?.image_url ?? '';
  // ?user= lets the recipient's app resolve the recipe via the public lookup
  // endpoint (the recipe isn't in their local list yet).
  const deepLink = `https://recifriend.com/recipes/${recipeId}?user=${recipe!.user_id}`;

  // 6. Push notifications (best-effort, delivered only if the recipient has
  //    a registered device token).
  try {
    const { sendPushToUser } = await import('../push/apns');
    await Promise.all(
      ids.map((rid) =>
        sendPushToUser(env as any, rid, {
          title: 'ReciFriend',
          body: `${sharerName} just shared ${recipeTitle} with you`,
          deepLink,
        })
      )
    );
  } catch (e) {
    console.warn('push module unavailable:', (e as Error).message);
  }

  // 7. Notification rows — one per newly-shared recipient so the share
  //    surfaces in the Friend Activity ticker + unread bell. friend_shared_recipe
  //    is exempt from the public-only filter in getFriendActivity (the
  //    recipient was explicitly shared with), so private recipes still render.
  for (const rid of newlyShared) {
    await env.DB.prepare(
      'INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)'
    ).bind(
      rid,
      'friend_shared_recipe',
      `${sharerName} shared ${recipeTitle} with you`,
      JSON.stringify({ sharerId, recipeId, friendName: sharerName }),
      new Date().toISOString(),
    ).run();
    await env.DB.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
        SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
      )`
    ).bind(rid, rid).run();
  }

  // 8. Email — push-gated. Only email recipients who are NOT push-reachable
  //    (no device_tokens row) and have not opted out. As app adoption grows,
  //    push covers most users and this volume shrinks toward zero.
  try {
    const { sendEmailNotification, computeHmac } = await import('../index');
    const secret = (env as Record<string, unknown>).DEV_API_KEY as string | undefined;
    for (const rid of newlyShared) {
      const hasDevice = await env.DB.prepare(
        'SELECT 1 FROM device_tokens WHERE user_id = ? LIMIT 1'
      ).bind(rid).first();
      if (hasDevice) continue; // reachable by push — skip email
      const profile = await env.DB.prepare(
        'SELECT email, email_opt_out FROM profiles WHERE user_id = ? AND deleted_at IS NULL'
      ).bind(rid).first<{ email?: string; email_opt_out?: number }>();
      if (!profile?.email) continue;
      if (Number(profile.email_opt_out) === 1) continue;
      const unsub = secret
        ? `https://api.recifriend.com/unsubscribe?userId=${encodeURIComponent(rid)}&token=${await computeHmac(secret, rid)}`
        : 'https://recifriend.com';
      // Card layout: 80x80 thumbnail + 2-line-clamped title inside a rounded
      // theme-aware container; View recipe button lives below the card, aligned
      // with its left edge. Tables instead of flexbox for email-client
      // compatibility (Outlook etc.). -webkit-line-clamp + prefers-color-scheme
      // work in Apple Mail / Gmail web; Outlook will wrap text and stay on
      // light defaults — acceptable graceful degradation.
      const thumbnailCell = recipeImage
        ? `<td width="80" valign="top" style="width:80px;padding:0 16px 0 0;">
            <a href="${deepLink}" style="display:block;text-decoration:none;">
              <img src="${recipeImage}" alt="${recipeTitle}" width="80" height="80" style="display:block;width:80px;height:80px;object-fit:cover;border-radius:8px;border:0;" />
            </a>
          </td>`
        : '';
      const html = `<!DOCTYPE html><html><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>
        @media (prefers-color-scheme: dark) {
          .rf-card { background-color: #2a2a2a !important; }
          .rf-title { color: #fafafa !important; }
          .rf-unsub, .rf-unsub a { color: #777 !important; }
        }
      </style></head><body style="margin:0;padding:0;">
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <div class="rf-card" style="background-color:#f5f5f5;border-radius:12px;padding:12px;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
              <tr>
                ${thumbnailCell}
                <td valign="middle">
                  <p class="rf-title" style="font-size:16px;color:#1a1a1a;margin:0;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${recipeTitle}</p>
                </td>
              </tr>
            </table>
          </div>
          <div style="margin-top:16px;">
            <a href="${deepLink}" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px;font-size:14px;">View recipe</a>
          </div>
          <p class="rf-unsub" style="margin-top:32px;font-size:12px;color:#999;">
            <a href="${unsub}" style="color:#999;">Unsubscribe</a>
          </p>
        </div>
      </body></html>`;
      await sendEmailNotification(
        env as any,
        profile.email,
        `${sharerName} shared a recipe with you on ReciFriend.`,
        html,
      );
    }
  } catch (e) {
    console.warn('share email step failed:', (e as Error).message);
  }

  const response: ShareRecipeResponse = { shared_with: sharedWith, skipped };
  return json(200, response);
}
