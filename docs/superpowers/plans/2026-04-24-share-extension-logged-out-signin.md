# Share Extension Logged-Out Sign-In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent-failure flow (untitled recipe saved, or no drawer at all) when a logged-out user invokes the iOS share extension with a clean "Sign in on ReciFriend to save" UX that preserves the user's URL and title across OAuth.

**Architecture:** The share extension writes `{ url, title, createdAt }` to App Group UserDefaults (race-free handoff), then deep-links the main app. The main app reads App Group storage on mount into a single `pendingShare` state, which a `useEffect([pendingShare, session])` drains by either (a) pre-filling + opening the Add Recipe drawer when a session exists, or (b) opening the existing auth dialog with a `"Sign in to save «title»"` subtitle. Google, Apple, and magic link all produce a session via `onAuthStateChange` → the drain effect fires → drawer opens.

**Tech Stack:** Swift 5 (iOS share extension + Capacitor plugin), React + JS (main app), TypeScript (shared deep-link schema), Vitest (JS tests), wrangler/Xcode for build.

**Spec:** [docs/superpowers/specs/2026-04-24-share-extension-logged-out-signin-design.md](../specs/2026-04-24-share-extension-logged-out-signin-design.md)

---

## File structure

**New files:**
- `apps/ios/ios/App/Shared/SharedPendingShare.swift` — App Group helper (membership: main App + ShareExtension)
- `apps/recipe-ui/src/lib/pendingShare.js` — JS wrapper around `SharedAuthStore.readPendingShare` / `clearPendingShare`
- `apps/recipe-ui/src/lib/pendingShare.test.js` — Vitest coverage

**Modified files:**
- `apps/shared/deepLink.ts` — parse optional `&title=`, new `open_pending_share` kind
- `apps/shared/contracts.ts` — add `open_pending_share` to `DeepLink` union; add `title?: string` to `add_recipe` variant
- `apps/shared/deepLink.test.ts` — coverage for new fields + kind
- `apps/recipe-ui/src/lib/deepLinkDispatch.js` — new `onOpenPendingShare` handler, pass `title` to `onAddRecipe`
- `apps/recipe-ui/src/lib/deepLinkDispatch.test.js` — coverage
- `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift` — add `readPendingShare`, `clearPendingShare`
- `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m` — register new methods
- `apps/ios/ios/App/ShareExtension/ShareFormView.swift` — `needsSignIn` state, logged-out UI, `signIn()` action, pending-share write on worker-401
- `apps/ios/ios/App/ShareExtension/ShareViewController.swift` — `Outcome.signIn`, fire `recifriend://open-pending-share`
- `apps/recipe-ui/src/App.jsx` — `pendingShare` state, mount drain, drain effect, route `onAddRecipe` through state, auth-dialog `reason` subtitle

---

## Task 1: Add `open_pending_share` kind + optional `title` to the shared deep-link schema (TDD)

**Files:**
- Modify: `apps/shared/contracts.ts:55-60`
- Modify: `apps/shared/deepLink.ts:51-56`
- Test: `apps/shared/deepLink.test.ts`

- [ ] **Step 1.1: Write failing tests**

Append to `apps/shared/deepLink.test.ts`:

```ts
describe('parseDeepLink — /add-recipe with optional title', () => {
  it('parses url only (backward compatible)', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x',
    });
  });
  it('parses url and title', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=Creamy%20pasta')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x', title: 'Creamy pasta',
    });
  });
  it('ignores empty title', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/x',
    });
  });
  it('caps absurdly long title at 200 chars', () => {
    const long = 'a'.repeat(500);
    const result = parseDeepLink(`recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=${long}`);
    expect(result?.kind).toBe('add_recipe');
    expect((result as { title?: string }).title?.length).toBe(200);
  });
});

describe('parseDeepLink — /open-pending-share', () => {
  it('accepts via custom scheme', () => {
    expect(parseDeepLink('recifriend://open-pending-share')).toEqual({
      kind: 'open_pending_share',
    });
  });
  it('accepts trailing slash', () => {
    expect(parseDeepLink('recifriend://open-pending-share/')).toEqual({
      kind: 'open_pending_share',
    });
  });
  it('ignores query params on this path', () => {
    expect(parseDeepLink('recifriend://open-pending-share?foo=bar')).toEqual({
      kind: 'open_pending_share',
    });
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cd apps/shared && npx vitest run deepLink.test.ts`
Expected: new tests fail — title is not returned, and `/open-pending-share` returns null.

- [ ] **Step 1.3: Extend `DeepLink` union in contracts.ts**

Replace lines 55–60 of `apps/shared/contracts.ts`:

```ts
export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string; title?: string }
  | { kind: 'friend_requests' }
  | { kind: 'recipe_detail'; recipe_id: string }
  | { kind: 'recipes_list' }
  | { kind: 'open_pending_share' };
```

