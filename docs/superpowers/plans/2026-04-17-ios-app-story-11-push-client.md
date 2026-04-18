# Story 11 — iOS Push Client

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Register for APNs on iOS, send the token to the Worker (`POST /devices/register`), wire notification taps to the shared deep-link dispatcher, and **soft-prompt** for notification permission at the right moment (after a social action — not on cold start).

**Depends on:** Stories 05 (backend), 06 (validator), 08 (Capacitor shell). Uses S09's deep-link dispatcher.
**Blocks:** Gate G5
**Can develop in parallel with:** Stories 09, 10 (separate App.jsx marker section)

**Contracts consumed:** C2 Device registration, C3 Deep links, C4 APNs payload (read-side)
**Contracts produced:** `getCurrentApnsToken()` used by S09 sign-out handler

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/recipe-ui/src/lib/pushClient.js` | Registration logic + token cache |
| Create | `apps/recipe-ui/src/lib/pushClient.test.js` | Tests |
| Create | `apps/recipe-ui/src/components/NotificationSoftPrompt.jsx` | In-app banner: "Get notified when..." |
| Modify | `apps/recipe-ui/src/App.jsx` | Wire permission prompt + registration + tap handler. Marker: `// === [S11] Push client ===` … `// === [/S11] ===` |

---

## Task 1: Push client module

- [ ] **Step 1:** Create `apps/recipe-ui/src/lib/pushClient.test.js`

```js
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureRegistered, getCurrentApnsToken, hasPromptedForPermission } from './pushClient';

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn((event, cb) => {
      globalThis.__pushCb = globalThis.__pushCb ?? {};
      globalThis.__pushCb[event] = cb;
      return Promise.resolve({ remove: () => {} });
    }),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';

describe('ensureRegistered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__pushCb = {};
  });

  it('does not prompt if already granted', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    expect(PushNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(PushNotifications.register).toHaveBeenCalled();
  });

  it('prompts once if permission is prompt-able', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    PushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
    Preferences.get.mockResolvedValue({ value: null });
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    expect(PushNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'push_prompted', value: 'true' });
  });

  it('does not prompt twice (respects prior denial)', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'denied' });
    Preferences.get.mockResolvedValue({ value: 'true' });
    const api = { register: vi.fn() };
    await ensureRegistered({ api, jwt: 't' });
    expect(PushNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(PushNotifications.register).not.toHaveBeenCalled();
  });

  it('registers token with backend on `registration` event', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    await globalThis.__pushCb['registration']({ value: 'a'.repeat(64) });
    expect(api.register).toHaveBeenCalledWith({ apns_token: 'a'.repeat(64) });
  });
});

describe('getCurrentApnsToken', () => {
  it('returns the most recent token registered in this session', async () => {
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
    PushNotifications.register.mockResolvedValue(undefined);
    const api = { register: vi.fn().mockResolvedValue({ ok: true }) };
    await ensureRegistered({ api, jwt: 't' });
    const tok = 'b'.repeat(64);
    await globalThis.__pushCb['registration']({ value: tok });
    expect(getCurrentApnsToken()).toBe(tok);
  });
});
```

- [ ] **Step 2:** Create `apps/recipe-ui/src/lib/pushClient.js`

```js
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';

let currentToken = null;

/**
 * Ensures the device is registered to receive pushes.
 * - If not prompted before AND permission is 'prompt', prompts once.
 * - If granted, calls register() and listens for the APNs token.
 * - On receiving a token, POSTs to /devices/register.
 * @param {{ api: { register: (body: {apns_token: string}) => Promise<any> }, jwt: string }} args
 */
export async function ensureRegistered({ api, jwt }) {
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === 'granted') {
    await register(api);
    return;
  }
  if (receive === 'denied') return;  // user already said no

  // prompt-able
  const prompted = await hasPromptedForPermission();
  if (prompted) return;
  const { receive: afterPrompt } = await PushNotifications.requestPermissions();
  await Preferences.set({ key: 'push_prompted', value: 'true' });
  if (afterPrompt === 'granted') await register(api);
}

async function register(api) {
  await PushNotifications.register();
  await PushNotifications.addListener('registration', async ({ value }) => {
    currentToken = value;
    await api.register({ apns_token: value });
  });
}

export async function hasPromptedForPermission() {
  const { value } = await Preferences.get({ key: 'push_prompted' });
  return value === 'true';
}

export function getCurrentApnsToken() {
  return currentToken;
}

/**
 * Register a handler for notification taps. Wire to the shared deep-link dispatcher.
 */
export function onNotificationTap(handler) {
  return PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const link = notification.data?.deep_link;
    if (link) handler(link);
  });
}
```

- [ ] **Step 3:** Tests pass

```bash
cd apps/recipe-ui && npm test -- pushClient
```

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/src/lib/pushClient.js apps/recipe-ui/src/lib/pushClient.test.js
git commit -m "feat(push): client module — registration + token capture"
```

## Task 2: Soft-prompt banner component

Apple's guidance: **don't prompt on launch**. Prompt after a social action when the value is obvious.

- [ ] **Step 1:** Create `apps/recipe-ui/src/components/NotificationSoftPrompt.jsx`

```jsx
import { Alert, Button, Snackbar } from '@mui/material';

