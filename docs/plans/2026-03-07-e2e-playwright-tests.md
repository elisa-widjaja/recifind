# E2E Playwright Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Playwright E2E test suite covering Recipe CRUD, sharing, friends, and search/filter flows to catch regressions before deploy.

**Architecture:** Two Playwright projects (`alice`, `bob`) each with a real Supabase `storageState` session. Tests run against local dev servers (`localhost:5173` + `localhost:8787`). API cleanup via `DEV_API_KEY` after each test. Suite lives in `apps/e2e/` as its own package.

**Tech Stack:** Playwright, TypeScript, Supabase (real Google OAuth sessions), Cloudflare Worker API

---

## Prerequisites (read before starting)

- Both Vite dev server (`cd apps/recipe-ui && npm run dev`) and Worker dev server (`cd apps/worker && npx wrangler dev`) must be running when tests execute
- Two real Google accounts are needed: Alice (primary tester) and Bob (friend flow partner)
- `DEV_API_KEY` is in `apps/recipe-ui/.env.local` as `VITE_RECIPES_API_TOKEN`
- The Worker's `DEV_API_KEY` secret must match that value — check `apps/worker/wrangler.toml` or ask the user

---

## Task 1: Scaffold `apps/e2e/` package

**Files:**
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/tsconfig.json`
- Create: `apps/e2e/.gitignore`

**Step 1: Create `apps/e2e/package.json`**

```json
{
  "name": "recifind-e2e",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:setup": "playwright test --project=setup",
    "test:ui": "playwright test --ui",
    "test:recipe-crud": "playwright test tests/recipe-crud.spec.ts",
    "test:sharing": "playwright test tests/recipe-sharing.spec.ts",
    "test:friends": "playwright test tests/friends.spec.ts",
    "test:search": "playwright test tests/search-filter.spec.ts"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "typescript": "^5.4.5"
  }
}
```

**Step 2: Create `apps/e2e/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["**/*.ts"]
}
```

**Step 3: Create `apps/e2e/.gitignore`**

```
.auth/
test-results/
playwright-report/
node_modules/
dist/
```

**Step 4: Install dependencies**

```bash
cd apps/e2e && npm install
npx playwright install chromium
```

Expected: Playwright + Chromium installed.

**Step 5: Commit**

```bash
git add apps/e2e/package.json apps/e2e/tsconfig.json apps/e2e/.gitignore
git commit -m "chore: scaffold apps/e2e Playwright package"
```

---

## Task 2: Playwright config

**Files:**
- Create: `apps/e2e/playwright.config.ts`

**Step 1: Create the config**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // friend flow needs sequential execution
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // Auth setup — run first, manually
    {
      name: 'setup',
      testMatch: /setup\/auth\.setup\.ts/,
    },
    // Alice: recipe CRUD, sharing, search
    {
      name: 'alice',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testIgnore: /friends\.spec\.ts/,
    },
    // Bob: friend flow (receives requests from Alice)
    {
      name: 'bob',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/bob.json',
      },
      dependencies: [],
      testMatch: /friends\.spec\.ts/,
    },
    // Alice in friend flow too
    {
      name: 'alice-friends',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testMatch: /friends\.spec\.ts/,
    },
  ],
  reporter: [['html', { open: 'never' }], ['list']],
});
```

**Step 2: Commit**

```bash
git add apps/e2e/playwright.config.ts
git commit -m "chore: add Playwright config with alice/bob projects"
```

---

## Task 3: Auth setup script

**Files:**
- Create: `apps/e2e/setup/auth.setup.ts`

**Step 1: Create the setup script**

This script opens a real browser and pauses for manual Google login for each account.

