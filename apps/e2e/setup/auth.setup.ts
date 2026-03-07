import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.join(__dirname, '..', '.auth');

setup.describe('auth setup', () => {
  setup.beforeAll(() => {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  });

  setup('authenticate Alice', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('http://localhost:5173');
    console.log('\n=== LOG IN AS ALICE (account 1) ===');
    console.log('Click "Sign in with Google" and complete login in the browser.');
    console.log('When you are logged in and see your recipes, press Resume in Playwright Inspector.\n');
    await page.pause();
    await expect(page.getByRole('button', { name: 'Add Recipe' })).toBeVisible({ timeout: 15_000 });
    await page.context().storageState({ path: path.join(AUTH_DIR, 'alice.json') });
    console.log('Alice session saved to .auth/alice.json');
  });

  setup('authenticate Bob', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('http://localhost:5173');
    console.log('\n=== LOG IN AS BOB (account 2) ===');
    console.log('Click "Sign in with Google" and complete login in the browser.');
    console.log('When you are logged in and see your recipes, press Resume in Playwright Inspector.\n');
    await page.pause();
    await expect(page.getByRole('button', { name: 'Add Recipe' })).toBeVisible({ timeout: 15_000 });
    await page.context().storageState({ path: path.join(AUTH_DIR, 'bob.json') });
    console.log('Bob session saved to .auth/bob.json');
  });
});
