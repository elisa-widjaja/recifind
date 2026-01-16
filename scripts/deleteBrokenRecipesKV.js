#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKER_DIR = resolve(__dirname, '..', 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';

const DRY_RUN = process.argv.includes('--dry-run');

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

function deleteKey(key) {
  execSync(
    `npx wrangler kv key delete --namespace-id=${KV_NAMESPACE_ID} "${key}" --remote`,
    { cwd: WORKER_DIR, stdio: 'inherit' }
  );
}

function hasNoImage(recipe) {
  const imageUrl = typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '';
  const hasImageUrl = imageUrl && !imageUrl.startsWith('data:image/svg');
  const hasPreviewImage = recipe.previewImage && recipe.previewImage.objectKey;
  return !hasImageUrl && !hasPreviewImage;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== DELETE MODE ===');
  console.log('Fetching recipe keys from KV...');
  const keys = listAllRecipeKeys();
  console.log(`Found ${keys.length} recipe keys.\n`);

  const toDelete = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].name;
    process.stdout.write(`\rChecking ${i + 1}/${keys.length}: ${key.substring(0, 40)}...`);

    const recipe = getRecipeValue(key);
    if (!recipe) continue;

    if (hasNoImage(recipe)) {
      toDelete.push({ key, title: recipe.title, sourceUrl: recipe.sourceUrl });
    }
  }

  console.log('\n\n');
  console.log('='.repeat(60));
  console.log(`RECIPES TO DELETE (${toDelete.length})`);
  console.log('='.repeat(60));

  if (toDelete.length === 0) {
    console.log('No recipes to delete!');
    return;
  }

  toDelete.forEach((item, i) => {
    console.log(`${i + 1}. ${item.title}`);
    console.log(`   Source: ${item.sourceUrl || '(no source URL)'}`);
    console.log(`   Key: ${item.key}`);
    console.log('');
  });

  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('Run without --dry-run to delete these recipes');
    console.log('='.repeat(60));
    return;
  }

  console.log('='.repeat(60));
  console.log('DELETING...');
  console.log('='.repeat(60));

  let deleted = 0;
  let failed = 0;

  for (const item of toDelete) {
    console.log(`Deleting: ${item.title}`);
    try {
      deleteKey(item.key);
      console.log(`  ✓ Deleted`);
      deleted++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Deleted: ${deleted}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${toDelete.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