```typescript
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.join(__dirname, '..', '.auth');

setup.describe('auth setup', () => {
  setup.beforeAll(() => {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  });

  setup('authenticate Alice', async ({ page }) => {
    await page.goto('http://localhost:5173');
    console.log('\n=== LOG IN AS ALICE (account 1) ===');
    console.log('Click "Sign in with Google" and complete login in the browser.');
    console.log('When you are logged in and see your recipes, press Enter in this terminal.\n');
    await page.pause(); // Playwright Inspector pauses here — complete login, then click Resume
    await expect(page.getByRole('button', { name: 'Add Recipe' })).toBeVisible({ timeout: 15_000 });
    await page.context().storageState({ path: path.join(AUTH_DIR, 'alice.json') });
    console.log('Alice session saved to .auth/alice.json');
  });

  setup('authenticate Bob', async ({ page }) => {
    await page.goto('http://localhost:5173');
    console.log('\n=== LOG IN AS BOB (account 2) ===');
    console.log('Click "Sign in with Google" and complete login in the browser.');
    console.log('When you are logged in and see your recipes, press Enter in this terminal.\n');
    await page.pause();
    await expect(page.getByRole('button', { name: 'Add Recipe' })).toBeVisible({ timeout: 15_000 });
    await page.context().storageState({ path: path.join(AUTH_DIR, 'bob.json') });
    console.log('Bob session saved to .auth/bob.json');
  });
});
```

**Step 2: Run setup (interactive — requires human)**

```bash
cd apps/e2e && npm run test:setup
```

This opens a Chromium window. Complete Google login for Alice when prompted, click "Resume" in Playwright Inspector. Then repeat for Bob. Sessions are saved to `.auth/`.

Expected: `.auth/alice.json` and `.auth/bob.json` created with valid Supabase session tokens.

**Step 3: Commit (setup script only, not .auth/ files)**

```bash
git add apps/e2e/setup/auth.setup.ts
git commit -m "chore: add auth setup script for alice and bob sessions"
```

---

## Task 4: Shared helpers

**Files:**
- Create: `apps/e2e/helpers/api.ts`
- Create: `apps/e2e/helpers/selectors.ts`

**Step 1: Create `apps/e2e/helpers/api.ts`**

Direct API calls using DEV_API_KEY for test cleanup. The key lives in `apps/recipe-ui/.env.local` as `VITE_RECIPES_API_TOKEN`.

```typescript
const API_BASE = 'http://localhost:8787';
// Must match DEV_API_KEY set in the worker via wrangler secret / local dev
const DEV_KEY = process.env.E2E_DEV_API_KEY || '';

export async function deleteRecipeByTitle(userToken: string, title: string): Promise<void> {
  // List recipes and find by title prefix, then delete
  const listRes = await fetch(`${API_BASE}/recipes`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!listRes.ok) return;
  const data = await listRes.json() as { recipes: Array<{ id: string; title: string }> };
  const matches = data.recipes.filter(r => r.title.startsWith('[TEST]') && r.title.includes(title));
  for (const recipe of matches) {
    await fetch(`${API_BASE}/recipes/${recipe.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }
}

