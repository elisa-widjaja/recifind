#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

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
        env[key.trim()] = value;
      });
  } catch (error) {
    // Ignore
  }
  return env;
}

async function getSupabaseUserByEmail(supabaseUrl, serviceRoleKey, email) {
  // Use Supabase Admin API to get user by email
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.status}`);
  }

  const data = await response.json();
  const user = data.users?.find(u => u.email === email);
  return user;
}

async function main() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error('Usage: node migrateRecipes.js <target-email>');
    process.exit(1);
  }

  const env = await loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;

  // Get service role key from wrangler secrets
  console.log('Getting Supabase service role key...');
  let serviceRoleKey;
  try {
    // We need to get this from wrangler or have it set
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
      console.error('Run: export SUPABASE_SERVICE_ROLE_KEY=<your-key>');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to get service role key:', error.message);
    process.exit(1);
  }

  // Get target user ID from Supabase
  console.log(`Looking up user: ${targetEmail}`);
  const user = await getSupabaseUserByEmail(supabaseUrl, serviceRoleKey, targetEmail);

  if (!user) {
    console.error(`User not found: ${targetEmail}`);
    console.error('Make sure the user has logged in at least once via magic link.');
    process.exit(1);
  }

  const targetUserId = user.id;
  console.log(`Found user ID: ${targetUserId}`);

  // List all recipes for dev-user using wrangler
  const sourceUserId = 'dev-user';
  const kvNamespaceId = '15fc7eefa6e2484981be9ac59962e6a9';
  const prefix = `recipe:${sourceUserId}:`;

  console.log(`\nListing recipes with prefix: ${prefix}`);

  // Use wrangler to list keys
  const workerDir = resolve(ROOT_DIR, 'apps', 'worker');
  let keysOutput;
  try {
    keysOutput = execSync(
      `npx wrangler kv key list --namespace-id=${kvNamespaceId} --prefix="${prefix}"`,
      { cwd: workerDir, encoding: 'utf8' }
    );
  } catch (error) {
    console.error('Failed to list KV keys:', error.message);
    process.exit(1);
  }

  let keys;
  try {
    keys = JSON.parse(keysOutput);
  } catch (error) {
    console.error('Failed to parse KV keys output');
    console.error(keysOutput);
    process.exit(1);
  }

  if (!keys || keys.length === 0) {
    console.log('No recipes found for dev-user');
    process.exit(0);
  }

  console.log(`Found ${keys.length} recipes to migrate\n`);

  // Migrate each recipe
  let successCount = 0;
  let errorCount = 0;

  for (const keyInfo of keys) {
    const sourceKey = keyInfo.name;
    const recipeId = sourceKey.replace(prefix, '');
    const targetKey = `recipe:${targetUserId}:${recipeId}`;

    console.log(`Migrating: ${recipeId}`);

    try {
      // Get the recipe data
      const valueOutput = execSync(
        `npx wrangler kv key get --namespace-id=${kvNamespaceId} "${sourceKey}"`,
        { cwd: workerDir, encoding: 'utf8' }
      );

      // Parse and update the recipe
      const recipe = JSON.parse(valueOutput);
      recipe.userId = targetUserId;

      // Write to the new key
      const recipeJson = JSON.stringify(recipe);
      execSync(
        `echo '${recipeJson.replace(/'/g, "'\\''")}' | npx wrangler kv key put --namespace-id=${kvNamespaceId} "${targetKey}"`,
        { cwd: workerDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      console.log(`  ✓ Migrated to ${targetKey}`);
      successCount++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\nMigration complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);

  if (successCount > 0) {
    console.log('\nNote: Original dev-user recipes were not deleted.');
    console.log('You can delete them manually if needed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
