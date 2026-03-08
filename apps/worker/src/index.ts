const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per preview upload.
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes.
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language';

export interface Env {
  DB: D1Database;
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
}


interface Friend {
  friendId: string;
  friendEmail: string;
  friendName: string;
  connectedAt: string;
}

interface NotificationItem {
  type: 'friend_request' | 'friend_accepted';
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
          'New ReciFind feedback',
          `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
            <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">New feedback</h2>
            ${replyLine}
            <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #333; white-space: pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>`
        );
        return json({ ok: true }, 200, withCors());
      }

      // Public endpoint to get shared recipe by token (no auth required)
      const shareTokenMatch = url.pathname.match(/^\/public\/share\/([^/]+)$/);
      if (shareTokenMatch && request.method === 'GET') {
        const shareToken = decodeURIComponent(shareTokenMatch[1]);
        return await handleGetSharedRecipe(request, env, shareToken);
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

      if (url.pathname === '/recipes' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return await handleCreateRecipe(request, env, user);
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
      // Create share link for a recipe
      const shareMatch = url.pathname.match(/^\/recipes\/([^/]+)\/share$/);
      if (shareMatch && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        const recipeId = decodeURIComponent(shareMatch[1]);
        return await handleCreateShareLink(env, user, recipeId);
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
      if (url.pathname === '/friends/open-invite' && request.method === 'POST') {
        if (!user) throw new HttpError(401, 'Missing Authorization header');
        return await handleCreateOpenInvite(request, env, user);
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
  }
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
  return json({
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt,
    recipeCount: meta?.count ?? 0,
  });
}

async function handleUpdateProfile(request: Request, env: Env, user: AuthenticatedUser) {
  const body = await request.json() as { displayName?: string };
  const displayName = body.displayName?.trim();
  if (!displayName || displayName.length === 0) {
    throw new HttpError(400, 'Display name is required');
  }
  if (displayName.length > 50) {
    throw new HttpError(400, 'Display name must be 50 characters or less');
  }
  await env.DB.prepare(
    'UPDATE profiles SET display_name = ? WHERE user_id = ?'
  ).bind(displayName, user.userId).run();
  return json({ displayName });
}

async function handleGetRecipe(request: Request, env: Env, user: AuthenticatedUser, recipeId: string) {
  const recipe = await loadRecipe(env, user.userId, recipeId);
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

async function handleCreateShareLink(env: Env, user: AuthenticatedUser, recipeId: string) {
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

  if (!rawText) {
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

  const prompt = buildGeminiPrompt(recipe, rawText);
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

async function handleSendFriendRequest(request: Request, env: Env, user: AuthenticatedUser, ctx: ExecutionContext) {
  const body = await readJsonBody(request);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new HttpError(400, 'Email is required');

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
      `${senderProfile.displayName} invited you to ReciFind`,
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">You're invited to ReciFind!</h2>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${senderProfile.displayName}</strong> invited you to join <a href="https://recifind.elisawidjaja.com" style="color: #6200EA; text-decoration: none;">ReciFind</a> and share recipes together.</p>
        <a href="https://recifind.elisawidjaja.com?invite_token=${inviteId}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Join ReciFind</a>
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
    `${senderProfile.displayName} wants to connect on ReciFind`,
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">New friend request</h2>
      <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${senderProfile.displayName}</strong> wants to connect with you on <a href="https://recifind.elisawidjaja.com" style="color: #6200EA; text-decoration: none;">ReciFind</a> and share recipes.</p>
      <a href="https://recifind.elisawidjaja.com?accept_friend=${encodeURIComponent(user.userId)}" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Accept</a>
      <p style="margin: 24px 0 0; font-size: 13px; color: #999;">You received this because someone sent you a friend request on ReciFind.</p>
    </div>`
  ));

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
    message: `${newUserProfile.displayName} accepted your invite and joined ReciFind!`,
    data: { fromUserId: user.userId, fromEmail: user.email || '' },
    createdAt: now,
  }));

  return json({ success: true, message: 'You are now connected!' });
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
      message: `${newUserProfile.displayName} accepted your invite and joined ReciFind!`,
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
    `${userProfile.displayName} accepted your friend request on ReciFind`,
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">You're now connected!</h2>
      <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #333;"><strong>${userProfile.displayName}</strong> accepted your friend request. You can now share recipes with each other on ReciFind.</p>
      <a href="https://recifind.elisawidjaja.com" style="display: inline-block; background: #6200EA; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500;">Open ReciFind</a>
      <p style="margin: 24px 0 0; font-size: 13px; color: #999;">You received this because your friend request was accepted on ReciFind.</p>
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
    await env.DB.prepare('DELETE FROM open_invites WHERE token = ?').bind(token).run();
    return json({ message: 'Already friends' });
  }

  const accepterProfile = await getOrCreateProfile(env, user.userId, user.email);
  const inviterProfile = await getOrCreateProfile(env, inviterUserId, '');
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(inviterUserId, user.userId, accepterProfile.email, accepterProfile.displayName, now),
    env.DB.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, friend_email, friend_name, connected_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, inviterUserId, inviterProfile.email, inviterProfile.displayName, now),
    env.DB.prepare('DELETE FROM open_invites WHERE token = ?').bind(token),
  ]);

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

  return json({ message: 'Connected!' });
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
    'SELECT * FROM recipes WHERE user_id = ? AND shared_with_friends = 1'
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
    };
  }

  const profile: UserProfile = {
    userId,
    email: email || '',
    displayName: email?.split('@')[0] || 'User',
    createdAt: new Date().toISOString()
  };
  await env.DB.prepare(
    'INSERT INTO profiles (user_id, email, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(profile.userId, profile.email, profile.displayName, profile.createdAt).run();
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

async function sendEmailNotification(env: Env, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ReciFind <notifications@recifind.elisawidjaja.com>',
        to,
        subject,
        html
      })
    });
  } catch (err) {
    console.error('Failed to send email notification:', err);
  }
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

  // Fallback for TikTok: use oEmbed title which contains the full caption
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
        const payload = await oembedResponse.json() as { title?: string; author_name?: string };
        const caption = (payload.title || '').trim();
        if (caption) {
          return `Recipe by ${payload.author_name || 'TikTok creator'}:\n\n${caption}`;
        }
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