export function NotificationSoftPrompt({ open, onAccept, onDismiss, context }) {
  const copy = {
    'friend-request-sent':   'Get notified when your friend accepts?',
    'recipe-shared':         'Get notified when friends share recipes with you?',
    'recipe-saved':          'Get notified when friends save your recipes?',
  }[context] ?? 'Get notifications from ReciFriend?';

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      onClose={onDismiss}
      autoHideDuration={8000}
    >
      <Alert severity="info" action={<>
        <Button color="inherit" size="small" onClick={onDismiss}>Not now</Button>
        <Button color="inherit" size="small" onClick={onAccept}>Yes</Button>
      </>}>
        {copy}
      </Alert>
    </Snackbar>
  );
}
```

- [ ] **Step 2:** Commit

```bash
git add apps/recipe-ui/src/components/NotificationSoftPrompt.jsx
git commit -m "feat(push): soft-prompt banner component"
```

## Task 3: Wire into App.jsx

- [ ] **Step 1:** Add state + handlers inside S11 markers in App.jsx:

```jsx
// === [S11] Push client ===
import { ensureRegistered, getCurrentApnsToken, onNotificationTap, hasPromptedForPermission } from './lib/pushClient';
import { NotificationSoftPrompt } from './components/NotificationSoftPrompt';
// === [/S11] ===
```

- [ ] **Step 2:** Inside the App component:

```jsx
// === [S11] Push client ===
const [softPromptOpen, setSoftPromptOpen] = useState(false);
const [softPromptContext, setSoftPromptContext] = useState(null);

const pushApi = {
  register: ({ apns_token }) =>
    fetch(`${apiBase}/devices/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apns_token }),
    }).then(r => r.json()),
};

async function triggerSoftPromptIfNeeded(context) {
  if (!Capacitor.isNativePlatform()) return;
  if (await hasPromptedForPermission()) return;
  setSoftPromptContext(context);
  setSoftPromptOpen(true);
}

async function handleSoftPromptAccept() {
  setSoftPromptOpen(false);
  await ensureRegistered({ api: pushApi, jwt });
}

// Called by sign-out (S09)
async function getApnsTokenForSignOut() {
  return getCurrentApnsToken();
}

// Wire notification taps to the same dispatcher as deep links
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  let sub;
  (async () => {
    sub = await onNotificationTap((deepLinkUrl) => {
      // Reuse S09 dispatcher — defined in the same App component
      dispatchDeepLink(deepLinkUrl);
    });

    // If already granted (e.g., from a previous session), re-register silently
    await ensureRegistered({ api: pushApi, jwt });
  })();
  return () => { sub?.remove(); };
}, [jwt]);
// === [/S11] ===
```

- [ ] **Step 3:** Render the soft prompt:

```jsx
{/* === [S11] === */}
<NotificationSoftPrompt
  open={softPromptOpen}
  context={softPromptContext}
  onAccept={handleSoftPromptAccept}
  onDismiss={() => setSoftPromptOpen(false)}
/>
{/* === [/S11] === */}
```

- [ ] **Step 4:** Trigger soft prompt from existing action handlers:
  - After sending a friend request → `triggerSoftPromptIfNeeded('friend-request-sent')`
  - After sharing a recipe (from S04 `FriendPicker`'s success callback) → `triggerSoftPromptIfNeeded('recipe-shared')`

Use grep to find the existing handlers and add the trigger inside S11 markers.

- [ ] **Step 5:** Sync iOS + test on device

```bash
cd apps/recipe-ui && npm run build
cd ../ios && npx cap sync ios
# Xcode Cmd-R on device
```

## Task 4: End-to-end push tests on device

- [ ] **Step 1:** With two test accounts, log in as A on your phone and B on a second phone (or iOS simulator — but simulator can't receive pushes, so second phone ideal).

- [ ] **Step 2:** Trigger friend request A → B. Expect:
  - A first sees soft prompt "Get notified when your friend accepts?" → tap Yes → iOS native prompt appears → Allow.
  - B receives a push: "<A's name> wants to connect on ReciFriend".
  - B taps the push → ReciFriend opens to friend-requests screen.

- [ ] **Step 3:** Trigger recipe save — B accepts, then saves one of A's recipes. A receives push: "B saved your <recipe>". A taps → opens to that recipe.

- [ ] **Step 4:** Trigger recipe share — A shares a recipe with B. B receives push: "A just shared a <recipe> with you. View >". B taps → opens to that recipe.

## Task 5: Sign-out integration (finalize S09 + S11 coupling)

- [ ] **Step 1:** In App.jsx, inside the S09 `signOut` function, replace the placeholder `getCurrentApnsToken` call with the real one:

```jsx
// === [S09] Capacitor auth ===
async function signOut() {
  if (Capacitor.isNativePlatform()) {
    const token = getCurrentApnsToken();  // from pushClient
    if (token) {
      await fetch(`${apiBase}/devices/register`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apns_token: token }),
      });
    }
  }
  await supabase.auth.signOut();
}
// === [/S09] ===
```

- [ ] **Step 2:** Commit

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(push): wire soft prompt, registration, tap dispatch, sign-out cleanup"
```

## Acceptance criteria (Gate G5)

- [ ] All pushClient tests pass
- [ ] Soft prompt appears after a social action, not on cold launch
- [ ] Only one prompt per install (even if user denies, no re-prompt)
- [ ] APNs token is sent to `/devices/register` after user grants permission
- [ ] Three pushes deliver on a real device (friend-req, saved, shared)
- [ ] Tapping a push opens the right screen — routed through S06 validator
- [ ] Sign-out calls `DELETE /devices/register` with the current token
- [ ] S11 markers wrap all App.jsx edits

## Commit checklist

- `feat(push): client module — registration + token capture`
- `feat(push): soft-prompt banner component`
- `feat(push): wire soft prompt, registration, tap dispatch, sign-out cleanup`
