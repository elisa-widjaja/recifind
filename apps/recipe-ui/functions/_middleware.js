const BOT_USER_AGENTS = [
  'Slackbot',
  'facebookexternalhit',
  'Twitterbot',
  'LinkedInBot',
  'WhatsApp',
  'TelegramBot',
  'Discordbot',
  'Pinterest',
  'Googlebot',
  'bingbot',
  'iMessageLinkExtension',
  'AppleBot'
];

function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_USER_AGENTS.some((bot) => userAgent.includes(bot));
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const shareToken = url.searchParams.get('share');
  const userId = url.searchParams.get('user');
  // Recipe id from the legacy `?recipe=` query OR the new `/recipes/{id}`
  // path form (Universal Links). Keep both so already-shared old links and
  // new links both produce the SMS/iMessage rich preview.
  let recipeId = url.searchParams.get('recipe');
  if (!recipeId) {
    const m = url.pathname.match(/^\/recipes\/([^/?#]+)\/?$/);
    if (m) {
      try { recipeId = decodeURIComponent(m[1]); } catch { recipeId = m[1]; }
    }
  }
  const userAgent = request.headers.get('User-Agent') || '';

  // Only intercept for bots
  if (!isBot(userAgent)) {
    return next();
  }

  // Need either share token or both recipe and user IDs
  if (!shareToken && (!recipeId || !userId)) {
    return next();
  }

  try {
    // Fetch recipe from public API endpoint
    const apiUrl = env.RECIPES_API_URL || 'https://api.recifriend.com';

    // Use share token endpoint if available, otherwise fall back to legacy format
    const recipeResponse = shareToken
      ? await fetch(`${apiUrl}/public/share/${encodeURIComponent(shareToken)}`)
      : await fetch(`${apiUrl}/public/recipe/${encodeURIComponent(userId)}/${encodeURIComponent(recipeId)}`);

    if (!recipeResponse.ok) {
      return next();
    }

    const recipe = await recipeResponse.json();

    if (!recipe || !recipe.title) {
      return next();
    }

    const title = escapeHtml(recipe.title);
    const description = recipe.ingredients?.length
      ? escapeHtml(`Ingredients: ${recipe.ingredients.slice(0, 5).join(', ')}${recipe.ingredients.length > 5 ? '...' : ''}`)
      : 'View this recipe on ReciFriend';
    // og:image MUST be absolute — iMessage/SMS (and most scrapers) won't
    // fetch a relative path, so ~half the recipes (those with
    // `/images/recipes/*.jpg` instead of a full Supabase URL) silently
    // showed no thumbnail. Resolve against the request origin.
    const rawImage = recipe.imageUrl || '';
    let imageUrl = '';
    if (rawImage) {
      try { imageUrl = new URL(rawImage, url.origin).toString(); }
      catch { imageUrl = ''; }
    }
    const pageUrl = url.toString();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} - ReciFriend</title>

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:site_name" content="ReciFriend" />
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />` : ''}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:url" content="${escapeHtml(pageUrl)}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ''}

  <!-- Redirect to actual page for browsers -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(pageUrl)}" />
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${title}" />` : ''}
  <p><a href="${escapeHtml(pageUrl)}">View recipe on ReciFriend</a></p>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error fetching recipe for OG tags:', error);
    return next();
  }
}
