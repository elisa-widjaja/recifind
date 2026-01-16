#!/usr/bin/env node
/**
 * Fetch preview images from each recipe's source URL, cache them locally,
 * and rewrite the recipe JSON to point at the cached copies.
 *
 * Usage:
 *   node scripts/cacheSourcePreviewImages.js [options]
 *
 * Options:
 *   --recipes-file=<path>   Path to recipes JSON (default: recipes.json)
 *   --output-file=<path>    Where to write updated JSON (default: overwrite recipes file)
 *   --image-dir=<path>      Directory to store cached images (default: public/images/recipes)
 *   --skip-existing         Reuse existing cached files instead of redownloading
 *   --dry-run               Describe actions without writing files
 */

/* eslint-disable no-console */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_RECIPES_PATH = path.resolve('recipes.json');
const DEFAULT_OUTPUT_PATH = DEFAULT_RECIPES_PATH;
const DEFAULT_IMAGE_DIR = path.resolve('public/images/recipes');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/118.0 Safari/537.36';
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const META_CANDIDATES = [
  { attr: 'property', value: 'og:image:secure_url' },
  { attr: 'property', value: 'og:image:url' },
  { attr: 'property', value: 'og:image' },
  { attr: 'name', value: 'og:image' },
  { attr: 'property', value: 'twitter:image' },
  { attr: 'name', value: 'twitter:image' },
  { attr: 'property', value: 'twitter:image:src' },
  { attr: 'name', value: 'twitter:image:src' },
  { attr: 'itemprop', value: 'image' },
  { attr: 'name', value: 'thumbnail' }
];

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
        'Usage: node scripts/cacheSourcePreviewImages.js [options]\n' +
          'Options:\n' +
          '  --recipes-file=<path>   Path to recipes JSON (default: recipes.json)\n' +
          '  --output-file=<path>    Where to write updated JSON (default: overwrite recipes file)\n' +
          '  --image-dir=<path>      Directory for cached images (default: public/images/recipes)\n' +
          '  --skip-existing         Reuse existing cached files instead of redownloading\n' +
          '  --dry-run               Describe actions without writing files\n'
      );
      process.exit(0);
    }
  });

  return options;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function slugify(value) {
  const lower = value.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (slug) {
    return slug.slice(0, 60);
  }
  return `recipe-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)}`;
}

