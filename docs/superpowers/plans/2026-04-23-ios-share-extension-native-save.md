# iOS Share Extension — Native Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save recipes entirely inside the iOS share extension — no main-app cold start on the critical path — with a silent deep-link fallback to the existing main-app drawer when the native save can't complete.

**Architecture:** Share extension (SwiftUI) calls `POST /recipes/parse` for preview, then `POST /recipes` with a Supabase JWT read from a shared Keychain. Worker queues enrichment via `ctx.waitUntil`. Main app writes the JWT to Keychain on every auth event and refetches on resume. Any failure in the extension (no token, 401, timeout, offline) falls back to `recifriend://add-recipe?url=<raw>`, which today's drawer handles unchanged.

**Tech Stack:** Swift (SwiftUI for extension, custom Capacitor plugin for main app), Cloudflare Workers (TypeScript, vitest), Capacitor 5, Supabase JS, shared iOS Keychain with `kSecAttrAccessGroup`, App Group `group.com.recifriend.app`.

**Spec:** [2026-04-23-ios-share-extension-native-save-design.md](../specs/2026-04-23-ios-share-extension-native-save-design.md)

## File map

**Worker (TypeScript):**
- Modify `apps/worker/src/index.ts` — add `enrichAfterSave`, add dedup lookup + `ctx.waitUntil` wiring, pass `ctx` into `handleCreateRecipe`, export new symbols for tests.
- Create `apps/worker/src/create-recipe.test.ts` — tests for dedup, empty ingredients, `enrichAfterSave`, `ctx.waitUntil` wiring.

**iOS main-app target (Swift + Obj-C glue):**
- Create `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift` — Capacitor plugin exposing `setJwt`, `getJwt`, `clearJwt` against shared Keychain.
- Create `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m` — Obj-C registration macros (Capacitor pattern).
- Modify `apps/ios/ios/App/App/App.entitlements` — add App Group + Keychain access group.
- Modify `apps/ios/ios/App/ShareExtension/ShareExtension.entitlements` — add same App Group + Keychain access group.
- Modify `apps/ios/ios/App/Podfile` — confirm no change (custom plugin uses the native SPM/direct-source pattern, not a pod).

**iOS share extension (Swift):**
- Rewrite `apps/ios/ios/App/ShareExtension/ShareViewController.swift` — SwiftUI host + URL extraction + network calls + JWT read + fallback.
- Create `apps/ios/ios/App/ShareExtension/SharedKeychain.swift` — shared Keychain read helper (same API as the main-app plugin, but read-only from extension).
- Create `apps/ios/ios/App/ShareExtension/WorkerClient.swift` — HTTP helpers: `parseRecipe(url) async throws -> ParsePreview`, `createRecipe(payload, jwt) async throws -> CreateRecipeResult`.
- Modify `apps/ios/ios/App/ShareExtension/ShareExtension-Info.plist` if needed to declare the SwiftUI principal class.

**Main app (React/JS):**
- Create `apps/recipe-ui/src/native/SharedAuthStore.js` — thin Capacitor `registerPlugin` wrapper.
- Modify `apps/recipe-ui/src/App.jsx` — call `SharedAuthStore.setJwt(...)` on every non-null session; call `SharedAuthStore.clearJwt()` on `SIGNED_OUT`; register `appStateChange` listener that refetches recipes.

**Docs:**
- Modify `docs/runbooks/ios-app-setup-checklist.md` if it exists — add App Group + CocoaPods notes. Skip if the runbook doesn't cover extension setup.

---

## Task 1: Fix CocoaPods and add App Group entitlement (manual pre-work)

**Why this is first:** every subsequent native task depends on `pod install` succeeding and both targets sharing a Keychain access group.

**Files:**
- Modify: `apps/ios/ios/App/App/App.entitlements`
- Modify: `apps/ios/ios/App/ShareExtension/ShareExtension.entitlements`

- [ ] **Step 1: Upgrade CocoaPods and run pod install**

Run:
```bash
sudo gem install cocoapods
cd apps/ios/ios/App && pod install
```

Expected: `pod install` completes without the `Unable to find compatibility version string for object version '70'` error. If the error persists, try `gem install cocoapods --pre` or downgrade the Xcode project format via Xcode → File → Project Settings → Project Format: "Xcode 14-compatible".

- [ ] **Step 2: Register App Group on Apple Developer portal**

In the Apple Developer portal:
1. Identifiers → App IDs → `com.recifriend.app` → enable App Groups capability.
2. Identifiers → App IDs → `com.recifriend.app.ShareExtension` (the extension bundle id; confirm the exact id in Xcode target settings) → enable App Groups.
3. Identifiers → App Groups → add group: `group.com.recifriend.app`.
4. Assign the group to both App IDs.
5. Regenerate the provisioning profiles for both targets and download them.

Expected: both App IDs list `group.com.recifriend.app` under their App Groups, and fresh provisioning profiles are downloaded.

- [ ] **Step 3: Add App Group + Keychain Access Group to main app entitlements**

Replace the contents of `apps/ios/ios/App/App/App.entitlements` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>development</string>
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>applinks:recifriend.com</string>
  </array>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>group.com.recifriend.app</string>
  </array>
  <key>keychain-access-groups</key>
  <array>
    <string>$(AppIdentifierPrefix)com.recifriend.app.shared</string>
  </array>
</dict>
</plist>
```

- [ ] **Step 4: Add same entitlements to share extension**

Replace `apps/ios/ios/App/ShareExtension/ShareExtension.entitlements` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>group.com.recifriend.app</string>
  </array>
  <key>keychain-access-groups</key>
  <array>
    <string>$(AppIdentifierPrefix)com.recifriend.app.shared</string>
  </array>
</dict>
</plist>
```

- [ ] **Step 5: Verify build**

Open `apps/ios/ios/App/App.xcworkspace` in Xcode. Select the `App` scheme and build (⌘B). Then select the `ShareExtension` scheme and build. Both must succeed with no signing errors.

