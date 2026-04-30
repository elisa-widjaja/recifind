import { parseDeepLink } from '../../../shared/deepLink';

/**
 * Creates a deep-link dispatcher bound to UI handlers.
 * @param {{
 *   onAuthCallback: (code: string) => Promise<void>,
 *   onAddRecipe: (url: string, title?: string) => void,
 *   onFriendRequests: (acceptId?: string) => void,
 *   onRecipeDetail: (recipeId: string) => void,
 *   onRecipesList: () => void,
 *   onOpenPendingShare: () => void,
 * }} handlers
 */
export function createDispatcher(handlers) {
  return async function dispatch(urlString) {
    const link = parseDeepLink(urlString);
    if (!link) return; // silently reject anything that doesn't match the allowlist

    switch (link.kind) {
      case 'auth_callback':      return await handlers.onAuthCallback(link.code);
      case 'add_recipe':         return handlers.onAddRecipe(link.url, link.title);
      case 'friend_requests':    return handlers.onFriendRequests(link.accept_id);
      case 'recipe_detail':      return handlers.onRecipeDetail(link.recipe_id);
      case 'recipes_list':       return handlers.onRecipesList();
      case 'open_pending_share': return handlers.onOpenPendingShare();
    }
  };
}
