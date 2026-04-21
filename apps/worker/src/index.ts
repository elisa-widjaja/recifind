// === [S03] Recipe share endpoint ===
import { handleShareRecipe } from './routes/share';
// === [/S03] ===
// === [S05] Device registration + push triggers ===
import { handleRegisterDevice, handleUnregisterDevice } from './routes/devices';
import { sendPushToUser } from './push/apns';
// === [/S05] ===

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per preview upload.
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes.
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language';

export interface Env {
  DB: D1Database;
  AI_PICKS_CACHE: KVNamespace;
  KV_RATE: KVNamespace;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
  DEV_API_KEY?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
  SUPABASE_JWT_SECRET?: string;
  GEMINI_SERVICE_ACCOUNT_B64?: string;
  RESEND_API_KEY?: string;
  // === [S05] APNs secrets ===
  APNS_AUTH_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_HOST?: string;
  // === [/S05] ===
}

interface Recipe {
  id: string;
  userId: string;
  title: string;
  sourceUrl: string;
  imageUrl: string;
  imagePath?: string | null;
  mealTypes: string[];
  ingredients: string[];
  steps: string[];
  durationMinutes: number | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  previewImage?: ImageMetadata | null;
  sharedWithFriends?: boolean;
}

interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  cookingFor: string | null;
  cuisinePrefs: string[];
  dietaryPrefs: string[];
}


interface Friend {
  friendId: string;
  friendEmail: string;
  friendName: string;
  connectedAt: string;
}

interface NotificationItem {
  type: 'friend_request' | 'friend_accepted' | 'friend_cooked_recipe' | 'friend_saved_recipe';
  message: string;
  data: Record<string, string>;
  createdAt: string;
  read: boolean;
}


interface ImageMetadata {
  objectKey: string;
  contentType: string;
  size: number;
  source?: string | null;
  uploadedAt: string;
  publicUrl?: string | null;
}

interface PreviewImagePayload {
  data?: string;
  dataUrl?: string;
  contentType?: string;
  url?: string;
  filename?: string;
  remove?: boolean;
}

interface ParsedRecipeDetails {
  title: string;
  ingredients: string[];
  steps: string[];
  mealTypes: string[];
  durationMinutes: number | null;
  imageUrl: string;
}

interface AuthenticatedUser {
  userId: string;
  email?: string;
  claims: Record<string, unknown>;
}

interface NormalizedRecipePayload {
  recipe: Recipe;
  previewImagePayload: PreviewImagePayload | null;
}

interface ExtendedJsonWebKey extends JsonWebKey {
  kid?: string;
}

interface JwksCacheEntry {
  keys: ExtendedJsonWebKey[];
  expiresAt: number;
}

interface GeminiServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id?: string;
}

interface CallGeminiDeps {
  fetchImpl?: typeof fetch;
  getAccessToken?: (env: Env) => Promise<string>;
  getServiceAccount?: (env: Env) => Promise<GeminiServiceAccount>;
}

interface RecipeCollectionMeta {
  count: number;
  updatedAt: string;
  version: number;
}

const MAX_EXISTING_CONTEXT_CHARS = 2000;
const KNOWN_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'dessert', 'appetizer', 'snack'];
const textEncoder = new TextEncoder();
const jwksCache = new Map<string, JwksCacheEntry>();
let geminiAccessTokenCache: { token: string; expiresAt: number } | null = null;
let geminiServiceAccountCache: GeminiServiceAccount | null = null;
let geminiSigningKey: CryptoKey | null = null;

class HttpError extends Error {
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const withCors = (headers: HeadersInit = {}) => ({ ...CORS_HEADERS, ...headers });

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: withCors({ 'Content-Type': 'application/json', ...headers })
  });

function makeEtag(value: string): string {
  return `"${value}"`;
}

function checkConditional(request: Request, etag: string, lastModified?: Date): Response | null {
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch) {
    const tags = ifNoneMatch.split(',').map(t => t.trim());
    if (tags.includes(etag) || tags.includes('*')) {
      return new Response(null, { status: 304, headers: withCors({ 'ETag': etag }) });
    }
  }
  if (lastModified) {
    const ifModSince = request.headers.get('If-Modified-Since');
    if (ifModSince) {
      const clientDate = new Date(ifModSince).getTime();
      // Truncate to seconds for HTTP date comparison
      const serverDate = Math.floor(lastModified.getTime() / 1000) * 1000;
      if (!isNaN(clientDate) && serverDate <= clientDate) {
        return new Response(null, { status: 304, headers: withCors({ 'ETag': etag }) });
      }
    }
  }
  return null;
}

function cacheHeaders(opts: {
  visibility: 'public' | 'private';
  maxAge: number;
  etag: string;
  lastModified?: Date;
  immutable?: boolean;
}): Record<string, string> {
  const h: Record<string, string> = {};
  const parts = [opts.visibility, `max-age=${opts.maxAge}`];
  if (opts.immutable) parts.push('immutable');
  h['Cache-Control'] = parts.join(', ');
  h['ETag'] = opts.etag;
  if (opts.lastModified) {
    h['Last-Modified'] = opts.lastModified.toUTCString();
  }
  return h;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      // === [rebrand] 301 from old domain (path + query preserved) ===
      if (url.hostname === 'recifind.elisawidjaja.com') {
        const dest = new URL(url.pathname + url.search + url.hash, 'https://recifriend.com');
        return Response.redirect(dest.toString(), 301);
      }
      // === [/rebrand] ===

      if (request.method === 'OPTIONS') {
        return handleOptions();
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return new Response('ok', { headers: withCors() });
      }

      // Public endpoint to get recipe credit/author from source URL via oEmbed
      if (url.pathname === '/public/oembed-author' && request.method === 'GET') {
        return await handleOembedAuthor(url);
      }

      // Public endpoint to get trending community recipes
      if (url.pathname === '/public/trending-recipes' && request.method === 'GET') {
        return await (async () => {
          const recipes = await getTrendingRecipes(env.DB);
          return json({ recipes }, 200, withCors());
        })();
      }

      // Public endpoint to get discovery feed (social media recipes)
      if (url.pathname === '/public/discover' && request.method === 'GET') {
        return await (async () => {
          const recipes = await getPublicDiscover(env.DB);
          return json({ recipes }, 200, withCors());
        })();
      }

      // Public endpoint to get editor's pick recipes
      if (url.pathname === '/public/editors-pick' && request.method === 'GET') {
        return await (async () => {
          const recipes = await getEditorsPick(env.DB);
          return json({ recipes }, 200, withCors());
        })();
      }

      if (url.pathname === '/public/ai-picks' && request.method === 'GET') {
        return await (async () => {
          const prefs = {
            mealTypes: url.searchParams.get('meal_types') || undefined,
            diet: url.searchParams.get('diet') || undefined,
            skill: url.searchParams.get('skill') || undefined,
            cuisine: url.searchParams.get('cuisine') || undefined,
            cookingFor: url.searchParams.get('cooking_for') || undefined,
          };
          const picks = await getAiPicks(env.DB, env.AI_PICKS_CACHE, callGemini, env, prefs);
          return json({ picks }, 200, withCors());
        })();
      }

      // Public endpoint to submit user feedback
      if (url.pathname === '/feedback' && request.method === 'POST') {
        const body = await request.json() as { message?: string; senderEmail?: string };
        if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
          return json({ error: 'Message is required' }, 400, withCors());
        }
        const message = body.message.trim().slice(0, 2000);
        const senderEmail = typeof body.senderEmail === 'string' ? body.senderEmail.trim() : '';
        const replyLine = senderEmail ? `<p style="margin: 0 0 8px; color: #555;"><strong>Reply to:</strong> ${senderEmail}</p>` : '';
        await sendEmailNotification(
          env,
          'elisa.widjaja@gmail.com',
          'New ReciFriend feedback',
          `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
            <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">New feedback</h2>
            ${replyLine}
            <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #333; white-space: pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>`
        );
        return json({ ok: true }, 200, withCors());
      }

      // Unsubscribe from emails
      if (url.pathname === '/unsubscribe' && request.method === 'GET') {
        return await (async () => {
          const userId = url.searchParams.get('userId');
          const token = url.searchParams.get('token');
          if (!userId || !token) {
            return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
          }
          const secret = env.DEV_API_KEY;
          if (!secret) throw new HttpError(500, 'Server misconfiguration: missing signing key');
          const expected = await computeHmac(secret, userId);
          if (token !== expected) {
            return new Response('Invalid unsubscribe link.', { status: 403, headers: { 'Content-Type': 'text/html' } });
          }
          await env.DB.prepare('UPDATE profiles SET email_opt_out = 1 WHERE user_id = ?').bind(userId).run();
          return new Response(
            '<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h2>You\'ve been unsubscribed</h2><p>You won\'t receive any more emails from ReciFriend.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          );
        })();
      }

      // Admin: send test nudge email
      if (url.pathname === '/admin/test-nudge-email' && request.method === 'POST') {
        return await (async () => {
          const authHeader = request.headers.get('Authorization');
          const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
          if (!env.DEV_API_KEY || apiKey !== env.DEV_API_KEY) {
            return json({ error: 'Unauthorized' }, 401, withCors());
          }

          const toEmail = url.searchParams.get('to');
          if (!toEmail) {
            return json({ error: 'Missing ?to= query param' }, 400, withCors());
          }

          let profileUserId = url.searchParams.get('userId') || '';
          let displayName = 'there';

          if (profileUserId) {
            // Look up by userId
            const row = await env.DB.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(profileUserId).first();
            if (row) displayName = row.display_name as string;
          } else {
            // Look up by email
            const row = await env.DB.prepare('SELECT user_id, display_name FROM profiles WHERE email = ? LIMIT 1').bind(toEmail).first();
            if (row) {
              profileUserId = row.user_id as string;
              displayName = row.display_name as string;
            } else {
              profileUserId = 'test-user';
            }
          }

          const recipes = await getRecommendedRecipes(env.DB, profileUserId);
          const gifUrl: string | null = null; // Will be set after GIF is uploaded to Supabase

          const secret = env.DEV_API_KEY;
          if (!secret) throw new HttpError(500, 'Server misconfiguration: missing signing key');
          const unsubToken = await computeHmac(secret, profileUserId);
          let html = buildNudgeEmailHtml(displayName, recipes, gifUrl);
          html = html.replace('__USER_ID__', encodeURIComponent(profileUserId));
          html = html.replace('__TOKEN__', unsubToken);

          const emailResult = await sendEmailNotification(
            env,
            toEmail,
            `Your recipes are waiting, ${displayName}!`,
            html
          );

          return json({ ok: emailResult.ok, sentTo: toEmail, recipesIncluded: recipes.length, resendStatus: emailResult.status, resendResponse: emailResult.body }, 200, withCors());
        })();
      }

      // Public endpoint to get shared recipe by token (no auth required)
      const shareTokenMatch = url.pathname.match(/^\/public\/share\/([^/]+)$/);
      if (shareTokenMatch && request.method === 'GET') {
        const shareToken = decodeURIComponent(shareTokenMatch[1]);
        return await handleGetSharedRecipe(request, env, shareToken);
      }

      // Public endpoint to get a recipe by userId + recipeId (used by OG tag middleware)
      const publicRecipeMatch = url.pathname.match(/^\/public\/recipe\/([^/]+)\/([^/]+)$/);
      if (publicRecipeMatch && request.method === 'GET') {
        return await (async () => {
          const userId = decodeURIComponent(publicRecipeMatch[1]);
          const recipeId = decodeURIComponent(publicRecipeMatch[2]);
          const row = await env.DB.prepare(
            `SELECT id, title, source_url, image_url, ingredients, steps FROM recipes WHERE user_id = ? AND id = ?`
          ).bind(userId, recipeId).first<Record<string, unknown>>();
          if (!row) return json({ error: 'Not found' }, 404, withCors());
          return json({
            id: String(row.id),
            title: String(row.title),
            sourceUrl: String(row.source_url),
            imageUrl: String(row.image_url),
            ingredients: JSON.parse(String(row.ingredients || '[]')),
            steps: JSON.parse(String(row.steps || '[]')),
          }, 200, withCors());
        })();
      }

      const isImageRequest = /^\/images\/[^/]+$/.test(url.pathname);
      const requiresAuth = !isImageRequest;

      const user = requiresAuth ? await authenticateRequest(request, env) : await authenticateRequestOptional(request, env);

      if (url.pathname === '/recipes' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleListRecipes(request, url, env, user);
      }

      if (url.pathname === '/recipes/count' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleRecipeCount(request, env, user);
      }

      if (url.pathname === '/recipes/for-you' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await (async () => {
          const recipes = await getRecipesForUser(env.DB, user.userId);
          return json({ recipes }, 200, withCors());
        })();
      }

      if (url.pathname === '/recipes' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const result = await handleCreateRecipe(request, env, user);
        // Notify admin of user activity
        ctx.waitUntil(sendEmailNotification(
          env,
          'elisa.widjaja@gmail.com',
          `Recipe saved by ${user.email}`,
          `<div style="font-family:sans-serif;padding:24px;"><strong>${user.email}</strong> saved a recipe: <strong>${(await result.clone().json() as { recipe: { title: string } }).recipe.title}</strong></div>`
        ));
        return result;
      }

      if (url.pathname === '/recipes/enrich' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleEnrichRecipe(request, env);
      }

      if (url.pathname === '/recipes/parse' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleParseRecipe(request);
      }

      if (url.pathname === '/recipes/og-image' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleGetOgImage(request);
      }

      const recipeMatch = url.pathname.match(/^\/recipes\/([^/]+)$/);
      // === [S03] Recipe share endpoint ===
      // POST /recipes/:id/share — C1 share API (sends recipe to friends)
      const shareMatch = url.pathname.match(/^\/recipes\/([^/]+)\/share$/);
      if (shareMatch && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const recipeId = decodeURIComponent(shareMatch[1]);
        const body = await request.json() as { recipient_user_ids?: unknown };
        return await handleShareRecipe({ env, sharerId: user.userId, recipeId, body: body as any });
      }

      // Legacy token-based shareable link (restored after Story 03 repurposed the old path)
      const shareLinkMatch = url.pathname.match(/^\/recipes\/([^/]+)\/share-link$/);
      if (shareLinkMatch && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Unauthorized');
        const recipeId = decodeURIComponent(shareLinkMatch[1]);
        return await handleCreateShareLink({ env, user, recipeId });
      }
      // === [/S03] ===

      // === [S05] Device registration + push triggers ===
      if (url.pathname === '/devices/register') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const body = await request.json() as { apns_token?: unknown };
        if (request.method === 'POST') {
          return await handleRegisterDevice({ env, userId: user.userId, body: body as any });
        }
        if (request.method === 'DELETE') {
          return await handleUnregisterDevice({ env, userId: user.userId, body: body as any });
        }
      }
      // === [/S05] ===

      // Log cook event
      const cookMatch = url.pathname.match(/^\/recipes\/([^/]+)\/cook$/);
      if (cookMatch && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Unauthorized');
        return await (async () => {
          const recipeId = decodeURIComponent(cookMatch[1]);
          await logCookEvent(env.DB, user.userId, recipeId);
          // Notify each friend
          const friends = await env.DB.prepare(`SELECT friend_id FROM friends WHERE user_id = ?`).bind(user.userId).all();
          const recipe = await env.DB.prepare(`SELECT title FROM recipes WHERE user_id = ? AND id = ?`).bind(user.userId, recipeId).first() as { title?: string } | null;
          const recipeName = recipe?.title || 'a recipe';
          const profile = await env.DB.prepare(`SELECT display_name FROM profiles WHERE user_id = ?`).bind(user.userId).first() as { display_name?: string } | null;
          const cookerName = profile?.display_name || 'Someone';
          // Use the existing addNotification helper — it handles the 50-row trim side-effect
          for (const f of (friends.results as Array<{ friend_id: string }>)) {
            await addNotification(env, f.friend_id as unknown as string, {
              type: 'friend_cooked_recipe',
              message: `${cookerName} cooked ${recipeName} 🍳`,
              data: { cookerId: user.userId, recipeId, friendName: cookerName },
              createdAt: new Date().toISOString(),
            });
          }
          return json({ ok: true }, 200, withCors());
        })();
      }

      if (recipeMatch) {
        const recipeId = decodeURIComponent(recipeMatch[1]);
        if (request.method === 'GET') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return await handleGetRecipe(request, env, user, recipeId);
        }
        if (request.method === 'PUT' || request.method === 'PATCH') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return await handleUpdateRecipe(request, env, user, recipeId);
        }
        if (request.method === 'DELETE') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return await handleDeleteRecipe(env, user, recipeId);
        }
        return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
      }

      // ── Profile routes ─────────────────────────────────────────────
      if (url.pathname === '/profile' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleGetProfile(env, user);
      }
      if (url.pathname === '/profile' && request.method === 'PATCH') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleUpdateProfile(request, env, user);
      }

      // ── Friends routes ─────────────────────────────────────────────
      if (url.pathname === '/friends' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleListFriends(env, user);
      }
      if (url.pathname === '/friends/requests' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleListFriendRequests(env, user);
      }
      if (url.pathname === '/friends/request' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleSendFriendRequest(request, env, user, ctx);
      }
      if (url.pathname === '/friends/requests/sent' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleListSentFriendRequests(env, user);
      }
      if (url.pathname === '/friends/invites/sent' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleListSentInvites(env, user);
      }
      if (url.pathname === '/friends/accept-invite' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleAcceptInvite(request, env, user, ctx);
      }
      if (url.pathname === '/friends/check-invites' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleCheckInvites(env, user, ctx);
      }
      if (url.pathname === '/friends/open-invite' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleGetOpenInvite(env, user);
      }
      if (url.pathname === '/friends/open-invite' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleCreateOpenInvite(request, env, user);
      }
      if (url.pathname === '/friends/open-invite/regenerate' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleRegenerateOpenInvite(request, env, user);
      }
      if (url.pathname === '/friends/accept-open-invite' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleAcceptOpenInvite(request, env, user);
      }
      const cancelInviteMatch = url.pathname.match(/^\/friends\/invites\/([^/]+)$/);
      if (cancelInviteMatch && request.method === 'DELETE') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const inviteId = decodeURIComponent(cancelInviteMatch[1]);
        return await handleCancelInvite(env, user, inviteId);
      }
      if (url.pathname === '/friends/notifications' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleGetNotifications(env, user);
      }
      if (url.pathname === '/friends/notifications/read' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleMarkNotificationsRead(env, user);
      }
      if (url.pathname === '/friends/activity' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Unauthorized');
        return await (async () => {
          const activity = await getFriendActivity(env.DB, user.userId);
          return json({ activity }, 200, withCors());
        })();
      }
      if (url.pathname === '/friends/recently-saved' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Unauthorized');
        return await (async () => {
          const items = await getFriendsRecentlySaved(env.DB, user.userId);
          return json({ items }, 200, withCors());
        })();
      }
      // === [S03] Recipe share endpoint ===
      if (url.pathname === '/friends/recently-shared' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Unauthorized');
        return await (async () => {
          const items = await getFriendsRecentlyShared(env.DB, user.userId);
          return json({ items }, 200, withCors());
        })();
      }
      // === [/S03] ===
      // GET /friends/suggestions — People you may know
      if (url.pathname === '/friends/suggestions' && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await (async () => {
          const suggestions = await handleFriendSuggestions(env.DB, user.userId);
          return json(suggestions, 200, withCors());
        })();
      }
      const cancelSentMatch = url.pathname.match(/^\/friends\/requests\/sent\/([^/]+)\/cancel$/);
      if (cancelSentMatch && request.method === 'DELETE') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const toUserId = decodeURIComponent(cancelSentMatch[1]);
        return await handleCancelSentFriendRequest(env, user, toUserId);
      }
      const friendRequestActionMatch = url.pathname.match(/^\/friends\/requests\/([^/]+)\/(accept|decline)$/);
      if (friendRequestActionMatch) {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const fromUserId = decodeURIComponent(friendRequestActionMatch[1]);
        if (friendRequestActionMatch[2] === 'accept' && request.method === 'POST') {
          return await handleAcceptFriendRequest(request, env, user, fromUserId, ctx);
        }
        if (friendRequestActionMatch[2] === 'decline' && request.method === 'DELETE') {
          return await handleDeclineFriendRequest(env, user, fromUserId);
        }
      }
      const friendRecipesMatch = url.pathname.match(/^\/friends\/([^/]+)\/recipes$/);
      if (friendRecipesMatch && request.method === 'GET') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const friendId = decodeURIComponent(friendRecipesMatch[1]);
        return await handleGetFriendRecipes(request, env, user, friendId);
      }

      const friendRecipeShareMatch = url.pathname.match(/^\/friends\/([^/]+)\/recipes\/([^/]+)\/share$/);
      if (friendRecipeShareMatch && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const friendId = decodeURIComponent(friendRecipeShareMatch[1]);
        const recipeId = decodeURIComponent(friendRecipeShareMatch[2]);
        return await handleCreateFriendShareLink(env, friendId, recipeId);
      }
      const friendMatch = url.pathname.match(/^\/friends\/([^/]+)$/);
      if (friendMatch && request.method === 'DELETE') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        const friendId = decodeURIComponent(friendMatch[1]);
        return await handleRemoveFriend(env, user, friendId);
      }

      const imageMatch = url.pathname.match(/^\/images\/([^/]+)$/);
      if (imageMatch && request.method === 'GET') {
        const recipeId = decodeURIComponent(imageMatch[1]);
        return await handleImageRequest(request, url, env, user, recipeId);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (error) {
      console.error('Top-level worker error:', error);
      try {
        return handleError(error);
      } catch (innerError) {
        console.error('handleError itself failed:', innerError);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date().toISOString();
    const BATCH_SIZE = 20;

    // Find due nudge emails
    const rows = await env.DB.prepare(
      `SELECT n.user_id, n.email, n.display_name
       FROM nudge_emails n
       JOIN profiles p ON p.user_id = n.user_id
       WHERE n.send_after <= ? AND n.sent = 0 AND p.email_opt_out = 0
       LIMIT ?`
    ).bind(now, BATCH_SIZE).all();

    for (const row of rows.results) {
      const userId = row.user_id as string;
      const email = row.email as string;
      const displayName = row.display_name as string;

      // Check if user has saved any recipes
      const countResult = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM recipes WHERE user_id = ?'
      ).bind(userId).first();
      const recipeCount = (countResult?.cnt as number) || 0;

      if (recipeCount > 0) {
        // User already active — skip
        await env.DB.prepare(
          'UPDATE nudge_emails SET sent = 2, sent_at = ? WHERE user_id = ?'
        ).bind(now, userId).run();
        continue;
      }

      // Build and send the nudge email
      const recipes = await getRecommendedRecipes(env.DB, userId);
      const gifUrl: string | null = null; // Set after GIF upload

      const secret = env.DEV_API_KEY;
      if (!secret) return; // Can't sign unsubscribe tokens without DEV_API_KEY
      const unsubToken = await computeHmac(secret, userId);
      let html = buildNudgeEmailHtml(displayName, recipes, gifUrl);
      html = html.replace('__USER_ID__', encodeURIComponent(userId));
      html = html.replace('__TOKEN__', unsubToken);

      await sendEmailNotification(
        env,
        email,
        `Your recipes are waiting, ${displayName}!`,
        html
      );

      await env.DB.prepare(
        'UPDATE nudge_emails SET sent = 1, sent_at = ? WHERE user_id = ?'
      ).bind(now, userId).run();
    }
  },
};

