import { test, expect } from '@playwright/test';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const API_BASE = 'http://localhost:8787';

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

  // Meal type chips are MUI Chip components (role="button") visible only on sm+ screens.
  // They use MEAL_TYPE_LABELS text e.g. "Dinner", "Breakfast", "Lunch".
  // Clicking toggles selectedMealType; clicking again clears it.
  test('filter by meal type shows only matching recipes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // MUI Chip renders as role="button" with the label text
    await page.getByRole('button', { name: /^dinner$/i }).click();

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).not.toBeVisible();

    // Click again to deselect
    await page.getByRole('button', { name: /^dinner$/i }).click();
  });

  // The ingredient search is a TextField with placeholder="Search by ingredients".
  // It is always visible on the main page (not hidden behind a drawer on desktop).
  // Typing filters recipes to those containing any of the entered ingredients.
  test('ingredient search filters recipes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const ingredientInput = page.getByPlaceholder('Search by ingredients');
    await ingredientInput.fill('garlic');
    // The search filters on input change (no Enter needed), wait a moment
    await page.waitForTimeout(500);

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Clear via the clear button (aria-label="Clear ingredient search")
    await page.getByRole('button', { name: 'Clear ingredient search' }).click();
  });

  // The favorites filter is a MUI Chip with label="Favorites" (role="button").
  // It only appears when favorites.size > 0.
  // Save button aria-label: "Save recipe" / "Unsave recipe" (on the recipe card IconButton).
  test('favorites filter shows only saved recipes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Save Chicken Dinner — locate its card by title text, then find the Save recipe button within
    const chickenCard = page.locator('*').filter({ hasText: '[TEST] Chicken Dinner' }).last();
    await chickenCard.getByRole('button', { name: 'Save recipe' }).click();
    await page.waitForTimeout(500);

    // The "Favorites" Chip appears now that favorites.size > 0
    const favChip = page.getByRole('button', { name: 'Favorites' });
    await expect(favChip).toBeVisible();
    await favChip.click();
    await page.waitForTimeout(500);

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).not.toBeVisible();

    // Unsave and turn off favorites filter
    const chickenCardAgain = page.locator('*').filter({ hasText: '[TEST] Chicken Dinner' }).last();
    await chickenCardAgain.getByRole('button', { name: 'Unsave recipe' }).click();
    await favChip.click();
  });

  test('clearing meal type filter restores full list', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /^dinner$/i }).click();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Click dinner again to deselect
    await page.getByRole('button', { name: /^dinner$/i }).click();

    await expect(page.getByText('[TEST] Banana Breakfast')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).toBeVisible();
  });
});
