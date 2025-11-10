#!/usr/bin/env node
/**
 * Cache recipe images locally and rewrite their URLs.
 *
 * Usage:
 *   node scripts/cacheRecipeImages.js [options]
 *
 * Options:
 *   --recipes-file=<path>   Path to recipes JSON (default: recipes.json)
 *   --output-file=<path>    Write updated JSON here (default: overwrite recipes file)
 *   --image-dir=<path>      Directory for cached images (default: public/images/recipes)
 *   --skip-existing         Reuse existing files instead of redownloading
 *   --dry-run               Describe actions without changing files
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { request } = require('https');

const DEFAULT_RECIPES_PATH = path.resolve('recipes.json');
const DEFAULT_OUTPUT_PATH = DEFAULT_RECIPES_PATH;
const DEFAULT_IMAGE_DIR = path.resolve('public/images/recipes');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/118.0 Safari/537.36';
const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function parseArgs(argv) {
  const options = {
    recipesFile: DEFAULT_RECIPES_PATH,
    outputFile: DEFAULT_OUTPUT_PATH,
    imageDir: DEFAULT_IMAGE_DIR,
    skipExisting: false,
    dryRun: false
  };

  argv.slice(2).forEach((arg) => {
    if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--recipes-file=')) {
      options.recipesFile = path.resolve(arg.split('=')[1]);
    } else if (arg.startsWith('--output-file=')) {
      options.outputFile = path.resolve(arg.split('=')[1]);
    } else if (arg.startsWith('--image-dir=')) {
      options.imageDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/cacheRecipeImages.js [options]\n' +
          'Options:\n' +
          '  --recipes-file=<path>   Path to recipes JSON (default: recipes.json)\n' +
          '  --output-file=<path>    Write updated JSON here (default: overwrite recipes file)\n' +
          '  --image-dir=<path>      Directory for cached images (default: public/images/recipes)\n' +
          '  --skip-existing         Reuse existing files instead of redownloading\n' +
          '  --dry-run               Describe actions without changing files\n'
      );
      process.exit(0);
    }
  });

  return options;
}

async function loadRecipes(recipesPath) {
  const raw = await fs.readFile(recipesPath, 'utf8');
  return JSON.parse(raw);
}

function slugify(value) {
  const lower = value.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (slug) {
    return slug.slice(0, 60);
  }
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
  return `recipe-${hash}`;
}

function guessExtension(url, contentType) {
  const parsed = new URL(url);
  const fromPath = path.extname(parsed.pathname).toLowerCase();
  if (VALID_EXTENSIONS.has(fromPath)) {
    return fromPath;
  }

  if (contentType) {
    const baseType = contentType.split(';')[0].trim();
    const lookup = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp'
    };
    if (lookup[baseType]) {
      return lookup[baseType];
    }
  }

  return '.jpg';
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => {
          resolve({
            buffer: Buffer.concat(data),
            contentType: res.headers['content-type'] || null
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function toPublicPath(filePath) {
  const publicRoot = path.resolve('public');
  const absolute = path.resolve(filePath);
  if (!absolute.startsWith(publicRoot)) {
    return null;
  }
  return `/${path.relative(publicRoot, absolute).replace(/\\/g, '/')}`;
}

async function cacheImages(recipes, options) {
  await ensureDir(options.imageDir);

  let changed = false;
  const slugCounts = new Map();

  for (const recipe of recipes.recipes || []) {
    const originalUrl = (recipe.imageUrl || '').trim();
    const title = (recipe.title || 'recipe').trim();

    if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('/')) {
      continue;
    }

    const baseSlug = slugify(title);
    const count = (slugCounts.get(baseSlug) || 0) + 1;
    slugCounts.set(baseSlug, count);
    const slug = count === 1 ? baseSlug : `${baseSlug}-${count}`;

    const preliminaryExt = guessExtension(originalUrl, null);
    const targetPath = path.join(options.imageDir, `${slug}${preliminaryExt}`);
    const publicPath = toPublicPath(targetPath);

    if (options.skipExisting && publicPath && (await fileExists(targetPath))) {
      if (recipe.imageUrl !== publicPath) {
        recipe.imageUrl = publicPath;
        changed = true;
      }
      continue;
    }

    if (options.dryRun) {
      console.log(`[dry-run] Would download ${originalUrl} -> ${targetPath}`);
      continue;
    }

    try {
      const { buffer, contentType } = await downloadImage(originalUrl);
      const finalExt = guessExtension(originalUrl, contentType);
      const finalPath = path.join(options.imageDir, `${slug}${finalExt}`);
      await fs.writeFile(finalPath, buffer);
      const finalPublic = toPublicPath(finalPath);
      if (finalPublic) {
        recipe.imageUrl = finalPublic;
      } else {
        recipe.imageUrl = finalPath;
      }
      changed = true;
      console.log(`Downloaded ${originalUrl} -> ${finalPath}`);
    } catch (error) {
      console.warn(`[warning] Failed to cache ${originalUrl}: ${error.message}`);
    }
  }

  return changed;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv);

  try {
    const recipes = await loadRecipes(options.recipesFile);
    const changed = await cacheImages(recipes, options);

    if (options.dryRun) {
      return 0;
    }

    if (changed) {
      const data = `${JSON.stringify(recipes, null, 2)}\n`;
      await fs.writeFile(options.outputFile, data, 'utf8');
      console.log(`Wrote updated recipes to ${options.outputFile}`);
    } else {
      console.log('No changes made.');
    }
  } catch (error) {
    console.error(`[error] ${error.message}`);
    return 1;
  }

  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error('[error]', error);
    process.exit(1);
  }
);
