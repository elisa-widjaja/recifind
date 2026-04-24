import {
  ALLOWED_HOSTS,
  CUSTOM_SCHEME_PROTOCOL,
  RECIPE_ID_REGEX,
  type DeepLink,
} from './contracts';

export function parseDeepLink(raw: string): DeepLink | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }

  const isUniversalLink = url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && url.port === '';
  const isCustomScheme  = url.protocol === CUSTOM_SCHEME_PROTOCOL;
  if (!isUniversalLink && !isCustomScheme) return null;

  // Custom schemes like `recifriend://recipes/123` are parsed inconsistently across
  // JS engines — some treat "recipes" as the host, some as the path. Normalize by
  // stripping the scheme prefix and treating the remainder as the path.
  // Only apply normalization for custom schemes; Universal Links parse correctly.
  const fullPath = isCustomScheme
    ? (normalizeCustomScheme(raw) ?? url.pathname)
    : url.pathname;

  // /recipes (recipe collection page)
  if (fullPath === '/recipes' || fullPath === '/recipes/') {
    return { kind: 'recipes_list' };
  }

  // /recipes/:id
  const recipeMatch = fullPath.match(/^\/recipes\/([^/?#]+)\/?$/);
  if (recipeMatch) {
    let id: string;
    try { id = decodeURIComponent(recipeMatch[1]); } catch { return null; }
    if (!RECIPE_ID_REGEX.test(id)) return null;
    return { kind: 'recipe_detail', recipe_id: id };
  }

  // /auth/callback — accepted via Universal Link OR custom scheme.
  // Security S1: custom-scheme OAuth is safe because native auth uses PKCE —
  // the code_verifier is stored only in this app's Keychain, so even if
  // another app claimed recifriend:// and intercepted the code, they can't
  // exchange it for a session. Implicit flow on web uses hash tokens, never
  // this path.
  if (fullPath === '/auth/callback' || fullPath === '/auth/callback/') {
    const code = url.searchParams.get('code');
    if (!code) return null;
    return { kind: 'auth_callback', code };
  }

  // /add-recipe?url=<http(s)://...>
  if (fullPath === '/add-recipe' || fullPath === '/add-recipe/') {
    const shared = url.searchParams.get('url');
    if (!shared || !/^https?:\/\//.test(shared)) return null;
    return { kind: 'add_recipe', url: shared };
  }

  // /friend-requests
  if (fullPath === '/friend-requests' || fullPath === '/friend-requests/') {
    return { kind: 'friend_requests' };
  }

  return null;
}

// Strip scheme prefix from any `<scheme>://<rest>` URL and return `/<rest>` (without query).
// Returns null if the URL doesn't match that shape.
function normalizeCustomScheme(raw: string): string | null {
  const m = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
  if (!m) return null;
  const tail = m[1];
  const path = '/' + tail.split('?')[0].split('#')[0].replace(/^\/+/, '');
  return path;
}
