# Adding the Share Extension target (one-time, Xcode GUI)

The source files live at `apps/ios/ios/App/ShareExtension/`. Add the target:

1. Open `apps/ios/ios/App/App.xcworkspace` in Xcode
2. **File → New → Target** → iOS → **Share Extension** → Next
3. Product Name: `ShareExtension`
4. Team: `7C6PMUN99K`
5. Bundle ID: change default to `com.recifriend.app.share`
6. Language: Swift
7. Project: App
8. Embed in Application: App
9. Click Finish. Xcode prompts to activate the scheme — say Activate.
10. Xcode creates files at `ios/App/ShareExtension/`. **Delete the auto-generated** `ShareViewController.swift`, `Info.plist`, `MainInterface.storyboard` — our files (already committed by the agent) will replace them.
11. Drag the three files we provided into the ShareExtension group in the Xcode navigator:
    - `ShareViewController.swift`
    - `Info.plist`
    - `ShareExtension.entitlements`
12. Target settings → Signing & Capabilities: set Team to `7C6PMUN99K`, verify entitlements file reference is `ShareExtension.entitlements`
13. Build the ShareExtension scheme (Cmd-B). Should succeed.
14. Run the App scheme on a device. Then share a TikTok link — ReciFriend should appear in the share sheet.
