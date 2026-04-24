import { describe, expect, it, vi } from 'vitest';
import { createDispatcher } from './deepLinkDispatch';

describe('deep link dispatcher', () => {
  const noopHandlers = () => ({
    onAuthCallback: () => {},
    onAddRecipe: () => {},
    onFriendRequests: () => {},
    onRecipeDetail: () => {},
    onRecipesList: () => {},
    onOpenPendingShare: () => {},
  });

  it('routes auth callback to onAuthCallback', async () => {
    const onAuthCallback = vi.fn().mockResolvedValue(undefined);
    const dispatch = createDispatcher({ ...noopHandlers(), onAuthCallback });
    await dispatch('https://recifriend.com/auth/callback?code=abc');
    expect(onAuthCallback).toHaveBeenCalledWith('abc');
  });

  it('routes add-recipe to onAddRecipe with url', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onAddRecipe });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fabc');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/abc', undefined);
  });

  it('routes /recipes/:id to onRecipeDetail with id', async () => {
    const onRecipeDetail = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onRecipeDetail });
    await dispatch('https://recifriend.com/recipes/abc-123');
    expect(onRecipeDetail).toHaveBeenCalledWith('abc-123');
  });

  it('routes /recipes (no id) to onRecipesList', async () => {
    const onRecipesList = vi.fn();
    const onRecipeDetail = vi.fn();
    const dispatch = createDispatcher({ ...noopHandlers(), onRecipesList, onRecipeDetail });
    await dispatch('recifriend://recipes');
    await dispatch('https://recifriend.com/recipes');
    await dispatch('https://recifriend.com/recipes/');
    expect(onRecipesList).toHaveBeenCalledTimes(3);
    expect(onRecipeDetail).not.toHaveBeenCalled();
  });

  it('silently ignores malicious URLs', async () => {
    const handlers = {
      onAuthCallback: vi.fn(), onAddRecipe: vi.fn(),
      onFriendRequests: vi.fn(), onRecipeDetail: vi.fn(), onRecipesList: vi.fn(),
      onOpenPendingShare: vi.fn(),
    };
    const dispatch = createDispatcher(handlers);
    await dispatch('javascript:alert(1)');
    await dispatch('recifriend://auth/callback');  // missing code → rejected
    await dispatch('https://evil.com/recipes/1');
    expect(handlers.onAuthCallback).not.toHaveBeenCalled();
    expect(handlers.onAddRecipe).not.toHaveBeenCalled();
    expect(handlers.onFriendRequests).not.toHaveBeenCalled();
    expect(handlers.onRecipeDetail).not.toHaveBeenCalled();
    expect(handlers.onRecipesList).not.toHaveBeenCalled();
  });
});

describe('dispatcher — new kinds and title', () => {
  it('passes title through to onAddRecipe when present', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe,
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare: vi.fn(),
    });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=Pasta');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/x', 'Pasta');
  });

  it('passes undefined title when query omits it', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe,
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare: vi.fn(),
    });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/x', undefined);
  });

  it('calls onOpenPendingShare for /open-pending-share', async () => {
    const onOpenPendingShare = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe: vi.fn(),
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare,
    });
    await dispatch('recifriend://open-pending-share');
    expect(onOpenPendingShare).toHaveBeenCalledOnce();
  });
});