export async function deleteRecipeById(token: string, id: string): Promise<void> {
  await fetch(`${API_BASE}/recipes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function removeFriend(token: string, friendId: string): Promise<void> {
  await fetch(`${API_BASE}/friends/${encodeURIComponent(friendId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getAuthToken(storageStatePath: string): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
  // Supabase stores the session in localStorage under 'recifind-auth'
  const localStorageEntries = state.origins?.[0]?.localStorage ?? [];
  const authEntry = localStorageEntries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!authEntry) throw new Error('No auth token found in storageState');
  const session = JSON.parse(authEntry.value);
  return session?.currentSession?.access_token ?? session?.access_token ?? '';
}
```

**Step 2: Create `apps/e2e/helpers/selectors.ts`**

Centralized selectors so if the UI changes, we update one file.

```typescript
import { Page } from '@playwright/test';

export const sel = {
  addRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Add Recipe' }),
  saveRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Save recipe' }),
  recipeDialog: (page: Page) => page.getByRole('dialog', { name: /add recipe/i }),
  recipeDetailDialog: (page: Page) => page.getByRole('dialog').filter({ hasNot: page.getByRole('heading', { name: /add recipe/i }) }),
  recipeOptionsBtn: (page: Page) => page.getByRole('button', { name: 'Recipe options' }),
  closeRecipeBtn: (page: Page) => page.getByRole('button', { name: 'Close recipe details' }).first(),
  deleteConfirmDialog: (page: Page) => page.getByRole('dialog', { name: /delete/i }),
  friendsBtn: (page: Page) => page.getByRole('button', { name: /friends/i }),
  filterBtn: (page: Page) => page.getByRole('button', { name: 'Open filters' }),
  shareBtn: (page: Page) => page.getByRole('button', { name: 'Share recipe' }),
  sourcUrlField: (page: Page) => page.getByLabel('Source URL'),
  titleField: (page: Page) => page.getByLabel('Title'),
};
```

**Step 3: Commit**

```bash
git add apps/e2e/helpers/api.ts apps/e2e/helpers/selectors.ts
git commit -m "chore: add e2e API helpers and shared selectors"
```

---

## Task 5: Recipe CRUD tests

**Files:**
- Create: `apps/e2e/tests/recipe-crud.spec.ts`

**Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';
import { sel } from '../helpers/selectors';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');

test.describe('Recipe CRUD', () => {
  let createdRecipeTitle: string;

  test.afterEach(async () => {
    if (createdRecipeTitle) {
      const token = await getAuthToken(ALICE_STATE);
      await deleteRecipeByTitle(token, createdRecipeTitle);
    }
  });

  test('add recipe manually', async ({ page }) => {
    createdRecipeTitle = '[TEST] Scrambled Eggs';
    await page.goto('/');
    await sel.addRecipeBtn(page).click();

    const dialog = sel.recipeDialog(page);
    await expect(dialog).toBeVisible();

    await sel.sourcUrlField(page).fill('https://example.com/scrambled-eggs');
    await sel.titleField(page).fill(createdRecipeTitle);
    await sel.saveRecipeBtn(page).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(createdRecipeTitle)).toBeVisible();
  });

  test('view recipe detail', async ({ page }) => {
    // First create via API to ensure it exists
    createdRecipeTitle = '[TEST] Pasta Carbonara View';
    const token = await getAuthToken(ALICE_STATE);
    const res = await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: createdRecipeTitle, sourceUrl: 'https://example.com/carbonara', mealTypes: ['dinner'], ingredients: ['pasta', 'eggs'], steps: ['Cook pasta', 'Mix eggs'] }),
    });
    expect(res.ok).toBeTruthy();

    await page.goto('/');
    await page.reload(); // ensure fresh data
    await page.getByText(createdRecipeTitle).click();

    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(createdRecipeTitle)).toBeVisible();
    await expect(detail.getByText('pasta')).toBeVisible();
  });

  test('edit recipe title', async ({ page }) => {
    createdRecipeTitle = '[TEST] Edit Me';
    const updatedTitle = '[TEST] Edit Me - Updated';
    const token = await getAuthToken(ALICE_STATE);
    await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: createdRecipeTitle, sourceUrl: 'https://example.com/edit', mealTypes: [], ingredients: [], steps: [] }),
    });

    await page.goto('/');
    await page.reload();
    await page.getByText(createdRecipeTitle).click();

    const detail = page.getByRole('dialog');
    await sel.recipeOptionsBtn(page).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const titleInput = detail.getByLabel('Title');
    await titleInput.clear();
    await titleInput.fill(updatedTitle);
    await detail.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(updatedTitle)).toBeVisible();
    createdRecipeTitle = updatedTitle; // for cleanup
  });

  test('delete recipe', async ({ page }) => {
    const titleToDelete = '[TEST] Delete Me';
    createdRecipeTitle = ''; // skip afterEach cleanup, we delete in test
    const token = await getAuthToken(ALICE_STATE);
    await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleToDelete, sourceUrl: 'https://example.com/delete', mealTypes: [], ingredients: [], steps: [] }),
    });

    await page.goto('/');
    await page.reload();
    await page.getByText(titleToDelete).click();

    await sel.recipeOptionsBtn(page).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    const confirmDialog = sel.deleteConfirmDialog(page);
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    await expect(page.getByText(titleToDelete)).not.toBeVisible();
  });
});
```

**Step 2: Run the tests**

Ensure both dev servers are running first (`npm run dev` in recipe-ui, `npx wrangler dev` in worker).

```bash
cd apps/e2e && npx playwright test tests/recipe-crud.spec.ts --project=alice
```

Expected: 4 tests pass (green).

**Step 3: Fix any failures** — common issues:
- Dialog selector too broad → tighten `aria-labelledby` target
- Recipe not appearing after save → add `await page.waitForResponse` on the `/recipes` POST
- Token not found in storageState → check the `recifind-auth` key name matches Supabase client config in App.jsx

**Step 4: Commit**

```bash
git add apps/e2e/tests/recipe-crud.spec.ts
git commit -m "test: add recipe CRUD e2e tests"
```

---

## Task 6: Recipe sharing tests

**Files:**
- Create: `apps/e2e/tests/recipe-sharing.spec.ts`

**Step 1: Write the test file**

```typescript
import { test, expect, chromium } from '@playwright/test';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import { sel } from '../helpers/selectors';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');

test.describe('Recipe Sharing', () => {
  let createdRecipeTitle: string;

  test.afterEach(async () => {
    if (createdRecipeTitle) {
      const token = await getAuthToken(ALICE_STATE);
      await deleteRecipeByTitle(token, createdRecipeTitle);
    }
  });

  test('generate a share link', async ({ page }) => {
    createdRecipeTitle = '[TEST] Share Me';
    const token = await getAuthToken(ALICE_STATE);
    await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: createdRecipeTitle, sourceUrl: 'https://example.com/share', mealTypes: ['dinner'], ingredients: ['rice'], steps: ['Cook rice'] }),
    });

    await page.goto('/');
    await page.reload();
    await page.getByText(createdRecipeTitle).click();

    const shareBtn = sel.shareBtn(page);
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // Verify share link is copied or displayed
    await expect(page.getByText(/copied|share link|trycloudflare|localhost/i)).toBeVisible({ timeout: 5_000 });
  });

  test('open shared recipe as logged-out user', async ({ page, browser }) => {
    createdRecipeTitle = '[TEST] Public Share';
    const token = await getAuthToken(ALICE_STATE);
    const res = await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: createdRecipeTitle, sourceUrl: 'https://example.com/public-share', mealTypes: [], ingredients: ['garlic'], steps: ['Chop garlic'] }),
    });
    const data = await res.json() as { recipe: { id: string } };
    const recipeId = data.recipe.id;

    // Generate share token via API
    const shareRes = await fetch(`http://localhost:8787/recipes/${recipeId}/share`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const shareData = await shareRes.json() as { shareToken?: string; token?: string };
    const shareToken = shareData.shareToken ?? shareData.token;
    expect(shareToken).toBeTruthy();

    // Open in a fresh logged-out browser context
    const anonContext = await browser.newContext(); // no storageState = logged out
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`http://localhost:5173/?share=${shareToken}`);

    await expect(anonPage.getByText(createdRecipeTitle)).toBeVisible({ timeout: 10_000 });
    await expect(anonPage.getByText('garlic')).toBeVisible();

    await anonContext.close();
  });
});
```

**Step 2: Run the tests**

```bash
cd apps/e2e && npx playwright test tests/recipe-sharing.spec.ts --project=alice
```

Expected: 2 tests pass. If share token field name differs from `shareToken`, check the `/recipes/:id/share` API response in `apps/worker/src/index.ts` around line 747.

**Step 3: Commit**

```bash
git add apps/e2e/tests/recipe-sharing.spec.ts
git commit -m "test: add recipe sharing e2e tests"
```

---

## Task 7: Friends flow tests

**Files:**
- Create: `apps/e2e/tests/friends.spec.ts`

**Important:** These tests depend on both Alice and Bob sessions. The friend flow is inherently stateful (Alice sends, Bob accepts). Run with both projects. Clean up after each test.

**Step 1: Write the test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { getAuthToken, removeFriend, deleteRecipeByTitle } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const BOB_STATE = path.join(__dirname, '../.auth/bob.json');

// Helper: get Bob's email from his storageState
async function getBobEmail(): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(BOB_STATE, 'utf-8'));
  const localStorageEntries = state.origins?.[0]?.localStorage ?? [];
  const authEntry = localStorageEntries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!authEntry) throw new Error('No Bob auth entry');
  const session = JSON.parse(authEntry.value);
  return session?.currentSession?.user?.email ?? session?.user?.email ?? '';
}

async function openFriendsDrawer(page: Page) {
  const friendsBtn = page.getByRole('button', { name: /friends/i });
  await friendsBtn.click();
  await expect(page.getByRole('dialog').or(page.getByRole('complementary'))).toBeVisible();
}

test.describe('Friends flow', () => {
  let aliceToken: string;
  let bobToken: string;
  let bobEmail: string;
  let sharedRecipeTitle: string;

  test.beforeAll(async () => {
    aliceToken = await getAuthToken(ALICE_STATE);
    bobToken = await getAuthToken(BOB_STATE);
    bobEmail = await getBobEmail();
  });

  test('Alice sends friend request to Bob', async ({ page }) => {
    await page.goto('/');
    await openFriendsDrawer(page);

    const emailInput = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i));
    await emailInput.fill(bobEmail);
    await page.getByRole('button', { name: /send|invite|add/i }).click();

    await expect(page.getByText(/request sent|pending|invited/i)).toBeVisible({ timeout: 8_000 });
  });

  test('Bob accepts Alice\'s friend request', async ({ page }) => {
    // Bob's page (uses bob storageState via project config)
    await page.goto('/');
    await openFriendsDrawer(page);

    // Look for pending requests tab / section
    const requestsTab = page.getByRole('tab', { name: /request/i });
    if (await requestsTab.isVisible()) await requestsTab.click();

    const acceptBtn = page.getByRole('button', { name: /accept/i });
    await expect(acceptBtn).toBeVisible({ timeout: 8_000 });
    await acceptBtn.click();

    await expect(page.getByText(/connected|friend|accepted/i)).toBeVisible({ timeout: 8_000 });
  });

  test('Alice sees Bob in friends list', async ({ page }) => {
    await page.goto('/');
    await openFriendsDrawer(page);

    await expect(page.getByText(bobEmail.split('@')[0])).toBeVisible({ timeout: 8_000 });
  });

  test('Bob shares a recipe and Alice sees it in friends tab', async ({ page }) => {
    sharedRecipeTitle = '[TEST] Bob Shared Recipe';
    // Create a shared recipe as Bob via API
    await fetch('http://localhost:8787/recipes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: sharedRecipeTitle, sourceUrl: 'https://example.com/bob-recipe', mealTypes: ['lunch'], ingredients: ['tomato'], steps: ['Slice tomato'], sharedWithFriends: true }),
    });

    // Alice views it
    await page.goto('/');
    await openFriendsDrawer(page);

    // Click on Bob in friends list
    await page.getByText(bobEmail.split('@')[0]).click();

    await expect(page.getByText(sharedRecipeTitle)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    // Cleanup: remove friendship from both sides
    try { await removeFriend(aliceToken, (await getBobUserId()).alice); } catch {}
    try { await removeFriend(bobToken, (await getBobUserId()).bob); } catch {}
    // Cleanup Bob's shared test recipe
    if (sharedRecipeTitle) {
      await deleteRecipeByTitle(bobToken, sharedRecipeTitle);
    }
  });
});

// Helper — gets alice userId and bob userId from storageState
async function getBobUserId(): Promise<{ alice: string; bob: string }> {
  const fs = await import('fs');
  function extractUserId(statePath: string): string {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const entries = state.origins?.[0]?.localStorage ?? [];
    const auth = entries.find((e: { name: string }) => e.name === 'recifind-auth');
    if (!auth) return '';
    const session = JSON.parse(auth.value);
    return session?.currentSession?.user?.id ?? session?.user?.id ?? '';
  }
  return { alice: extractUserId(ALICE_STATE), bob: extractUserId(BOB_STATE) };
}
```