function handleOptions() {
  return new Response(null, { status: 204, headers: withCors() });
}

function methodNotAllowed(allowed: string[]) {
  return json({ error: 'Method Not Allowed', allowed }, 405, { Allow: allowed.join(', ') });
}

function handleError(error: unknown) {
  if (error instanceof HttpError) {
    const body = { error: error.message, ...error.details };
    return json(body, error.status);
  }

  console.error('Recipes worker error', error);
  return json({ error: 'Internal Server Error' }, 500);
}

async function authenticateRequest(
  request: Request,
  env: Env
): Promise<AuthenticatedUser> {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing Authorization header');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Missing bearer token');
  }

  if (env.DEV_API_KEY && token === env.DEV_API_KEY) {
    return {
      userId: 'dev-user',
      email: 'dev@example.com',
      claims: { sub: 'dev-user', provider: 'dev-key' }
    };
  }

  const payload = await verifyJwt(token, env);
  const userId = typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  if (!userId) {
    throw new HttpError(401, 'Token is missing a subject');
  }

  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    claims: payload
  };
}

async function authenticateRequestOptional(
  request: Request,
  env: Env
): Promise<AuthenticatedUser | null> {
  const header = request.headers.get('Authorization');
  if (!header) {
    return null;
  }
  try {
    return await authenticateRequest(request, env);
  } catch (error) {
    return null;
  }
}

async function verifyJwt(token: string, env: Env): Promise<Record<string, any>> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new HttpError(401, 'Malformed JWT');
  }

  const header = parseJsonSegment(encodedHeader) as { alg?: string; kid?: string; typ?: string };
  const payload = parseJsonSegment(encodedPayload) as Record<string, any>;
  const alg = header.alg;

  let verified = false;

  if (alg === 'HS256') {
    // Verify with HMAC-SHA256 using JWT secret
    if (!env.SUPABASE_JWT_SECRET) {
      throw new HttpError(500, 'SUPABASE_JWT_SECRET is not configured for HS256 verification');
    }
    // Use the JWT secret as raw UTF-8 bytes
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(env.SUPABASE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    verified = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToUint8Array(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
  } else if (alg === 'RS256') {
    // Verify with RSA-SHA256 using JWKS
    const jwk = await getSigningKey(env.AUTH_JWKS_URL, header.kid);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
      'verify'
    ]);
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToUint8Array(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
  } else {
    throw new HttpError(401, `Unsupported signing algorithm: ${alg ?? 'unknown'}`);
  }

  if (!verified) {
    throw new HttpError(401, 'Invalid token signature');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now >= payload.exp) {
    throw new HttpError(401, 'Token expired');
  }

  if (payload.iss && env.AUTH_ISSUER && payload.iss !== env.AUTH_ISSUER) {
    throw new HttpError(401, 'Invalid issuer');
  }

  const expectedAud = env.AUTH_AUDIENCE;
  if (expectedAud) {
    const aud = payload.aud;
    const matches = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
    if (!matches) {
      throw new HttpError(401, 'Invalid audience');
    }
  }

  return payload;
}

async function getSigningKey(jwksUrl: string, kid?: string): Promise<ExtendedJsonWebKey> {
  if (!jwksUrl) {
    throw new HttpError(500, 'AUTH_JWKS_URL is not configured');
  }

  const cached = jwksCache.get(jwksUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    const key = pickJwk(cached.keys, kid);
    if (key) {
      return key;
    }
  }

  const response = await fetch(jwksUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!response.ok) {
    throw new HttpError(500, 'Failed to download JWKS');
  }
  const { keys } = (await response.json()) as { keys?: ExtendedJsonWebKey[] };
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new HttpError(500, 'JWKS endpoint returned no keys');
  }

  jwksCache.set(jwksUrl, { keys, expiresAt: now + JWKS_CACHE_TTL_MS });
  const key = pickJwk(keys, kid);
  if (!key) {
    throw new HttpError(401, 'Unable to find matching signing key');
  }
  return key;
}

function pickJwk(keys: ExtendedJsonWebKey[], kid?: string) {
  if (kid) {
    const match = keys.find((key) => key.kid === kid);
    if (match) {
      return match;
    }
  }
  return keys[0];
}

function parseJsonSegment(segment: string) {
  const jsonString = new TextDecoder().decode(base64UrlToUint8Array(segment));
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new HttpError(401, 'Failed to parse token segment');
  }
}

function base64UrlToUint8Array(segment: string) {
  const padLength = (4 - (segment.length % 4)) % 4;
  const base64 = `${segment}${'='.repeat(padLength)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    sourceUrl: (row.source_url as string) || '',
    imageUrl: (row.image_url as string) || '',
    imagePath: (row.image_path as string) || null,
    mealTypes: JSON.parse((row.meal_types as string) || '[]'),
    ingredients: JSON.parse((row.ingredients as string) || '[]'),
    steps: JSON.parse((row.steps as string) || '[]'),
    durationMinutes: row.duration_minutes as number | null,
    notes: (row.notes as string) || '',
    previewImage: row.preview_image ? JSON.parse(row.preview_image as string) : null,
    sharedWithFriends: Boolean(row.shared_with_friends),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function handleListRecipes(request: Request, url: URL, env: Env, user: AuthenticatedUser) {
  const limitParamRaw = url.searchParams.get('limit');
  const limitParsed = limitParamRaw === null ? NaN : Number(limitParamRaw);
  const limit = Number.isFinite(limitParsed)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limitParsed)))
    : DEFAULT_PAGE_SIZE;
  const offset = Number(url.searchParams.get('offset') || '0') || 0;

  const meta = await getCollectionMeta(env, user.userId);
  const etag = makeEtag(`recipes-${user.userId}-${meta?.version ?? 0}`);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  const result = await env.DB.prepare(
    'SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(user.userId, limit, offset).all();

  const recipes = (result.results || []).map(rowToRecipe);

  return json({
    recipes,
    cursor: recipes.length < limit ? null : offset + limit
  }, 200, cacheHeaders({
    visibility: 'private', maxAge: 0, etag,
    lastModified: meta?.updatedAt ? new Date(meta.updatedAt) : undefined
  }));
}

async function handleRecipeCount(request: Request, env: Env, user: AuthenticatedUser) {
  const meta = await getCollectionMeta(env, user.userId);
  const etag = makeEtag(`count-${user.userId}-${meta?.version ?? 0}`);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  return json({
    count: meta?.count ?? 0,
    updatedAt: meta?.updatedAt ?? null,
    version: meta?.version ?? 0
  }, 200, cacheHeaders({ visibility: 'private', maxAge: 0, etag }));
}

async function handleGetProfile(env: Env, user: AuthenticatedUser) {
  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const meta = await getCollectionMeta(env, user.userId);
  const onboardingRow = await env.DB.prepare(
    'SELECT onboarding_seen FROM profiles WHERE user_id = ?'
  ).bind(user.userId).first<{ onboarding_seen: number | null }>();
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
    cookingFor: profile.cookingFor,
    cuisinePrefs: profile.cuisinePrefs,
    dietaryPrefs: profile.dietaryPrefs,
    onboardingSeen: Boolean(onboardingRow?.onboarding_seen),
  });
}

async function handleUpdateProfile(request: Request, env: Env, user: AuthenticatedUser) {
  const body = await request.json() as { displayName?: string; mealTypePrefs?: string[]; dietaryPrefs?: string[]; skillLevel?: string; cookingFor?: string; cuisinePrefs?: string[]; onboardingSeen?: boolean };

  // Prepare optional fields
  const mealTypePrefs = typeof body.mealTypePrefs !== 'undefined' ? JSON.stringify(body.mealTypePrefs) : undefined;
  const dietaryPrefs = typeof body.dietaryPrefs !== 'undefined' ? JSON.stringify(body.dietaryPrefs) : undefined;
  const skillLevel = typeof body.skillLevel !== 'undefined' ? String(body.skillLevel) : undefined;

  // Validate displayName if provided
  if (body.displayName !== undefined) {
    const displayName = body.displayName?.trim();
    if (!displayName || displayName.length === 0) {
      throw new HttpError(400, 'Display name is required');
    }
    if (displayName.length > 50) {
      throw new HttpError(400, 'Display name must be 50 characters or less');
    }
  }

  // Validate cuisinePrefs if provided
  if (body.cuisinePrefs !== undefined && !Array.isArray(body.cuisinePrefs)) {
    throw new HttpError(400, 'cuisinePrefs must be an array');
  }

  // Build dynamic UPDATE for only provided fields
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(String(body.displayName).trim());
  }
  if (mealTypePrefs !== undefined) {
    fields.push('meal_type_prefs = ?');
    values.push(mealTypePrefs);
  }
  if (dietaryPrefs !== undefined) {
    fields.push('dietary_prefs = ?');
    values.push(dietaryPrefs);
  }
  if (skillLevel !== undefined) {
    fields.push('skill_level = ?');
    values.push(skillLevel);
  }
  if (body.cookingFor !== undefined) {
    fields.push('cooking_for = ?');
    values.push(String(body.cookingFor));
  }
  if (body.cuisinePrefs !== undefined) {
    fields.push('cuisine_prefs = ?');
    values.push(JSON.stringify(body.cuisinePrefs));
  }
  if (body.onboardingSeen !== undefined) {
    fields.push('onboarding_seen = ?');
    values.push(body.onboardingSeen ? 1 : 0);
  }

  if (fields.length === 0) {
    throw new HttpError(400, 'At least one field must be provided for update');
  }

  values.push(user.userId);
  await env.DB.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE user_id = ?`).bind(...values).run();

  // Return updated fields
  const response: Record<string, any> = {};
  if (body.displayName !== undefined) response.displayName = String(body.displayName).trim();
  if (mealTypePrefs !== undefined) response.mealTypePrefs = body.mealTypePrefs;
  if (dietaryPrefs !== undefined) response.dietaryPrefs = body.dietaryPrefs;
  if (skillLevel !== undefined) response.skillLevel = body.skillLevel;
  if (body.cookingFor !== undefined) response.cookingFor = body.cookingFor;
  if (body.cuisinePrefs !== undefined) response.cuisinePrefs = body.cuisinePrefs;
  if (body.onboardingSeen !== undefined) response.onboardingSeen = Boolean(body.onboardingSeen);

  return json(response);
}

async function handleGetRecipe(request: Request, env: Env, user: AuthenticatedUser, recipeId: string) {
  let recipe: Recipe;
  try {
    recipe = await loadRecipe(env, user.userId, recipeId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      // === [S03] Recipe share endpoint ===
      // Caller doesn't own the recipe — check if they received it via a share
      const shareRow = await env.DB.prepare(
        'SELECT recipe_id FROM recipe_shares WHERE recipient_id = ? AND recipe_id = ? LIMIT 1'
      ).bind(user.userId, recipeId).first<{ recipe_id: string }>();
      if (!shareRow) throw e; // re-throw 404

      // Load recipe by id (any owner) since recipient has access
      const row = await env.DB.prepare(
        'SELECT * FROM recipes WHERE id = ?'
      ).bind(recipeId).first();
      if (!row) throw e;
      recipe = rowToRecipe(row as Record<string, unknown>);
      // === [/S03] ===
    } else {
      throw e;
    }
  }
  const lastModified = new Date(recipe.updatedAt);
  const etag = makeEtag(`recipe-${recipe.id}-${recipe.updatedAt}`);
  const notModified = checkConditional(request, etag, lastModified);
  if (notModified) return notModified;

  return json({ recipe }, 200, cacheHeaders({
    visibility: 'private', maxAge: 60, etag, lastModified
  }));
}


function generateShareToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

async function handleCreateShareLink({ env, user, recipeId }: { env: Env; user: AuthenticatedUser; recipeId: string }) {
  const recipe = await env.DB.prepare(
    'SELECT id FROM recipes WHERE user_id = ? AND id = ?'
  ).bind(user.userId, recipeId).first();
  if (!recipe) {
    return json({ error: 'Recipe not found' }, 404, withCors());
  }

  const existing = await env.DB.prepare(
    'SELECT token FROM share_links WHERE user_id = ? AND recipe_id = ?'
  ).bind(user.userId, recipeId).first<{ token: string }>();
  if (existing) {
    return json({ token: existing.token }, 200, withCors());
  }

  const token = generateShareToken();
  await env.DB.prepare(
    'INSERT INTO share_links (token, user_id, recipe_id, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.userId, recipeId, new Date().toISOString()).run();

  return json({ token }, 201, withCors());
}

async function handleCreateFriendShareLink(env: Env, friendId: string, recipeId: string) {
  // Only share if the recipe is shared with friends
  const recipe = await env.DB.prepare(
    'SELECT id FROM recipes WHERE user_id = ? AND id = ? AND shared_with_friends = 1'
  ).bind(friendId, recipeId).first();
  if (!recipe) {
    return json({ error: 'Recipe not found or not shared' }, 404, withCors());
  }

  const existing = await env.DB.prepare(
    'SELECT token FROM share_links WHERE user_id = ? AND recipe_id = ?'
  ).bind(friendId, recipeId).first<{ token: string }>();
  if (existing) {
    return json({ token: existing.token }, 200, withCors());
  }

  const token = generateShareToken();
  await env.DB.prepare(
    'INSERT INTO share_links (token, user_id, recipe_id, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, friendId, recipeId, new Date().toISOString()).run();

  return json({ token }, 201, withCors());
}

async function handleOembedAuthor(url: URL) {
  const sourceUrl = url.searchParams.get('url');
  if (!sourceUrl) {
    return json({ author: null }, 400, withCors());
  }
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase();

    // Try TikTok oEmbed (works reliably)
    if (host.includes('tiktok.com')) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
      const res = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)', 'Accept': 'application/json' }
      });
      if (res.ok) {
        const payload = await res.json() as { author_name?: string };
        if (payload.author_name) {
          return json({ author: payload.author_name }, 200, {
            ...withCors(), 'Cache-Control': 'public, max-age=86400'
          });
        }
      }
    }

    // For Instagram, try multiple strategies to get the author
    if (host.includes('instagram.com')) {
      // Strategy 1: Fetch HTML directly and parse og:title
      try {
        const htmlRes = await fetch(sourceUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RecipeWorker/1.0)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          redirect: 'follow',
          cf: { cacheTtl: 86400 }
        });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const ogTitle = extractMetaContent(html, 'property', 'og:title');
          if (ogTitle) {
            const match = ogTitle.match(/^(.+?)\s+on\s+Instagram/i);
            if (match) {
              return json({ author: match[1].trim() }, 200, {
                ...withCors(), 'Cache-Control': 'public, max-age=86400'
              });
            }
          }
        }
      } catch { /* fall through */ }

      // Strategy 2: Use Jina proxy (handles JS-rendered pages)
      try {
        const jinaRes = await fetch(`https://r.jina.ai/${sourceUrl}`, {
          headers: { 'User-Agent': 'RecipeWorker/1.0' }
        });
        if (jinaRes.ok) {
          const text = await jinaRes.text();
          // Jina markdown output often includes "By AuthorName" or "AuthorName on Instagram"
          const match = text.match(/^Title:\s*(.+?)\s+on\s+Instagram/im) ||
                        text.match(/(.+?)\s+on\s+Instagram/i);
          if (match) {
            return json({ author: match[1].trim() }, 200, {
              ...withCors(), 'Cache-Control': 'public, max-age=86400'
            });
          }
        }
      } catch { /* fall through */ }
    }

    return json({ author: null }, 200, withCors());
  } catch {
    return json({ author: null }, 200, withCors());
  }
}

// Hand-picked YouTube Shorts to always appear in the first 2 slots of Discover New Recipes.
// Add recipe IDs here (must exist in D1). Keep at most 2.
const CURATED_YOUTUBE_SHORTS_IDS = [
  '802582a9-2ece-49ca-ab8e-0561d54645c5', // The Best Gouda Grits Recipe
  'e0853763-d134-4547-8496-efa18bfa5062', // Persian Sheet-Pan Beef Kefta Wraps
];

type DiscoverRecipe = {
  id: string; userId: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
};

function mapDiscoverRow(r: Record<string, unknown>): DiscoverRecipe {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    ingredients: JSON.parse(String(r.ingredients || '[]')),
    steps: JSON.parse(String(r.steps || '[]')),
  };
}

const DISCOVER_SELECT = `SELECT id, user_id, title, source_url, image_url, meal_types, duration_minutes, ingredients, steps FROM recipes`;

export async function getPublicDiscover(db: D1Database): Promise<DiscoverRecipe[]> {
  // Fetch curated shorts first (if any are configured)
  let curatedShorts: DiscoverRecipe[] = [];
  if (CURATED_YOUTUBE_SHORTS_IDS.length > 0) {
    const placeholders = CURATED_YOUTUBE_SHORTS_IDS.map(() => '?').join(', ');
    const curatedRows = await db.prepare(
      `${DISCOVER_SELECT} WHERE id IN (${placeholders})`
    ).bind(...CURATED_YOUTUBE_SHORTS_IDS).all();
    curatedShorts = (curatedRows.results as Array<Record<string, unknown>>).map(mapDiscoverRow);
  }

  const curatedIds = new Set(curatedShorts.map(r => r.id));

  // Fill the rest with recent TikTok/Instagram/YouTube Shorts, excluding already-fetched curated ones
  const rows = await db.prepare(
    `${DISCOVER_SELECT}
     WHERE (source_url LIKE '%tiktok.com%' OR source_url LIKE '%instagram.com%'
            OR source_url LIKE '%youtube.com/shorts%')
     ORDER BY created_at DESC
     LIMIT 20`
  ).all();
  const rest = (rows.results as Array<Record<string, unknown>>)
    .map(mapDiscoverRow)
    .filter(r => !curatedIds.has(r.id));

  return [...curatedShorts, ...rest];
}

const CURATED_COMMUNITY_IDS = [
  '2c8627ea-2cf1-447c-8c45-8118f0db88a0',
  'bbb0b42d-fc3f-4f3d-a6ad-8c75dcae6ab3',
  // 'c49498b7-3772-4304-86a1-b62a8eb42aad', // YouTube Short — moved to Discover
  'ce72aae2-d5a0-4e3c-b088-fbfd8a6d870f',
  '953bdf9f-6088-4449-8692-0c68d6822a0a',
  '40267c63-abe5-4c66-8477-94d26626de1b',
  // 'e0853763-d134-4547-8496-efa18bfa5062', // YouTube Short — moved to Discover
  '3190c934-f0d4-45b9-8379-4efdc839189a',
];

export async function getTrendingRecipes(db: D1Database): Promise<Array<{
  id: string; userId: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
}>> {
  const placeholders = CURATED_COMMUNITY_IDS.map(() => '?').join(', ');
  const rows = await db.prepare(
    `SELECT id, user_id, title, source_url, image_url, meal_types, duration_minutes, ingredients, steps
     FROM recipes WHERE id IN (${placeholders})`
  ).bind(...CURATED_COMMUNITY_IDS).all();
  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    ingredients: JSON.parse(String(r.ingredients || '[]')),
    steps: JSON.parse(String(r.steps || '[]')),
  }));
}

// IMPORTANT: These titles must exactly match the `title` column values stored in D1.
// Before deploying, verify by running:
//   npx wrangler d1 execute recipes-db --remote --command="SELECT title FROM recipes WHERE title LIKE '%Stew%' OR title LIKE '%moco%' LIMIT 20"
// Adjust casing below to match what is actually stored. SQLite IN() is case-sensitive for ASCII.
const EDITOR_PICK_TITLES = [
  'Beef and Guiness Stew', 'Loco moco', 'Galbi tang',
  'Watermelon salad', 'Broccoli cheddar soup', 'Honey lime chicken bowl',
  'Blueberry cream pancake', 'Banana Bread', 'Swiss croissant bake',
  'Pear puff pastry', 'Berry yogurt bake',
];

export async function getEditorsPick(db: D1Database, titles: string[] = EDITOR_PICK_TITLES): Promise<Array<{
  id: string; userId: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
}>> {
  const placeholders = titles.map(() => '?').join(', ');
  // Pick one row per title: prefer rows where duration_minutes IS NOT NULL.
  // Subquery selects the best rowid per title (non-null duration first, else any).
  const rows = await db.prepare(
    `SELECT r.id, r.user_id, r.title, r.source_url, r.image_url, r.meal_types, r.duration_minutes, r.ingredients, r.steps
     FROM recipes r
     INNER JOIN (
       SELECT title,
              COALESCE(MIN(CASE WHEN duration_minutes IS NOT NULL THEN rowid END), MIN(rowid)) AS best_rowid
       FROM recipes
       WHERE title IN (${placeholders})
       GROUP BY title
     ) best ON r.rowid = best.best_rowid`
  ).bind(...titles).all();
  // Re-sort results to match the original titles order
  const byTitle = new Map(
    (rows.results as Array<Record<string, unknown>>).map((r) => [String(r.title).toLowerCase(), r])
  );
  const ordered = titles
    .map(t => byTitle.get(t.toLowerCase()))
    .filter((r): r is Record<string, unknown> => r != null);
  return ordered.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    imageUrl: String(r.image_url),
    mealTypes: JSON.parse(String(r.meal_types || '[]')),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    ingredients: JSON.parse(String(r.ingredients || '[]')),
    steps: JSON.parse(String(r.steps || '[]')),
  }));
}

type AiPick = {
  topic: string;
  hashtag: string;
  reason: string;
  recipe: {
    id: string; userId: string; title: string; imageUrl: string;
    mealTypes: string[]; durationMinutes: number | null;
    sourceUrl: string; ingredients: string[]; steps: string[];
  }
};

export async function getAiPicks(
  db: D1Database,
  kv: KVNamespace,
  gemini: (env: Env, prompt: string) => Promise<string>,
  env: Partial<Env>,
  prefs: { diet?: string; cuisine?: string; cookingFor?: string } = {}
): Promise<AiPick[]> {
  // v3: personalizes by diet, cuisine, cookingFor (dropped mealTypes and skill)
  const cuisineSorted = prefs.cuisine
    ? prefs.cuisine.split(',').map(s => s.trim().toLowerCase()).sort().join(',')
    : 'all';
  const cacheKey = `ai-picks:v4:${prefs.diet || 'any'}:${cuisineSorted}:${prefs.cookingFor || 'any'}`;
  const cached = await kv.get(cacheKey);
  if (cached) return JSON.parse(cached) as AiPick[];

  // Fetch a pool of candidate recipes from D1 so Gemini picks from real titles
  const candidateRows = await db.prepare(
    `SELECT id, user_id, title, image_url, meal_types, duration_minutes, source_url, ingredients, steps
     FROM recipes WHERE shared_with_friends = 1 ORDER BY RANDOM() LIMIT 40`
  ).all();
  // Only include recipes with clean, structured ingredients and steps (not Instagram captions)
  const isCleanList = (items: string[]) =>
    items.length > 0 &&
    items.every(s =>
      s.length <= 200 &&                          // no paragraph-length items
      !/\d+[Kk]?\s+likes/i.test(s) &&            // no engagement metrics
      !/\d+\s+comments/i.test(s) &&
      !/@\w{3,}/.test(s) &&                       // no @handles
      !/^\s*#\w+/.test(s)                         // not a hashtag line
    );

  const candidates = (candidateRows.results as Array<Record<string, unknown>>).filter(r => {
    try {
      const steps: string[] = JSON.parse(String(r.steps || '[]'));
      const ingredients: string[] = JSON.parse(String(r.ingredients || '[]'));
      return isCleanList(ingredients) && isCleanList(steps);
    } catch { return false; }
  });
  if (!candidates.length) return [];

  const titleList = candidates.map(r => String(r.title)).join('\n');
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9, \-]/g, '').slice(0, 200);
  const contextParts: string[] = [];
  if (prefs.diet) contextParts.push(`diet=${sanitize(prefs.diet)}`);
  if (prefs.cuisine) contextParts.push(`preferred cuisines=${sanitize(prefs.cuisine)}`);
  if (prefs.cookingFor) contextParts.push(`cooking for=${sanitize(prefs.cookingFor)}`);
  const prefsNote = contextParts.length > 0
    ? `User context: ${contextParts.join(', ')}.`
    : '';

  const prompt = `You are a cooking trend analyst. ${prefsNote} Below is a list of real recipes. Pick 3 that best match current trending health or nutrition topics. For each pick, name the topic, create a hashtag, write a one-sentence reason why this recipe fits the trend, and copy the recipe title EXACTLY as it appears in the list. Return ONLY a JSON array with no markdown:\n[{"topic":"string","hashtag":"string","reason":"one sentence why this fits the trend","match":"exact recipe title from list"}]\n\nRecipes:\n${titleList}`;

  let parsed: Array<{ topic: string; hashtag: string; reason: string; match: string }> = [];
  try {
    const raw = await gemini(env as Env, prompt);
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('[getAiPicks] Gemini parse/call failed:', err);
    return [];
  }

  // Build a lookup map from title → candidate row
  const byTitle = new Map(candidates.map(r => [String(r.title).toLowerCase(), r]));

  const picks: AiPick[] = [];
  for (const item of parsed.slice(0, 3)) {
    const row = byTitle.get(item.match?.toLowerCase()) ?? null;
    if (row) {
      picks.push({
        topic: item.topic,
        hashtag: item.hashtag,
        reason: item.reason || '',
        recipe: {
          id: String(row.id),
          userId: String(row.user_id || ''),
          title: String(row.title),
          imageUrl: String(row.image_url),
          mealTypes: JSON.parse(String(row.meal_types || '[]')),
          durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
          sourceUrl: String(row.source_url || ''),
          ingredients: JSON.parse(String(row.ingredients || '[]')),
          steps: JSON.parse(String(row.steps || '[]')),
        }
      });
    }
  }

  if (picks.length > 0) {
    await kv.put(cacheKey, JSON.stringify(picks), { expirationTtl: 604800 }); // 7 days
  }
  return picks;
}

type FriendRecipeItem = {
  friendName: string;
  friendId: string;
  recipe: {
    id: string;
    title: string;
    imageUrl: string | null;
    sourceUrl: string;
    mealTypes: string[];
    durationMinutes: number | null;
    createdAt: string;
    ingredients: string[];
    steps: string[];
  }
};

export async function getFriendActivity(
  db: D1Database,
  userId: string
): Promise<Array<{
  id: number;
  type: string;
  message: string;
  friendName: string | null;
  fromUserId?: string;
  resolved?: boolean;
  recipe: { id: string; title: string; imageUrl: string | null; sourceUrl: string; ingredients: string[]; steps: string[] } | null;
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

  // Friend_request notifications are "resolved" once the pending row is gone
  // (either accepted or declined). One query fetches all still-pending senders
  // for this recipient, then we check each notification against the set.
  const pendingRows = await db.prepare(
    `SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'`
  ).bind(userId).all<{ from_user_id: string }>();
  const pendingFromUserIds = new Set(
    (pendingRows.results || []).map(r => String(r.from_user_id))
  );

  // Collect unique recipeIds for batch fetch — bounded to ≤10 by the LIMIT 10 in the notifications query above
  const recipeIds = [...new Set(
    parsed
      .map(item => (item.data as Record<string, unknown>).recipeId as string | undefined)
      .filter((id): id is string => Boolean(id))
  )];

  // Batch fetch recipes in one query
  const recipeMap = new Map<string, { id: string; title: string; imageUrl: string | null; sourceUrl: string; ingredients: string[]; steps: string[] }>();
  if (recipeIds.length > 0) {
    const placeholders = recipeIds.map(() => '?').join(', ');
    const recipeRows = await db.prepare(
      `SELECT id, title, image_url, source_url, ingredients, steps FROM recipes WHERE id IN (${placeholders})`
    ).bind(...recipeIds).all();
    for (const r of (recipeRows.results as Array<Record<string, unknown>>)) {
      recipeMap.set(String(r.id), {
        id: String(r.id),
        title: String(r.title),
        imageUrl: r.image_url ? String(r.image_url) : null,
        sourceUrl: r.source_url ? String(r.source_url) : '',
        ingredients: (() => { try { return JSON.parse(String(r.ingredients || '[]')); } catch { return []; } })(),
        steps: (() => { try { return JSON.parse(String(r.steps || '[]')); } catch { return []; } })(),
      });
    }
  }

  return parsed.map(item => {
    const d = item.data as Record<string, unknown>;
    const recipeId = d.recipeId as string | undefined;
    const friendName: string | null =
      (d.friendName as string | undefined) ?? item.message.split(' ')[0] ?? null;
    const fromUserId = typeof d.fromUserId === 'string' ? d.fromUserId : undefined;
    const resolved = item.type === 'friend_request' && fromUserId
      ? !pendingFromUserIds.has(fromUserId)
      : undefined;
    return {
      id: item.id,
      type: item.type,
      message: item.message,
      friendName,
      ...(fromUserId ? { fromUserId } : {}),
      ...(resolved !== undefined ? { resolved } : {}),
      recipe: recipeId ? (recipeMap.get(recipeId) ?? null) : null,
      createdAt: item.createdAt,
      read: item.read,
    };
  });
}

