import { test, expect, Page } from '@playwright/test';
import { getAuthToken, removeFriend, deleteRecipeByTitle } from '../helpers/api';
import path from 'path';

const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const BOB_STATE = path.join(__dirname, '../.auth/bob.json');
const API_BASE = 'http://localhost:8787';

async function getEmailFromState(statePath: string): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const entries = state.origins?.[0]?.localStorage ?? [];
  const auth = entries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!auth) throw new Error(`No auth in ${statePath}`);
  const session = JSON.parse(auth.value);
  return session?.currentSession?.user?.email ?? session?.user?.email ?? '';
}

async function getUserIdFromState(statePath: string): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const entries = state.origins?.[0]?.localStorage ?? [];
  const auth = entries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!auth) throw new Error(`No auth in ${statePath}`);
  const session = JSON.parse(auth.value);
  return session?.currentSession?.user?.id ?? session?.user?.id ?? '';
}

async function openFriendsDialog(page: Page) {
  // The Friends button uses a Tooltip with title "Friends" wrapping an IconButton with PeopleIcon
  await page.getByRole('button', { name: /friends/i }).click();
  // The friends panel is a Drawer (not a Dialog), wait for the Add Friend button to confirm it's open
  await expect(page.getByRole('button', { name: /add friend/i })).toBeVisible({ timeout: 5_000 });
}

test.describe('Friends flow', () => {
  let sharedRecipeTitle = '';

  // Tests that run as Alice (matched by alice-friends project)
  test('Alice sends friend request to Bob', async ({ page }) => {
    const bobEmail = await getEmailFromState(BOB_STATE);
    await page.goto('/');
    await openFriendsDialog(page);

    // Click "Add Friend" to open the email input form
    await page.getByRole('button', { name: 'Add Friend' }).click();

    // Email input has placeholder "friend@example.com"
    const emailInput = page.getByPlaceholder('friend@example.com');
    await emailInput.fill(bobEmail);

    // Send is an IconButton (SendIcon) — trigger via Enter key since there's no text button
    await emailInput.press('Enter');

    // Success shown via Snackbar: "Friend request sent!" or "Invite sent! They'll get an email to join ReciFind."
    await expect(page.getByText(/friend request sent|invite sent/i)).toBeVisible({ timeout: 8_000 });
  });

  // Tests that run as Bob (matched by bob project)
  test('Bob accepts Alice friend request', async ({ page }) => {
    await page.goto('/');
    await openFriendsDialog(page);

    // Switch to the "Requests" tab (tab index 1)
    await page.getByRole('tab', { name: /requests/i }).click();

    // Accept button with CheckIcon and text "Accept"
    const acceptBtn = page.getByRole('button', { name: 'Accept' });
    await expect(acceptBtn).toBeVisible({ timeout: 8_000 });
    await acceptBtn.click();

    // Snackbar shows "Friend request accepted!"
    await expect(page.getByText(/friend request accepted/i)).toBeVisible({ timeout: 8_000 });
  });

  // Tests that run as Alice (matched by alice-friends project)
  test('Alice sees Bob in friends list', async ({ page }) => {
    const bobEmail = await getEmailFromState(BOB_STATE);
    await page.goto('/');
    await openFriendsDialog(page);

    // Friends tab (tab 0) is default — Bob should appear by name or email prefix
    const bobIdentifier = bobEmail.split('@')[0];
    await expect(page.getByText(new RegExp(bobIdentifier, 'i'))).toBeVisible({ timeout: 8_000 });
  });

  // Tests that run as Alice (matched by alice-friends project)
  test('Bob shared recipe is visible to Alice in friends tab', async ({ page }) => {
    sharedRecipeTitle = '[TEST] Bob Shared Recipe';
    const bobToken = await getAuthToken(BOB_STATE);

    // Create a shared recipe as Bob via API
    await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: sharedRecipeTitle,
        sourceUrl: 'https://example.com/bob-recipe',
        mealTypes: ['lunch'],
        ingredients: ['tomato'],
        steps: ['Slice tomato'],
        sharedWithFriends: true,
      }),
    });

    const bobEmail = await getEmailFromState(BOB_STATE);
    await page.goto('/');
    await openFriendsDialog(page);

    // Click on Bob's entry in the friends list to view his recipes
    const bobIdentifier = bobEmail.split('@')[0];
    await page.getByText(new RegExp(bobIdentifier, 'i')).first().click();

    await expect(page.getByText(sharedRecipeTitle)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    try {
      const aliceToken = await getAuthToken(ALICE_STATE);
      const bobToken = await getAuthToken(BOB_STATE);
      const aliceId = await getUserIdFromState(ALICE_STATE);
      const bobId = await getUserIdFromState(BOB_STATE);

      // Remove friendship from both sides
      await removeFriend(aliceToken, bobId);
      await removeFriend(bobToken, aliceId);

      // Clean up Bob's shared recipe
      if (sharedRecipeTitle) {
        await deleteRecipeByTitle(bobToken, sharedRecipeTitle);
      }
    } catch (e) {
      console.warn('Cleanup failed:', e);
    }
  });
});