Add `/open-pending-share` to `ALLOWED_DEEP_LINK_PATHS` on line 47–51:

```ts
export const ALLOWED_DEEP_LINK_PATHS = new Set<string>([
  '/auth/callback',
  '/add-recipe',
  '/friend-requests',
  '/open-pending-share',
]);
```

- [ ] **Step 1.4: Update parseDeepLink to return title + handle new kind**

Replace the `/add-recipe` block at `apps/shared/deepLink.ts:51-56`:

```ts
  // /add-recipe?url=<http(s)://...>&title=<optional>
  if (fullPath === '/add-recipe' || fullPath === '/add-recipe/') {
    const shared = url.searchParams.get('url');
    if (!shared || !/^https?:\/\//.test(shared)) return null;
    const rawTitle = url.searchParams.get('title') ?? '';
    const title = rawTitle.slice(0, 200);
    return title ? { kind: 'add_recipe', url: shared, title } : { kind: 'add_recipe', url: shared };
  }

  // /open-pending-share — extension hands off via App Group, this is just a wake-up ping
  if (fullPath === '/open-pending-share' || fullPath === '/open-pending-share/') {
    return { kind: 'open_pending_share' };
  }
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `cd apps/shared && npx vitest run deepLink.test.ts`
Expected: all tests pass, including the new ones.

- [ ] **Step 1.6: Commit**

```bash
git add apps/shared/deepLink.ts apps/shared/deepLink.test.ts apps/shared/contracts.ts
git commit -m "shared(deeplink): accept optional title + open-pending-share kind

Title on /add-recipe lets the extension carry the user's edited title
across OAuth. /open-pending-share is a no-op deep link that wakes the
main app when App Group storage holds a pending share."
```

---

## Task 2: Wire the dispatcher for the new kind + title (TDD)

**Files:**
- Modify: `apps/recipe-ui/src/lib/deepLinkDispatch.js`
- Modify: `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`

- [ ] **Step 2.1: Write failing tests**

Append to `apps/recipe-ui/src/lib/deepLinkDispatch.test.js`:

```js
describe('dispatcher — new kinds and title', () => {
  it('passes title through to onAddRecipe when present', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe,
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare: vi.fn(),
    });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx&title=Pasta');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/x', 'Pasta');
  });

  it('passes undefined title when query omits it', async () => {
    const onAddRecipe = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe,
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare: vi.fn(),
    });
    await dispatch('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fx');
    expect(onAddRecipe).toHaveBeenCalledWith('https://tiktok.com/x', undefined);
  });

  it('calls onOpenPendingShare for /open-pending-share', async () => {
    const onOpenPendingShare = vi.fn();
    const dispatch = createDispatcher({
      onAuthCallback: vi.fn(),
      onAddRecipe: vi.fn(),
      onFriendRequests: vi.fn(),
      onRecipeDetail: vi.fn(),
      onRecipesList: vi.fn(),
      onOpenPendingShare,
    });
    await dispatch('recifriend://open-pending-share');
    expect(onOpenPendingShare).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `cd apps/recipe-ui && npx vitest run src/lib/deepLinkDispatch.test.js`
Expected: new tests fail — dispatcher doesn't know about `open_pending_share` and ignores title.

- [ ] **Step 2.3: Update dispatcher to pass title + handle new kind**

Replace `apps/recipe-ui/src/lib/deepLinkDispatch.js` entirely:

```js
import { parseDeepLink } from '../../../shared/deepLink';

/**
 * Creates a deep-link dispatcher bound to UI handlers.
 * @param {{
 *   onAuthCallback: (code: string) => Promise<void>,
 *   onAddRecipe: (url: string, title?: string) => void,
 *   onFriendRequests: () => void,
 *   onRecipeDetail: (recipeId: string) => void,
 *   onRecipesList: () => void,
 *   onOpenPendingShare: () => void,
 * }} handlers
 */
export function createDispatcher(handlers) {
  return async function dispatch(urlString) {
    const link = parseDeepLink(urlString);
    if (!link) return; // silently reject anything that doesn't match the allowlist

    switch (link.kind) {
      case 'auth_callback':      return await handlers.onAuthCallback(link.code);
      case 'add_recipe':         return handlers.onAddRecipe(link.url, link.title);
      case 'friend_requests':    return handlers.onFriendRequests();
      case 'recipe_detail':      return handlers.onRecipeDetail(link.recipe_id);
      case 'recipes_list':       return handlers.onRecipesList();
      case 'open_pending_share': return handlers.onOpenPendingShare();
    }
  };
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `cd apps/recipe-ui && npx vitest run src/lib/deepLinkDispatch.test.js`
Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add apps/recipe-ui/src/lib/deepLinkDispatch.js apps/recipe-ui/src/lib/deepLinkDispatch.test.js
git commit -m "ui(deeplink): dispatch open_pending_share + forward title

Forwards the optional title parsed from /add-recipe to onAddRecipe so
the drawer pre-fills the title when the share extension carries it."
```

---

## Task 3: JS pendingShare wrapper + Vitest (TDD)

**Files:**
- Create: `apps/recipe-ui/src/lib/pendingShare.js`
- Create: `apps/recipe-ui/src/lib/pendingShare.test.js`

- [ ] **Step 3.1: Write failing tests**

Create `apps/recipe-ui/src/lib/pendingShare.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRead = vi.fn();
const mockClear = vi.fn();
let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
  },
  registerPlugin: () => ({
    readPendingShare: (...a) => mockRead(...a),
    clearPendingShare: (...a) => mockClear(...a),
  }),
}));

let readPendingShare, clearPendingShare;

beforeEach(async () => {
  vi.resetModules();
  mockRead.mockReset();
  mockClear.mockReset();
  isNative = true;
  ({ readPendingShare, clearPendingShare } = await import('./pendingShare.js'));
});

afterEach(() => {
  vi.resetModules();
});

describe('pendingShare — web platform', () => {
  it('readPendingShare returns null without calling the plugin', async () => {
    isNative = false;
    vi.resetModules();
    ({ readPendingShare } = await import('./pendingShare.js'));
    await expect(readPendingShare()).resolves.toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('clearPendingShare no-ops without calling the plugin', async () => {
    isNative = false;
    vi.resetModules();
    ({ clearPendingShare } = await import('./pendingShare.js'));
    await clearPendingShare();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('pendingShare — native platform', () => {
  it('returns the plugin payload on success', async () => {
    mockRead.mockResolvedValueOnce({ url: 'https://x', title: 'T', createdAt: 123 });
    await expect(readPendingShare()).resolves.toEqual({
      url: 'https://x', title: 'T', createdAt: 123,
    });
  });

  it('returns null when the plugin rejects (no-pending-share)', async () => {
    mockRead.mockRejectedValueOnce(new Error('no-pending-share'));
    await expect(readPendingShare()).resolves.toBeNull();
  });

  it('returns null when the plugin rejects for any other reason', async () => {
    mockRead.mockRejectedValueOnce(new Error('boom'));
    await expect(readPendingShare()).resolves.toBeNull();
  });

  it('clearPendingShare swallows plugin errors', async () => {
    mockClear.mockRejectedValueOnce(new Error('boom'));
    await expect(clearPendingShare()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `cd apps/recipe-ui && npx vitest run src/lib/pendingShare.test.js`
Expected: module-not-found error (pendingShare.js doesn't exist yet).

- [ ] **Step 3.3: Create the wrapper**

Create `apps/recipe-ui/src/lib/pendingShare.js`:

```js
import { Capacitor, registerPlugin } from '@capacitor/core';

const SharedAuthStore = registerPlugin('SharedAuthStore');

export async function readPendingShare() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await SharedAuthStore.readPendingShare();
  } catch {
    return null;
  }
}

