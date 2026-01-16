#!/usr/bin/env node
import { argv, exit } from 'node:process';

function extractMetaTags(html) {
  const metas = [];
  const metaRegex = /<meta\s+([^>]+?)>/gi;
  let match;
  while ((match = metaRegex.exec(html))) {
    const attrs = match[1];
    const nameMatch = attrs.match(/(?:name|property|itemprop)=['"]([^'"]+)['"]/i);
    const contentMatch = attrs.match(/content=['"]([^'"]*)['"]/i);
    if (nameMatch && contentMatch) {
      metas.push({ name: nameMatch[1], content: contentMatch[1] });
    }
  }
  return metas;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const url = argv[2];
  if (!url) {
    console.error('Usage: node scripts/testParseLdJson.js <url>');
    exit(1);
  }
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RecipeParser/1.0)'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();

  // Title
  const pageTitle = extractTitle(html);
  console.log('Page <title>:', pageTitle || '(none)');

  // Meta tags
  const metas = extractMetaTags(html);
  if (metas.length) {
    console.log('\nMeta tags (name/property => content):');
    metas
      .filter((meta) => /(title|description|og:|twitter:|keywords|recipe)/i.test(meta.name))
      .forEach((meta) => {
        console.log(` - ${meta.name}: ${meta.content}`);
      });
  }

  // ld+json scripts
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (matches.length) {
    matches.forEach((match, index) => {
      const raw = match[1].trim();
      console.log(`\n--- ld+json Script ${index + 1} ---`);
      try {
        const cleaned = raw
          .replace(/<\!\-\-[\s\S]*?\-\->/g, '')
          .replace(/^[\s]*\/\*[\s\S]*?\*\//g, '')
          .trim();
        const json = JSON.parse(cleaned);
        console.dir(json, { depth: null, colors: true });
      } catch (error) {
        console.error('Failed to parse JSON:', error.message);
        console.log(raw.slice(0, 1000));
      }
    });
  } else {
    console.log('\nNo ld+json scripts found.');
  }

  // Body text excerpt
  const text = stripTags(html);
  const preview = text.slice(0, 2000);
  console.log('\n--- Text preview (first 2000 chars) ---');
  console.log(preview);
}

main().catch((error) => {
  console.error('Error:', error.message);
  exit(1);
});
