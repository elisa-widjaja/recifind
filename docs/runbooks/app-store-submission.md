# ReciFriend — App Store Submission Runbook

**Last updated:** 2026-04-25
**Build target:** ReciFriend 1.0 (build 2), Team `7C6PMUN99K`, bundle `com.recifriend.app`

This runbook is the human-step playbook for submitting ReciFriend to TestFlight + App Store. The agent (Claude Code) has already prepped:
- ✅ Build number bumped to 2 across all 4 build configs
- ✅ Production icon installed (1024×1024 RGB no-alpha) in `Assets.xcassets/AppIcon.appiconset/`
- ✅ Fresh web bundle synced into `ios/App/App/public/`
- ✅ Security acceptance checklist at [`docs/security-acceptance-checklist.md`](../security-acceptance-checklist.md)
- ✅ App Store listing copy at [`docs/app-store-listing.md`](../app-store-listing.md)

You drive Xcode and the App Store Connect dashboard. The agent stands by to fix any errors that come up.

---

## Prerequisites — verify before starting

These were configured during earlier stories. If any is missing, see [iOS app setup checklist](./ios-app-setup-checklist.md) first.

- [ ] Bundle IDs `com.recifriend.app` and `com.recifriend.app.share` registered in [Apple Developer portal](https://developer.apple.com/account/resources/identifiers/list)
- [ ] App Group `group.com.recifriend.app` registered + assigned to both bundle IDs
- [ ] App record exists in [App Store Connect](https://appstoreconnect.apple.com/apps) with bundle ID `com.recifriend.app`
- [ ] You're signed into Xcode → Settings → Accounts with the Apple ID that owns Team `7C6PMUN99K`

---

## Step 1 — Open the workspace

```bash
cd /Users/elisa/Desktop/VibeCode/apps/ios/ios/App
open App.xcworkspace
```

Always `App.xcworkspace`, **not** `App.xcodeproj` — pods won't link otherwise.

## Step 2 — Verify signing

In Xcode:
1. Select the **App** target → **Signing & Capabilities** tab
2. Confirm: ☑ Automatically manage signing; Team = `Elisa Widjaja (7C6PMUN99K)`; Bundle Identifier = `com.recifriend.app`
3. Repeat for the **ShareExtension** target (Bundle ID = `com.recifriend.app.share`)

If Xcode complains "no Distribution certificate" — click **Fix** and let it auto-create one. (First archive triggers this; takes ~30s.)

## Step 3 — Pick the archive destination

In the toolbar, change the device selector to **Any iOS Device (arm64)**. (Archive only works against device, not simulator.)

## Step 4 — Archive

`Product → Archive` (or `Cmd+Shift+B` won't work; use the menu).

This takes 2–5 min. The Organizer window opens automatically when done.

If it fails, report the error — the agent can debug.

## Step 5 — Upload to App Store Connect

In Organizer:
1. Select the new archive at the top of the list
2. **Distribute App** → **App Store Connect** → **Upload** → **Next** through the defaults
3. Upload takes ~5 min. You'll see "Successfully uploaded ReciFriend 1.0 (2)"
4. Close Organizer

## Step 6 — Wait for processing

In [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **ReciFriend** → **TestFlight** tab:
- Build appears with status **Processing** within ~2 min
- Status flips to **Ready to Test** within ~15–30 min (you'll get an email)

If processing fails: Apple sends an email listing the issue. Common ones:
- "ITMS-90683: Missing purpose string" → an `Info.plist` permission prompt is missing copy. Agent can fix.
- "Invalid Code Signing" → Distribution cert/profile mismatch. Agent can debug.

## Step 7 — Fill out Test Information (one-time)

Still in TestFlight tab → **Test Information** in the left sidebar:
- **Beta App Description:** *Save and share recipes with friends. Internal beta — please test sharing flows and report any crashes.*
- **Feedback Email:** `wo.josh@gmail.com` (or a dedicated one if you prefer)
- **Marketing URL** (optional): `https://recifriend.com`
- **Privacy Policy URL:** `https://recifriend.com/privacy`
- **License Agreement:** leave default (Apple's standard EULA)

Save.

## Step 8 — Add yourself as Internal Tester (smoke test before friends)

TestFlight tab → **Internal Testing** in left sidebar → **+** next to "Group" → name it `Internal Smoke`:
- Add yourself by Apple ID email
- Select the build (1.0 build 2)
- Save

You'll get an email within minutes. On your iPhone: install **TestFlight** from the App Store, open the email link, **Install**.

**Run the security smoke test** from [`docs/security-acceptance-checklist.md`](../security-acceptance-checklist.md) item 12 — six adversarial deep-link URLs from Safari. Record results in the checklist before proceeding to external testers.

## Step 9 — Set up External Testers with public link (the friend-testing flow)

TestFlight tab → **External Testing** in left sidebar:
1. **+** next to "Group" → name `Friends & Family Beta`
2. **Builds** → **+** → select 1.0 (2) → click **Submit for Beta App Review**
   - First-time submission requires:
     - **What to Test:** *First public beta. Test signing in, saving a recipe from TikTok via the share extension, and sending it to a friend.*
     - **Beta App Review Information:** demo account email (set up in Step 11), contact info, "App is fully functional; share extension is the key novel feature"
   - Click **Submit for Review**
3. **Testers** tab inside the group → toggle **Public Link** ON → set **Limit number of testers** = 50 (or whatever cap you want)
4. Apple Beta Review takes ~24h, almost always auto-approves. You'll get an email.
5. Once approved: copy the public link (looks like `https://testflight.apple.com/join/abc123`). Share with friends.

Friends tap the link on iPhone → install TestFlight from App Store → tap **Install** → app installs.

**For each subsequent build you upload:**
- If you didn't add new entitlements (no new push categories, no new privacy keys): build auto-promotes to external testers
- If you did: a fresh Beta Review is required (~24h)

## Step 10 — Capture App Store screenshots

Required: 3+ screenshots at 6.7"/6.9" iPhone Pro Max (1290×2796 or 1320×2868 portrait). The agent will drive this from the iPhone 17 Pro Max simulator after build is verified — see Task 3 in the conversation.

Six target shots:
1. Public landing page (logged-out)
2. Home feed with friend activity
3. Recipe detail with "Share with friends" button
4. Friend picker modal open
5. Add Recipe pre-filled (simulating the share extension flow)
6. Recipe detail with cook mode

## Step 11 — Create demo account for Apple Review

Sign up in the deployed prod app at https://recifriend.com using:
- Email: `apple-review@recifriend.com` (or another address you control)
- Pre-populate with 3–5 recipes saved from TikTok/Instagram
- Connect with one friend (use a second test account)
- Send a recipe to the friend so the "shared" feed has content

Keep the password in 1Password — you'll paste it into the App Store submission form.

## Step 12 — Submit for App Store Review

Once external TestFlight is approved AND screenshots are ready:

In App Store Connect → My Apps → ReciFriend → **App Store** tab:
1. Pick **Prepare for Submission** (or **+ Version**, set to `1.0`)
2. Fill all fields from [`docs/app-store-listing.md`](../app-store-listing.md):
   - Name, Subtitle, Description, Keywords, URLs, Categories, Age rating
3. Upload screenshots from Step 10
4. **Build:** select build 1.0 (2)
5. **App Review Information:**
   - Sign-in required: Yes
   - Demo account: paste the credentials from Step 11
   - Contact: your name, email, phone
   - Notes: paste the "Notes for reviewer" block from `docs/app-store-listing.md`
6. **Version Release:** Manual release (so you can flip the switch deliberately)
7. Click **Add for Review** → **Submit for Review**

Apple review takes ~24h. If rejected, fix inline; if approved, click **Release this Version** to go live.

---

## Common rejection fixes

| Rejection | Fix |
|---|---|
| 4.2 Minimum Functionality | Lead description with "share from TikTok/Instagram" feature; add a screenshot showing share-sheet flow. |
| 4.8 Sign in with Apple | Sign in with Apple is required for any app offering third-party login; ensure Apple sign-in works (it's wired in Story 09). |
| 5.1.1 Privacy Manifest | Confirm `PrivacyInfo.xcprivacy` matches the published privacy policy at https://recifriend.com/privacy. |
| Demo account doesn't work | Re-test the credentials yourself from a fresh device; tell Apple in Notes if you have to update them mid-review. |
| Crash on launch | Check Organizer → Crashes for the symbolicated stack trace; agent can debug. |

## Post-launch

- Monitor Xcode Organizer → Crashes for 48h
- Update memory: save the App Store URL + release date as a project memory
- Archive `docs/runbooks/rebrand-checklist.md` as historical reference
