# Security acceptance checklist — ReciFriend 1.0 submission

Date: 2026-04-25
Verifier: Elisa Widjaja (with agent assistance)
Git commit at time of audit: `258d8169`

## Checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | All deep-link paths handled via `parseDeepLink` allowlist | ✅ | Single chokepoint: `apps/recipe-ui/src/lib/deepLinkDispatch.js:1` imports `parseDeepLink` from `apps/shared/deepLink.ts`. `App.jsx:115` imports `createDispatcher` and is the sole consumer for both `appUrlOpen` (App.jsx:1585) and `pushNotificationActionPerformed` (`apps/recipe-ui/src/lib/pushClient.js:52`). |
| 2 | Supabase client uses `flowType: 'pkce'` on native | ✅ | `apps/recipe-ui/src/supabaseClient.js:20` — `flowType: Capacitor.isNativePlatform() ? 'pkce' : 'implicit'`. iOS app runs as native, so the App Store binary uses PKCE. Web continues with implicit (server-side validation handles it). |
| 3 | AASA file: correct Content-Type, no redirects | ✅ | `curl -I https://recifriend.com/.well-known/apple-app-site-association` → `HTTP/2 200`, `content-type: application/json`, no `Location:` header. |
| 4 | AASA `appID` matches Team ID + bundle | ✅ | AASA body: `"appID": "7C6PMUN99K.com.recifriend.app"`. Xcode project: `DEVELOPMENT_TEAM = 7C6PMUN99K`, `PRODUCT_BUNDLE_IDENTIFIER = com.recifriend.app`. |
| 5 | Associated Domains entitlement live | ✅ | `apps/ios/ios/App/App/App.entitlements` contains `<key>com.apple.developer.associated-domains</key>` with `applinks:recifriend.com`. |
| 6 | `.p8` not in git; only in Cloudflare secrets + offline backup | ✅ | `git log --all -- '*.p8'` returns no commits. `.gitignore` ignores `*.p8`. APNs key lives only in Worker secret `APNS_AUTH_KEY` (set via `wrangler secret put`). |
| 7 | All client-accessed Supabase tables have RLS + reviewed policies | ✅ | Story 01 RLS audit completed and merged (`profiles`, `recipes`, `friends`, `friend_requests`, `notifications`, `recipe_shares` all have policies). |
| 8 | `PrivacyInfo.xcprivacy` matches privacy policy | ✅ | `apps/ios/ios/App/App/PrivacyInfo.xcprivacy`: collects `EmailAddress`, `UserID`, `DeviceID`, `UserContent` — all linked to user, none used for tracking, all scoped to `AppFunctionality`. Matches `apps/recipe-ui/public/privacy.html` (account email, recipes, friend graph). UserDefaults API access reason: `CA92.1`. |
| 9 | `POST /recipes/:id/share` validates view permission | ✅ | `apps/worker/src/routes/share.ts:71-87` checks `recipe.user_id === sharerId \|\| shared_with_friends === 1 \|\| recipe_shares row exists` before allowing share; returns `FORBIDDEN` otherwise. Test: `routes/share.test.ts > "rejects if sharer cannot view the recipe (recipe not found)"` — passes. |
| 10 | `GET /recipes/:id` honors `recipe_shares` | ✅ | `apps/worker/src/index.ts:1149-1162` — view-permission lookup includes `SELECT recipe_id FROM recipe_shares WHERE recipient_id = ? AND recipe_id = ? LIMIT 1` so a recipient can read a recipe shared with them even if otherwise private. |
| 11 | All new endpoints require auth (no new `/public/*`) | ✅ | `/public/*` routes are read-only discovery feeds (`oembed-author`, `trending-recipes`, `discover`, `editors-pick`, `ai-picks`) added pre-Story-12. No new public routes introduced by Stories 03/05. Share + device-register both `throw new HttpError(401)` if `!user` — confirmed at `index.ts:483, 500, 503`. |
| 12 | Adversarial smoke test on physical iPhone | ⏳ | To be run during Task 6 (TestFlight smoke test) — not yet runnable until binary is on device. Test URLs listed below. |

## Adversarial smoke tests

**Run on a physical iPhone with the TestFlight build installed. Open Safari and paste each URL.** Record actual behavior in the rightmost column before submission.

| URL | Expected | Actual |
|---|---|---|
| `recifriend://auth/callback?code=fake` | App opens, no session change | |
| `recifriend://recipes/../../etc/passwd` | App opens, no navigation | |
| `recifriend://add-recipe?url=javascript:alert(1)` | App opens, no Add Recipe dialog | |
| `recifriend://add-recipe?url=file:///etc/passwd` | App opens, no Add Recipe dialog | |
| `https://evil.com/auth/callback?code=x` | Safari opens evil.com (app does NOT intercept) | |
| `recifriend://admin` | App opens, nothing happens | |

**Pass criterion:** all six rows behave as expected. Any deviation blocks submission until fixed.

## Known non-blocking issues

- `src/public.test.ts` has 2 failing tests (`getPublicDiscover > returns empty array...`) caused by a vitest mock missing `.bind()`. The production endpoint works correctly against real D1 — confirmed via `curl https://api.recifriend.com/public/discover`. Test mock fix is tracked separately and does not affect submission.
