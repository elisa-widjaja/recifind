import { parseDeepLink } from '../../../shared/deepLink';

/**
 * Creates a deep-link dispatcher bound to UI handlers.
 * @param {{
 *   onAuthCallback: (code: string) => Promise<void>,
 *   onAddRecipe: (url: string) => void,
 *   onFriendRequests: () => void,
 *   onRecipeDetail: (recipeId: string) => void,
 * }} handlers
 */
export function createDispatcher(handlers) {
  return async function dispatch(urlString) {
    const link = parseDeepLink(urlString);
    if (!link) return; // silently reject anything that doesn't match the allowlist

    switch (link.kind) {
      case 'auth_callback':   return await handlers.onAuthCallback(link.code);
      case 'add_recipe':      return handlers.onAddRecipe(link.url);
      case 'friend_requests': return handlers.onFriendRequests();
      case 'recipe_detail':   return handlers.onRecipeDetail(link.recipe_id);
    }
  };
}