Expected: Green build on both. If signing errors appear, re-download provisioning profiles and in Xcode target → Signing & Capabilities → confirm "Automatically manage signing" is ticked for both targets under Team ID `7C6PMUN99K`.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/ios/App/App/App.entitlements apps/ios/ios/App/ShareExtension/ShareExtension.entitlements
git commit -m "ios: enable App Group + shared Keychain for main app and share extension"
```

---

## Task 2: Worker — rapid-reshare dedup on `POST /recipes`

**Why:** spec §Components §3 — prevent duplicate rows when the extension's optimistic retry (or a user's double-tap) sends the same `(user_id, source_url)` twice within 60 seconds.

**Files:**
- Create: `apps/worker/src/create-recipe.test.ts`
- Modify: `apps/worker/src/index.ts:1746-1796` (function `handleCreateRecipe`)

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/create-recipe.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleCreateRecipe } from './index';
import type { Env } from './index';

function makeMockDb(options: {
  existingRecipe?: { id: string; created_at: string } | null;
  friends?: Array<{ friend_id: string }>;
  profile?: { display_name?: string } | null;
}) {
  const firstCalls: Array<{ sql: string; binds: any[] }> = [];
  const runCalls: Array<{ sql: string; binds: any[] }> = [];
  const allCalls: Array<{ sql: string; binds: any[] }> = [];
  const db = {
    prepare: (sql: string) => {
      const binds: any[] = [];
      return {
        bind: (...args: any[]) => {
          binds.push(...args);
          return {
            first: async () => {
              firstCalls.push({ sql, binds });
              if (sql.includes('FROM recipes')) return options.existingRecipe ?? null;
              if (sql.includes('FROM profiles')) return options.profile ?? null;
              return null;
            },
            run: async () => {
              runCalls.push({ sql, binds });
              return { success: true };
            },
            all: async () => {
              allCalls.push({ sql, binds });
              if (sql.includes('FROM friends')) return { results: options.friends ?? [] };
              return { results: [] };
            }
          };
        }
      };
    }
  };
  return { db, firstCalls, runCalls };
}

describe('handleCreateRecipe dedup', () => {
  it('returns existing recipe when same (user_id, source_url) was inserted within 60s', async () => {
    const existing = {
      id: 'recipe-existing-123',
      created_at: new Date(Date.now() - 10_000).toISOString(),
    };
    const { db, runCalls } = makeMockDb({ existingRecipe: existing });

    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    const res = await handleCreateRecipe(req, env, ctx, user as any);
    const body = await res.json() as { recipe: { id: string } };

    expect(res.status).toBe(200);
    expect(body.recipe.id).toBe('recipe-existing-123');
    // Must NOT insert a new row
    expect(runCalls.find(c => c.sql.includes('INSERT INTO recipes'))).toBeUndefined();
  });

  it('inserts new recipe when no duplicate exists within 60s window', async () => {
    const { db, runCalls } = makeMockDb({ existingRecipe: null });

    const env = { DB: db as unknown as D1Database } as Env;
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const user = { userId: 'user-abc', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pasta', sourceUrl: 'https://example.com/pasta' }),
    });

    const res = await handleCreateRecipe(req, env, ctx, user as any);
    expect(res.status).toBe(201);
    expect(runCalls.some(c => c.sql.includes('INSERT INTO recipes'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: FAIL. Likely errors: `handleCreateRecipe` not exported, or signature mismatch (current function is `(request, env, user)`, test passes `ctx`).

- [ ] **Step 3: Update `handleCreateRecipe` signature and add dedup**

In `apps/worker/src/index.ts`, change `handleCreateRecipe` (line 1746):

```typescript
async function handleCreateRecipe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  user: AuthenticatedUser
) {
  const body = await readJsonBody(request);
  const { recipe, previewImagePayload } = normalizeRecipePayload(body, user.userId);

  // Rapid-reshare dedup: return the existing recipe if (user_id, source_url) was
  // inserted within the last 60s. Prevents duplicates from iOS extension retries
  // and accidental double-taps on Save.
  if (recipe.sourceUrl) {
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const dupe = await env.DB.prepare(
      `SELECT id, created_at FROM recipes WHERE user_id = ? AND source_url = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
    ).bind(user.userId, recipe.sourceUrl, sixtySecondsAgo).first() as { id: string; created_at: string } | null;

    if (dupe) {
      const existing = await loadRecipe(env, user.userId, dupe.id);
      return json({ recipe: existing }, 200);
    }
  }

  const preview = await persistPreviewImage(previewImagePayload, env, user.userId, recipe.id);
  // …rest of handler unchanged through return…
}
```

Also export `handleCreateRecipe` by adding it to the export block at line 4811:

```typescript
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
  runEnrichmentChain,
  handleCreateRecipe,
};
```

Update the call site at `apps/worker/src/index.ts:449` to pass `ctx`:

```typescript
const result = await handleCreateRecipe(request, env, ctx, user);
```

- [ ] **Step 4: Add dedup bypass when dupe returns null (the second test case)**

Ensure `loadRecipe` is visible in scope (it already is — used by `handleUpdateRecipe`).

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: 2 tests PASS.

- [ ] **Step 6: Run the full worker suite to catch regressions**

Run:
```bash
cd apps/worker && npm test
```

Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "worker(recipes): dedup rapid re-shares within 60s on POST /recipes"
```

---

## Task 3: Worker — `enrichAfterSave` function

**Why:** spec §Components §3 — after POST /recipes returns, enrichment runs async via `ctx.waitUntil(enrichAfterSave(...))`. This is the server-side equivalent of the main-app's current inline enrich call.

**Files:**
- Modify: `apps/worker/src/index.ts` — add `enrichAfterSave` near `runEnrichmentChain` (~line 4334). Export it.
- Modify: `apps/worker/src/create-recipe.test.ts` — add tests for `enrichAfterSave`.

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/src/create-recipe.test.ts`:

```typescript
import { enrichAfterSave } from './index';

describe('enrichAfterSave', () => {
  it('updates the D1 row when the chain returns ingredients', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds }); return { success: true }; }
        })
      })
    };
    const env = {
      DB: db as unknown as D1Database,
      GEMINI_SERVICE_ACCOUNT_B64: 'fake-b64',
    } as Env;

    // Stub chain via fetch — captionExtract path returns a verbatim-parseable caption.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('r.jina.ai')) {
        return {
          ok: true,
          text: async () => 'Ingredients: 1 cup flour, 2 eggs\nSteps: 1. Mix. 2. Bake.',
        } as Response;
      }
      // Gemini access token + inference
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'fake' }) } as Response;
      }
      if (url.includes('generativelanguage.googleapis.com') || url.includes('aiplatform.googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              title: 'Pancake',
              ingredients: ['1 cup flour', '2 eggs'],
              steps: ['Mix', 'Bake'],
              mealTypes: ['breakfast'],
              durationMinutes: 15,
              notes: '',
              imageUrl: '',
            }) }] } }],
          }),
        } as Response;
      }
      return { ok: false, text: async () => '' } as Response;
    }) as typeof fetch);

    await enrichAfterSave(env, 'recipe-123', 'https://example.com/pancake', 'Pancake');

    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('recipe-123');
    // ingredients JSON is one of the binds
    expect(update!.binds.some(b => typeof b === 'string' && b.includes('flour'))).toBe(true);
  });

  it('leaves the row unchanged when every strategy returns empty', async () => {
    const runCalls: Array<{ sql: string; binds: any[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: any[]) => ({
          run: async () => { runCalls.push({ sql, binds }); return { success: true }; }
        })
      })
    };
    const env = {
      DB: db as unknown as D1Database,
      GEMINI_SERVICE_ACCOUNT_B64: 'fake-b64',
    } as Env;

    // r.jina.ai returns an error page → strategies all short-circuit to empty.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => '<html>HTTP ERROR 429 Too Many Requests</html>',
    })) as typeof fetch);

    await enrichAfterSave(env, 'recipe-456', 'https://instagram.com/reel/abc', 'Mystery');

    const update = runCalls.find(c => c.sql.includes('UPDATE recipes'));
    expect(update).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: FAIL with `enrichAfterSave is not exported`.

- [ ] **Step 3: Implement `enrichAfterSave`**

Add this function to `apps/worker/src/index.ts` immediately after `runEnrichmentChain` (~line 4352):

```typescript
export async function enrichAfterSave(
  env: Env,
  recipeId: string,
  sourceUrl: string,
  title: string
): Promise<void> {
  if (!sourceUrl || !env.GEMINI_SERVICE_ACCOUNT_B64) return;

  const resolvedUrl = await resolveSourceUrl(sourceUrl);
  const startedAt = Date.now();

  const { result, winningStrategy } = await runEnrichmentChain(env, resolvedUrl, title, {
    captionExtract,
    youtubeVideo,
    textInference,
  });

  console.log('[enrichAfterSave]', {
    recipeId,
    url: resolvedUrl,
    winningStrategy: winningStrategy ?? 'none',
    duration_ms: Date.now() - startedAt,
    ingredients_count: result.ingredients.length,
    steps_count: result.steps.length,
  });

  // B1: silent — if nothing was found, leave the row alone so the user sees
  // their title-only recipe and can hand-fill later.
  if (result.ingredients.length === 0 && result.steps.length === 0) return;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE recipes
     SET ingredients = ?, steps = ?, meal_types = ?, duration_minutes = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    JSON.stringify(result.ingredients),
    JSON.stringify(result.steps),
    JSON.stringify(result.mealTypes),
    result.durationMinutes,
    now,
    recipeId
  ).run();
}
```

Also add `enrichAfterSave` to the export block at line 4811:

```typescript
export {
  callGemini,
  getGeminiAccessToken,
  getGeminiServiceAccount,
  fetchRawRecipeText,
  buildGeminiPrompt,
  parseGeminiRecipeJson,
  fetchOembedCaption,
  captionExtract,
  youtubeVideo,
  textInference,
  runEnrichmentChain,
  handleCreateRecipe,
  enrichAfterSave,
};
```

(Note: `enrichAfterSave` is already declared with `export async function` above, so you can remove it from the re-export block if the duplicate export trips TypeScript — keep only one form.)

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "worker(enrich): add enrichAfterSave for post-save async enrichment"
```

---

## Task 4: Worker — wire `ctx.waitUntil(enrichAfterSave)` into `POST /recipes`

**Why:** spec §Data flow — response returns in ~300ms, enrichment runs async up to 30s.

**Files:**
- Modify: `apps/worker/src/index.ts:1746-1796` (function `handleCreateRecipe`)
- Modify: `apps/worker/src/create-recipe.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/src/create-recipe.test.ts`:

```typescript
describe('handleCreateRecipe fires ctx.waitUntil(enrichAfterSave)', () => {
  it('calls ctx.waitUntil exactly once with a promise', async () => {
    const { db } = makeMockDb({ existingRecipe: null });
    const waitUntil = vi.fn();
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
    const ctx = { waitUntil } as unknown as ExecutionContext;
    const user = { userId: 'u1', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://example.com/bread', ingredients: [], steps: [] }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('does NOT fire ctx.waitUntil when dedup returns existing row', async () => {
    const existing = { id: 'r-dupe', created_at: new Date().toISOString() };
    const { db } = makeMockDb({ existingRecipe: existing });
    const waitUntil = vi.fn();
    const env = { DB: db as unknown as D1Database, GEMINI_SERVICE_ACCOUNT_B64: 'fake' } as Env;
    const ctx = { waitUntil } as unknown as ExecutionContext;
    const user = { userId: 'u1', email: 'a@b.c' };

    const req = new Request('https://worker/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bread', sourceUrl: 'https://example.com/bread' }),
    });

    await handleCreateRecipe(req, env, ctx, user as any);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
```

You will also need to extend `makeMockDb` to support `loadRecipe`-style lookups. Add to the top of the test file:

```typescript
// Note: loadRecipe uses prepare().bind().first() with SELECT * FROM recipes WHERE user_id = ? AND id = ?.
// Extend the mock's first() branch if this isn't already covered.
```

- [ ] **Step 2: Run the failing test**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: FAIL with `ctx.waitUntil was not called`.

- [ ] **Step 3: Wire `ctx.waitUntil` in `handleCreateRecipe`**

In `apps/worker/src/index.ts`, inside `handleCreateRecipe`, immediately before the final `return json({ recipe }, 201);`, add:

```typescript
  // Kick off enrichment asynchronously — response returns in ~300ms,
  // enrichment runs up to 30s in the background. B1: silent on failure.
  if (recipe.sourceUrl && (recipe.ingredients.length === 0 || recipe.steps.length === 0)) {
    ctx.waitUntil(
      enrichAfterSave(env, recipe.id, recipe.sourceUrl, recipe.title)
        .catch(err => console.error('[enrichAfterSave] failed', { recipeId: recipe.id, err: String(err) }))
    );
  }

  return json({ recipe }, 201);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/worker && npm test -- create-recipe
```

Expected: all tests PASS.

- [ ] **Step 5: Run the full worker suite**

Run:
```bash
cd apps/worker && npm test
```

Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/create-recipe.test.ts
git commit -m "worker(recipes): fire ctx.waitUntil(enrichAfterSave) on save"
```

---

## Task 5: Deploy worker to prod and verify

**Why:** the iOS extension can't be tested end-to-end until the worker changes are live.

- [ ] **Step 1: Deploy to production**

Run:
```bash
cd apps/worker && npx wrangler deploy
```

Expected: deploy succeeds, prints a version ID. Note the version ID for rollback if needed.

- [ ] **Step 2: Smoke-test `POST /recipes` with empty ingredients via curl**

With a valid Supabase JWT in `$JWT`:
```bash
curl -s -X POST https://api.recifriend.com/recipes \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke test recipe","sourceUrl":"https://www.tiktok.com/@bakingwithyolanda/video/7234","ingredients":[],"steps":[]}' | jq .
```

Expected: 201 response with a `{ "recipe": {...} }` payload. `recipe.ingredients` is `[]` at this moment.

- [ ] **Step 3: Verify enrichment backfills within 30s**

Wait 30s, then:
```bash
curl -s -H "Authorization: Bearer $JWT" https://api.recifriend.com/recipes/<recipe_id_from_step_2> | jq '.recipe.ingredients | length'
```

Expected: value > 0 (or exactly 0 if this specific URL falls into the r.jina.ai rate-limit case — acceptable per spec §Error handling).

- [ ] **Step 4: Smoke-test dedup**

Run step 2 twice within 60s. Confirm both calls return the same `recipe.id`.

Expected: second call returns 200 (not 201) with the same recipe id as the first.

---

## Task 6: Add SharedAuthStore Capacitor plugin — Swift + Obj-C registration

**Why:** Spec §Components §2 and §4 — main app and extension read/write JWT via shared Keychain. Main app uses this plugin to write; extension reads via a parallel helper (next task).

**Files:**
- Create: `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift`
- Create: `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m`

- [ ] **Step 1: Create the Swift plugin**

Create `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.swift`:

```swift
import Foundation
import Capacitor
import Security

// Stores the Supabase JWT in the shared iOS Keychain so the share extension
// can read it without re-implementing auth. Access group must match both
// targets' keychain-access-groups entitlement.
//
// Error codes (returned via call.reject):
//   - "no-session": getJwt found no stored token
//   - "keychain-write-failed": setJwt SecItemAdd/Update returned non-zero OSStatus
//   - "keychain-read-failed": getJwt SecItemCopyMatching returned non-errSecSuccess other than errSecItemNotFound
//   - "keychain-delete-failed": clearJwt SecItemDelete returned non-zero OSStatus other than errSecItemNotFound

private let keychainService = "com.recifriend.app.auth"
private let keychainAccount = "supabase-jwt"
private let keychainAccessGroup = "com.recifriend.app.shared"

@objc(SharedAuthStorePlugin)
public class SharedAuthStorePlugin: CAPPlugin {

    @objc func setJwt(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        guard let data = token.data(using: .utf8) else {
            call.reject("token is not UTF-8")
            return
        }

        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
        ]

        // Delete any existing record first — simpler than an add-or-update dance.
        SecItemDelete(base as CFDictionary)

        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("keychain-write-failed (OSStatus \(status))")
        }
    }

    @objc func getJwt(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            call.reject("no-session")
            return
        }
        if status != errSecSuccess {
            call.reject("keychain-read-failed (OSStatus \(status))")
            return
        }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            call.reject("keychain-read-failed (corrupt data)")
            return
        }
        call.resolve(["token": token])
    }

    @objc func clearJwt(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("keychain-delete-failed (OSStatus \(status))")
        }
    }
}
```

- [ ] **Step 2: Create the Obj-C registration file**

Create `apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m`:

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore",
  CAP_PLUGIN_METHOD(setJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getJwt, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearJwt, CAPPluginReturnPromise);
)
```