export async function clearPendingShare() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SharedAuthStore.clearPendingShare();
  } catch {
    // intentional: idempotent clear, swallow
  }
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `cd apps/recipe-ui && npx vitest run src/lib/pendingShare.test.js`
Expected: all tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/recipe-ui/src/lib/pendingShare.js apps/recipe-ui/src/lib/pendingShare.test.js
git commit -m "ui(lib): pendingShare wrapper around SharedAuthStore plugin

Web returns null; native calls the plugin and swallows errors so
callers see a simple { url, title, createdAt } | null contract."
```

---

## Task 4: `SharedPendingShare.swift` — App Group helper (ShareExtension-side)

**Files:**
- Create: `apps/ios/ios/App/ShareExtension/SharedPendingShare.swift`

**Architectural note:** The Xcode project uses a `PBXFileSystemSynchronizedRootGroup` for `ShareExtension/` — any file in that directory is automatically compiled into the ShareExtension target with no `project.pbxproj` edit required. The App target uses explicit file references, and cross-membership across the sync group and explicit-ref group is fragile. So we do **not** share this file across both targets — instead, the App target's plugin code (Task 5) duplicates the tiny set of constants (app group id, defaults key) and reimplements read/clear inline. The schema is the single source of truth shared between them, pinned by the constants and a comment.

No Swift test target exists — coverage is via the manual matrix in Task 10 and via Vitest on `pendingShare.js` (Task 3), which calls through the plugin that wraps this helper.

- [ ] **Step 4.1: Create the helper file**

Create `apps/ios/ios/App/ShareExtension/SharedPendingShare.swift`:

```swift
import Foundation

