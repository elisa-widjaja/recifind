#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKER_DIR = resolve(__dirname, '..', 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';

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
  console.log(`Found ${keys.length} recipe keys.\n`);

  // Load all recipes
  const allRecipes = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].name;
    process.stdout.write(`\rLoading ${i + 1}/${keys.length}: ${key.substring(0, 40)}...`);
    const recipe = getRecipeValue(key);
    if (recipe) {
      allRecipes.push({ key, recipe });
    }
  }
  console.log('\n');

  let fixedCount = 0;
  let notFoundCount = 0;
  let alreadyCorrectCount = 0;

  // Fix recipes with known URL mappings
  for (const [titleKey, correctUrl] of Object.entries(URL_FIXES)) {
    // Find recipe by title (case-insensitive)
    const match = allRecipes.find(({ recipe }) =>
      recipe.title && recipe.title.toLowerCase().trim() === titleKey.toLowerCase().trim()
    );

    if (!match) {
      console.log(`✗ Not found: "${titleKey}"`);
      notFoundCount++;
      continue;
    }

    const { key, recipe } = match;
    const currentUrl = recipe.sourceUrl || '';

    // Check if URL already correct
    if (currentUrl.replace(/\/?$/, '/') === correctUrl) {
      console.log(`✓ Already correct: "${recipe.title}"`);
      alreadyCorrectCount++;
      continue;
    }

    console.log(`\nFixing: "${recipe.title}"`);
    console.log(`  Key: ${key}`);
    console.log(`  Old URL: ${currentUrl}`);
    console.log(`  New URL: ${correctUrl}`);

    // Update the recipe
    recipe.sourceUrl = correctUrl;
    recipe.updatedAt = new Date().toISOString();

    try {
      putRecipeValue(key, recipe);
      console.log(`  ✓ Updated successfully`);
      fixedCount++;
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  // Handle the garbage title recipe
  const garbageMatch = allRecipes.find(({ recipe }) =>
    recipe.title && recipe.title.startsWith(GARBAGE_TITLE_FIX.titleMatch)
  );

  if (garbageMatch) {
    const { key, recipe } = garbageMatch;
    console.log(`\nFixing garbage title recipe:`);
    console.log(`  Key: ${key}`);
    console.log(`  Old title: "${recipe.title}"`);
    console.log(`  New title: "${GARBAGE_TITLE_FIX.newTitle}"`);
    console.log(`  New URL: ${GARBAGE_TITLE_FIX.url}`);

    recipe.title = GARBAGE_TITLE_FIX.newTitle;
    recipe.sourceUrl = GARBAGE_TITLE_FIX.url;
    recipe.updatedAt = new Date().toISOString();

    try {
      putRecipeValue(key, recipe);
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
