# Facebook Reels via On-Device og Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Facebook reels (`facebook.com` / `fb.watch`) importable in the iOS Share Extension by fetching og metadata on-device (residential IP), stripping the engagement-stat prefix, and re-enabling FB on the worker allowlist — yielding a clean title + thumbnail.

**Architecture:** The worker is login-walled by Facebook from datacenter IPs, so the iOS `DeviceMetadataFetcher` (which already does residential-IP og fetches for Instagram) is extended to also handle Facebook. The worker re-allowlists FB (required so save/enrich don't 400) and applies the same engagement-prefix strip for defense-in-depth. The real FB `og:description` format is unknowable from a datacenter, so the prefix regex is a best-guess that gets validated/refined against captured on-device output in the dev phase before shipping.

**Tech Stack:** TypeScript (Cloudflare Worker, vitest), Swift (iOS Share Extension, SwiftUI), wrangler, Xcode.

**Spec:** `docs/superpowers/specs/2026-05-31-fb-reels-on-device-fetch-design.md`

**Conventions for this repo (read before starting):**
- Work directly on `main` — no branches or worktrees.
- Do NOT `git commit` until the user explicitly approves. The commit steps below are written out, but **hold each commit until the user says go**.
- Worker tests: `cd apps/worker && npm test`.
- The Share Extension has no XCTest target — Swift changes are verified on-device in Phase C, not by unit tests.

---

## Task 1: Worker — `stripFacebookEngagementPrefix` helper

**Files:**
- Modify: `apps/worker/src/index.ts` (add helper after `extractTikTokRecipeTitle`, ends line 4994; add to the test-export block near line 6658)
- Test: `apps/worker/src/enrich.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/enrich.test.ts` (append a new `describe` block at the end of the file):

```ts
describe('stripFacebookEngagementPrefix', () => {
  it('strips a leading run of engagement-stat segments', () => {
    expect(stripFacebookEngagementPrefix('562K views · 5K reactions · Pasta Carbonara 🍝'))
      .toBe('Pasta Carbonara 🍝');
  });

  it('strips comma-separated stats with decimals and K/M/B suffixes', () => {
    expect(stripFacebookEngagementPrefix('1.2M views, 45K likes, 320 comments, 89 shares Garlic Shrimp'))
      .toBe('Garlic Shrimp');
  });

  it('leaves a caption with no engagement prefix unchanged', () => {
    expect(stripFacebookEngagementPrefix('Crispy garlic potatoes 🥔 the best side dish ever'))
      .toBe('Crispy garlic potatoes 🥔 the best side dish ever');
  });

  it('trims surrounding whitespace', () => {
    expect(stripFacebookEngagementPrefix('  3 reactions   Lemon Cake  ')).toBe('Lemon Cake');
  });
});
```

Also add `stripFacebookEngagementPrefix` to the existing import at the top of `enrich.test.ts` (line 2), e.g. append it to the destructured list from `'./index'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "stripFacebookEngagementPrefix"`
Expected: FAIL — `stripFacebookEngagementPrefix is not a function` / import resolves to `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `apps/worker/src/index.ts`, immediately after the closing `}` of `extractTikTokRecipeTitle` (line 4994), add:

```ts
// Facebook og:description leads with engagement stats, e.g.
// "562K views · 5K reactions · <caption>" or
// "1.2M views, 45K likes, 320 comments, 89 shares <caption>".
// Strip a leading run of "<number><K/M/B?> <views|reactions|likes|comments|shares>"
// segments (separated by ·, commas, or whitespace) to leave the bare caption.
// NOTE: kept in sync with the Swift copy in DeviceMetadataFetcher.swift —
// update both when the on-device capture phase refines the real FB format.
function stripFacebookEngagementPrefix(ogDescription: string): string {
  return ogDescription
    .replace(/^(?:[\d.,]+[KMB]?\s+(?:views?|reactions?|likes?|comments?|shares?)\s*[·,]?\s*)+/i, '')
    .trim();
}
```

Then add `stripFacebookEngagementPrefix` to the test-export block (the same `export { ... }` list that contains `isFacebookLinkShim` near line 6658).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "stripFacebookEngagementPrefix"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): add Facebook engagement-prefix stripper helper"
```

---

## Task 2: Worker — apply the stripper in the FB og:description branch

