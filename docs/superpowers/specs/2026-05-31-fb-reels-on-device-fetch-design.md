# Facebook reels via on-device og fetch

Date: 2026-05-31
Status: Design approved, pending spec review

## Summary

Facebook reels (`facebook.com` / `fb.watch`) are currently rejected at the
source-host allowlist because the worker is login-walled from Cloudflare's
datacenter IPs: it gets a ~1.2KB login wall with zero og tags, so it can never
parse or enrich an FB reel. The follow-up makes FB reels importable by fetching
their og metadata **on-device** in the iOS Share Extension, where requests come
from a residential IP that Facebook will serve, then re-enabling FB on the
worker allowlist so the share-save path no longer 400s.

Outcome for FB: a clean dish-name **title + thumbnail**, best-effort. No
ingredients/steps (the recipe lives in the video; the worker still can't reach
FB to enrich). This mirrors how Instagram is already handled in
`DeviceMetadataFetcher`.

This is native iOS + worker work. It changes a native target, so it requires a
new bundle: **`MARKETING_VERSION` 1.0.7, `CFBundleVersion` 27**.

## Background

- `apps/ios/ios/App/ShareExtension/DeviceMetadataFetcher.swift` already does the
  residential-IP og fetch (Safari UA, og:description/og:image extraction, HTML
  entity decode, dish-name heuristic) but its host guard only admits
  Instagram / TikTok / YouTube. It has an IG-specific engagement-prefix stripper
  and a shared `extractDishName`.
- `ShareFormView.loadPreview` races the worker `/recipes/parse` against the
  device fetch and **prefers the worker title** when non-empty, falling back to
  the device result, then the URL host.
- The worker (`apps/worker/src/index.ts`) already has inert FB plumbing:
  `isFacebook` detection, an FB `og:description` title branch (which currently
  takes the caption raw, no engagement-prefix strip), the `isFacebookLinkShim`
  open-redirect security guard, and `fb.watch` resolution in `resolveSourceUrl`.
  FB is only commented out of `ALLOWED_SOURCE_HOSTS`.
- The exact FB `og:description` format (the `"N views · M reactions · …"`
  prefix) is **unknowable from a datacenter IP** — it must be validated against
  real captured device output during the dev phase.

## Decisions (from brainstorming)

- **Approach: device-side mirror of the Instagram path.** Rejected: a new worker
  endpoint that strips/extracts from a device-supplied caption (extra round-trip
  inside the 4s share-extension budget, new contract), and passing raw og into
  the existing parse call (muddies the worker/device split).
- **Empty-fetch degraded behavior: editable `"Facebook Reel"` placeholder.** When
  the on-device og fetch returns nothing (user not logged into FB in Safari, or
  FB login-walls even their residential IP), save is still allowed and the title
  pre-fills as `"Facebook Reel"` (a clean, obviously-editable stand-in) instead
  of the junk `facebook.com` hostname.
- **Device wins for FB.** The worker is login-walled, so for FB URLs the device
  result takes precedence over the worker result.
- **Re-allowlisting FB is required**, not optional: the allowlist gates
  `/recipes/create` and `/enrich`, so without it the share sheet rejects FB with
  a 400 even when the device fetched a perfect title.
- Rollout is **dev-first and approval-gated**; worker change is additive, so the
  revert mechanism is Cloudflare instant rollback (`wrangler rollback`).

## Design

### Component 1: `DeviceMetadataFetcher.swift` (core change)

- **Host guard:** add
  `isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")`
  to the `guard isInstagram || isTikTok || isYouTube || isFacebook` set.
  URLSession follows redirects by default, so a `fb.watch/xxx` short link
  resolves to the canonical reel page before og parsing — no manual resolution
  needed on-device.
- **Engagement-prefix stripper:** add an `isFacebook` block parallel to the
  existing IG block. FB `og:description` leads with engagement stats
  (`"562K views · 5K reactions · …"`). Strip a leading run of
  `<number><K/M/B optional> <views|reactions|likes|comments|shares>` segments
  separated by `·`, `,`, or whitespace, then any trailing author/`": "` lead-in,
  leaving the bare caption. **This regex is a best-guess starting point** that is
  validated and refined against real captured output in Phase C (Component 5).
- **Title + image:** feed the stripped caption to the existing `extractDishName`
  (dish-name-before-emoji → first sentence → truncation) and take `og:image` for
  the thumbnail. No FB-specific dish-name logic.

### Component 2: `ShareFormView.loadPreview` precedence

Add a host check so that **for Facebook URLs the device result is preferred**,
falling back to the worker result, then to the `"Facebook Reel"` placeholder
instead of the `facebook.com` hostname. Instagram / TikTok / YouTube / blog
precedence is unchanged (worker-first, then device, then host).

