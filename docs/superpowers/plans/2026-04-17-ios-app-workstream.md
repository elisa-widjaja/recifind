# iOS App + ReciFriend Rebrand — Workstream Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to dispatch one subagent per story. Each story file is self-contained and can be executed in isolation once its dependencies are green.

**Goal:** Ship a native iOS app to the App Store while rebranding to ReciFriend, with zero PWA regressions and no security compromises.

**Spec:** [`docs/superpowers/specs/2026-04-17-ios-app-rebrand-design.md`](../specs/2026-04-17-ios-app-rebrand-design.md)

**Architecture:** Capacitor wraps the existing React PWA into an iOS app (bundled JS). A Swift share extension hands URLs to the app via custom URL scheme. Push notifications via direct APNs from the Cloudflare Worker. OAuth uses Universal Links + PKCE to prevent interception. 12 stories designed for maximum parallelism, orchestrated via 5 integration gates.

**Tech Stack:** Capacitor 6.x, Supabase Auth (JS SDK), Cloudflare Workers + D1 + Pages, Swift 5 (share extension only), `jose` (APNs JWT), Vite/React 18.

---

## Workstream overview

```
Phase 0 (days 0+)           Phase 1 (days 1–3)       Phase 2 (days 4–10)                 Phase 3 (days 11–16)         Phase 4 (17–22)
───────────────────────     ────────────────────     ─────────────────────────────────   ──────────────────────       ──────────────────
non-code, parallel          SEQUENTIAL blocker        MAXIMUM PARALLELISM                 iOS features (some par)      SEQUENTIAL tail
                                                      (subagent swarm)

• Apple Dev signup          S01 Rebrand              S02 Contracts (30m) ────┐            S09 iOS Auth ────┐           S12 Submission
• Xcode download                                      ↓                      │            S10 Share Ext ────┤
• Privacy policy draft                                S03 Share BE (W) ──────┤            S11 Push client ──┘
                                                      S04 Friend Picker (F)  │                 ↓
                                                      S05 Push BE (W)        │       (G3) iOS Auth verified
                                                      S06 Deep Link Validator│       (G4) Share Ext e2e
                                                      S07 Universal Link file│       (G5) Push e2e
                                                      S08 Capacitor Bootstrap│
                                                                ↓            │
                                                      (G1) Web PWA ship ─────┘
                                                      (G2) APNs dry-run
```

**Parallelism window:** Phase 2 runs 6 stories simultaneously. With subagents, wall-clock compresses from ~7 days serial to ~2–3 days parallel.

---

## Dependency graph

```
S01 Rebrand ──► S02 Contracts ──┬──► S03 Share BE ────────┐
                                │                          │
                                ├──► S04 Friend Picker ────┼──► G1: Web PWA ship
                                │                          │
                                ├──► S05 Push BE           ├──► G2: APNs dry-run
                                │                          │
                                ├──► S06 Deep Link Val ────┤
                                │                          │
                                ├──► S07 Universal Link    │
                                │                          │
                                └──► S08 Capacitor Boot ─┬─┘
                                                         │
                                                         ├──► S09 iOS Auth ────┐
                                                         │                     │
                                                         ├──► S10 Share Ext ───┼──► G3/G4/G5
                                                         │                     │
                                                         └──► S11 Push Client ─┘
                                                                                │
                                                                                └──► S12 Submission
```

**Hard blockers** (must finish before dependents can start): S01 → S02 → {all Phase 2}. S08 → {S09, S10, S11}.

**Soft dependencies** (can develop against mocks, integrate later): S04 can build against a mocked Share API before S03 is done.

---

## Integration gates

Gates are the hand-offs between phases. Each gate is a hard checkpoint — all listed stories must have merged and tests green before the gate is considered open.

| Gate | What opens | What must be green | Verifier |
|---|---|---|---|
| **G0** | Begin Phase 1 (Rebrand) | Apple Developer account approved, privacy policy draft at `/privacy` | curl the privacy URL, check Apple Developer portal |
| **G1** | Web PWA ships share-to-friends | S01, S02, S03, S04 complete; tunnel preview passes | Manual: tunnel URL → share a recipe with a test friend → friend sees it in `📤 recently shared` |
| **G2** | APNs backend verified standalone | S01, S02, S05 complete | Unit: `sendPush` mock tests pass. Smoke: `wrangler dev` with the APNs sandbox + a real device token → token registered, pushes deliver |
| **G3** | iOS auth verified on device | S01–S08, S09 complete | Manual: Google + Apple sign-in round-trip on physical iPhone; token stored in Keychain persists through app restart |
| **G4** | iOS share extension verified | S01–S08, S10, S06, S07 complete | Manual: share from TikTok → ReciFriend icon appears → tap → app opens Add Recipe with URL pre-filled |
| **G5** | iOS push verified | S05, S11 complete | Manual: three pushes (friend req, recipe saved, recipe shared) each deliver on real device; tap routes correctly |
| **G6** | Ready to submit | G3–G5 all open, security acceptance checklist complete (see Spec §9) | Checklist walkthrough with each item verified |

**If a gate fails**, work rolls back to the story(ies) with red signal; no downstream work starts.

