/**
 * E2E: magic-link OTP-code path on web.
 *
 * Confirms the complete sign-in flow:
 *   1. Open auth dialog
 *   2. Enter email → "Send magic link"
 *   3. Dialog auto-transitions to verification-code entry
 *   4. Acquire OTP via Supabase admin API (matches what email would carry)
 *   5. Type the OTP → "Verify code"
 *   6. Assert: dialog closes, user signed in
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'https://dev.recifriend.com';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.use({ storageState: undefined });

test('OTP-code sign-in works end-to-end', async ({ page }) => {
  const TEST_EMAIL = `e2e-otp-${Date.now()}@recifind.test`;

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser ${msg.type()}] ${msg.text()}`);
  });

  await admin.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });

  await page.goto(FRONTEND_URL);

  // Open auth dialog and request OTP. We use admin.generateLink BEFORE the
  // user-side signInWithOtp so the admin's OTP is the one that's stored
  // server-side (signInWithOtp would invalidate it). Instead we'll simulate
  // by NOT clicking "Send magic link" — directly trigger the OTP flow via
  // admin and use page.evaluate to set the otpSentToEmail state.
  //
  // Simpler approach: click Send magic link first, then admin.generateLink.
  // The second call invalidates the first OTP. The admin OTP is the new
  // valid one. The dialog UI doesn't care which is which.

  await page.getByRole('button', { name: /login/i }).click();
  await page.getByRole('dialog', { name: /sign in/i }).waitFor({ timeout: 5000 });
  await page.getByRole('textbox', { name: /email/i }).fill(TEST_EMAIL);
  await page.getByRole('button', { name: /send magic link/i }).click();
  await expect(page.locator('.MuiAlert-message', { hasText: /Check your email/i }))
    .toBeVisible({ timeout: 8000 });

  // Generate a fresh OTP via admin (replaces the email-sent one).
  // Note: admin.generateLink({type:'magiclink'}) returns email_otp that's
  // verifiable via verifyOtp({type:'email'}) — same as what comes in the email.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
  });
  if (linkError || !linkData?.properties?.email_otp) {
    throw new Error(`generateLink failed: ${linkError?.message}`);
  }
  const otpCode = linkData.properties.email_otp;
  console.log(`OTP from admin API: '${otpCode}' (length=${otpCode.length})`);

  // Verify the input field accepts the full length (this is what the fix is for)
  const otpInput = page.getByRole('textbox', { name: /verification code/i });
  await otpInput.fill(otpCode);
  const enteredValue = await otpInput.inputValue();
  console.log(`Entered into input: '${enteredValue}' (length=${enteredValue.length})`);
  expect(enteredValue.length).toBe(otpCode.length);  // proves the maxLength fix worked

  // Submit
  await page.getByRole('button', { name: /^verify code$/i }).click();
  await page.waitForTimeout(2000);

  const alerts = await page.locator('.MuiAlert-message').allTextContents();
  console.log('Alerts after Verify:', alerts);

  // Assert: dialog closes (sign-in succeeded)
  await expect(page.getByRole('dialog', { name: /sign in/i })).not.toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /^login$/i })).not.toBeVisible({ timeout: 5000 });
  console.log('OTP-code sign-in: SUCCESS');
});