**Step 2: Run the tests (Alice project for Alice tests, Bob project for Bob tests)**

Note: The `friends.spec.ts` tests need to run as the correct user. The `alice-friends` project runs Alice's tests, `bob` project runs Bob's tests. Playwright runs them sequentially.

```bash
cd apps/e2e && npx playwright test tests/friends.spec.ts --project=alice-friends
cd apps/e2e && npx playwright test tests/friends.spec.ts --project=bob
```

Or run both together (config handles it): `npx playwright test tests/friends.spec.ts`

**Step 3: Note on friend flow test ordering**

The friend tests are sequential and stateful: Alice sends → Bob accepts → Alice sees Bob. If run in isolation, later tests will fail because the prerequisite (friendship) doesn't exist. This is acceptable for now — run the full `friends.spec.ts` as a suite, not individual tests.

**Step 4: Commit**

```bash
git add apps/e2e/tests/friends.spec.ts
git commit -m "test: add friends e2e flow tests"
```

---

## Task 8: Search & filter tests

**Files:**
- Create: `apps/e2e/tests/search-filter.spec.ts`

**Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';
import { getAuthToken, deleteRecipeByTitle } from '../helpers/api';
import { sel } from '../helpers/selectors';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');

test.describe('Search & Filter', () => {
  let token: string;
  const testRecipes = [
    { title: '[TEST] Chicken Dinner', mealTypes: ['dinner'], ingredients: ['chicken', 'garlic'] },
    { title: '[TEST] Banana Breakfast', mealTypes: ['breakfast'], ingredients: ['banana', 'oats'] },
    { title: '[TEST] Garlic Pasta Lunch', mealTypes: ['lunch'], ingredients: ['pasta', 'garlic'] },
  ];

  test.beforeAll(async () => {
    token = await getAuthToken(ALICE_STATE);
    // Seed test recipes via API
    for (const r of testRecipes) {
      await fetch('http://localhost:8787/recipes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r, sourceUrl: 'https://example.com/test', steps: ['Step 1'] }),
      });
    }
  });

  test.afterAll(async () => {
    for (const r of testRecipes) {
      await deleteRecipeByTitle(token, r.title);
    }
  });

  test('filter by meal type shows only matching recipes', async ({ page }) => {
    await page.goto('/');
    await page.reload();

    // Click Dinner chip / filter
    await page.getByRole('button', { name: /dinner/i }).click();

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).not.toBeVisible();
  });

  test('ingredient search filters recipes', async ({ page }) => {
    await page.goto('/');
    await page.reload();

    // Open filters and search by ingredient
    await sel.filterBtn(page).click();
    const ingredientInput = page.getByPlaceholder(/ingredient/i).or(page.getByLabel(/ingredient/i));
    await ingredientInput.fill('garlic');

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Garlic Pasta Lunch')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();
  });

  test('favorites filter shows only saved recipes', async ({ page }) => {
    await page.goto('/');
    await page.reload();

    // Save one recipe as favorite
    const saveBtn = page.getByText('[TEST] Chicken Dinner')
      .locator('..') // parent card
      .getByRole('button', { name: 'Save recipe' });
    await saveBtn.click();

    // Toggle favorites-only
    const favBtn = page.getByRole('button', { name: /favou?rites?|saved/i });
    await favBtn.click();

    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Unsave for cleanliness
    await page.getByRole('button', { name: /unsave/i }).click();
  });

  test('clearing filters restores full list', async ({ page }) => {
    await page.goto('/');
    await page.reload();

    // Apply a filter
    await page.getByRole('button', { name: /dinner/i }).click();
    await expect(page.getByText('[TEST] Banana Breakfast')).not.toBeVisible();

    // Clear it
    await page.getByRole('button', { name: /dinner/i }).click(); // toggle off
    await expect(page.getByText('[TEST] Banana Breakfast')).toBeVisible();
    await expect(page.getByText('[TEST] Chicken Dinner')).toBeVisible();
  });
});
```

**Step 2: Run the tests**

```bash
cd apps/e2e && npx playwright test tests/search-filter.spec.ts --project=alice
```

Expected: 4 tests pass.

**Step 3: Fix common issues**
- Meal type filter: if clicking "Dinner" doesn't work via `getByRole('button', { name: /dinner/i })`, inspect the actual element — it may be a `ToggleButton` or `Chip`. Adjust selector to `page.getByRole('option')` or `page.locator('[aria-pressed]', { hasText: 'Dinner' })`
- Ingredient input: check the actual `label` or `placeholder` text in App.jsx around the filter drawer

**Step 4: Commit**

```bash
git add apps/e2e/tests/search-filter.spec.ts
git commit -m "test: add search and filter e2e tests"
```

---

## Task 9: Add `data-testid` attributes to App.jsx for brittle selectors

Some UI elements lack good aria labels and need `data-testid` to make tests reliable. Add only where needed after Task 5-8 reveal gaps.

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

**Common additions needed (add as discovered during test runs):**

- Meal type filter chips/buttons → add `data-testid={`meal-type-${type}`}`
- Friends dialog → add `data-testid="friends-dialog"`
- Friend request accept button → add `data-testid="accept-friend-request"`
- Ingredient search input → add `data-testid="ingredient-search"`
- Recipe card → add `data-testid={`recipe-card-${recipe.id}`}`
- Favorites toggle → add `data-testid="favorites-filter"`

Update selectors in `apps/e2e/helpers/selectors.ts` to use `page.getByTestId(...)` for these.

**Step 1: Run all tests once to identify brittle selectors**

```bash
cd apps/e2e && npx playwright test --project=alice
```

Note any failures due to selector mismatches.

**Step 2: Add `data-testid` to App.jsx for each failing selector**

Find the element in App.jsx and add the prop. Example for meal type chip around line 3400+:
```jsx
// Before:
<Chip label={MEAL_TYPE_LABELS[type]} onClick={() => setSelectedMealType(type)} />
// After:
<Chip label={MEAL_TYPE_LABELS[type]} onClick={() => setSelectedMealType(type)} data-testid={`meal-type-${type}`} />
```

**Step 3: Update selectors.ts to use the new test IDs**

**Step 4: Re-run all tests and confirm green**

```bash
cd apps/e2e && npx playwright test --project=alice
```

**Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx apps/e2e/helpers/selectors.ts
git commit -m "test: add data-testid attributes for reliable e2e selectors"
```