---

## Shared contracts — the interfaces that parallel work depends on

These live in a single source of truth (`apps/shared/contracts.ts`) produced by Story 02. Every parallel story consumes this file; changing a contract mid-sprint requires a broadcast.

### C1 — Share API contract

```typescript
// POST /recipes/:id/share  (request)
export type ShareRecipeRequest = {
  recipient_user_ids: string[];  // 1–50, no duplicates, no self
};
// 200 OK
export type ShareRecipeResponse = {
  shared_with: number;  // rows inserted
  skipped: number;      // invalid recipients (non-friends etc.)
};
// 4xx body
export type ShareRecipeError =
  | { code: 'NOT_FRIENDS'; non_friend_user_ids: string[] }
  | { code: 'RATE_LIMITED'; retry_after_seconds: number }
  | { code: 'FORBIDDEN' };  // sharer can't view recipe
```

### C2 — Device registration contract

```typescript
// POST /devices/register (body)
export type RegisterDeviceRequest = { apns_token: string };  // 64 hex chars
export type RegisterDeviceResponse = { ok: true };

// DELETE /devices/register (body)
export type UnregisterDeviceRequest = { apns_token: string };
```

### C3 — Deep link schema

```typescript
export const ALLOWED_HOSTS = new Set(['recifriend.com', 'www.recifriend.com']);
export const CUSTOM_SCHEME = 'recifriend:';
export const UNIVERSAL_LINK_ORIGIN = 'https://recifriend.com';

export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string }     // url must be http(s)://
  | { kind: 'friend_requests' }
  | { kind: 'recipe_detail'; recipe_id: string };  // id regex: [a-zA-Z0-9_-]{1,64}

// Auth callback ONLY accepted via Universal Link (never custom scheme).
// Share extension ONLY emits custom scheme add-recipe links.
// All others accepted via either, preferring Universal Links in outbound use.
```

### C4 — APNs payload

```typescript
export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: 'default';
  };
  deep_link: string;  // must be a valid DeepLink per C3
};
```

### C5 — iOS identifiers (constants)

```typescript
export const IOS = {
  APP_NAME: 'ReciFriend',
  BUNDLE_ID: 'com.recifriend.app',
  SHARE_EXT_BUNDLE_ID: 'com.recifriend.app.share',
  URL_SCHEME: 'recifriend',
  ASSOCIATED_DOMAIN: 'applinks:recifriend.com',
} as const;
```

**Contract change policy:** any change to C1–C5 after Story 02 ships requires:
1. A PR that updates `apps/shared/contracts.ts`
2. An explicit note in the PR listing which consumer stories need to update
3. Re-running the affected stories' tests

---

## Story roster

| # | Name | Dep. on | Est | Worker | Frontend | iOS | Independent? |
|---|---|---|---|---|---|---|---|
| 01 | [Rebrand to ReciFriend](./2026-04-17-ios-app-story-01-rebrand.md) | – | 3d | ✓ | ✓ | – | Sequential blocker |
| 02 | [Shared contracts](./2026-04-17-ios-app-story-02-contracts.md) | 01 | 0.5d | ✓ | ✓ | – | Sequential blocker |
| 03 | [Share backend (Worker)](./2026-04-17-ios-app-story-03-share-backend.md) | 02 | 1.5d | ✓ | – | – | Parallel ✓ |
| 04 | [Friend picker UI (Web)](./2026-04-17-ios-app-story-04-friend-picker-ui.md) | 02 | 1.5d | – | ✓ | – | Parallel ✓ (mocks S03) |
| 05 | [Push backend (Worker + APNs)](./2026-04-17-ios-app-story-05-push-backend.md) | 02 | 2d | ✓ | – | – | Parallel ✓ |
| 06 | [Deep link validator (shared)](./2026-04-17-ios-app-story-06-deep-link-validator.md) | 02 | 0.5d | – | ✓ | – | Parallel ✓ |
| 07 | [Universal Link AASA file](./2026-04-17-ios-app-story-07-universal-link.md) | 02 | 0.5d | – | ✓ | – | Parallel ✓ |
| 08 | [Capacitor shell bootstrap](./2026-04-17-ios-app-story-08-capacitor-bootstrap.md) | 02 | 1.5d | – | – | ✓ | Parallel ✓ |
| 09 | [iOS auth (PKCE + Apple)](./2026-04-17-ios-app-story-09-ios-auth.md) | 02, 06, 07, 08 | 2d | – | ✓ | ✓ | After G2 |
| 10 | [iOS share extension](./2026-04-17-ios-app-story-10-share-extension.md) | 08 | 1.5d | – | – | ✓ | After G2 |
| 11 | [iOS push client](./2026-04-17-ios-app-story-11-push-client.md) | 05, 06, 08 | 1.5d | – | ✓ | ✓ | After G2 |
| 12 | [App Store submission](./2026-04-17-ios-app-story-12-submission.md) | All | 2d | – | – | ✓ | Final |

---

## Recommended execution model (subagent-driven)

**Phase 1 (serial):** One subagent executes Story 01 end-to-end. Orchestrator reviews after each task.