**Files:**
- Modify: `apps/worker/src/index.ts:5028-5032` (FB title fallback branch)
- Test: `apps/worker/src/enrich.test.ts:1051-1063` (existing FB title-fallback test, plus one new case)

- [ ] **Step 1: Write the failing test**

In `apps/worker/src/enrich.test.ts`, inside the existing `describe('extractRecipeDetailsFromHtml Facebook title fallback', ...)` block (line 1051), add a second `it`:

```ts
  it('strips the engagement-stat prefix before extracting the title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Facebook" />
      <meta property="og:description" content="562K views · 5K reactions · Crispy garlic potatoes 🥔" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
    </head></html>`;
    const result = extractRecipeDetailsFromHtml(html, 'https://www.facebook.com/reel/123');
    expect(result).not.toBeNull();
    expect(result!.title.toLowerCase()).toContain('crispy garlic potatoes');
    expect(result!.title.toLowerCase()).not.toContain('views');
    expect(result!.title.toLowerCase()).not.toContain('reactions');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "strips the engagement-stat prefix"`
Expected: FAIL — title still contains "views"/"reactions" because the raw caption is passed through.

- [ ] **Step 3: Write minimal implementation**

In `apps/worker/src/index.ts`, change the FB branch at line 5028-5032 from:

```ts
  if (isFacebook && (!fallbackTitle || /^facebook$/i.test(fallbackTitle))) {
    const ogDesc = extractMetaContent(html, 'property', 'og:description')
      || extractMetaContent(html, 'name', 'twitter:description');
    if (ogDesc) fallbackTitle = ogDesc.trim();
  }
```

to:

```ts
  if (isFacebook && (!fallbackTitle || /^facebook$/i.test(fallbackTitle))) {
    const ogDesc = extractMetaContent(html, 'property', 'og:description')
      || extractMetaContent(html, 'name', 'twitter:description');
    if (ogDesc) fallbackTitle = stripFacebookEngagementPrefix(ogDesc);
  }
```

(The existing `extractTikTokRecipeTitle(fallbackTitle)` call at line 5037-5038 then extracts the dish name from the stripped caption — leave it unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "Facebook title fallback"`
Expected: PASS — both the original "generic Facebook" case and the new prefix-strip case pass.

- [ ] **Step 5: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): strip FB engagement prefix in worker title fallback"
```

---

## Task 3: Worker — re-allowlist Facebook and flip the assertions

**Files:**
- Modify: `apps/worker/src/index.ts:5429-5454` (`ALLOWED_SOURCE_HOSTS`)
- Test: `apps/worker/src/enrich.test.ts:976-1004` (Facebook allowlist describe block)

- [ ] **Step 1: Update the failing test to the new expectation**

In `apps/worker/src/enrich.test.ts`, replace lines 981-988 (the comment + the "does NOT allowlist" test) with:

```ts
  // Facebook is allowlisted: the iOS Share Extension fetches FB og data
  // on-device (residential IP), so reels can be saved with a clean title +
  // thumbnail even though the worker itself is login-walled by FB.
  it('allowlists facebook.com / fb.watch', () => {
    expect(isAllowedSourceHost('facebook.com')).toBe(true);
    expect(isAllowedSourceHost('www.facebook.com')).toBe(true);
    expect(isAllowedSourceHost('fb.watch')).toBe(true);
  });
```

(Leave the `still rejects a spoofed facebook subdomain attack` and the `resolves an fb.watch short link` tests below it unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/enrich.test.ts -t "allowlists facebook"`
Expected: FAIL — `isAllowedSourceHost('facebook.com')` returns `false` (FB not yet in the list).

- [ ] **Step 3: Write minimal implementation**

In `apps/worker/src/index.ts`, replace the parked-comment block at lines 5432-5439 with the two host entries, so the array head reads:

```ts
const ALLOWED_SOURCE_HOSTS = [
  'tiktok.com',
  'instagram.com',
  // Facebook reels: parse/enrich are login-walled from the worker's datacenter
  // IPs, but the iOS Share Extension fetches FB og data on-device (residential
  // IP) for a clean title + thumbnail. Allowlisted so /recipes/create + /enrich
  // accept FB links. The isFacebookLinkShim guard below still blocks the
  // facebook.com/l.php?u= open redirector.
  'facebook.com',
  'fb.watch',
  'youtube.com',
  'youtu.be',
```

