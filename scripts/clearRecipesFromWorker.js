#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

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
    // Ignore missing file.
  }
  return env;
}

async function fetchRecipes(baseUrl, token) {
  let cursor;
  const recipes = [];
  do {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/recipes`);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    url.searchParams.set('limit', '1000');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list recipes: HTTP ${response.status} ${text}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload.recipes)) {
      recipes.push(...payload.recipes);
    }
    cursor = payload.cursor || null;
  } while (cursor);
  return recipes;
}

async function deleteRecipe(baseUrl, token, recipeId) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/${encodeURIComponent(recipeId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to delete recipe ${recipeId}: HTTP ${response.status} ${text}`);
  }
}

async function main() {
  const env = await loadEnv();
  const baseUrl = env.VITE_RECIPES_API_BASE_URL || env.API_BASE_URL;
  const token = env.VITE_RECIPES_API_TOKEN || env.API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('Missing VITE_RECIPES_API_BASE_URL or VITE_RECIPES_API_TOKEN');
  }

  console.log('Listing recipes to delete ...');
  const recipes = await fetchRecipes(baseUrl, token);
  console.log(`Found ${recipes.length} recipes. Deleting ...`);

  let deleted = 0;
  for (const recipe of recipes) {
    await deleteRecipe(baseUrl, token, recipe.id);
    deleted += 1;
    if (deleted % 25 === 0 || deleted === recipes.length) {
      console.log(`  → Deleted ${deleted}/${recipes.length}`);
    }
  }

  console.log(`Done. Deleted ${deleted} recipes.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
