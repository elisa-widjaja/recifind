# iOS Local Dev Loop

## Project layout note

Capacitor generated the Xcode project at `apps/ios/ios/App/` (one extra `ios/` nesting because
`cap add ios` was run from `apps/ios/`). All commands below account for this.

---

## Dev loop (daily use)

1. Edit React code in `apps/recipe-ui/src/`
2. Build the web app:
   ```bash
   cd apps/recipe-ui && npm run build
   ```
3. Sync assets into the iOS bundle:
   ```bash
   cd apps/ios && npx cap sync ios
   ```
4. In Xcode: select your simulator or device, press **Cmd-R**.

---

## First-time setup: install CocoaPods

macOS ships without CocoaPods. Run ONCE before your first build:

```bash
sudo gem install cocoapods
```

Then, any time Capacitor pulls in new native plugins:

```bash
cd apps/ios/ios/App && pod install
# or from the project root:
cd apps/ios && npx cap sync ios   # runs pod install if CocoaPods is present
```

After pod install, always open `App.xcworkspace` (not `App.xcodeproj`).

---

## One-time Xcode setup (required before first build)

### 1. Install CocoaPods and run pod install

CocoaPods is required to resolve native Capacitor dependencies.

```bash
sudo gem install cocoapods
cd apps/ios/ios/App && pod install
```

After this, always open `App.xcworkspace` (not `App.xcodeproj`).

### 2. Set the signing team

1. Open `apps/ios/ios/App/App.xcworkspace` in Xcode.
2. Select the **App** target → **Signing & Capabilities** tab.
3. Set **Team** to `7C6PMUN99K` (ReciFriend).
4. Confirm **Bundle Identifier** is `com.recifriend.app`.

### 3. Add Push Notifications capability

In Xcode: **App target → Signing & Capabilities → + Capability → Push Notifications**.

This registers the `aps-environment` entitlement. The `App.entitlements` file already declares it —
Xcode just needs to know about the capability so it generates the correct provisioning profile.

### 4. Add Associated Domains capability

In Xcode: **App target → Signing & Capabilities → + Capability → Associated Domains**.

Add: `applinks:recifriend.com`

(Already present in `App.entitlements` — the Xcode capability panel must match.)

### 5. Verify PrivacyInfo.xcprivacy is in the App target

`PrivacyInfo.xcprivacy` is already referenced in `project.pbxproj`. Confirm it appears in Xcode's
project navigator under the App group. If not, drag it from Finder into the App group, choosing
"Copy if needed" and checking "Add to App target".

### 6. Verify App.entitlements is in the App target

Same as above — should already be wired via `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in
`project.pbxproj`. Confirm in **Build Settings → Code Signing Entitlements**.

---

## Testing Universal Links (Associated Domains)

AASA file must be served at `https://recifriend.com/.well-known/apple-app-site-association`
(Story 07). Once that is live:

1. Install the app on a real iPhone (simulator does not support Universal Links).
2. Open Safari on the iPhone and type `https://recifriend.com/recipes/seed-edit-01`.
3. iOS shows a banner: "Open in ReciFriend". Tap it.
4. The app opens (white screen is expected until Story 09 wires the deep-link handler).

## Testing custom URL scheme

In Safari on device, enter: `recifriend://friend-requests`

The app should open. Custom schemes work in Simulator too.

---

## Common gotchas

- **Web assets not updating**: run `cap sync` — Capacitor caches aggressively.
- **White screen on launch**: check Xcode console for WebView errors. Ensure `dist/` was built.
- **`pod install` fails**: try `sudo gem install cocoapods` or `brew install cocoapods`.
- **Universal Link opens Safari instead of app**: AASA broken. Check https://branch.io/resources/aasa-validator/
- **Crash on push registration**: APNs entitlement missing from `App.entitlements` or capability not added in Xcode.
- **Build fails with "No signing certificate"**: Team ID not set in Signing & Capabilities.
- **`cap sync` warns "Skipping pod install because CocoaPods is not installed"**: install CocoaPods first, then rerun `cap sync`.

---

## Open Xcode directly

```bash
cd apps/ios && npx cap open ios
```

This opens `apps/ios/ios/App/App.xcworkspace` in Xcode.
