# iOS App + ReciFriend Rebrand — Design

**Date:** 2026-04-17
**Status:** Draft — awaiting user review
**Scope:** Ship a native iOS app to the App Store while keeping the PWA functionally identical. Rebrand the product from **ReciFind** to **ReciFriend** (new domain `recifriend.com`) as a prerequisite.

---

## 1. Goals

1. **Ship on the iOS App Store** with the product named **ReciFriend**.
2. **Save recipes from social media** with no copy-paste: iOS Share Extension integration with TikTok, Instagram, Safari, Reels.
3. **Push notifications** for three retention-critical events.
4. **Rebrand cleanly** to `recifriend.com` before shipping iOS so the App Store bundle ID, push sender name, and all user-facing copy are consistent from day 1.
5. **Zero PWA regressions.** The existing web app continues to work identically at the new domain.

## 2. Non-goals (deferred)

- Native camera / photo picker (web file input stays)
- iOS widgets, Siri shortcuts, Live Activities
- Badge counts, rich notifications, notification history
- Live / OTA JS updates (Capawesome, Ionic Appflow)
- Offline mode beyond what the existing service worker provides
- iPad-specific layouts
- Android app
- Full Swift/SwiftUI native rewrite

## 3. Key decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| iOS tech | **Capacitor**, bundled JS | Wraps existing React/Vite PWA; no rewrite; clearest App Store review path |
| Share flow | **Open-to-preview** (share extension opens main app with URL pre-filled) | Reuses existing auto-enrich flow; no Swift UI or App Group plumbing |
| Push backend | **APNs direct from Cloudflare Worker** (no OneSignal/FCM) | Workers have everything needed; no vendor lock-in |
| Auth on iOS | **`@capacitor/browser` + ASWebAuthenticationSession** + **Universal Link callback** (PKCE) | Supabase documented path; Google refuses to load inside embedded WebView; Universal Links prevent OAuth code interception by other apps |
| Sign in with Apple | **Required on iOS**, hidden on web | Apple App Store Guideline 4.8 |
| Directed share vs broadcast | **Directed only** ("Elisa shared X with you. View >") | Higher signal, less noise; replaces the earlier broadcast-cooked push |
| Rebrand timing | **Before iOS work starts** | App Store bundle IDs are permanent; changing later = ship a new app |

## 4. Architecture overview

```
┌─────────────────────────────────────────────────┐
│  iOS App Bundle (com.recifriend.app)            │
│                                                 │
│  ┌──────────────────────┐  ┌─────────────────┐ │
│  │  Main App            │  │ Share Extension │ │
│  │  (Capacitor WebView) │  │  (Swift/SwiftUI)│ │
│  │                      │  │                 │ │
│  │  React PWA (bundled) │  │  Extracts URL   │ │
│  │                      │◄─┤  from shared    │ │
│  │  Native plugins:     │  │  payload, opens │ │
│  │  - Push Notifications│  │  recifriend://  │ │
│  │  - Browser (OAuth)   │  │  add-recipe     │ │
│  │  - App / Deep Links  │  └─────────────────┘ │
│  │  - Preferences       │                      │
│  └──────────┬───────────┘                      │
└─────────────┼───────────────────────────────────┘
              │ HTTPS
              ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare Worker (api.recifriend.com)         │
│  + POST /devices/register       (APNs token)    │
│  + DELETE /devices/register     (on sign-out)   │
│  + POST /recipes/:id/share      (new feature)   │
│  + APNs sender (signs JWT with .p8, HTTP/2)     │
│  + Cleanup on BadDeviceToken/Unregistered       │
└─────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare D1 (recipes-db)                     │
│  + device_tokens    (new)                       │
│  + recipe_shares    (new)                       │
│  + existing tables unchanged                    │
└─────────────────────────────────────────────────┘
```

**Invariant:** The React PWA source in `apps/recipe-ui/` is shared between the web deploy and the iOS bundle. Every feature is one React component that runs in both places. Platform-specific code lives behind `Capacitor.isNativePlatform()` guards.

## 5. Milestones

