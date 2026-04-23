# iOS Share Extension — Native Save

**Date:** 2026-04-23
**Status:** Spec, ready for implementation plan
**Supersedes:** `2026-04-22-ios-share-recipe-drawer-design.md` (drawer redesign stays on `main` as fallback path)
**Context:** `docs/superpowers/learnings/2026-04-22-share-recipe-learnings.md`

## Goal

Make the "save a recipe from a reel" flow **effortless** — the app's #1 flow. Today's cold-start to drawer on iOS is 15+s; the share-from-share-sheet pattern makes the main-app launch an unavoidable UX tax. This spec moves the save entirely inside the share extension so most saves never launch the main app.

Target: user shares a reel → within ~3s the share sheet shows thumbnail + editable title + Save → tap Save → dismiss, still in Instagram. Enrichment (ingredients, steps) happens server-side in the background.

## Success criteria

- Signed-in user can share a TikTok / Instagram / YouTube Short / plain URL and land a recipe in their collection without the main app launching.
- Time from share-sheet-render to dismiss: ≤3s under normal conditions.
- No silent drops. Every failure mode either saves the recipe (possibly title-only) or falls back to the existing main-app drawer flow.
- Enrichment backfills ingredients and steps within 30s of save; failures leave a usable title + thumbnail + source link.

Non-goals:
- Full in-extension editing (public toggle, tags, ingredient edits). Those stay in the main app.
- Solving Instagram caption rate-limiting. Tracked separately as the "enrichment-reliability" brainstorm.
- Offline save-queue in the extension.
- A signed-out experience inside the extension (user must have logged in on the device once).

## Architecture

Two-process model: share extension and main app run as distinct iOS processes and share state via an **App Group** container.

```
┌────────────────┐    App Group storage    ┌────────────────┐
│  Share         │◀────(JWT, last-save)───▶│  Main app      │
│  Extension     │                         │  (WKWebView)   │
│  (SwiftUI)     │                         │                │
└───────┬────────┘                         └───────┬────────┘
        │                                          │
        │  POST /recipes (JWT)                     │  GET /recipes
        │                                          │
        └────────────▶  Cloudflare Worker  ◀───────┘
                         + ctx.waitUntil(enrich)
                         + Gemini, r.jina.ai
```

