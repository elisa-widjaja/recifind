# Native Share-Extension Save — Session Learnings (2026-04-23)

## Context

Built and shipped the native-save architecture proposed in
`docs/superpowers/learnings/2026-04-22-share-recipe-learnings.md`. The iOS
share extension now saves recipes inline — no main-app cold start on the
critical path — with silent deep-link fallback to today's drawer flow
whenever the native path can't complete (no JWT, 401, network error).

Spec: `docs/superpowers/specs/2026-04-23-ios-share-extension-native-save-design.md`
Plan: `docs/superpowers/plans/2026-04-23-ios-share-extension-native-save.md`

Final state: on device, share Instagram reel → thumbnail + editable title
render in ~1s → tap Save → sheet dismisses within ~300ms → recipe lands
in the user's collection with background enrichment. User never leaves
Instagram for the happy path.

---

## What shipped and works (on `main`)

### Worker side
- **Rapid re-share dedup** (`16d0a92`, `da91496`). `POST /recipes` collapses
  same-user/same-source_url inserts within 60s into a single row. D1
  index migration applied to prod (`0010_add_recipes_dedup_index.sql`).
- **`enrichAfterSave`** (`83f5dde`, `d28a5cf`). Reuses
  `runEnrichmentChain(captionExtract → youtubeVideo → textInference)`.
  Writes ingredients/steps/meal_types/duration/notes back into D1 when
  the chain returns content. Silent no-op when all strategies return
  empty (B1 per spec).
- **`ctx.waitUntil(enrichAfterSave)` on save** (`c7fe53c`, `259fee4`).
  Gate is `sourceUrl && ingredients.length === 0 && steps.length === 0`
  (AND, not OR — matches the internal empty check and prevents
  overwriting partial web-drawer data).
- **Admin email moved inside `handleCreateRecipe`** (`da91496`). Dedup
  early-return now naturally skips the admin notification.
- **`/recipes/parse` made public** (`14d853e`). Extension has no JWT for
  the preview call; parse has no user-specific data so it's safe.
- Deployed to prod `api.recifriend.com` at version `773ada0e`.

### iOS native side
- **App Group + Keychain Sharing entitlements** on both main-app and
  share-extension targets (`7a4c54f`).
- **`SharedAuthStorePlugin`** — Capacitor plugin (Swift + Obj-C) wrapping
  iOS Keychain with `kSecAttrAccessGroup`. Full service/account/group:
  `com.recifriend.app.auth` / `supabase-jwt` / `7C6PMUN99K.com.recifriend.app.shared`.
- **`SharedKeychain`** — read-only helper for the share extension (no
  Capacitor dep allowed in extension processes).
- **`WorkerClient`** — `/recipes/parse` (2s→4s timeout) and `/recipes`
  (5s timeout, 401 → `WorkerClientError.unauthenticated`).
- **SwiftUI form** — `ShareFormView` + `ShareFormViewModel`. Thumbnail +
  editable title + Save/Cancel. On save failure, surfaces reason
  (`keychain notFound`, `keychain readFailed OSStatus NNNN`, `worker 401`,
  `net <error>`) for 2.5s then deep-links to main app.
- **`ShareViewController` rewrite** — Hosts the SwiftUI form inside a
  `UIHostingController`, preserves the first-URL-wins URL extraction.
- **`MainViewController: CAPBridgeViewController`** — registers the
  inline plugin via `bridge?.registerPluginInstance(...)` in
  `capacitorDidLoad()`. Wired via Main.storyboard.

### Main app (JS) side
- **`SharedAuthStore` wrapper** — `setJwt`/`clearJwt` with write + verify
  round-trip that catches silent plugin-registration regressions.
- **`SharedAuthStore.setJwt` on `getSession().then`** in App.jsx — not
  just `onAuthStateChange`, because Supabase doesn't reliably fire
  `INITIAL_SESSION` with a carried token on cold restore.
- **`SharedAuthStore.clearJwt` on `SIGNED_OUT`** — prevents a stale JWT
  leaking from a logged-out device to the extension.
- **Refetch on `appStateChange → active`** — picks up extension saves
  without manual pull-to-refresh. Uses `syncRecipesFromApi({ forceUpdate: true })`.

### Automation / tooling
- `xcodeproj` Ruby gem used to add plugin + ViewController files to the
  App target and `CODE_SIGN_ENTITLEMENTS` to the ShareExtension target.
  Replaced the manual Xcode drag-drop step entirely.
- `xcodebuild … iphonesimulator CODE_SIGNING_ALLOWED=NO build` used as
  a cheap compile verifier between iterations.

---

## Gotchas discovered — generally useful for future iOS plugin work

These were the seven non-obvious problems that the plan didn't capture.
Most became obvious only after on-device testing.