### M0 — Prerequisites (parallel, starts day 0)

- Apple Developer Program signup ($99/yr; 24–48h approval)
- Xcode install (~40GB; overnight)
- Reserve bundle ID `com.recifriend.app` in Apple Developer portal
- Draft privacy policy page covering: email, recipes, friend graph; third parties Supabase, Cloudflare, Gemini, Resend, Apple APNs; user rights

### M0.5 — Rebrand to ReciFriend (days 1–3)

**Domain & infrastructure:**
- Add `recifriend.com` to Cloudflare as a DNS zone
- Cloudflare Pages custom domain: `recifriend.com` + `www.recifriend.com`
- Worker custom domain: `api.recifriend.com`
- Update `apps/recipe-ui/.env.production` and `.env.local`: `VITE_RECIPES_API_BASE_URL=https://api.recifriend.com`
- Update `apps/worker/wrangler.toml` routes
- Supabase → Auth → URL Configuration: add `https://recifriend.com/**` and `https://www.recifriend.com/**` redirect URLs (keep old ones during transition)
- Google Cloud Console → OAuth client: add `recifriend.com` authorized redirect URIs
- 301 redirect `recifind.elisawidjaja.com/*` → `recifriend.com/*` via Cloudflare Rules — **kept indefinitely** so previously shared recipe links don't break

**Branding:**
- Global replace "ReciFind" → "ReciFriend" in:
  - `apps/recipe-ui/src/App.jsx` user-facing strings
  - Email templates (nudge emails, friend requests)
  - Landing page copy
  - OG tags (`apps/recipe-ui/functions/_middleware.js`)
  - `index.html` `<title>`, meta descriptions
- Logo, favicon, OG image — new assets for ReciFriend
- App icon 1024×1024 PNG (no transparency, no rounding) — reused for App Store

**Email:**
- Resend: add `recifriend.com` as verified sending domain, configure SPF/DKIM/DMARC DNS records
- Change `from` address to `hello@recifriend.com`
- Update all transactional email templates (sender name + body copy)

**Checkpoint (all must pass before next milestone):**
- `recifriend.com` loads the app; sign-in with Google + email works end-to-end
- `recifind.elisawidjaja.com/recipes/<any-existing-id>` 301-redirects to the same path on `recifriend.com`
- Friend-request email delivers from `@recifriend.com` with no spam flag (test to Gmail + iCloud inboxes)
- OG tag preview for a shared recipe URL renders on iMessage and Slack with new branding

### M1 — Capacitor shell (days 4–6)

**New workspace:** `apps/ios/`

**Plugins installed:**
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`
- `@capacitor/app` — deep-link handling
- `@capacitor/browser` — OAuth flow
- `@capacitor/preferences` — Keychain-backed storage for Supabase session
- `@capacitor/push-notifications` — APNs registration

**Config:**
```
capacitor.config.ts:
  appId: 'com.recifriend.app'
  appName: 'ReciFriend'
  webDir: '../recipe-ui/dist'
  ios: { scheme: 'recifriend' }
```

**Xcode project:**
- URL scheme `recifriend` registered in `Info.plist` under `CFBundleURLTypes`
- Permission strings: `NSUserNotificationsUsageDescription` (notifications), `NSCameraUsageDescription` (reserved for later)
- APNs entitlement: `aps-environment = development` (sandbox) and `production` (App Store)

**Checkpoint:** PWA renders in iOS Simulator; app runs on a real iPhone via Xcode; basic navigation works (auth covered in M2).

### M2 — Auth in Capacitor (days 7–8)

**Auth callback uses Universal Links (NOT custom URL scheme).** Custom URL schemes can be claimed by any other app on the device — an attacker app registering `recifriend://` could intercept OAuth codes. Universal Links (`https://recifriend.com/auth/callback`) are cryptographically bound to the domain via `apple-app-site-association` and cannot be hijacked.

**Supabase client must use PKCE flow:**
```js
const supabase = createClient(url, anonKey, {
  auth: { flowType: 'pkce', storage: capacitorPreferencesAdapter }
});
```

