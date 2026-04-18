import { test, expect } from '@playwright/test';

test('apple-app-site-association served with application/json Content-Type', async ({ request }) => {
  const res = await request.get('https://recifriend.com/.well-known/apple-app-site-association', {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^application\/json/);
  const body = await res.json();
  expect(body.applinks).toBeDefined();
  const details = body.applinks.details;
  expect(Array.isArray(details) && details.length === 1).toBe(true);
  expect(details[0].appID).toBe('7C6PMUN99K.com.recifriend.app');
  expect(details[0].paths).toEqual(
    expect.arrayContaining(['/auth/callback', '/recipes/*', '/friend-requests'])
  );
});