function guessExtension(url, contentType) {
  try {
    const parsed = new URL(url);
    const fromPath = path.extname(parsed.pathname).toLowerCase();
    if (VALID_EXTENSIONS.includes(fromPath)) {
      return fromPath;
    }
  } catch {
    // ignore malformed URLs
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

function toPublicPath(filePath) {
  const publicRoot = path.resolve('public');
  const absolute = path.resolve(filePath);
  if (!absolute.startsWith(publicRoot)) {
    return null;
  }
  return `/${path.relative(publicRoot, absolute).replace(/\\/g, '/')}`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExistingForSlug(imageDir, slug) {
  for (const ext of VALID_EXTENSIONS) {
    const candidate = path.join(imageDir, `${slug}${ext}`);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function fetchText(url, extraHeaders = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      ...extraHeaders
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return { text, finalUrl: response.url };
}

async function fetchBinary(url, referer) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      ...(referer ? { Referer: referer } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || undefined
  };
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMetaContent(tag) {
  const contentMatch = tag.match(/content\s*=\s*(['"])(.*?)\1/i);
  if (!contentMatch) {
    return null;
  }
  return decodeHtmlEntities(contentMatch[2].trim());
}

function extractPreviewUrl(html, baseUrl) {
  const searchSpace = html.slice(0, 200000);

  for (const { attr, value } of META_CANDIDATES) {
    const regex = new RegExp(`<meta[^>]*${attr}\\s*=\\s*(['"])${value}\\1[^>]*>`, 'i');
    const match = regex.exec(searchSpace);
    if (match) {
      const url = extractMetaContent(match[0]);
      if (url) {
        return resolveUrl(url, baseUrl);
      }
    }
  }

  const linkMatch = searchSpace.match(
    /<link[^>]*rel\s*=\s*(['"])(?:image_src|thumbnail)\1[^>]*>/i
  );
  if (linkMatch) {
    const hrefMatch = linkMatch[0].match(/href\s*=\s*(['"])(.*?)\1/i);
    if (hrefMatch) {
      return resolveUrl(decodeHtmlEntities(hrefMatch[2].trim()), baseUrl);
    }
  }

  return null;
}

function resolveUrl(candidate, base) {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

async function resolveInstagramPreview(sourceUrl) {
  const normalized = ensureTrailingSlash(sourceUrl.split('?')[0]);
  const oembedUrl = `https://www.instagram.com/oembed/?omitscript=true&url=${encodeURIComponent(normalized)}`;

  try {
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const thumbnail = (payload.thumbnail_url || '').trim();
    if (thumbnail) {
      return {
        url: thumbnail,
        referer: 'https://www.instagram.com/'
      };
    }
  } catch (error) {
    console.warn(`[warning] Instagram oEmbed failed for ${sourceUrl}: ${error.message}`);
  }

  return null;
}

async function resolvePreviewFromSource(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    parsed = null;
  }

  if (parsed && parsed.hostname.includes('instagram.com')) {
    const instagramPreview = await resolveInstagramPreview(sourceUrl);
    if (instagramPreview) {
      return instagramPreview;
    }
  }

  try {
    const { text, finalUrl } = await fetchText(sourceUrl);
    const previewUrl = extractPreviewUrl(text, finalUrl || sourceUrl);
    if (!previewUrl) {
      return null;
    }
    return {
      url: previewUrl,
      referer: finalUrl || sourceUrl
    };
  } catch (error) {
    console.warn(`[warning] Failed to fetch preview for ${sourceUrl}: ${error.message}`);
    return null;
  }
}

async function cachePreviews(recipes, options) {
  await ensureDir(options.imageDir);

  let changed = false;
  const slugCounts = new Map();

  for (const recipe of recipes.recipes || []) {
    const sourceUrl = (recipe.sourceUrl || '').trim();
    if (!sourceUrl) {
      continue;
    }

    const title = (recipe.title || 'recipe').trim();
    const baseSlug = slugify(title);
    const count = (slugCounts.get(baseSlug) || 0) + 1;
    slugCounts.set(baseSlug, count);
    const slug = count === 1 ? baseSlug : `${baseSlug}-${count}`;

    if (options.skipExisting) {
      const existing = await findExistingForSlug(options.imageDir, slug);
      if (existing) {
        const mapped = toPublicPath(existing);
        if (mapped && recipe.imageUrl !== mapped) {
          recipe.imageUrl = mapped;
          changed = true;
        }
        continue;
      }
    }

    const candidates = [];
    const preview = await resolvePreviewFromSource(sourceUrl);
    if (preview) {
      candidates.push({
        url: preview.url,
        label: 'source preview',
        referer: preview.referer
      });
    }
    const existingUrl = (recipe.imageUrl || '').trim();
    if (existingUrl && !existingUrl.startsWith('/')) {
      candidates.push({ url: existingUrl, label: 'existing imageUrl', referer: sourceUrl });
    }

    if (candidates.length === 0) {
      continue;
    }

    let savedPath = null;
    for (const candidate of candidates) {
      try {
        if (options.dryRun) {
          console.log(
            `[dry-run] Would download ${candidate.url} (${candidate.label}) -> ${path.join(
              options.imageDir,
              `${slug}<ext>`
            )}`
          );
          savedPath = 'dry-run';
          break;
        }

        const { buffer, contentType } = await fetchBinary(candidate.url, candidate.referer);
        const ext = guessExtension(candidate.url, contentType);
        const targetPath = path.join(options.imageDir, `${slug}${ext}`);
        await fs.writeFile(targetPath, buffer);
        savedPath = targetPath;
        console.log(`Downloaded ${candidate.url} (${candidate.label}) -> ${targetPath}`);
        break;
      } catch (error) {
        console.warn(
          `[warning] Failed to download ${candidate.url} (${candidate.label}): ${error.message}`
        );
      }
    }

    if (!savedPath) {
      continue;
    }

    if (!options.dryRun) {
      const mapped = toPublicPath(savedPath);
      if (mapped) {
        recipe.imageUrl = mapped;
      } else {
        recipe.imageUrl = savedPath;
      }
    }
    changed = true;
  }

  return changed;
}

async function main() {
  const options = parseArgs(process.argv);

  if (typeof fetch !== 'function') {
    console.error('[error] This script requires Node.js 18 or newer (global fetch API).');
    return 1;
  }

  try {
    const recipes = await loadJson(options.recipesFile);
    const changed = await cachePreviews(recipes, options);

    if (options.dryRun) {
      return 0;
    }

    if (changed) {
      const serialized = `${JSON.stringify(recipes, null, 2)}\n`;
      await fs.writeFile(options.outputFile, serialized, 'utf8');
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