**Universal Link setup (one-time, M0.5 or M2):**
- Host `https://recifriend.com/.well-known/apple-app-site-association` — JSON file mapping `applinks` to `com.recifriend.app`. Served with `Content-Type: application/json`, no redirects, no auth. (Cloudflare Pages serves this from `apps/recipe-ui/public/.well-known/`.)
- Add `Associated Domains` entitlement to the iOS app: `applinks:recifriend.com`

**Change in `apps/recipe-ui/src/App.jsx` (sign-in handler):**
```js
if (Capacitor.isNativePlatform()) {
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://recifriend.com/auth/callback',
      skipBrowserRedirect: true
    }
  });
  await Browser.open({ url: data.url });
} else {
  // existing web redirect flow, unchanged
}
```

**Deep-link handler** with explicit input validation (new — lives in `App.jsx` mount effect):
```js
const ALLOWED_PATHS = new Set(['/auth/callback', '/add-recipe', '/friend-requests']);
const ALLOWED_HOSTS = new Set(['recifriend.com', 'www.recifriend.com']);

CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
  const parsed = new URL(url);

  // 1. Reject anything outside our own scheme + host allowlist
  const isUniversalLink = parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.host);
  const isCustomScheme  = parsed.protocol === 'recifriend:';
  if (!isUniversalLink && !isCustomScheme) return;

  // 2. Reject unknown paths / recipe-id format
  if (parsed.pathname.startsWith('/recipes/')) {
    const id = parsed.pathname.slice('/recipes/'.length);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return;
    navigateToRecipe(id);
    return;
  }
  if (!ALLOWED_PATHS.has(parsed.pathname)) return;

  if (parsed.pathname === '/auth/callback') {
    // Only accept auth callback via Universal Link; reject via custom scheme
    if (!isUniversalLink) return;
    await supabase.auth.exchangeCodeForSession(parsed.searchParams.get('code'));
    await Browser.close();
  } else if (parsed.pathname === '/add-recipe') {
    const sharedUrl = parsed.searchParams.get('url');
    // Only allow http(s) URLs in the shared payload
    if (!sharedUrl || !/^https?:\/\//.test(sharedUrl)) return;
    openAddRecipeDialog({ prefilledUrl: sharedUrl });
  }
});
```

**Why both schemes?** Universal Links for anything sensitive (auth callback, push deep links). Custom scheme `recifriend://` for the share extension handoff only — share extension must reliably open the app when installed, and the payload (a URL) is not sensitive.

**Supabase storage adapter** using `@capacitor/preferences`:
- ~15 lines. Supabase client `auth.storage` config.
- Session persists across app launches in Keychain.

**Sign in with Apple:**
- Supabase Auth → Providers → enable Apple
- Apple Developer portal: create Service ID, Apple Private Key (.p8), configure in Supabase
- Add "Continue with Apple" button in `App.jsx`, gated on `Capacitor.isNativePlatform()`
- Reuses the same `Browser.open` pattern — no new code paths

**Sign-out:**
- `await supabase.auth.signOut()`
- `DELETE /devices/register` with current APNs token
- Clear Preferences

**Checkpoint:** Full sign-in (Google + Apple) works on a real iPhone; signing out and back in round-trips cleanly.

### M3 — Share-to-friends feature (days 9–12) — **WEB + iOS**

This is the only section that changes user-visible PWA behavior. Ships to web first, then iOS.

**Database migration** (`apps/worker/migrations/`):
```sql
CREATE TABLE recipe_shares (
  id TEXT PRIMARY KEY,          -- uuid
  sharer_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER               -- nullable; set when recipient views
);
CREATE INDEX idx_recipe_shares_recipient
  ON recipe_shares(recipient_id, created_at DESC);
CREATE INDEX idx_recipe_shares_sharer
  ON recipe_shares(sharer_id, created_at DESC);
```

