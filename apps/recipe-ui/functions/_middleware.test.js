import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequest } from './_middleware.js';

const BOT = 'iMessageLinkExtension/1.0';
const HUMAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

const SENTINEL = new Response('SPA', { status: 200 });

function ctx(url, ua) {
  return {
    request: { url, headers: { get: (k) => (k.toLowerCase() === 'user-agent' ? ua : null) } },
    next: vi.fn().mockResolvedValue(SENTINEL),
    env: {},
  };
}

const RECIPE = {
  title: 'One Pot Clam & Cod',
  ingredients: ['clams', 'cod', 'garlic', 'wine', 'parsley', 'extra'],
  imageUrl: '/images/recipes/one-pot-clam-and-cod.jpg', // relative on purpose
};

describe('_middleware onRequest (OG tags)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RECIPE,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes through for non-bot user agents (no OG, no fetch)', async () => {
    const c = ctx('https://recifriend.com/?recipe=r1&user=u1', HUMAN);
    const res = await onRequest(c);
    expect(res).toBe(SENTINEL);
    expect(c.next).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('passes through for a bot when neither share nor recipe+user is present', async () => {
    const c = ctx('https://recifriend.com/', BOT);
    const res = await onRequest(c);
    expect(res).toBe(SENTINEL);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('absolutizes a relative og:image against the request origin (legacy ?recipe=&user=)', async () => {
    const c = ctx('https://recifriend.com/?recipe=r1&user=u1', BOT);
    const res = await onRequest(c);
    const html = await res.text();
    expect(global.fetch).toHaveBeenCalledWith('https://api.recifriend.com/public/recipe/u1/r1');
    expect(html).toContain('<meta property="og:image" content="https://recifriend.com/images/recipes/one-pot-clam-and-cod.jpg"');
    expect(html).toContain('<meta property="og:title" content="One Pot Clam &amp; Cod"');
  });

  it('parses the new /recipes/{id}?user= path form', async () => {
    const c = ctx('https://recifriend.com/recipes/r1?user=u1', BOT);
    const res = await onRequest(c);
    const html = await res.text();
    expect(global.fetch).toHaveBeenCalledWith('https://api.recifriend.com/public/recipe/u1/r1');
    expect(html).toContain('og:image" content="https://recifriend.com/images/recipes/one-pot-clam-and-cod.jpg"');
  });

  it('leaves an already-absolute og:image unchanged', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...RECIPE, imageUrl: 'https://cdn.example.com/x/y.jpg' }),
    });
    const c = ctx('https://recifriend.com/?recipe=r1&user=u1', BOT);
    const html = await (await onRequest(c)).text();
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/x/y.jpg"');
  });

  it('uses the share-token endpoint for ?share= links', async () => {
    const c = ctx('https://recifriend.com/?share=tok123', BOT);
    await onRequest(c);
    expect(global.fetch).toHaveBeenCalledWith('https://api.recifriend.com/public/share/tok123');
  });

  it('passes through when the API lookup fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const c = ctx('https://recifriend.com/?recipe=r1&user=u1', BOT);
    const res = await onRequest(c);
    expect(res).toBe(SENTINEL);
  });
});
