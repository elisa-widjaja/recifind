// Outbound share URLs always point at the production site so iMessage/
// Twitter/etc. hit the Pages Functions OG-tag middleware and render rich
// link previews — the dev tunnel only runs Vite (no middleware), so
// previews fail there.
export const SHARE_PUBLIC_URL = 'https://recifriend.com';

// Canonical shareable recipe link, used by every share surface so the
// experience is consistent.
//
// PATH form (`/recipes/{id}?user={owner}`) on purpose: AASA claims
// `/recipes/*`, so iOS treats this as a Universal Link and opens it directly
// in the app, where the deep-link parser resolves it to the recipe DETAIL
// view. Flipped from the old query form (`/?recipe={id}&user=`) once App
// Store build 20 (v1.0.1) — which ships the owner-aware parser — went live
// (2026-05-25). The OG middleware, web cold-load, deepLink parser, and
// dispatcher all still accept BOTH forms, so already-sent query links keep
// working and SMS/iMessage rich previews are preserved for both.
export function buildRecipeShareUrl(recipeId, ownerId) {
  if (!recipeId) return SHARE_PUBLIC_URL;
  const base = `${SHARE_PUBLIC_URL}/recipes/${encodeURIComponent(recipeId)}`;
  return ownerId ? `${base}?user=${encodeURIComponent(ownerId)}` : base;
}

// Native custom-scheme deep link to a recipe's DETAIL view, used by the web
// "See this in ReciFriend" fallback prompt. That in-page button can't trigger
// a same-domain Universal Link (iOS ignores Universal Links for navigations
// within the same domain in Safari), so it fires the custom scheme instead.
// The native parser resolves `recifriend://recipes/{id}?user={owner}` →
// recipe_detail. With no recipe id it points at the recipes list (the app's
// old behavior, kept as the fallback for non-recipe pages).
export function buildRecipeAppDeepLink(recipeId, ownerId) {
  if (!recipeId) return 'recifriend://recipes';
  const base = `recifriend://recipes/${encodeURIComponent(recipeId)}`;
  return ownerId ? `${base}?user=${encodeURIComponent(ownerId)}` : base;
}