**New endpoint** in `apps/worker/src/index.ts`:
```
POST /recipes/:id/share
  body: { recipient_user_ids: string[] }
  auth: required
  validation:
    - recipient_user_ids.length between 1 and 50
    - dedupe recipient_user_ids (ignore duplicates)
    - reject if any recipient_user_id == sharer's user_id
    - reject any recipient who is not a confirmed friend of the sharer
    - rate limit: max 20 shares per user per hour (Workers KV counter)
  behavior:
    - insert one recipe_shares row per recipient
    - fire one APNs push per recipient (via M5 infra)
    - return { shared_with: number, skipped: number }
```

**Frontend component** (new — `apps/recipe-ui/src/FriendPicker.jsx`):
- Modal dialog, opens from the recipe detail Share button
- Lists all connected friends with avatar + name
- Multi-select with checkboxes
- "Send" button — calls `POST /recipes/:id/share`
- Success toast: "Shared with N friends"
- Works identically on web and iOS — no platform branching

**Wire into existing share button** in recipe detail (in `App.jsx`):
- Current behavior: copy link to clipboard
- New behavior: opens friend picker. Option to fall back to "Copy link" at bottom of picker.

**Update `📤 Recently shared by friends`** home-feed section. Currently backed by `/friends/recently-shared` (per [FriendSections.jsx](apps/recipe-ui/src/FriendSections.jsx)). **Change semantics:** that endpoint now queries `recipe_shares` where `recipient_id = me`, ordered by `created_at DESC`, limit 10. Old source (whatever it was) is retired — verify no other component depends on the old behavior before removing.

**Checkpoint:** Tunnel preview → ship to web PWA → verify in prod with two test accounts → only then does iOS depend on it.

### M4 — Share Extension + deep links (days 13–15)

**Swift share extension** (new Xcode target `ShareExtension`):
- Bundle ID: `com.recifriend.app.share`
- Activation rule: `public.url` OR `public.plain-text` (covers TikTok, Instagram, Reels, Safari)
- Single file (~150 lines Swift): extract first URL from shared items → construct `recifriend://add-recipe?url=<urlencoded>` → call `extensionContext?.open(url)` → call `completeRequest`
- Edge case: no URL in payload → `completeRequest(returningItems: nil, completionHandler: { _ in self.extensionContext?.cancelRequest(withError:) })`

**Main app deep-link handling** — already covered in M2. The `/add-recipe` path opens the Add Recipe dialog with `prefilledUrl` set. The existing auto-enrich flow in the web app picks it up.

**No App Group, no shared Keychain, no background API calls from the extension.**

**Checkpoint:** On a real iPhone, share a TikTok reel → ReciFriend icon appears in share sheet → tap it → app opens with URL pre-filled, auto-enrichment runs, Save works.

### M5 — Push notifications (days 16–19)

**Database migration:**
```sql
CREATE TABLE device_tokens (
  user_id TEXT NOT NULL,
  apns_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, apns_token)
);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
```

**New Worker secrets** (via `wrangler secret put`):
- `APNS_AUTH_KEY_P8` — contents of the .p8 file from Apple Developer portal
- `APNS_KEY_ID` — 10-char key ID
- `APNS_TEAM_ID` — 10-char Apple Team ID
- `APNS_BUNDLE_ID` — `com.recifriend.app`

**New endpoints:**
- `POST /devices/register` — body `{ apns_token }` — upserts row
  - Validate: `apns_token` is 64 hex chars (APNs format)
  - Rate limit: 20 registrations per user per hour (prevents spam if a token is compromised)
- `DELETE /devices/register` — body `{ apns_token }` — removes the row for the caller's user (scoped to the authenticated user, can't delete other users' rows)

**New module** `apps/worker/src/push/apns.ts`:
- `sendPush(userId, title, body, deepLink)`
- Queries `device_tokens` for user's tokens
- Signs APNs JWT using `jose` (already in deps) with ES256 + .p8 key
- POSTs to `https://api.push.apple.com/3/device/<token>` per token, in parallel
- On `BadDeviceToken` or `Unregistered` response → delete that token row

