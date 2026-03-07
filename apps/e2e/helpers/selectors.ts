import { Page } from '@playwright/test';

export const sel = {
  addRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Add Recipe' }),
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
};
