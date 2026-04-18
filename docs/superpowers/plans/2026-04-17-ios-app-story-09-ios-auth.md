# Story 09 — iOS Auth (PKCE + Apple + Deep Link Handler)

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Full auth on iOS: Google OAuth via ASWebAuthenticationSession, Sign in with Apple, PKCE enforced, session persisted to Keychain via Capacitor Preferences. Also installs the shared deep-link dispatcher (used by S10, S11) because the auth callback is the first consumer.

**Depends on:** Stories 02, 06, 07, 08 (contracts, validator, AASA, Capacitor shell)
**Blocks:** Gate G3
**Can develop in parallel with:** Stories 10, 11 (different App.jsx marker sections)

**Contracts consumed:** C3 Deep links, C5 iOS identifiers
**Contracts produced:** `handleDeepLink(url)` dispatcher used by S10 and S11

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/recipe-ui/src/lib/capacitorPreferences.js` | Supabase storage adapter |
| Create | `apps/recipe-ui/src/lib/capacitorPreferences.test.js` | Tests |
| Create | `apps/recipe-ui/src/lib/deepLinkDispatch.js` | Wraps `parseDeepLink` and routes to UI actions |
| Create | `apps/recipe-ui/src/lib/deepLinkDispatch.test.js` | Tests |
| Modify | `apps/recipe-ui/src/supabaseClient.js` (or wherever the client is built) | Enable PKCE + storage adapter |
| Modify | `apps/recipe-ui/src/App.jsx` | Capacitor auth flow + deep-link listener. Markers: `// === [S09] Capacitor auth ===` … `// === [/S09] ===` and `// === [S06] Deep link handler ===` (registered here) |

---

## Task 1: Capacitor Preferences storage adapter for Supabase

- [ ] **Step 1:** Create `apps/recipe-ui/src/lib/capacitorPreferences.test.js`

```js
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { capacitorStorage } from './capacitorPreferences';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

import { Preferences } from '@capacitor/preferences';

describe('capacitorStorage adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getItem unwraps .value', async () => {
    Preferences.get.mockResolvedValue({ value: 'hello' });
    const v = await capacitorStorage.getItem('k');
    expect(v).toBe('hello');
    expect(Preferences.get).toHaveBeenCalledWith({ key: 'k' });
  });

  it('getItem returns null when key absent', async () => {
    Preferences.get.mockResolvedValue({ value: null });
    const v = await capacitorStorage.getItem('k');
    expect(v).toBeNull();
  });

  it('setItem passes key + value', async () => {
    await capacitorStorage.setItem('k', 'v');
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'k', value: 'v' });
  });

  it('removeItem calls Preferences.remove', async () => {
    await capacitorStorage.removeItem('k');
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'k' });
  });
});
```

- [ ] **Step 2:** Create `apps/recipe-ui/src/lib/capacitorPreferences.js`

```js
import { Preferences } from '@capacitor/preferences';

export const capacitorStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};
```

- [ ] **Step 3:** Tests pass

```bash
cd apps/recipe-ui && npm test -- capacitorPreferences
```

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/src/lib/capacitorPreferences.js apps/recipe-ui/src/lib/capacitorPreferences.test.js
git commit -m "feat(ios): add Capacitor Preferences storage adapter for Supabase"
```

## Task 2: Deep-link dispatcher

- [ ] **Step 1:** Create `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`

```js
import { describe, expect, it, vi } from 'vitest';
import { createDispatcher } from './deepLinkDispatch';