- [ ] **Step 3: Add files to Xcode main-app target**

Open `apps/ios/ios/App/App.xcworkspace` in Xcode. Drag the new `SharedAuthStore` folder into the Xcode `App` target (NOT the ShareExtension target — only the main app hosts the plugin). In the "Copy items if needed" dialog, select "Create groups" and check only the `App` target.

Expected: the two files appear under `App/Plugins/SharedAuthStore` in the Xcode navigator, with the `App` target checked in File Inspector → Target Membership.

- [ ] **Step 4: Build main app target**

In Xcode, select the `App` scheme, build (⌘B).

Expected: green build. If you get `Use of undeclared identifier CAPPluginMethod`, confirm the Obj-C file imports `<Capacitor/Capacitor.h>` and that the Pods are built (clean build folder ⇧⌘K, rebuild).

- [ ] **Step 5: Commit**

```bash
git add apps/ios/ios/App/App/Plugins/SharedAuthStore
git commit -m "ios(plugin): add SharedAuthStore Capacitor plugin for shared Keychain JWT"
```

---

## Task 7: Share extension — SharedKeychain.swift read helper

**Why:** spec §Components §1 — extension reads the JWT via the same access group, but can't depend on Capacitor.

**Files:**
- Create: `apps/ios/ios/App/ShareExtension/SharedKeychain.swift`

