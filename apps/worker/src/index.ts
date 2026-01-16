const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per preview upload.
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes.
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language';

export interface Env {
  RECIPES_KV: KVNamespace;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
  DEV_API_KEY?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
  SUPABASE_JWT_SECRET?: string;
  GEMINI_SERVICE_ACCOUNT_B64?: string;
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

      const isImageRequest = /^\/images\/[^/]+$/.test(url.pathname);
      const requiresAuth = !isImageRequest;

      const user = requiresAuth ? await authenticateRequest(request, env) : await authenticateRequestOptional(request, env);

      if (url.pathname === '/recipes' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleListRecipes(url, env, user);
      }

      if (url.pathname === '/recipes/count' && request.method === 'GET') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleRecipeCount(env, user);
      }

      if (url.pathname === '/recipes' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleCreateRecipe(request, env, user);
      }

      if (url.pathname === '/recipes/enrich' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleEnrichRecipe(request, env);
      }

      if (url.pathname === '/recipes/parse' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleParseRecipe(request);
      }

      if (url.pathname === '/recipes/og-image' && request.method === 'POST') {
        if (!user) {
          throw new HttpError(401, 'Missing Authorization header');
        }
        return handleGetOgImage(request);
      }

      const recipeMatch = url.pathname.match(/^\/recipes\/([^/]+)$/);
      if (recipeMatch) {
        const recipeId = decodeURIComponent(recipeMatch[1]);
        if (request.method === 'GET') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return handleGetRecipe(env, user, recipeId);
        }
        if (request.method === 'PUT' || request.method === 'PATCH') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return handleUpdateRecipe(request, env, user, recipeId);
        }
        if (request.method === 'DELETE') {
          if (!user) {
            throw new HttpError(401, 'Missing Authorization header');
          }
          return handleDeleteRecipe(env, user, recipeId);
        }
        return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
      }

      const imageMatch = url.pathname.match(/^\/images\/([^/]+)$/);
      if (imageMatch && request.method === 'GET') {
        const recipeId = decodeURIComponent(imageMatch[1]);
        return handleImageRequest(url, env, user, recipeId);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (error) {
      return handleError(error);
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

async function handleListRecipes(url: URL, env: Env, user: AuthenticatedUser) {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParamRaw = url.searchParams.get('limit');
  const limitParsed = limitParamRaw === null ? NaN : Number(limitParamRaw);
  const limit = Number.isFinite(limitParsed)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limitParsed)))
    : DEFAULT_PAGE_SIZE;

  const prefix = buildRecipeKeyPrefix(user.userId);
  console.log(`[DEBUG] handleListRecipes - userId: ${user.userId}, prefix: ${prefix}, limit: ${limit}`);

  const listResult = await env.RECIPES_KV.list({ prefix, limit, cursor });
  console.log(`[DEBUG] handleListRecipes - found ${listResult.keys.length} keys, list_complete: ${listResult.list_complete}`);
  if (listResult.keys.length < 10) {
    console.log(`[DEBUG] Keys found: ${listResult.keys.map(k => k.name).join(', ')}`);
  }

  const recipes = await Promise.all(
    listResult.keys.map(async (key) => env.RECIPES_KV.get<Recipe>(key.name, { type: 'json' }))
  );

  console.log(`[DEBUG] handleListRecipes - returning ${recipes.filter(Boolean).length} recipes`);

  return json({
    recipes: recipes.filter(Boolean),
    cursor: listResult.list_complete ? null : listResult.cursor
  });
}

async function handleRecipeCount(env: Env, user: AuthenticatedUser) {
  // Single KV read - much faster than listing all keys
  const meta = await getCollectionMeta(env, user.userId);

  return json({
    count: meta?.count ?? 0,
    updatedAt: meta?.updatedAt ?? null,
    version: meta?.version ?? 0
  });
}

async function handleGetRecipe(env: Env, user: AuthenticatedUser, recipeId: string) {
  const recipe = await loadRecipe(env, user.userId, recipeId);
  return json({ recipe });
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

  await env.RECIPES_KV.put(buildRecipeKey(user.userId, recipe.id), JSON.stringify(recipe));
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
    throw new HttpError(502, 'Failed to fetch content from source URL');
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
      // Remove previous preview before we upload a new one.
      await deleteSupabaseObject(env, existing.previewImage.objectKey);
    }
    const preview = await persistPreviewImage(previewImagePayload, env, user.userId, recipe.id);
    if (preview) {
      recipe.previewImage = preview;
      recipe.imagePath = buildImagePath(recipe.id);
      recipe.imageUrl = preview.publicUrl || recipe.imageUrl;
    }
  }

  await env.RECIPES_KV.put(buildRecipeKey(user.userId, recipe.id), JSON.stringify(recipe));
  await updateCollectionMeta(env, user.userId, { countDelta: 0 }); // Updates version/timestamp
  return json({ recipe });
}

