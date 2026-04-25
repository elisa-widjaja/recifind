/**
 * Isolated PKCE flow test — does NOT use the React app.
 *
 * Runs Supabase JS directly inside the Playwright page with PKCE flow
 * (matching the iOS Capacitor config) and localStorage (matching what
 * Capacitor Preferences ultimately backs to: persistent key/value store).
 *
 * Goal: pin down whether the PKCE verifier loss is
 *   (a) a bug in @supabase/supabase-js's PKCE flow (writes never persist), or
 *   (b) a Capacitor-Preferences-specific persistence issue, or
 *   (c) a key-mismatch between write and read paths.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.use({ storageState: undefined });

test('PKCE signInWithOtp writes a verifier to storage (in-page)', async ({ page }) => {
  const TEST_EMAIL = `e2e-pkce-${Date.now()}@recifind.test`;

  // Start on a real origin so localStorage is accessible
  await page.goto('https://dev.recifriend.com/');

  // Pre-create the user via admin API (non-page side)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await admin.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });

  // Run Supabase JS in the page with PKCE flow + localStorage
  // (localStorage is the closest web-equivalent to Capacitor Preferences:
  // persistent, async-friendly, key/value)
  const result = await page.evaluate(async ({ url, key, email }) => {
    // Dynamic import @supabase/supabase-js inside the page
    const mod: any = await import('https://esm.sh/@supabase/supabase-js@2');
    const sb = mod.createClient(url, key, {
      auth: {
        flowType: 'pkce',
        storage: localStorage,
        storageKey: 'recifriend-auth',
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

    const before = Object.keys(localStorage);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'recifriend://auth/callback' },
    });
    const after = Object.keys(localStorage);
    const newKeys = after.filter((k) => !before.includes(k));

    const verifierKey = newKeys.find((k) => k.includes('code-verifier'));
    const verifierValue = verifierKey ? localStorage.getItem(verifierKey) : null;

    return {
      error: error?.message ?? null,
      newKeys,
      verifierKey: verifierKey ?? null,
      verifierLen: verifierValue?.length ?? 0,
    };
  }, { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, email: TEST_EMAIL });

  console.log('signInWithOtp(PKCE) result:', JSON.stringify(result, null, 2));

  expect(result.error).toBeNull();
  expect(result.verifierKey, 'PKCE flow should write a code_verifier key').not.toBeNull();
  expect(result.verifierLen, 'PKCE code_verifier should be a non-empty string').toBeGreaterThan(20);
});
