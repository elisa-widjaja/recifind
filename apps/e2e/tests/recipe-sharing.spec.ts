import { test, expect } from '@playwright/test';
import { getAuthToken, getUserId, deleteRecipeByTitle } from '../helpers/api';
import { sel, navigateToRecipesMobile } from '../helpers/selectors';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const BOB_STATE = path.join(__dirname, '../.auth/bob.json');
const API_BASE = process.env.API_BASE!;

test.describe('Recipe Sharing', () => {
  let createdRecipeTitle = '';

  test.afterEach(async () => {
    if (createdRecipeTitle) {
      const token = await getAuthToken(ALICE_STATE);
      await deleteRecipeByTitle(token, createdRecipeTitle);
      createdRecipeTitle = '';
    }
  });

  test('share button is visible on recipe card', async ({ page }) => {
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
    await navigateToRecipesMobile(page);
    // Wait for the recipe card to appear before checking the share button
    await expect(page.getByText(createdRecipeTitle).first()).toBeVisible({ timeout: 10_000 });

    // The Share recipe button is an IconButton on the card (aria-label="Share recipe")
    const card = page.getByRole('button').filter({ hasText: createdRecipeTitle });
    const shareBtn = card.getByLabel('Share recipe');
    await expect(shareBtn).toBeVisible();
  });

  test('open shared recipe as logged-out user', async ({ page, browser, baseURL }) => {
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
    const shareToken = shareData.token ?? shareData.shareToken ?? shareData.share_token;
    expect(shareToken).toBeTruthy();

    // Open in a fresh logged-out browser context
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${baseURL}/?share=${shareToken}`);

    await expect(anonPage.getByText(createdRecipeTitle).first()).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText('garlic', { exact: true })).toBeVisible();

    await anonContext.close();
  });

  test('logged-out shared link (?recipe=&user=) opens recipe detail + app drawer', async ({ browser, baseURL }) => {
    createdRecipeTitle = '[TEST] Shared Drawer';
    const token = await getAuthToken(ALICE_STATE);
    const ownerId = await getUserId(ALICE_STATE);
    const res = await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: createdRecipeTitle,
        sourceUrl: 'https://example.com/shared-drawer',
        mealTypes: [],
        ingredients: ['basil'],
        steps: ['Chop basil'],
      }),
    });
    const { recipe } = await res.json() as { recipe: { id: string } };

    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${baseURL}/?recipe=${recipe.id}&user=${ownerId}`);

    // Recipe detail resolves on web (no app needed).
    await expect(anonPage.getByText(createdRecipeTitle).first()).toBeVisible({ timeout: 10_000 });
    // ~1s after the detail renders, the "See this in ReciFriend" app/browser
    // drawer pops over it (iOS Safari UA, fresh context = no opt-out flags).
    await expect(anonPage.getByText('ReciFriend app')).toBeVisible({ timeout: 6_000 });

    await anonContext.close();
  });

  test('saved-state by source_url: Save shows checkmark, deleting the copy reverts it', async ({ page, context }) => {
    // Bob owns a public recipe; Alice opens it via a shared link.
    const bobToken = await getAuthToken(BOB_STATE);
    const bobId = await getUserId(BOB_STATE);
    const aliceToken = await getAuthToken(ALICE_STATE);
    const title = `[TEST] SaveState ${Date.now()}`;
    const sourceUrl = `https://example.com/savestate-${Date.now()}`;
    createdRecipeTitle = ''; // cleaned explicitly below (two users involved)

    const res = await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, sourceUrl, mealTypes: [], ingredients: ['thyme'], steps: ['Add thyme'] }),
    });
    const { recipe: bobRecipe } = await res.json() as { recipe: { id: string } };
    const sharedUrl = `/?recipe=${bobRecipe.id}&user=${bobId}`;

    try {
      // As Alice (alice storageState), open Bob's recipe via the shared link.
      await page.goto(sharedUrl);
      const detail = sel.recipeDetailDialog(page);
      await expect(detail).toBeVisible({ timeout: 10_000 });
      // Not in Alice's collection yet → actionable "Save".
      await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

      await detail.getByRole('button', { name: 'Save', exact: true }).click();

      // Reopen the shared link — same source_url is now in Alice's
      // collection, so the button reads "Saved".
      await page.goto(sharedUrl);
      await expect(detail).toBeVisible({ timeout: 10_000 });
      await expect(detail.getByRole('button', { name: 'Saved', exact: true })).toBeVisible({ timeout: 10_000 });

      // Delete Alice's saved copy → reopening reverts to "Save".
      await deleteRecipeByTitle(aliceToken, title.replace('[TEST] ', ''));
      await page.goto(sharedUrl);
      await expect(detail).toBeVisible({ timeout: 10_000 });
      await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteRecipeByTitle(bobToken, title.replace('[TEST] ', ''));
      await deleteRecipeByTitle(aliceToken, title.replace('[TEST] ', ''));
    }
  });
});
