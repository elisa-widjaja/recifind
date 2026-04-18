import { describe, expect, it, vi } from 'vitest';
import { createDispatcher } from './deepLinkDispatch';

describe('deep link dispatcher', () => {
  it('routes auth callback to onAuthCallback', async () => {
    const onAuthCallback = vi.fn().mockResolvedValue(undefined);
    const dispatch = createDispatcher({ onAuthCallback, onAddRecipe: () => {}, onFriendRequests: () => {}, onRecipeDetail: () => {} });
    await dispatch('https://recifriend.com/auth/callback?code=abc');
    expect(onAuthCallback).toHaveBeenCalledWith('abc');
  });

  it('routes add-recipe to onAddRecipe with url', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({ onAuthCallback: () => {}, onAddRecipe, onFriendRequests: () => {}, onRecipeDetail: () => {} });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fabc');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/abc');
  });

  it('routes /recipes/:id to onRecipeDetail with id', async () => {
    const onRecipeDetail = vi.fn();
    const dispatch = createDispatcher({ onAuthCallback: () => {}, onAddRecipe: () => {}, onFriendRequests: () => {}, onRecipeDetail });
    await dispatch('https://recifriend.com/recipes/abc-123');
    expect(onRecipeDetail).toHaveBeenCalledWith('abc-123');
  });

  it('silently ignores malicious URLs', async () => {
    const handlers = {
      onAuthCallback: vi.fn(), onAddRecipe: vi.fn(),
      onFriendRequests: vi.fn(), onRecipeDetail: vi.fn(),
    };
    const dispatch = createDispatcher(handlers);
    await dispatch('javascript:alert(1)');
    await dispatch('recifriend://auth/callback?code=bad');  // custom scheme rejected for auth
    await dispatch('https://evil.com/recipes/1');
    expect(handlers.onAuthCallback).not.toHaveBeenCalled();
    expect(handlers.onAddRecipe).not.toHaveBeenCalled();
    expect(handlers.onFriendRequests).not.toHaveBeenCalled();
    expect(handlers.onRecipeDetail).not.toHaveBeenCalled();
  });
});
