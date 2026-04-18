import { describe, expect, it, vi, beforeEach } from 'vitest';
import { shareRecipe } from './shareRecipe';

describe('shareRecipe', () => {
  const BASE = 'https://api.recifriend.com';
  const TOKEN = 'test-token';
  const RECIPE = 'rec-1';

  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('POSTs to /recipes/:id/share with bearer auth', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ shared_with: 2, skipped: 0 })));
    await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a', 'b'] });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/recipes/${RECIPE}/share`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ recipient_user_ids: ['a', 'b'] }),
      })
    );
  });

  it('returns parsed success response', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ shared_with: 3, skipped: 1 }), { status: 200 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a'] });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ shared_with: 3, skipped: 1 });
  });

  it('returns typed error on 400 NOT_FRIENDS', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FRIENDS', non_friend_user_ids: ['x'] }), { status: 400 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['x'] });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FRIENDS');
  });

  it('returns typed error on 429 RATE_LIMITED', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'RATE_LIMITED', retry_after_seconds: 600 }), { status: 429 }));
    const res = await shareRecipe({ apiBase: BASE, jwt: TOKEN, recipeId: RECIPE, recipientUserIds: ['a'] });
    expect(res.ok).toBe(false);
    expect(res.error.retry_after_seconds).toBe(600);
  });
});
