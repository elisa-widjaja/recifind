import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.e2e') });

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

const TEST_USERS = {
  alice: { email: 'e2e-alice@recifind.test', name: 'Alice (E2E)' },
  bob:   { email: 'e2e-bob@recifind.test',   name: 'Bob (E2E)' },
};

// Admin client — creates users and generates links
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Regular client — used to exchange OTP for a real session token
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getOrCreateUser(email: string, name: string) {
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find(u => u.email === email);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data?.user) throw new Error(`Failed to create user ${email}: ${error?.message}`);
  return data.user;
}

async function getSession(email: string) {
  // Generate a magic link — this gives us the OTP token without sending an email
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !linkData?.properties?.email_otp) {
    throw new Error(`Failed to generate link for ${email}: ${linkError?.message}`);
  }

  // Exchange the OTP for a real session (access_token + refresh_token)
  const { data: sessionData, error: sessionError } = await supabaseAnon.auth.verifyOtp({
    email,
    token: linkData.properties.email_otp,
    type: 'magiclink',
  });
  if (sessionError || !sessionData?.session) {
    throw new Error(`Failed to verify OTP for ${email}: ${sessionError?.message}`);
  }
  return sessionData.session;
}

async function injectSessionAndSave(page: any, email: string, outputPath: string) {
  const session = await getSession(email);

  // Navigate to the app first so localStorage origin is set
  await page.goto('/');

  // Inject session in the exact format supabase-js v2 stores it under storageKey 'recifriend-auth'
  // Also mark onboarding as seen to prevent modal from blocking tests
  await page.evaluate(({ session }: { session: any }) => {
    localStorage.setItem('recifriend-auth', JSON.stringify(session));
    localStorage.setItem('onboarding_seen', '1');
  }, { session });

  // Reload so the app picks up the injected session
  await page.reload();

  // Dismiss onboarding/welcome dialogs that appear on first login.
  // Try clicking "Don't show this again" if the onboarding dialog appears.
  try {
    await page.getByRole('button', { name: "Don't show this again" }).click({ timeout: 5_000 });
    await page.waitForTimeout(500);
  } catch {
    // No onboarding dialog — that's fine
  }
  // Also try dismissing a second dialog if one appears
  try {
    await page.getByRole('button', { name: "Don't show this again" }).click({ timeout: 2_000 });
    await page.waitForTimeout(500);
  } catch {
    // No second dialog
  }

  // The bottom-nav "Profile" tab only renders for a logged-in session,
  // so its presence is a stable signal the auth-injection landed.
  // (Replaces the old "Open menu" hamburger sentinel — the top AppBar
  // was removed in the homepage bottom-nav redesign.)
  await page.getByRole('button', { name: 'Profile' }).waitFor({ timeout: 15_000 });

  // Wipe leftover [TEST]-prefixed recipes from prior test runs that died
  // before their afterEach. Without this, the recipes-cache localStorage
  // (recifriend-recipes-cache-v2, set by App.jsx after the post-login fetch)
  // gets baked into the saved storageState with stale entries, and tests
  // that look for a freshly-API-created recipe see clutter instead.
  const apiBase = process.env.API_BASE || 'http://localhost:8787';
  const accessToken = session.access_token;
  try {
    const listRes = await fetch(`${apiBase}/recipes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const data = await listRes.json() as { recipes: Array<{ id: string; title: string }> };
      const stale = data.recipes.filter(r => r.title.startsWith('[TEST]'));
      await Promise.all(stale.map(r =>
        fetch(`${apiBase}/recipes/${r.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ));
      if (stale.length) console.log(`Cleared ${stale.length} leftover [TEST] recipes for ${email}`);
    }
  } catch (e) {
    console.warn(`Pre-test recipe cleanup failed for ${email}:`, e);
  }

  // Drop the recipes cache so the saved storageState doesn't carry the
  // pre-cleanup snapshot. Tests will get a clean fetch on first navigate.
  await page.evaluate(() => {
    localStorage.removeItem('recifriend-recipes-cache-v2');
  });

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: outputPath });
}

setup('create alice session', async ({ page }) => {
  await getOrCreateUser(TEST_USERS.alice.email, TEST_USERS.alice.name);
  await injectSessionAndSave(page, TEST_USERS.alice.email, path.join(AUTH_DIR, 'alice.json'));
  console.log('Alice session saved:', TEST_USERS.alice.email);
});

setup('create bob session', async ({ page }) => {
  await getOrCreateUser(TEST_USERS.bob.email, TEST_USERS.bob.name);
  await injectSessionAndSave(page, TEST_USERS.bob.email, path.join(AUTH_DIR, 'bob.json'));
  console.log('Bob session saved:', TEST_USERS.bob.email);
});
