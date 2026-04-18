# Story 10 — iOS Share Extension

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** A Swift share extension bundled with the iOS app that accepts URLs from the iOS share sheet (TikTok, Instagram, Safari, Reels) and opens the main app at `recifriend://add-recipe?url=<encoded>`. No UI, no network, no sensitive data — just URL handoff.

**Depends on:** Story 08 (Xcode project exists)
**Blocks:** Gate G4
**Can develop in parallel with:** Stories 09, 11 (completely independent — Swift target only)

**Contracts consumed:** C5 iOS identifiers (URL_SCHEME for outbound, SHARE_EXT_BUNDLE_ID for target config)
**Contracts produced:** Emits `recifriend://add-recipe?url=<encoded>` URLs consumed by S09's deep-link handler

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/ios/App/ShareExtension/Info.plist` | Activation rules |
| Create | `apps/ios/App/ShareExtension/ShareViewController.swift` | Single-file extension |
| Create | `apps/ios/App/ShareExtension/ShareExtension.entitlements` | Empty but required |
| Modify | `apps/ios/App/App.xcodeproj/project.pbxproj` | New Share Extension target (via Xcode UI) |

---

## Task 1: Add Share Extension target in Xcode

This is UI work, not file editing. Record each click in a runbook note.

- [ ] **Step 1:** Open Xcode project

```bash
cd apps/ios && npx cap open ios
```

- [ ] **Step 2:** File → New → Target → iOS → Application Extension → **Share Extension** → Next
  - Product Name: `ShareExtension`
  - Team: your Apple Team
  - Bundle Identifier: auto-fills to `com.recifriend.app.ShareExtension` — change to `com.recifriend.app.share` (matches `IOS.SHARE_EXT_BUNDLE_ID`)
  - Language: Swift
  - Project: App
  - Embed in Application: App

- [ ] **Step 3:** Xcode prompts to activate the scheme for debugging — say Activate.

- [ ] **Step 4:** Verify files created: `apps/ios/App/ShareExtension/` with `ShareViewController.swift`, `Info.plist`, `MainInterface.storyboard`.

- [ ] **Step 5:** Delete `MainInterface.storyboard` — we don't need a UI.

## Task 2: Configure activation rules in Info.plist

- [ ] **Step 1:** Edit `apps/ios/App/ShareExtension/Info.plist` — replace the default `NSExtension` dict:

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>NSExtensionActivationRule</key>
    <dict>
      <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
      <integer>1</integer>
      <key>NSExtensionActivationSupportsText</key>
      <true/>
    </dict>
  </dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.share-services</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
</dict>
```

**Why these rules:**
- `NSExtensionActivationSupportsWebURLWithMaxCount = 1` → activates when a single URL is shared. Covers TikTok, Instagram, Safari, Reels.
- `NSExtensionActivationSupportsText = true` → also activates when plain text is shared (some apps share "Check this out: https://...").

Setting these two is the minimum; more restrictive rules lose coverage.

## Task 3: ShareViewController.swift — URL extraction + handoff

- [ ] **Step 1:** Replace the default `ShareViewController.swift`