### 1. `ShareExtension` group is a Xcode 16 file-system-synchronized group
The plan assumed classic target-membership drag-and-drop for every new
Swift file in the share extension. In this project `ShareExtension` is
a `PBXFileSystemSynchronizedRootGroup` — any file dropped into the
folder is automatically part of the target. Saves the drag step but
means you can't selectively exclude files either.

### 2. `ShareFormView.swift` needed explicit `import Combine`
SwiftUI re-exports Combine's `ObservableObject` / `@Published` in most
contexts, but **not reliably inside app extensions**. Build error was
`type 'ShareFormViewModel' does not conform to protocol 'ObservableObject'`.
Add `import Combine` wherever you use `@Published` in an extension.

### 3. `/recipes/parse` must be public for the extension preview
The extension has no JWT at the time it wants to show a preview, so it
can't hit any auth-required route. Fix: gate the auth middleware with
a specific carve-out for `/recipes/parse`. Works because parse has no
user-specific side effects. Any other route we want to call without a
JWT needs the same treatment.

### 4. Swift keychain access groups need the full `<TeamID>.` prefix at runtime
The entitlement file uses `$(AppIdentifierPrefix)com.recifriend.app.shared`,
which Xcode expands at sign time to `7C6PMUN99K.com.recifriend.app.shared`.
**iOS does NOT auto-prepend the Team ID when the Swift code passes
`kSecAttrAccessGroup`.** If the Swift constant is just
`"com.recifriend.app.shared"`, reads and writes land in different
keychain buckets and you get a silent `.notFound` from the extension.

### 5. ShareExtension target may ship with no `CODE_SIGN_ENTITLEMENTS`
Generated Capacitor projects can omit this build setting on non-main
targets. The entitlements file exists on disk but nothing asks codesign
to apply it, so the signed binary has no App Group or keychain groups.
Verify with:

```bash
codesign -d --entitlements :- "$APP/PlugIns/ShareExtension.appex"
```

If the output only contains `application-identifier`, `team-identifier`,
`get-task-allow`, the entitlements aren't wired. Fix by setting
`CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExtension.entitlements`
on both Debug and Release configs.

### 6. `INITIAL_SESSION` in Supabase-js isn't reliable for cold restore
We mirrored the JWT only inside `supabase.auth.onAuthStateChange`, but
in the cold-launch-with-restored-session path Supabase fired
`INITIAL_SESSION` with a null session, then nothing else. The session
was actually present (visible via `getSession()`) but no event ever
carried it. **Fix: also mirror from the `supabase.auth.getSession().then()`
resolver**.

### 7. 🚨 Capacitor 8 doesn't auto-register inline plugins
This was the biggest and last-caught bug. The plan had us add a
`CAP_PLUGIN(...)` macro in the plugin's .m file and assumed that was
enough. It isn't, in Capacitor 8.

In Capacitor 8, plugin discovery reads `capacitor.config.json`'s
`packageClassList` (populated by `cap sync` only for **npm-installed**
plugins), resolves each class via `NSClassFromString`, and registers
them with the bridge. **Inline plugins compiled into the app target
are never in that list.** Result: `"PluginName" plugin is not
implemented on ios` at runtime, even though the class is correctly
compiled and the Obj-C CAP_PLUGIN macro runs.

**Fix: subclass `CAPBridgeViewController`, override `capacitorDidLoad()`,
call `bridge?.registerPluginInstance(PluginClass())`. Update
Main.storyboard to point `customClass` at the subclass.**

See `apps/ios/ios/App/App/MainViewController.swift`.

---

## What didn't work (dead ends)

### 1. Plan's suggested Task-13 `useEffect` placement
The plan said to add the app-resume `useEffect` right after the
`appUrlOpen` listener (~line 1423 of App.jsx). That's BEFORE
`syncRecipesFromApi` is declared (~line 2276), so React render throws
a TDZ error. Moved the effect to line 2388 (just after
`syncRecipesFromApi`). Plan placement was wrong; implementation
deviation was correct.

### 2. Bumping parse timeout to 4s did not fix intermittent failures
The parse endpoint was returning 401, not timing out — we just didn't
know because the extension caught all errors as `badResponse` and fell
back to placeholder UI. Once we made `/recipes/parse` public, the
flakiness disappeared. The 4s bump is still in place as insurance
against cold-network share invocations.

### 3. Looking for "Keychain Sharing" as a portal capability
User searched the Apple Developer portal for "Keychain Sharing"
capability and couldn't find it. Turns out iOS doesn't require a
separate portal opt-in for `keychain-access-groups` — the entitlement
is accepted as long as the access group is prefixed with the Team ID.
Don't burn time on this in the future; only App Groups needs portal
configuration.

---

