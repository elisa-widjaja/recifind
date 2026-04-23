# Share-Recipe Flow Learnings — 2026-04-22

## Context

Long multi-cycle session attempting to:

1. Redesign the iOS Add Recipe drawer to show thumbnail + plain-text title (removing the URL field) when opened via the Share Extension.
2. Improve enrichment quality — caption-first extraction from reels, YouTube video understanding, verbatim ingredient parsing.
3. Reduce iOS cold-start latency (~15s) when launching via the Share Extension.

Mixed outcome: enrichment architecture and UI redesign shipped and are on `main`. Cold-start improvements attempted but did not reach "effortless." User reverted to archive, then restored. Final state is `b221ea4` with instrumentation stripped and enrichment deployed to prod.

**User quote that frames the next session:**
> "This is the most important feature of the app. We need to get it right. Especially when users save their first recipe. It needs to be stable and reliable. It needs to feel effortless."

---

## What shipped and works (keep)

### 1. iOS Share Extension Swift rewrite
- **File:** `apps/ios/ios/App/ShareExtension/ShareViewController.swift`
- **Change:** replaced a DispatchGroup-over-all-attachments pattern with a first-URL-wins fast path.
- **Measured impact:** `viewDidLoad` → `openMainApp` = 16ms (was seconds).
- **Limit:** the ~3s "stays in share sheet" after tapping ReciFriend is iOS cold-loading the extension process *before* our code runs. No app-side fix exists for that phase.

### 2. Enrichment fallback chain (worker)
- **File:** `apps/worker/src/index.ts`
- **Flow:** `resolveSourceUrl` → `captionExtract` → `youtubeVideo` → `textInference` (with two passes: strict extract-only, then inference-allowing fallback).
- **Empty-arrays convention:** strategies return `EMPTY_ENRICHMENT` for fall-through; orchestrator logs `winningStrategy`.
- **Error gate:** when `r.jina.ai` returns an error page (short + contains `"HTTP ERROR"` / `"Too Many Requests"`), `textInference` short-circuits and returns empty — preventing Gemini from hallucinating a plausible recipe from nothing.
- **Verbatim extraction:** when `r.jina.ai` returns the caption text, the strict prompt preserves the creator's exact wording (tested on TikTok, Instagram, YouTube Short — all worked when `r.jina.ai` wasn't rate-limited).

### 3. iOS Share Extension drawer layout
- **File:** `apps/recipe-ui/src/App.jsx`
- Thumbnail + plain-text title + inline edit link, replacing the URL field when `addRecipeSource === 'share-extension'`.
- Byte-identical web-mobile fallback for manual entry paths.
- Clean state cleanup across open/close/save.

### 4. Cold-start deep-link de-dup
- **File:** `apps/recipe-ui/src/App.jsx` (dispatcher)
- iOS `CapacitorApp.getLaunchUrl()` returns the same URL on every cold launch, which was re-firing the Add Recipe drawer on every springboard launch. Fix: persist last-consumed URL in Capacitor Preferences, skip re-dispatch when it matches.

### 5. Recipe-detail owner-layout
- `handleOpenRecipeDetails` now resets `isSharedRecipeView` / `sharedRecipeOwnerId` flags on entry.
- `handleOpenEditorPickRecipe` defers to `handleOpenRecipeDetails` when the recipe is owned by the current user — so a user's own recipes that surface in the home feed open with the three-dot menu, not the share/save template.

### 6. Specs + plans committed
- `docs/superpowers/specs/2026-04-22-enrichment-fallback-chain-design.md`
- `docs/superpowers/plans/2026-04-22-enrichment-fallback-chain.md`
- The iOS-share-drawer spec/plan exist in working tree but were never committed (user can commit or delete).

---

## What didn't work (dead ends)

### 1. Trying to mask cold-start with splash screens
- Tried: HTML inline splash → didn't render at all during the blank phase (WKWebView wasn't loaded yet).
- Tried: Native LaunchScreen purple PNG in `Splash.imageset` → user saw only a brief flash before webview took over.
- Tried: Capacitor `ios.backgroundColor = '#6200EA'` → helped transition look cleaner but wasn't perceptible enough.
- Tried: `ShareViewController` with purple UI + icon → user rejected as "not helpful" and asked to remove.
- **Root lesson:** users don't want to see a splash screen — they want the app's content. Any splash is a band-aid on latency, not a solution.

### 2. Non-blocking Google Fonts load (`preload` + `onload`)
- Aimed to eliminate render-blocking font CSS during cold start.
- Didn't meaningfully reduce perceived cold-start time. The bottleneck was elsewhere (tunnel + bundle parse), not fonts.