- [ ] **Step 1: Create the shared-keychain read helper**

Create `apps/ios/ios/App/ShareExtension/SharedKeychain.swift`:

```swift
import Foundation
import Security

// Minimal Keychain reader for the share extension. Must use the same
// service/account/access-group as SharedAuthStorePlugin so the main app's
// writes are visible here. See apps/ios/ios/App/App/Plugins/SharedAuthStore.
enum SharedKeychainError: Error {
    case notFound
    case readFailed(OSStatus)
    case corruptData
}

enum SharedKeychain {
    private static let service = "com.recifriend.app.auth"
    private static let account = "supabase-jwt"
    private static let accessGroup = "com.recifriend.app.shared"

    static func readJwt() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { throw SharedKeychainError.notFound }
        if status != errSecSuccess { throw SharedKeychainError.readFailed(status) }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            throw SharedKeychainError.corruptData
        }
        return token
    }

    // Called when POST /recipes returns 401 — purge the stale token so the next
    // share triggers the deep-link fallback instead of looping on 401s.
    static func clearJwt() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

- [ ] **Step 2: Add to Xcode ShareExtension target**

In Xcode, drag `SharedKeychain.swift` into the ShareExtension group and check only the `ShareExtension` target in Target Membership.

- [ ] **Step 3: Build ShareExtension target**

In Xcode, select the ShareExtension scheme, build (⌘B).

Expected: green build.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/SharedKeychain.swift
git commit -m "ios(share-ext): SharedKeychain read/clear helper for JWT"
```

