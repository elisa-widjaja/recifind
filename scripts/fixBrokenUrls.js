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
    // Ignore missing env file
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
      throw new Error(`Failed to fetch recipes: HTTP ${response.status}`);
    }

    const data = await response.json();
    recipes.push(...(data.recipes || []));
    cursor = data.cursor;
  } while (cursor);

  return recipes;
}

function isBrokenInstagramUrl(url) {
  if (!url || !url.includes('instagram.com')) {
    return false;
  }

  // Match Instagram post/reel pattern
  const match = url.match(/instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/);
  if (!match) {
    return false;
  }

  const idEndIndex = url.indexOf(match[2]) + match[2].length;
  const afterId = url.substring(idEndIndex);

  // Valid suffixes: /, /?, ?igsh=, empty string
  // Invalid: anything else like "Appetizer", "Shakahuka", etc.
  if (afterId && !afterId.match(/^(\/|\?|$)/)) {
    return true;
  }

  return false;
}

function cleanInstagramUrl(url) {
  if (!url) return url;

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

async function updateRecipe(baseUrl, token, recipeId, updates) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/${recipeId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(updates)
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

  if (!baseUrl || !token) {
    throw new Error('Missing API configuration');
  }

  console.log(`Fetching all recipes from ${baseUrl}...`);
  const allRecipes = await fetchAllRecipes(baseUrl, token);
  console.log(`Found ${allRecipes.length} total recipes.\n`);

  const brokenRecipes = allRecipes.filter(r => isBrokenInstagramUrl(r.sourceUrl));
  console.log(`Found ${brokenRecipes.length} recipes with broken URLs.\n`);

  if (brokenRecipes.length === 0) {
    console.log('All URLs are valid!');
    return;
  }

  // Show recipes that need fixing
  console.log('Recipes to fix:');
  brokenRecipes.forEach((recipe, i) => {
    console.log(`  ${i + 1}. ${recipe.title}`);
    console.log(`     URL: ${recipe.sourceUrl}`);
    console.log(`     Clean: ${cleanInstagramUrl(recipe.sourceUrl)}`);
  });
  console.log('');

  let fixedCount = 0;
  let failedCount = 0;

  for (const recipe of brokenRecipes) {
    const { id, title, sourceUrl } = recipe;
    const cleanedUrl = cleanInstagramUrl(sourceUrl);

    console.log(`Processing: ${title}`);
    console.log(`  Old URL: ${sourceUrl}`);
    console.log(`  New URL: ${cleanedUrl}`);

    try {
      // Try to fetch image from the cleaned URL
      const imageUrl = await fetchOgImage(baseUrl, token, cleanedUrl);

      const updates = {
        sourceUrl: cleanedUrl
      };

      // Also update image if we got one and recipe doesn't have one
      const hasImage = recipe.imageUrl && !recipe.imageUrl.startsWith('data:image/svg');
      if (imageUrl && !hasImage) {
        updates.imageUrl = imageUrl;
        updates.previewImage = { url: imageUrl };
        console.log(`  Found image: ${imageUrl.substring(0, 60)}...`);
      }

      await updateRecipe(baseUrl, token, id, updates);
      console.log(`  ✓ Fixed`);
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
  console.log(`  Total: ${brokenRecipes.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
