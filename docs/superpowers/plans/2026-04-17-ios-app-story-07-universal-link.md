# Story 07 — Universal Link AASA File

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Serve `apple-app-site-association` (AASA) correctly at `https://recifriend.com/.well-known/apple-app-site-association` so iOS honors Universal Links for this domain. Without this file, Universal Links fall back to opening Safari instead of the app.

**Depends on:** Story 01 (rebrand — domain exists), Story 02 (contracts — bundle ID)
**Blocks:** Story 09 (auth — Universal Link auth callback depends on AASA)
**Can develop in parallel with:** Stories 03, 04, 05, 06, 08

**Contracts consumed:** C5 iOS identifiers (BUNDLE_ID, ASSOCIATED_DOMAIN)
**Contracts produced:** A live `/.well-known/apple-app-site-association` endpoint

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/recipe-ui/public/.well-known/apple-app-site-association` | Static JSON (no extension — Apple requires this exact filename) |
| Create | `apps/recipe-ui/functions/.well-known/apple-app-site-association.js` | Cloudflare Pages Function to serve with correct `Content-Type` |
| Create | `apps/e2e/tests/universal-link-aasa.spec.ts` | E2E test that verifies serving |

**Note on serving:** Cloudflare Pages serves files from `public/` but defaults `Content-Type` based on extension. The AASA file has no extension → Pages treats it as `application/octet-stream`. Apple **requires** `application/json`. The Pages Function forces the correct header.

---

## Task 1: AASA file content

The value of `appID` is `<TEAM_ID>.<BUNDLE_ID>`. Team ID is 10 chars from Apple Developer portal.

- [ ] **Step 1:** Get your Apple Team ID from Apple Developer → Membership page.

- [ ] **Step 2:** Create `apps/recipe-ui/public/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM123456.com.recifriend.app",
        "paths": [
          "/auth/callback",
          "/recipes/*",
          "/friend-requests",
          "/add-recipe"
        ]
      }
    ]
  }
}
```

**IMPORTANT**: Replace `TEAM123456` with your actual Team ID. Do NOT commit a placeholder — this file must be production-accurate.

- [ ] **Step 3:** Verify it's valid JSON

```bash
cat apps/recipe-ui/public/.well-known/apple-app-site-association | jq .
```

## Task 2: Pages Function to set Content-Type

- [ ] **Step 1:** Create `apps/recipe-ui/functions/.well-known/apple-app-site-association.js`

```js
// Cloudflare Pages Function — sets Content-Type so Apple honors the AASA file.
// Apple spec requires: application/json, no redirects, no auth, publicly reachable.
export async function onRequest(context) {
  const file = await context.env.ASSETS.fetch(
    new Request(new URL('/.well-known/apple-app-site-association', context.request.url))
  );
  const body = await file.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

- [ ] **Step 2:** Build + deploy

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

## Task 3: E2E verification

- [ ] **Step 1:** Create `apps/e2e/tests/universal-link-aasa.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('apple-app-site-association is served correctly', async ({ request }) => {
  const res = await request.get('https://recifriend.com/.well-known/apple-app-site-association', {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);

  // Apple requires application/json
  const contentType = res.headers()['content-type'];
  expect(contentType).toMatch(/^application\/json/);

  // Must parse as JSON
  const body = await res.json();
  expect(body.applinks).toBeDefined();

  const details = body.applinks.details;
  expect(Array.isArray(details) && details.length === 1).toBe(true);

  // appID must be <TEAM>.<BUNDLE>
  expect(details[0].appID).toMatch(/^[A-Z0-9]{10}\.com\.recifriend\.app$/);

  // Paths must include auth callback + recipes + friend-requests
  expect(details[0].paths).toEqual(
    expect.arrayContaining(['/auth/callback', '/recipes/*', '/friend-requests'])
  );
});

test('apple-app-site-association does not redirect', async ({ request }) => {
  const res = await request.get('https://recifriend.com/.well-known/apple-app-site-association', {
    maxRedirects: 0,
  });
  expect([200]).toContain(res.status());  // never 301/302
});

test('AASA is also served from www subdomain (if used)', async ({ request }) => {
  const res = await request.get('https://www.recifriend.com/.well-known/apple-app-site-association');
  // Either directly serves or 301-redirects to recifriend.com — Apple follows one redirect since iOS 14
  expect([200, 301]).toContain(res.status());
});
```

- [ ] **Step 2:** Run against prod

```bash
cd apps/e2e && npx playwright test universal-link-aasa
```

Expected: all pass.

- [ ] **Step 3:** Test with Apple's public validator (one-time manual check):
  - Open https://branch.io/resources/aasa-validator/
  - Enter `recifriend.com`
  - Expected: green check on all rules

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/public/.well-known/ apps/recipe-ui/functions/.well-known/ apps/e2e/tests/universal-link-aasa.spec.ts
git commit -m "feat(aasa): serve apple-app-site-association for Universal Links"
```

## Task 4: Note for Story 09

The `appID` prefix in AASA must match the app's Team ID in Xcode. Story 09 will add the `applinks:recifriend.com` entitlement in Xcode — the AASA file already promises back. Circular dependency resolves naturally because Story 09 can't test Universal Link delivery until both sides are live. This task just ensures AASA is ready before Story 09 needs it.

## Acceptance criteria

- [ ] AASA file exists at `https://recifriend.com/.well-known/apple-app-site-association` with `Content-Type: application/json`
- [ ] JSON body includes `appID: <TEAM>.com.recifriend.app` and paths `/auth/callback`, `/recipes/*`, `/friend-requests`
- [ ] No redirects on the canonical URL
- [ ] Branch.io AASA validator shows green
- [ ] 3 Playwright tests pass

## Commit checklist

- `feat(aasa): serve apple-app-site-association for Universal Links`