export async function getFriendsRecentlySaved(db: D1Database, userId: string): Promise<FriendRecipeItem[]> {
  const friends = await db.prepare(
    `SELECT friend_id, friend_name FROM friends WHERE user_id = ?`
  ).bind(userId).all();
  const items: FriendRecipeItem[] = [];
  for (const friend of (friends.results as Array<Record<string, unknown>>)) {
    const rows = await db.prepare(
      // Exclude shared recipes — those appear in "recently shared" section to avoid duplicates
      `SELECT id, title, source_url, image_url, meal_types, duration_minutes, created_at, ingredients, steps FROM recipes WHERE user_id = ? AND (shared_with_friends IS NULL OR shared_with_friends = 0) ORDER BY created_at DESC LIMIT 2`
    ).bind(String(friend.friend_id)).all();
    for (const r of (rows.results as Array<Record<string, unknown>>)) {
      items.push({
        friendName: String(friend.friend_name),
        friendId: String(friend.friend_id),
        recipe: { id: String(r.id), userId: String(friend.friend_id), title: String(r.title), sourceUrl: r.source_url ? String(r.source_url) : null, imageUrl: r.image_url ? String(r.image_url) : null, mealTypes: JSON.parse(String(r.meal_types || '[]')), durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null, createdAt: String(r.created_at), ingredients: JSON.parse(String(r.ingredients || '[]')), steps: JSON.parse(String(r.steps || '[]')) }
      });
    }
  }
  return items.sort((a, b) => b.recipe.createdAt.localeCompare(a.recipe.createdAt)).slice(0, 8);
}

// === [S03] Recipe share endpoint ===
export async function getFriendsRecentlyShared(db: D1Database, userId: string): Promise<FriendRecipeItem[]> {
  // Query recipes shared directly with this user via recipe_shares table
  const rows = await db.prepare(
    `SELECT r.id, r.user_id, r.title, r.source_url, r.image_url, r.meal_types,
            r.duration_minutes, r.created_at, r.ingredients, r.steps,
            rs.created_at as shared_at, rs.sharer_id,
            p.display_name as sharer_name
     FROM recipe_shares rs
     JOIN recipes r ON r.id = rs.recipe_id
     LEFT JOIN profiles p ON p.user_id = rs.sharer_id
     WHERE rs.recipient_id = ?
     ORDER BY rs.created_at DESC
     LIMIT 10`
  ).bind(userId).all();

  return (rows.results as Array<Record<string, unknown>>).map((r) => ({
    friendName: r.sharer_name ? String(r.sharer_name) : 'A friend',
    friendId: String(r.sharer_id),
    recipe: {
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      sourceUrl: r.source_url ? String(r.source_url) : null,
      imageUrl: r.image_url ? String(r.image_url) : null,
      mealTypes: JSON.parse(String(r.meal_types || '[]')),
      durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
      createdAt: String(r.shared_at ?? r.created_at),
      ingredients: JSON.parse(String(r.ingredients || '[]')),
      steps: JSON.parse(String(r.steps || '[]')),
    },
  }));
}
// === [/S03] ===

export async function logCookEvent(db: D1Database, userId: string, recipeId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO cook_events (user_id, recipe_id, cooked_at) VALUES (?, ?, ?)`
  ).bind(userId, recipeId, new Date().toISOString()).run();
}

async function handleGetSharedRecipe(request: Request, env: Env, token: string) {
  const shareLink = await env.DB.prepare(
    'SELECT * FROM share_links WHERE token = ?'
  ).bind(token).first<{ user_id: string; recipe_id: string }>();
  if (!shareLink) {
    return json({ error: 'Share link not found or expired' }, 404, withCors());
  }

  const row = await env.DB.prepare(
    'SELECT * FROM recipes WHERE user_id = ? AND id = ?'
  ).bind(shareLink.user_id, shareLink.recipe_id).first();
  if (!row) {
    return json({ error: 'Recipe not found' }, 404, withCors());
  }

  const recipe = rowToRecipe(row as Record<string, unknown>);
  const lastModified = new Date(recipe.updatedAt);
  const etag = makeEtag(`share-${token}-${recipe.updatedAt}`);
  const notModified = checkConditional(request, etag, lastModified);
  if (notModified) return notModified;

  return json({
    id: recipe.id,
    title: recipe.title,
    sourceUrl: recipe.sourceUrl || '',
    imageUrl: recipe.imageUrl || '',
    imagePath: recipe.imagePath || '',
    mealTypes: recipe.mealTypes || [],
    ingredients: recipe.ingredients || [],
    steps: recipe.steps || null,
    durationMinutes: recipe.durationMinutes || null,
    notes: recipe.notes || ''
  }, 200, cacheHeaders({
    visibility: 'public', maxAge: 300, etag, lastModified
  }));
}

async function handleCreateRecipe(request: Request, env: Env, user: AuthenticatedUser) {
  const body = await readJsonBody(request);
  const { recipe, previewImagePayload } = normalizeRecipePayload(body, user.userId);
  const preview = await persistPreviewImage(previewImagePayload, env, user.userId, recipe.id);
  if (preview) {
    recipe.previewImage = preview;
    recipe.imagePath = buildImagePath(recipe.id);
    recipe.imageUrl = preview.publicUrl || recipe.imageUrl;
  }

  await env.DB.prepare(
    `INSERT INTO recipes (id, user_id, title, source_url, image_url, image_path, meal_types, ingredients, steps, duration_minutes, notes, preview_image, shared_with_friends, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    recipe.id, recipe.userId, recipe.title, recipe.sourceUrl, recipe.imageUrl,
    recipe.imagePath ?? null, JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.ingredients),
    JSON.stringify(recipe.steps), recipe.durationMinutes, recipe.notes || '',
    recipe.previewImage ? JSON.stringify(recipe.previewImage) : null,
    recipe.sharedWithFriends ? 1 : 0, recipe.createdAt, recipe.updatedAt
  ).run();
  await updateCollectionMeta(env, user.userId, { countDelta: 1 });

  // Notify friends that this user saved a recipe
  const [friendRows, profileRow] = await Promise.all([
    env.DB.prepare(`SELECT friend_id FROM friends WHERE user_id = ?`).bind(user.userId).all(),
    env.DB.prepare(`SELECT display_name FROM profiles WHERE user_id = ?`).bind(user.userId).first() as Promise<{ display_name?: string } | null>,
  ]);
  const saverName = profileRow?.display_name || 'Someone';
  const isPublic = Boolean(recipe.sharedWithFriends);
  for (const f of (friendRows.results as Array<{ friend_id: string }>)) {
    await addNotification(env, f.friend_id, {
      type: 'friend_saved_recipe',
      message: isPublic ? `${saverName} saved ${recipe.title}` : `${saverName} saved a recipe`,
      data: isPublic
        ? { saverId: user.userId, recipeId: recipe.id, friendName: saverName }
        : { saverId: user.userId, friendName: saverName },
      createdAt: new Date().toISOString(),
    });
    // === [S05] Push notification to friend when a public recipe is saved ===
    if (isPublic) {
      sendPushToUser(env as any, f.friend_id, {
        title: 'ReciFriend',
        body: `${saverName} saved ${recipe.title}`,
        deepLink: `https://recifriend.com/recipes/${recipe.id}`,
      }).catch(() => { /* silent — push is best-effort */ });
    }
    // === [/S05] ===
  }

  return json({ recipe }, 201);
}

async function handleGetOgImage(request: Request) {
  const body = await readJsonBody(request);
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';

  if (!sourceUrl) {
    throw new HttpError(400, 'sourceUrl is required');
  }

  const imageUrl = await fetchOgImage(sourceUrl);

  return json({ imageUrl: imageUrl || '' });
}

