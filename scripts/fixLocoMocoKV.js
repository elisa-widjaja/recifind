#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKER_DIR = resolve(__dirname, '..', 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';
const NEW_URL = 'https://www.instagram.com/reel/DE0Kb9_sBQz/?igsh=NjZiM2M3MzIxNA==';

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

function putRecipeValue(key, value) {
  const tmpFile = `/tmp/recipe-fix-${Date.now()}.json`;
  try {
    writeFileSync(tmpFile, JSON.stringify(value));
    execSync(
      `npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} "${key}" --path="${tmpFile}" --remote`,
      { cwd: WORKER_DIR, stdio: 'inherit' }
    );
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch (e) {
      // Ignore
    }
  }
}

async function main() {
  console.log('Fetching recipe keys from KV...');
  const keys = listAllRecipeKeys();
  console.log(`Found ${keys.length} recipe keys.`);
  console.log('Searching for Loco moco...\n');

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].name;
    process.stdout.write(`\rChecking ${i + 1}/${keys.length}...`);

    const recipe = getRecipeValue(key);
    if (!recipe) continue;

    if (recipe.title && recipe.title.toLowerCase().includes('loco')) {
      console.log(`\n\nFound: ${recipe.title}`);
      console.log(`Key: ${key}`);
      console.log(`Current URL: ${recipe.sourceUrl}`);
      console.log(`New URL: ${NEW_URL}`);

      recipe.sourceUrl = NEW_URL;
      recipe.updatedAt = new Date().toISOString();

      console.log('\nUpdating...');
      putRecipeValue(key, recipe);
      console.log('Done!');
      return;
    }
  }

  console.log('\n\nLoco moco not found!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
