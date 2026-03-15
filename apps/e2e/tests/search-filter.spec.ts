import { test, expect } from '@playwright/test';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import { sel, navigateToRecipesMobile, openMobileDrawer } from '../helpers/selectors';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const API_BASE = process.env.API_BASE!;

const TEST_RECIPES = [
  { title: '[TEST] Chicken Dinner', mealTypes: ['dinner'], ingredients: ['chicken', 'garlic'] },
  { title: '[TEST] Banana Breakfast', mealTypes: ['breakfast'], ingredients: ['banana', 'oats'] },
  { title: '[TEST] Garlic Pasta Lunch', mealTypes: ['lunch'], ingredients: ['pasta', 'garlic'] },
];

test.describe('Search & Filter', () => {
  let token: string;

  test.use({ storageState: ALICE_STATE });

  test.beforeAll(async () => {
    token = await getAuthToken(ALICE_STATE);
    for (const r of TEST_RECIPES) {
      await fetch(`${API_BASE}/recipes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r, sourceUrl: 'https://example.com/test', steps: ['Step 1'] }),
      });
    }
  });

  test.afterAll(async () => {
    for (const r of TEST_RECIPES) {
      await deleteRecipeByTitle(token, r.title);
    }
  });

  // On mobile, meal type chips are in the hamburger drawer.
  // Tapping one selects a filter, closes the drawer, and navigates to recipes view.
  test('filter by meal type shows only matching recipes', async ({ page }) => {
    await page.goto('/');
    // Open hamburger drawer and tap "Dinner" filter chip
    await openMobileDrawer(page);
    await page.getByRole('button', { name: /dinner/i }).click();
    // Drawer auto-closes and navigates to recipes view
    await page.waitForTimeout(1000);

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).not.toBeVisible();

    // Deselect: open drawer again and tap Dinner again
    await openMobileDrawer(page);
    await page.getByRole('button', { name: /dinner/i }).click();
  });

  // Search input is in RecipesPage — navigate there first via drawer
  test('ingredient search filters recipes', async ({ page }) => {
    await page.goto('/');
    await navigateToRecipesMobile(page);
    await page.waitForTimeout(1000);

    const ingredientInput = page.getByPlaceholder('Search by ingredients');
    await ingredientInput.fill('garlic');
    await page.waitForTimeout(500);

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Clear via the clear button
    await page.getByRole('button', { name: 'Clear ingredient search' }).click();
  });

  test('favorites filter shows only saved recipes', async ({ page }) => {
    await page.goto('/');
    await navigateToRecipesMobile(page);
    await page.waitForTimeout(1000);

    // Save Chicken Dinner — card button's accessible name includes the recipe title
    const chickenCard = page.getByRole('button', { name: /\[TEST\] Chicken Dinner/ });
    await chickenCard.getByLabel('Save recipe').click();
    await page.waitForTimeout(500);

    // On mobile, Favorites is in the hamburger drawer
    await openMobileDrawer(page);
    await page.getByText('Favorites').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('[TEST] Chicken Dinner').first()).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).not.toBeVisible();

    // Toggle save off — button may still say "Save recipe" (it toggles)
    await page.getByLabel('Save recipe').first().click();
  });

  test('clearing meal type filter restores full list', async ({ page }) => {
    await page.goto('/');
    // Select dinner filter via drawer
    await openMobileDrawer(page);
    await page.getByRole('button', { name: /dinner/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Deselect dinner via drawer
    await openMobileDrawer(page);
    await page.getByRole('button', { name: /dinner/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('[TEST] Banana Breakfast')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).toBeVisible();
  });
});
