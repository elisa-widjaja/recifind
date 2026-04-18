# Story 02 — Shared Contracts

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Create a single source of truth for the types, constants, and payload formats that parallel stories 03–11 will consume. This story is small but foundational — merging it unblocks the Phase 2 parallel swarm.

**Depends on:** Story 01 (rebrand complete, so `recifriend.com` strings are valid)
**Blocks:** Stories 03, 04, 05, 06, 07, 08 (all Phase 2)
**Can develop in parallel with:** nothing (it's the blocker)

**Contracts consumed:** none
**Contracts produced:** C1 Share API, C2 Device registration, C3 Deep link schema, C4 APNs payload, C5 iOS identifiers (see workstream doc)

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/shared/contracts.ts` | Single TS file exporting all shared types/constants |
| Create | `apps/shared/contracts.test.ts` | Tiny runtime assertions on the constants |
| Modify | `apps/worker/tsconfig.json` | Add `../shared/**/*.ts` to include path |
| Modify | `apps/recipe-ui/vite.config.js` | Confirm Vite resolves `../shared/*.ts` (no change usually needed) |

---

## Task 1: Create shared directory + contracts file

- [ ] **Step 1:** Create directory

```bash
mkdir -p apps/shared
```

- [ ] **Step 2:** Create `apps/shared/contracts.ts` with the full contract set:

```typescript
// apps/shared/contracts.ts
// SINGLE SOURCE OF TRUTH — imported by apps/worker and apps/recipe-ui.
// Change policy: any edit here is a breaking change; announce in PR and
// re-run consumer story tests.

// ─── C1: Share API ─────────────────────────────────────────────────

export type ShareRecipeRequest = {
  recipient_user_ids: string[];
};

export type ShareRecipeResponse = {
  shared_with: number;
  skipped: number;
};

export type ShareRecipeError =
  | { code: 'NOT_FRIENDS'; non_friend_user_ids: string[] }
  | { code: 'RATE_LIMITED'; retry_after_seconds: number }
  | { code: 'FORBIDDEN' };

export const SHARE_RECIPE_MAX_RECIPIENTS = 50;
export const SHARE_RECIPE_MIN_RECIPIENTS = 1;
export const SHARE_RECIPE_RATE_LIMIT_PER_HOUR = 20;

// ─── C2: Device registration ───────────────────────────────────────

export type RegisterDeviceRequest = {
  apns_token: string;  // hex string, 64 chars
};

export type RegisterDeviceResponse = { ok: true };

export type UnregisterDeviceRequest = {
  apns_token: string;
};

export const APNS_TOKEN_REGEX = /^[a-fA-F0-9]{64}$/;
export const DEVICES_REGISTER_RATE_LIMIT_PER_HOUR = 20;

// ─── C3: Deep link schema ──────────────────────────────────────────

export const ALLOWED_HOSTS = new Set<string>(['recifriend.com', 'www.recifriend.com']);
export const CUSTOM_SCHEME_PROTOCOL = 'recifriend:';
export const UNIVERSAL_LINK_ORIGIN = 'https://recifriend.com';

export const ALLOWED_DEEP_LINK_PATHS = new Set<string>([
  '/auth/callback',
  '/add-recipe',
  '/friend-requests',
]);

export const RECIPE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string }
  | { kind: 'friend_requests' }
  | { kind: 'recipe_detail'; recipe_id: string };

// ─── C4: APNs payload ──────────────────────────────────────────────

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: 'default';
  };
  deep_link: string;  // must be http(s)://recifriend.com/... or recifriend://
};

// ─── C5: iOS identifiers ───────────────────────────────────────────

export const IOS = {
  APP_NAME: 'ReciFriend',
  BUNDLE_ID: 'com.recifriend.app',
  SHARE_EXT_BUNDLE_ID: 'com.recifriend.app.share',
  URL_SCHEME: 'recifriend',
  ASSOCIATED_DOMAIN: 'applinks:recifriend.com',
} as const;

export type IOSIdentifiers = typeof IOS;
```

- [ ] **Step 3:** Verify TypeScript compiles

```bash
cd apps/shared && npx tsc --noEmit contracts.ts
```

Expected: no output (success).

## Task 2: Runtime sanity tests

Constants get typos. A tiny test prevents them from breaking downstream.

- [ ] **Step 1:** Create `apps/shared/contracts.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HOSTS,
  APNS_TOKEN_REGEX,
  CUSTOM_SCHEME_PROTOCOL,
  IOS,
  RECIPE_ID_REGEX,
  UNIVERSAL_LINK_ORIGIN,
} from './contracts';

describe('Shared contracts', () => {
  it('iOS identifiers are consistent', () => {
    expect(IOS.SHARE_EXT_BUNDLE_ID.startsWith(IOS.BUNDLE_ID + '.')).toBe(true);
    expect(UNIVERSAL_LINK_ORIGIN).toBe('https://recifriend.com');
    expect(CUSTOM_SCHEME_PROTOCOL).toBe(`${IOS.URL_SCHEME}:`);
    expect(IOS.ASSOCIATED_DOMAIN).toBe(`applinks:recifriend.com`);
  });

  it('ALLOWED_HOSTS matches Universal Link origin', () => {
    expect(ALLOWED_HOSTS.has(new URL(UNIVERSAL_LINK_ORIGIN).host)).toBe(true);
  });

  it('APNS_TOKEN_REGEX accepts valid tokens', () => {
    expect(APNS_TOKEN_REGEX.test('a'.repeat(64))).toBe(true);
    expect(APNS_TOKEN_REGEX.test('a'.repeat(63))).toBe(false);
    expect(APNS_TOKEN_REGEX.test('g'.repeat(64))).toBe(false);  // non-hex
  });

  it('RECIPE_ID_REGEX accepts realistic ids and rejects path traversal', () => {
    expect(RECIPE_ID_REGEX.test('abc123')).toBe(true);
    expect(RECIPE_ID_REGEX.test('seed-trend-01')).toBe(true);
    expect(RECIPE_ID_REGEX.test('../../../etc/passwd')).toBe(false);
    expect(RECIPE_ID_REGEX.test('')).toBe(false);
  });
});
```

- [ ] **Step 2:** Wire tests — `apps/worker` already uses vitest. Add to its test config:

```bash
cd apps/worker
# Update vite.config.ts or vitest.config.ts include pattern:
# include: ['src/**/*.test.ts', '../shared/**/*.test.ts']
```

Use Edit tool to add `../shared/**/*.test.ts` to the test config's `include` array.

- [ ] **Step 3:** Run tests

```bash
cd apps/worker && npm test -- contracts
```

Expected: 4 tests pass.

- [ ] **Step 4:** Commit

```bash
git add apps/shared/ apps/worker/
git commit -m "feat(shared): add contracts.ts — single source of truth for iOS workstream"
```

## Task 3: TS path resolution from worker and frontend

- [ ] **Step 1:** Worker — `apps/worker/tsconfig.json` — ensure `include` covers `../shared/`:

```json
{
  "compilerOptions": { /* existing */ },
  "include": ["src/**/*", "../shared/**/*"]
}
```

- [ ] **Step 2:** Verify worker can import

```typescript
// apps/worker/src/index.ts (temporary test import — remove after verification)
import { IOS } from '../../shared/contracts';
console.log(IOS.APP_NAME);  // smoke test only; delete this line
```

Run `cd apps/worker && npx wrangler dev --dry-run` — should succeed. Then remove the test import.

- [ ] **Step 3:** Frontend — Vite handles `.ts` imports natively from JSX files. Quick smoke:

```jsx
// apps/recipe-ui/src/App.jsx — near the top (temporary)
import { IOS } from '../../shared/contracts';
console.log('rebrand check:', IOS.APP_NAME);
```

Run `cd apps/recipe-ui && npm run dev` — browser console should print `rebrand check: ReciFriend`. Remove the test import.

- [ ] **Step 4:** Commit

```bash
git add apps/worker/tsconfig.json
git commit -m "chore: include apps/shared in worker tsconfig"
```

## Acceptance criteria

- [ ] `apps/shared/contracts.ts` exists and exports C1–C5 as specified
- [ ] `apps/worker` and `apps/recipe-ui` can both import from `apps/shared/contracts.ts`
- [ ] `npm test` in worker passes contracts tests (4 tests)
- [ ] No file outside `apps/shared/` duplicates any of these constants — enforce by grepping later stories

## Commit checklist

- `feat(shared): add contracts.ts ...`
- `chore: include apps/shared in worker tsconfig`
