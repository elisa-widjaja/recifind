import { Page } from '@playwright/test';

export const sel = {
  addRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Add Recipe' }),
  saveRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Save recipe' }),
  recipeDialog: (page: Page) => page.getByRole('dialog', { name: /add recipe/i }),
  recipeOptionsBtn: (page: Page) => page.getByRole('button', { name: 'Recipe options' }),
  closeRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Close recipe details' }).first(),
  deleteConfirmDialog: (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /delete/i }) }),
  friendsBtn: (page: Page) => page.getByRole('button', { name: /friends/i }),
  filterBtn: (page: Page) => page.getByRole('button', { name: 'Open filters' }),
  shareBtn: (page: Page) => page.getByRole('button', { name: 'Share recipe' }),
  sourceUrlField: (page: Page) => page.getByLabel('Source URL'),
  titleField: (page: Page) => page.getByLabel('Title'),
};