describe('deep link dispatcher', () => {
  it('routes auth callback to onAuthCallback', async () => {
    const onAuthCallback = vi.fn().mockResolvedValue(undefined);
    const dispatch = createDispatcher({ onAuthCallback, onAddRecipe: () => {}, onFriendRequests: () => {}, onRecipeDetail: () => {} });
    await dispatch('https://recifriend.com/auth/callback?code=abc');
    expect(onAuthCallback).toHaveBeenCalledWith('abc');
  });

  it('routes add-recipe to onAddRecipe with url', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({ onAuthCallback: () => {}, onAddRecipe, onFriendRequests: () => {}, onRecipeDetail: () => {} });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fabc');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/abc');
  });

  it('routes /recipes/:id to onRecipeDetail with id', async () => {
    const onRecipeDetail = vi.fn();
    const dispatch = createDispatcher({ onAuthCallback: () => {}, onAddRecipe: () => {}, onFriendRequests: () => {}, onRecipeDetail });
    await dispatch('https://recifriend.com/recipes/abc-123');
    expect(onRecipeDetail).toHaveBeenCalledWith('abc-123');
  });

  it('silently ignores malicious URLs', async () => {
    const handlers = {
      onAuthCallback: vi.fn(), onAddRecipe: vi.fn(),
      onFriendRequests: vi.fn(), onRecipeDetail: vi.fn(),
    };
    const dispatch = createDispatcher(handlers);
    await dispatch('javascript:alert(1)');
    await dispatch('recifriend://auth/callback?code=bad');  // custom scheme rejected for auth
    await dispatch('https://evil.com/recipes/1');
    expect(handlers.onAuthCallback).not.toHaveBeenCalled();
    expect(handlers.onAddRecipe).not.toHaveBeenCalled();
    expect(handlers.onFriendRequests).not.toHaveBeenCalled();
    expect(handlers.onRecipeDetail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** Create `apps/recipe-ui/src/lib/deepLinkDispatch.js`

```js
import { parseDeepLink } from '../../../shared/deepLink';

/**
 * Creates a deep-link dispatcher bound to UI handlers.
 * @param {{
 *   onAuthCallback: (code: string) => Promise<void>,
 *   onAddRecipe: (url: string) => void,
 *   onFriendRequests: () => void,
 *   onRecipeDetail: (recipeId: string) => void,
 * }} handlers
 */
export function createDispatcher(handlers) {
  return async function dispatch(urlString) {
    const link = parseDeepLink(urlString);
    if (!link) return;  // silently reject anything that doesn't match the allowlist

    switch (link.kind) {
      case 'auth_callback': return await handlers.onAuthCallback(link.code);
      case 'add_recipe':    return handlers.onAddRecipe(link.url);
      case 'friend_requests': return handlers.onFriendRequests();
      case 'recipe_detail': return handlers.onRecipeDetail(link.recipe_id);
    }
  };
}
```

- [ ] **Step 3:** Tests pass

```bash
cd apps/recipe-ui && npm test -- deepLinkDispatch
```

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/src/lib/deepLinkDispatch.js apps/recipe-ui/src/lib/deepLinkDispatch.test.js
git commit -m "feat(ios): deep-link dispatcher wraps parseDeepLink + UI handlers"
```

## Task 3: Supabase client — PKCE + Capacitor storage

Find wherever the Supabase client is currently created. Typical location: `apps/recipe-ui/src/supabaseClient.js` (or inline in App.jsx). If inline, extract to its own file first.

- [ ] **Step 1:** If needed, extract to `apps/recipe-ui/src/supabaseClient.js`

```js
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { capacitorStorage } from './lib/capacitorPreferences';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    storage: Capacitor.isNativePlatform() ? capacitorStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: !Capacitor.isNativePlatform(),  // native uses deep link, not URL detection
  },
});
```

- [ ] **Step 2:** Update all imports — grep `createClient` in App.jsx and swap to `import { supabase } from './supabaseClient'`.

- [ ] **Step 3:** Commit

```bash
git add apps/recipe-ui/src/supabaseClient.js apps/recipe-ui/src/App.jsx
git commit -m "feat(auth): Supabase client uses PKCE + Capacitor storage on native"
```

## Task 4: Sign-in handler — Google via Capacitor Browser

- [ ] **Step 1:** Edit `apps/recipe-ui/src/App.jsx` — add auth handler inside S09 markers:

```jsx
// === [S09] Capacitor auth ===
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { createDispatcher } from './lib/deepLinkDispatch';

async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://recifriend.com/auth/callback',
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    await Browser.open({ url: data.url, windowName: '_self', presentationStyle: 'popover' });
  } else {
    // existing web redirect, unchanged
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
}

async function signInWithApple() {
  // iOS only — gated on Capacitor.isNativePlatform()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: 'https://recifriend.com/auth/callback',
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  await Browser.open({ url: data.url });
}
// === [/S09] ===
```

- [ ] **Step 2:** Add the "Continue with Apple" button — gated on native platform:

```jsx
{/* === [S09] === */}
{Capacitor.isNativePlatform() && (
  <Button onClick={signInWithApple} fullWidth variant="contained" sx={{ mt: 1 }}>
    Continue with Apple
  </Button>
)}
{/* === [/S09] === */}
```

- [ ] **Step 3:** Wire sign-out — clear session + DELETE device token:

```jsx
async function signOut() {
  if (Capacitor.isNativePlatform()) {
    // Story 11 will set this up; for now it's safe to fail silently
    try {
      const token = await getCurrentApnsToken();  // provided by Story 11
      if (token) {
        await fetch(`${apiBase}/devices/register`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ apns_token: token }),
        });
      }
    } catch { /* S11 not merged yet */ }
  }
  await supabase.auth.signOut();
}
```

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(auth): Google + Apple sign-in via Capacitor Browser"
```

## Task 5: Deep-link listener + dispatcher