Rules:
- Main app writes the Supabase JWT to shared storage on every `onAuthStateChange` (Supabase JS).
- Extension reads the JWT at save-time. It never attempts to refresh (no Supabase SDK in extension).
- Extension POSTs directly to the **existing** `POST /recipes` worker endpoint. No new endpoint.
- Worker kicks off enrichment via `ctx.waitUntil(enrichAfterSave(...))` — HTTP response returns in ~300ms; enrichment runs asynchronously up to 30s.
- Main app refetches recipes on `appStateChange → active` so extension-saved recipes appear without manual pull-to-refresh.
- Any failure → fall back to deep-link `recifriend://add-recipe?url=<raw>` (today's main-app drawer flow, unchanged).

## Components

### 1. iOS Share Extension (SwiftUI)

Replaces the current zero-UI `ShareViewController`. Flow:

1. `viewDidLoad` extracts the first URL (keep today's first-URL-wins fast path).
2. Calls worker `POST /recipes/parse?url=<resolved>` → `{ title, image_url }`. Timeout 2s.
3. Renders SwiftUI form:
   - `AsyncImage` for the thumbnail (gray placeholder if parse failed).
   - `TextField` pre-filled with `title` (or URL host if parse failed), fully editable.
   - Cancel + Save buttons.
4. On Save tap:
   - Read JWT from shared Keychain.
   - `POST /recipes { name, source_url, image_url, ingredients: [], steps: [] }` with `Authorization: Bearer <jwt>`. Timeout 5s.
   - On 2xx → brief "Saved" state → `extensionContext?.completeRequest`.
   - On any failure → open deep-link `recifriend://add-recipe?url=<raw>` (A2 fallback).

UI style: default iOS Human Interface Guidelines. Minimal branding (app icon + name in navigation bar). No custom colors.

### 2. Shared storage (App Group + Keychain)

- New App Group entitlement: `group.com.recifriend.app` on both extension and main-app targets.
- Register the App Group in Apple Developer portal; regenerate provisioning profiles.
- **Keychain** with `kSecAttrAccessGroup` for the JWT. Reasoning: more secure than UserDefaults, only ~20 extra LOC in Swift, standard Apple pattern for cross-target token sharing.
- App Group UserDefaults for non-sensitive state (`lastExtensionSaveAt` timestamp, used by main app as a refresh hint).

### 3. Worker changes

Existing routes handle most of this; changes are minimal.

- **`POST /recipes/parse`** — reuse unchanged. Already returns `{ title, image_url }` using the existing og/oEmbed extraction.
- **`POST /recipes`** — two accommodations:
  - Accept empty `ingredients` and `steps` arrays (verify current behavior; add if missing).
  - On successful insert, call `ctx.waitUntil(enrichAfterSave(env, recipeId, resolvedSourceUrl, title))`. `enrichAfterSave` runs the existing `resolveSourceUrl → captionExtract → youtubeVideo → textInference` chain and writes results back into the D1 row.
  - Rapid re-share dedup: when `(user_id, source_url)` matches a row inserted within the last 60s, return that row's `recipe_id` with 200 (not 201) instead of inserting a duplicate.
- No new endpoints. No Cloudflare Queue. `ctx.waitUntil` is sufficient — the existing enrichment chain is under the 30s worker budget.

### 4. Main app changes

- Custom Capacitor plugin `SharedAuthStore` (~40 LOC Swift + TS stub) exposing `setJwt(token)` / `clearJwt()` / `getJwt()`. Writes to shared Keychain.
- In `App.jsx`: subscribe to Supabase `onAuthStateChange`. On any event delivering a non-null session (`INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`) → call `SharedAuthStore.setJwt(session.access_token)`. On `SIGNED_OUT` → `SharedAuthStore.clearJwt()`.
- `CapacitorApp.addListener('appStateChange', state => state.isActive && invalidateRecipesCache())` → triggers the existing recipe-list refetch.
- Existing deep-link drawer flow on `main` stays intact — it's the A2 fallback path.

### 5. Build prerequisites (pre-work, not part of the spec work itself)

- **Fix CocoaPods.** Learnings doc flags `Unable to find compatibility version string for object version '70'` — blocks any new native plugin install. Upgrade CocoaPods (`sudo gem install cocoapods`) or downgrade the Xcode project format. Must be resolved before implementation starts.
- Add App Group entitlement in Apple Developer portal and Xcode project settings for both targets.

## Data flow

### Happy path (signed-in, online)

```
t=0ms      User taps Share → ReciFriend in Instagram
t~3000ms   iOS finishes loading extension process (uncontrollable)
t+16ms     Extension extracts first URL (existing fast path)
t+16ms     Extension starts POST /recipes/parse
t+500ms    Parse returns { title, image_url } → UI renders
           User edits title (optional), taps Save
t+Xms      Extension reads JWT from Keychain
t+Xms      Extension POSTs /recipes with empty ingredients/steps
t+X+300ms  Worker responds 201 { recipe_id }
           Worker fires ctx.waitUntil(enrichAfterSave(...))
           Extension dismisses — user is back in Instagram
t+X+5-30s  Enrichment completes → D1 row updated
           (User sees full recipe next time they open main app)
```

User-visible wait after share-sheet render: ~500ms preview + time-to-type + ~300ms save ≈ **1–3s** typical.

### Fallback paths (A2 — deep-link to main app)

Triggered on:
1. No JWT in Keychain (user never signed in on this device, or logged out).
2. `POST /recipes` returns 401 (JWT expired — extension can't refresh).
3. `POST /recipes` timeout (>5s) or network error.
4. `POST /recipes/parse` timeout + subsequent save failure.

In all cases: extension opens `recifriend://add-recipe?url=<raw>` → main app receives deep-link → existing drawer takes over → today's save flow runs.

### Enrichment failure (B1 — silent)

If `enrichAfterSave` returns empty (Instagram rate-limited, etc.), the D1 row keeps empty `ingredients`/`steps`. Recipe is visible to the user with title + thumbnail + source link; they can hand-fill or tap the source to cook. No error surfaced. Enrichment reliability is tracked separately.

## Error handling

| Where | Failure | Outcome |
|---|---|---|
| Extension | No URL in share payload | "No URL found" — matches today. |
| Extension | `/recipes/parse` timeout (>2s) | Placeholder UI (gray thumbnail + URL host title). User can still save. |
| Extension | Keychain read returns no JWT | Deep-link to main app immediately. |
| Extension | `POST /recipes` returns 401 | Delete JWT from Keychain. Deep-link to main app. |
| Extension | `POST /recipes` returns 5xx or times out (>5s) | Deep-link to main app. |
| Extension | Offline | Deep-link to main app. No local queue in v1. |
| Worker | `POST /recipes` saves row, `ctx.waitUntil(enrich)` throws | Row stays with empty ingredients. Log error. Title-only recipe. |
| Worker | Enrichment chain returns empty | Same as above. Tracked in enrichment-reliability brainstorm. |
| Main app | Extension-saved recipe not visible after resume | Refresh-on-resume fetches. Pull-to-refresh as backup. |
| Main app | Deep-link received while logged out | Existing login-then-resume-deep-link flow handles it. |

No silent drops: every error either saves the recipe (worst case: title-only) or hands control back to the main app with the URL preserved.

## Testing

### Automated (worker side)

Vitest in `apps/worker/`:
- `POST /recipes` accepts empty `ingredients`/`steps`, returns 201 with new `recipe_id`.
- `POST /recipes` triggers `ctx.waitUntil(enrichAfterSave)` on success.
- Rapid re-share dedup: second POST of same `(user_id, source_url)` within 60s returns the first row's `recipe_id`.
- `enrichAfterSave` updates the D1 row when the chain returns content; leaves the row unchanged when all strategies return empty.

No new `apps/e2e/` tests — the flow has no web UI surface.

### Manual acceptance (real device required)

Simulators lie about App Group and Keychain sharing. Every main-flow change must be verified on a real iPhone.

**Pre-flight (once per dev setup):**
1. CocoaPods resolves; `pod install` succeeds.
2. App Group `group.com.recifriend.app` enabled on both targets.
3. Main-app login writes JWT to shared Keychain (verify with a debug-only "Dump shared state" button in dev builds; strip in release).

**Acceptance checklist (run on every main-flow change):**
- [ ] Signed-in, online, Instagram reel → share → title pre-fills → Save → dismisses ≤3s → recipe in main app, ingredients populate ≤30s.
- [ ] Signed-in, online, TikTok video → same.
- [ ] Signed-in, online, YouTube Short → same (verifies video-path enrichment).
- [ ] Signed-in, online, plain news URL (e.g., NYT recipe) → same.
- [ ] Signed-out → share → extension deep-links to main app → login drawer shows URL preloaded.
- [ ] Expired JWT (wait 1h + kill main app) → share → 401 → deep-link fallback → re-login → save completes.
- [ ] Airplane mode → share → deep-link fallback.
- [ ] Two rapid shares of the same URL → one recipe row, not two.
- [ ] Share completes → background main app → resume → new recipe visible without manual refresh.

### Dogfooding gate

Before TestFlight or App Store submission: save 10+ real recipes via share extension across ≥2 sessions. No silent drops, no stuck enrichment >60s, no duplicates.

## Out of scope (explicit)

- Instagram / `r.jina.ai` rate-limit reliability — separate brainstorm.
- In-extension public/private toggle, tag editing, ingredient editing — stays in main app.
- Offline save queue inside the extension.
- Signed-out save UX inside the extension.
- Android share-target equivalent (app is iOS-only for now).

## Open risks

- **CocoaPods unblock is a hard dependency.** If it can't be fixed, App Group + Keychain plugin work is blocked. Mitigation: fix it as the first implementation step; if it proves intractable, reconsider switching to SPM where possible.
- **Supabase JWT refresh inside a live main-app session doesn't always land in Keychain.** Main-app JS must reliably subscribe to `TOKEN_REFRESHED` and push updates down to the plugin. A stale token causes silent 401s in the extension → A2 fallback, so it's recoverable but produces a worse UX than intended.
- **App Store review may question an extension that posts to a web service.** It's a permitted pattern (Pocket, Things, 1Password all do this) but the review notes should describe it clearly.
