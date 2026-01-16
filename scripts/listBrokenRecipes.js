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
        if (!key || rest.length === 0) return;
        const value = rest.join('=').trim().replace(/^"|"$/g, '');
        // Only set if not already in process.env (CLI takes precedence)
        if (!process.env[key.trim()]) {
          env[key.trim()] = value;
        }
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
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
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
  if (!url || !url.includes('instagram.com')) return false;
  const match = url.match(/instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/);
  if (!match) return false;
  const idEndIndex = url.indexOf(match[2]) + match[2].length;
  const afterId = url.substring(idEndIndex);
  if (afterId && !afterId.match(/^(\/|\?|$)/)) return true;
  return false;
}

function hasNoImage(recipe) {
  const imageUrl = typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '';
  const hasImageUrl = imageUrl && !imageUrl.startsWith('data:image/svg');
  const hasPreviewImage = recipe.previewImage && recipe.previewImage.objectKey;
  return !hasImageUrl && !hasPreviewImage;
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

  // Find broken URLs
  const brokenUrlRecipes = allRecipes.filter(r => isBrokenInstagramUrl(r.sourceUrl));

  // Find recipes with no images
  const noImageRecipes = allRecipes.filter(hasNoImage);

  console.log('='.repeat(60));
  console.log(`RECIPES WITH BROKEN URLS (${brokenUrlRecipes.length})`);
  console.log('='.repeat(60));
  if (brokenUrlRecipes.length === 0) {
    console.log('None found!\n');
  } else {
    brokenUrlRecipes.forEach((recipe, i) => {
      console.log(`${i + 1}. ${recipe.title}`);
      console.log(`   URL: ${recipe.sourceUrl}`);
      console.log('');
    });
  }

  console.log('='.repeat(60));
  console.log(`RECIPES WITH NO IMAGES (${noImageRecipes.length})`);
  console.log('='.repeat(60));
  if (noImageRecipes.length === 0) {
    console.log('None found!\n');
  } else {
    noImageRecipes.forEach((recipe, i) => {
      console.log(`${i + 1}. ${recipe.title}`);
      console.log(`   Source: ${recipe.sourceUrl || '(no source URL)'}`);
      console.log('');
    });
  }

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total recipes: ${allRecipes.length}`);
  console.log(`Broken URLs: ${brokenUrlRecipes.length}`);
  console.log(`No images: ${noImageRecipes.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
