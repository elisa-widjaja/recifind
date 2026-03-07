import { test, expect } from '@playwright/test';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import { sel } from '../helpers/selectors';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const API_BASE = 'http://localhost:8787';

test.describe('Recipe Sharing', () => {
  let createdRecipeTitle = '';

  test.afterEach(async () => {
    if (createdRecipeTitle) {
      const token = await getAuthToken(ALICE_STATE);
      await deleteRecipeByTitle(token, createdRecipeTitle);
      createdRecipeTitle = '';
    }
  });

  test('share button is visible on recipe detail', async ({ page }) => {
    createdRecipeTitle = '[TEST] Share Button Test';
    const token = await getAuthToken(ALICE_STATE);
    await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: createdRecipeTitle,
        sourceUrl: 'https://example.com/share-btn',
        mealTypes: [],
        ingredients: ['garlic'],
        steps: ['Chop garlic'],
      }),
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.getByText(createdRecipeTitle).first().click();

    const shareBtn = sel.shareBtn(page);
    await expect(shareBtn).toBeVisible();
  });

  test('open shared recipe as logged-out user', async ({ page, browser }) => {
    createdRecipeTitle = '[TEST] Public Share';
    const token = await getAuthToken(ALICE_STATE);

    // Create recipe
    const res = await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: createdRecipeTitle,
        sourceUrl: 'https://example.com/public-share',
        mealTypes: [],
        ingredients: ['garlic'],
        steps: ['Chop garlic'],
      }),
    });
    const data = await res.json() as { recipe: { id: string } };
    const recipeId = data.recipe.id;

    // Generate share token via API
    const shareRes = await fetch(`${API_BASE}/recipes/${recipeId}/share`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const shareData = await shareRes.json() as Record<string, string>;
    // Worker returns { token: "..." } — fallback chain handles field name variations
    const shareToken = shareData.token ?? shareData.shareToken ?? shareData.share_token;
    expect(shareToken).toBeTruthy();

    // Open in a fresh logged-out browser context
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`http://localhost:5173/?share=${shareToken}`);

    await expect(anonPage.getByText(createdRecipeTitle)).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText('garlic')).toBeVisible();

    await anonContext.close();
  });
});
