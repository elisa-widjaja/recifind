#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKER_DIR = resolve(__dirname, '..', 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';

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

function listAllRecipeKeys() {
  const result = execSync(
    `npx wrangler kv key list --namespace-id=${KV_NAMESPACE_ID} --prefix="recipe:" --remote`,
    { cwd: WORKER_DIR, encoding: 'utf8' }
  );
  return JSON.parse(result);
}

function getRecipeValue(key) {
  try {
    const result = execSync(
      `npx wrangler kv key get --namespace-id=${KV_NAMESPACE_ID} "${key}" --remote`,
      { cwd: WORKER_DIR, encoding: 'utf8' }
    );
    return JSON.parse(result);
  } catch (error) {
    console.error(`Failed to get ${key}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Fetching recipe keys from KV...');
  const keys = listAllRecipeKeys();
  console.log(`Found ${keys.length} recipe keys.\n`);

  const brokenUrlRecipes = [];
  const noImageRecipes = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].name;
    process.stdout.write(`\rProcessing ${i + 1}/${keys.length}: ${key.substring(0, 40)}...`);

    const recipe = getRecipeValue(key);
    if (!recipe) continue;

    if (isBrokenInstagramUrl(recipe.sourceUrl)) {
      brokenUrlRecipes.push(recipe);
    }
    if (hasNoImage(recipe)) {
      noImageRecipes.push(recipe);
    }
  }

  console.log('\n');

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
  console.log(`Total recipes: ${keys.length}`);
  console.log(`Broken URLs: ${brokenUrlRecipes.length}`);
  console.log(`No images: ${noImageRecipes.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
