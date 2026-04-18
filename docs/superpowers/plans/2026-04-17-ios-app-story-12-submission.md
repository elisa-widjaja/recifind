# Story 12 — App Store Submission

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Ship ReciFriend 1.0 to the iOS App Store. Verify the full security acceptance checklist, capture screenshots, write the listing, archive, upload, submit, and go live.

**Depends on:** G3 (iOS auth), G4 (share ext), G5 (push) all open. All prior stories merged.
**Blocks:** nothing (final story)
**Can develop in parallel with:** nothing

**Contracts consumed:** everything
**Contracts produced:** a public App Store listing

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `docs/runbooks/app-store-submission.md` | Repeatable submission playbook |
| Create | `apps/ios/fastlane/` (optional) | Skip unless CI-driven later |
| Modify | `apps/ios/App/App/Info.plist` | Version + build number |
| Create | `docs/app-store-listing.md` | Listing copy source of truth |
| Create | `docs/security-acceptance-checklist.md` | Evidence log |

---

## Task 1: Security acceptance checklist — evidence log

Before submission, every item in spec §9 must be verified with evidence. Create an evidence doc.

- [ ] **Step 1:** Create `docs/security-acceptance-checklist.md`

```markdown
# Security acceptance checklist — ReciFriend 1.0 submission

Date: 2026-MM-DD
Verifier: <your name>
Git commit at time of audit: <sha>

## Checklist (must all be signed off before archive)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | All deep-link paths handled via parseDeepLink allowlist | ☐ | grep in apps/recipe-ui: every `appUrlOpen` / `pushNotificationActionPerformed` handler imports from `apps/shared/deepLink.ts`. Attach grep output. |
| 2 | Supabase client uses flowType: 'pkce' | ☐ | `grep -n flowType apps/recipe-ui/src/supabaseClient.js` shows pkce. |
| 3 | AASA file correct Content-Type, no redirects | ☐ | `curl -I https://recifriend.com/.well-known/apple-app-site-association` + Branch.io validator screenshot. |
| 4 | AASA appID matches app's Team ID | ☐ | Paste AASA JSON; cross-reference with Xcode Signing → Team. |
| 5 | Associated Domains entitlement live | ☐ | Xcode → Signing & Capabilities → Associated Domains screenshot. |
| 6 | .p8 not in git; only in Cloudflare secrets + offline backup | ☐ | `git log --all -- '*.p8'` returns nothing. 1Password reference for backup. |
| 7 | All client-accessed Supabase tables have RLS + reviewed policy | ☐ | Copy of Story 01 Task 10 RLS audit doc. |
| 8 | PrivacyInfo.xcprivacy matches privacy policy | ☐ | Diff of xcprivacy keys vs recifriend.com/privacy content. |
| 9 | POST /recipes/:id/share validates view permission | ☐ | Test output from share.test.ts "rejects if sharer cannot view the recipe". |
| 10 | GET /recipes/:id honors recipe_shares | ☐ | Integration smoke: shared recipient can read a private recipe; non-recipient cannot. |
| 11 | All new endpoints require auth (no new /public/*) | ☐ | grep for new routes, confirm each sits inside the auth-required branch. |
| 12 | Penetration smoke: malicious deep links from Safari all rejected | ☐ | Recorded test (video or text log): fire each URL in §Adversarial smoke tests below. |

## Adversarial smoke tests

On a physical iPhone with the app installed, open Safari and paste each URL:

| URL | Expected |
|---|---|
| `recifriend://auth/callback?code=fake` | App opens, no session change |
| `recifriend://recipes/../../etc/passwd` | App opens, no navigation |
| `recifriend://add-recipe?url=javascript:alert(1)` | App opens, no Add Recipe dialog |
| `recifriend://add-recipe?url=file:///etc/passwd` | App opens, no Add Recipe dialog |
| `https://evil.com/auth/callback?code=x` | Safari opens evil.com (app doesn't intercept) |
| `recifriend://admin` | App opens, nothing happens |

Record result for each. All must behave as expected.
```

- [ ] **Step 2:** Walk the checklist yourself — for each row, gather evidence into the doc. Do not proceed to Task 2 until all 12 are green.

- [ ] **Step 3:** Commit

```bash
git add docs/security-acceptance-checklist.md
git commit -m "docs: security acceptance checklist for 1.0 submission"
```

## Task 2: Build + version numbers

- [ ] **Step 1:** In Xcode, select App target → General:
  - Version: `1.0.0`
  - Build: `1`

- [ ] **Step 2:** Verify Release scheme config:
  - Optimization: -Os (default Release)
  - Bitcode: off (Apple deprecated it, but double-check)

- [ ] **Step 3:** Clean build folder (Shift-Cmd-K).

## Task 3: Screenshots

Required: at least 3 screenshots at 6.7" (iPhone 15 Pro Max), 1290×2796 portrait.

- [ ] **Step 1:** Pick 6 flows to screenshot that tell the story:
  1. Public landing page (logged-out)
  2. Home feed with friend activity
  3. Recipe detail with "Share with friends" button
  4. Friend picker modal open
  5. Add Recipe from shared URL (pre-filled from share extension)
  6. Recipe detail with cook mode

- [ ] **Step 2:** Run on iPhone 15 Pro Max simulator, Cmd-S or File → Save Screen, for each.

- [ ] **Step 3:** Export to `docs/app-store-screenshots/` (do NOT commit — large binaries; use Apple's upload UI directly).

- [ ] **Step 4:** Optional polish — add captions via a tool like Screenshot Studio.

## Task 4: Listing copy

- [ ] **Step 1:** Create `docs/app-store-listing.md`

```markdown
# App Store listing — ReciFriend 1.0

## Name
ReciFriend

## Subtitle (30 chars max)
Recipes worth sharing.

## Promotional Text (170 chars, editable without review)
Save any recipe you see on TikTok or Instagram with one tap. Share favorites directly with friends — no group chats, no copy-paste, no lost links.

## Description (long; 4000 chars max)
The easiest way to save, cook, and share recipes with the people who matter.

**Save from anywhere.** See a recipe you love on TikTok, Instagram, or Safari? Tap share → choose ReciFriend → it's saved. Auto-enrichment pulls the ingredients, steps, and photo for you.

**Share with friends, not the internet.** Send recipes directly to your favorite people. No public feed, no clout. Just you and your cooking circle.

**Cook together.** When a friend cooks something you shared, you'll know. When they save one of yours, you'll know.

**Features**
- Save recipes from TikTok, Instagram, Safari, Reels — one tap from the share sheet
- Auto-extract ingredients and steps using AI
- Share directly with selected friends
- Cook mode with hands-free step navigation
- Get notified when friends save or share with you
- Sync across iPhone and web

Private. Fast. Beautiful.

Start cooking with the people you actually cook with.

## Keywords (100 chars, comma-separated, no spaces between)
recipe,cooking,share,friends,social,meal,food,save,tiktok,instagram

## Primary category
Food & Drink

## Secondary category
Social Networking

## Age rating
4+

## Support URL
https://recifriend.com/support

## Marketing URL (optional)
https://recifriend.com

## Privacy Policy URL
https://recifriend.com/privacy

## Copyright
© 2026 ReciFriend

## What's new in this version (changelog)
First release.
```

- [ ] **Step 2:** Commit

```bash
git add docs/app-store-listing.md
git commit -m "docs: App Store listing copy for 1.0"
```

## Task 5: Flip APNs to production entitlement

- [ ] **Step 1:** Xcode → App target → Signing & Capabilities → Push Notifications section.
  - Release builds automatically use `production` APNs environment.
  - Dev/TestFlight builds use `development`.

- [ ] **Step 2:** Verify in `App.entitlements`:

```xml
<key>aps-environment</key>
<string>development</string>
```

Do NOT change this string — Xcode flips it at archive time via `ENTITLEMENTS_FOR_SWIFT_BUILD`. If Xcode doesn't auto-flip, there's a project setting wrong.

- [ ] **Step 3:** Confirm APNs production host in Worker — the default `api.push.apple.com` is already production. Sandbox is only used during dev.

## Task 6: TestFlight run

- [ ] **Step 1:** Xcode → Product → Archive. This takes 2–5 min.

- [ ] **Step 2:** Organizer window opens. Select the archive → Distribute App → App Store Connect → Upload. Takes ~5 min.

- [ ] **Step 3:** In App Store Connect → My Apps → ReciFriend → TestFlight tab:
  - Processing takes ~15–30 min.
  - Once processed, fill out "Test Information" (first time only).
  - Invite yourself + one friend as internal testers. No Apple review needed for internal.

- [ ] **Step 4:** Install via TestFlight app on your iPhone. Run the full Gate G3/G4/G5 manual tests once more on the shipped binary. **Production APNs** tokens are used — if pushes don't work, sandbox/prod APNs mix-up is likely.

## Task 7: Submit for review

- [ ] **Step 1:** In App Store Connect → My Apps → ReciFriend → App Store tab → Prepare for Submission.

- [ ] **Step 2:** Fill all fields from `docs/app-store-listing.md`.

- [ ] **Step 3:** Upload screenshots from Task 3.

- [ ] **Step 4:** Select Build — the one you uploaded in Task 6.

- [ ] **Step 5:** App Review Information:
  - Sign-in required? Yes.
  - Demo account: create `apple-review@recifriend.com` with a password, pre-populated with 3–5 recipes and one friend (another test account). Note this in the submission.
  - Notes for the reviewer: explain that the share extension is a key feature and demo how to test it ("Open Safari → go to https://tiktok.com/anyUrl → tap Share → ReciFriend → app opens Add Recipe").

- [ ] **Step 6:** Version Release: manual release recommended for 1.0 so you can flip the switch once everything looks good.

- [ ] **Step 7:** Submit.

## Task 8: Respond to Apple review

- [ ] **Step 1:** Typical response time is 24h. Watch email for status changes.

- [ ] **Step 2:** If rejected:
  - Read the rejection reason carefully. Do NOT resubmit immediately.
  - Common rejections and fixes:
    - **4.2 Minimum Functionality**: describe the share extension more prominently; include a screenshot of TikTok → ReciFriend flow.
    - **4.8 Sign in with Apple**: confirm the button is present and works.
    - **5.1.1 Privacy Manifest**: verify `PrivacyInfo.xcprivacy` matches `recifriend.com/privacy`.
    - **Missing demo account**: double-check reviewer can log in.
  - Fix inline. Resubmit.

- [ ] **Step 3:** Once approved: go to App Store Connect → Version → "Release this Version" → live within 1–24h.

## Task 9: Post-launch

- [ ] **Step 1:** Monitor Xcode Organizer → Crashes for the first 48h. Fix anything that shows up with a 1.0.1 hotfix if needed.
- [ ] **Step 2:** Update `MEMORY.md` with the release date and App Store URL (save as a project memory).
- [ ] **Step 3:** Archive the rebrand runbook (`docs/runbooks/rebrand-checklist.md`) — mark as historical reference.

## Acceptance criteria (Gate G6)

- [ ] Security acceptance checklist all green
- [ ] App archive uploaded to App Store Connect
- [ ] TestFlight internal test passes end-to-end with production APNs
- [ ] App Store submission accepted
- [ ] ReciFriend 1.0 live on the App Store
- [ ] Post-launch crash monitoring set up

## Commit checklist

- `docs: security acceptance checklist for 1.0 submission`
- `docs: App Store listing copy for 1.0`
