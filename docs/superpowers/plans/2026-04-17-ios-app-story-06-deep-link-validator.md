# Story 06 — Deep Link Validator (Shared)

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** A single, tested function that takes any URL string and returns either a typed `DeepLink` value or `null`. Every deep-link entry point (custom scheme from share extension, Universal Link from push tap, auth callback, manual paste into Safari) runs through this function. It's the only place deep-link security rules live.

**Depends on:** Story 02 (contracts — needs `ALLOWED_HOSTS`, `CUSTOM_SCHEME_PROTOCOL`, `RECIPE_ID_REGEX`, `DeepLink` type)
**Blocks:** Stories 09 (iOS auth), 10 (share extension), 11 (push client)
**Can develop in parallel with:** Stories 03, 04, 05, 07, 08

**Contracts consumed:** C3 Deep link schema
**Contracts produced:** `parseDeepLink(urlString)` function signature, consumed by S09, S10, S11

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Create | `apps/shared/deepLink.ts` | `parseDeepLink` function (shared between web + worker — but primarily used in web/iOS client) |
| Create | `apps/shared/deepLink.test.ts` | Adversarial unit tests |

---

## Task 1: Security-first test suite (TDD)

Every case here encodes a threat we need to defeat.

- [ ] **Step 1:** Create `apps/shared/deepLink.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './deepLink';

describe('parseDeepLink — reject anything outside our scheme + host', () => {
  it('rejects javascript: URL', () => {
    expect(parseDeepLink('javascript:alert(1)')).toBeNull();
  });
  it('rejects data: URL', () => {
    expect(parseDeepLink('data:text/html,<script>alert(1)</script>')).toBeNull();
  });
  it('rejects file: URL', () => {
    expect(parseDeepLink('file:///etc/passwd')).toBeNull();
  });
  it('rejects http:// (not our origin)', () => {
    expect(parseDeepLink('http://evil.com/add-recipe?url=x')).toBeNull();
  });
  it('rejects https:// on wrong host', () => {
    expect(parseDeepLink('https://evil.com/add-recipe?url=https://foo')).toBeNull();
  });
  it('rejects unknown custom scheme', () => {
    expect(parseDeepLink('otherapp://recipes/123')).toBeNull();
  });
  it('rejects completely malformed URL', () => {
    expect(parseDeepLink('not-a-url')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
  });
});

describe('parseDeepLink — /recipes/:id', () => {
  it('accepts valid recipe id via Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('accepts valid recipe id via www subdomain', () => {
    expect(parseDeepLink('https://www.recifriend.com/recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('accepts valid recipe id via custom scheme (non-sensitive)', () => {
    expect(parseDeepLink('recifriend://recipes/abc123')).toEqual({
      kind: 'recipe_detail', recipe_id: 'abc123',
    });
  });
  it('rejects path traversal in recipe id', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/../../etc/passwd')).toBeNull();
  });
  it('rejects overly long recipe id', () => {
    const long = 'a'.repeat(65);
    expect(parseDeepLink(`https://recifriend.com/recipes/${long}`)).toBeNull();
  });
  it('rejects recipe id with special chars', () => {
    expect(parseDeepLink('https://recifriend.com/recipes/abc!def')).toBeNull();
    expect(parseDeepLink('https://recifriend.com/recipes/abc%20def')).toBeNull();
  });
});

describe('parseDeepLink — /auth/callback', () => {
  it('accepts via Universal Link with code', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback?code=abc123')).toEqual({
      kind: 'auth_callback', code: 'abc123',
    });
  });
  it('REJECTS auth callback via custom scheme (security: S1)', () => {
    expect(parseDeepLink('recifriend://auth/callback?code=abc123')).toBeNull();
  });
  it('rejects if code missing', () => {
    expect(parseDeepLink('https://recifriend.com/auth/callback')).toBeNull();
  });
});

describe('parseDeepLink — /add-recipe', () => {
  it('accepts http URL in url param', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=https%3A%2F%2Ftiktok.com%2Fabc')).toEqual({
      kind: 'add_recipe', url: 'https://tiktok.com/abc',
    });
  });
  it('rejects non-http url param', () => {
    expect(parseDeepLink('recifriend://add-recipe?url=javascript%3Aalert(1)')).toBeNull();
    expect(parseDeepLink('recifriend://add-recipe?url=file%3A%2F%2Fetc%2Fpasswd')).toBeNull();
  });
  it('rejects missing url param', () => {
    expect(parseDeepLink('recifriend://add-recipe')).toBeNull();
    expect(parseDeepLink('recifriend://add-recipe?url=')).toBeNull();
  });
});

describe('parseDeepLink — /friend-requests', () => {
  it('accepts via Universal Link', () => {
    expect(parseDeepLink('https://recifriend.com/friend-requests')).toEqual({ kind: 'friend_requests' });
  });
  it('accepts via custom scheme', () => {
    expect(parseDeepLink('recifriend://friend-requests')).toEqual({ kind: 'friend_requests' });
  });
});

