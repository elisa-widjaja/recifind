#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const RECIPES_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', 'recipes.json');
const ENV_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', '.env.local');
const PUBLIC_DIR = resolve(ROOT_DIR, 'apps', 'recipe-ui', 'public');
const WORKER_DIR = resolve(ROOT_DIR, 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';

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

async function loadRecipes() {
  const raw = await readFile(RECIPES_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !Array.isArray(data.recipes)) {
    throw new Error('recipes.json must export { "recipes": [...] }');
  }
  return data.recipes;
}

function buildRecipeSignature(recipe, index) {
  const sourceUrl =
    typeof recipe.sourceUrl === 'string' ? recipe.sourceUrl.trim().toLowerCase() : '';
  if (sourceUrl) {
    return `source:${sourceUrl}`;
  }
  const title = typeof recipe.title === 'string' ? recipe.title.trim().toLowerCase() : '';
  return `title:${title || `recipe-${index}`}`;
}

function normalizeRecipe(recipe, index, userId) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error(`Recipe at index ${index} is not an object.`);
  }
  const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const sanitizeStrings = (items) =>
    items
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

  return {
    id: randomUUID(),
    userId,
    title: typeof recipe.title === 'string' ? recipe.title.trim() : `Recipe ${index + 1}`,
    sourceUrl: typeof recipe.sourceUrl === 'string' ? recipe.sourceUrl.trim() : '',
    imageUrl: typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '',
    mealTypes: sanitizeStrings(toArray(recipe.mealTypes)),
    ingredients: sanitizeStrings(toArray(recipe.ingredients || [])),
    steps: sanitizeStrings(toArray(recipe.steps || [])),
    durationMinutes:
      typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes)
        ? Math.round(recipe.durationMinutes)
        : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function main() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error('Usage: node importRecipesForUser.js <target-email>');
    process.exit(1);
  }

  const env = await loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    process.exit(1);
  }

  // Get target user ID from Supabase
  console.log(`Looking up user: ${targetEmail}`);
  const user = await getSupabaseUserByEmail(supabaseUrl, serviceRoleKey, targetEmail);

  if (!user) {
    console.error(`User not found: ${targetEmail}`);
    process.exit(1);
  }

  const userId = user.id;
  console.log(`Found user ID: ${userId}`);

  // Load recipes
  const recipes = await loadRecipes();
  const seen = new Set();
  const deduped = [];
  for (const [index, recipe] of recipes.entries()) {
    const signature = buildRecipeSignature(recipe, index);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push({ index, recipe });
  }

  const skipped = recipes.length - deduped.length;
  console.log(`\nImporting ${deduped.length} recipes (skipped ${skipped} duplicates)...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const { index, recipe } of deduped) {
    const normalized = normalizeRecipe(recipe, index, userId);
    const key = `recipe:${userId}:${normalized.id}`;

    try {
      const json = JSON.stringify(normalized);
      // Write to a temp file to avoid shell escaping issues
      const tmpFile = `/tmp/recipe-${normalized.id}.json`;
      await import('node:fs/promises').then(fs => fs.writeFile(tmpFile, json));

      execSync(
        `npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} "${key}" --path="${tmpFile}" --remote`,
        { cwd: WORKER_DIR, stdio: 'pipe' }
      );

      successCount++;
      if (successCount % 25 === 0 || successCount === deduped.length) {
        console.log(`  → Imported ${successCount}/${deduped.length}`);
      }
    } catch (error) {
      console.error(`Failed: ${normalized.title} - ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\nDone! Successfully imported ${successCount}/${deduped.length} recipes.`);
  if (errorCount > 0) {
    console.log(`Errors: ${errorCount}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