## Debug pattern that paid off

Pattern: **when a native-JS bridge is silently not working, add a
write-and-verify round-trip plus an on-screen banner with structured
diagnostics.** Specifically:

- `SharedAuthStore.setJwt` → call `setJwt` → immediately call `getJwt`
  → compare lengths → record ok/fail with detail.
- React banner subscribing to the module-level state. Showed:
  `native=true plugin=true` → the JS side was correctly wired.
  `initialResolved=true initialHasToken=false` → getSession had no session.
  `events(2): INITIAL_SESSION/no-tok, SIGNED_IN/tok=1317` → OAuth completed.
  `last: setJwt FAIL — "SharedAuthStore" plugin is not implemented on ios`
  → native registration was missing.

Three bug classes got disambiguated in under a minute of banner-reading
after each rebuild. Committed the banner at `fcf7023`, removed at
`3f60795` once the flow worked. Worth keeping this as a template for
future Capacitor plugin bring-ups.

---

## Commits (in session order)

`16d0a92 worker(recipes): dedup rapid re-shares within 60s on POST /recipes`
`da91496 worker(recipes): tighten dedup test + add index migration + move admin email into handler`
`dc9ac26 test(recipes): assert collection_meta untouched on dedup`
`7a4c54f ios: enable App Group + shared Keychain for main app and share extension`
`83f5dde worker(enrich): add enrichAfterSave for post-save async enrichment`
`d28a5cf worker(enrich): persist notes in enrichAfterSave UPDATE for parity with web save`
`c7fe53c worker(recipes): fire ctx.waitUntil(enrichAfterSave) on save`
`259fee4 worker(recipes): tighten enrichment gate (AND not OR) + strengthen waitUntil test`
`653d25a ios(plugin): add SharedAuthStore Capacitor plugin for shared Keychain JWT`
`79c3085 ios(share-ext): SharedKeychain read/clear helper for JWT`
`79d3325 ios(share-ext): WorkerClient HTTP helpers for /recipes/parse and /recipes`
`1534534 ios(share-ext): SwiftUI form + view model for inline native save`
`ea3fc99 feat(ios): JS wrapper for SharedAuthStore Capacitor plugin`
`fb230f5 feat(ios): mirror Supabase JWT to shared Keychain on auth events`
`dfddb50 feat(ios): refetch recipes on app resume to pick up extension saves`
`e59d710 ios(share-ext): add Combine import + register SharedAuthStorePlugin in App target`
`14d853e worker(parse): make /recipes/parse public so iOS share extension can preview`
`ad8589a ios(share-ext): surface save-failure reason on-screen + bump parse timeout to 4s`
`4c44bef ios(keychain): include Team ID prefix in keychainAccessGroup`
`4b9c8db ios(share-ext): surface exact OSStatus on keychain readFailed`
`6e15628 ios(share-ext): wire CODE_SIGN_ENTITLEMENTS to ShareExtension.entitlements`
`4469150 feat(debug): SharedAuthStore diagnostics banner + initial-session JWT mirror`
`fcf7023 feat(debug): expand SharedAuth banner with initial-session + event log`
`c260654 fix(debug): move SharedAuth banner to bottom + pointer-events none`
`02b3642 debug(banner): enable text selection for copy/paste`
`de76a96 ios: register SharedAuthStorePlugin via CAPBridgeViewController subclass`
`3f60795 chore(debug): remove SharedAuth diagnostics banner + trim wrapper`

---

## TL;DR for the next session

1. **Native share save is working end-to-end.** User tested 12+ shares
   on device. JWT mirror verified via the write-then-read round trip.
   Deep-link fallback still intact for no-token / 401 / timeout.

2. **Known remaining issues (intentionally out of scope):**
   - Instagram `r.jina.ai` rate-limit → enrichment sometimes hallucinates
     ingredients (honeydew + prosciutto from a cucumber-tea-sandwiches
     reel observed once). Next session: the "enrichment-reliability"
     brainstorm.
   - Previously-saved title-only recipes don't get retroactively enriched.
     Will need a manual or scheduled backfill endpoint.

3. **Next session work in order:**
   a. Polish the native share drawer UI (visual pass — spacing, title
      behavior, cancel affordance, placeholder state).
   b. Enrichment reliability brainstorm.
   c. Backfill endpoint for title-only recipes.

4. **Don't break:**
   - `MainViewController` must remain the storyboard's initial view
     controller with module=App. Removing it will silently re-break the
     plugin registration.
   - Keychain access group strings in Swift MUST include the `7C6PMUN99K.`
     prefix. Reverting to just the suffix re-breaks the whole flow
     silently with a `.notFound` on the extension side.
   - `/recipes/parse` must stay public. Moving it back under auth kills
     the extension preview path.