**APNs payload format** (what the Worker sends, what the client reads):
```json
{
  "aps": {
    "alert": { "title": "ReciFriend", "body": "<body>" },
    "sound": "default"
  },
  "deep_link": "https://recifriend.com/recipes/<id>"
}
```
Client reads `notification.data.deep_link` on `pushNotificationActionPerformed` and feeds it to the same validated deep-link handler from M2 (never `openURL` the value directly — always validate against the allowlist).

**Integration points** (wire into existing handlers):

| Trigger | Handler edited | Push copy | Deep link |
|---|---|---|---|
| Friend request received | friend request `POST` | "Elisa wants to connect on ReciFriend" | `https://recifriend.com/friend-requests` |
| Recipe saved by someone | `POST /recipes/:id/save` | "Sarah saved your Pad Thai" | `https://recifriend.com/recipes/<id>` |
| Recipe shared with you | `POST /recipes/:id/share` (from M3) | "Elisa just shared a Pad Thai recipe with you. View >" | `https://recifriend.com/recipes/<id>` |

**Why Universal Links in push payloads:** if user taps the push and doesn't have the app installed (e.g., deleted since), the same link opens the web version gracefully.

**Permission prompt timing — important:** Do **not** prompt immediately after sign-in (Apple's guidance, and users reject prompts they don't understand yet). Prompt the **first time** the user takes a social action: after they send a friend request, after they share a recipe, after they accept a friend request. Soft-prompt inline first ("Get notified when your friend accepts?"), then call `PushNotifications.requestPermissions()` only if they tap Yes.

**Client registration** (in `App.jsx`, fires once permission is granted):
```js
if (Capacitor.isNativePlatform() && await hasGrantedPushPerm()) {
  await PushNotifications.register();
  PushNotifications.addListener('registration', async ({ value }) => {
    await api.post('/devices/register', { apns_token: value });
  });
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const link = notification.data?.deep_link;
    if (link) handleDeepLink(link);   // same handler as M2/M4
  });
}
```

**Checkpoint:** On a real iPhone, trigger each of the three events with two test accounts. Each push lands on the lock screen, tapping navigates to the correct in-app screen.

### M6 — App Store submission (days 20–22)

**Assets ready:**
- App icon 1024×1024 (already built during M0.5)
- 3–10 screenshots at 6.7" (iPhone 15 Pro Max), captured from Simulator
- App Store description leading with the share-from-social-media feature (mitigates "minimum functionality" review risk)
- Keywords: recipes, cooking, share, friends, social, meal, food
- Category: Food & Drink (primary), Social Networking (secondary)
- Age rating: 4+
- Support URL, privacy policy URL (from M0)

**Submission steps:**
1. In Xcode: bump version 1.0.0, build 1
2. Product → Archive
3. Organizer → Distribute → App Store Connect → Upload
4. Wait ~15–30 min for processing
5. In App Store Connect: fill metadata, attach build, submit for review
6. Apple review (~24h typical)
7. Release manually once approved

**Known review risks:**
- **Guideline 4.8 — Sign in with Apple** → already included in M2
- **Guideline 4.2 — minimum functionality** → mitigation: share extension, directed sharing, push notifications push us well past "wrapped website." App description leads with the share feature.
- **Permission copy** — every permission string is human-readable and app-specific.

**Checkpoint:** Live on the App Store under the name "ReciFriend."

## 6. Definition of done (v1)

- PWA at `recifriend.com` works identically to old recifind site (zero regressions)
- Old `recifind.elisawidjaja.com` 301-redirects to `recifriend.com`
- iOS app installs from App Store as "ReciFriend"
- Share from TikTok / Instagram / Safari → ReciFriend icon in share sheet → tap → app opens Add Recipe with URL prefilled → auto-enrich runs → Save
- Friend picker in recipe detail (web + iOS) → selected friends receive push + see it in recently-shared feed
- Three pushes deliver reliably on a real device: friend request, recipe saved, recipe shared
- Emails send from `@recifriend.com` with working SPF/DKIM/DMARC

## 7. Timeline summary