**Adapter note:** the handlers below assume certain state setters exist in App.jsx. Before writing this code, grep for the current "open Add Recipe dialog" pattern and match names. If the current app uses different state names (e.g., `openAddDialog` instead of `setAddRecipeDialogOpen`), substitute them. The dispatcher's contract is fixed; the UI side adapts.

- [ ] **Step 1:** Hoist `dispatchDeepLink` to component scope (so Story 11 can reference it) — add inside S09 markers at the top of the App component:

```jsx
// === [S09] Capacitor auth ===
const dispatchDeepLink = useCallback((urlString) => {
  const dispatch = createDispatcher({
    onAuthCallback: async (code) => {
      await supabase.auth.exchangeCodeForSession(code);
      await Browser.close();
    },
    onAddRecipe: (url) => {
      // Adapt to your existing Add Recipe dialog state:
      setAddRecipeDialogOpen(true);
      setAddRecipeUrl(url);
    },
    onFriendRequests: () => {
      setCurrentView('friend-requests');
    },
    onRecipeDetail: (recipeId) => {
      setSelectedRecipeId(recipeId);
    },
  });
  return dispatch(urlString);
}, [/* include any state setters you capture — leaving deps empty only if all setters are stable */]);
// === [/S09] ===
```

- [ ] **Step 2:** Register the appUrlOpen listener that calls the hoisted dispatcher:

```jsx
// === [S09] Capacitor auth ===
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  let cleanupPromise;
  cleanupPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    dispatchDeepLink(url);
  });
  return () => { cleanupPromise.then(l => l.remove()); };
}, [dispatchDeepLink]);
// === [/S09] ===
```

- [ ] **Step 3:** Handle **cold-start deep link** — if the app was opened by tapping a link (app was killed before), `appUrlOpen` fires but the app may not be ready. Capacitor provides `App.getLaunchUrl()`:

```jsx
// === [S09] Capacitor auth ===
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  (async () => {
    const launch = await CapacitorApp.getLaunchUrl();
    if (launch?.url) dispatchDeepLink(launch.url);
  })();
}, [dispatchDeepLink]);
// === [/S09] ===
```

- [ ] **Step 3:** Commit

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(auth): wire deep-link listener for auth callback + routing"
```

## Task 6: Sign in with Apple — Supabase setup (one-time, dashboard)

- [ ] **Step 1:** Apple Developer portal → Identifiers → Services IDs → create new:
  - Identifier: `com.recifriend.auth`
  - Enable "Sign in with Apple"
  - Domains: `recifriend.com`
  - Return URLs: `https://<supabase-project>.supabase.co/auth/v1/callback`

- [ ] **Step 2:** Apple Developer portal → Keys → create new key → enable "Sign in with Apple" → configure with your App ID (`com.recifriend.app`) → download .p8.

- [ ] **Step 3:** Supabase dashboard → Auth → Providers → Apple → enable:
  - Services ID: `com.recifriend.auth`
  - Team ID: your Apple Team ID
  - Key ID: from the key download
  - Secret Key: contents of the .p8

- [ ] **Step 4:** Record setup in `docs/runbooks/ios-local-dev.md`.

## Task 7: Test on real device

- [ ] **Step 1:** Build + sync

```bash
cd apps/recipe-ui && npm run build
cd ../ios && npx cap sync ios && npx cap open ios
```

- [ ] **Step 2:** Run on physical iPhone. Expect:
  - Tap "Continue with Google" → ASWebAuthenticationSession modal opens → Google login → app returns, signed in.
  - Tap "Continue with Apple" → Apple sign-in modal → returns, signed in.
  - Kill the app, relaunch → still signed in (Keychain persisted).
  - Sign out → back to login screen.

- [ ] **Step 3:** Adversarial test: from Safari on the device, enter `recifriend://auth/callback?code=fake_code`. Expect: app opens but the auth handler refuses (custom scheme rejected — see parseDeepLink). No session created.

## Acceptance criteria (Gate G3)

- [ ] All capacitorPreferences + deepLinkDispatch tests pass
- [ ] Google sign-in round-trip works on real iPhone
- [ ] Apple sign-in round-trip works on real iPhone
- [ ] Session persists across app restart (Keychain)
- [ ] Sign-out clears session
- [ ] Adversarial custom-scheme auth callback is rejected (security S1)
- [ ] Cold-start deep link (tap link when app killed) works
- [ ] S09 markers wrap all App.jsx edits

## Commit checklist

- `feat(ios): add Capacitor Preferences storage adapter ...`
- `feat(ios): deep-link dispatcher ...`
- `feat(auth): Supabase client uses PKCE ...`
- `feat(auth): Google + Apple sign-in ...`
- `feat(auth): wire deep-link listener ...`