describe('parseDeepLink — unknown paths', () => {
  it('rejects /admin', () => {
    expect(parseDeepLink('https://recifriend.com/admin')).toBeNull();
  });
  it('rejects /../etc/passwd', () => {
    expect(parseDeepLink('https://recifriend.com/../etc/passwd')).toBeNull();
  });
});
```

- [ ] **Step 2:** Run — all fail

```bash
cd apps/worker && npm test -- deepLink
```

- [ ] **Step 3:** Commit the failing tests

```bash
git add apps/shared/deepLink.test.ts
git commit -m "test(deep-link): adversarial validator tests"
```

## Task 2: Implement the validator

- [ ] **Step 1:** Create `apps/shared/deepLink.ts`

```typescript
import {
  ALLOWED_HOSTS,
  CUSTOM_SCHEME_PROTOCOL,
  RECIPE_ID_REGEX,
  type DeepLink,
} from './contracts';

export function parseDeepLink(raw: string): DeepLink | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }

  const isUniversalLink = url.protocol === 'https:' && ALLOWED_HOSTS.has(url.host);
  const isCustomScheme  = url.protocol === CUSTOM_SCHEME_PROTOCOL;
  if (!isUniversalLink && !isCustomScheme) return null;

  // For custom scheme URLs, the URL API parses the segment after '://' as the host,
  // so path starts at the first '/' after the host. Normalize to handle both shapes.
  const path = url.pathname === '' || url.pathname === '/'
    ? '/' + (url.host || '')     // recifriend://recipes/123 → url.host='recipes', url.pathname='/123'
    : url.pathname;

  // Actually — URL parsing of custom schemes is quirky across JS engines.
  // Normalize: strip the scheme + "//" + optional host, take everything after.
  const fullPath = normalizeCustomScheme(raw) ?? path;

  // /recipes/:id
  const recipeMatch = fullPath.match(/^\/recipes\/([^/?#]+)\/?$/);
  if (recipeMatch) {
    const id = decodeURIComponent(recipeMatch[1]);
    if (!RECIPE_ID_REGEX.test(id)) return null;
    return { kind: 'recipe_detail', recipe_id: id };
  }

  // /auth/callback (Universal Link ONLY — security S1)
  if (fullPath.startsWith('/auth/callback')) {
    if (!isUniversalLink) return null;
    const code = url.searchParams.get('code');
    if (!code) return null;
    return { kind: 'auth_callback', code };
  }

  // /add-recipe?url=<http(s)://...>
  if (fullPath.startsWith('/add-recipe')) {
    const shared = url.searchParams.get('url');
    if (!shared || !/^https?:\/\//.test(shared)) return null;
    return { kind: 'add_recipe', url: shared };
  }

  // /friend-requests
  if (fullPath === '/friend-requests' || fullPath === '/friend-requests/') {
    return { kind: 'friend_requests' };
  }

  return null;
}

// Custom schemes like `recifriend://recipes/123` are parsed inconsistently across
// browsers — some treat "recipes" as the host, some as the path. Normalize by
// stripping the scheme prefix and treating the remainder as the path.
function normalizeCustomScheme(raw: string): string | null {
  const m = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
  if (!m) return null;
  const tail = m[1];
  // Drop query + hash for path-only matching. Keep full URL for param reads
  // (caller uses `url.searchParams` which handles queries correctly).
  const path = '/' + tail.split('?')[0].split('#')[0].replace(/^\/+/, '');
  return path;
}
```

- [ ] **Step 2:** Run tests

```bash
cd apps/worker && npm test -- deepLink
```

Expected: all pass. If any fail, fix the validator — **do not relax the test**.

- [ ] **Step 3:** Commit

```bash
git add apps/shared/deepLink.ts
git commit -m "feat(deep-link): allowlist-based URL validator"
```

## Task 3: Mark it as the only valid entry point

- [ ] **Step 1:** Grep for any other URL-parsing deep-link code and leave a note pointing to the new validator:

```bash
grep -rn "Capacitor.*appUrlOpen\|recifriend://" apps/recipe-ui/src/
```

Nothing yet (this is a new feature). Once S09/S10/S11 merge, every place that handles deep links must import `parseDeepLink` — this is enforced by the marker-section review in those stories.

## Acceptance criteria

- [ ] All ~25 tests pass
- [ ] `parseDeepLink` is the only place in the codebase that decides whether a URL is a valid deep link (enforced via review of S09/S10/S11)
- [ ] Every downstream story imports from `apps/shared/deepLink.ts` — none inline their own URL parsing

## Commit checklist

- `test(deep-link): adversarial validator tests`
- `feat(deep-link): allowlist-based URL validator`