async function handleParseRecipe(request: Request) {
  const body = await readJsonBody(request);
  const rawSourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';

  if (!rawSourceUrl) {
    throw new HttpError(400, 'sourceUrl is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawSourceUrl);
  } catch (error) {
    throw new HttpError(400, 'sourceUrl must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new HttpError(400, 'sourceUrl must use http or https');
  }

  // For TikTok URLs, use oEmbed API to get the title since direct HTML returns generic "TikTok - Make Your Day"
  if (parsedUrl.hostname.includes('tiktok.com')) {
    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(parsedUrl.toString())}`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
          'Accept': 'application/json'
        }
      });
      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { title?: string; thumbnail_url?: string };
        const caption = (payload.title || '').trim();
        if (caption) {
          const title = extractTikTokRecipeTitle(caption);
          return json({
            parsed: {
              title,
              ingredients: [],
              steps: [],
              mealTypes: inferMealTypesFromTitle(title),
              durationMinutes: null,
              imageUrl: (payload.thumbnail_url || '').trim() || null
            }
          });
        }
      }
    } catch {
      // Fall through to HTML parsing
    }
  }

  const html = await fetchRecipeHtml(parsedUrl.toString());
  if (!html) {
    return json({ parsed: null });
  }

  const parsed = extractRecipeDetailsFromHtml(html, parsedUrl.toString());
  if (!parsed) {
    return json({ parsed: null });
  }

  return json({ parsed });
}

async function handleEnrichRecipe(request: Request, env: Env) {
  const body = await readJsonBody(request);
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!sourceUrl) {
    throw new HttpError(400, 'sourceUrl is required');
  }

  if (!env.GEMINI_SERVICE_ACCOUNT_B64) {
    throw new HttpError(503, 'Enrichment service is not configured');
  }

  // Fetch content and og:image in parallel
  const [rawText, ogImage] = await Promise.all([
    fetchRawRecipeText(sourceUrl),
    fetchOgImage(sourceUrl)
  ]);

  // If we couldn't scrape the page but have a title, let Gemini use its culinary knowledge
  const textForGemini = rawText || (title ? `Recipe: ${title}` : null);
  if (!textForGemini) {
    throw new HttpError(502, 'Failed to fetch content from source URL. Please keep trying.');
  }

  const recipe: Recipe = {
    id: 'enrich-preview',
    userId: 'preview',
    title: title || '',
    sourceUrl,
    imageUrl: '',
    imagePath: null,
    mealTypes: [],
    ingredients: [],
    steps: [],
    durationMinutes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: '',
    previewImage: null
  };

  const prompt = buildGeminiPrompt(recipe, textForGemini);
  const completion = await callGemini(env, prompt);
  const parsed = parseGeminiRecipeJson(completion);

  if (!parsed) {
    console.error('Failed to parse Gemini response:', completion.slice(0, 500));
    throw new HttpError(502, `Failed to parse enrichment response. Gemini returned: ${completion.slice(0, 200)}`);
  }

  // Prioritize og:image from direct fetch, fallback to Gemini's parsed imageUrl
  const imageUrl = ogImage || (typeof parsed.imageUrl === 'string' ? parsed.imageUrl.trim() : '');

  return json({
    enriched: {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : title,
      sourceUrl,
      imageUrl,
      mealTypes: Array.isArray(parsed.mealTypes) ? sanitizeStringArray(parsed.mealTypes) : [],
      ingredients: Array.isArray(parsed.ingredients) ? sanitizeStringArray(parsed.ingredients) : [],
      steps: Array.isArray(parsed.steps) ? sanitizeStringArray(parsed.steps) : [],
      durationMinutes: typeof parsed.durationMinutes === 'number' && Number.isFinite(parsed.durationMinutes)
        ? Math.max(0, Math.round(parsed.durationMinutes))
        : null,
      notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : ''
    }
  });
}

async function handleUpdateRecipe(request: Request, env: Env, user: AuthenticatedUser, recipeId: string) {
  const existing = await loadRecipe(env, user.userId, recipeId);
  const body = await readJsonBody(request);
  const { recipe, previewImagePayload } = normalizeRecipePayload(body, user.userId, existing);

  const shouldRemoveImage = Boolean(previewImagePayload?.remove);
  if (shouldRemoveImage && existing.previewImage?.objectKey) {
    await deleteSupabaseObject(env, existing.previewImage.objectKey);
    recipe.previewImage = null;
    recipe.imagePath = null;
  }

  const hasUpload = previewImagePayload && hasPreviewUpload(previewImagePayload);
  if (hasUpload) {
    if (existing.previewImage?.objectKey) {
      await deleteSupabaseObject(env, existing.previewImage.objectKey);
    }
    const preview = await persistPreviewImage(previewImagePayload, env, user.userId, recipe.id);
    if (preview) {
      recipe.previewImage = preview;
      recipe.imagePath = buildImagePath(recipe.id);
      recipe.imageUrl = preview.publicUrl || recipe.imageUrl;
    }
  }

  await env.DB.prepare(
    `UPDATE recipes SET title = ?, source_url = ?, image_url = ?, image_path = ?, meal_types = ?, ingredients = ?, steps = ?, duration_minutes = ?, notes = ?, preview_image = ?, shared_with_friends = ?, updated_at = ?
     WHERE user_id = ? AND id = ?`
  ).bind(
    recipe.title, recipe.sourceUrl, recipe.imageUrl, recipe.imagePath ?? null,
    JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps),
    recipe.durationMinutes, recipe.notes || '',
    recipe.previewImage ? JSON.stringify(recipe.previewImage) : null,
    recipe.sharedWithFriends ? 1 : 0, recipe.updatedAt,
    user.userId, recipe.id
  ).run();
  await updateCollectionMeta(env, user.userId, { countDelta: 0 });
  return json({ recipe });
}

async function handleDeleteRecipe(env: Env, user: AuthenticatedUser, recipeId: string) {
  const recipe = await loadRecipe(env, user.userId, recipeId);
  if (recipe.previewImage?.objectKey) {
    await deleteSupabaseObject(env, recipe.previewImage.objectKey);
  }
  await env.DB.prepare(
    'DELETE FROM recipes WHERE user_id = ? AND id = ?'
  ).bind(user.userId, recipeId).run();
  await updateCollectionMeta(env, user.userId, { countDelta: -1 });
  return new Response(null, { status: 204, headers: withCors() });
}

async function handleImageRequest(
  request: Request,
  url: URL,
  env: Env,
  user: AuthenticatedUser | null,
  recipeId: string
) {
  let row: Record<string, unknown> | null = null;
  if (user?.userId) {
    row = await env.DB.prepare(
      'SELECT * FROM recipes WHERE user_id = ? AND id = ?'
    ).bind(user.userId, recipeId).first();
  }
  if (!row) {
    row = await env.DB.prepare(
      'SELECT * FROM recipes WHERE id = ? LIMIT 1'
    ).bind(recipeId).first();
  }
  if (!row) {
    throw new HttpError(404, 'Recipe preview not found');
  }
  const recipe = rowToRecipe(row as Record<string, unknown>);
  if (!recipe.previewImage?.objectKey) {
    throw new HttpError(404, 'Recipe preview not found');
  }

  const etag = makeEtag(recipe.previewImage.objectKey);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  const objectResponse = await fetchSupabaseObject(env, recipe.previewImage.objectKey);
  const headers = new Headers(withCors());
  const contentType =
    recipe.previewImage.contentType ||
    objectResponse.headers.get('Content-Type') ||
    objectResponse.headers.get('content-type') ||
    'application/octet-stream';
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', etag);
  headers.set('X-Image-Source', recipe.previewImage.objectKey);

  const requestedSize = Number(url.searchParams.get('size'));
  if (Number.isFinite(requestedSize) && requestedSize > 0) {
    headers.set('X-Image-Resize', `${requestedSize}`);
    // TODO: Integrate Cloudflare Images for real resizing once enabled.
  }

  return new Response(objectResponse.body, { status: 200, headers });
}

// ── Friends route handlers ───────────────────────────────────────────

export async function resolveEmailFromUserId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT email FROM profiles WHERE user_id = ?'
  ).bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}

export async function handleFriendSuggestions(
  db: D1Database,
  userId: string
): Promise<{
  suggestions: Array<
    | { userId: string; name: string; kind: 'fof'; mutualCount: number }
    | { userId: string; name: string; kind: 'pref'; sharedPref: string }
  >;
}> {
  // --- FOF pass (no GROUP_CONCAT, no name leak) ---
  const fofRows = await db.prepare(`
    SELECT
      f2.friend_id                  AS userId,
      p.display_name                AS name,
      COUNT(DISTINCT f1.friend_id)  AS mutualCount
    FROM friends f1
    JOIN friends f2 ON f2.user_id = f1.friend_id
    JOIN profiles p ON p.user_id = f2.friend_id
    WHERE f1.user_id = ?
      AND f2.friend_id != ?
      AND f2.friend_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND f2.friend_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
    GROUP BY f2.friend_id
    ORDER BY mutualCount DESC
    LIMIT 10
  `).bind(userId, userId, userId, userId).all<{ userId: string; name: string; mutualCount: number }>();

  const fofSuggestions = (fofRows.results || []).map(row => ({
    userId: row.userId,
    name: row.name,
    kind: 'fof' as const,
    mutualCount: row.mutualCount,
  }));

  if (fofSuggestions.length >= 5) {
    return { suggestions: fofSuggestions };
  }

  // --- Pref-match fallback ---
  const alreadySuggested = new Set(fofSuggestions.map(s => s.userId));
  const myProfile = await db.prepare(
    'SELECT dietary_prefs, meal_type_prefs FROM profiles WHERE user_id = ?'
  ).bind(userId).first<{ dietary_prefs: string | null; meal_type_prefs: string | null }>();

  const myDietaryPrefs: string[] = myProfile?.dietary_prefs ? JSON.parse(myProfile.dietary_prefs) : [];
  const myMealPrefs: string[] = myProfile?.meal_type_prefs ? JSON.parse(myProfile.meal_type_prefs) : [];
  const allMyPrefs = [...myDietaryPrefs, ...myMealPrefs].filter(p => p && p !== 'None / all good');

  if (allMyPrefs.length === 0) {
    return { suggestions: fofSuggestions };
  }

  const remaining = 10 - fofSuggestions.length;
  const likeClauses = allMyPrefs.map(() => `(p.dietary_prefs LIKE ? OR p.meal_type_prefs LIKE ?)`).join(' OR ');
  const likeBinds = allMyPrefs.flatMap(pref => [`%${pref}%`, `%${pref}%`]);

  const prefRows = await db.prepare(`
    SELECT p.user_id AS userId, p.display_name AS name, p.dietary_prefs, p.meal_type_prefs
    FROM profiles p
    WHERE p.user_id != ?
      AND p.user_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND p.user_id NOT IN (SELECT to_user_id FROM friend_requests_sent WHERE from_user_id = ?)
      AND (${likeClauses})
    ORDER BY p.display_name ASC
    LIMIT ?
  `).bind(userId, userId, userId, ...likeBinds, remaining).all<{
    userId: string;
    name: string;
    dietary_prefs: string | null;
    meal_type_prefs: string | null;
  }>();

  const prefSuggestions = (prefRows.results || [])
    .filter(row => !alreadySuggested.has(row.userId))
    .map(row => {
      // Only surface dietary prefs in the label — meal-type overlaps fall back
      // to a generic "Fellow home cook" string on the client.
      const theirDietaryPrefs: string[] = row.dietary_prefs ? JSON.parse(row.dietary_prefs) : [];
      const sharedPref = myDietaryPrefs.find(p => theirDietaryPrefs.includes(p)) || '';
      return {
        userId: row.userId,
        name: row.name,
        kind: 'pref' as const,
        sharedPref,
      };
    });

  return { suggestions: [...fofSuggestions, ...prefSuggestions] };
}

async function handleSendFriendRequest(request: Request, env: Env, user: AuthenticatedUser, ctx: ExecutionContext) {
  const body = await readJsonBody(request);
  let email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  // userId path: frontend passes userId directly (avoids exposing emails in API responses)
  if (!email && typeof body.userId === 'string' && body.userId.trim()) {
    const resolved = await resolveEmailFromUserId(env.DB, body.userId.trim());
    if (!resolved) throw new HttpError(404, 'User not found');
    email = resolved.toLowerCase();
  }

  if (!email) throw new HttpError(400, 'Email or userId is required');

  if (user.email && email === user.email.toLowerCase()) {
    throw new HttpError(400, 'You cannot add yourself as a friend');
  }

  const targetUser = await lookupUserByEmail(env, email);
  if (!targetUser) {
    // User not on ReciFind yet — send an invite instead
    const existingInvite = await env.DB.prepare(
      'SELECT 1 FROM pending_invites WHERE inviter_user_id = ? AND invited_email = ?'
    ).bind(user.userId, email).first();
    if (existingInvite) {
      throw new HttpError(409, 'You already invited this person');
    }
    const senderProfile = await getOrCreateProfile(env, user.userId, user.email);
    const inviteId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO pending_invites (id, inviter_user_id, inviter_email, inviter_name, invited_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(inviteId, user.userId, user.email || '', senderProfile.displayName, email, now).run();
    ctx.waitUntil(sendEmailNotification(
      env,
      email,
      `${senderProfile.displayName} invited you to ReciFriend`,
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">You're invited to ReciFriend!</h2>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${senderProfile.displayName}</strong> invited you to join <a href="https://recifriend.com" style="color: #6200EA; text-decoration: none;">ReciFriend</a> and share recipes together.</p>
        <a href="https://recifriend.com?invite_token=${inviteId}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Join ReciFriend</a>
        <p style="margin: 24px 0 0; font-size: 13px; color: #999;">Once you create an account, you'll automatically be connected with ${senderProfile.displayName}.</p>
      </div>`
    ));
    return json({ success: true, invited: true, message: 'Invite sent' }, 201);
  }

  const existingFriend = await env.DB.prepare(
    'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
  ).bind(user.userId, targetUser.id).first();
  if (existingFriend) {
    throw new HttpError(409, 'You are already friends with this user');
  }

  const existingSent = await env.DB.prepare(
    'SELECT 1 FROM friend_requests_sent WHERE from_user_id = ? AND to_user_id = ?'
  ).bind(user.userId, targetUser.id).first();
  if (existingSent) {
    throw new HttpError(409, 'Friend request already sent');
  }

  const existingIncoming = await env.DB.prepare(
    'SELECT 1 FROM friend_requests WHERE to_user_id = ? AND from_user_id = ?'
  ).bind(user.userId, targetUser.id).first();
  if (existingIncoming) {
    throw new HttpError(409, 'This user has already sent you a friend request. Check your requests.');
  }

  const senderProfile = await getOrCreateProfile(env, user.userId, user.email);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO friend_requests (to_user_id, from_user_id, from_email, from_name, to_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(targetUser.id, user.userId, user.email || '', senderProfile.displayName, email, 'pending', now),
    env.DB.prepare(
      'INSERT INTO friend_requests_sent (from_user_id, to_user_id) VALUES (?, ?)'
    ).bind(user.userId, targetUser.id)
  ]);

  await addNotification(env, targetUser.id, {
    type: 'friend_request',
    message: `${senderProfile.displayName} sent you a friend request`,
    data: { fromUserId: user.userId, fromEmail: user.email || '' },
    createdAt: now
  });

  ctx.waitUntil(sendEmailNotification(
    env,
    email,
    `${senderProfile.displayName}'s request to add you on ReciFriend`,
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">${senderProfile.displayName}'s request to add you</h2>
      <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${senderProfile.displayName}</strong> wants to add you as a friend on <a href="https://recifriend.com" style="color: #6200EA; text-decoration: none;">ReciFriend</a> and share recipes together.</p>
      <a href="https://recifriend.com?accept_friend=${encodeURIComponent(user.userId)}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Accept</a>
      <p style="margin: 24px 0 0; font-size: 13px; color: #999;">You received this because someone sent you a friend request on ReciFriend.</p>
    </div>`
  ));

  // === [S05] Push notification to recipient ===
  ctx.waitUntil(sendPushToUser(env as any, targetUser.id, {
    title: 'ReciFriend',
    body: `${senderProfile.displayName} wants to connect on ReciFriend`,
    deepLink: 'https://recifriend.com/friend-requests',
  }).catch(() => { /* silent — push is best-effort */ }));
  // === [/S05] ===

  return json({ success: true, message: 'Friend request sent' }, 201);
}

async function handleListFriendRequests(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    'SELECT * FROM friend_requests WHERE to_user_id = ? AND status = ? LIMIT 100'
  ).bind(user.userId, 'pending').all();

  const requests = (result.results || []).map((row) => ({
    fromUserId: row.from_user_id as string,
    fromEmail: row.from_email as string,
    fromName: row.from_name as string,
    toUserId: row.to_user_id as string,
    toEmail: row.to_email as string,
    status: row.status as string,
    createdAt: row.created_at as string,
  }));

  return json({ requests });
}

async function handleListSentFriendRequests(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    `SELECT fr.to_user_id, fr.to_email, fr.created_at
     FROM friend_requests_sent frs
     JOIN friend_requests fr ON fr.to_user_id = frs.to_user_id AND fr.from_user_id = frs.from_user_id
     WHERE frs.from_user_id = ? LIMIT 100`
  ).bind(user.userId).all();

  const sent = (result.results || []).map((row) => ({
    toUserId: row.to_user_id as string,
    toEmail: row.to_email as string,
    createdAt: row.created_at as string,
  }));

  return json({ sent });
}

async function handleListSentInvites(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    'SELECT id, invited_email, created_at FROM pending_invites WHERE inviter_user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(user.userId).all();

  const invites = (result.results || []).map((row) => ({
    inviteId: row.id as string,
    toEmail: row.invited_email as string,
    createdAt: row.created_at as string,
  }));

  return json({ invites });
}

async function handleGetOpenInvite(env: Env, user: AuthenticatedUser): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT token FROM open_invites WHERE inviter_user_id = ? LIMIT 1'
  ).bind(user.userId).first();
  return json({ token: existing ? (existing.token as string) : null });
}

async function handleAcceptInvite(request: Request, env: Env, user: AuthenticatedUser, ctx: ExecutionContext) {
  const body = await readJsonBody(request);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) throw new HttpError(400, 'Invite token is required');

  const invite = await env.DB.prepare(
    'SELECT * FROM pending_invites WHERE id = ?'
  ).bind(token).first();
  if (!invite) throw new HttpError(404, 'Invite not found or already used');

  // Verify the current user's email matches the invited email
  if (user.email?.toLowerCase() !== (invite.invited_email as string).toLowerCase()) {
    throw new HttpError(403, 'This invite was sent to a different email address');
  }

  const inviterUserId = invite.inviter_user_id as string;
  const now = new Date().toISOString();

  // Fetch profiles for both users to populate friend_email/friend_name
  const newUserProfile = await getOrCreateProfile(env, user.userId, user.email);
  const inviterProfile = await getOrCreateProfile(env, inviterUserId, invite.inviter_email as string);

  // Create bilateral friend connection directly (no accept step needed)
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(inviterUserId, user.userId, newUserProfile.email, newUserProfile.displayName, now),
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
    env.DB.prepare('DELETE FROM pending_invites WHERE id = ?').bind(token),
  ]);
  ctx.waitUntil(addNotification(env, inviterUserId, {
    type: 'friend_request',
    message: `${newUserProfile.displayName} accepted your invite and joined ReciFriend!`,
    data: { fromUserId: user.userId, fromEmail: user.email || '' },
    createdAt: now,
  }));

  return json({ success: true, message: 'You are now connected!', inviterName: inviterProfile.displayName });
}

async function handleCheckInvites(env: Env, user: AuthenticatedUser, ctx: ExecutionContext) {
  if (!user.email) return json({ connected: [] });

  const result = await env.DB.prepare(
    'SELECT * FROM pending_invites WHERE LOWER(invited_email) = LOWER(?)'
  ).bind(user.email).all();

  const invites = result.results || [];
  if (invites.length === 0) return json({ connected: [] });

  const now = new Date().toISOString();
  const newUserProfile = await getOrCreateProfile(env, user.userId, user.email);
  const connected: string[] = [];

  for (const invite of invites) {
    const inviterUserId = invite.inviter_user_id as string;

    // Skip if already friends
    const existing = await env.DB.prepare(
      'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
    ).bind(user.userId, inviterUserId).first();
    if (existing) {
      // Clean up the stale invite
      await env.DB.prepare('DELETE FROM pending_invites WHERE id = ?').bind(invite.id).run();
      continue;
    }

    const inviterProfile = await getOrCreateProfile(env, inviterUserId, invite.inviter_email as string);

    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(inviterUserId, user.userId, newUserProfile.email, newUserProfile.displayName, now),
      env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)').bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
      env.DB.prepare('DELETE FROM pending_invites WHERE id = ?').bind(invite.id),
    ]);

    connected.push(inviterProfile.displayName);

    ctx.waitUntil(addNotification(env, inviterUserId, {
      type: 'friend_request',
      message: `${newUserProfile.displayName} accepted your invite and joined ReciFriend!`,
      data: { fromUserId: user.userId, fromEmail: user.email || '' },
      createdAt: now,
    }));
  }

  return json({ connected });
}

async function handleCancelInvite(env: Env, user: AuthenticatedUser, inviteId: string) {
  const invite = await env.DB.prepare(
    'SELECT * FROM pending_invites WHERE id = ? AND inviter_user_id = ?'
  ).bind(inviteId, user.userId).first();
  if (!invite) throw new HttpError(404, 'Invite not found');

  await env.DB.prepare('DELETE FROM pending_invites WHERE id = ?').bind(inviteId).run();
  return json({ success: true });
}

async function handleAcceptFriendRequest(_request: Request, env: Env, user: AuthenticatedUser, fromUserId: string, ctx: ExecutionContext) {
  const friendReq = await env.DB.prepare(
    'SELECT * FROM friend_requests WHERE to_user_id = ? AND from_user_id = ? AND status = ?'
  ).bind(user.userId, fromUserId, 'pending').first();
  if (!friendReq) {
    throw new HttpError(404, 'Friend request not found');
  }

  const now = new Date().toISOString();
  const userProfile = await getOrCreateProfile(env, user.userId, user.email);
  const fromProfile = await getOrCreateProfile(env, fromUserId, friendReq.from_email as string);

  const friendA: Friend = {
    friendId: fromUserId,
    friendEmail: fromProfile.email,
    friendName: fromProfile.displayName,
    connectedAt: now
  };

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, fromUserId, fromProfile.email, fromProfile.displayName, now),
    env.DB.prepare(
      'INSERT INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(fromUserId, user.userId, userProfile.email, userProfile.displayName, now),
    env.DB.prepare(
      'DELETE FROM friend_requests WHERE to_user_id = ? AND from_user_id = ?'
    ).bind(user.userId, fromUserId),
    env.DB.prepare(
      'DELETE FROM friend_requests_sent WHERE from_user_id = ? AND to_user_id = ?'
    ).bind(fromUserId, user.userId)
  ]);

  await addNotification(env, fromUserId, {
    type: 'friend_accepted',
    message: `${userProfile.displayName} accepted your friend request`,
    data: { friendId: user.userId, friendEmail: userProfile.email },
    createdAt: now
  });

  ctx.waitUntil(sendEmailNotification(
    env,
    fromProfile.email,
    `${userProfile.displayName} accepted your friend request on ReciFriend`,
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">You're now connected!</h2>
      <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${userProfile.displayName}</strong> accepted your friend request. You can now share recipes with each other on ReciFriend.</p>
      <a href="https://recifriend.com" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Open ReciFriend</a>
      <p style="margin: 24px 0 0; font-size: 13px; color: #999;">You received this because your friend request was accepted on ReciFriend.</p>
    </div>`
  ));

  return json({ success: true, friend: friendA });
}

async function handleDeclineFriendRequest(env: Env, user: AuthenticatedUser, fromUserId: string) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM friend_requests WHERE to_user_id = ? AND from_user_id = ?'
    ).bind(user.userId, fromUserId),
    env.DB.prepare(
      'DELETE FROM friend_requests_sent WHERE from_user_id = ? AND to_user_id = ?'
    ).bind(fromUserId, user.userId)
  ]);
  return json({ success: true });
}

async function handleCancelSentFriendRequest(env: Env, user: AuthenticatedUser, toUserId: string) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM friend_requests WHERE to_user_id = ? AND from_user_id = ?'
    ).bind(toUserId, user.userId),
    env.DB.prepare(
      'DELETE FROM friend_requests_sent WHERE from_user_id = ? AND to_user_id = ?'
    ).bind(user.userId, toUserId)
  ]);
  return json({ success: true });
}

async function handleListFriends(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    'SELECT * FROM friends WHERE user_id = ? LIMIT 100'
  ).bind(user.userId).all();

  const friends = (result.results || []).map((row) => ({
    friendId: row.friend_id as string,
    friendEmail: row.friend_email as string,
    friendName: row.friend_name as string,
    connectedAt: row.connected_at as string,
  }));

  return json({ friends });
}

async function handleCreateOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  // Return existing token if one exists (permanent until explicitly regenerated)
  const existing = await env.DB.prepare(
    'SELECT token FROM open_invites WHERE inviter_user_id = ? LIMIT 1'
  ).bind(user.userId).first();

  if (existing) {
    return json({ token: existing.token as string });
  }

  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const token = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO open_invites (token, inviter_user_id, inviter_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.userId, profile.displayName || null, now).run();

  return json({ token });
}

async function handleRegenerateOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const body = await request.json() as { generateNew?: boolean };
  const generateNew = body.generateNew !== false; // default true

  // Delete existing token
  await env.DB.prepare('DELETE FROM open_invites WHERE inviter_user_id = ?').bind(user.userId).run();

  if (!generateNew) {
    return json({ token: null });
  }

  const profile = await getOrCreateProfile(env, user.userId, user.email);
  const token = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO open_invites (token, inviter_user_id, inviter_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.userId, profile.displayName || null, now).run();

  return json({ token });
}