// App Group shared UserDefaults read/write for the share extension's
// pending handoff. The main app's SharedAuthStorePlugin duplicates the
// app-group id and defaults key (constants below) because the Xcode
// project's ShareExtension folder is a PBXFileSystemSynchronizedRootGroup
// while the App target uses explicit file refs — sharing a Swift file
// across the two requires fragile project.pbxproj edits. Schema
// (PendingShare JSON) is the single source of truth; keep the constants
// in sync if either side changes.
//
// Versioned key ("v1") leaves headroom for a future schema bump (e.g.,
// carry preview imageUrl) alongside older binaries that will ignore
// what they can't decode.
//
// Entitlement required on both targets:
//   com.apple.security.application-groups = [ group.com.recifriend.app ]
// Verified present in App.entitlements and ShareExtension.entitlements.

struct PendingShare: Codable, Equatable {
    let url: String
    let title: String
    let createdAt: TimeInterval
}

enum SharedPendingShare {
    static let appGroupId = "group.com.recifriend.app"
    static let key = "pending_share.v1"

    private static func defaults() -> UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func write(url: String, title: String) {
        guard let d = defaults() else { return }
        let payload = PendingShare(url: url, title: title, createdAt: Date().timeIntervalSince1970)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        d.set(data, forKey: key)
    }

    static func read() -> PendingShare? {
        guard let d = defaults(), let data = d.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PendingShare.self, from: data)
    }

    static func clear() {
        defaults()?.removeObject(forKey: key)
    }
}
```

- [ ] **Step 4.2: Build to verify compilation**

From the command line:

```bash
cd apps/ios/ios/App && xcodebuild -workspace App.xcworkspace -scheme ShareExtension -configuration Debug -destination 'generic/platform=iOS Simulator' build-for-testing 2>&1 | tail -30
```

Expected: `** TEST BUILD SUCCEEDED **` or at minimum no errors referencing SharedPendingShare.swift (warnings about code signing / provisioning are acceptable for this verification step).

If you don't have access to run xcodebuild, note that the file must compile — the Swift code above is self-contained (imports only Foundation, uses only Codable / UserDefaults) and will be picked up automatically by the synchronized group.

- [ ] **Step 4.3: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/SharedPendingShare.swift
git commit -m "ios(share-ext): App Group helper for pending share handoff

UserDefaults suite keyed pending_share.v1 holding { url, title,
createdAt }. Auto-included in ShareExtension target via the
PBXFileSystemSynchronizedRootGroup. The main-app plugin (next
commit) duplicates the app-group id + key constants because
sharing a Swift file across the sync-group and the App target's
explicit-ref group requires fragile project.pbxproj edits."
```

---

## Task 5: Extend `SharedAuthStorePlugin` with `readPendingShare` + `clearPendingShare`

**Files:**
- Modify: `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift`
- Modify: `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m`

- [ ] **Step 5.1: Add plugin methods (inline App Group access)**

