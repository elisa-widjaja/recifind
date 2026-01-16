#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const ENV_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', '.env.local');

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(ENV_FILE, 'utf8');
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const [key, ...rest] = line.split('=');
        if (!key || rest.length === 0) {
          return;
        }
        const value = rest.join('=').trim().replace(/^"|"$/g, '');
        env[key.trim()] = value;
      });
  } catch (error) {
    // Ignore missing env file; rely on process.env.
  }
  return env;
}

async function fetchAllRecipes(baseUrl, token) {
  const recipes = [];
  let cursor = null;

  do {
    const url = new URL('/recipes', baseUrl);
    url.searchParams.set('limit', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch recipes: HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    recipes.push(...(data.recipes || []));
    cursor = data.cursor;
  } while (cursor);

  return recipes;
}

function hasNoImage(recipe) {
  const imageUrl = typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '';
  const hasImageUrl = imageUrl && !imageUrl.startsWith('data:image/svg');
  const hasPreviewImage = recipe.previewImage && recipe.previewImage.objectKey;
  return !hasImageUrl && !hasPreviewImage;
}

function cleanInstagramUrl(url) {
  if (!url) return url;

  // Fix URLs that have garbage appended after the ID
  // Pattern: /reel/ABC123/?... or /p/ABC123/?...
  const match = url.match(/(https:\/\/www\.instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]+)/);
  if (match) {
    return match[1] + '/';
  }
  return url;
}

async function fetchOgImage(baseUrl, token, sourceUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/og-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ sourceUrl })
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.imageUrl || null;
}

async function enrichRecipe(baseUrl, token, sourceUrl, title) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ sourceUrl, title })
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.enriched?.imageUrl || null;
}

async function updateRecipeImage(baseUrl, token, recipeId, imageUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/${recipeId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      imageUrl,
      previewImage: { url: imageUrl }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function main() {
  const env = await loadEnv();
  const baseUrl = env.VITE_RECIPES_API_BASE_URL || env.API_BASE_URL;
  const token = env.VITE_RECIPES_API_TOKEN || env.API_TOKEN;

  if (!baseUrl) {
    throw new Error('VITE_RECIPES_API_BASE_URL (or API_BASE_URL) is not set.');
  }
  if (!token) {
    throw new Error('VITE_RECIPES_API_TOKEN (or API_TOKEN) is not set.');
  }

  console.log(`Fetching all recipes from ${baseUrl}...`);
  const allRecipes = await fetchAllRecipes(baseUrl, token);
  console.log(`Found ${allRecipes.length} total recipes.`);

  const recipesWithNoImages = allRecipes.filter(hasNoImage);
  console.log(`Found ${recipesWithNoImages.length} recipes with no images.\n`);

  if (recipesWithNoImages.length === 0) {
    console.log('All recipes have images!');
    return;
  }

  // Show recipes that need fixing
  console.log('Recipes to fix:');
  recipesWithNoImages.forEach((recipe, i) => {
    console.log(`  ${i + 1}. ${recipe.title}`);
    console.log(`     Source: ${recipe.sourceUrl || '(no source URL)'}`);
  });
  console.log('');

  let fixedCount = 0;
  let failedCount = 0;

  for (const recipe of recipesWithNoImages) {
    const { id, title, sourceUrl } = recipe;

    if (!sourceUrl) {
      console.log(`Skipping "${title}" - no source URL to extract image from`);
      failedCount++;
      continue;
    }

    // Clean the URL (fix malformed Instagram URLs)
    const cleanedUrl = cleanInstagramUrl(sourceUrl);
    const urlWasCleaned = cleanedUrl !== sourceUrl;

    console.log(`Processing: ${title}`);
    console.log(`  Source: ${sourceUrl}`);
    if (urlWasCleaned) {
      console.log(`  Cleaned: ${cleanedUrl}`);
    }

    try {
      // Try to extract og:image from source URL
      let ogImageUrl = await fetchOgImage(baseUrl, token, cleanedUrl);

      // If og:image failed and URL was cleaned, try original URL
      if (!ogImageUrl && urlWasCleaned) {
        console.log(`  Trying original URL...`);
        ogImageUrl = await fetchOgImage(baseUrl, token, sourceUrl);
      }

      // If still no image, try enrichment with Gemini
      if (!ogImageUrl) {
        console.log(`  og:image failed, trying Gemini enrichment...`);
        ogImageUrl = await enrichRecipe(baseUrl, token, cleanedUrl, title);
      }

      if (!ogImageUrl) {
        console.log(`  ✗ Could not extract image from any source`);
        failedCount++;
        continue;
      }

      console.log(`  Found image: ${ogImageUrl.substring(0, 80)}...`);

      // Update the recipe with the new image
      await updateRecipeImage(baseUrl, token, id, ogImageUrl);
      console.log(`  ✓ Updated recipe with new image`);
      fixedCount++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      failedCount++;
    }

    console.log('');
  }

  console.log('Summary:');
  console.log(`  Fixed: ${fixedCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log(`  Total: ${recipesWithNoImages.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