async function handleAcceptOpenInvite(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const body = await request.json() as { token?: string };
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) throw new HttpError(400, 'Token is required');

  const invite = await env.DB.prepare(
    'SELECT * FROM open_invites WHERE token = ?'
  ).bind(token).first();

  if (!invite) throw new HttpError(404, 'Invite not found or already used');

  const inviterUserId = invite.inviter_user_id as string;

  // Prevent self-connection
  if (inviterUserId === user.userId) {
    return json({ message: 'Cannot accept your own invite' });
  }

  // Check if already friends
  const existing = await env.DB.prepare(
    'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
  ).bind(user.userId, inviterUserId).first();

  if (existing) {
    return json({ message: 'Already friends' });
  }

  // Block re-accept: if accepter has previously used this inviter's link, deny
  const previouslyUsed = await env.DB.prepare(
    'SELECT 1 FROM open_invite_used WHERE inviter_user_id = ? AND accepter_user_id = ?'
  ).bind(inviterUserId, user.userId).first();

  if (previouslyUsed) {
    return json({ message: 'Already used' });
  }

  const accepterProfile = await getOrCreateProfile(env, user.userId, user.email);
  const inviterProfile = await getOrCreateProfile(env, inviterUserId, '');
  const now = new Date().toISOString();

  const inviterName = (invite.inviter_name as string | null) || null;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(inviterUserId, user.userId, accepterProfile.email, accepterProfile.displayName, now),
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
  ]);

  await env.DB.prepare(
    'INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at) VALUES (?, ?, ?)'
  ).bind(inviterUserId, user.userId, now).run();

  // Notify the inviter
  const notifId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, type, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(
    notifId,
    inviterUserId,
    'invite_accepted',
    JSON.stringify({ fromUserId: user.userId, fromName: accepterProfile.displayName }),
    now
  ).run();

  return json({ message: 'Connected!', inviterName });
}

async function handleRemoveFriend(env: Env, user: AuthenticatedUser, friendId: string) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM friends WHERE user_id = ? AND friend_id = ?'
    ).bind(user.userId, friendId),
    env.DB.prepare(
      'DELETE FROM friends WHERE user_id = ? AND friend_id = ?'
    ).bind(friendId, user.userId)
  ]);
  return json({ success: true });
}

async function handleGetFriendRecipes(request: Request, env: Env, user: AuthenticatedUser, friendId: string) {
  const friendship = await env.DB.prepare(
    'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'
  ).bind(user.userId, friendId).first();
  if (!friendship) {
    throw new HttpError(403, 'You are not friends with this user');
  }

  const friendMeta = await getCollectionMeta(env, friendId);
  const etag = makeEtag(`friend-recipes-${friendId}-${friendMeta?.version ?? 0}`);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  const result = await env.DB.prepare(
    'SELECT * FROM recipes WHERE user_id = ? AND shared_with_friends = 1 ORDER BY created_at DESC'
  ).bind(friendId).all();

  const sharedRecipes = (result.results || []).map((row) => {
    const r = rowToRecipe(row as Record<string, unknown>);
    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      sourceUrl: r.sourceUrl || '',
      imageUrl: r.imageUrl || '',
      imagePath: r.imagePath || null,
      mealTypes: r.mealTypes || [],
      ingredients: r.ingredients || [],
      steps: r.steps || [],
      durationMinutes: r.durationMinutes || null,
      notes: r.notes || '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  });

  return json({ recipes: sharedRecipes }, 200, cacheHeaders({
    visibility: 'private', maxAge: 60, etag,
    lastModified: friendMeta?.updatedAt ? new Date(friendMeta.updatedAt) : undefined
  }));
}

async function handleGetNotifications(env: Env, user: AuthenticatedUser) {
  const result = await env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.userId).all();

  const items = (result.results || []).map((row) => ({
    type: row.type as string,
    message: row.message as string,
    data: JSON.parse((row.data as string) || '{}'),
    createdAt: row.created_at as string,
    read: Boolean(row.read),
  }));

  return json({
    notifications: items,
    unreadCount: items.filter((n) => !n.read).length
  });
}

async function handleMarkNotificationsRead(env: Env, user: AuthenticatedUser) {
  await env.DB.prepare(
    'UPDATE notifications SET read = 1 WHERE user_id = ?'
  ).bind(user.userId).run();
  return json({ success: true });
}

// ── End friends route handlers ───────────────────────────────────────

async function loadRecipe(env: Env, userId: string, recipeId: string): Promise<Recipe> {
  const row = await env.DB.prepare(
    'SELECT * FROM recipes WHERE user_id = ? AND id = ?'
  ).bind(userId, recipeId).first();
  if (!row) {
    throw new HttpError(404, 'Recipe not found');
  }
  return rowToRecipe(row as Record<string, unknown>);
}

async function readJsonBody(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (!raw) {
    throw new HttpError(400, 'Missing JSON body');
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Body must be an object');
    }
    return parsed as Record<string, any>;
  } catch (error) {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

function normalizeRecipePayload(
  payload: Record<string, any>,
  userId: string,
  existing?: Recipe
): NormalizedRecipePayload {
  const now = new Date().toISOString();
  const recipe: Recipe = existing
    ? { ...existing }
    : {
        id: crypto.randomUUID(),
        userId,
        title: '',
        sourceUrl: '',
        imageUrl: '',
        imagePath: null,
        mealTypes: [],
        ingredients: [],
        steps: [],
        durationMinutes: null,
        createdAt: now,
        updatedAt: now,
        notes: '',
        previewImage: null,
        sharedWithFriends: true
      };

  recipe.updatedAt = now;

  if ('title' in payload || !existing) {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (!title) {
      throw new HttpError(400, 'Title is required');
    }
    recipe.title = title;
  }

  if ('sourceUrl' in payload || !existing) {
    recipe.sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl.trim() : '';
  }

  if ('imageUrl' in payload || !existing) {
    recipe.imageUrl = typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : '';
  }

  if ('mealTypes' in payload || !existing) {
    recipe.mealTypes = sanitizeStringArray(payload.mealTypes);
  }

  if ('ingredients' in payload || !existing) {
    recipe.ingredients = sanitizeStringArray(payload.ingredients);
  }

  if ('steps' in payload || !existing) {
    recipe.steps = sanitizeStringArray(payload.steps);
  }

  if ('durationMinutes' in payload || !existing) {
    recipe.durationMinutes = sanitizeDuration(payload.durationMinutes);
  }

  if ('notes' in payload) {
    recipe.notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
  }

  if ('sharedWithFriends' in payload) {
    recipe.sharedWithFriends = Boolean(payload.sharedWithFriends);
  }

  return {
    recipe,
    previewImagePayload: extractPreviewImagePayload(payload.previewImage)
  };
}

function sanitizeStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => Boolean(entry));
}

function sanitizeDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return null;
}

function extractPreviewImagePayload(input: unknown): PreviewImagePayload | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const value = input as Record<string, any>;
  const payload: PreviewImagePayload = {};
  if (typeof value.data === 'string' && value.data.trim()) {
    payload.data = value.data.trim();
  }
  if (typeof value.dataUrl === 'string' && value.dataUrl.trim()) {
    payload.dataUrl = value.dataUrl.trim();
  }
  if (typeof value.url === 'string' && value.url.trim()) {
    payload.url = value.url.trim();
  }
  if (typeof value.contentType === 'string' && value.contentType.trim()) {
    payload.contentType = value.contentType.trim();
  }
  if (typeof value.filename === 'string' && value.filename.trim()) {
    payload.filename = value.filename.trim();
  }
  if ('remove' in value) {
    payload.remove = Boolean(value.remove);
  }

  const hasField = Object.keys(payload).length > 0;
  return hasField ? payload : null;
}

function hasPreviewUpload(payload: PreviewImagePayload): boolean {
  return Boolean(payload.data || payload.dataUrl || payload.url);
}

async function persistPreviewImage(
  payload: PreviewImagePayload | null,
  env: Env,
  userId: string,
  recipeId: string
): Promise<ImageMetadata | null> {
  if (!payload || payload.remove) {
    return null;
  }
  let arrayBuffer: ArrayBuffer | null = null;
  let contentType = payload.contentType?.trim() || 'image/jpeg';
  let source: string | null = payload.url ?? null;

  if (payload.dataUrl) {
    const { mime, buffer } = parseDataUrl(payload.dataUrl);
    arrayBuffer = buffer;
    if (mime) {
      contentType = mime;
    }
  } else if (payload.data) {
    arrayBuffer = base64ToArrayBuffer(payload.data);
  } else if (payload.url) {
    try {
      const response = await fetch(payload.url, { cf: { cacheTtl: 60 } });
      if (!response.ok) {
        console.warn('Failed to download preview image from URL:', payload.url, response.status);
        return null;
      }
      const buffer = await response.arrayBuffer();
      arrayBuffer = buffer;
      contentType = response.headers.get('content-type') || contentType;
    } catch (error) {
      console.warn('Error downloading preview image:', error);
      return null;
    }
  } else {
    return null;
  }

  if (!arrayBuffer) {
    return null;
  }

  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'Preview image is larger than 5MB limit');
  }

  const objectKey = buildSupabaseObjectKey(userId, recipeId);
  const publicUrl = await uploadToSupabaseStorage(env, objectKey, arrayBuffer, contentType);

  return {
    objectKey,
    contentType,
    size: arrayBuffer.byteLength,
    uploadedAt: new Date().toISOString(),
    source,
    publicUrl
  };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)((?:;[^,]+)*?),(.*)$/s);
  if (!match) {
    throw new HttpError(400, 'Invalid data URL for preview image');
  }
  const [, mime, params = '', dataPart = ''] = match;
  const isBase64 = params.split(';').some((param) => param.trim().toLowerCase() === 'base64');
  if (isBase64) {
    return { mime: mime || 'image/jpeg', buffer: base64ToArrayBuffer(dataPart) };
  }
  const decoded = decodeURIComponent(dataPart);
  const encoded = textEncoder.encode(decoded);
  const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  return { mime: mime || 'image/jpeg', buffer: buffer as ArrayBuffer };
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const sanitized = value.replace(/\\s+/g, '');
  const binary = atob(sanitized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64UrlEncodeString(value: string) {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function arrayBufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}


async function getCollectionMeta(env: Env, userId: string): Promise<RecipeCollectionMeta | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM collection_meta WHERE user_id = ?'
  ).bind(userId).first();
  if (!row) return null;
  return {
    count: row.count as number,
    updatedAt: row.updated_at as string,
    version: row.version as number,
  };
}

async function updateCollectionMeta(
  env: Env,
  userId: string,
  update: { countDelta?: number; forceCount?: number }
): Promise<RecipeCollectionMeta> {
  const existing = await getCollectionMeta(env, userId);

  let newCount: number;
  if (typeof update.forceCount === 'number') {
    newCount = update.forceCount;
  } else {
    newCount = (existing?.count ?? 0) + (update.countDelta ?? 0);
  }

  const meta: RecipeCollectionMeta = {
    count: Math.max(0, newCount),
    updatedAt: new Date().toISOString(),
    version: (existing?.version ?? 0) + 1
  };

  await env.DB.prepare(
    'INSERT OR REPLACE INTO collection_meta (user_id, count, updated_at, version) VALUES (?, ?, ?, ?)'
  ).bind(userId, meta.count, meta.updatedAt, meta.version).run();
  return meta;
}

// ── Friends helpers ──────────────────────────────────────────────────

async function lookupUserByEmail(env: Env, email: string): Promise<{ id: string; email: string } | null> {
  try {
    // Use filter param to avoid fetching all users (substring match, then exact check)
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`;
    const response = await fetch(url, {
      headers: createSupabaseHeaders(env, { 'Content-Type': 'application/json' })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Supabase admin users lookup failed:', response.status, errorText);
      throw new HttpError(502, 'Unable to look up user. Please try again.');
    }
    const data = (await response.json()) as { users?: Array<{ id: string; email?: string }> };
    if (!Array.isArray(data.users)) {
      console.error('Supabase admin users response missing users array:', JSON.stringify(data).slice(0, 200));
      throw new HttpError(502, 'Unable to look up user. Please try again.');
    }
    // Exact match (filter does substring matching)
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    return found ? { id: found.id, email: found.email || email } : null;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('lookupUserByEmail error:', err);
    throw new HttpError(502, 'Unable to look up user. Please try again.');
  }
}

async function getOrCreateProfile(env: Env, userId: string, email?: string): Promise<UserProfile> {
  const row = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ?'
  ).bind(userId).first();
  if (row) {
    return {
      userId: row.user_id as string,
      email: row.email as string,
      displayName: row.display_name as string,
      createdAt: row.created_at as string,
      cookingFor: (row.cooking_for as string | null | undefined) ?? null,
      cuisinePrefs: (() => { try { return row.cuisine_prefs ? JSON.parse(row.cuisine_prefs as string) : []; } catch { return []; } })(),
      dietaryPrefs: (() => { try { return row.dietary_prefs ? JSON.parse(row.dietary_prefs as string) : []; } catch { return []; } })(),
    };
  }

  const profile: UserProfile = {
    userId,
    email: email || '',
    displayName: email?.split('@')[0] || 'User',
    createdAt: new Date().toISOString(),
    cookingFor: null,
    cuisinePrefs: [],
    dietaryPrefs: [],
  };
  await env.DB.prepare(
    'INSERT INTO profiles (user_id, email, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(profile.userId, profile.email, profile.displayName, profile.createdAt).run();
  // Schedule nudge email for 24h from now
  const sendAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO nudge_emails (user_id, email, display_name, send_after, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(profile.userId, profile.email, profile.displayName, sendAfter, profile.createdAt).run();
  return profile;
}

async function addNotification(env: Env, userId: string, notification: Omit<NotificationItem, 'read'>) {
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, type, message, data, created_at, read) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(
    userId, notification.type, notification.message,
    JSON.stringify(notification.data), notification.createdAt
  ).run();
  // Trim to 50 most recent
  await env.DB.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
      SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    )`
  ).bind(userId, userId).run();
}

async function sendEmailNotification(env: Env, to: string, subject: string, html: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, body: 'RESEND_API_KEY not set' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ReciFriend <hello@recifriend.com>',
        to,
        subject,
        html
      })
    });
    const body = await resp.text();
    if (!resp.ok) {
      console.error(`Resend API error ${resp.status}: ${body}`);
    }
    return { ok: resp.ok, status: resp.status, body };
  } catch (err) {
    console.error('Failed to send email notification:', err);
    return { ok: false, body: String(err) };
  }
}

async function computeHmac(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface RecommendedRecipe {
  id: string;
  userId: string;
  title: string;
  durationMinutes: number | null;
  mealTypes: string[];
  imageUrl: string;
  shareUrl: string;
}

async function getOrCreateShareToken(db: D1Database, recipeUserId: string, recipeId: string): Promise<string> {
  const existing = await db.prepare(
    'SELECT token FROM share_links WHERE user_id = ? AND recipe_id = ?'
  ).bind(recipeUserId, recipeId).first<{ token: string }>();
  if (existing) return existing.token;

  const token = generateShareToken();
  await db.prepare(
    'INSERT INTO share_links (token, user_id, recipe_id, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, recipeUserId, recipeId, new Date().toISOString()).run();
  return token;
}

async function getRecommendedRecipes(
  db: D1Database,
  userId: string,
  limit = 3
): Promise<RecommendedRecipe[]> {
  // Try preference-matched recipes first
  const profile = await db.prepare(
    'SELECT dietary_prefs, cuisine_prefs, meal_type_prefs FROM profiles WHERE user_id = ?'
  ).bind(userId).first();

  let rawRecipes: Array<{ id: string; userId: string; title: string; durationMinutes: number | null; mealTypes: string[]; imageUrl: string }> = [];

  if (profile) {
    const allPrefs: string[] = [];
    for (const col of ['dietary_prefs', 'cuisine_prefs', 'meal_type_prefs'] as const) {
      try {
        const parsed = profile[col] ? JSON.parse(profile[col] as string) : [];
        if (Array.isArray(parsed)) allPrefs.push(...parsed);
      } catch { /* skip */ }
    }
    const validPrefs = allPrefs.filter(p => p && p !== 'None / all good');

    if (validPrefs.length > 0) {
      const likeClauses = validPrefs.map(() => '(r.meal_types LIKE ? OR r.ingredients LIKE ?)').join(' OR ');
      const likeBinds = validPrefs.flatMap(pref => [`%${pref}%`, `%${pref}%`]);
      const rows = await db.prepare(
        `SELECT id, user_id, title, duration_minutes, meal_types, image_url FROM recipes r
         WHERE r.user_id != ? AND r.shared_with_friends = 1 AND (${likeClauses})
         ORDER BY RANDOM() LIMIT ?`
      ).bind(userId, ...likeBinds, limit).all();

      if (rows.results.length > 0) {
        rawRecipes = rows.results.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          userId: String(r.user_id),
          title: String(r.title),
          durationMinutes: r.duration_minutes as number | null,
          mealTypes: (() => { try { return JSON.parse(r.meal_types as string); } catch { return []; } })(),
          imageUrl: String(r.image_url || ''),
        }));
      }
    }
  }

  // Fallback: curated community recipes
  if (rawRecipes.length === 0) {
    const fallback = await getTrendingRecipes(db);
    rawRecipes = fallback.sort(() => Math.random() - 0.5).slice(0, limit).map(r => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      durationMinutes: r.durationMinutes,
      mealTypes: r.mealTypes,
      imageUrl: r.imageUrl,
    }));
  }

  // Generate share links for each recipe
  const results: RecommendedRecipe[] = [];
  for (const r of rawRecipes) {
    const token = await getOrCreateShareToken(db, r.userId, r.id);
    results.push({
      ...r,
      shareUrl: `https://recifriend.com/?share=${token}`,
    });
  }
  return results;
}