---

## Task 10: Final verification and README

**Step 1: Run full suite end-to-end**

```bash
cd apps/e2e && npx playwright test
```

Expected: All tests pass across `alice`, `alice-friends`, and `bob` projects.

**Step 2: Create `apps/e2e/README.md`**

```markdown
# ReciFind E2E Tests

Playwright test suite covering Recipe CRUD, sharing, friends, and search/filter.

## Setup (one-time)

1. Start local dev servers:
   - `cd apps/recipe-ui && npm run dev`
   - `cd apps/worker && npx wrangler dev`

2. Install dependencies: `cd apps/e2e && npm install`

3. Authenticate test accounts (opens browser for manual Google login):
   ```bash
   npm run test:setup
   ```
   Log in as Alice (account 1), then Bob (account 2). Sessions saved to `.auth/` (gitignored).

## Running Tests

```bash
cd apps/e2e

npm test                        # all tests
npm run test:recipe-crud        # recipe CRUD only
npm run test:sharing            # sharing only
npm run test:friends            # friend flow only
npm run test:search             # search & filter only
npm run test:ui                 # interactive Playwright UI
```

## Re-authenticate

Sessions expire after ~1 week. Re-run `npm run test:setup` to refresh.

## Notes

- Tests prefix all created recipes with `[TEST]` for easy identification
- Cleanup runs via API after each test — if a test crashes mid-way, prefix-search for `[TEST]` in the app and delete manually
- Friend flow tests are stateful — run `friends.spec.ts` as a full suite, not individual tests
```

**Step 3: Final commit**

```bash
git add apps/e2e/README.md
git commit -m "docs: add e2e test suite README"
```
