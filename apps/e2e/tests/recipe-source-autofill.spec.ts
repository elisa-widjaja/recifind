import { test, expect } from '@playwright/test';
import { sel, navigateToRecipesMobile } from '../helpers/selectors';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');

// Structured content the source URL "yields". /recipes/parse is stubbed so
// the test is deterministic (real parse goes through Gemini — non-
// deterministic, kept as a prod-only smoke instead).
const PARSED = {
  title: '[TEST] Auto Pancakes',
  ingredients: ['2 cups flour', '1 cup milk', '2 eggs'],
  steps: ['Whisk batter', 'Cook on griddle'],
  mealTypes: ['breakfast'],
  durationMinutes: 20,
  imageUrl: 'https://example.com/pancakes.jpg',
};
const SOURCE_URL = 'https://example.com/structured-pancakes';

test.describe('Recipe CRUD — auto-fill from source URL', () => {
  test.afterEach(async () => {
    const token = await getAuthToken(ALICE_STATE);
    await deleteRecipeByTitle(token, 'Auto Pancakes');
  });

  test('structured source auto-fills the form and saves on the first attempt', async ({ page }) => {
    // Stub the parse endpoint with structured content.
    await page.route('**/recipes/parse', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ parsed: PARSED }),
      });
    });

    await page.goto('/');
    await navigateToRecipesMobile(page);
    await sel.addRecipeBtn(page).click();
    const dialog = sel.recipeDialog(page);
    await expect(dialog).toBeVisible();

    // Entering the source URL triggers auto-fill.
    await sel.sourceUrlField(page).fill(SOURCE_URL);

    // Auto-fill populated the title from the parsed structured content.
    await expect(sel.titleField(page)).toHaveValue(PARSED.title, { timeout: 10_000 });

    // Save — must succeed on the FIRST attempt (regression guard, not a bug).
    await sel.saveRecipeBtn(page).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(PARSED.title).first()).toBeVisible({ timeout: 10_000 });

    // Open the saved recipe — title, ingredients, steps and source persisted.
    await page.getByText(PARSED.title).first().click();
    const detail = sel.recipeDetailDialog(page);
    await expect(detail).toBeVisible();
    await expect(detail.getByText(PARSED.title)).toBeVisible();
    await expect(detail.getByText('2 cups flour', { exact: true })).toBeVisible();
    await expect(detail.getByText('Whisk batter', { exact: true })).toBeVisible();
    // Thumbnail rendered from the parsed imageUrl.
    await expect(detail.locator(`img[src="${PARSED.imageUrl}"]`).first()).toBeVisible();
  });
});
