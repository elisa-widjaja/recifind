import { test, expect } from '@playwright/test';
import { sel, navigateToRecipesMobile } from '../helpers/selectors';
import { getAuthToken, deleteRecipeByTitle, deleteRecipeById } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const API_BASE = process.env.API_BASE!;

test.describe('Recipe CRUD', () => {
  let createdRecipeTitle = '';

  test.afterEach(async () => {
    if (createdRecipeTitle) {
      const token = await getAuthToken(ALICE_STATE);
      await deleteRecipeByTitle(token, createdRecipeTitle);
      createdRecipeTitle = '';
    }
  });

  test('add recipe manually', async ({ page }) => {
    createdRecipeTitle = '[TEST] Scrambled Eggs';
    await page.goto('/');

    // On mobile, navigate to recipes view, then click Add Recipe
    await navigateToRecipesMobile(page);
    await sel.addRecipeBtn(page).click();
    const dialog = sel.recipeDialog(page);
    await expect(dialog).toBeVisible();

    await sel.sourceUrlField(page).fill('https://example.com/scrambled-eggs');
    await sel.titleField(page).fill(createdRecipeTitle);
    await sel.saveRecipeBtn(page).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(createdRecipeTitle).first()).toBeVisible({ timeout: 10_000 });
  });

  test('view recipe detail', async ({ page }) => {
    createdRecipeTitle = '[TEST] Pasta Carbonara View';
    const token = await getAuthToken(ALICE_STATE);
    const res = await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: createdRecipeTitle,
        sourceUrl: 'https://example.com/carbonara',
        mealTypes: ['dinner'],
        ingredients: ['pasta', 'eggs'],
        steps: ['Cook pasta', 'Mix eggs'],
      }),
    });
    expect(res.ok).toBeTruthy();

    await page.goto('/');
    await navigateToRecipesMobile(page);
    await page.waitForTimeout(1000);
    await page.getByText(createdRecipeTitle).first().click();

    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(createdRecipeTitle)).toBeVisible();
    await expect(detail.getByText('pasta', { exact: true })).toBeVisible();
  });

  test('edit recipe title', async ({ page }) => {
    createdRecipeTitle = '[TEST] Edit Me - Updated';
    const originalTitle = '[TEST] Edit Me';
    const token = await getAuthToken(ALICE_STATE);
    await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: originalTitle,
        sourceUrl: 'https://example.com/edit',
        mealTypes: [],
        ingredients: [],
        steps: [],
      }),
    });

    await page.goto('/');
    await navigateToRecipesMobile(page);
    await page.waitForTimeout(1000);
    await page.getByText(originalTitle).first().click();

    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();

    await sel.recipeOptionsBtn(page).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const titleInput = detail.getByLabel('Title');
    await titleInput.clear();
    await titleInput.fill(createdRecipeTitle);
    await detail.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(createdRecipeTitle).first()).toBeVisible({ timeout: 10_000 });
  });

  test('delete recipe', async ({ page }) => {
    const titleToDelete = `[TEST] Delete Me ${Date.now()}`;
    createdRecipeTitle = ''; // deleted in test, skip afterEach
    const token = await getAuthToken(ALICE_STATE);
    await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: titleToDelete,
        sourceUrl: 'https://example.com/delete',
        mealTypes: [],
        ingredients: [],
        steps: [],
      }),
    });

    await page.goto('/');
    await navigateToRecipesMobile(page);
    await page.waitForTimeout(1000);
    await page.getByText(titleToDelete).first().click();

    await sel.recipeOptionsBtn(page).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    const confirmDialog = sel.deleteConfirmDialog(page);
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    // Wait for both dialogs to close, then verify the recipe card is gone
    await expect(page.getByTestId('delete-confirm-dialog')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('recipe-detail-dialog')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(titleToDelete)).toHaveCount(0, { timeout: 10_000 });
  });
});