async function getRecipesForUser(
  db: D1Database,
  userId: string,
  limit = 11
): Promise<Array<{
  id: string; userId: string; title: string; sourceUrl: string; imageUrl: string;
  mealTypes: string[]; durationMinutes: number | null;
  ingredients: string[]; steps: string[];
}>> {
  const profile = await db.prepare(
    'SELECT dietary_prefs, cuisine_prefs, meal_type_prefs FROM profiles WHERE user_id = ?'
  ).bind(userId).first();

  if (profile) {
    const allPrefs: string[] = [];
    for (const col of ['dietary_prefs', 'cuisine_prefs', 'meal_type_prefs'] as const) {
      try {
        const parsed = profile[col] ? JSON.parse(profile[col] as string) : [];
        if (Array.isArray(parsed)) allPrefs.push(...parsed);
      } catch { /* skip */ }
    }
    const validPrefs = allPrefs.filter(p => p && p !== 'None / all good');

    if (validPrefs.length > 0) {
      const likeClauses = validPrefs.map(() => '(r.meal_types LIKE ? OR r.ingredients LIKE ?)').join(' OR ');
      const likeBinds = validPrefs.flatMap(pref => [`%${pref}%`, `%${pref}%`]);
      const rows = await db.prepare(
        `SELECT id, user_id, title, source_url, image_url, meal_types, duration_minutes, ingredients, steps
         FROM recipes r
         WHERE r.user_id != ? AND r.shared_with_friends = 1 AND (${likeClauses})
         ORDER BY RANDOM() LIMIT ?`
      ).bind(userId, ...likeBinds, limit).all();

      if (rows.results.length > 0) {
        return (rows.results as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          userId: String(r.user_id),
          title: String(r.title),
          sourceUrl: String(r.source_url || ''),
          imageUrl: String(r.image_url || ''),
          mealTypes: JSON.parse(String(r.meal_types || '[]')),
          durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
          ingredients: JSON.parse(String(r.ingredients || '[]')),
          steps: JSON.parse(String(r.steps || '[]')),
        }));
      }
    }
  }

  return getEditorsPick(db);
}

function buildNudgeEmailHtml(
  displayName: string,
  recipes: RecommendedRecipe[],
  gifUrl: string | null
): string {
  const recipeCardsHtml = recipes.map(r => {
    const tag = r.mealTypes[0] || 'Recipe';
    const duration = r.durationMinutes ? `${r.durationMinutes} min` : '';
    const label = [duration, tag].filter(Boolean).join(' \u00b7 ');
    const imgHtml = r.imageUrl
      ? `<img src="${r.imageUrl}" alt="${r.title}" width="260" height="180" style="width:100%;height:180px;object-fit:cover;display:block;" />`
      : `<div style="width:100%;height:180px;background:#f0e6d6;text-align:center;line-height:180px;font-size:48px;">🍳</div>`;
    return `<td style="width:50%;vertical-align:top;padding:0 6px;">
      <a href="${r.shareUrl}" style="text-decoration:none;color:inherit;display:block;border:1px solid #eee;border-radius:10px;overflow:hidden;">
        ${imgHtml}
        <div style="padding:10px 10px 14px;">
          <div style="font-size:12px;font-weight:700;color:#1a1a1a;text-transform:uppercase;line-height:1.35;max-height:33px;overflow:hidden;">${r.title}</div>
          <div style="font-size:11px;color:#888;margin-top:8px;">${label}</div>
        </div>
      </a>
    </td>`;
  }).slice(0, 2).join('\n    ');

  const gifSection = gifUrl
    ? `<div style="padding:0 24px 8px;">
        <div style="border-radius:12px;overflow:hidden;border:1px solid #eee;">
          <img src="${gifUrl}" alt="How to save a recipe" style="width:100%;display:block;" />
        </div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;">

  <div style="background:#6200EA;padding:32px 24px;text-align:center;">
    <div style="font-size:28px;font-weight:700;color:#fff;">🍳 ReciFriend</div>
    <div style="color:rgba(255,255,255,0.9);margin-top:8px;font-size:15px;">Your personal recipe collection</div>
  </div>

  <div style="padding:32px 24px 16px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">Hey ${displayName}! 👋</div>
    <p style="color:#555;font-size:15px;line-height:1.6;margin-top:12px;">
      Welcome to ReciFriend! You haven't saved your first recipe yet. It only takes a few seconds — here's how:
    </p>
  </div>

  ${gifSection}

  <div style="padding:16px 24px 8px;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="width:28px;vertical-align:top;">
          <div style="background:#6200EA;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-weight:700;font-size:14px;">1</div>
          <div style="width:28px;text-align:center;color:#ccc;font-size:14px;padding:6px 0;">&#8595;</div>
          <div style="background:#6200EA;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-weight:700;font-size:14px;">2</div>
          <div style="width:28px;text-align:center;color:#ccc;font-size:14px;padding:6px 0;">&#8595;</div>
          <div style="background:#6200EA;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-weight:700;font-size:14px;">3</div>
        </td>
        <td style="vertical-align:top;padding-left:12px;">
          <div style="height:28px;display:flex;align-items:center;"><div><div style="color:#1a1a1a;font-size:14px;font-weight:600;">Find a recipe online</div><div style="color:#888;font-size:12px;margin-top:1px;">TikTok, Instagram, any website</div></div></div>
          <div style="height:26px;"></div>
          <div style="height:28px;display:flex;align-items:center;"><div><div style="color:#1a1a1a;font-size:14px;font-weight:600;">Paste the URL</div><div style="color:#888;font-size:12px;margin-top:1px;">Copy the link and paste it into ReciFriend</div></div></div>
          <div style="height:26px;"></div>
          <div style="height:28px;display:flex;align-items:center;"><div><div style="color:#1a1a1a;font-size:14px;font-weight:600;">We auto-fill everything!</div><div style="color:#888;font-size:12px;margin-top:1px;">Ingredients, steps, and photo — just hit Save</div></div></div>
        </td>
      </tr>
    </table>
  </div>

  <div style="text-align:center;padding:20px 24px 32px;">
    <a href="https://recifriend.com/?add=1" style="display:inline-block;background:#6200EA;color:#fff;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:700;">Save Your First Recipe →</a>
  </div>

  <div style="border-top:1px solid #eee;margin:0 24px;"></div>

  <!-- recommended v3 ${new Date().toISOString()} -->
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="padding:32px 24px 12px;">
      <div style="font-size:18px;font-weight:700;color:#1a1a1a;">Recommended for you</div>
      <div style="color:#888;font-size:13px;margin-top:4px;">${recipes.length > 0 && recipes[0].mealTypes.length > 0 ? 'Based on your preferences' : 'Popular in the community'}</div>
    </td></tr>
    <tr><td style="padding:0 16px 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      ${recipeCardsHtml}
      </tr></table>
    </td></tr>
  </table>

  <div style="border-top:1px solid #eee;margin:0 24px;"></div>

  <div style="padding:32px 24px;">
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px;padding:24px;text-align:center;color:#fff;">
      <div style="font-size:24px;margin-bottom:8px;">🎁</div>
      <div style="font-size:18px;font-weight:700;">Invite friends, earn rewards!</div>
      <p style="font-size:14px;opacity:0.9;margin:12px 0 16px;line-height:1.5;">
        Invite 5 friends and when each friend adds 5 recipes, you'll earn a <strong>gift card</strong> and a <strong>mystery goody bag</strong>!
      </p>
      <a href="https://recifriend.com" style="display:inline-block;background:#fff;color:#764ba2;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">Invite Friends →</a>
    </div>
  </div>

  <div style="background:#f9f9f9;padding:24px;text-align:center;border-top:1px solid #eee;">
    <div style="color:#999;font-size:12px;line-height:1.6;">
      You're receiving this because you signed up for ReciFriend.<br>
      <a href="https://api.recifriend.com/unsubscribe?userId=__USER_ID__&token=__TOKEN__" style="color:#999;">Unsubscribe</a>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── End friends helpers ──────────────────────────────────────────────

function buildImagePath(recipeId: string) {
  return `/images/${encodeURIComponent(recipeId)}`;
}

function buildSupabaseObjectKey(userId: string, recipeId: string) {
  const safeUserId = sanitizePathSegment(userId);
  const safeRecipeId = sanitizePathSegment(recipeId);
  return `preview/${safeUserId}/${safeRecipeId}/${crypto.randomUUID()}`;
}

function sanitizePathSegment(value: string) {
  if (!value) {
    return 'unknown';
  }
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function buildSupabaseObjectUrl(env: Env, objectKey: string) {
  if (!env.SUPABASE_URL) {
    throw new HttpError(500, 'SUPABASE_URL is not configured');
  }
  if (!env.SUPABASE_STORAGE_BUCKET) {
    throw new HttpError(500, 'SUPABASE_STORAGE_BUCKET is not configured');
  }
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const bucket = encodeURIComponent(env.SUPABASE_STORAGE_BUCKET);
  const encodedKey = objectKey
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/storage/v1/object/${bucket}/${encodedKey}`;
}

function buildSupabasePublicUrl(env: Env, objectKey: string) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const bucket = encodeURIComponent(env.SUPABASE_STORAGE_BUCKET);
  const encodedKey = objectKey
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/storage/v1/object/public/${bucket}/${encodedKey}`;
}

function createSupabaseHeaders(env: Env, overrides: Record<string, string> = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY
  };
  return { ...baseHeaders, ...overrides };
}

async function uploadToSupabaseStorage(
  env: Env,
  objectKey: string,
  buffer: ArrayBuffer,
  contentType: string
) {
  const url = buildSupabaseObjectUrl(env, objectKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: createSupabaseHeaders(env, {
      'Content-Type': contentType,
      'X-Upsert': 'true'
    }),
    body: buffer
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new HttpError(500, `Failed to upload preview image: ${errorText || response.statusText}`);
  }
  return buildSupabasePublicUrl(env, objectKey);
}

async function deleteSupabaseObject(env: Env, objectKey: string) {
  const url = buildSupabaseObjectUrl(env, objectKey);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: createSupabaseHeaders(env)
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new HttpError(500, `Failed to delete preview image: ${errorText || response.statusText}`);
  }
}

async function fetchSupabaseObject(env: Env, objectKey: string) {
  const url = buildSupabaseObjectUrl(env, objectKey);
  const response = await fetch(url, {
    headers: createSupabaseHeaders(env)
  });
  if (response.status === 404) {
    throw new HttpError(404, 'Preview image not found');
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new HttpError(500, `Failed to download preview image: ${errorText || response.statusText}`);
  }
  return response;
}

async function fetchRecipeHtml(sourceUrl: string): Promise<string | null> {
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeWorker/1.0)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      cf: { cacheTtl: 120 }
    });
    if (!response.ok) {
      return null;
    }
    return response.text();
  } catch (error) {
    console.warn('Failed to fetch recipe HTML', error);
    return null;
  }
}

function extractInstagramRecipeTitle(ogTitle: string): string {
  // Instagram og:title format: "Author on Instagram: "Caption text...""
  // Extract just the recipe name from the beginning of the caption

  // Decode HTML entities first
  ogTitle = decodeHtmlEntities(ogTitle);

  // Remove the "Author on Instagram: " prefix
  const colonMatch = ogTitle.match(/on Instagram:\s*[""]?(.+)/i);
  let caption = colonMatch ? colonMatch[1] : ogTitle;

  // Remove surrounding quotes if present
  caption = caption.replace(/^[""]|[""]$/g, '').trim();

  // Extract the recipe title - typically the first part before emoji or long description
  // Look for common patterns:
  // 1. Text before first emoji
  // 2. Text before "It's", "This", etc.
  // 3. First sentence or phrase

  // First, try to get text before first emoji (common in food posts)
  const emojiMatch = caption.match(/^([^🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🫒🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🦴🌭🍔🍟🍕🫓🥪🥙🧆🌮🌯🫔🥗🥘🫕🥫🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼🫖☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊🥄🍴🍽️🥣🥡🥢🧂⭐✨💯🔥❤️😍🤤👨‍🍳👩‍🍳📝✅]+)/u);

  if (emojiMatch && emojiMatch[1].trim().length > 3) {
    return emojiMatch[1].trim();
  }

  // Try to get text before common sentence starters
  const sentenceMatch = caption.match(/^(.+?)(?:It['']s|This is|Here['']s|I['']m|We['']re|You['']ll|Comment|Save|Share|Tag|#)/i);
  if (sentenceMatch && sentenceMatch[1].trim().length > 3) {
    return sentenceMatch[1].trim();
  }

  // Fall back to first line or first ~50 chars
  const firstLine = caption.split(/[.\n!?]/)[0]?.trim();
  if (firstLine && firstLine.length > 3 && firstLine.length <= 100) {
    return firstLine;
  }

  // Last resort: truncate to reasonable length
  if (caption.length > 60) {
    const truncated = caption.slice(0, 60).trim();
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  }

  return caption;
}

function extractTikTokRecipeTitle(ogTitle: string): string {
  // TikTok og:title is typically the video caption directly
  let caption = decodeHtmlEntities(ogTitle).trim();

  // Remove common TikTok suffixes like "| TikTok"
  caption = caption.replace(/\s*\|\s*TikTok\s*$/i, '').trim();

  // Reuse the same emoji/sentence extraction logic as Instagram
  const emojiMatch = caption.match(/^([^🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🫒🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🦴🌭🍔🍟🍕🫓🥪🥙🧆🌮🌯🫔🥗🥘🫕🥫🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼🫖☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊🥄🍴🍽️🥣🥡🥢🧂⭐✨💯🔥❤️😍🤤👨‍🍳👩‍🍳📝✅]+)/u);
  if (emojiMatch && emojiMatch[1].trim().length > 3) {
    return emojiMatch[1].trim();
  }

  const sentenceMatch = caption.match(/^(.+?)(?:It['']s|This is|Here['']s|I['']m|We['']re|You['']ll|Comment|Save|Share|Tag|#)/i);
  if (sentenceMatch && sentenceMatch[1].trim().length > 3) {
    return sentenceMatch[1].trim();
  }

  const firstLine = caption.split(/[.\n!?]/)[0]?.trim();
  if (firstLine && firstLine.length > 3 && firstLine.length <= 100) {
    return firstLine;
  }

  if (caption.length > 60) {
    const truncated = caption.slice(0, 60).trim();
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  }

  return caption;
}

function extractRecipeDetailsFromHtml(html: string, sourceUrl: string): ParsedRecipeDetails | null {
  if (!html) {
    return null;
  }
  const recipeNode = extractRecipeNodeFromJsonLd(html);
  let fallbackTitle =
    extractMetaContent(html, 'property', 'og:title') ||
    extractMetaContent(html, 'name', 'twitter:title') ||
    extractTitleFromHtml(html);

  // For Instagram/TikTok URLs, extract just the recipe name from the caption
  const isInstagram = /instagram\.com/i.test(sourceUrl);
  const isTikTok = /tiktok\.com/i.test(sourceUrl);
  if (isInstagram && fallbackTitle) {
    fallbackTitle = extractInstagramRecipeTitle(fallbackTitle);
  } else if (isTikTok && fallbackTitle) {
    fallbackTitle = extractTikTokRecipeTitle(fallbackTitle);
  }

  const fallbackImage = extractOgImageUrlFromHtml(html, sourceUrl);

  if (!recipeNode) {
    if (!fallbackTitle && !fallbackImage) {
      return null;
    }
    return {
      title: fallbackTitle,
      ingredients: [],
      steps: [],
      mealTypes: inferMealTypesFromTitle(fallbackTitle || ''),
      durationMinutes: null,
      imageUrl: fallbackImage
    };
  }

  const titleCandidate = (recipeNode.name || recipeNode.headline || fallbackTitle || '').toString().trim();
  const ingredients = sanitizeStringArray(recipeNode.recipeIngredient || recipeNode.ingredients);
  const steps = normalizeInstructionList(
    recipeNode.recipeInstructions || recipeNode.instructions || recipeNode.recipeDirections
  );
  const mealTypes = extractMealTypesFromNode(recipeNode);
  const durationMinutes =
    parseDurationValue(recipeNode.totalTime) ??
    parseDurationValue(recipeNode.cookTime) ??
    parseDurationValue(recipeNode.prepTime) ??
    null;
  const imageCandidate = extractImageFromRecipeNode(recipeNode) || fallbackImage;

  return {
    title: titleCandidate || fallbackTitle,
    ingredients,
    steps,
    mealTypes,
    durationMinutes,
    imageUrl: resolveExternalUrl(imageCandidate, sourceUrl)
  };
}

function extractRecipeNodeFromJsonLd(html: string): Record<string, any> | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html))) {
    const rawContent = match[1]?.trim();
    if (!rawContent) {
      continue;
    }
    const cleaned = rawContent.replace(/<!--([\s\S]*?)-->/g, '').trim();
    if (!cleaned) {
      continue;
    }
    try {
      const parsed = JSON.parse(cleaned);
      const recipeNode = findRecipeNode(parsed);
      if (recipeNode) {
        return recipeNode;
      }
    } catch (error) {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

function findRecipeNode(candidate: any): Record<string, any> | null {
  if (!candidate) {
    return null;
  }
  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      const found = findRecipeNode(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof candidate === 'object') {
    const typeValue = candidate['@type'] || candidate.type;
    const types = Array.isArray(typeValue) ? typeValue : typeValue ? [typeValue] : [];
    if (types.some((type) => typeof type === 'string' && type.toLowerCase().includes('recipe'))) {
      return candidate as Record<string, any>;
    }
    if (candidate['@graph']) {
      return findRecipeNode(candidate['@graph']);
    }
    if (candidate.mainEntity) {
      const nested = findRecipeNode(candidate.mainEntity);
      if (nested) {
        return nested;
      }
    }
    if (candidate.itemListElement) {
      return findRecipeNode(candidate.itemListElement);
    }
  }
  return null;
}

function normalizeInstructionList(value: unknown): string[] {
  const steps: string[] = [];
  const pushStep = (text: unknown) => {
    if (!text) {
      return;
    }
    const cleaned = String(text).trim();
    if (cleaned) {
      steps.push(cleaned);
    }
  };

  const handleNode = (node: unknown): void => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(handleNode);
      return;
    }
    if (typeof node === 'string') {
      node
        .split(/\r?\n+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .forEach(pushStep);
      return;
    }
    if (typeof node === 'object') {
      const record = node as Record<string, any>;
      if (Array.isArray(record.itemListElement)) {
        handleNode(record.itemListElement);
        return;
      }
      pushStep(record.text || record.description || record.name);
    }
  };

  handleNode(value);
  return steps;
}

function extractImageFromRecipeNode(node: Record<string, any>): string {
  const image = node.image;
  if (!image) {
    return '';
  }
  if (typeof image === 'string') {
    return image.trim();
  }
  if (Array.isArray(image) && image.length > 0) {
    const first = image[0];
    if (typeof first === 'string') {
      return first.trim();
    }
    if (first && typeof first === 'object' && typeof first.url === 'string') {
      return first.url.trim();
    }
  }
  if (typeof image === 'object' && typeof image.url === 'string') {
    return image.url.trim();
  }
  return '';
}

function inferMealTypesFromTitle(title: string): string[] {
  if (!title) {
    return [];
  }
  const normalized = new Set<string>();
  const lower = title.toLowerCase();

  // Check for breakfast items
  if (/\b(pancake|waffle|omelette|omelet|eggs?|french toast|breakfast|morning|overnight oat|granola|muffin|croissant)\b/i.test(lower)) {
    normalized.add('breakfast');
  }

  // Check for dessert items
  if (/\b(cake|cookie|brownie|pie|tart|pudding|mousse|cheesecake|ice cream|dessert|sweet|chocolate|caramel|pastry|crumb|cinnamon roll)\b/i.test(lower)) {
    normalized.add('dessert');
  }

  // Check for appetizers/snacks
  if (/\b(appetizer|dip|snack|slider|finger food|bruschetta|crostini|tapas)\b/i.test(lower)) {
    normalized.add('appetizer');
  }

  // Check for soup (typically lunch/dinner)
  if (/\b(soup|stew|chowder|broth|bisque)\b/i.test(lower)) {
    normalized.add('dinner');
  }

  // Check for main dishes (dinner)
  if (/\b(chicken|beef|pork|salmon|fish|steak|roast|braised|baked|grilled|curry|pasta|noodle|rice bowl|stir.?fry)\b/i.test(lower)) {
    if (!normalized.has('breakfast') && !normalized.has('dessert')) {
      normalized.add('dinner');
    }
  }

  // Check for salads (typically lunch)
  if (/\b(salad)\b/i.test(lower)) {
    normalized.add('lunch');
  }

  return Array.from(normalized);
}

function extractMealTypesFromNode(node: Record<string, any>): string[] {
  const values = new Set<string>();
  const collect = (input: unknown) => {
    if (!input) {
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (typeof input === 'string') {
      input
        .split(/[,\/]/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .forEach((segment) => values.add(segment));
    }
  };

  collect(node.recipeCategory);
  collect(node.keywords);

  const normalized = new Set<string>();
  for (const value of values) {
    const mapped = mapMealTypeKeyword(value);
    if (mapped) {
      normalized.add(mapped);
    }
  }
  return Array.from(normalized);
}

function mapMealTypeKeyword(value: string): string | null {
  const normalized = value.toLowerCase();
  const simple = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (simple.includes('dessert') || simple.includes('sweet')) {
    return ensureMealType('dessert');
  }
  if (simple.includes('breakfast')) {
    return ensureMealType('breakfast');
  }
  if (simple.includes('lunch')) {
    return ensureMealType('lunch');
  }
  if (
    simple.includes('dinner') ||
    simple.includes('supper') ||
    simple.includes('main course') ||
    simple.includes('main dish') ||
    simple.includes('entree')
  ) {
    return ensureMealType('dinner');
  }
  if (
    simple.includes('appetizer') ||
    simple.includes('starter') ||
    simple.includes('side dish') ||
    simple.includes('side')
  ) {
    return ensureMealType('appetizer');
  }
  if (simple.includes('snack') || simple.includes('treat')) {
    return ensureMealType('snack');
  }
  return null;
}

function ensureMealType(type: string): string | null {
  return KNOWN_MEAL_TYPES.includes(type) ? type : null;
}

function parseDurationValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const isoMinutes = parseIsoDuration(trimmed);
    if (isoMinutes !== null) {
      return isoMinutes;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
    let minutes = 0;
    const hoursMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr|h)\b/i);
    if (hoursMatch) {
      minutes += Math.round(Number(hoursMatch[1]) * 60);
    }
    const minsMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min|m)\b/i);
    if (minsMatch) {
      minutes += Math.round(Number(minsMatch[1]));
    }
    return minutes > 0 ? minutes : null;
  }
  return null;
}

function parseIsoDuration(value: string): number | null {
  const match = value.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
  );
  if (!match) {
    return null;
  }
  const weeks = match[1] ? Number(match[1]) : 0;
  const days = match[2] ? Number(match[2]) : 0;
  const hours = match[3] ? Number(match[3]) : 0;
  const minutes = match[4] ? Number(match[4]) : 0;
  const seconds = match[5] ? Number(match[5]) : 0;
  const totalMinutes = weeks * 7 * 24 * 60 + days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60);
  return totalMinutes > 0 ? totalMinutes : null;
}

function extractOgImageUrlFromHtml(html: string, baseUrl: string): string {
  const ogImage =
    extractMetaContent(html, 'property', 'og:image') ||
    extractMetaContent(html, 'name', 'twitter:image');
  if (!ogImage) {
    return '';
  }
  return resolveExternalUrl(ogImage, baseUrl);
}

function extractTitleFromHtml(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}

function extractMetaContent(html: string, attribute: 'name' | 'property', value: string): string {
  const patterns = [
    new RegExp(`<meta[^>]*${attribute}=["']${value}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${value}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }
  return '';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Handle numeric entities (decimal and hex)
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function resolveExternalUrl(value: string, baseUrl: string): string {
  if (!value) {
    return '';
  }
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.toString();
  } catch (error) {
    return value;
  }
}