| Phase | Days | Work |
|---|---|---|
| M0 | 0 (parallel) | Apple Dev signup, Xcode, privacy policy |
| M0.5 | 1–3 | Rebrand to ReciFriend |
| M1 | 4–6 | Capacitor shell |
| M2 | 7–8 | Auth in Capacitor |
| M3 | 9–12 | Share-to-friends (web + iOS) |
| M4 | 13–15 | Share Extension + deep links |
| M5 | 16–19 | Push notifications |
| M6 | 20–22 | App Store submission |

**Total: 20–22 focused days.** Realistic calendar time for a solo builder: **5–7 weeks**.

## 8. Testing strategy

Three-layer gate before any App Store submission, mirroring existing "tunnel preview before deploy" habit:

1. **Simulator** (`npx cap run ios`) — layouts, sign-in, web flows
2. **Real iPhone via Xcode** (plug in + Cmd-R) — share extension (TikTok), APNs pushes (required, simulator can't receive them), deep links
3. **TestFlight internal** — full pipeline dry-run with at least one other test account

Every web-side change (M0.5, M3) goes through the existing tunnel preview (`dev-recifind.elisawidjaja.com`, the dev-only subdomain — this is an internal-only surface and does not need to be rebranded as part of M0.5) before deploying to prod.

## 9. Security

Going in order of "would matter if it broke":

### S1 — OAuth code interception (HIGH)

**Threat:** any iOS app can register a custom URL scheme like `recifriend://`. If such an app is installed first, it can intercept the OAuth callback and steal the authorization code, which is exchangeable for a Supabase session.

**Mitigation (enforced in M2):**
- Auth callback uses a **Universal Link** (`https://recifriend.com/auth/callback`), not a custom scheme. Universal Links are bound to the domain via `apple-app-site-association` and cannot be hijacked.
- **PKCE flow enforced** (`flowType: 'pkce'` on Supabase client). Even if a code leaks, it can't be exchanged without the code_verifier stored on the device.
- Deep-link handler rejects `/auth/callback` paths coming in via the custom scheme.

### S2 — Deep-link injection (HIGH)

**Threat:** any deep link (custom scheme or Universal Link) can be triggered by anyone — an email, a Slack message, a malicious webpage. The handler must treat URL + query params as untrusted input.

**Mitigation (enforced in M2 handler):**
- Path allowlist: only `/auth/callback`, `/add-recipe`, `/friend-requests`, `/recipes/:id` navigate; everything else is dropped silently.
- Recipe ID regex-validated (`[a-zA-Z0-9_-]{1,64}`).
- Shared URL in `/add-recipe?url=…` is validated as `http(s)://…` before being handed to the Add Recipe dialog.
- `/auth/callback` only accepted via Universal Link (rejects custom scheme entirely).
- Push-delivered `deep_link` is fed through the same validated handler — never `openURL`'d directly.

### S3 — Recipe share authorization (MEDIUM)

**Threat:** IDOR via `POST /recipes/:id/share` — can Alice share a private recipe she doesn't own to Bob, exposing content?

**Decision:** sharing is only permitted for recipes the sharer can **already view** (same visibility rules the Recipe Detail endpoint enforces). Sharing a recipe **implicitly grants the recipient view access**, modeled as a row in `recipe_shares`. The recipe detail API already checks visibility; we extend it to also allow access if `(recipe_id, current_user) ∈ recipe_shares` where `recipient_id = current_user`.

**Implementation (M3):**
- `POST /recipes/:id/share` handler: call the existing "can I view this recipe?" check before inserting rows; reject with 403 if not.
- `GET /recipes/:id` handler: add a secondary permission check — if the recipe is private and the caller doesn't own it, allow if there's a `recipe_shares` row with `recipient_id = caller`.

### S4 — APNs auth key leak (HIGH if it happens; LOW probability)

**Threat:** the `.p8` key can send pushes to any ReciFriend user. If leaked, attacker can spoof notifications ("Your account is locked — tap here to reset" → malicious URL).

**Mitigation:**
- **Never** commit the `.p8` to git (add `*.p8` to `.gitignore` in M0.5).
- Stored only as a Cloudflare Worker secret (`APNS_AUTH_KEY_P8`) via `wrangler secret put` — never logged, never returned in any endpoint.
- Downloaded once from Apple Developer portal → saved to 1Password (or similar) immediately.
- **Rotation plan:** if leak is suspected, revoke the key in Apple Developer portal (takes effect immediately), generate a new one, update the Worker secret. Users briefly stop receiving pushes; no user action required.
- Since push `deep_link` is validated client-side (S2), a spoofed push can't navigate the app anywhere dangerous — it can only display text.

### S5 — Privacy Manifest required by Apple (MEDIUM)

**Threat:** App Store rejection or silent enforcement block — iOS 17.4+ requires a `PrivacyInfo.xcprivacy` file declaring data collection practices and "required reason API" usage.

**Mitigation (M1):**
- Add `apps/ios/App/PrivacyInfo.xcprivacy` declaring:
  - Data types collected: email address, user ID, device ID (APNs token), user content (recipes)
  - Purposes: app functionality, analytics (none yet, but plan ahead)
  - Tracking: none
  - Required Reason APIs: `UserDefaults` (declared reason), `FileTimestamp` (if used)
- Matches what's in the public privacy policy (M0).

### S6 — Supabase anon key in bundled iOS app (LOW)

**Threat:** the Vite build inlines `VITE_SUPABASE_ANON_KEY` into the JS bundle. In the iOS app, this JS ships to every user's device — the anon key is effectively public.

**Mitigation:** this is Supabase's intended design — Row Level Security (RLS) is what actually protects data, not the anon key. Required verification in M0.5:
- Audit all Supabase tables used on the client have RLS enabled and policies that restrict access to `auth.uid() = owner_id` (or equivalent) — the existing web app has this; new iOS app does not change the threat model.

### S7 — Share extension URL exfiltration (LOW)

**Threat:** share extension receives URLs from social apps. If the extension logged the URL somewhere insecure (analytics, remote log), private links (unlisted YouTube, private Instagram) could leak.

**Mitigation:** the extension does **not** send the URL anywhere over the network. It only passes the URL to the main app via `openURL(recifriend://add-recipe?url=…)`. No analytics SDK, no remote logging in the extension target. Auto-enrichment calls happen in the main app under the user's JWT, same trust boundary as pasting the URL by hand.

### Security acceptance checklist (part of pre-submission)

- [ ] All deep-link paths handled via the allowlist validator
- [ ] Supabase client uses `flowType: 'pkce'`
- [ ] Universal Link file served at `/.well-known/apple-app-site-association` with correct `Content-Type` and no redirects
- [ ] `apple-app-site-association` lists `com.recifriend.app` and the right paths
- [ ] `Associated Domains` entitlement added to iOS app
- [ ] `.p8` not in git; only in Cloudflare Worker secrets and offline backup
- [ ] All Supabase tables touched by the client have RLS enabled with a reviewed policy
- [ ] `PrivacyInfo.xcprivacy` matches privacy policy at recifriend.com
- [ ] `POST /recipes/:id/share` validates sharer can view the recipe before inserting rows
- [ ] `GET /recipes/:id` grants access to `recipient_id` rows in `recipe_shares`
- [ ] All new endpoints require authentication (no `/public/*` additions)
- [ ] Penetration smoke test: attempt to fire deep links with malicious params from Safari (`recifriend://auth/callback?code=fake`, `recifriend://add-recipe?url=javascript:alert(1)`, etc.) — all must be rejected

## 10. Assumptions and open items

- **Apple Developer account approval** takes 1–2 days typically; could be longer if ID verification is flagged. Not on critical path for M1 (simulator works without it).
- **Resend DNS propagation** for the new sending domain can take up to 24h. Plan M0.5 accordingly.
- **App Store review** usually 24h but occasionally rejects on first pass; build in buffer.
- **Supabase Apple provider** setup (Service ID + .p8) takes ~1–2 hours of config, not coding.
- **APNs auth key (.p8)** is downloaded **once** from Apple Developer portal — back it up securely; can't be re-downloaded.
