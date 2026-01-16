#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const RECIPES_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', 'recipes.json');
const ENV_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', '.env.local');
const PUBLIC_DIR = resolve(ROOT_DIR, 'apps', 'recipe-ui', 'public');

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

function normalizeRecipe(recipe, index) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error(`Recipe at index ${index} is not an object.`);
  }
  const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const sanitizeStrings = (items) =>
    items
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

  const previewImage =
    recipe.previewImage && typeof recipe.previewImage === 'object'
      ? recipe.previewImage
      : null;

  return {
    title: typeof recipe.title === 'string' ? recipe.title.trim() : `Recipe ${index + 1}`,
    sourceUrl: typeof recipe.sourceUrl === 'string' ? recipe.sourceUrl.trim() : '',
    imageUrl: typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '',
    mealTypes: sanitizeStrings(toArray(recipe.mealTypes)),
    ingredients: sanitizeStrings(toArray(recipe.ingredients || [])),
    steps: sanitizeStrings(toArray(recipe.steps || [])),
    durationMinutes:
      typeof recipe.durationMinutes === 'number' && Number.isFinite(recipe.durationMinutes)
        ? Math.round(recipe.durationMinutes)
        : null
  };
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function isLocalPath(url) {
  return typeof url === 'string' && url.trim().startsWith('/');
}

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

async function buildPreviewPayload(recipe) {
  const imageUrl = typeof recipe.imageUrl === 'string' ? recipe.imageUrl.trim() : '';
  if (!imageUrl) {
    return null;
  }

  if (isHttpUrl(imageUrl)) {
    return { url: imageUrl };
  }

  if (isLocalPath(imageUrl)) {
    const sanitized = imageUrl.replace(/^\/+/, '');
    const absolutePath = resolve(PUBLIC_DIR, sanitized);
    try {
      const fileData = await readFile(absolutePath);
      return {
        data: fileData.toString('base64'),
        contentType: getMimeType(absolutePath)
      };
    } catch (error) {
      console.warn(`Warning: unable to read image file ${absolutePath}:`, error.message);
    }
  }

  return null;
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
  console.log(
    `Uploading ${deduped.length} recipes to ${baseUrl} (skipped ${skipped} duplicates) ...`
  );

  let successCount = 0;
  for (const { index, recipe } of deduped) {
    const payload = normalizeRecipe(recipe, index);
    const previewImagePayload = await buildPreviewPayload(recipe);
    if (previewImagePayload) {
      payload.previewImage = previewImagePayload;
    }
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      successCount += 1;
      if (successCount % 25 === 0 || successCount === deduped.length) {
        console.log(`  → Uploaded ${successCount}/${deduped.length}`);
      }
    } catch (error) {
      console.error(`Failed to upload recipe #${index + 1} (${payload.title}):`, error.message);
    }
  }

  console.log(`Done. Successfully uploaded ${successCount}/${deduped.length} recipes.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