The App target cannot easily import `SharedPendingShare.swift` (it lives in the ShareExtension's synchronized group). Instead, implement the read/clear logic inline using the same constants and schema. Keep the schema identical — if you change field names here, update the extension's `PendingShare` struct too.

Append to `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift` — first add two private constants below the existing `keychain*` constants at the top:

```swift
// MIRRORS apps/ios/ios/App/ShareExtension/SharedPendingShare.swift —
// keep the app-group id and defaults key in sync.
private let pendingShareAppGroupId = "group.com.recifriend.app"
private let pendingShareKey = "pending_share.v1"

// Keep the JSON shape identical to the extension's PendingShare Codable.
private struct PendingSharePayload: Codable {
    let url: String
    let title: String
    let createdAt: TimeInterval
}
```

Then append two methods **before the closing brace of `SharedAuthStorePlugin`**:

```swift
    @objc func readPendingShare(_ call: CAPPluginCall) {
        guard let d = UserDefaults(suiteName: pendingShareAppGroupId),
              let data = d.data(forKey: pendingShareKey),
              let share = try? JSONDecoder().decode(PendingSharePayload.self, from: data) else {
            call.reject("no-pending-share")
            return
        }
        call.resolve([
            "url": share.url,
            "title": share.title,
            "createdAt": share.createdAt,
        ])
    }

    @objc func clearPendingShare(_ call: CAPPluginCall) {
        UserDefaults(suiteName: pendingShareAppGroupId)?.removeObject(forKey: pendingShareKey)
        call.resolve()
    }
```

- [ ] **Step 5.2: Register methods in the Objective-C bridge**

Replace `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m` entirely:

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore",
  CAP_PLUGIN_METHOD(setJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(readPendingShare, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearPendingShare, CAPPluginReturnPromise);
)
```

- [ ] **Step 5.3: Build to verify**

In Xcode: select `App` scheme → `⌘B`. Expected: build succeeds with no warnings about missing `SharedPendingShare` symbols (confirms Task 4 target membership).

- [ ] **Step 5.4: Commit**

```bash
git add apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m
git commit -m "ios(plugin): SharedAuthStore.readPendingShare / clearPendingShare

Reads the App Group payload written by the share extension and
resolves { url, title, createdAt }. Rejects 'no-pending-share' when
the key is missing or JSON decode fails so the JS wrapper can treat
both as null."
```

---

## Task 6: Share extension — `needsSignIn` state + logged-out UI + `signIn()` + new outcome

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/ShareFormView.swift`
- Modify: `apps/ios/ios/App/ShareExtension/ShareViewController.swift`

- [ ] **Step 6.1: Add `needsSignIn` state and `signIn()` action to the view model**

In `apps/ios/ios/App/ShareExtension/ShareFormView.swift`:

Add a new published property to `ShareFormViewModel` right after `errorMessage` at line 12:

```swift
    @Published var needsSignIn: Bool = false
```

Replace the `.notFound` catch block at lines 49–51 with:

```swift
            } catch SharedKeychainError.notFound {
                await MainActor.run {
                    self.needsSignIn = true
                    self.errorMessage = nil
                }
                return
```

Append a new method to `ShareFormViewModel` **before** the closing brace of the class (just after `openInApp()`):

```swift
    func signIn() {
        let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedTitle = titleSnapshot.isEmpty ? (sourceURL.host ?? "Recipe") : titleSnapshot
        SharedPendingShare.write(url: sourceURL.absoluteString, title: resolvedTitle)
        autoDismissTask?.cancel()
        onFinish(.signIn)
    }
```

- [ ] **Step 6.2: Also stash pending share on worker-401**

In the same file, replace the `WorkerClientError.unauthenticated` catch block (was at ~line 83) with:

```swift
            } catch WorkerClientError.unauthenticated {
                SharedKeychain.clearJwt()
                SharedPendingShare.write(
                    url: urlSnapshot,
                    title: titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot
                )
                await MainActor.run {
                    self.needsSignIn = true
                    self.errorMessage = nil
                }
```

Rationale: a stale JWT puts the user in the same "needs to sign in" state — we want the same UI, not the debug-caption fallback.

- [ ] **Step 6.3: Render logged-out UI: banner + Sign in button**

In the same file, replace the `saveToolbarButton` view builder (lines 178–195):

```swift
    @ViewBuilder
    private var saveToolbarButton: some View {
        if viewModel.isSaving {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Saving")
        } else if viewModel.needsSignIn {
            signInToolbarButton
        } else {
            let enabled = !(saveDisabled || viewModel.isSaved)
            saveButtonBase
                .tint(enabled ? Color.blue : Color(.systemGray3))
                .disabled(!enabled)
                .accessibilityLabel(viewModel.isSaved ? "Saved" : "Save")
        }
    }

    @ViewBuilder
    private var signInToolbarButton: some View {
        if #available(iOS 26.0, *) {
            Button("Sign in", action: viewModel.signIn)
                .buttonStyle(.glassProminent)
                .tint(Color.blue)
                .accessibilityLabel("Sign in on ReciFriend")
        } else {
            Button("Sign in", action: viewModel.signIn)
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Sign in on ReciFriend")
        }
    }
```

Replace the error caption block (~lines 134–140) with:

```swift
                if viewModel.needsSignIn {
                    Text("Sign in on ReciFriend to save")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                } else if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                }
```

- [ ] **Step 6.4: Add `Outcome.signIn` and wire it to a new deep link**

In `apps/ios/ios/App/ShareExtension/ShareViewController.swift`:

Extend the `Outcome` enum (lines 101–106):

```swift
    enum Outcome {
        case saved(recipeId: String)
        case cancelled
        case fallback              // A2: open main-app drawer via deep link (legacy)
        case viewInApp(recipeId: String)
        case signIn                // logged-out: write App Group, open sign-in in app
    }
```

Add a new case in the `finish(with:sourceURL:)` switch (lines 108–129), right after the `.viewInApp` case:

```swift
        case .signIn:
            openSignInDeepLink { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
```

Add a new helper method in the controller (after `openRecipeInApp`):

```swift
    private func openSignInDeepLink(completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "recifriend://open-pending-share") else {
            completion(false); return
        }
        openURL(url, completion: completion)
    }
```

- [ ] **Step 6.5: Build the extension target**

In Xcode: select `ShareExtension` scheme → `⌘B`.
Expected: build succeeds.

- [ ] **Step 6.6: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/ShareFormView.swift apps/ios/ios/App/ShareExtension/ShareViewController.swift
git commit -m "ios(share-ext): Sign in button + App Group handoff for logged-out and 401

Detects SharedKeychainError.notFound and WorkerClientError.unauthenticated
as the same 'user must sign in' state. Writes { url, title } to App Group
storage, swaps the checkmark for a 'Sign in' button, and fires
recifriend://open-pending-share to wake the main app.

No more 2.5s debug caption flash, no more silent fallback to an
untitled drawer."
```

---

## Task 7: Main app — `pendingShare` state + mount-time drain

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (around lines 1206–1215, 1438+)

- [ ] **Step 7.1: Add state**

In `apps/recipe-ui/src/App.jsx`, after the existing `[session, setSession]` line (1206), add:

```jsx
  const [pendingShare, setPendingShare] = useState(null);
```

- [ ] **Step 7.2: Read App Group storage on mount**

Add a new `import` near the top of `App.jsx` (group with other `./lib` imports):

```jsx
import { readPendingShare, clearPendingShare } from './lib/pendingShare.js';
```

Add a new `useEffect` near the Capacitor native-detect init effect (search for `Capacitor.isNativePlatform()` around line 1438 to find the right neighborhood). The effect reads once on mount:

```jsx
  useEffect(() => {
    let cancelled = false;
    readPendingShare().then((share) => {
      if (cancelled || !share) return;
      setPendingShare(share);
    });
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 7.3: Build / dev-server smoke test**

Run: `cd apps/recipe-ui && npm run dev`
Expected: no runtime errors in the browser console on load. On web, `readPendingShare()` returns null silently.

- [ ] **Step 7.4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "ui(app): pendingShare state + mount-time App Group drain

Adds the state the drain effect (next commit) and onAddRecipe (after
that) will feed into. Race-free: the App Group read on mount picks up
the extension's handoff even if appUrlOpen fires before the listener
registers."
```

---

## Task 8: Main app — drain effect (session → drawer; no session → auth dialog)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 8.1: Refactor `openAuthDialog` to accept an optional `reason`**

In `apps/recipe-ui/src/App.jsx`, add a new state near `authEmail` / `authError` (around line 1215):

```jsx
  const [authDialogReason, setAuthDialogReason] = useState(null);
```

Replace the `openAuthDialog` function (currently at line 2161–2165) with:

```jsx
  const openAuthDialog = (opts = {}) => {
    setAuthEmail('');
    setAuthError('');
    setAuthDialogReason(opts.reason ?? null);
    setIsAuthDialogOpen(true);
  };
```

Update `closeAuthDialog` (2167–2170) to clear the reason:

```jsx
  const closeAuthDialog = () => {
    setIsAuthDialogOpen(false);
    setAuthEmail('');
    setAuthError('');
    setAuthDialogReason(null);
  };
```

- [ ] **Step 8.2: Render the subtitle in the auth dialog**

Find the auth dialog JSX at around line 6462 (`<Dialog open={isAuthDialogOpen}`). Replace the `<DialogTitle>` block:

```jsx
        <DialogTitle id="auth-dialog-title">
          Sign in
        </DialogTitle>
        {authDialogReason && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 3, pb: 1, mt: -1 }}
          >
            {authDialogReason}
          </Typography>
        )}
        <DialogContent>