```swift
import UIKit
import UniformTypeIdentifiers
import MobileCoreServices

class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        // No UI — process immediately.
        extractURLAndOpenApp()
    }

    private func extractURLAndOpenApp() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completeWithError("No items")
            return
        }

        let group = DispatchGroup()
        var foundURL: URL?

        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { (data, error) in
                        if let url = data as? URL, foundURL == nil { foundURL = url }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { (data, error) in
                        if let text = data as? String, foundURL == nil,
                           let extracted = self.extractFirstHTTPURL(from: text) {
                            foundURL = extracted
                        }
                        group.leave()
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            guard let url = foundURL else { self.completeWithError("No URL found"); return }
            self.openMainApp(with: url)
        }
    }

    private func extractFirstHTTPURL(from text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let url = match.url,
              url.scheme == "http" || url.scheme == "https" else {
            return nil
        }
        return url
    }

    private func openMainApp(with sharedURL: URL) {
        var components = URLComponents()
        components.scheme = "recifriend"
        components.host = "add-recipe"
        components.queryItems = [URLQueryItem(name: "url", value: sharedURL.absoluteString)]
        guard let deepLink = components.url else { completeWithError("Bad URL"); return }

        // Walk the responder chain to find a UIResponder that can open URLs.
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(deepLink, options: [:], completionHandler: nil)
                break
            }
            if let selector = responder?.responds(to: NSSelectorFromString("openURL:")), selector == true {
                // Pre-iOS 18 fallback
                _ = responder?.perform(NSSelectorFromString("openURL:"), with: deepLink)
                break
            }
            responder = responder?.next
        }

        // Always dismiss the share sheet — iOS will handle the handoff.
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    private func completeWithError(_ message: String) {
        let error = NSError(domain: "com.recifriend.share", code: 0,
                            userInfo: [NSLocalizedDescriptionKey: message])
        self.extensionContext?.cancelRequest(withError: error)
    }
}
```

**Security note (§9.S7):** no analytics, no remote logging, no network calls. The only output is `UIApplication.open(recifriend://...)` — a local operation.

- [ ] **Step 2:** Verify the target's deployment target matches the main app's (usually iOS 15+).

- [ ] **Step 3:** Commit

```bash
git add apps/ios/App/ShareExtension/
git commit -m "feat(share-ext): extract URL and open main app"
```

## Task 4: Manual test on simulator

- [ ] **Step 1:** Build the App scheme AND the ShareExtension scheme. Run the App scheme on simulator first.

- [ ] **Step 2:** On the simulator, open Safari → go to https://tiktok.com/any-url → tap Share → scroll the second row → find ReciFriend → tap.

- [ ] **Step 3:** Expect: ReciFriend main app opens, and if S09 deep-link handler is merged, the Add Recipe dialog appears with the URL pre-filled.

- [ ] **Step 4:** If the extension doesn't appear in the share sheet:
  - Clean build folder (Shift-Cmd-K) and rerun
  - Confirm `NSExtensionActivationRule` in Info.plist
  - Confirm bundle ID matches `com.recifriend.app.share`

## Task 5: Real device test

- [ ] **Step 1:** Attach iPhone. Run App scheme on device.

- [ ] **Step 2:** Open TikTok. Find any public video. Tap Share.

- [ ] **Step 3:** Expect: ReciFriend icon in the share sheet. Tap. App opens. Add Recipe dialog appears with the TikTok URL prefilled. Auto-enrichment runs (existing flow from CLAUDE.md).

- [ ] **Step 4:** Record issues in runbook.

## Task 6: Adversarial tests

The share extension receives untrusted URLs from arbitrary apps. Even though we just pass them to `openURL` as a query parameter, test malformed cases.

- [ ] **Step 1:** Share from Notes with text containing `javascript:alert(1)`. Expect: `extractFirstHTTPURL` returns nil (only http/https), so we fall through to `completeWithError`. Extension dismisses; main app never opens.

- [ ] **Step 2:** Share an image from Photos. Expect: `NSExtensionActivationSupportsWebURLWithMaxCount=1` does not match image-only shares, so the ReciFriend icon should not appear in the share sheet.

- [ ] **Step 3:** Share from Messages: a text message containing two URLs. Expect: our code takes the first match. Fine — document.

## Acceptance criteria (Gate G4)

- [ ] ShareExtension target builds clean
- [ ] Icon appears in iOS share sheet from TikTok, Instagram, Safari, Messages (when URL present)
- [ ] Tapping ReciFriend opens the main app with URL pre-filled in Add Recipe
- [ ] Auto-enrichment runs after the URL appears (relies on existing web app behavior)
- [ ] Text-without-URL shares: ReciFriend icon does not appear, OR if it does, tapping silently dismisses without opening the app
- [ ] No network calls from the extension (verified via Charles/Proxyman)

## Commit checklist

- `feat(share-ext): extract URL and open main app`
