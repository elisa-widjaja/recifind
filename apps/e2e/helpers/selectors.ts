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
  bottomNavRecipes: (page: Page) => page.getByRole('button', { name: 'Recipes', exact: true }),
  bottomNavFriends: (page: Page) => page.getByRole('button', { name: 'Friends', exact: true }),
  bottomNavProfile: (page: Page) => page.getByRole('button', { name: 'Profile', exact: true }),
  // Filters drawer on the Recipes view (toggled by a button on the page itself).
  filtersBtn: (page: Page) => page.getByRole('button', { name: /filter/i }),
};

/**
 * Navigate to the Recipes view on mobile by tapping the bottom-nav "Recipes" tab.
 * (The old hamburger drawer + "View recipes" stats-tile button were both
 * superseded by the bottom-nav redesign.)
 */
export async function navigateToRecipesMobile(page: Page) {
  await sel.bottomNavRecipes(page).click();
  await page.waitForTimeout(400);
}

/**
 * Navigate to the Friends page on mobile by tapping the bottom-nav "Friends" tab.
 */
export async function navigateToFriendsMobile(page: Page) {
  await sel.bottomNavFriends(page).click();
  await page.waitForTimeout(400);
}

/**
 * Filters/search drawer on the Recipes view. Old hamburger entry-point is gone;
 * the Recipes view now has its own filter button.
 */
export async function openMobileDrawer(page: Page) {
  await sel.filtersBtn(page).click();
}