```

(`Typography` is already imported in App.jsx — verify with grep if uncertain.)

- [ ] **Step 8.3: Add the drain effect**

Right below the mount-drain effect from Task 7, add:

```jsx
  const PENDING_SHARE_TTL_MS = 24 * 60 * 60 * 1000;

  useEffect(() => {
    if (!pendingShare) return;

    const ageMs = Date.now() - pendingShare.createdAt * 1000;
    if (ageMs > PENDING_SHARE_TTL_MS) {
      clearPendingShare();
      setPendingShare(null);
      return;
    }

    if (session) {
      setNewRecipeForm((prev) => ({
        ...prev,
        sourceUrl: pendingShare.url,
        title: pendingShare.title || prev.title || '',
      }));
      setNewRecipeErrors({});
      setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
      setSourceParseState({ status: 'idle', message: '' });
      setAddRecipeSource('share-extension');
      setIsAddDialogOpen(true);
      clearPendingShare();
      setPendingShare(null);
    } else {
      openAuthDialog({ reason: `Sign in to save "${pendingShare.title}"` });
    }
  }, [pendingShare, session]);
```

- [ ] **Step 8.4: Clear pending share when the user dismisses the auth dialog**

Update `closeAuthDialog` (from Step 8.1) to also clear pendingShare:

```jsx
  const closeAuthDialog = () => {
    setIsAuthDialogOpen(false);
    setAuthEmail('');
    setAuthError('');
    setAuthDialogReason(null);
    if (pendingShare) {
      clearPendingShare();
      setPendingShare(null);
    }
  };
