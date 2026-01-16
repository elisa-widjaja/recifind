#!/usr/bin/env node
/**
 * Usage:
 *   IG_USERNAME="..." IG_PASSWORD="..." node scripts/fetchInstagramReel.js <reelUrl>
 *
 * Requires Playwright (install via `npm install --save-dev playwright` && `npx playwright install chromium`).
 */
import { argv, exit } from 'node:process';
import { chromium } from 'playwright';

async function login(page) {
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;
  if (!username || !password) {
    throw new Error('Set IG_USERNAME and IG_PASSWORD environment variables.');
  }

  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);
}

async function fetchReelContent(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for captions/descriptions to load.
    await page.waitForTimeout(3000);

    const captionText = await page.$$eval('span[dir="auto"]', (nodes) =>
      nodes.map((node) => node.textContent?.trim()).filter(Boolean)
    );
    const heading = await page.$$eval('h1, h2, h3', (nodes) =>
      nodes.map((node) => node.textContent?.trim()).filter(Boolean)
    );

    const data = {
      url,
      heading,
      captionText
    };
    console.log(JSON.stringify(data, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const targetUrl = argv[2];
  if (!targetUrl) {
    console.error('Usage: node scripts/fetchInstagramReel.js <reelUrl>');
    exit(1);
  }
  await fetchReelContent(targetUrl);
}

main().catch((error) => {
  console.error('Error:', error);
  exit(1);
});