async function fetchRawRecipeText(sourceUrl: string | undefined) {
  if (!sourceUrl) {
    return null;
  }
  const proxied = `https://r.jina.ai/${sourceUrl}`;
  const response = await fetch(proxied, {
    headers: {
      'User-Agent': 'RecipeWorker/1.0'
    }
  });
  if (response.ok) {
    return response.text();
  }

  // Fallback for social platforms: use oEmbed caption which often contains the full recipe
  try {
    const parsedUrl = new URL(sourceUrl);

    if (parsedUrl.hostname.includes('tiktok.com')) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)', 'Accept': 'application/json' }
      });
      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { title?: string; author_name?: string };
        const caption = (payload.title || '').trim();
        if (caption) return `Recipe by ${payload.author_name || 'TikTok creator'}:\n\n${caption}`;
      }
    }

    if (parsedUrl.hostname.includes('instagram.com')) {
      const normalized = sourceUrl.split('?')[0].replace(/\/?$/, '/');
      const oembedUrl = `https://www.instagram.com/oembed/?omitscript=true&url=${encodeURIComponent(normalized)}`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)', 'Accept': 'application/json' }
      });
      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { title?: string; author_name?: string };
        const caption = (payload.title || '').trim();
        if (caption) return `Recipe by ${payload.author_name || 'Instagram creator'}:\n\n${caption}`;
      }
    }

    if (parsedUrl.hostname.includes('youtube.com') || parsedUrl.hostname.includes('youtu.be')) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)', 'Accept': 'application/json' }
      });
      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { title?: string; author_name?: string };
        const title = (payload.title || '').trim();
        if (title) return `Recipe video by ${payload.author_name || 'YouTube creator'}: ${title}`;
      }
    }
  } catch {
    // Fall through to null
  }

  return null;
}

async function fetchOgImage(sourceUrl: string | undefined): Promise<string | null> {
  if (!sourceUrl) {
    return null;
  }

  // Try Instagram oEmbed API for Instagram URLs
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.hostname.includes('instagram.com')) {
      const normalized = sourceUrl.split('?')[0].replace(/\/?$/, '/');
      const oembedUrl = `https://www.instagram.com/oembed/?omitscript=true&url=${encodeURIComponent(normalized)}`;

      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
          'Accept': 'application/json'
        }
      });

      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { thumbnail_url?: string };
        const thumbnail = (payload.thumbnail_url || '').trim();
        if (thumbnail) {
          // Download and convert to base64
          try {
            const imgResponse = await fetch(thumbnail, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
                'Referer': 'https://www.instagram.com/'
              }
            });
            if (imgResponse.ok) {
              const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
              const buffer = await imgResponse.arrayBuffer();
              const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
              return `data:${contentType};base64,${base64}`;
            }
          } catch (imgError) {
            console.warn('Failed to download Instagram thumbnail, returning URL:', imgError);
          }
          return thumbnail;
        }
      }
    }
  } catch (urlError) {
    // Not a valid URL or Instagram fetch failed, continue with regular og:image fetch
  }

  // Try TikTok oEmbed API for TikTok URLs
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.hostname.includes('tiktok.com')) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;

      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
          'Accept': 'application/json'
        }
      });

      if (oembedResponse.ok) {
        const payload = await oembedResponse.json() as { thumbnail_url?: string };
        const thumbnail = (payload.thumbnail_url || '').trim();
        if (thumbnail) {
          try {
            const imgResponse = await fetch(thumbnail, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
                'Referer': 'https://www.tiktok.com/'
              }
            });
            if (imgResponse.ok) {
              const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
              const buffer = await imgResponse.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              return `data:${contentType};base64,${base64}`;
            }
          } catch (imgError) {
            console.warn('Failed to download TikTok thumbnail, returning URL:', imgError);
          }
          return thumbnail;
        }
      }
    }
  } catch (urlError) {
    // Not a valid URL or TikTok fetch failed, continue with regular og:image fetch
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
        'Accept': 'text/html'
      },
      redirect: 'follow'
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();

    // Extract og:image from HTML
    let imageUrl: string | null = null;
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      imageUrl = ogImageMatch[1];
    }

    // Fallback to twitter:image
    if (!imageUrl) {
      const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
                                html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
      if (twitterImageMatch && twitterImageMatch[1]) {
        imageUrl = twitterImageMatch[1];
      }
    }

    if (!imageUrl) {
      return null;
    }

    // Decode HTML entities in URL
    imageUrl = imageUrl.replace(/&amp;/g, '&');

    // Download the image and convert to base64 to avoid token expiration issues
    try {
      const imgResponse = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)'
        }
      });
      if (imgResponse.ok) {
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
        const buffer = await imgResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        return `data:${contentType};base64,${base64}`;
      }
    } catch (imgError) {
      console.warn('Failed to download og:image, returning URL:', imgError);
    }

    // Fallback to returning the URL if download fails
    return imageUrl;
  } catch (error) {
    console.warn('Failed to fetch og:image:', error);
    return null;
  }
}

function truncateForPrompt(value: string, limit = MAX_EXISTING_CONTEXT_CHARS) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

function buildGeminiPrompt(recipe: Recipe, rawText: string) {
  const truncated = rawText.slice(0, 8000);
  const existingInfo = [
    recipe.title ? `Title: ${recipe.title}` : '',
    recipe.sourceUrl ? `Source URL: ${recipe.sourceUrl}` : '',
    recipe.imageUrl ? `Image URL: ${recipe.imageUrl}` : '',
    recipe.mealTypes.length ? `Meal types: ${recipe.mealTypes.join(', ')}` : '',
    recipe.ingredients.length ? `Existing ingredients: ${recipe.ingredients.join('; ')}` : '',
    recipe.steps.length ? `Existing steps: ${recipe.steps.join(' | ')}` : '',
    typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes)
      ? `Duration minutes: ${recipe.durationMinutes}`
      : '',
    recipe.notes ? `Notes/comments:\n${truncateForPrompt(recipe.notes)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
  return `You are a culinary expert and recipe parser. Convert the recipe description into structured JSON strictly following this schema:
{
  "title": "string",
  "sourceUrl": "string",
  "imageUrl": "string",
  "mealTypes": ["breakfast","lunch","dinner","dessert","appetizer","snack"],
  "ingredients": ["string"],
  "steps": ["string"],
  "durationMinutes": number | null,
  "notes": "string"
}

Rules:
- Use the recipe title and any available context to identify the dish.
- For ingredients: If the text contains explicit ingredients, use them. Otherwise, use your culinary knowledge to provide the typical/standard ingredients for this dish based on its name and any hints in the text (like comments mentioning "balsamic cream").
- ingredients should be unique lines with quantity + item (e.g., "4 slices prosciutto", "2 tbsp balsamic glaze").
- For steps: If explicit instructions exist, use them. Otherwise, provide typical preparation steps for this dish based on your knowledge.
- steps must be an ordered list of clear instructions. Do NOT include step numbers or prefixes like "1.", "Step 1:", etc. — just the instruction text itself.
- mealTypes should be appropriate for this type of dish.
- durationMinutes should be estimated if not explicitly mentioned.
- notes should include any tips, serving suggestions, or context from the text.
- Return ONLY JSON, no explanation.

Existing context provided by the user (title, comments, scraped text, etc.):
${existingInfo || 'None'}

Recipe text from the provided URL (truncated to 8k chars):
${truncated}`;
}

async function callGemini(env: Env, prompt: string, deps: CallGeminiDeps = {}) {
  const {
    fetchImpl = fetch,
    getAccessToken = getGeminiAccessToken,
    getServiceAccount = getGeminiServiceAccount
  } = deps;
  const token = await getAccessToken(env);
  const serviceAccount = await getServiceAccount(env);
  const response = await fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(serviceAccount.project_id ? { 'X-Goog-User-Project': serviceAccount.project_id } : {})
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      })
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${errorText || response.statusText}`);
  }
  const payload = await response.json();
  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error('Gemini returned no text response');
  }
  return text;
}

function extractGeminiText(payload: any): string | null {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) {
    return null;
  }
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      const textPart = parts.find((part) => typeof part.text === 'string' && part.text.trim());
      if (textPart) {
        return textPart.text.trim();
      }
    }
  }
  return null;
}

function parseGeminiRecipeJson(text: string): any | null {
  let trimmed = text.trim();

  // Strip markdown code fences if present
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    trimmed = codeBlockMatch[1].trim();
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    return null;
  }
  const candidate = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return null;
  }
}

async function getGeminiAccessToken(env: Env) {
  if (geminiAccessTokenCache && geminiAccessTokenCache.expiresAt - 60 > Date.now() / 1000) {
    return geminiAccessTokenCache.token;
  }
  const serviceAccount = await getGeminiServiceAccount(env);
  const signingKey = await getGeminiSigningKey(env);
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const assertionPayload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    scope: GEMINI_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  };
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(assertionPayload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    signingKey,
    textEncoder.encode(unsigned)
  );
  const assertion = `${unsigned}.${arrayBufferToBase64Url(signature)}`;
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: unknown };
  if (!response.ok) {
    throw new Error(`Unable to obtain Gemini access token: ${JSON.stringify(data)}`);
  }
  if (!data.access_token) {
    throw new Error('Gemini token response missing access_token');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  geminiAccessTokenCache = {
    token: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn
  };
  return data.access_token;
}

async function getGeminiServiceAccount(env: Env) {
  if (geminiServiceAccountCache) {
    return geminiServiceAccountCache;
  }
  const b64 = env.GEMINI_SERVICE_ACCOUNT_B64;
  if (!b64) {
    throw new Error('GEMINI_SERVICE_ACCOUNT_B64 is not configured');
  }
  const decoded = atob(b64);
  const json = JSON.parse(decoded);
  geminiServiceAccountCache = {
    client_email: json.client_email,
    private_key: json.private_key,
    token_uri: json.token_uri || 'https://oauth2.googleapis.com/token',
    project_id: json.project_id
  };
  return geminiServiceAccountCache;
}

async function getGeminiSigningKey(env: Env) {
  if (geminiSigningKey) {
    return geminiSigningKey;
  }
  const serviceAccount = await getGeminiServiceAccount(env);
  const keyData = pemToArrayBuffer(serviceAccount.private_key);
  geminiSigningKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return geminiSigningKey;
}

function pemToArrayBuffer(pem: string) {
  const cleaned = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\s+/g, '');
  return base64ToArrayBuffer(cleaned);
}


export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson
};