### Component 3: Worker allowlist + stripper (`index.ts`)

- Re-add `'facebook.com'` and `'fb.watch'` to `ALLOWED_SOURCE_HOSTS`, replacing
  the parked-comment block. Required so `/recipes/create` and `/enrich` accept FB.
- Tighten the worker FB `og:description` branch (which currently takes the
  caption raw) to apply the same engagement-prefix strip before
  `extractTikTokRecipeTitle`. Defense-in-depth: rarely hit (FB login-walls the
  datacenter), but keeps worker output sane if FB ever serves og to it (e.g. via
  `r.jina.ai` in `textInference`).
- `isFacebookLinkShim` open-redirect guard stays as-is (untouched security check).

### Component 4: Worker tests (`enrich.test.ts`)

- Flip the allowlist assertions: `isAllowedSourceHost('facebook.com')`,
  `'www.facebook.com'`, `'fb.watch'` → `true`. Rename the `describe`/`it` away
  from "does NOT allowlist … yet".
- Keep unchanged: spoofed-subdomain rejection (`facebook.com.evil.com` → false),
  shim rejection, fb.watch resolution.
- Add a unit test for the worker FB prefix stripper:
  `"562K views · 5K reactions · Pasta Carbonara 🍝"` → `"Pasta Carbonara"`.

### Component 5: Capture-and-refine workflow (dev phase)

Because the real FB `og:description` format is invisible from a datacenter IP,
the dev build adds a **temporary** `os_log` of the raw `og:description` and the
stripped result in `DeviceMetadataFetcher`, viewable in **Console.app** while
sharing on a tethered device (no Xcode debugger-attach to the extension needed).
Capture 3–5 real FB reels, refine the Swift regex (and mirror the change into
the TS copy in Component 3) until titles come out clean, then **remove the
logging** before the ship build.

### Component 6: Release

Native target changed → new bundle: `MARKETING_VERSION` **1.0.7**,
`CFBundleVersion` **27**. `APNS_HOST` is not touched (push is unrelated); leave
it at prod/unset as it is now. The wrangler-can't-manage-secrets caveat does not
apply — re-allowlisting is a code deploy, not a secret change.

## Test plan

### Worker unit tests (vitest, `apps/worker`)

- `isAllowedSourceHost`: `facebook.com`, `www.facebook.com`, `fb.watch` → true;
  `facebook.com.evil.com`, `fb.watch.evil.com` → still false.
- Worker FB prefix stripper: engagement-prefixed `og:description` → clean title.
- Regression: full existing suites stay green (`cd apps/worker && npm test`).

### Pre-deploy smoke test (protect-import-flow rule)

`POST /recipes/parse` for an IG reel, a TikTok, the AllRecipes blog URL, and a
`fb.watch` reel → none regress. `POST /recipes/enrich` (DEV_API_KEY) for an IG
reel → unchanged.

### Manual on-device (Phase C gate)

- iOS share a real FB reel → clean dish-name title + thumbnail land.
- iOS share an FB reel that login-walls / returns no og → `"Facebook Reel"`
  editable placeholder (not `facebook.com`).
- Regression: iOS share one IG reel + one TikTok → still work as today.
- Explicit user approval required here before prod.

## Rollout (dev-first, approval-gated)

- **Phase A — Implement + tests.** Components 1–4; all vitest green (unit +
  regression).
- **Phase B — Deploy to dev only.** Worker → dev:
  `cd apps/worker && npx wrangler deploy --env dev` (`recipes-worker-dev` on
  `api-dev.recifriend.com`; prod worker untouched). Point `WorkerClient.swift` at
  `api-dev.recifriend.com`; build in Xcode.
- **Phase C — Manual verification (the gate).** Capture-and-refine the regex
  on-device (Component 5); run the manual on-device tests above. Explicit
  approval required.
- **Phase D — Prod deploy + revert.** Only after approval: remove dev logging;
  **revert `WorkerClient.swift` to `api.recifriend.com`**; record current live
  prod deployment ID (`npx wrangler deployments list`); confirm clean `git
  status` baseline; run the pre-deploy smoke test; `cd apps/worker && npx
  wrangler deploy`; archive build 27 in Xcode. Hard stop / rollback:
  `npx wrangler rollback <prev-id>` (additive change, frontend untouched).

## Out of scope

- FB ingredients/steps (recipe is in the video; worker can't reach FB) — title +
  thumbnail only.
- Any frontend (web) change.
- Reliable FB content via video transcription or a residential proxy.