### 3. Short-URL resolver as a fix for iOS Instagram parsing
- Added `resolveSourceUrl` to follow redirects server-side for `vm.tiktok.com` and similar.
- Useful for TikTok but not the fix for Instagram parsing failures, which are caused by `r.jina.ai` rate-limiting, not URL format.

### 4. Loading from dev tunnel in release-style iOS testing
- `capacitor.config.ts` has `server.url = 'https://dev.recifriend.com'` — live-reload from local Vite via cloudflared.
- Cold start: ~15s (TLS handshake, cloudflared routing, Vite dev-mode modules as individual HTTP requests, bundle parse).
- Switching to bundled `webDir` drops cold-start to ~2-4s but eliminates live-reload.
- User wants bundled mode for final testing. Current `main` still has tunnel mode enabled — **note for the next session to toggle this**.

### 5. Trying to show the drawer faster with splash-screen plugin
- Didn't install `@capacitor/splash-screen` because `pod install` is broken in this project (`Unable to find compatibility version string for object version '70'` — Xcode 16+ project format vs. older CocoaPods). Need to fix CocoaPods before any new native plugin can be added.

---

## Architectural insights

### iOS Share Extension flow — where time actually goes

| Phase | Duration | Controllable? |
|---|---|---|
| Tap → iOS loads extension binary + process | ~3s | **No** — iOS internals. |
| `viewDidLoad` → `openMainApp` (URL extraction) | 16ms | Yes — already optimized. |
| iOS transitions extension → main app | ~200-500ms | No — iOS internals. |
| Main app launch screen | ~200-500ms | Minimal control (launch image). |
| WKWebView cold-start + HTML load | 5-10s (tunnel) / 1-2s (bundled) | **Yes** — switch to bundled. |
| JS bundle parse + React mount | ~500ms-1s | Yes — code splitting, tree shaking. |
| Deep-link dispatcher → `setIsAddDialogOpen(true)` | <100ms | Already fine. |
| Parse step 1 (`/recipes/parse` → og/oEmbed) | 1-3s | Pre-fetchable. |
| Enrich step 2 (Gemini) | 2-15s | Runs in background after save. |

Total **worst case** (tunnel): ~20s tap-to-drawer. Total **bundled case**: ~5-8s.

