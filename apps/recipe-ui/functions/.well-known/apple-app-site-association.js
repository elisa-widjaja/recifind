// Cloudflare Pages Function — Apple requires application/json Content-Type,
// no redirects, no auth for the AASA file. Default Pages static serving gives
// the wrong mime for an extensionless file; this function fixes that.
export async function onRequest(context) {
  const assetResponse = await context.env.ASSETS.fetch(
    new Request(new URL('/.well-known/apple-app-site-association', context.request.url))
  );
  const body = await assetResponse.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