```

- [ ] **Step 8.5: Dev smoke — trigger the drain on web**

Web platforms don't have App Group, but we can force the state to exercise the effect. In the browser console:

```js
// simulate a drain while logged out — should open the auth dialog with subtitle
window.__debugPendingShare?.({
  url: 'https://tiktok.com/test',
  title: 'Test recipe',
  createdAt: Math.floor(Date.now() / 1000),
});
```

Skip this if `__debugPendingShare` isn't wired — iOS device testing in Task 10 is the real verification.

- [ ] **Step 8.6: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "ui(app): drain pendingShare into drawer or auth dialog

One useEffect gates on session: logged in -> pre-fill + open drawer,
logged out -> open existing auth dialog (Google / Apple / magic link)
with a 'Sign in to save \"<title>\"' subtitle. Stale shares (>24h)
self-clear on mount. Dismissing the dialog clears the pending share."
```

---

## Task 9: Route `onAddRecipe` through `pendingShare` (fix the untitled-recipe bug)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:1412-1420`

- [ ] **Step 9.1: Replace the direct drawer-open in the dispatcher**

Replace the `onAddRecipe` handler in the `createDispatcher(...)` call (currently lines 1412–1420):

```jsx
      onAddRecipe: (url, title) => {
        // Route through pendingShare so the session gate in the drain effect
        // handles both logged-in (open drawer) and logged-out (open auth
        // dialog + preserve across OAuth) cases consistently.
        setPendingShare({
          url,
          title: typeof title === 'string' && title.length > 0 ? title : '',
          createdAt: Math.floor(Date.now() / 1000),
        });
      },
      onOpenPendingShare: () => {
        // App Group storage is read on mount; this deep link is just a
        // wake-up ping. If the app was already foregrounded, re-read so
        // an extension fire after the mount effect still drains.
        readPendingShare().then((share) => {
          if (share) setPendingShare(share);
        });
      },
```

- [ ] **Step 9.2: Verify the existing dispatcher call still builds**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds; no type or reference errors.

- [ ] **Step 9.3: Run existing Vitest to check for regressions**

Run: `cd apps/recipe-ui && npx vitest run`
Expected: all tests pass.

- [ ] **Step 9.4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "ui(app): route deep-link onAddRecipe through pendingShare

Fixes the untitled-recipe bug: the dispatcher no longer opens the
drawer unconditionally (which was writing an empty recipe for
logged-out users). Instead it feeds pendingShare, which is gated
by session in the drain effect."
```

---

## Task 10: iOS end-to-end manual test matrix

**Files:** none (device testing)

These tests must pass on a real iOS device with the latest `App` and `ShareExtension` builds installed. Document results inline under each test.

- [ ] **Step 10.1: Build and install on device**

In Xcode: select `App` scheme → device → Product → Run (`⌘R`). Also run the extension:
- Kill the app.
- Select `ShareExtension` scheme → same device → `⌘R`. When Xcode prompts for a host app, pick Safari or TikTok.

- [ ] **Step 10.2: Test case 1 — fresh logged-out share, Google sign-in**

1. Sign out of the main app if necessary (Profile → Sign out). Force-quit the app.
2. In TikTok: open a recipe reel → Share → ReciFriend.
3. Expect: the share sheet shows the thumbnail + editable title + a **"Sign in"** button in the top-right; under the card, the text **"Sign in on ReciFriend to save"**.
4. Edit the title to something distinctive (e.g. "Creamy Pasta Test 1").
5. Tap **Sign in**.
6. Expect: the extension closes and the main app opens; the auth dialog shows with subtitle **Sign in to save "Creamy Pasta Test 1"**.
7. Tap **Sign in with Google** → complete Google OAuth.
8. Expect: the Add Recipe drawer opens pre-filled with the TikTok URL in `sourceUrl` and the title "Creamy Pasta Test 1"; Gemini auto-enrich fires shortly after.
9. Tap Save → the recipe appears in the collection with the correct title (not "Untitled") and a thumbnail.

PASS criteria: all steps above, no silent fallback, no untitled save.

- [ ] **Step 10.3: Test case 2 — Apple sign-in**

Repeat Test 1 but at step 7 use **Continue with Apple**. Same PASS criteria.

- [ ] **Step 10.4: Test case 3 — magic link**

Repeat Test 1 but at step 7 enter email and tap the magic-link option.
- The app sends an email; tap the link in the email app.
- Safari (or the default browser) opens `https://recifriend.com/?token_hash=...&type=magiclink` (or the custom scheme equivalent).
- The link opens back in the ReciFriend app (associated-domains + Universal Link).
- Expect: the drawer opens pre-filled via the drain effect after `verifyOtp` completes.

PASS criteria: drawer pre-fills after magic-link verify.

- [ ] **Step 10.5: Test case 4 — cold-boot race**