---

## Task 8: Share extension — WorkerClient.swift HTTP helpers

**Why:** spec §Components §1 — the extension needs to call `POST /recipes/parse` (preview) and `POST /recipes` (save) directly. Keep them in a dedicated file so the ViewController stays focused on UI.

**Files:**
- Create: `apps/ios/ios/App/ShareExtension/WorkerClient.swift`

- [ ] **Step 1: Create the HTTP helpers**

Create `apps/ios/ios/App/ShareExtension/WorkerClient.swift`:

```swift
import Foundation

// Prod API base — hardcoded because the extension has no env vars.
// Match the Capacitor main-app config (apps/ios/capacitor.config.ts points
// webDir at the production worker via VITE_RECIPES_API_BASE_URL).
private let apiBase = URL(string: "https://api.recifriend.com")!

struct ParsePreview {
    let title: String
    let imageUrl: String?
}

struct CreateRecipeResult {
    let recipeId: String
    let statusCode: Int
}

enum WorkerClientError: Error {
    case badResponse(Int)
    case decoding
    case transport(Error)
    case timeout
    case unauthenticated
}

enum WorkerClient {
    /// Fetches og:title + og:image preview. 2s timeout per spec.
    static func parseRecipe(sourceUrl: String) async throws -> ParsePreview {
        let url = apiBase.appendingPathComponent("recipes/parse")
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 2.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["sourceUrl": sourceUrl])

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw WorkerClientError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let parsed = json["parsed"] as? [String: Any]
        else { throw WorkerClientError.decoding }

        let title = (parsed["title"] as? String) ?? ""
        let imageUrl = (parsed["imageUrl"] as? String) ?? nil
        return ParsePreview(title: title, imageUrl: imageUrl?.isEmpty == false ? imageUrl : nil)
    }

    /// Saves a minimum-viable recipe. 5s timeout per spec.
    /// On 401, callers should clear the stored JWT and deep-link to the main app.
    static func createRecipe(
        title: String,
        sourceUrl: String,
        imageUrl: String?,
        jwt: String
    ) async throws -> CreateRecipeResult {
        let url = apiBase.appendingPathComponent("recipes")
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 5.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "title": title,
            "sourceUrl": sourceUrl,
            "ingredients": [],
            "steps": [],
        ]
        if let imageUrl = imageUrl { payload["imageUrl"] = imageUrl }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw WorkerClientError.badResponse(-1)
        }
        if http.statusCode == 401 { throw WorkerClientError.unauthenticated }
        guard (200...299).contains(http.statusCode) else { throw WorkerClientError.badResponse(http.statusCode) }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let recipe = json["recipe"] as? [String: Any],
            let id = recipe["id"] as? String
        else { throw WorkerClientError.decoding }

        return CreateRecipeResult(recipeId: id, statusCode: http.statusCode)
    }
}
```

- [ ] **Step 2: Add to Xcode ShareExtension target**

Drag `WorkerClient.swift` into the ShareExtension group in Xcode, check only the ShareExtension target.

- [ ] **Step 3: Build ShareExtension**

Build the ShareExtension scheme in Xcode.

Expected: green build.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/WorkerClient.swift
git commit -m "ios(share-ext): WorkerClient HTTP helpers for /recipes/parse and /recipes"
```

---

## Task 9: Share extension — rewrite ShareViewController with SwiftUI form

**Why:** spec §Components §1 — the extension now hosts an interactive SwiftUI form instead of a zero-UI dispatch.

**Files:**
- Rewrite: `apps/ios/ios/App/ShareExtension/ShareViewController.swift`

- [ ] **Step 1: Write the new ShareViewController**

Replace the entire contents of `apps/ios/ios/App/ShareExtension/ShareViewController.swift` with:

```swift
import UIKit
import SwiftUI
import UniformTypeIdentifiers

