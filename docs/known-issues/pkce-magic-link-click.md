# PKCE magic-link click — fix not yet fully verified

**Status:** ⚠️ Likely fixed, **not** confirmed end-to-end on real device.

## What was diagnosed

Tapping the magic-link button in a sign-in email on iOS produced
`PKCE code verifier not found in storage`. Root cause confirmed via
Web Inspector + simctl:

1. Capacitor delivers cold-boot deep links via TWO paths — the
   `appUrlOpen` listener AND the `getLaunchUrl()` cold-start handler.
2. `dispatchDeepLink` ran twice for the same URL.
3. Supabase's `exchangeCodeForSession` consumes the PKCE code_verifier
   on first read (one-time use, replay protection).
4. The second invocation found the verifier gone → PKCE error.

## What was fixed

- `apps/recipe-ui/src/App.jsx` — module-scope `dispatchedDeepLinks`
  Set deduplicates URLs at the dispatch level. Survives React remounts
  (HMR / sign-in/out cycles) so the second magic-link attempt within an
  app run also benefits.
- `apps/recipe-ui/src/supabaseClient.js` — Supabase storage moved from
  Capacitor Preferences (UserDefaults, async-to-disk) to iOS Keychain
  via SharedAuthStorePlugin. Synchronous flush, durable across app
  kills.
- `apps/recipe-ui/vite.config.js` — `no-store` cache headers so the
  Cloudflare tunnel doesn't serve stale JS to the iOS WebView during
  dev.

## What is verified

- ✅ Keychain round-trip (write → read → consume) works in isolation
- ✅ `signInWithOtp` writes the verifier via the keychain adapter
- ✅ `exchangeCodeForSession` reads + deletes the verifier on first call
- ✅ First magic-link click after a clean install **did succeed** in
  one device test
- ✅ 6-digit OTP code path works for Gmail and Hotmail (separate fix)

## What is NOT yet verified

- ❌ Second consecutive magic-link click in the same app run, after the
  module-scope dedup landed. The earlier `useRef` version failed on
  this case; the new module-scope Set should fix it but **was not
  re-tested before Resend / Supabase magic-link send rate limits were
  hit during the debug session**.

## To verify when rate limits replenish

On a real iPhone (not simulator — simctl doesn't reproduce the cold-boot
dual-dispatch faithfully):

1. Force-quit ReciFriend, reopen.
2. Share recipe → Send magic link → tap link in email. **Expect: signed
   in, drawer opens.**
3. Sign out (Profile → Sign out).
4. Share recipe → Send magic link → tap NEW link in email. **Expect:
   signed in again. This is the regression case.**
5. (Optional) Repeat once more for confidence.

If step 4 succeeds, the dedup fix holds and this issue is resolved.

If step 4 fails with `PKCE code verifier not found`, attach Safari Web
Inspector to the WebView before tapping the email link and capture the
`[deeplink]` lines on dispatch. Specifically watch for whether
`[deeplink] dedup skip` fires, and whether there are >1
`exchangeCodeForSession` calls for the same code.

## Workaround until verified

Users who hit the PKCE error on the link click can **enter the 8-digit
code** from the email body instead. That path is fully verified and
doesn't depend on PKCE storage. The new email template
(`docs/supabase-email-templates/magic-link.html`) puts the code first
to steer users toward it naturally.