(Everything from `'pinterest.com'` down is unchanged.)

- [ ] **Step 4: Run the full worker suite**

Run: `cd apps/worker && npm test`
Expected: PASS — all suites green, including the spoofed-subdomain rejection (`facebook.com.evil.com` → false), shim rejection, and fb.watch resolution.

- [ ] **Step 5: Commit (HOLD for user go-ahead)**

```bash
git add apps/worker/src/index.ts apps/worker/src/enrich.test.ts
git commit -m "feat(import): re-allowlist facebook.com/fb.watch for on-device fetch"
```

---

## Task 4: iOS — `DeviceMetadataFetcher` Facebook support (+ temporary capture logging)

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift`

No unit test (no XCTest target in the extension); verified on-device in Phase C.

- [ ] **Step 1: Add Facebook to the host guard**

In `DeviceMetadataFetcher.swift`, change lines 31-34 from:

```swift
        let host = sourceUrl.host?.lowercased() ?? ""
        let isInstagram = host.contains("instagram.com")
        let isTikTok = host.contains("tiktok.com")
        let isYouTube = host.contains("youtube.com") || host.contains("youtu.be")
        guard isInstagram || isTikTok || isYouTube else { return nil }
```

to:

```swift
        let host = sourceUrl.host?.lowercased() ?? ""
        let isInstagram = host.contains("instagram.com")
        let isTikTok = host.contains("tiktok.com")
        let isYouTube = host.contains("youtube.com") || host.contains("youtu.be")
        // fb.watch short links resolve to facebook.com/reel/... — URLSession
        // follows the redirect by default, so we fetch the source URL directly.
        let isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")
        guard isInstagram || isTikTok || isYouTube || isFacebook else { return nil }
```

- [ ] **Step 2: Add the Facebook engagement-prefix strip + temporary capture logging**

In `DeviceMetadataFetcher.swift`, after the Instagram prefix-strip block (the closing `}` of `if isInstagram { ... }` at line 83) and before `let title = extractDishName(from: caption)` (line 85), insert:

```swift
            // Facebook og:description leads with engagement stats, e.g.
            // "562K views · 5K reactions · <caption>". Strip a leading run of
            // "<number><K/M/B?> <views|reactions|likes|comments|shares>"
            // segments (separated by ·, commas, or whitespace).
            // NOTE: kept in sync with stripFacebookEngagementPrefix in the
            // worker (apps/worker/src/index.ts).
            if isFacebook {
                // TEMP (remove before ship): capture the real FB og:description
                // so the regex above can be validated/refined. Visible in
                // Console.app filtered to subsystem "com.recifriend.app.share".
                os_log("FB og:description RAW: %{public}@", log: fbCaptureLog, type: .info, caption)
                caption = caption.replacingOccurrences(
                    of: #"^(?:[\d.,]+[KMB]?\s+(?:views?|reactions?|likes?|comments?|shares?)\s*[·,]?\s*)+"#,
                    with: "",
                    options: .regularExpression
                ).trimmingCharacters(in: .whitespacesAndNewlines)
                os_log("FB caption STRIPPED: %{public}@", log: fbCaptureLog, type: .info, caption)
            }
```

At the top of `DeviceMetadataFetcher.swift`, add the `os` import and the log handle. Change line 1 from:

```swift
import Foundation
```

to:

```swift
import Foundation
import os

// TEMP (remove before ship): capture log for validating the FB prefix regex
// against real on-device og:description output. See Phase C.
private let fbCaptureLog = OSLog(subsystem: "com.recifriend.app.share", category: "fb-capture")
```

- [ ] **Step 3: Build the extension target in Xcode**

Open `apps/ios/ios/App/App.xcworkspace` in Xcode, select the `ShareExtension` scheme, and build (Cmd-B).
Expected: compiles with no errors. (No `pod install` / `cap sync` needed — these are edits to existing Swift files, no new native dependency.)

- [ ] **Step 4: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift
git commit -m "feat(ios-share): fetch Facebook og metadata on-device"
```

---

## Task 5: iOS — `ShareFormView` Facebook precedence + placeholder

**Files:**
- Modify: `apps/ios/ios/App/ShareExtension/ShareFormView.swift:77-89` (`loadPreview` title/image resolution)

- [ ] **Step 1: Make the device result win for Facebook and add the placeholder**

