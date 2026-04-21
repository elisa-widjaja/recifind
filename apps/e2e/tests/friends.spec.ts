import { test, expect, Page } from '@playwright/test';
import { getAuthToken, getUserId, getEmail, getDisplayName, removeFriend, deleteRecipeByTitle, acceptFriendRequest, sendFriendRequest } from '../helpers/api';
import { sel } from '../helpers/selectors';
import path from 'path';
import * as fs from 'fs';
const ALICE_STATE = path.join(__dirname, '../.auth/alice.json');
const BOB_STATE = path.join(__dirname, '../.auth/bob.json');
const API_BASE = process.env.API_BASE!;


async function openFriendsDrawer(page: Page) {
  // Homepage stats card has "View friends" when friends.length > 0 — opens the
  // same bottom drawer as the hamburger "Friends" menu item. All callers here
  // run after a friendship has been established, so the button is present.
  await page.getByRole('button', { name: 'View friends' }).click();
  await sel.friendsDrawer(page).waitFor({ state: 'visible', timeout: 10_000 });
}

test.describe('Friends flow', () => {
  let sharedRecipeTitle = '';

  // All friends flow tests run as Alice (alice-friends project).
  // Friend connection setup is done via API — the UI for sending invites changed to
  // open-link sharing (no email input). UI tests cover the friends list and recipe visibility.
  test('Alice and Bob connect via API', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'alice-friends', 'Alice-only test');

    const aliceToken = await getAuthToken(ALICE_STATE);
    const aliceId = await getUserId(ALICE_STATE);
    const bobToken = await getAuthToken(BOB_STATE);
    const bobEmail = await getEmail(BOB_STATE);
    const bobId = await getUserId(BOB_STATE);

    // sendFriendRequest may return 409 if already friends or request already sent — both are fine
    try {
      await sendFriendRequest(aliceToken, bobEmail);
    } catch (e: any) {
      if (!e.message?.includes('409')) throw e;
    }

    // acceptFriendRequest may return 404 if already friends (no pending request) — fine
    try {
      await acceptFriendRequest(aliceId, bobToken);
    } catch (e: any) {
      if (!e.message?.includes('404') && !e.message?.includes('409')) throw e;
    }

    // Verify the connection actually exists in D1 before moving on
    const res = await fetch(`${API_BASE}/friends`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const data = await res.json() as { friends: Array<{ friendId: string }> };
    const connected = data.friends.some(f => f.friendId === bobId);
    if (!connected) throw new Error(`Friend connection not found after setup. Friends: ${JSON.stringify(data.friends)}`);
  });

  test('Alice sees Bob in friends list', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'alice-friends', 'Alice-only test');

    const bobDisplayName = await getDisplayName(BOB_STATE);
    await page.goto('/');
    await openFriendsDrawer(page);

    // Friends list shows a button with the friend's display name inside the friends drawer
    const friendsDrawer = page.getByTestId('friends-drawer');
    await expect(
      friendsDrawer.getByText(new RegExp(bobDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Bob shared recipe is visible to Alice in friends tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'alice-friends', 'Alice-only test');

    sharedRecipeTitle = '[TEST] Bob Shared Recipe';
    const bobToken = await getAuthToken(BOB_STATE);
    const bobDisplayName = await getDisplayName(BOB_STATE);

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

    await page.goto('/');
    await openFriendsDrawer(page);

    // Click on Bob's entry inside the friends drawer
    const friendsDrawer = page.getByTestId('friends-drawer');
    await friendsDrawer.getByText(new RegExp(bobDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().click();
    await expect(page.getByText(sharedRecipeTitle).first()).toBeVisible({ timeout: 8_000 });
  });


  // Tests that the "You're now connected" snackbar appears when a user logs in with
  // a pending open invite. Uses route interception to avoid DB state dependencies
  // (accept-open-invite is mocked to return { message: 'Connected!' }).
  test('Bob sees "You\'re now connected" snackbar after accepting Alice\'s open invite', async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'alice-friends', 'Alice-only test');

    // Alice's display name — used to verify the snackbar message
    const aliceDisplayName = await getDisplayName(ALICE_STATE);

    // Read Bob's saved session
    const bobState = JSON.parse(fs.readFileSync(BOB_STATE, 'utf-8'));
    const bobAuthEntry = bobState.origins?.[0]?.localStorage?.find((e: { name: string }) => e.name === 'recifriend-auth');
    if (!bobAuthEntry) throw new Error('Bob recifriend-auth entry not found in .auth/bob.json — re-run test:setup');

    // Placeholder invite token — the real accept-open-invite call is intercepted below
    const fakeInviteToken = 'e2e-test-invite-token';

    const freshContext = await browser.newContext({ baseURL });
    const freshPage = await freshContext.newPage();

    const intercepted: string[] = [];
    freshPage.on('request', req => {
      if (req.url().includes('friends')) intercepted.push(`REQ ${req.method()} ${req.url()}`);
    });
    const consoleLogs: string[] = [];
    freshPage.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('connect') || msg.text().includes('invite') || msg.text().includes('snack')) {
        consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
      }
    });

    try {
      // Intercept accept-open-invite and return a successful connection response.
      // This makes the test deterministic regardless of DB state.
      await freshPage.route('**/friends/accept-open-invite', async route => {
        intercepted.push('INTERCEPTED accept-open-invite');
        const responseBody = JSON.stringify({ message: 'Connected!', inviterName: aliceDisplayName });
        intercepted.push(`RESPONSE BODY: ${responseBody}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: responseBody,
        });
      });
      // Suppress the check-invites fallback so it doesn't trigger a competing snackbar
      await freshPage.route('**/friends/check-invites', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ connected: [] }),
        });
      });

      // Inject session + pending invite via addInitScript so they're present BEFORE
      // the app's own module-level code runs.
      await freshContext.addInitScript(
        ({ sessionValue, inviteToken }: { sessionValue: string; inviteToken: string }) => {
          localStorage.setItem('recifriend-auth', sessionValue);
          localStorage.setItem('onboarding_seen', '1');
          sessionStorage.setItem('pending_open_invite', inviteToken);
          sessionStorage.setItem('invite_entry', '1');
        },
        { sessionValue: bobAuthEntry.value, inviteToken: fakeInviteToken }
      );

      // Use baseURL from config (tunnel URL)
      await freshPage.goto('/');

      // Wait a moment for the API call to be processed and React to re-render
      await freshPage.waitForTimeout(3000);

      // Debug: check what's in the DOM
      const snackbarCount = await freshPage.locator('.MuiSnackbar-root').count();
      const alertEl = freshPage.locator('[role="alert"]');
      const alertCount = await alertEl.count();
      const alertText = alertCount > 0 ? await alertEl.first().textContent() : '(none)';
      const alertVisible = alertCount > 0 ? await alertEl.first().isVisible() : false;
      console.log(`snackbar: ${snackbarCount}, alerts: ${alertCount}, visible: ${alertVisible}, text: "${alertText}"`);

      // The app should call accept-open-invite (intercepted → Connected!) and show the snackbar
      await expect(
        freshPage.getByRole('alert').filter({ hasText: /you.?re( now)? connected/i })
      ).toBeVisible({ timeout: 5_000 }).catch(err => {
        console.log('Intercepted requests:', intercepted.join('\n') || '(none)');
        console.log('Console logs:', consoleLogs.join('\n') || '(none)');
        throw err;
      });
    } finally {
      await freshContext.close();
    }
  });

  test.afterAll(async () => {
    try {
      const aliceToken = await getAuthToken(ALICE_STATE);
      const bobToken = await getAuthToken(BOB_STATE);
      const aliceId = await getUserId(ALICE_STATE);
      const bobId = await getUserId(BOB_STATE);

      await removeFriend(aliceToken, bobId);
      await removeFriend(bobToken, aliceId);

      if (sharedRecipeTitle) {
        await deleteRecipeByTitle(bobToken, sharedRecipeTitle);
      }
    } catch (e) {
      console.warn('Cleanup failed:', e);
    }
  });
});
