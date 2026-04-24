# Share Extension Logged-Out Sign-In — Design

**Date:** 2026-04-24
**Scope:** iOS share extension (`apps/ios/ios/App/ShareExtension/`), iOS main app plugin (`apps/ios/ios/App/App/Plugins/SharedAuthStore/`), and frontend (`apps/recipe-ui/src/App.jsx`). Web unchanged.

## Problem

When a user who is not signed in to the main ReciFriend app invokes the native share extension on a reel:

1. `SharedKeychain.readJwt()` throws `.notFound` (no JWT has been written to the shared keychain).
2. `ShareFormViewModel.surfaceAndFallback(reason:)` flashes a red debug caption for ~2.5s, then deep-links `recifriend://add-recipe?url=<raw>` to the main app ([ShareFormView.swift:49-51](apps/ios/ios/App/ShareExtension/ShareFormView.swift#L49-L51)).
3. The main app's `onAddRecipe` handler opens the Add Recipe drawer unconditionally ([App.jsx:1412](apps/recipe-ui/src/App.jsx#L1412)) — with no session, Gemini enrichment fails silently, and tapping Save writes an "Untitled" recipe with no thumbnail and no ingredients.
4. Race condition: if the deep link arrives before the Capacitor `appUrlOpen` listener is wired, the URL is lost and the user lands on the logged-out homepage with no prompt at all.

The result: data loss (untitled save) or silent failure (no drawer). No sign-in prompt anywhere.

## Goal

A user who is not signed in when they invoke the share extension should:

1. See a clear "Sign in on ReciFriend to save" prompt inside the share sheet itself — no fallback flash, no data loss.
2. Tap one button to open the main app.
3. Be greeted by the existing auth dialog (Google / Apple / magic link) with a subtitle explaining *why* they're signing in.
4. After a successful sign-in, land in the Add Recipe drawer pre-filled with the URL *and* the title they edited in the share sheet — so the save they started actually completes.

## Non-goals

- Any change to the logged-in happy path (JWT present, worker returns 200) — today's flow is unchanged.
- Any change to the web experience. Web shares don't use the native extension.
- In-extension sign-in via ASWebAuthenticationSession. We open the main app for auth instead of embedding OAuth in the extension.
- Preserving anything beyond URL and title. Preview image, ingredients, and steps are re-fetched by the main app's Gemini enrichment after the drawer opens.
- Handling the case where the user has a JWT but Supabase's refresh token is expired. Today's worker-401 path already clears the JWT and falls back; we extend that path to also write pending share data (see "Other failure paths" below).

## Storage mechanism: App Group shared UserDefaults

**Why App Group and not deep-link query parameters:** the extension → main app handoff is race-prone. Capacitor's `appUrlOpen` listener is registered after React hydrates, so a deep link fired while the main app is cold-booting can be lost. Writing the pending share to App Group UserDefaults *before* firing the deep link makes the handoff race-free — the main app reads from shared storage on init regardless of whether the deep link is ever delivered.

**Configuration:**

- App Group identifier: `group.com.recifriend.app` — already present in both `App.entitlements` and `ShareExtension.entitlements`. No entitlement changes required.
- UserDefaults suite: `UserDefaults(suiteName: "group.com.recifriend.app")`.
- Single key: `pending_share.v1` holding a JSON-encoded dictionary:
  ```json
  { "url": "https://www.tiktok.com/...", "title": "Creamy tuscan chicken", "createdAt": 1713984000 }
  ```
- `createdAt` is a Unix timestamp (seconds). Used for the 24-hour age guard (see "Main app drain logic").

**Why a version suffix (`.v1`):** the JSON shape may evolve (e.g., to carry preview imageUrl later). A bump to `.v2` lets an older extension/app combination ignore what it doesn't recognize instead of crashing on decode.

## Component changes

### 1. New Swift helper: `SharedPendingShare.swift`

New file at `apps/ios/ios/App/Shared/SharedPendingShare.swift`, added to **both** the main App target and the ShareExtension target via Xcode's Target Membership (the main app reads, the extension writes). No other files move — `SharedKeychain.swift` stays in the ShareExtension target because the main app accesses the keychain through `SharedAuthStorePlugin`, not through that helper.

API:

```swift
struct PendingShare: Codable {
    let url: String
    let title: String
    let createdAt: TimeInterval
}

enum SharedPendingShare {
    static let appGroupId = "group.com.recifriend.app"
    static let key = "pending_share.v1"

    static func write(url: String, title: String) { ... }
    static func read() -> PendingShare? { ... }
    static func clear() { ... }
}
```

- `read()` returns `nil` on decode failure (forward/backward compatibility).
- `write()` always overwrites — there's only ever one pending share at a time. A second share before the first is consumed replaces it, which matches user expectation ("the one I just tapped is the one I want").

### 2. Extension UI changes (`ShareFormView.swift`, `ShareFormViewModel.swift`)

**View model — new state:**

```swift
@Published var needsSignIn: Bool = false
```

**View model — `save()` path on `.notFound`:**

Instead of `surfaceAndFallback(reason:)`, the `.notFound` branch sets `needsSignIn = true` and keeps the form mounted. No timer, no auto-dismiss.

```swift
} catch SharedKeychainError.notFound {
    await MainActor.run { self.needsSignIn = true }
    return
}
```

**View model — new action `signIn()`:**

Writes the current title + source URL to App Group storage, then fires a deep link to the main app, then completes the extension request.

```swift
func signIn() {
    let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedTitle = titleSnapshot.isEmpty ? (sourceURL.host ?? "Recipe") : titleSnapshot
    SharedPendingShare.write(url: sourceURL.absoluteString, title: resolvedTitle)
    onFinish(.signIn)
}
```

A new outcome `ShareViewController.Outcome.signIn` opens `recifriend://open-pending-share` (new scheme host — see "Deep link handling" below) and completes the extension request.

**View — logged-out state:**

When `viewModel.needsSignIn == true`:

- The red error caption is replaced by a neutral secondary-color banner under the title field: **"Sign in on ReciFriend to save"**.
- The nav-bar checkmark is replaced by a text button labeled **"Sign in"** (same `.glassProminent` style on iOS 26+, always enabled, tints blue).
- Title field remains editable so the user's edits are not lost — they're written to App Group storage on tap.

### 3. Other failure paths — unchanged except worker-401

The worker-401 path (JWT exists but Supabase refresh token is stale) today: `SharedKeychain.clearJwt()` + `surfaceAndFallback("worker 401 (jwt expired)")`. 

**New behavior:** also call `SharedPendingShare.write(url:title:)` before fallback, so the user doesn't lose their draft after re-authenticating. The fallback still fires today's deep link (`recifriend://add-recipe?url=<raw>`) — the main app's drain logic (see below) reads App Group storage on init and will pre-fill the drawer whether or not the deep link arrives.

`readFailed` and `corruptData` keep today's behavior verbatim — these mean "something is broken with keychain access," not "user isn't logged in." Showing "Sign in" there would be misleading.

### 4. New plugin methods: `SharedAuthStorePlugin`

Add two methods to `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift` and register them in the `.m` bridge file:

```swift
@objc func readPendingShare(_ call: CAPPluginCall)
@objc func clearPendingShare(_ call: CAPPluginCall)
```

- `readPendingShare` resolves `{ url, title, createdAt }` if present, rejects `"no-pending-share"` if absent or decode fails.
- `clearPendingShare` resolves unconditionally (idempotent).

These live on `SharedAuthStorePlugin` rather than a new plugin because the plugin already owns the cross-target shared-state surface for auth. Adding a second plugin would mean duplicate registration boilerplate for no gain.

### 5. JS wrapper: `apps/recipe-ui/src/lib/pendingShare.js`

Thin Capacitor-aware wrapper — returns `null` on web, calls the plugin on native:

```js
import { Capacitor, registerPlugin } from '@capacitor/core';

const SharedAuthStore = registerPlugin('SharedAuthStore');

export async function readPendingShare() {
  if (!Capacitor.isNativePlatform()) return null;
  try { return await SharedAuthStore.readPendingShare(); }
  catch { return null; } // "no-pending-share" or decode failure
}

export async function clearPendingShare() {
  if (!Capacitor.isNativePlatform()) return;
  try { await SharedAuthStore.clearPendingShare(); } catch {}
}
```

Keeps `App.jsx` free of inline Capacitor checks.

### 6. Main app: drain + gate (`App.jsx`)

**New state:** `pendingShare: { url, title, createdAt } | null`.

**Populate from two sources, unified:**

- On mount (inside the existing Capacitor native-detect effect): `readPendingShare()` → `setPendingShare(...)`.
- Deep link `recifriend://add-recipe?url=...&title=...`: the `onAddRecipe` handler (currently at [App.jsx:1412](apps/recipe-ui/src/App.jsx#L1412)) stops opening the drawer directly — it sets `pendingShare` instead. (Today's deep link has only `?url=`; we extend the shared `deepLink.ts` schema to optionally parse `&title=`.)

Both sources feed the same state, so both go through the same drain effect.

**Drain:**

```js
useEffect(() => {
  if (!pendingShare) return;
  const ageMs = Date.now() - pendingShare.createdAt * 1000;
  if (ageMs > 24 * 60 * 60 * 1000) {
    clearPendingShare();
    setPendingShare(null);
    return;
  }
  if (session) {
    // Pre-fill the drawer and open it. Gemini auto-enrich runs as it does today.
    setNewRecipeForm(prev => ({ ...prev, sourceUrl: pendingShare.url, title: pendingShare.title }));
    setNewRecipeErrors({});
    setIsAddDialogOpen(true);
    clearPendingShare();
    setPendingShare(null);
  } else {
    openAuthDialog({ reason: `Sign in to save "${pendingShare.title}"` });
  }
}, [pendingShare, session]);
```

- 24-hour age guard prevents a weeks-old pending share from surprise-popping a drawer.
- The auth dialog takes a new optional `reason` prop (additive change — existing call sites omit it). When present, the dialog renders a subtitle at the top.
- If the user dismisses the auth dialog without signing in, a close handler clears `pendingShare` (and App Group storage).

**Why go through state rather than calling functions directly:** the deep-link dispatcher runs during render/mount; calling `setIsAddDialogOpen` from there competes with session hydration. Funnelling everything through `pendingShare` + a single `useEffect` means the gate runs exactly when both `pendingShare` and `session` are known.

### 7. Auth dialog: add `reason` prop

The auth dialog is inline in `App.jsx` (not a separate component file). Add an `authDialogReason: string | null` state; `openAuthDialog({ reason })` sets it, the dialog's close handler clears it. Render the reason as a subtitle under the dialog title:

> *Sign in to save "Creamy tuscan chicken"*

Pure UI addition — no impact on sign-in logic itself. Google / Apple / magic link all route through `onAuthStateChange` → session becomes available → the drain effect fires → drawer opens. Magic link works without special handling: the `verifyOtp` path at [App.jsx:1320](apps/recipe-ui/src/App.jsx#L1320) produces a session like the OAuth paths do.

### 8. Deep link handling

Two deep-link paths coexist:

- **New — `recifriend://open-pending-share`** (no query params): fired by the share extension after writing to App Group. The main app's `deepLinkDispatch` adds a new `open_pending_share` kind whose handler is a no-op — the real work happens in the mount-time `readPendingShare()` drain. Having an explicit deep link kind (rather than reusing `recifriend://add-recipe`) keeps the meaning unambiguous: "there's a pending share, check App Group."
- **Existing — `recifriend://add-recipe?url=...&title=...`**: still accepted for backward compatibility and for non-extension callers (e.g., a user sharing a URL into ReciFriend from Messages). The handler sets `pendingShare` from query params.

## Edge cases

| Case | Behavior |
|---|---|
| User shares while logged in | Today's happy path — unchanged. No App Group write. |
| User shares while logged out, dismisses extension, opens app manually within 24h | Mount-time `readPendingShare()` finds the record → auth dialog opens with subtitle → sign in → drawer pre-fills. |
| User shares while logged out, dismisses extension, opens app after 24h | Age guard clears the stale record without prompting. |
| User shares, signs in, shares another before drawer closes | Second share overwrites the first in App Group. The drawer is still open on the first URL — acceptable, the user must save or cancel to see the second one (matches iOS norms for single-modal flows). |
| Keychain `readFailed` / `corruptData` | Today's behavior — flash debug reason, fall back to `recifriend://add-recipe?url=<raw>`. These are "broken," not "logged out." |
| Worker returns 401 (stale refresh token) | `SharedKeychain.clearJwt()` + `SharedPendingShare.write()` + fallback deep link. Main app drains on next mount → auth dialog → drawer. |
| User dismisses the auth dialog without signing in | `clearPendingShare()` + `setPendingShare(null)`. No ghost record. |
| App cold-booted by the extension's deep link | Mount-time drain picks up the App Group record even if `appUrlOpen` fires too early. |
| User on web | `pendingShare.js` returns `null` on `!isNativePlatform()`. All logic no-ops. Web deep links don't use App Group. |

## Testing

**Swift coverage:** there is no existing iOS test target in this project and adding one is out of scope. `SharedPendingShare` is exercised through the manual test matrix below (cold-boot drain, 24h age guard, and dismiss cases all depend on correct read/write/clear behavior) and through the Vitest-level coverage of `pendingShare.js`, which calls the plugin method that wraps the Swift helper.

**Vitest** (`apps/recipe-ui/src/lib/pendingShare.test.js`):

- Web (`Capacitor.isNativePlatform()` mocked to false): `readPendingShare()` returns null without calling the plugin.
- Native, plugin rejects with `"no-pending-share"`: returns null (no throw).
- Native, plugin resolves with payload: returns the payload.
- `clearPendingShare()` swallows plugin errors silently.

**Manual test matrix** (documented alongside the plan, runs on device):

1. **Fresh logged-out share, Google sign-in** — TikTok → Share → ReciFriend. Verify the "Sign in on ReciFriend to save" banner and Sign in button. Tap Sign in → main app opens → auth dialog shows with subtitle. Sign in with Google → Add Recipe drawer opens pre-filled with URL and edited title.
2. **Apple sign-in** — same as above, use Apple. Drawer pre-fills.
3. **Magic link** — same as above, use magic link. Tap the email link, return to the app. Drawer pre-fills.
4. **Cold-boot race** — force-quit the main app. Share from TikTok → Sign in → main app cold-boots. Drawer still pre-fills (drain-on-mount).
5. **24h age guard** — write a pending share with `createdAt` set to 25h ago (via debug hook or by manipulating UserDefaults). Cold-boot the app. No auth dialog, no drawer.
6. **Dismiss auth dialog** — trigger case 1, dismiss the dialog without signing in. App Group storage cleared. Re-open the app — no prompt.
7. **Logged-in happy path** — today's flow. Verify no regression: share → toast "Recipe saved!" → auto-dismiss.
8. **Worker-401 path** — manually stale the JWT (edit it via the plugin). Share → worker rejects → App Group written → fallback deep link → main app → auth dialog → drawer pre-fills on sign-in.
9. **Keychain missing-entitlement (`-34018`)** — intentionally misconfigure provisioning profile. Share → red debug caption + fallback (today's behavior preserved).

## Files touched

**iOS (Swift):**

- New — `apps/ios/ios/App/Shared/SharedPendingShare.swift` (membership: main App + ShareExtension)
- Edit — `apps/ios/ios/App/ShareExtension/ShareFormView.swift` (needsSignIn state + logged-out UI)
- Edit — `apps/ios/ios/App/ShareExtension/ShareViewController.swift` (Outcome.signIn, `recifriend://open-pending-share`)
- Edit — `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift` (readPendingShare, clearPendingShare)
- Edit — `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m` (register new methods)
- Entitlements — no change. Both targets already include `group.com.recifriend.app` under `com.apple.security.application-groups`.

**Frontend (JS):**

- New — `apps/recipe-ui/src/lib/pendingShare.js`
- New — `apps/recipe-ui/src/lib/pendingShare.test.js`
- Edit — `apps/recipe-ui/src/App.jsx` (pendingShare state, drain effect, `onAddRecipe` routing change, auth dialog `reason` prop wiring, auth dialog JSX subtitle — the dialog is inline in this file, not a separate component)
- Edit — `apps/shared/deepLink.ts` (parse optional `&title=` on add-recipe; new `open_pending_share` kind)
- Edit — `apps/shared/deepLink.test.ts` (coverage for new fields + kind)
- Edit — `apps/recipe-ui/src/lib/deepLinkDispatch.js` (`onOpenPendingShare` handler — no-op)
- Edit — `apps/recipe-ui/src/lib/deepLinkDispatch.test.js` (coverage for new kind)

## Rollout

- Ship iOS build + frontend together — they're coupled by the plugin contract.
- Backward compatibility: old extension builds that fire `recifriend://add-recipe?url=<raw>` still work because that path is preserved (routed through `pendingShare` rather than straight to the drawer). Old main-app builds that don't know about App Group storage simply never call `readPendingShare`; the new extension's App Group writes become dead records that self-clear via the 24h age guard.
- No worker changes. No D1 migration. No KV changes.