async function handleDeleteRecipe(env: Env, user: AuthenticatedUser, recipeId: string) {
  const recipe = await loadRecipe(env, user.userId, recipeId);
  if (recipe.previewImage?.objectKey) {
    await deleteSupabaseObject(env, recipe.previewImage.objectKey);
    recipe.imageUrl = '';
  }
  await env.RECIPES_KV.delete(buildRecipeKey(user.userId, recipeId));
  await updateCollectionMeta(env, user.userId, { countDelta: -1 });
  return new Response(null, { status: 204, headers: withCors() });
}

async function handleImageRequest(
  url: URL,
  env: Env,
  user: AuthenticatedUser | null,
  recipeId: string
) {
  const ownerId = user?.userId ?? (await resolveRecipeOwner(env, recipeId));
  if (!ownerId) {
    throw new HttpError(404, 'Recipe preview not found');
  }
  const recipe = await env.RECIPES_KV.get<Recipe>(buildRecipeKey(ownerId, recipeId), { type: 'json' });
  if (!recipe || !recipe.previewImage?.objectKey) {
    throw new HttpError(404, 'Recipe preview not found');
  }

  const objectResponse = await fetchSupabaseObject(env, recipe.previewImage.objectKey);
  const headers = new Headers(withCors());
  const contentType =
    recipe.previewImage.contentType ||
    objectResponse.headers.get('Content-Type') ||
    objectResponse.headers.get('content-type') ||
    'application/octet-stream';
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('X-Image-Source', recipe.previewImage.objectKey);

  const requestedSize = Number(url.searchParams.get('size'));
  if (Number.isFinite(requestedSize) && requestedSize > 0) {
    headers.set('X-Image-Resize', `${requestedSize}`);
    // TODO: Integrate Cloudflare Images for real resizing once enabled.
  }

  return new Response(objectResponse.body, { status: 200, headers });
}

async function loadRecipe(env: Env, userId: string, recipeId: string): Promise<Recipe> {
  const record = await env.RECIPES_KV.get<Recipe>(buildRecipeKey(userId, recipeId), { type: 'json' });
  if (!record) {
    throw new HttpError(404, 'Recipe not found');
  }
  return record;
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
        previewImage: null
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

function buildRecipeKeyPrefix(userId: string) {
  return `recipe:${userId}:`;
}

function buildRecipeKey(userId: string, recipeId: string) {
  return `${buildRecipeKeyPrefix(userId)}${recipeId}`;
}

function buildMetaKey(userId: string) {
  return `meta:${userId}`;
}

async function getCollectionMeta(env: Env, userId: string): Promise<RecipeCollectionMeta | null> {
  return env.RECIPES_KV.get<RecipeCollectionMeta>(buildMetaKey(userId), { type: 'json' });
}

async function updateCollectionMeta(
  env: Env,
  userId: string,
  update: { countDelta?: number; forceCount?: number }
): Promise<RecipeCollectionMeta> {
  const key = buildMetaKey(userId);
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

  await env.RECIPES_KV.put(key, JSON.stringify(meta));
  return meta;
}

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

function extractRecipeDetailsFromHtml(html: string, sourceUrl: string): ParsedRecipeDetails | null {
  if (!html) {
    return null;
  }
  const recipeNode = extractRecipeNodeFromJsonLd(html);
  let fallbackTitle =
    extractMetaContent(html, 'property', 'og:title') ||
    extractMetaContent(html, 'name', 'twitter:title') ||
    extractTitleFromHtml(html);

  // For Instagram URLs, extract just the recipe name from the caption
  const isInstagram = /instagram\.com/i.test(sourceUrl);
  if (isInstagram && fallbackTitle) {
    fallbackTitle = extractInstagramRecipeTitle(fallbackTitle);
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
  if (!response.ok) {
    return null;
  }
  return response.text();
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
- steps must be an ordered list of clear instructions.
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

async function resolveRecipeOwner(env: Env, recipeId: string): Promise<string | null> {
  let cursor: string | undefined;
  do {
    const list = await env.RECIPES_KV.list({ prefix: 'recipe:', cursor, limit: 1000 });
    for (const key of list.keys) {
      if (key.name.endsWith(`:${recipeId}`)) {
        const match = key.name.match(/^recipe:([^:]+):/);
        if (match?.[1]) {
          return match[1];
        }
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return null;
}

export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson
};