**Phase 2 (parallel swarm):**
- Serial: Story 02 (contracts) first — 30 min. Must merge before anything else branches.
- Parallel fan-out: dispatch 6 subagents simultaneously, one per story (03, 04, 05, 06, 07, 08). Each subagent reads only its own story file + the shared contracts file + anything its story's Files section references. No cross-talk.
- Each subagent commits to `main` when its story passes. No branches (per user preference).
- Orchestrator monitors for conflicts on `apps/recipe-ui/src/App.jsx` (several stories touch it) — coordinate edits via narrow, non-overlapping sections.
- Integration gate G1 + G2 verified by orchestrator after all 6 finish.

**Phase 3 (partial parallel):**
- Serial: Story 08 must have merged before 09/10/11 can run.
- Parallel fan-out: dispatch 3 subagents for 09, 10, 11 simultaneously. 10 is pure Swift (no overlap); 09/11 both touch App.jsx but in separate sections (auth handler vs push handler).

**Phase 4 (serial):** One subagent owns Story 12 (submission) end-to-end.

---

## Coordination: files with multiple editors

These files are touched by multiple parallel stories. Each story MUST edit only the labeled section, not the whole file.

| File | Story | Section (exact marker comment to use) |
|---|---|---|
| `apps/recipe-ui/src/App.jsx` | S04 | `// === [S04] Friend picker wiring ===` / `// === [/S04] ===` |
| `apps/recipe-ui/src/App.jsx` | S06 | `// === [S06] Deep link handler ===` / `// === [/S06] ===` |
| `apps/recipe-ui/src/App.jsx` | S09 | `// === [S09] Capacitor auth ===` / `// === [/S09] ===` |
| `apps/recipe-ui/src/App.jsx` | S11 | `// === [S11] Push client ===` / `// === [/S11] ===` |
| `apps/worker/src/index.ts` | S03 | `// === [S03] Recipe share endpoint ===` / `// === [/S03] ===` |
| `apps/worker/src/index.ts` | S05 | `// === [S05] Device registration + push triggers ===` / `// === [/S05] ===` |

Each story plan specifies the marker pair. If a subagent finds an existing marker section for its story, it replaces only that section. Merge conflicts in `App.jsx` or `index.ts` mean someone violated this rule — resolve by moving the conflicting story's edits into its own labeled section.

---

## Acceptance: definition of a verified application

Per the spec's Definition of Done (§6) plus the security checklist (§9):

**Functional:**
- [ ] PWA at `recifriend.com` works identically to old recifind site (zero regressions; existing Playwright tests green)
- [ ] Old `recifind.elisawidjaja.com/*` 301-redirects to `recifriend.com/*` preserving path + query
- [ ] iOS app installs from App Store as "ReciFriend"
- [ ] Share from TikTok / Instagram / Safari → ReciFriend icon in share sheet → tap → app opens Add Recipe with URL prefilled → auto-enrich runs → Save
- [ ] Friend picker in recipe detail (web + iOS) → selected friends receive push + see it in recently-shared feed
- [ ] Three pushes deliver reliably on a real device: friend request, recipe saved, recipe shared
- [ ] Emails send from `@recifriend.com` with working SPF/DKIM/DMARC

**Security:**
- [ ] All deep-link paths handled via the allowlist validator (S06)
- [ ] Supabase client uses `flowType: 'pkce'`
- [ ] Universal Link file served at `/.well-known/apple-app-site-association` with correct `Content-Type` and no redirects
- [ ] `Associated Domains` entitlement added to iOS app
- [ ] `.p8` not in git; only in Cloudflare Worker secrets and offline backup
- [ ] All Supabase tables touched by the client have RLS enabled with a reviewed policy
- [ ] `PrivacyInfo.xcprivacy` matches privacy policy at recifriend.com
- [ ] Security smoke test (malicious deep links from Safari) all rejected

**Ready-to-submit** means every box above is checked AND `git status` is clean AND all Worker + Frontend tests pass.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Resend DNS propagation delays M0.5 | Medium | Start SPF/DKIM setup day 0 (parallel with Apple signup) |
| Apple ID verification holds up Dev signup | Low | Start signup day 0; simulator work continues without it |
| `.p8` key accidentally committed | Medium | Add `*.p8` to `.gitignore` in Story 01; pre-commit hook scan |
| Story 02 contract change mid-sprint | Medium | Explicit broadcast protocol (see §Shared contracts) |
| Two parallel stories conflict in `App.jsx` | Medium | Marker-comment sections (see §Coordination) |
| App Store rejects on "minimum functionality" (4.2) | Low | Lead App Store description with share-from-social feature |
| Apple rejects without Sign in with Apple (4.8) | Low | Enforced in Story 09 acceptance criteria |

---

## Out of scope

Matches the spec's non-goals. Explicitly listed here so a subagent doesn't add them:

- Native camera / photo picker
- iOS widgets, Siri shortcuts, Live Activities
- Badge counts, rich notifications, notification history
- Live / OTA JS updates (Capawesome, Ionic Appflow)
- Android app
- Swift/SwiftUI full rewrite
- Shared-keychain share extension