In `ShareFormView.swift`, replace the resolution block at lines 77-89:

```swift
        let resolvedTitle: String
        if let workerTitle = workerResult?.title, !workerTitle.isEmpty {
            resolvedTitle = workerTitle
        } else if let deviceTitle = deviceResult?.title, !deviceTitle.isEmpty {
            resolvedTitle = deviceTitle
        } else {
            resolvedTitle = sourceURL.host ?? "Recipe"
        }

        let resolvedImage = workerResult?.imageUrl ?? deviceResult?.imageUrl

        if title.isEmpty { title = resolvedTitle }
        if imageUrl == nil, let s = resolvedImage, let u = URL(string: s) { imageUrl = u }
```

with:

```swift
        // Facebook is login-walled from the worker's datacenter IPs, so the
        // device fetch (residential IP) is the only trustworthy FB source —
        // prefer it. For everything else the worker wins (KV cache + JSON-LD).
        // When neither yields a title, fall back to a clean editable
        // placeholder rather than the raw "facebook.com" hostname.
        let host = sourceURL.host?.lowercased() ?? ""
        let isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")

        let resolvedTitle: String
        if isFacebook {
            if let deviceTitle = deviceResult?.title, !deviceTitle.isEmpty {
                resolvedTitle = deviceTitle
            } else if let workerTitle = workerResult?.title, !workerTitle.isEmpty {
                resolvedTitle = workerTitle
            } else {
                resolvedTitle = "Facebook Reel"
            }
        } else if let workerTitle = workerResult?.title, !workerTitle.isEmpty {
            resolvedTitle = workerTitle
        } else if let deviceTitle = deviceResult?.title, !deviceTitle.isEmpty {
            resolvedTitle = deviceTitle
        } else {
            resolvedTitle = sourceURL.host ?? "Recipe"
        }

        let resolvedImage = isFacebook
            ? (deviceResult?.imageUrl ?? workerResult?.imageUrl)
            : (workerResult?.imageUrl ?? deviceResult?.imageUrl)

        if title.isEmpty { title = resolvedTitle }
        if imageUrl == nil, let s = resolvedImage, let u = URL(string: s) { imageUrl = u }
```

- [ ] **Step 2: Build the extension target in Xcode**

Build the `ShareExtension` scheme (Cmd-B).
Expected: compiles with no errors.

- [ ] **Step 3: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/ShareFormView.swift
git commit -m "feat(ios-share): prefer device fetch for FB, placeholder on empty"
```

---

## Task 6: iOS — bump version to 1.0.7 / build 27

**Files:**
- Modify: `apps/ios/ios/App/App.xcodeproj/project.pbxproj`

- [ ] **Step 1: Bump every version field**

In `project.pbxproj`, change **all** occurrences:
- `CURRENT_PROJECT_VERSION = 26;` → `CURRENT_PROJECT_VERSION = 27;` (4 occurrences)
- `MARKETING_VERSION = 1.0.6;` → `MARKETING_VERSION = 1.0.7;` (4 occurrences)

Verify none remain:

Run: `grep -c "CURRENT_PROJECT_VERSION = 26\|MARKETING_VERSION = 1.0.6" apps/ios/ios/App/App.xcodeproj/project.pbxproj`
Expected: `0`

- [ ] **Step 2: Commit (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/App.xcodeproj/project.pbxproj
git commit -m "build(ios): 1.0.7 (build 27)"
```

---

## Phase B: Deploy worker to dev + point the extension at dev

- [ ] **Step 1: Confirm a clean baseline**

Run: `git status` — verify no unintended working-tree changes (deploy ships the working tree).

- [ ] **Step 2: Deploy the worker to dev only**

Run: `cd apps/worker && npx wrangler deploy --env dev`
Expected: deploys `recipes-worker-dev` on `api-dev.recifriend.com`. Prod worker untouched.

- [ ] **Step 3: Repoint the extension at the dev API**

In `apps/ios/ios/App/ShareExtension/WorkerClient.swift`, line 6, temporarily change:

```swift
private let apiBase = URL(string: "https://api.recifriend.com")!
```

to:

```swift
private let apiBase = URL(string: "https://api-dev.recifriend.com")!
```

