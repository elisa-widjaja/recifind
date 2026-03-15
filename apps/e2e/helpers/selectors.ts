import { Page } from '@playwright/test';

export const sel = {
  addRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Add Recipe' }).first(),
  saveRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Save recipe' }),
  recipeDialog: (page: Page) => page.getByTestId('add-recipe-dialog'),
  recipeDetailDialog: (page: Page) => page.getByTestId('recipe-detail-dialog'),
  recipeOptionsBtn: (page: Page) => page.getByRole('button', { name: 'Recipe options' }),
  closeRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Close recipe details' }).first(),
  deleteConfirmDialog: (page: Page) => page.getByTestId('delete-confirm-dialog'),
  friendsDrawer: (page: Page) => page.getByTestId('friends-drawer'),
  filterBtn: (page: Page) => page.getByRole('button', { name: 'Open filters' }),
  shareBtn: (page: Page) => page.getByRole('button', { name: 'Share recipe' }),
  sourceUrlField: (page: Page) => page.getByLabel('Source URL'),
  titleField: (page: Page) => page.getByLabel('Title'),
  hamburgerBtn: (page: Page) => page.getByRole('button', { name: 'Open menu' }),
};

/**
 * Navigate to the Recipes view on mobile by opening the hamburger drawer
 * and tapping the "Recipes" button.
 */
export async function navigateToRecipesMobile(page: Page) {
  // The home view has a "View recipes" button in the stats tiles
  await page.getByRole('button', { name: 'View recipes' }).click();
  // Wait for recipes view to render
  await page.waitForTimeout(500);
}

/**
 * Open the meal type filter drawer on mobile. Filters and search
 * are inside the hamburger drawer on mobile viewports.
 */
export async function openMobileDrawer(page: Page) {
  await sel.hamburgerBtn(page).click();
}
