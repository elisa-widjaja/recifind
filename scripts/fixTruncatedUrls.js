#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const ENV_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', '.env.local');

// Mapping of recipe titles to their correct Instagram URLs (from Recipies.pdf)
const URL_FIXES = {
  'Banana cake': 'https://www.instagram.com/reel/DF8OOK8xP_X/',
  'Chicken with lemon anchovies sauce': 'https://www.instagram.com/reel/DM_LBDOSAAp/',
  'Creamy spinach and crispy chicken': 'https://www.instagram.com/reel/DP_z_bJCHug/',
  'Go ju Chang chicken rice': 'https://www.instagram.com/reel/DFvaASjIe_u/',
  'Garlic confit avocado': 'https://www.instagram.com/reel/C_saZHuuhmV/',
  'Loco moco': 'https://www.instagram.com/reel/DE0Kb9_sBQz/',
  'Greek meatballs': 'https://www.instagram.com/reel/DPt4y8_DZAJ/',
  'Orange cake': 'https://www.instagram.com/reel/DIgG57_yv6v/',
  'Cheesy potatoe gratin': 'https://www.instagram.com/reel/DBeJSPxoX7_/',
  'Orange glazed salmon': 'https://www.instagram.com/reel/DJF_vwqxlKh/',
  'Lemon miso kale soup': 'https://www.instagram.com/reel/DMD_Jm3TLrR/',
  'Ginger chicken soup': 'https://www.instagram.com/reel/C_7-3XSuJVQ/',
  'Instapot braised pork belly': 'https://www.instagram.com/reel/DJ9WkcUI_3D/',
  'Spaghetti pomodoro': 'https://www.instagram.com/reel/C_xdqy6MlMm/',
  'Thai chicken rice': 'https://www.instagram.com/reel/DDP_XTioMtQ/',
  'Pad Thai': 'https://www.instagram.com/reel/DEM3_KitXZD/',
  'Greek yogurt lemon chicken': 'https://www.instagram.com/reel/DABglqBP_t7/',
  'Baked sardine in white wine tomato sauce': 'https://www.instagram.com/reel/C_6XPDCNadi/',
  'Oxtail soup': 'https://www.instagram.com/reel/DJCJlP_ocyo/',
  'Herb Crusted Salmon': 'https://www.instagram.com/reel/C_K2cS4iLVJ/',
  'Crispy eggplant snitzel': 'https://www.instagram.com/reel/C_QQim2soos/',
  'Creamy white bean soup': 'https://www.instagram.com/reel/DEh_g3-oJvW/',
  'Honey soy chicken rice': 'https://www.instagram.com/reel/C_dBwaYCyx4/',
  'Creamy Thai coconut chicken meatballs': 'https://www.instagram.com/reel/C_doIV5IWgu/',
  'Lemon posset': 'https://www.instagram.com/reel/DG3bWx_PesR/',
  'Peach salad': 'https://www.instagram.com/reel/DMO3ffPs__V/',
};

// Special case - recipe with garbage title needs renaming
const GARBAGE_TITLE_FIX = {
  titleMatch: '05)',
  newTitle: 'Chili lime hot honey garlic shrimps',
  url: 'https://www.instagram.com/reel/DGNC_IHxM9b/'
};

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

async function fetchOgImage(baseUrl, token, sourceUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/recipes/og-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ sourceUrl })
  });

  if (!response.ok) return null;
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

  let fixedCount = 0;
  let notFoundCount = 0;
  let alreadyCorrectCount = 0;

  // Fix recipes with known URL mappings
  for (const [titleKey, correctUrl] of Object.entries(URL_FIXES)) {
    // Find recipe by title (case-insensitive)
    const recipe = allRecipes.find(r =>
      r.title && r.title.toLowerCase().trim() === titleKey.toLowerCase().trim()
    );

    if (!recipe) {
      console.log(`✗ Not found: "${titleKey}"`);
      notFoundCount++;
      continue;
    }

    const currentUrl = recipe.sourceUrl || '';

    // Check if URL already correct
    if (currentUrl.replace(/\/?$/, '/') === correctUrl) {
      console.log(`✓ Already correct: "${recipe.title}"`);
      alreadyCorrectCount++;
      continue;
    }

    try {
      console.log(`\nFixing: "${recipe.title}"`);
      console.log(`  Old URL: ${currentUrl}`);
      console.log(`  New URL: ${correctUrl}`);

      const updates = { sourceUrl: correctUrl };

      // Try to fetch image if recipe has no image
      if (hasNoImage(recipe)) {
        console.log(`  Fetching image...`);
        const imageUrl = await fetchOgImage(baseUrl, token, correctUrl);
        if (imageUrl) {
          updates.imageUrl = imageUrl;
          updates.previewImage = { url: imageUrl };
          console.log(`  ✓ Found image`);
        } else {
          console.log(`  ✗ No image found`);
        }
      }

      await updateRecipe(baseUrl, token, recipe.id, updates);
      console.log(`  ✓ Updated successfully`);
      fixedCount++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  // Handle the garbage title recipe
  const garbageRecipe = allRecipes.find(r =>
    r.title && r.title.startsWith(GARBAGE_TITLE_FIX.titleMatch)
  );

  if (garbageRecipe) {
    console.log(`\nFixing garbage title recipe:`);
    console.log(`  Old title: "${garbageRecipe.title}"`);
    console.log(`  New title: "${GARBAGE_TITLE_FIX.newTitle}"`);
    console.log(`  New URL: ${GARBAGE_TITLE_FIX.url}`);

    try {
      const updates = {
        title: GARBAGE_TITLE_FIX.newTitle,
        sourceUrl: GARBAGE_TITLE_FIX.url
      };

      if (hasNoImage(garbageRecipe)) {
        const imageUrl = await fetchOgImage(baseUrl, token, GARBAGE_TITLE_FIX.url);
        if (imageUrl) {
          updates.imageUrl = imageUrl;
          updates.previewImage = { url: imageUrl };
          console.log(`  ✓ Found image`);
        }
      }

      await updateRecipe(baseUrl, token, garbageRecipe.id, updates);
      console.log(`  ✓ Updated successfully`);
      fixedCount++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Fixed: ${fixedCount}`);
  console.log(`Already correct: ${alreadyCorrectCount}`);
  console.log(`Not found: ${notFoundCount}`);
  console.log(`Total mappings: ${Object.keys(URL_FIXES).length + 1}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