**Do NOT commit this change** — it is reverted in Phase D. Build the app + extension in Xcode and run on a real device (the simulator can't exercise the share sheet from Safari well).

---

## Phase C: On-device capture, refine, and verify (the gate)

- [ ] **Step 1: Capture real FB og:description output**

On the tethered device, share 3-5 different Facebook reels (`facebook.com/reel/...` and a `fb.watch/...` short link) into ReciFriend. Open **Console.app** on the Mac, select the device, filter on `fb-capture` (or subsystem `com.recifriend.app.share`), and read the `FB og:description RAW:` / `FB caption STRIPPED:` pairs.

- [ ] **Step 2: Refine the regex against the captured format**

If the RAW captions reveal a prefix shape the regex misses (e.g. an author segment before the caption, a different separator, a localized stat word), update the Swift regex in `DeviceMetadataFetcher.swift` **and** mirror the identical change into `stripFacebookEngagementPrefix` in `apps/worker/src/index.ts`. Re-run the worker test (`cd apps/worker && npx vitest run src/enrich.test.ts -t "stripFacebookEngagementPrefix"`) with an added case matching the real format, rebuild the extension, and re-capture until `FB caption STRIPPED:` is a clean dish-name lead-in for all samples.

- [ ] **Step 3: Functional verification on-device**

- Share a real FB reel → the title field shows a clean dish name + a thumbnail loads.
- Share an FB reel while signed out of Facebook in Safari (or a reel that login-walls) → title pre-fills as `"Facebook Reel"` (editable), NOT `facebook.com`.
- Save one of the above → recipe is created (no 400 unsupported-source rejection).
- **Regression:** share one Instagram reel and one TikTok → both still resolve clean titles + thumbnails exactly as before.

- [ ] **Step 4: STOP — get explicit user approval before Phase D.**

Report the captured samples, the final regex, and the verification results. Do not proceed to prod without a go-ahead.

---

## Phase D: Ship to prod (only after approval)

- [ ] **Step 1: Remove the temporary capture logging**

In `DeviceMetadataFetcher.swift`, remove the `import os` line, the `fbCaptureLog` declaration, and both `os_log(...)` calls added in Task 4. Keep the `caption = caption.replacingOccurrences(...)` strip itself.

- [ ] **Step 2: Revert the extension API base to prod**

In `WorkerClient.swift` line 6, restore:

```swift
private let apiBase = URL(string: "https://api.recifriend.com")!
```

Run: `grep -n "api-dev" apps/ios/ios/App/ShareExtension/WorkerClient.swift`
Expected: no output (dev base fully reverted).

- [ ] **Step 3: Commit the cleanup (HOLD for user go-ahead)**

```bash
git add apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift
git commit -m "chore(ios-share): remove FB capture logging before ship"
```

- [ ] **Step 4: Record the current live prod deployment (rollback anchor)**

Run: `cd apps/worker && npx wrangler deployments list`
Note the current active deployment ID for `wrangler rollback`.

- [ ] **Step 5: Pre-deploy smoke test (protect-import-flow rule)**

Against prod (`https://api.recifriend.com`), `POST /recipes/parse` for: an IG reel, a TikTok, the AllRecipes blog URL, and a `fb.watch` reel — confirm none regress. `POST /recipes/enrich` (with `DEV_API_KEY`) for an IG reel — confirm unchanged.

- [ ] **Step 6: Deploy the worker to prod**

Run: `git status` (confirm clean baseline), then `cd apps/worker && npx wrangler deploy`
Expected: prod worker now allowlists FB.

- [ ] **Step 7: Archive build 27 in Xcode**

Build + archive the App scheme (Release, generic iOS device), upload to App Store Connect / TestFlight as `1.0.7 (27)`. Confirm `APNS_HOST` is left at prod/unset (push is unrelated; do not flip to sandbox for the prod build).

- [ ] **Step 8: Hard-stop / rollback if anything is off**

Run: `cd apps/worker && npx wrangler rollback <prev-id>` (the worker change is additive; the frontend is untouched, so nothing to roll back there).

---

## Self-review notes (for the executor)

- After all tasks: `cd apps/worker && npm test` must be fully green.
- The Swift FB regex and the TS `stripFacebookEngagementPrefix` regex must stay byte-for-byte equivalent (mirrored copies, per the existing IG-stripper precedent).
- Update memory `project_import_fb_blog_enhancement.md` once FB ships (flip "PARKED" → live, note build 27).