1. Sign out. Force-quit the main app (swipe up).
2. From TikTok, share → Sign in (without ever opening the main app first).
3. Expect: main app cold-boots → auth dialog shows with subtitle → sign in → drawer pre-fills.

PASS criteria: no "sometimes no drawer" bug, regardless of boot timing.

- [ ] **Step 10.6: Test case 5 — 24h age guard**

Inject a stale pending share (via Xcode debugger):
1. In Xcode, set a breakpoint in `SharedAuthStorePlugin.readPendingShare` — skip. Easier: use a debug expression in the app's AppDelegate to write to UserDefaults:
   ```swift
   let d = UserDefaults(suiteName: "group.com.recifriend.app")!
   let payload = ["url": "https://tiktok.com/stale", "title": "Stale", "createdAt": Date().timeIntervalSince1970 - 90000] as [String: Any]
   let data = try! JSONSerialization.data(withJSONObject: payload)
   d.set(data, forKey: "pending_share.v1")
   ```
   (90 000 s ≈ 25 h.)

   Note: our Swift helper uses `JSONEncoder` on `PendingShare` (a Codable struct), not `JSONSerialization`. Use `JSONEncoder` with a `PendingShare(url:..., title:..., createdAt: Date().timeIntervalSince1970 - 90000)` instance to match the encoding format exactly.
2. Cold-boot the app.
3. Expect: no auth dialog, no drawer. The stale record self-clears.

PASS criteria: silently drops the stale share.

- [ ] **Step 10.7: Test case 6 — dismiss auth dialog**

1. Trigger Test 1 through step 6 (auth dialog open with subtitle).
2. Tap the X on the dialog (or tap outside).
3. Force-quit the app and re-open.
4. Expect: no auth dialog pops on the next launch; the App Group storage was cleared.

PASS criteria: no ghost record.

- [ ] **Step 10.8: Test case 7 — logged-in happy path regression**

1. Sign in.
2. Share from TikTok → Save.
3. Expect: today's flow — "Recipe saved!" appears on the card, auto-dismiss after 8s, recipe visible in the main app.

PASS criteria: no regression from today's behavior.

- [ ] **Step 10.9: Test case 8 — worker-401 path**

Stale the JWT manually via the debug plugin path (or sign out, then force-write an expired token via the `setJwt` method into the shared keychain using a debug hook). If no debug hook exists, skip — the logic overlap with Test 1 is high enough to accept this as covered indirectly.

If you do run it:
1. Share from TikTok.
2. The extension POST hits `/recipes` and receives 401.
3. Expect: same UI as Test 1 step 3–9 (Sign in banner + button, then auth dialog with subtitle, then pre-filled drawer after sign-in).

PASS criteria: worker-401 surfaces the same Sign in UX, not the debug fallback.

- [ ] **Step 10.10: Test case 9 — keychain missing-entitlement**

This is preserved today's fallback behavior. No direct test — the code path is only triggered by misconfigured provisioning profiles, which an engineer will see explicitly during onboarding. Mark as "covered by code inspection: `SharedKeychainError.readFailed(-34018)` branch untouched."

- [ ] **Step 10.11: Commit test notes**

If you kept device-test notes in a markdown file under `docs/test-runs/`, commit them:

```bash
git add docs/test-runs/2026-04-24-share-extension-logged-out.md  # if created
git commit -m "test(docs): share-ext logged-out flow device test run"
```

Otherwise, skip.

---

## Self-Review

Run through the spec sections and verify each maps to a task:

- **§ "Storage mechanism"** → Task 4 (`SharedPendingShare.swift`), Task 5 (plugin).
- **§ "1. SharedPendingShare.swift"** → Task 4.
- **§ "2. Extension UI changes"** → Task 6.
- **§ "3. Other failure paths — worker-401"** → Task 6 Step 6.2.
- **§ "4. New plugin methods"** → Task 5.
- **§ "5. JS wrapper"** → Task 3.
- **§ "6. Main app: drain + gate"** → Task 7 (mount), Task 8 (drain effect), Task 9 (`onAddRecipe` routing).
- **§ "7. Auth dialog: reason prop"** → Task 8 Steps 8.1 + 8.2.
- **§ "8. Deep link handling"** → Task 1, Task 2, Task 9.
- **§ "Edge cases"** → Task 10 (matrix).
- **§ "Testing"** → Tasks 1, 2, 3 (Vitest); Task 10 (manual matrix). Swift coverage explicitly out of scope per spec.

No gaps identified.

Placeholder scan: all code steps contain actual code; exact file paths given; specific line numbers where precise. No TBD / TODO / "fill in". Type consistency: `pendingShare` shape (`{ url, title, createdAt }`) matches across tasks 3, 4, 5, 7, 8, 9.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-share-extension-logged-out-signin.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