### Instagram enrichment is fundamentally broken via oEmbed + r.jina.ai
- Instagram's oEmbed endpoint requires auth — returns login HTML for anonymous callers.
- `r.jina.ai` is aggressively rate-limited on Instagram (HTTP 429 with ~300 bytes of error page on a large share of requests).
- When `r.jina.ai` *does* return content, the caption is embedded in the rendered markdown; our extract-only prompt handles that well.
- **Gap:** no reliable Instagram-specific text source exists in the current pipeline. Fallbacks worth exploring:
  - Third-party scraping service (Apify, ScrapingBee) — $ cost, more reliable.
  - Direct HTML scrape with custom headers / rotating UAs.
  - Video-download path → Gemini 2.5 video API (but Gemini can't fetch Instagram; requires downloading bytes first).

### Gemini 2.5 Flash capabilities
- **YouTube URLs direct:** `fileData: { fileUri: '<youtube-url>', mimeType: 'video/*' }` works — Gemini transcribes + extracts from audio+visuals.
- **TikTok / Instagram URLs:** Gemini cannot fetch these. Would need to upload bytes as inline data.
- **Cost:** video calls consume ~5-10x text-call quota. Only runs when captionExtract returns empty in the current chain.

### Cold-launch UX pattern — what we tried and the real insight
- Every "hide the blank" attempt (HTML splash, native purple LaunchScreen, WKWebView backgroundColor, share-extension UI) added visual complexity without speeding up the underlying load.
- **Right question:** why does the user have to wait for the main app at all? They want to save a recipe, not browse. The main-app cold start is in the critical path only because we chose a deep-link-to-main-app architecture.

---

## Next session: native share-extension save (recommended)

**The insight:** for the "save a recipe from a reel" flow — arguably the #1 flow for a recipe-sharing app — the main app cold start is on the critical path for no good product reason. Pocket, Instapaper, Things 3, and similar apps handle share-to-save entirely inside the share extension, never launching the main app.

### Proposed architecture

1. User taps Share → ReciFriend
2. Share extension UI opens **in-line** (stays in the share sheet overlay, never launches the main app)
3. Extension UI: thumbnail (from og:image fetched natively), editable title, "Save" button
4. Save → extension POSTs `/recipes` directly to the worker with the user's auth token (read from shared Keychain / App Group UserDefaults)
5. Toast "Saved!" → extension dismisses. User never left Instagram/TikTok/Safari.
6. Enrichment (caption/video/text) runs **server-side** asynchronously; when user next opens the main app, ingredients/steps are already populated.

### What this fundamentally solves

- **No main-app cold-start for the core save flow.** The 10+ seconds of webview load / JS parse / React mount goes away entirely.
- **Matches user mental model:** "save to read later" is a distinct action from "browse my recipes." Most share sessions don't need the main app.
- **First-recipe save becomes effortless** — which the user explicitly identified as the highest-priority activation moment.

### What it requires

- **Swift UI** for the extension (SwiftUI form with thumbnail + title TextField + Save button).
- **App Group** (e.g., `group.com.recifriend.app`) for shared storage between the extension and main app.
- **Auth token sharing** — extension needs the user's Supabase JWT. Best option: Keychain with shared access group. Simpler: write token into App Group UserDefaults on main-app login.
- **Worker endpoint:** can reuse `POST /recipes`. Add async enrichment queue (worker schedules the enrich call as a background fetch or cron rather than blocking the response).
- **Main app update:** on launch, check for any recipes saved by the extension while the app was closed and refresh the local cache.
- **Sign-in-prompt fallback:** if no auth token in shared storage, extension shows "Please open the app to sign in first" and opens the main app via deep link.

### Trade-offs to discuss in next session's brainstorm

- Loss of the rich drawer UX (inline title editing, "Make it public" checkbox). Need to decide minimum viable extension UI — probably just title edit + save, with "edit details" linking into the main app.
- Auth token in Keychain expires; how to handle 401 from POST `/recipes` inside the extension.
- Enrichment is now async → user sees empty ingredients for a few seconds/minutes until worker catches up. Acceptable for background "save" pattern.
- iOS extension cold-load of ~3s still exists. The savings are purely the **post-extension** 10+ seconds.

### Effort estimate
~3-5 hours of Swift + wiring, assuming the CocoaPods issue is resolved first. Itemized:
- SwiftUI form (1h)
- App Group + Keychain token plumbing (1-2h)
- Native HTTP POST with auth + error handling (1h)
- Worker-side async enrichment queue (1h — new `queueEnrichment(recipeId)` endpoint or background queue)
- Main app change to refresh-on-resume (~30m)

### Pre-work for next session

1. **Fix CocoaPods.** The `Unable to find compatibility version string for object version '70'` error blocks any new native plugin install. Upgrade CocoaPods via `sudo gem install cocoapods`, or switch the Xcode project to an older project version, or use a CocoaPods fork that supports the new format.
2. **Decide on bundled vs. tunnel mode** for ongoing iOS development. Recommendation: bundled for share-flow testing, tunnel for app UI iteration; toggle via capacitor.config.ts.
3. **Write the spec** via the brainstorming skill. The share-extension-native approach is a real architectural change, not a patch.

---

## Files currently on `main` (b221ea4)

All 19 session commits are present. Notable:
- `8c480bd` through `2f618c9`: iOS share drawer layout (thumbnail + title preview).
- `cdf7c8b`, `62f050b`, `d3a6a9d`, `84e07d0`, `203795e`: various iOS/drawer bug fixes.
- `070dd4f` through `b221ea4`: enrichment fallback chain (9 commits).
- Enrichment deployed to prod worker at `api.recifriend.com` (version `9f847c68`).

## Working-tree changes NOT committed

- `apps/ios/ios/App/ShareExtension/ShareViewController.swift` — performance rewrite (first URL wins, no DispatchGroup). Keep this or commit separately.
- `apps/recipe-ui/index.html`, `apps/recipe-ui/src/main.jsx`, `apps/ios/capacitor.config.ts` — all restored to their `b221ea4` state; should show no diff.
- `docs/superpowers/plans/2026-04-22-ios-share-recipe-drawer.md` + spec — untracked; keep as reference for the drawer layout that's already on main.
- `docs/superpowers/learnings/2026-04-22-share-recipe-learnings.md` — this file.

## Safety net

Branch `session-archive/ios-share-enrichment` points at `b221ea4`. Delete when confident everything useful is on `main`.

---

## TL;DR for the next session

- **The UX pain is the main-app cold start.** Optimizing inside that flow (splash screens, fonts, prefetching) is a losing game.
- **The fix is to skip the main app** for the save-from-share flow. Native share-extension save, post to worker, dismiss. Main app is opened only for browse/edit.
- **This is the "effortless first-save" architecture.** Start with a brainstorm — don't start coding yet.
- **Fix CocoaPods first** so we can install native plugins (`@capacitor/splash-screen` etc.) if needed.
- **Keep Instagram parsing reliability** as a separate track — different problem (scraping, not UX).
