// Outbound share URLs always point at the production site so iMessage/
// Twitter/etc. hit the Pages Functions OG-tag middleware and render rich
// link previews — the dev tunnel only runs Vite (no middleware), so
// previews fail there.
export const SHARE_PUBLIC_URL = 'https://recifriend.com';

// Canonical shareable recipe link, used by every share surface so the
// experience is consistent.
//
// QUERY form (`/?recipe={id}&user={owner}`, path `/`) on purpose: AASA only
// claims `/recipes/*`, so path `/` is NOT a Universal Link → iOS opens these
// in Safari and the web cold-load resolves them. The path form
// (`/recipes/{id}?user=`) would be intercepted by TestFlight bundle 17,
// whose old deep-link code can't resolve a non-owned shared recipe (lands
// on home). Everything else (OG middleware, web cold-load, deepLink
// owner_id, dispatcher) already handles BOTH forms — when iOS build 18
// ships, flip this back to the `/recipes/{id}?user=` path form to get true
// in-app deep-linking.
export function buildRecipeShareUrl(recipeId, ownerId) {
  if (!recipeId) return SHARE_PUBLIC_URL;
  const base = `${SHARE_PUBLIC_URL}?recipe=${encodeURIComponent(recipeId)}`;
  return ownerId ? `${base}&user=${encodeURIComponent(ownerId)}` : base;
}