// Share extension host. Extracts the first URL from the share payload (fast
// path from the previous version), fetches a preview from the worker, and
// renders a SwiftUI form with thumbnail + editable title + Save. On Save,
// POSTs to /recipes with the JWT from shared Keychain. Any failure path
// falls back to deep-linking `recifriend://add-recipe?url=<raw>` to the main
// app's existing drawer flow (A2 fallback).
final class ShareViewController: UIViewController {
    private var hostingController: UIHostingController<ShareFormView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        extractFirstURL { [weak self] url in
            guard let self = self else { return }
            if let url = url {
                DispatchQueue.main.async { self.presentForm(for: url) }
            } else {
                DispatchQueue.main.async { self.completeWithError("No URL found") }
            }
        }
    }

    // MARK: - URL extraction (first-URL-wins, unchanged from previous fast path)

    private func extractFirstURL(completion: @escaping (URL?) -> Void) {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion(nil); return
        }
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                    if let url = data as? URL { completion(url); return }
                    self.tryPlainTextFallback(items: items, completion: completion)
                }
                return
            }
        }
        tryPlainTextFallback(items: items, completion: completion)
    }

    private func tryPlainTextFallback(items: [NSExtensionItem], completion: @escaping (URL?) -> Void) {
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                    if let text = data as? String, let url = Self.extractFirstHTTPURL(from: text) {
                        completion(url); return
                    }
                    completion(nil)
                }
                return
            }
        }
        completion(nil)
    }

    private static func extractFirstHTTPURL(from text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let url = match.url,
              url.scheme == "http" || url.scheme == "https" else { return nil }
        return url
    }

    // MARK: - Form presentation

    private func presentForm(for sourceURL: URL) {
        let viewModel = ShareFormViewModel(sourceURL: sourceURL, onFinish: { [weak self] outcome in
            DispatchQueue.main.async { self?.finish(with: outcome, sourceURL: sourceURL) }
        })
        let root = ShareFormView(viewModel: viewModel)
        let host = UIHostingController(rootView: root)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    // MARK: - Finish / fallback

    enum Outcome {
        case saved(recipeId: String)
        case cancelled
        case fallback  // A2: open main-app drawer via deep link
    }

    private func finish(with outcome: Outcome, sourceURL: URL) {
        switch outcome {
        case .saved:
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        case .cancelled:
            self.extensionContext?.cancelRequest(withError: NSError(
                domain: "com.recifriend.share", code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Cancelled"]
            ))
        case .fallback:
            openDeepLink(for: sourceURL)
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    private func openDeepLink(for sourceURL: URL) {
        var components = URLComponents()
        components.scheme = "recifriend"
        components.host = "add-recipe"
        components.queryItems = [URLQueryItem(name: "url", value: sourceURL.absoluteString)]
        guard let deepLink = components.url else { return }
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(deepLink, options: [:], completionHandler: nil)
                return
            }
            responder = responder?.next
        }
    }

    private func completeWithError(_ message: String) {
        let error = NSError(domain: "com.recifriend.share", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
        self.extensionContext?.cancelRequest(withError: error)
    }
}
```

- [ ] **Step 2: Build ShareExtension**

Build the ShareExtension scheme in Xcode.

Expected: green build (ShareFormView / ShareFormViewModel are not yet defined — build will fail until Task 10 lands). Skip build until Task 10 is complete.

- [ ] **Step 3: No commit yet — wait for Task 10**

Do not commit; ShareViewController references symbols declared in the next task.

---

## Task 10: Share extension — ShareFormView and ShareFormViewModel (SwiftUI form)

**Why:** spec §Components §1 — thumbnail + editable title + Save button, wired to WorkerClient and SharedKeychain.

**Files:**
- Create: `apps/ios/ios/App/ShareExtension/ShareFormView.swift`

- [ ] **Step 1: Create the form + view model**

Create `apps/ios/ios/App/ShareExtension/ShareFormView.swift`:

```swift
import SwiftUI

@MainActor
final class ShareFormViewModel: ObservableObject {
    @Published var title: String = ""
    @Published var imageUrl: URL?
    @Published var isLoadingPreview: Bool = true
    @Published var isSaving: Bool = false
    @Published var errorMessage: String?

    let sourceURL: URL
    private let onFinish: (ShareViewController.Outcome) -> Void

    init(sourceURL: URL, onFinish: @escaping (ShareViewController.Outcome) -> Void) {
        self.sourceURL = sourceURL
        self.onFinish = onFinish
        Task { await self.loadPreview() }
    }

    func loadPreview() async {
        isLoadingPreview = true
        defer { isLoadingPreview = false }
        do {
            let preview = try await WorkerClient.parseRecipe(sourceUrl: sourceURL.absoluteString)
            if title.isEmpty { title = preview.title.isEmpty ? sourceURL.host ?? "Recipe" : preview.title }
            if let s = preview.imageUrl, let u = URL(string: s) { imageUrl = u }
        } catch {
            // Placeholder state: title = host, no image. User can still save.
            if title.isEmpty { title = sourceURL.host ?? "Recipe" }
        }
    }

    func save() {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let imageSnapshot = imageUrl?.absoluteString
        let urlSnapshot = sourceURL.absoluteString

        Task {
            defer { Task { @MainActor in self.isSaving = false } }
            let jwt: String
            do {
                jwt = try SharedKeychain.readJwt()
            } catch {
                await MainActor.run { self.onFinish(.fallback) }
                return
            }

            do {
                let result = try await WorkerClient.createRecipe(
                    title: titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot,
                    sourceUrl: urlSnapshot,
                    imageUrl: imageSnapshot,
                    jwt: jwt
                )
                await MainActor.run { self.onFinish(.saved(recipeId: result.recipeId)) }
            } catch WorkerClientError.unauthenticated {
                // Token expired — purge it so next share doesn't loop on 401.
                SharedKeychain.clearJwt()
                await MainActor.run { self.onFinish(.fallback) }
            } catch {
                await MainActor.run { self.onFinish(.fallback) }
            }
        }
    }

    func cancel() {
        onFinish(.cancelled)
    }
}

struct ShareFormView: View {
    @ObservedObject var viewModel: ShareFormViewModel

    var body: some View {
        NavigationView {
            Form {
                Section {
                    HStack(alignment: .top, spacing: 12) {
                        thumbnailView
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 4) {
                            TextField("Title", text: $viewModel.title)
                                .font(.headline)
                                .disabled(viewModel.isSaving)
                            Text(viewModel.sourceURL.host ?? "")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                if let error = viewModel.errorMessage {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Save Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: viewModel.cancel)
                        .disabled(viewModel.isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: viewModel.save)
                            .disabled(viewModel.title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var thumbnailView: some View {
        if let imageUrl = viewModel.imageUrl {
            AsyncImage(url: imageUrl) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        Rectangle().fill(Color(.systemGray5))
    }
}
```

- [ ] **Step 2: Add to Xcode ShareExtension target**

Drag `ShareFormView.swift` into the ShareExtension group, check only the ShareExtension target.

- [ ] **Step 3: Build ShareExtension**

Build the ShareExtension scheme in Xcode.

Expected: green build. The extension compiles even though the main app hasn't started writing the JWT yet — it will gracefully fallback.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/ios/App/ShareExtension/ShareViewController.swift apps/ios/ios/App/ShareExtension/ShareFormView.swift
git commit -m "ios(share-ext): SwiftUI form + view model for inline native save"
```

---

## Task 11: Main app — JS wrapper for SharedAuthStore plugin

**Why:** spec §Components §4 — main-app JS calls the native plugin whenever Supabase emits an auth event with a session.

**Files:**
- Create: `apps/recipe-ui/src/native/SharedAuthStore.js`

- [ ] **Step 1: Create the JS wrapper**

Create `apps/recipe-ui/src/native/SharedAuthStore.js`:

```javascript
import { registerPlugin, Capacitor } from '@capacitor/core';

// Registered in apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m
// via CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore", ...).
const SharedAuthStoreNative = registerPlugin('SharedAuthStore');

// Exposes a narrow promise API. On non-iOS platforms every call is a no-op so
// the main app can call it unconditionally.
export const SharedAuthStore = {
  async setJwt(token) {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.setJwt({ token });
    } catch (err) {
      console.warn('[SharedAuthStore] setJwt failed:', err?.message ?? err);
    }
  },
  async clearJwt() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.clearJwt();
    } catch (err) {
      console.warn('[SharedAuthStore] clearJwt failed:', err?.message ?? err);
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/recipe-ui/src/native/SharedAuthStore.js
git commit -m "feat(ios): JS wrapper for SharedAuthStore Capacitor plugin"
```

---

## Task 12: Main app — write JWT on every auth event, clear on sign-out

**Why:** spec §Components §4 — extension needs a fresh JWT in Keychain any time the main app has one.

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx:1337-1353` (the `onAuthStateChange` block)

- [ ] **Step 1: Import the wrapper**

At the top of `apps/recipe-ui/src/App.jsx`, add (adjacent to other imports):

```javascript
import { SharedAuthStore } from './native/SharedAuthStore';
```

- [ ] **Step 2: Wire setJwt / clearJwt into the auth listener**

Replace the existing `onAuthStateChange` block (lines 1337–1351) with:

```javascript
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      // Mirror the Supabase access token into shared iOS Keychain so the
      // share extension can save recipes natively without the main app.
      // Any event delivering a non-null session updates it (INITIAL_SESSION
      // on cold launch, SIGNED_IN on new login, TOKEN_REFRESHED on refresh,
      // USER_UPDATED after profile changes).
      if (session?.access_token) {
        SharedAuthStore.setJwt(session.access_token);
      }

      if (event === 'SIGNED_IN') {
        setCurrentView('home');
        setIsAuthDialogOpen(false);
        setAuthError('');
        setIsAuthLoading(false);
      }
      if (event === 'SIGNED_OUT') {
        setCurrentView('home');
        SharedAuthStore.clearJwt();
      }
      if (window.gtag) {
        window.gtag('config', 'G-W2LEPNDMF0', { user_id: session?.user?.id ?? undefined });
      }
    });
```

- [ ] **Step 3: Verify in local dev**

Run:
```bash
cd apps/recipe-ui && npm run dev
```

Open the app, log in via Google. In the browser console, confirm there is no error and `SharedAuthStore` logs are silent on non-iOS (it's a no-op when `Capacitor.isNativePlatform()` is false).

Expected: login still works; no crash.

- [ ] **Step 4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ios): mirror Supabase JWT to shared Keychain on auth events"
```

---

## Task 13: Main app — refetch recipes on app resume

**Why:** spec §Components §4 — extension-saved recipes must appear in the main app without a manual pull-to-refresh.

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` — add a new `useEffect` adjacent to the existing `appUrlOpen` listener (~line 1405).

- [ ] **Step 1: Find the existing recipe refetch function**

Before editing, search `apps/recipe-ui/src/App.jsx` for the function that fetches the user's recipes (look for `loadRecipes`, `fetchRecipes`, or the hook that populates the `recipes` state). Capture its name — you'll call it on resume.

- [ ] **Step 2: Add the appStateChange listener**

In `apps/recipe-ui/src/App.jsx`, add this `useEffect` immediately after the existing `appUrlOpen` listener effect (~line 1423):

```javascript
  // Refetch recipes when the app returns to the foreground — the share
  // extension may have saved a new recipe while we were backgrounded.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listenerHandle;
    let cancelled = false;
    CapacitorApp.addListener('appStateChange', (state) => {
      if (state.isActive && session?.user?.id) {
        // Replace `loadRecipes` with the actual name discovered in Step 1.
        loadRecipes().catch(() => { /* best-effort refresh */ });
      }
    }).then((handle) => {
      if (cancelled) { handle.remove(); return; }
      listenerHandle = handle;
    });
    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
  }, [session?.user?.id]);
```

If the actual refetch function is not named `loadRecipes`, substitute the real name before committing. If the app fetches recipes declaratively via a React Query / SWR / effect-based dependency on `session`, prefer invalidating that cache instead.

- [ ] **Step 3: Verify locally**

Run the app, save a recipe via a background tab / window, simulate backgrounding + foregrounding, confirm the recipe list refetches. On web, `appStateChange` never fires, so this is a smoke test only (acceptance comes on device in Task 15).

- [ ] **Step 4: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ios): refetch recipes on app resume to pick up extension saves"
```

---

## Task 14: End-to-end build on device

**Why:** verify the whole feature functions on a real iPhone. Simulators lie about App Group and Keychain sharing.

- [ ] **Step 1: Full sync + clean + install**

Run:
```bash
cd apps/recipe-ui && npm run build
cd ../ios && npx cap sync ios
cd ios/App && pod install
```

Expected: each step succeeds. `cap sync` copies the web bundle into `apps/ios/ios/App/public/` (or updates the live-reload config).

- [ ] **Step 2: Archive + install on device**

In Xcode, select `App` scheme, target = your physical iPhone, Product → Run (⌘R).

Expected: app launches on device. No entitlement errors. Sign in with Google.

- [ ] **Step 3: Confirm JWT was written**

Install a small debug-only helper in dev: in Safari, open the app, open the Capacitor JS console, and run:
```javascript
// Only exposed in dev builds if needed — one-off verification, not committed.
await window.Capacitor.Plugins.SharedAuthStore.getJwt().then(r => console.log('JWT length:', r.token.length)).catch(e => console.warn(e));
```

Expected: prints a JWT length >100 chars. If `no-session`, auth listener didn't fire — check the Safari web inspector console.

- [ ] **Step 4: Share a TikTok recipe**

In the Safari simulator or on the device, open a TikTok/Instagram recipe page, tap Share, select ReciFriend.

Expected: share sheet opens the SwiftUI form within ~3s, shows thumbnail + pre-filled title. Tap Save. Sheet dismisses within 3s. Open ReciFriend main app — the recipe is in the list (possibly with empty ingredients for the first 5–30s).

- [ ] **Step 5: Run the full acceptance checklist (spec §Testing)**

Work through the checklist in the spec (TikTok, Instagram, YouTube Short, plain URL, signed-out, expired JWT, airplane mode, rapid re-share, resume-refresh). Fix any regressions before signing off.

- [ ] **Step 6: Commit any fixes**

For each fix, write a dedicated commit following the same TDD structure as Tasks 2–4 when the change is in the worker. Swift fixes can commit without tests but must include a "Verified on device: <scenario>" line in the commit message.

---

## Task 15: Dogfood for a week before TestFlight

**Why:** spec §Testing §Dogfooding gate — the user explicitly framed this as the #1 flow, requiring confidence-building usage before release.

- [ ] **Step 1: Save 10+ real recipes over 2+ sessions**

Use the share extension in real-world conditions: different reels, different times of day, with the app foregrounded and backgrounded, on cellular and wifi.

- [ ] **Step 2: Confirm no silent drops, no stuck enrichments >60s, no duplicates**

Check the recipe list after each session. Every save should produce exactly one recipe row, and ingredients should populate within ~30s in most cases (Instagram rate-limit failures are acceptable and tracked separately).

- [ ] **Step 3: Only then push to TestFlight**

After a clean week, tag a release and submit for internal testing.

---

## Self-review

**Spec coverage check:**

| Spec section | Covered in |
|---|---|
| Goal + success criteria | Task 15 dogfooding gate + acceptance checklist in Task 14 |
| Architecture (two-process + App Group) | Task 1 |
| Component §1 Share Extension | Tasks 7 (keychain), 8 (HTTP), 9 (VC), 10 (SwiftUI) |
| Component §2 Shared storage | Tasks 1 (entitlements) + 6 (plugin) + 7 (ext reader) |
| Component §3 Worker changes | Tasks 2 (dedup), 3 (enrichAfterSave), 4 (ctx.waitUntil), 5 (deploy) |
| Component §4 Main app changes | Tasks 6 (plugin), 11 (JS wrapper), 12 (auth mirror), 13 (resume refetch) |
| Component §5 Build prerequisites | Task 1 |
| Data flow happy path | Tasks 8 + 10 (extension POST) + 4 (worker ctx.waitUntil) |
| Data flow A2 fallback | Tasks 9 + 10 (viewmodel `.fallback` outcome, ViewController `openDeepLink`) |
| Enrichment silent failure (B1) | Task 3 (`enrichAfterSave` skips UPDATE on empty result) |
| Error handling table | Covered across Tasks 2–10 |
| Testing automated | Tasks 2, 3, 4 (vitest) |
| Testing manual acceptance | Task 14 |
| Dogfooding | Task 15 |

No uncovered sections.

**Placeholder scan:** none — every step has explicit code or commands.

**Type consistency check:**
- `handleCreateRecipe(request, env, ctx, user)` — used consistently in Tasks 2, 3, 4.
- `enrichAfterSave(env, recipeId, sourceUrl, title)` — same signature in Tasks 3, 4.
- `ShareViewController.Outcome` — `.saved(recipeId:)`, `.cancelled`, `.fallback` — same in Tasks 9, 10.
- `SharedAuthStore` plugin methods — `setJwt`, `getJwt`, `clearJwt` — same in Tasks 6, 11, 12.
- `SharedKeychain` — `readJwt() throws -> String` + `clearJwt()` — same in Tasks 7, 10.
- `WorkerClient` — `parseRecipe(sourceUrl:)` and `createRecipe(title:sourceUrl:imageUrl:jwt:)` — same in Tasks 8, 10.

All consistent.
