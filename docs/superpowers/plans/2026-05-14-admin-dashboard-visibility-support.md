# Admin Dashboard (Visibility + Support) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-only admin web app at `admin.recifriend.com` for filtering/inspecting users (Visibility) and taking Support actions (resend invite, force-accept, magic link, edit display name, soft-delete, hide recipe), with two-layer auth (Cloudflare Access + worker JWT email allowlist) and an audit log of every mutation.

**Architecture:** New Vite app `apps/admin-ui/` deployed as a separate Cloudflare Pages project (`recifriend-admin`) behind a Cloudflare Access policy. New admin routes in the existing `apps/worker` under `/admin/*`, gated by an `ADMIN_EMAILS` worker secret. Three new D1 schema items: `recipes.hidden_at`, `profiles.deleted_at`, and `admin_audit_log` table. The Visibility user table and per-user drill-down panel double as the Support surface (drill-down hosts all action buttons).

**Tech Stack:** React 18 + Vite + MUI (consistent with `apps/recipe-ui`), TanStack Table v8 for the user table, Recharts for trend charts, Cloudflare Workers + D1 + Pages, Cloudflare Access for the SSO perimeter, vitest for worker tests.

**Spec:** `docs/superpowers/specs/2026-05-14-admin-dashboard-visibility-support-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `apps/worker/migrations/0016_admin_dashboard.sql` | Adds `recipes.hidden_at`, `profiles.deleted_at`, `admin_audit_log` |
| `apps/worker/src/routes/admin.ts` | All `/admin/*` route handlers + admin gate middleware + audit log helper |
| `apps/worker/src/routes/admin.test.ts` | Unit tests for admin gate + endpoint handlers (vitest, mocked D1) |
| `apps/admin-ui/package.json` | Standalone Vite app — separate from `apps/recipe-ui` |
| `apps/admin-ui/vite.config.js` | Standard Vite config |
| `apps/admin-ui/index.html` | App shell |
| `apps/admin-ui/src/main.jsx` | App entrypoint, mounts `<App />` |
| `apps/admin-ui/src/App.jsx` | Top-level component: routing, auth gate, sidebar nav |
| `apps/admin-ui/src/supabaseClient.js` | Supabase client (mirrors recipe-ui's pattern) |
| `apps/admin-ui/src/api.js` | `fetchAdmin()` wrapper that attaches JWT + handles 401/403 |
| `apps/admin-ui/src/pages/Dashboard.jsx` | Trend charts + big-number cards |
| `apps/admin-ui/src/pages/Users.jsx` | User table + filters |
| `apps/admin-ui/src/pages/UserDrilldown.jsx` | Per-user drill-down + Support action buttons |
| `apps/admin-ui/src/pages/AuditLog.jsx` | Reverse-chron list of admin actions |
| `apps/admin-ui/src/components/SidebarNav.jsx` | Left rail nav |
| `apps/admin-ui/src/components/ConfirmModal.jsx` | "I'm sure" checkbox modal for destructive actions |
| `apps/admin-ui/.env.local` | `VITE_API_BASE_URL=http://localhost:8787` + Supabase keys (gitignored) |
| `apps/admin-ui/.env.production` | Production env (gitignored) |
| `docs/runbooks/admin-dashboard-cloudflare-setup.md` | Manual ops runbook for Pages project + CF Access policy |

### Modified files

| Path | What changes |
|---|---|
| `apps/worker/src/index.ts` | Wire new admin routes; refactor `deleteAccount` to take `mode: 'hard' \| 'soft'`; add soft-delete filter to user-facing queries (enumerated in Task 3); move existing `/admin/test-nudge-email` into `routes/admin.ts` |
| `apps/worker/wrangler.toml` | Add comment documenting new `ADMIN_EMAILS` secret |
| `apps/recipe-ui/src/App.jsx` (and any worker queries) | Apply `WHERE p.deleted_at IS NULL` to friend-graph and recipe-feed queries (enumerated in Task 3) |
| `CLAUDE.md` | Add admin-ui deploy command + `ADMIN_EMAILS` secret note |
| `MEMORY.md` index + a new `project_admin_dashboard.md` memory | Note that admin lives at admin.recifriend.com, deploy command, etc. |

---

## Phase 0 — Foundation (schema + admin gate + audit log)

### Task 1: Schema migration for hidden_at, deleted_at, admin_audit_log

**Files:**
- Create: `apps/worker/migrations/0016_admin_dashboard.sql`

- [ ] **Step 1: Write the migration**

Write `apps/worker/migrations/0016_admin_dashboard.sql`:

```sql
-- Hide a single recipe from feeds + public landing without deleting it.
ALTER TABLE recipes ADD COLUMN hidden_at TEXT;

-- Soft-delete a user (admin action). Hard delete remains available
-- via the user's own delete-my-account flow.
ALTER TABLE profiles ADD COLUMN deleted_at TEXT;

-- Audit trail of admin-initiated mutations.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_recipe_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_email, created_at DESC);
```

- [ ] **Step 2: Apply locally**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --local --file=migrations/0016_admin_dashboard.sql`
Expected: `🌀 Executed 5 commands` (or similar success output).

- [ ] **Step 3: Verify locally**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_log'"`
Expected: one row returned showing `admin_audit_log`.

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --local --command="PRAGMA table_info(recipes)" | grep hidden_at`
Expected: a row showing `hidden_at TEXT`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/migrations/0016_admin_dashboard.sql
git commit -m "feat(admin): schema for hidden_at, deleted_at, admin_audit_log"
```

(Production migration application happens in the rollout phase, Task 24.)

---

### Task 2: Admin gate middleware + ADMIN_EMAILS secret

**Files:**
- Create: `apps/worker/src/routes/admin.ts`
- Create: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/wrangler.toml`

- [ ] **Step 1: Write failing test for admin gate**

Create `apps/worker/src/routes/admin.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isAdminEmail } from './admin';

describe('isAdminEmail', () => {
  it('returns true for an email in ADMIN_EMAILS (single value)', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('returns true for an email in a comma-separated ADMIN_EMAILS list', () => {
    expect(isAdminEmail('foo@bar.com', 'elisa.widjaja@gmail.com,foo@bar.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAdminEmail('Elisa.Widjaja@GMAIL.com', 'elisa.widjaja@gmail.com')).toBe(true);
  });

  it('trims whitespace around list entries', () => {
    expect(isAdminEmail('foo@bar.com', ' elisa.widjaja@gmail.com , foo@bar.com ')).toBe(true);
  });

  it('returns false when email is not in the list', () => {
    expect(isAdminEmail('intruder@example.com', 'elisa.widjaja@gmail.com')).toBe(false);
  });

  it('returns false when ADMIN_EMAILS is undefined', () => {
    expect(isAdminEmail('elisa.widjaja@gmail.com', undefined)).toBe(false);
  });

  it('returns false when email is undefined', () => {
    expect(isAdminEmail(undefined, 'elisa.widjaja@gmail.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — `Cannot find module './admin'` or similar.

- [ ] **Step 3: Implement `isAdminEmail` in admin.ts**

Create `apps/worker/src/routes/admin.ts`:

```typescript
export function isAdminEmail(email: string | undefined, adminEmails: string | undefined): boolean {
  if (!email || !adminEmails) return false;
  const target = email.trim().toLowerCase();
  return adminEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS — 7/7.

- [ ] **Step 5: Document the secret in wrangler.toml**

Edit `apps/worker/wrangler.toml`. Find the comment block:

```
# Secrets (set via wrangler secret put):
# - DEV_API_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - GEMINI_SERVICE_ACCOUNT_B64
# - APNS_AUTH_KEY_P8   (ES256 private key from Apple Developer portal)
```

Append one line:
```
# - ADMIN_EMAILS         (comma-separated list of admin email addresses for /admin/* routes)
```

- [ ] **Step 6: Set the secret on production**

Run: `cd apps/worker && echo "elisa.widjaja@gmail.com" | npx wrangler secret put ADMIN_EMAILS`
Expected: confirmation that the secret was set.

Also for dev: `cd apps/worker && echo "elisa.widjaja@gmail.com" | npx wrangler secret put ADMIN_EMAILS --env dev`

For local dev, append to `apps/worker/.dev.vars`:
```
ADMIN_EMAILS=elisa.widjaja@gmail.com
```

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/wrangler.toml
git commit -m "feat(admin): isAdminEmail gate + ADMIN_EMAILS secret"
```

---

### Task 3: Apply soft-delete filter to existing user-facing queries

The new `profiles.deleted_at` column is a footgun: every query that JOINs on `profiles` and serves user-facing data must filter `WHERE p.deleted_at IS NULL`, or soft-deleted users will keep appearing in friend lists/feeds.

**Files:**
- Modify: `apps/worker/src/index.ts` (multiple locations)

- [ ] **Step 1: Enumerate every query that needs the filter**

Run: `cd apps/worker && grep -nE "FROM profiles|JOIN profiles" src/index.ts`

For each match, classify:
- **Internal lookup** (admin context, fetching one user by id, no friend-graph implication) → no filter needed
- **User-facing data path** (friend list, recipe feed, suggestion list, share recipient resolution) → filter required

Examples of paths that need the filter (verify against the codebase — line numbers may have drifted):
- The friend-suggestion query in `handleFriendSuggestions`
- The recently-saved/shared friend feeds in `getFriendsRecentlySaved`, `getFriendsRecentlyShared`
- The friend activity feed in `getFriendActivity`
- The "share to friend" recipient resolution
- Any recipe feed JOIN that resolves the owner's display name

Write the list to a scratch file `/tmp/soft-delete-queries.md` so you can check them off:

```markdown
- [ ] index.ts:NNNN — handleFriendSuggestions
- [ ] index.ts:NNNN — getFriendsRecentlySaved
- ...
```

- [ ] **Step 2: Add the filter to each query**

For each enumerated location, add `AND p.deleted_at IS NULL` (or equivalent for the relevant alias) to the WHERE clause. Where the query SELECTs from `profiles` directly (no alias), add `WHERE deleted_at IS NULL`.

Example pattern:

Before:
```typescript
const rows = await env.DB.prepare(
  `SELECT p.user_id, p.display_name, p.email
   FROM profiles p
   WHERE p.user_id IN (${placeholders})`
).bind(...ids).all();
```

After:
```typescript
const rows = await env.DB.prepare(
  `SELECT p.user_id, p.display_name, p.email
   FROM profiles p
   WHERE p.user_id IN (${placeholders})
     AND p.deleted_at IS NULL`
).bind(...ids).all();
```

- [ ] **Step 3: Add a regression test for one representative path**

Create `apps/worker/src/routes/admin.test.ts` additions (append to the existing file):

```typescript
import { describe, expect, it, vi } from 'vitest';

describe('soft-deleted user filtering (regression)', () => {
  it('handleFriendSuggestions excludes profiles where deleted_at IS NOT NULL', async () => {
    // Spy on prepare() to capture the SQL that gets executed.
    const captured: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
      })
    } as unknown as D1Database;

    // Import lazily to avoid circular issues at top.
    const { handleFriendSuggestions } = await import('../index');
    await handleFriendSuggestions(mockDb, 'user-1');

    // At least one query against profiles must include the deleted_at filter.
    const profileQueries = captured.filter((sql) => /FROM profiles/i.test(sql));
    expect(profileQueries.length).toBeGreaterThan(0);
    for (const sql of profileQueries) {
      expect(sql).toMatch(/deleted_at IS NULL/i);
    }
  });
});
```

- [ ] **Step 4: Run worker test suite**

Run: `cd apps/worker && npm test`
Expected: all tests pass, including the new regression test.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): filter soft-deleted profiles from user-facing queries"
```

---

### Task 4: Audit log helper

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`

- [ ] **Step 1: Write failing test**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { writeAuditLog } from './admin';

describe('writeAuditLog', () => {
  it('inserts an admin_audit_log row with all fields', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) } as unknown as D1Database;

    await writeAuditLog(mockDb, {
      adminEmail: 'elisa.widjaja@gmail.com',
      action: 'hide_recipe',
      targetUserId: 'user-1',
      targetRecipeId: 'recipe-2',
      payload: { reason: 'spam' }
    });

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log')
    );
    expect(bindMock).toHaveBeenCalledWith(
      'elisa.widjaja@gmail.com',
      'hide_recipe',
      'user-1',
      'recipe-2',
      JSON.stringify({ reason: 'spam' })
    );
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('handles null target_user_id, target_recipe_id, payload', async () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) } as unknown as D1Database;

    await writeAuditLog(mockDb, { adminEmail: 'a@b.com', action: 'noop' });
    expect(bindMock).toHaveBeenCalledWith('a@b.com', 'noop', null, null, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — `writeAuditLog is not exported`.

- [ ] **Step 3: Implement `writeAuditLog`**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export interface AuditLogEntry {
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetRecipeId?: string;
  payload?: unknown;
}

export async function writeAuditLog(db: D1Database, entry: AuditLogEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_audit_log (admin_email, action, target_user_id, target_recipe_id, payload)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      entry.adminEmail,
      entry.action,
      entry.targetUserId ?? null,
      entry.targetRecipeId ?? null,
      entry.payload === undefined ? null : JSON.stringify(entry.payload)
    )
    .run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS — all admin tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts
git commit -m "feat(admin): writeAuditLog helper + tests"
```

---

## Phase 1 — First end-to-end vertical (admin/me + admin-ui skeleton)

### Task 5: GET /admin/me endpoint

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts` (wire route)

- [ ] **Step 1: Write failing test**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { handleAdminMe } from './admin';

describe('handleAdminMe', () => {
  it('returns isAdmin: true and the email when caller is in ADMIN_EMAILS', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com'
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'elisa.widjaja@gmail.com', isAdmin: true });
  });

  it('returns 403 when caller email is not in ADMIN_EMAILS', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-2', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com'
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when ADMIN_EMAILS is unset', async () => {
    const res = await handleAdminMe({
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: undefined
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — `handleAdminMe is not exported`.

- [ ] **Step 3: Implement `handleAdminMe`**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

export interface AdminCallerCtx {
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
}

export function requireAdmin(ctx: AdminCallerCtx): Response | null {
  if (!isAdminEmail(ctx.user.email, ctx.adminEmails)) {
    return json(403, { code: 'FORBIDDEN', message: 'Not an admin' });
  }
  return null;
}

export async function handleAdminMe(ctx: AdminCallerCtx): Promise<Response> {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return json(200, { email: ctx.user.email, isAdmin: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire route into index.ts**

In `apps/worker/src/index.ts`, find the section where other routes are dispatched (look for `if (url.pathname === '/recipes' && ...)` or similar). Add at the top of the authenticated-routes section:

```typescript
// Admin routes — gated by ADMIN_EMAILS check inside each handler.
if (url.pathname === '/admin/me' && request.method === 'GET') {
  const { handleAdminMe } = await import('./routes/admin');
  return await handleAdminMe({ user, adminEmails: env.ADMIN_EMAILS });
}
```

Also add `ADMIN_EMAILS?: string;` to the `Env` type definition near the top of `index.ts`.

- [ ] **Step 6: Manual smoke test**

Start the worker locally: `cd apps/worker && npx wrangler dev --port 8787` (in another terminal).

Run with the dev key (also requires `ADMIN_EMAILS` in `.dev.vars`):
```bash
curl -i -H "Authorization: Bearer $(cat apps/worker/.dev.vars | grep DEV_API_KEY | cut -d= -f2)" \
  http://localhost:8787/admin/me
```
Expected: 403 (the dev-key fallback uses email `dev@example.com`, not in ADMIN_EMAILS).

Then add `dev@example.com` to `.dev.vars` ADMIN_EMAILS, restart worker, and re-curl. Expected: 200 with `{"email":"dev@example.com","isAdmin":true}`. (Remove `dev@example.com` afterwards.)

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): GET /admin/me endpoint + wire to worker"
```

---

### Task 6: Move existing /admin/test-nudge-email into routes/admin.ts

**Files:**
- Modify: `apps/worker/src/index.ts` (line ~340)
- Modify: `apps/worker/src/routes/admin.ts`

- [ ] **Step 1: Identify the existing handler**

Run: `cd apps/worker && grep -n "test-nudge-email" src/index.ts`

Read the surrounding 50 lines to capture the full handler logic.

- [ ] **Step 2: Move the handler into admin.ts**

Append to `apps/worker/src/routes/admin.ts` an exported `handleTestNudgeEmail` function with the same logic, taking the same dependencies (env, request body) as parameters. Gate it with `requireAdmin()` at the top — currently it's likely ungated or gated only by the dev key, which is sloppy.

- [ ] **Step 3: Replace the inline handler in index.ts**

Replace the inline body with:

```typescript
if (url.pathname === '/admin/test-nudge-email' && request.method === 'POST') {
  const { handleTestNudgeEmail } = await import('./routes/admin');
  return await handleTestNudgeEmail({ env, user, adminEmails: env.ADMIN_EMAILS, request });
}
```

- [ ] **Step 4: Run worker tests**

Run: `cd apps/worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/admin.ts
git commit -m "refactor(admin): move /admin/test-nudge-email into routes/admin.ts and gate via ADMIN_EMAILS"
```

---

### Task 7: Scaffold apps/admin-ui Vite app

**Files:**
- Create: `apps/admin-ui/package.json`
- Create: `apps/admin-ui/vite.config.js`
- Create: `apps/admin-ui/index.html`
- Create: `apps/admin-ui/src/main.jsx`
- Create: `apps/admin-ui/src/App.jsx`
- Create: `apps/admin-ui/src/supabaseClient.js`
- Create: `apps/admin-ui/src/api.js`
- Create: `apps/admin-ui/.env.local`
- Create: `apps/admin-ui/.gitignore`

- [ ] **Step 1: Create directory + package.json**

```bash
mkdir -p apps/admin-ui/src/pages apps/admin-ui/src/components
```

Write `apps/admin-ui/package.json`:

```json
{
  "name": "admin-ui",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@emotion/react": "^11.11.4",
    "@emotion/styled": "^11.11.5",
    "@mui/icons-material": "^5.15.18",
    "@mui/material": "^5.15.18",
    "@supabase/supabase-js": "^2.43.4",
    "@tanstack/react-table": "^8.16.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.2.11"
  }
}
```

(Versions match recipe-ui's `package.json` where shared. Cross-check before installing.)

- [ ] **Step 2: Install deps**

Run: `cd apps/admin-ui && npm install`
Expected: dependencies installed, no peer-dep errors blocking.

- [ ] **Step 3: Vite config**

Write `apps/admin-ui/vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
```

- [ ] **Step 4: index.html + main.jsx**

Write `apps/admin-ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ReciFriend Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Write `apps/admin-ui/src/main.jsx`:

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const theme = createTheme({
  palette: { mode: 'light' },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
```

- [ ] **Step 5: Supabase client + env**

Write `apps/admin-ui/src/supabaseClient.js`:

```javascript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey, {
  auth: { storageKey: 'recifriend-admin-auth' },
});
```

Write `apps/admin-ui/.env.local`:

```
VITE_API_BASE_URL=http://localhost:8787
VITE_SUPABASE_URL=https://jpjuaaxwfpemecbwwthk.supabase.co
VITE_SUPABASE_ANON_KEY=<copy from apps/recipe-ui/.env.local>
```

Write `apps/admin-ui/.gitignore`:

```
node_modules
dist
.env.local
.env.production
```

- [ ] **Step 6: API helper**

Write `apps/admin-ui/src/api.js`:

```javascript
import { supabase } from './supabaseClient';

const BASE = import.meta.env.VITE_API_BASE_URL;

export async function fetchAdmin(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 403) throw new Error('FORBIDDEN');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}
```

- [ ] **Step 7: Minimal App.jsx that exercises auth + admin/me**

Write `apps/admin-ui/src/App.jsx`:

```javascript
import { useEffect, useState } from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import { supabase } from './supabaseClient';
import { fetchAdmin } from './api';

export default function App() {
  const [session, setSession] = useState(null);
  const [check, setCheck] = useState({ status: 'idle', email: null, error: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setCheck({ status: 'loading', email: null, error: null });
    fetchAdmin('/admin/me')
      .then((data) => setCheck({ status: 'ok', email: data.email, error: null }))
      .catch((err) => setCheck({ status: 'error', email: null, error: err.message }));
  }, [session]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };
  const signOut = async () => { await supabase.auth.signOut(); };

  if (!session) {
    return (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <Typography variant="h4" gutterBottom>ReciFriend Admin</Typography>
        <Button variant="contained" onClick={signIn}>Sign in with Google</Button>
      </Box>
    );
  }

  if (check.status === 'loading' || check.status === 'idle') {
    return <Box sx={{ p: 8, textAlign: 'center' }}><CircularProgress /></Box>;
  }

  if (check.status === 'error') {
    return (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <Typography variant="h5" color="error">Access denied</Typography>
        <Typography sx={{ mt: 2 }}>{check.error}</Typography>
        <Button sx={{ mt: 2 }} onClick={signOut}>Sign out</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4">ReciFriend Admin</Typography>
      <Typography>Signed in as {check.email}</Typography>
      <Button sx={{ mt: 2 }} onClick={signOut}>Sign out</Button>
    </Box>
  );
}
```

- [ ] **Step 8: Smoke test locally**

In one terminal: `cd apps/worker && npx wrangler dev --port 8787`
In another: `cd apps/admin-ui && npm run dev`
Open `http://localhost:5174`, click "Sign in with Google", complete OAuth (Supabase redirect URL must include `http://localhost:5174` — add it in Supabase dashboard if missing).
Expected: After signin, page shows "Signed in as elisa.widjaja@gmail.com".

If you see "FORBIDDEN", verify the email matches `ADMIN_EMAILS` in `.dev.vars` and the worker was restarted.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-ui
git commit -m "feat(admin-ui): scaffold Vite app with Supabase auth + /admin/me check"
```

(CLAUDE.md updates land in Task 25 after the production rollout.)

---

## Phase 2 — Cloudflare setup (manual ops, documented)

### Task 8: Cloudflare Pages project + custom domain

**Files:**
- Create: `docs/runbooks/admin-dashboard-cloudflare-setup.md`

This task is operational, not code. Document each step in the runbook so it's reproducible.

- [ ] **Step 1: Build admin-ui locally to confirm it produces a `dist/`**

Run: `cd apps/admin-ui && npm run build`
Expected: `dist/` directory exists with `index.html` and `assets/`.

- [ ] **Step 2: Create the Pages project via wrangler**

Run: `cd apps/admin-ui && npx wrangler pages project create recifriend-admin --production-branch main`
Expected: project created. If it fails with "name taken" pick `recifriend-admin-app` or similar — update the deploy command everywhere it appears.

- [ ] **Step 3: First deploy**

Run: `cd apps/admin-ui && npx wrangler pages deploy dist --project-name recifriend-admin`
Expected: Deployed. Note the URL printed (e.g., `https://<hash>.recifriend-admin.pages.dev`).

Visit the URL — admin-ui should load and show the sign-in screen.

- [ ] **Step 4: Add custom domain admin.recifriend.com**

In Cloudflare dashboard → Workers & Pages → recifriend-admin → Custom domains → Set up custom domain → `admin.recifriend.com`. Cloudflare will create the DNS record automatically.

Wait until the cert provisions (1-2 minutes), then visit `https://admin.recifriend.com`.

- [ ] **Step 5: Add the custom domain to Supabase Auth redirect URLs**

In Supabase dashboard → Authentication → URL Configuration → Redirect URLs → add:
```
https://admin.recifriend.com/**
```

- [ ] **Step 6: Configure VITE_API_BASE_URL for production**

Create `apps/admin-ui/.env.production`:
```
VITE_API_BASE_URL=https://api.recifriend.com
VITE_SUPABASE_URL=https://jpjuaaxwfpemecbwwthk.supabase.co
VITE_SUPABASE_ANON_KEY=<same anon key as recipe-ui's .env.production>
```

Re-build and re-deploy:
```bash
cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin
```

- [ ] **Step 7: Write the runbook**

Write `docs/runbooks/admin-dashboard-cloudflare-setup.md` capturing:
- Pages project name, custom domain, Supabase redirect URL added
- Deploy command
- How to rotate `ADMIN_EMAILS` (`wrangler secret put ADMIN_EMAILS`)
- Where Cloudflare Access policy lives (Task 9)

- [ ] **Step 8: Commit**

```bash
git add apps/admin-ui/.env.production docs/runbooks/admin-dashboard-cloudflare-setup.md
git commit -m "ops(admin): create recifriend-admin Pages project + custom domain"
```

(Note: `.env.production` is in `.gitignore` per Task 7 — do not commit it. Commit only the runbook + any other non-secret files. If there's nothing else, skip the commit and instead write a follow-up note in the runbook.)

---

### Task 9: Cloudflare Access policy in front of admin.recifriend.com

This task is entirely Cloudflare dashboard configuration. Document each step in the runbook.

- [ ] **Step 1: Enable Cloudflare Access (Zero Trust)**

In Cloudflare dashboard → Zero Trust → Access. If it's the first time, complete the team-name setup (any team name works; the user is the only member).

- [ ] **Step 2: Configure Google as an identity provider**

Zero Trust → Settings → Authentication → Login methods → Add new → Google. Follow the prompts. (One-time setup; uses Cloudflare's managed Google OAuth client by default — no Google Cloud Console work needed.)

- [ ] **Step 3: Create an Access application for admin.recifriend.com**

Zero Trust → Access → Applications → Add an application → Self-hosted.
- Application name: `ReciFriend Admin`
- Session duration: `24 hours`
- Application domain: `admin.recifriend.com` (no path — covers the whole subdomain)

- [ ] **Step 4: Create the policy**

Add a policy to the application:
- Policy name: `Admin allowlist`
- Action: `Allow`
- Include: `Emails` → `elisa.widjaja@gmail.com`
- (Optionally) Require: `Login methods` → `Google`

Save.

- [ ] **Step 5: Verify**

In an incognito window, open `https://admin.recifriend.com`. Expected: Cloudflare's Access login screen appears, prompts you to choose Google. After Google login, the admin app loads (and you'll need to sign in to Supabase a second time — that's the intended belt-and-suspenders flow).

In a different browser (or with a non-allowlisted email), expected: "You don't have access" screen.

- [ ] **Step 6: Update runbook**

Append the Access setup steps to `docs/runbooks/admin-dashboard-cloudflare-setup.md`, including how to add additional admin emails (CF dashboard → Access → Applications → ReciFriend Admin → Policies → Edit → add to Emails list, AND `wrangler secret put ADMIN_EMAILS` with the new comma-separated list).

- [ ] **Step 7: Commit runbook update**

```bash
git add docs/runbooks/admin-dashboard-cloudflare-setup.md
git commit -m "ops(admin): document Cloudflare Access policy setup"
```

---

## Phase 3 — Visibility: user list

### Task 10: GET /admin/users (no filters yet)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts` (route wire)

- [ ] **Step 1: Write failing test for the SQL builder**

The `/admin/users` query is complex (joins recipes count, friend_requests counts, friends count). To make it testable, isolate the SQL building in a pure function `buildUsersListQuery()` and test that separately.

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { buildUsersListQuery } from './admin';

describe('buildUsersListQuery', () => {
  it('returns SQL containing all expected aggregates', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/COUNT\(DISTINCT r\.id\)\s+AS\s+recipe_count/i);
    expect(sql).toMatch(/COUNT\(DISTINCT frs\.to_user_id\)\s+AS\s+invites_sent/i);
    expect(sql).toMatch(/COUNT\(DISTINCT f\.friend_id\)\s+AS\s+invites_accepted/i);
  });

  it('always includes deleted_at IS NULL filter', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    // Note: admin can SEE soft-deleted users via the activity filter; the default
    // list excludes them. Filter is added unless activity === 'soft_deleted'.
    expect(sql).toMatch(/p\.deleted_at IS NULL/);
  });

  it('returns SQL including soft-deleted when activity=soft_deleted', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, activity: 'soft_deleted' });
    expect(sql).toMatch(/p\.deleted_at IS NOT NULL/);
  });

  it('binds the search term as a LIKE param when provided', () => {
    const { sql, params } = buildUsersListQuery({ limit: 50, offset: 0, search: 'sarah' });
    expect(sql).toMatch(/email LIKE \?/i);
    expect(params).toContain('%sarah%');
  });

  it('applies recipe bucket filter for "0"', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '0' });
    expect(sql).toMatch(/HAVING\s+(\(.*\s)?recipe_count = 0/i);
  });

  it('applies recipe bucket filter for "10-19"', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, recipeBucket: '10-19' });
    expect(sql).toMatch(/recipe_count BETWEEN 10 AND 19/i);
  });

  it('applies signupAfter bound', () => {
    const { sql, params } = buildUsersListQuery({
      limit: 50, offset: 0, signupAfter: '2026-01-01'
    });
    expect(sql).toMatch(/p\.created_at >= \?/);
    expect(params).toContain('2026-01-01');
  });

  it('respects sort=signup_asc', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0, sort: 'signup_asc' });
    expect(sql).toMatch(/ORDER BY p\.created_at ASC/i);
  });

  it('defaults to signup_desc', () => {
    const { sql } = buildUsersListQuery({ limit: 50, offset: 0 });
    expect(sql).toMatch(/ORDER BY p\.created_at DESC/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — `buildUsersListQuery is not exported`.

- [ ] **Step 3: Implement `buildUsersListQuery`**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export interface UsersListParams {
  limit: number;
  offset: number;
  search?: string;
  recipeBucket?: '0' | '1-9' | '10-19' | '20-49' | '50+';
  activity?: 'active' | 'inactive' | 'ghost' | 'soft_deleted';
  signupAfter?: string;
  signupBefore?: string;
  sort?: 'signup_desc' | 'signup_asc';
}

export interface BuiltQuery { sql: string; params: unknown[] }

const RECIPE_BUCKETS: Record<string, string> = {
  '0': 'recipe_count = 0',
  '1-9': 'recipe_count BETWEEN 1 AND 9',
  '10-19': 'recipe_count BETWEEN 10 AND 19',
  '20-49': 'recipe_count BETWEEN 20 AND 49',
  '50+': 'recipe_count >= 50',
};

export function buildUsersListQuery(p: UsersListParams): BuiltQuery {
  const where: string[] = [];
  const having: string[] = [];
  const params: unknown[] = [];

  if (p.activity === 'soft_deleted') {
    where.push('p.deleted_at IS NOT NULL');
  } else {
    where.push('p.deleted_at IS NULL');
  }

  if (p.search) {
    where.push('p.email LIKE ?');
    params.push(`%${p.search}%`);
  }
  if (p.signupAfter) {
    where.push('p.created_at >= ?');
    params.push(p.signupAfter);
  }
  if (p.signupBefore) {
    where.push('p.created_at <= ?');
    params.push(p.signupBefore);
  }

  if (p.recipeBucket && RECIPE_BUCKETS[p.recipeBucket]) {
    having.push(RECIPE_BUCKETS[p.recipeBucket]);
  }

  // Activity HAVING clauses operate on the aggregates defined in SELECT.
  // "active" = recipe_count >= 1 AND last_sign_in within 30d
  // "ghost"  = recipe_count = 0 AND no sign-in after signup
  // "inactive" = neither active nor ghost
  // (Soft-deleted handled in the WHERE above.)
  // last_sign_in_at is NOT in D1 — it lives in Supabase Auth and gets joined
  // at the application layer. So activity-based HAVING is partially in SQL,
  // partially in the post-fetch filter step. Document this in the handler.

  const orderBy = p.sort === 'signup_asc' ? 'p.created_at ASC' : 'p.created_at DESC';

  const sql = `
    SELECT
      p.user_id            AS id,
      p.email              AS email,
      p.display_name       AS display_name,
      p.created_at         AS signed_up_at,
      p.deleted_at         AS deleted_at,
      COUNT(DISTINCT r.id) AS recipe_count,
      COUNT(DISTINCT frs.to_user_id) AS invites_sent,
      COUNT(DISTINCT f.friend_id) AS invites_accepted
    FROM profiles p
    LEFT JOIN recipes r ON r.user_id = p.user_id
    LEFT JOIN friend_requests_sent frs ON frs.from_user_id = p.user_id
    LEFT JOIN friends f ON f.user_id = p.user_id
    WHERE ${where.join(' AND ')}
    GROUP BY p.user_id
    ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `.trim();

  params.push(p.limit, p.offset);
  return { sql, params };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS — all 9 buildUsersListQuery tests + earlier tests.

- [ ] **Step 5: Implement `handleAdminUsersList`**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export async function handleAdminUsersList(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const limit = Math.min(parseInt(args.url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(args.url.searchParams.get('offset') || '0', 10);

  const params: UsersListParams = {
    limit,
    offset,
    search: args.url.searchParams.get('search') || undefined,
    recipeBucket: (args.url.searchParams.get('recipeBucket') as any) || undefined,
    activity: (args.url.searchParams.get('activity') as any) || undefined,
    signupAfter: args.url.searchParams.get('signupAfter') || undefined,
    signupBefore: args.url.searchParams.get('signupBefore') || undefined,
    sort: (args.url.searchParams.get('sort') as any) || undefined,
  };

  const { sql, params: bindParams } = buildUsersListQuery(params);
  const { results } = await args.env.DB.prepare(sql).bind(...bindParams).all();

  // Fetch last_sign_in_at from Supabase Auth admin API for THIS PAGE only.
  // Batch by listing users (up to 200/page) — for v1, just fetch each row.
  // Optimization deferred to performance task in spec.
  const enriched = await enrichWithLastSignIn(results, args.env);

  // Apply activity filter post-fetch (it depends on Supabase data we can't JOIN).
  const filtered = filterByActivity(enriched, params.activity);

  return json(200, {
    users: filtered,
    page: { limit, offset, returned: filtered.length },
  });
}

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GHOST_WINDOW_MS = 5 * 60 * 1000;

async function enrichWithLastSignIn(rows: any[], env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }) {
  if (rows.length === 0) return rows;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return rows.map((r) => ({ ...r, last_sign_in_at: null, is_active: false }));
  }
  // Bulk fetch users 1-by-1 via admin API (Supabase doesn't support batch
  // get-by-ids; use list users with email filter, or accept N requests).
  const enriched = await Promise.all(rows.map(async (r) => {
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users/${r.id}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    const lastSignInAt = res.ok ? (await res.json() as any).last_sign_in_at : null;
    const isActive = computeIsActive(r, lastSignInAt);
    return { ...r, last_sign_in_at: lastSignInAt, is_active: isActive };
  }));
  return enriched;
}

function computeIsActive(row: any, lastSignInAt: string | null): boolean {
  if (row.deleted_at) return false;
  if (row.recipe_count < 1) return false;
  if (!lastSignInAt) return false;
  const ageMs = Date.now() - new Date(lastSignInAt).getTime();
  return ageMs <= ACTIVE_WINDOW_MS;
}

function classifyActivity(row: any, lastSignInAt: string | null): 'active' | 'inactive' | 'ghost' | 'soft_deleted' {
  if (row.deleted_at) return 'soft_deleted';
  const signupTime = new Date(row.signed_up_at).getTime();
  const lastSignInTime = lastSignInAt ? new Date(lastSignInAt).getTime() : signupTime;
  const cameBack = (lastSignInTime - signupTime) > GHOST_WINDOW_MS;
  if (row.recipe_count === 0 && !cameBack) return 'ghost';
  if (computeIsActive(row, lastSignInAt)) return 'active';
  return 'inactive';
}

function filterByActivity(rows: any[], activity: UsersListParams['activity']) {
  if (!activity) return rows;
  return rows.filter((r) => classifyActivity(r, r.last_sign_in_at) === activity);
}
```

- [ ] **Step 6: Wire route in index.ts**

Add to the route dispatch in `index.ts`:

```typescript
if (url.pathname === '/admin/users' && request.method === 'GET') {
  const { handleAdminUsersList } = await import('./routes/admin');
  return await handleAdminUsersList({ env, user, adminEmails: env.ADMIN_EMAILS, url });
}
```

- [ ] **Step 7: Run worker tests**

Run: `cd apps/worker && npm test`
Expected: PASS.

- [ ] **Step 8: Smoke test**

Worker running on :8787. Curl with admin token (after seeding `dev@example.com` into ADMIN_EMAILS temporarily):
```bash
curl -i -H "Authorization: Bearer <DEV_API_KEY>" http://localhost:8787/admin/users?limit=5
```
Expected: 200 with `{"users": [...], "page": {...}}`.

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): GET /admin/users with filters + activity classification"
```

---

### Task 11: Users page (frontend) with TanStack Table

**Files:**
- Create: `apps/admin-ui/src/pages/Users.jsx`
- Modify: `apps/admin-ui/src/App.jsx` (add routing)

- [ ] **Step 1: Stub the other pages so App.jsx imports work**

Create stub files:

`apps/admin-ui/src/pages/Dashboard.jsx`:
```javascript
import { Typography } from '@mui/material';
export default function Dashboard() {
  return <Typography variant="h4">Dashboard (TODO)</Typography>;
}
```

`apps/admin-ui/src/pages/UserDrilldown.jsx`:
```javascript
import { Typography } from '@mui/material';
export default function UserDrilldown({ id }) {
  return <Typography variant="h4">User {id} (TODO)</Typography>;
}
```

`apps/admin-ui/src/pages/AuditLog.jsx`:
```javascript
import { Typography } from '@mui/material';
export default function AuditLog() {
  return <Typography variant="h4">Audit log (TODO)</Typography>;
}
```

`apps/admin-ui/src/components/SidebarNav.jsx`:
```javascript
import { Box, Button, List, ListItemButton, ListItemText, Typography } from '@mui/material';

export default function SidebarNav({ email, signOut }) {
  const nav = (path) => () => { window.location.hash = path; };
  return (
    <Box sx={{ width: 220, borderRight: 1, borderColor: 'divider', p: 2 }}>
      <Typography variant="h6" gutterBottom>ReciFriend Admin</Typography>
      <List>
        <ListItemButton onClick={nav('#/')}><ListItemText primary="Dashboard" /></ListItemButton>
        <ListItemButton onClick={nav('#/users')}><ListItemText primary="Users" /></ListItemButton>
        <ListItemButton onClick={nav('#/audit-log')}><ListItemText primary="Audit log" /></ListItemButton>
      </List>
      <Box sx={{ position: 'absolute', bottom: 16, left: 16, fontSize: 12 }}>
        <Typography variant="caption" display="block">{email}</Typography>
        <Button size="small" onClick={signOut}>Sign out</Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Add hash-based routing to App.jsx**

Now that the stub pages exist, replace the body-rendering block of `App.jsx` (the `return ( <Box sx={{ p: 4 }}>...` part — the final return inside the `App` component) with:

```javascript
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarNav signOut={signOut} email={check.email} />
      <Box sx={{ flex: 1, p: 4 }}>
        <Router />
      </Box>
    </Box>
  );
}

function Router() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash.startsWith('#/users/')) {
    const id = hash.slice('#/users/'.length);
    return <UserDrilldown id={id} />;
  }
  if (hash === '#/users') return <Users />;
  if (hash === '#/audit-log') return <AuditLog />;
  return <Dashboard />;
}
```

Add the imports near the top:
```javascript
import SidebarNav from './components/SidebarNav';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDrilldown from './pages/UserDrilldown';
import AuditLog from './pages/AuditLog';
```

- [ ] **Step 3: Implement the Users page with TanStack Table + filters**

Replace `apps/admin-ui/src/pages/Users.jsx`:

```javascript
import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, MenuItem, Select, TextField, Typography,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress
} from '@mui/material';
import {
  useReactTable, getCoreRowModel, flexRender,
} from '@tanstack/react-table';
import { fetchAdmin } from '../api';

const RECIPE_BUCKETS = [
  { v: '', label: 'All recipes' },
  { v: '0', label: '0' },
  { v: '1-9', label: '1–9' },
  { v: '10-19', label: '10–19' },
  { v: '20-49', label: '20–49' },
  { v: '50+', label: '50+' },
];
const ACTIVITY_OPTIONS = [
  { v: '', label: 'All activity' },
  { v: 'active', label: 'Active' },
  { v: 'inactive', label: 'Inactive' },
  { v: 'ghost', label: 'Signup-only ghost' },
  { v: 'soft_deleted', label: 'Soft-deleted' },
];
const SIGNUP_OPTIONS = [
  { v: '', label: 'All time' },
  { v: '1', label: 'Today' },
  { v: '7', label: 'Last 7d' },
  { v: '30', label: 'Last 30d' },
  { v: '90', label: 'Last 90d' },
];

const PAGE_SIZE = 50;

export default function Users() {
  const [search, setSearch] = useState('');
  const [recipeBucket, setRecipeBucket] = useState('');
  const [activity, setActivity] = useState('');
  const [signupDays, setSignupDays] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ users: [], page: { returned: 0 } });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    if (search) params.set('search', search);
    if (recipeBucket) params.set('recipeBucket', recipeBucket);
    if (activity) params.set('activity', activity);
    if (signupDays) {
      const after = new Date(Date.now() - Number(signupDays) * 86400000).toISOString();
      params.set('signupAfter', after);
    }
    fetchAdmin(`/admin/users?${params.toString()}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [search, recipeBucket, activity, signupDays, page]);

  const columns = useMemo(() => [
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'signed_up_at', header: 'Signed up',
      cell: (i) => new Date(i.getValue()).toLocaleDateString() },
    { accessorKey: 'recipe_count', header: 'Recipes' },
    { accessorKey: 'invites_sent', header: 'Sent' },
    { accessorKey: 'invites_accepted', header: 'Acc' },
    { id: 'active', header: '', cell: (i) => i.row.original.is_active ? '●' : '○' },
  ], []);

  const table = useReactTable({
    data: data.users, columns, getCoreRowModel: getCoreRowModel(),
  });

  const exportCsv = () => {
    const params = new URLSearchParams();
    params.set('limit', '5000');
    if (search) params.set('search', search);
    if (recipeBucket) params.set('recipeBucket', recipeBucket);
    if (activity) params.set('activity', activity);
    fetchAdmin(`/admin/users?${params.toString()}`).then((all) => {
      const headers = ['email', 'signed_up_at', 'recipe_count', 'invites_sent', 'invites_accepted', 'is_active'];
      const rows = all.users.map((u) => headers.map((h) => JSON.stringify(u[h] ?? '')).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `recifriend-users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Users</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Search email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <Select size="small" value={recipeBucket} onChange={(e) => { setRecipeBucket(e.target.value); setPage(0); }}>
          {RECIPE_BUCKETS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Select size="small" value={activity} onChange={(e) => { setActivity(e.target.value); setPage(0); }}>
          {ACTIVITY_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Select size="small" value={signupDays} onChange={(e) => { setSignupDays(e.target.value); setPage(0); }}>
          {SIGNUP_OPTIONS.map((b) => <MenuItem key={b.v} value={b.v}>{b.label}</MenuItem>)}
        </Select>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={exportCsv}>Export CSV</Button>
      </Box>

      {loading && <CircularProgress size={20} />}

      <Table size="small">
        <TableHead>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableCell key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} hover sx={{ cursor: 'pointer' }}
              onClick={() => { window.location.hash = `#/users/${row.original.id}`; }}>
              {row.getVisibleCells().map((c) => (
                <TableCell key={c.id}>{flexRender(c.column.columnDef.cell ?? c.column.columnDef.accessorKey, c.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
        <Typography>Page {page + 1}</Typography>
        <Button disabled={data.page.returned < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Build admin-ui locally**

Run: `cd apps/admin-ui && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Smoke test against local worker**

Worker on :8787, admin-ui on :5174. Open `http://localhost:5174/#/users`.
Expected: Sidebar nav, "Users" page with filter row + table populated from D1.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-ui/src
git commit -m "feat(admin-ui): users page with filters, TanStack Table, CSV export"
```

---

## Phase 4 — Visibility: drill-down

### Task 12: GET /admin/users/:id

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write failing test**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { handleAdminUserDrilldown } from './admin';

describe('handleAdminUserDrilldown', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminUserDrilldown({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'intruder@example.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target-user',
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when user not found', async () => {
    const firstMock = vi.fn().mockResolvedValue(null);
    const allMock = vi.fn().mockResolvedValue({ results: [] });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: firstMock,
        all: allMock,
      }),
    } as unknown as D1Database;

    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'missing-user',
    });
    expect(res.status).toBe(404);
  });

  it('returns full payload for an existing user', async () => {
    const profile = { user_id: 'target', email: 't@x.com', display_name: 'T', created_at: '2026-01-01', deleted_at: null };
    const recipes = [{ id: 'r1', title: 'Pie', created_at: '2026-02-01', hidden_at: null }];
    const cookEvents = [{ recipe_id: 'r1', created_at: '2026-02-02' }];
    const invitesSent = [{ to_user_id: 'inv1', to_email: 'inv@x.com', status: 'accepted', created_at: '2026-01-15' }];
    const pendingReceived = [{ from_user_id: 'src1', from_email: 's@x.com', created_at: '2026-02-10' }];

    let callIdx = 0;
    const stubs = [profile, { results: recipes }, { results: cookEvents }, { results: invitesSent }, { results: pendingReceived }];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
        all: vi.fn().mockImplementation(() => Promise.resolve(stubs[callIdx++])),
      }),
    } as unknown as D1Database;

    const res = await handleAdminUserDrilldown({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: undefined },
      user: { userId: 'u-1', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'target',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.email).toBe('t@x.com');
    expect(body.recipes).toHaveLength(1);
    expect(body.invites_sent).toHaveLength(1);
    expect(body.pending_received).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — `handleAdminUserDrilldown is not exported`.

- [ ] **Step 3: Implement `handleAdminUserDrilldown`**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export async function handleAdminUserDrilldown(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  // 1. Profile (admin can view soft-deleted users)
  const profile = await args.env.DB.prepare(
    `SELECT user_id, email, display_name, created_at, deleted_at
     FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first();
  if (!profile) return json(404, { code: 'NOT_FOUND' });

  // 2. Recipes
  const recipes = await args.env.DB.prepare(
    `SELECT id, title, created_at, hidden_at
     FROM recipes WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(args.userId).all();

  // 3. Last 20 cook events
  const cookEvents = await args.env.DB.prepare(
    `SELECT recipe_id, created_at
     FROM cook_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(args.userId).all();

  // 4. Invites sent: friends rows where this user is the user_id (= they sent
  // and the other party accepted), plus pending friend_requests they originated.
  // The schema doesn't directly track "this user sent to that user" in a single
  // table — friends covers accepted, friend_requests_sent covers all sent.
  const sent = await args.env.DB.prepare(
    `SELECT frs.to_user_id, p.email AS to_email, p.deleted_at,
            CASE WHEN f.user_id IS NOT NULL THEN 'accepted' ELSE 'pending' END AS status,
            COALESCE(f.connected_at, '') AS accepted_at
     FROM friend_requests_sent frs
     LEFT JOIN profiles p ON p.user_id = frs.to_user_id
     LEFT JOIN friends f ON f.user_id = frs.from_user_id AND f.friend_id = frs.to_user_id
     WHERE frs.from_user_id = ?
     ORDER BY accepted_at DESC`
  ).bind(args.userId).all();

  // 5. Pending invites received
  const pendingReceived = await args.env.DB.prepare(
    `SELECT fr.from_user_id, fr.from_email, fr.created_at
     FROM friend_requests fr
     WHERE fr.to_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  ).bind(args.userId).all();

  // Enrich invitees with recipe count + last_sign_in
  const invitees = await Promise.all((sent.results || []).map(async (row: any) => {
    const rc = await args.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM recipes WHERE user_id = ?`
    ).bind(row.to_user_id).first() as { c: number };
    let lastSignInAt: string | null = null;
    if (args.env.SUPABASE_SERVICE_ROLE_KEY && row.to_user_id) {
      const r = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/users/${row.to_user_id}`, {
        headers: {
          Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      if (r.ok) lastSignInAt = (await r.json() as any).last_sign_in_at;
    }
    return { ...row, recipe_count: rc?.c || 0, last_sign_in_at: lastSignInAt };
  }));

  return json(200, {
    profile,
    recipes: recipes.results || [],
    cook_events: cookEvents.results || [],
    invites_sent: invitees,
    pending_received: pendingReceived.results || [],
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire route**

Add to `index.ts` route dispatch:

```typescript
const adminUserDrilldownMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/);
if (adminUserDrilldownMatch && request.method === 'GET') {
  const { handleAdminUserDrilldown } = await import('./routes/admin');
  return await handleAdminUserDrilldown({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminUserDrilldownMatch[1]
  });
}
```

(Place this BEFORE any catch-all `/admin/users` GET route.)

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): GET /admin/users/:id drill-down endpoint"
```

---

### Task 13: User drill-down page (read-only)

**Files:**
- Modify: `apps/admin-ui/src/pages/UserDrilldown.jsx`

- [ ] **Step 1: Replace the stub with the full read-only drill-down**

Replace `apps/admin-ui/src/pages/UserDrilldown.jsx`:

```javascript
import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Typography,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import { fetchAdmin } from '../api';

export default function UserDrilldown({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = () => {
    setData(null); setError(null);
    fetchAdmin(`/admin/users/${id}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(reload, [id]);

  if (error) return <Typography color="error">{error}</Typography>;
  if (!data) return <CircularProgress />;

  const p = data.profile;

  return (
    <Box>
      <Button onClick={() => { window.location.hash = '#/users'; }}>← Back to users</Button>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
        <Typography variant="h5">{p.email}</Typography>
        {p.deleted_at && <Chip label="Soft-deleted" color="warning" />}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Signed up {new Date(p.created_at).toLocaleDateString()} · {data.recipes.length} recipes
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Stack direction="row" spacing={4} alignItems="flex-start">
        <Section title={`Recipes (${data.recipes.length})`} sx={{ flex: 1 }}>
          {data.recipes.slice(0, 50).map((r) => (
            <Stack key={r.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <Typography variant="body2">{r.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(r.created_at).toLocaleDateString()}
                {r.hidden_at && ' · hidden'}
              </Typography>
            </Stack>
          ))}
        </Section>

        <Section title={`Cook events (last ${data.cook_events.length})`} sx={{ flex: 1 }}>
          {data.cook_events.map((e, i) => (
            <Typography variant="body2" key={i}>
              {new Date(e.created_at).toLocaleString()} — {e.recipe_id}
            </Typography>
          ))}
        </Section>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Section title={`Invites sent (${data.invites_sent.length})`}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invitee</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Recipes</TableCell>
              <TableCell>Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.invites_sent.map((iv) => (
              <TableRow key={iv.to_user_id}>
                <TableCell>{iv.to_email || iv.to_user_id}</TableCell>
                <TableCell>{iv.status}</TableCell>
                <TableCell>{iv.recipe_count}</TableCell>
                <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Pending invites received (${data.pending_received.length})`}>
        {data.pending_received.map((pi, i) => (
          <Typography variant="body2" key={i}>
            {pi.from_email} — sent {new Date(pi.created_at).toLocaleDateString()}
          </Typography>
        ))}
      </Section>
    </Box>
  );
}

function Section({ title, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2, ...sx }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      {children}
    </Paper>
  );
}
```

- [ ] **Step 2: Smoke test**

Open `http://localhost:5174/#/users`, click any row.
Expected: drill-down loads with profile + recipes + cook events + invites + pending invites.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-ui/src/pages/UserDrilldown.jsx
git commit -m "feat(admin-ui): user drill-down page (read-only sections)"
```

---

## Phase 5 — Visibility: trend charts

### Task 14: GET /admin/metrics/timeseries

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write failing test for timeseries SQL builders**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { buildSignupsPerDayQuery, buildViralCoefWeeklyQuery } from './admin';

describe('buildSignupsPerDayQuery', () => {
  it('groups by date and applies a since-date filter', () => {
    const { sql, params } = buildSignupsPerDayQuery(90);
    expect(sql).toMatch(/GROUP BY DATE\(created_at\)/i);
    expect(sql).toMatch(/created_at >= \?/);
    expect(params).toHaveLength(1);
  });
});

describe('buildViralCoefWeeklyQuery', () => {
  it('produces SQL with weekly buckets', () => {
    const { sql } = buildViralCoefWeeklyQuery(90);
    expect(sql).toMatch(/strftime\('%Y-%W', /i);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement timeseries handler**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export function buildSignupsPerDayQuery(days: number): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return {
    sql: `SELECT DATE(created_at) AS day, COUNT(*) AS n
          FROM profiles WHERE created_at >= ? AND deleted_at IS NULL
          GROUP BY DATE(created_at) ORDER BY day ASC`,
    params: [since],
  };
}

export function buildViralCoefWeeklyQuery(days: number): BuiltQuery {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return {
    sql: `
      WITH weekly_signups AS (
        SELECT strftime('%Y-%W', created_at) AS wk, COUNT(*) AS signups
        FROM profiles WHERE created_at >= ? AND deleted_at IS NULL
        GROUP BY wk
      ),
      weekly_accepts AS (
        SELECT strftime('%Y-%W', connected_at) AS wk, COUNT(DISTINCT user_id || '|' || friend_id) / 2 AS accepts
        FROM friends WHERE connected_at >= ?
        GROUP BY wk
      )
      SELECT s.wk AS week, s.signups, COALESCE(a.accepts, 0) AS accepts,
             CASE WHEN s.signups > 0 THEN ROUND(1.0 * COALESCE(a.accepts, 0) / s.signups, 3) ELSE 0 END AS viral_coef
      FROM weekly_signups s LEFT JOIN weekly_accepts a ON a.wk = s.wk
      ORDER BY s.wk ASC
    `.trim(),
    params: [since, since],
  };
}

export async function handleAdminMetricsTimeseries(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const days = Math.min(parseInt(args.url.searchParams.get('days') || '90', 10), 365);

  const sQ = buildSignupsPerDayQuery(days);
  const vQ = buildViralCoefWeeklyQuery(days);

  const [signups, viral, totals, recipeTotals] = await Promise.all([
    args.env.DB.prepare(sQ.sql).bind(...sQ.params).all(),
    args.env.DB.prepare(vQ.sql).bind(...vQ.params).all(),
    args.env.DB.prepare(
      `SELECT COUNT(*) AS total_users FROM profiles WHERE deleted_at IS NULL`
    ).first(),
    args.env.DB.prepare(`SELECT COUNT(*) AS total_recipes FROM recipes`).first(),
  ]);

  // Activation curve (cohort): per signup-week, % of users in cohort with >=1 recipe
  const activation = await args.env.DB.prepare(`
    WITH cohort AS (
      SELECT p.user_id, strftime('%Y-%W', p.created_at) AS wk
      FROM profiles p WHERE p.deleted_at IS NULL AND p.created_at >= ?
    ),
    has_recipe AS (
      SELECT DISTINCT user_id FROM recipes
    )
    SELECT c.wk AS week, COUNT(c.user_id) AS cohort_size,
           SUM(CASE WHEN hr.user_id IS NOT NULL THEN 1 ELSE 0 END) AS activated,
           ROUND(100.0 * SUM(CASE WHEN hr.user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(c.user_id), 1) AS pct
    FROM cohort c LEFT JOIN has_recipe hr ON hr.user_id = c.user_id
    GROUP BY c.wk ORDER BY c.wk ASC
  `).bind(new Date(Date.now() - days * 86400000).toISOString()).all();

  // Loop completion: per cohort week, % who sent >=1 invite within 7d
  // Approximation — joins friend_requests_sent without timestamp constraint;
  // friend_requests_sent has no created_at. Approximate via friends table.
  // For v1 we use "sent any invite ever" as a coarser proxy.
  const loopCompletion = await args.env.DB.prepare(`
    WITH cohort AS (
      SELECT p.user_id, strftime('%Y-%W', p.created_at) AS wk
      FROM profiles p WHERE p.deleted_at IS NULL AND p.created_at >= ?
    ),
    has_invite AS (
      SELECT DISTINCT from_user_id AS user_id FROM friend_requests_sent
    )
    SELECT c.wk AS week, COUNT(c.user_id) AS cohort_size,
           SUM(CASE WHEN hi.user_id IS NOT NULL THEN 1 ELSE 0 END) AS invited,
           ROUND(100.0 * SUM(CASE WHEN hi.user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(c.user_id), 1) AS pct
    FROM cohort c LEFT JOIN has_invite hi ON hi.user_id = c.user_id
    GROUP BY c.wk ORDER BY c.wk ASC
  `).bind(new Date(Date.now() - days * 86400000).toISOString()).all();

  // Active users count — approximated as (users with >=1 recipe). The full
  // "AND signed in within 30d" needs Supabase Auth data which is per-user. For
  // the dashboard tile, use the cheap approximation; the user table is precise.
  const activeApprox = await args.env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM recipes`
  ).first();

  return json(200, {
    signups_per_day: signups.results || [],
    viral_coef_weekly: viral.results || [],
    activation_curve: activation.results || [],
    loop_completion: loopCompletion.results || [],
    totals: {
      total_users: (totals as any)?.total_users ?? 0,
      active_users_approx: (activeApprox as any)?.n ?? 0,
      total_recipes: (recipeTotals as any)?.total_recipes ?? 0,
      latest_viral_coef: (viral.results || []).at(-1) as any,
    },
  });
}
```

- [ ] **Step 4: Run tests + wire route**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS.

Add to `index.ts`:

```typescript
if (url.pathname === '/admin/metrics/timeseries' && request.method === 'GET') {
  const { handleAdminMetricsTimeseries } = await import('./routes/admin');
  return await handleAdminMetricsTimeseries({ env, user, adminEmails: env.ADMIN_EMAILS, url });
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): GET /admin/metrics/timeseries with signups, viral, activation, loop completion"
```

---

### Task 15: Dashboard page with Recharts

**Files:**
- Modify: `apps/admin-ui/src/pages/Dashboard.jsx`

- [ ] **Step 1: Replace the stub with the full dashboard**

Replace `apps/admin-ui/src/pages/Dashboard.jsx`:

```javascript
import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CircularProgress, Grid, MenuItem, Select, Typography,
} from '@mui/material';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar,
} from 'recharts';
import { fetchAdmin } from '../api';

const RANGES = [
  { v: 30, label: '30 days' },
  { v: 90, label: '90 days' },
  { v: 365, label: 'All time' },
];

export default function Dashboard() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetchAdmin(`/admin/metrics/timeseries?days=${days}`).then(setData);
  }, [days]);

  if (!data) return <CircularProgress />;

  const t = data.totals;
  const activePct = t.total_users > 0 ? Math.round(100 * t.active_users_approx / t.total_users) : 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ flex: 1 }}>Dashboard</Typography>
        <Select size="small" value={days} onChange={(e) => setDays(e.target.value)}>
          {RANGES.map((r) => <MenuItem key={r.v} value={r.v}>{r.label}</MenuItem>)}
        </Select>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Tile title="Total users" value={t.total_users} />
        <Tile title="Active users" value={`${t.active_users_approx} (${activePct}%)`} />
        <Tile title="Viral coefficient" value={t.latest_viral_coef?.viral_coef?.toFixed(2) ?? '—'} />
        <Tile title="Total recipes" value={t.total_recipes} />
      </Grid>

      <ChartCard title="Signups per day">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.signups_per_day}>
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="n" stroke="#6200EA" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Grid container spacing={2}>
        <Grid item xs={6}>
          <ChartCard title="Activation curve (% with ≥1 recipe by signup week)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.activation_curve}>
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="pct" fill="#6200EA" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid item xs={6}>
          <ChartCard title="Viral loop completion (% who invited a friend)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.loop_completion}>
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="pct" fill="#00BCD4" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>

      <ChartCard title="Viral coefficient over time (weekly)" sx={{ mt: 2 }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.viral_coef_weekly}>
            <XAxis dataKey="week" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="viral_coef" stroke="#6200EA" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </Box>
  );
}

function Tile({ title, value }) {
  return (
    <Grid item xs={3}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="caption" color="text.secondary">{title}</Typography>
          <Typography variant="h4">{value}</Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

function ChartCard({ title, children, sx }) {
  return (
    <Card variant="outlined" sx={{ mb: 2, ...sx }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Smoke test**

Open `http://localhost:5174/#/`. Expected: dashboard with 4 tiles + 4 charts populated.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-ui/src/pages/Dashboard.jsx
git commit -m "feat(admin-ui): dashboard with big-number tiles + Recharts trend charts"
```

---

## Phase 6 — Support actions

### Task 16: POST /admin/users/:id/resend-invite

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Locate the existing email-send helper**

Run: `cd apps/worker && grep -n "resend\|sendFriendInviteEmail\|sendInviteEmail\|RESEND_API_KEY" src/index.ts | head`

Identify the function that fires the friend-invite email. The resend-invite handler will reuse it.

- [ ] **Step 2: Write failing test**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { handleAdminResendInvite } from './admin';

describe('handleAdminResendInvite', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminResendInvite({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if invite does not exist', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
      }),
    } as unknown as D1Database;
    const res = await handleAdminResendInvite({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'missing' },
    });
    expect(res.status).toBe(404);
  });

  it('writes an audit log entry on success', async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const firstMock = vi.fn().mockResolvedValue({ to_email: 'invitee@x.com' });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: firstMock, run: runMock,
      }),
    } as unknown as D1Database;
    // Stub the email send via a hook (see implementation).
    const emailSends: any[] = [];
    const res = await handleAdminResendInvite({
      env: { DB: mockDb, RESEND_API_KEY: 're_test' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
      sendEmail: async (params: any) => { emailSends.push(params); return { ok: true }; },
    });
    expect(res.status).toBe(200);
    expect(emailSends).toHaveLength(1);
    // Verify audit log was attempted (the SECOND prepare call after the SELECT)
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'));
  });
});
```

- [ ] **Step 3: Verify test fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement handler**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export interface SendEmailFn {
  (params: { to: string; subject: string; html: string }): Promise<{ ok: boolean }>;
}

async function defaultSendEmail(env: { RESEND_API_KEY?: string }, params: { to: string; subject: string; html: string }) {
  if (!env.RESEND_API_KEY) return { ok: false };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ReciFriend <hello@recifriend.com>',
      to: params.to, subject: params.subject, html: params.html,
    }),
  });
  return { ok: res.ok };
}

export async function handleAdminResendInvite(args: {
  env: { DB: D1Database; RESEND_API_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
  body: { inviteId: string };
  sendEmail?: SendEmailFn;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const invite = await args.env.DB.prepare(
    `SELECT to_email FROM friend_requests_sent WHERE from_user_id = ? AND to_user_id = ?`
  ).bind(args.userId, args.body.inviteId).first() as { to_email?: string } | null;

  if (!invite || !invite.to_email) return json(404, { code: 'NOT_FOUND' });

  const send = args.sendEmail || ((p) => defaultSendEmail(args.env, p));
  await send({
    to: invite.to_email,
    subject: 'You have an invite waiting on ReciFriend',
    html: `<p>Your friend invited you to ReciFriend. <a href="https://recifriend.com">Open ReciFriend</a></p>`,
  });

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'resend_invite',
    targetUserId: args.userId,
    payload: { inviteId: args.body.inviteId, to_email: invite.to_email },
  });

  return json(200, { ok: true });
}
```

- [ ] **Step 5: Wire route + run tests**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS.

Add to `index.ts`:

```typescript
const adminResendMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/resend-invite$/);
if (adminResendMatch && request.method === 'POST') {
  const { handleAdminResendInvite } = await import('./routes/admin');
  const body = await request.json();
  return await handleAdminResendInvite({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminResendMatch[1], body
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): POST /admin/users/:id/resend-invite + audit logging"
```

---

### Task 17: POST /admin/users/:id/force-accept

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Identify the existing accept handler**

Run: `cd apps/worker && grep -n "INSERT INTO friends\|friend_requests.*accept" src/index.ts | head -10`

Identify the SQL block that inserts the bilateral friend rows (around line 3114-3120 per the earlier grep). Extract the pure DB-mutation portion into a helper `acceptFriendRequest({ db, fromUserId, toUserId, fromName, fromEmail, toName, toEmail })` exported from `index.ts` or a new shared module — and have the existing accept handler call it. Then `force-accept` reuses the same helper.

If the existing code is too tangled to extract cleanly, **inline the needed INSERTs into the admin handler with a comment pointing at the original line**, and file a follow-up cleanup task.

- [ ] **Step 2: Write failing test**

Append to `apps/worker/src/routes/admin.test.ts`:

```typescript
import { handleAdminForceAccept } from './admin';

describe('handleAdminForceAccept', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminForceAccept({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'inv1' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if friend_request not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;
    const res = await handleAdminForceAccept({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'missing' },
    });
    expect(res.status).toBe(404);
  });

  it('inserts bilateral friend rows on success and audit logs', async () => {
    const calls: string[] = [];
    const firstMock = vi.fn().mockResolvedValueOnce({
      from_user_id: 'src', to_user_id: 't',
      from_email: 's@x.com', from_name: 'Src',
      to_email: 't@x.com',
    }).mockResolvedValue({ display_name: 'Target' }); // for the to-user profile lookup
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), first: firstMock, run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;

    const res = await handleAdminForceAccept({
      env: { DB: mockDb } as any,
      user: { userId: 'admin', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { inviteId: 'src' },
    });
    expect(res.status).toBe(200);
    const inserts = calls.filter((s) => /INSERT INTO friends/i.test(s));
    expect(inserts.length).toBe(2); // bilateral
    expect(calls.some((s) => /INSERT INTO admin_audit_log/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 3: Verify test fails**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement handler**

Append to `apps/worker/src/routes/admin.ts`:

```typescript
export async function handleAdminForceAccept(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;             // the user whose pending invite is being accepted
  body: { inviteId: string }; // the from_user_id of the friend_request
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  // Look up the friend_request row (could be inbound to args.userId from inviteId,
  // or outbound from args.userId to inviteId). Try inbound first.
  const inbound = await args.env.DB.prepare(
    `SELECT to_user_id, from_user_id, from_email, from_name, to_email
     FROM friend_requests
     WHERE to_user_id = ? AND from_user_id = ? AND status = 'pending'`
  ).bind(args.userId, args.body.inviteId).first() as any;

  if (!inbound) return json(404, { code: 'NOT_FOUND' });

  // Get the to-user's display name for the friend row.
  const toProfile = await args.env.DB.prepare(
    `SELECT display_name FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as any;

  const now = new Date().toISOString();

  // Insert bilateral friend rows + flip the request status.
  // Pattern mirrors apps/worker/src/index.ts:~3114 (extract into shared helper later).
  await args.env.DB.prepare(
    `INSERT INTO friends (user_id, friend_id, friend_email, friend_name, connected_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(inbound.to_user_id, inbound.from_user_id, inbound.from_email, inbound.from_name, now).run();

  await args.env.DB.prepare(
    `INSERT INTO friends (user_id, friend_id, friend_email, friend_name, connected_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(inbound.from_user_id, inbound.to_user_id, inbound.to_email, toProfile?.display_name || '', now).run();

  await args.env.DB.prepare(
    `UPDATE friend_requests SET status = 'accepted'
     WHERE to_user_id = ? AND from_user_id = ?`
  ).bind(args.userId, args.body.inviteId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'force_accept',
    targetUserId: args.userId,
    payload: { inviteId: args.body.inviteId, from_user_id: inbound.from_user_id },
  });

  return json(200, { ok: true });
}
```

- [ ] **Step 5: Wire route + tests**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS.

Add to `index.ts`:

```typescript
const adminForceAcceptMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/force-accept$/);
if (adminForceAcceptMatch && request.method === 'POST') {
  const { handleAdminForceAccept } = await import('./routes/admin');
  const body = await request.json();
  return await handleAdminForceAccept({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminForceAcceptMatch[1], body
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): POST /admin/users/:id/force-accept"
```

---

### Task 18: POST /admin/users/:id/magic-link

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write failing test**

Append:

```typescript
import { handleAdminMagicLink } from './admin';

describe('handleAdminMagicLink', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminMagicLink({
      env: { DB: {} as any, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 if user not found', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database;
    const res = await handleAdminMagicLink({
      env: { DB: mockDb, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 'missing',
    });
    expect(res.status).toBe(404);
  });

  it('calls Supabase generateLink and returns the URL', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ email: 't@x.com' }),
        run: vi.fn().mockResolvedValue({}),
      }),
    } as unknown as D1Database;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ properties: { action_link: 'https://example.com/magiclink-abc' } }),
    }) as any;

    const res = await handleAdminMagicLink({
      env: { DB: mockDb, SUPABASE_URL: 'https://sb.example.com', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('magiclink');
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Append:

```typescript
export async function handleAdminMagicLink(args: {
  env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;
  if (!args.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { code: 'CONFIG' });

  const profile = await args.env.DB.prepare(
    `SELECT email FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as { email?: string } | null;
  if (!profile?.email) return json(404, { code: 'NOT_FOUND' });

  const res = await fetch(`${args.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: args.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: profile.email }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json(500, { code: 'SUPABASE_ERROR', detail: text });
  }
  const body = await res.json() as any;
  const url = body.properties?.action_link || body.action_link;

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'generate_magic_link',
    targetUserId: args.userId,
    payload: { email: profile.email },
  });

  return json(200, { url, email: profile.email });
}
```

- [ ] **Step 4: Wire + commit**

Run tests, then add to `index.ts`:

```typescript
const adminMagicLinkMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/magic-link$/);
if (adminMagicLinkMatch && request.method === 'POST') {
  const { handleAdminMagicLink } = await import('./routes/admin');
  return await handleAdminMagicLink({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminMagicLinkMatch[1]
  });
}
```

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): POST /admin/users/:id/magic-link via Supabase admin API"
```

---

### Task 19: PATCH /admin/users/:id (display name)

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { handleAdminEditUser } from './admin';

describe('handleAdminEditUser', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminEditUser({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: 'X' },
    });
    expect(res.status).toBe(403);
  });

  it('updates display_name and audit logs', async () => {
    const captured: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        captured.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ display_name: 'OldName' }),
          run: vi.fn().mockResolvedValue({}),
        };
      }),
    } as unknown as D1Database;
    const res = await handleAdminEditUser({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: 'NewName' },
    });
    expect(res.status).toBe(200);
    expect(captured.some((s) => /UPDATE profiles SET display_name/i.test(s))).toBe(true);
    expect(captured.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });

  it('returns 400 for empty display_name', async () => {
    const mockDb = { prepare: vi.fn() } as unknown as D1Database;
    const res = await handleAdminEditUser({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't', body: { display_name: '' },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Verify failure, then implement**

```typescript
export async function handleAdminEditUser(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
  body: { display_name?: string };
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const newName = (args.body.display_name || '').trim();
  if (!newName) return json(400, { code: 'BAD_REQUEST', message: 'display_name required' });
  if (newName.length > 100) return json(400, { code: 'BAD_REQUEST', message: 'display_name too long' });

  const before = await args.env.DB.prepare(
    `SELECT display_name FROM profiles WHERE user_id = ?`
  ).bind(args.userId).first() as { display_name?: string } | null;
  if (!before) return json(404, { code: 'NOT_FOUND' });

  await args.env.DB.prepare(
    `UPDATE profiles SET display_name = ? WHERE user_id = ?`
  ).bind(newName, args.userId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'edit_profile',
    targetUserId: args.userId,
    payload: { field: 'display_name', from: before.display_name, to: newName },
  });

  return json(200, { ok: true, display_name: newName });
}
```

- [ ] **Step 3: Wire + commit**

```typescript
const adminEditUserMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/);
if (adminEditUserMatch && request.method === 'PATCH') {
  const { handleAdminEditUser } = await import('./routes/admin');
  const body = await request.json();
  return await handleAdminEditUser({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminEditUserMatch[1], body
  });
}
```

(Order matters in the dispatch. The GET handler from Task 12 used `const adminUserDrilldownMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/);` and only fired on `request.method === 'GET'`. Add the PATCH branch using the same regex but `request.method === 'PATCH'`, immediately after the GET branch — this keeps the three single-id verbs (GET, PATCH, DELETE) co-located so they don't shadow each other.)

Run tests, commit:

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): PATCH /admin/users/:id for display_name"
```

---

### Task 20: DELETE /admin/users/:id (soft) + refactor existing deleteAccount

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts` (refactor existing deleteAccount)

- [ ] **Step 1: Find the existing deleteAccount**

Run: `cd apps/worker && grep -n "deleteAccount\|DELETE FROM cook_events" src/index.ts | head`

Identify the existing function (around line 1348 per earlier scan).

- [ ] **Step 2: Refactor the existing function to take a mode parameter**

Modify the existing function signature from `deleteAccount(env, userId)` to `deleteAccount(env, userId, mode: 'hard' | 'soft' = 'hard')`. At the top of the function:

```typescript
if (mode === 'soft') {
  await env.DB.prepare(`UPDATE profiles SET deleted_at = ? WHERE user_id = ?`)
    .bind(new Date().toISOString(), userId).run();
  return; // don't touch other tables — soft delete leaves everything else intact
}
// existing hard-delete logic continues below
```

Update all existing callers (the user-initiated delete-my-account flow) to pass `'hard'` explicitly.

- [ ] **Step 3: Write failing test for handleAdminSoftDelete**

```typescript
import { handleAdminSoftDelete } from './admin';

describe('handleAdminSoftDelete', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminSoftDelete({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(403);
  });

  it('sets deleted_at and audit logs', async () => {
    const calls: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminSoftDelete({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      userId: 't',
    });
    expect(res.status).toBe(200);
    expect(calls.some((s) => /UPDATE profiles SET deleted_at/i.test(s))).toBe(true);
    expect(calls.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 4: Implement handler**

```typescript
export async function handleAdminSoftDelete(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  userId: string;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  await args.env.DB.prepare(
    `UPDATE profiles SET deleted_at = ? WHERE user_id = ?`
  ).bind(new Date().toISOString(), args.userId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'soft_delete_user',
    targetUserId: args.userId,
  });

  return json(200, { ok: true });
}
```

- [ ] **Step 5: Wire + commit**

```typescript
const adminDeleteUserMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/);
if (adminDeleteUserMatch && request.method === 'DELETE') {
  const { handleAdminSoftDelete } = await import('./routes/admin');
  return await handleAdminSoftDelete({
    env, user, adminEmails: env.ADMIN_EMAILS, userId: adminDeleteUserMatch[1]
  });
}
```

Run all worker tests: `cd apps/worker && npm test` — Expected: PASS, including any test that exercises the user-initiated delete-my-account flow (verify it still hard-deletes).

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): DELETE /admin/users/:id (soft) + refactor deleteAccount with mode"
```

---

### Task 21: POST /admin/recipes/:id/hide

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.ts` (filter `hidden_at IS NULL` in user-facing recipe queries)

- [ ] **Step 1: Enumerate recipe queries that must filter hidden**

Run: `cd apps/worker && grep -n "FROM recipes" src/index.ts | head -30`

For each match, classify whether it serves user-facing data (public landing, friend feeds, owner's own list).
- The owner's own recipe list (`SELECT * FROM recipes WHERE user_id = ?`) does NOT filter — owner can still see hidden.
- Public/friends-of-friends queries (anything with `shared_with_friends = 1` or in the public/* routes) MUST filter `AND hidden_at IS NULL`.

Apply the filter to those queries.

- [ ] **Step 2: Write failing test for hide handler**

```typescript
import { handleAdminHideRecipe } from './admin';

describe('handleAdminHideRecipe', () => {
  it('403 for non-admin', async () => {
    const res = await handleAdminHideRecipe({
      env: { DB: {} as any } as any,
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1', body: {},
    });
    expect(res.status).toBe(403);
  });

  it('updates hidden_at and audit logs', async () => {
    const calls: string[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        calls.push(sql);
        return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
      }),
    } as unknown as D1Database;
    const res = await handleAdminHideRecipe({
      env: { DB: mockDb } as any,
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      recipeId: 'r1', body: { reason: 'nsfw' },
    });
    expect(res.status).toBe(200);
    expect(calls.some((s) => /UPDATE recipes SET hidden_at/i.test(s))).toBe(true);
    expect(calls.some((s) => /admin_audit_log/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 3: Implement handler**

```typescript
export async function handleAdminHideRecipe(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  recipeId: string;
  body: { reason?: string };
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  await args.env.DB.prepare(
    `UPDATE recipes SET hidden_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), args.recipeId).run();

  await writeAuditLog(args.env.DB, {
    adminEmail: args.user.email!,
    action: 'hide_recipe',
    targetRecipeId: args.recipeId,
    payload: args.body.reason ? { reason: args.body.reason } : undefined,
  });

  return json(200, { ok: true });
}
```

- [ ] **Step 4: Wire + run all worker tests**

```typescript
const adminHideRecipeMatch = url.pathname.match(/^\/admin\/recipes\/([^/]+)\/hide$/);
if (adminHideRecipeMatch && request.method === 'POST') {
  const { handleAdminHideRecipe } = await import('./routes/admin');
  const body = await request.json().catch(() => ({}));
  return await handleAdminHideRecipe({
    env, user, adminEmails: env.ADMIN_EMAILS, recipeId: adminHideRecipeMatch[1], body
  });
}
```

Run: `cd apps/worker && npm test`. Expected: PASS.

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts
git commit -m "feat(admin): POST /admin/recipes/:id/hide + filter hidden recipes from public/friend feeds"
```

---

### Task 22: Wire Support actions into UserDrilldown UI

**Files:**
- Modify: `apps/admin-ui/src/pages/UserDrilldown.jsx`
- Create: `apps/admin-ui/src/components/ConfirmModal.jsx`

- [ ] **Step 1: Build ConfirmModal**

Write `apps/admin-ui/src/components/ConfirmModal.jsx`:

```javascript
import { useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography } from '@mui/material';

export default function ConfirmModal({ open, title, body, confirmLabel = 'Confirm', destructive = false, onConfirm, onClose }) {
  const [sure, setSure] = useState(false);
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{body}</Typography>
        <FormControlLabel
          control={<Checkbox checked={sure} onChange={(e) => setSure(e.target.checked)} />}
          label="I'm sure"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color={destructive ? 'error' : 'primary'}
          variant="contained"
          disabled={!sure}
          onClick={() => { setSure(false); onConfirm(); }}
        >{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add Actions menu + per-row buttons to UserDrilldown**

Edit `apps/admin-ui/src/pages/UserDrilldown.jsx`. After the existing imports add:

```javascript
import { Menu, MenuItem, Snackbar, IconButton, TextField } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ConfirmModal from '../components/ConfirmModal';
```

Add state in the component:

```javascript
  const [anchor, setAnchor] = useState(null);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind, ... }
  const [editName, setEditName] = useState({ open: false, value: '' });
  const [magicLink, setMagicLink] = useState({ open: false, url: '' });

  const post = (path, body) =>
    fetchAdmin(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const patch = (path, body) =>
    fetchAdmin(path, { method: 'PATCH', body: JSON.stringify(body) });
  const del = (path) => fetchAdmin(path, { method: 'DELETE' });

  const doResend = (inviteId) =>
    post(`/admin/users/${id}/resend-invite`, { inviteId })
      .then(() => { setToast('Invite resent'); reload(); });
  const doForceAccept = (inviteId) =>
    post(`/admin/users/${id}/force-accept`, { inviteId })
      .then(() => { setToast('Force-accepted'); reload(); });
  const doMagicLink = () =>
    post(`/admin/users/${id}/magic-link`, {})
      .then((r) => setMagicLink({ open: true, url: r.url }));
  const doEditName = () =>
    patch(`/admin/users/${id}`, { display_name: editName.value })
      .then(() => { setEditName({ open: false, value: '' }); setToast('Name updated'); reload(); });
  const doSoftDelete = () =>
    del(`/admin/users/${id}`).then(() => { setToast('Soft-deleted'); reload(); });
  const doHideRecipe = (rid) =>
    post(`/admin/recipes/${rid}/hide`, {}).then(() => { setToast('Recipe hidden'); reload(); });
```

In the JSX, replace the bare `<Typography variant="h5">{p.email}</Typography>` line with:

```javascript
        <Typography variant="h5">{p.email}</Typography>
        <IconButton onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon /></IconButton>
        <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => { setAnchor(null); setEditName({ open: true, value: p.display_name || '' }); }}>
            Edit display name
          </MenuItem>
          <MenuItem onClick={() => { setAnchor(null); doMagicLink(); }}>
            Send magic link
          </MenuItem>
          <MenuItem onClick={() => { setAnchor(null); setConfirm({ kind: 'soft_delete' }); }}
            sx={{ color: 'error.main' }}>
            Soft-delete account
          </MenuItem>
        </Menu>
```

In the recipes loop, add a Hide button:

```javascript
            <Stack key={r.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
              <Typography variant="body2">{r.title}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  {new Date(r.created_at).toLocaleDateString()}
                  {r.hidden_at && ' · hidden'}
                </Typography>
                {!r.hidden_at && (
                  <Button size="small" onClick={() => setConfirm({ kind: 'hide_recipe', recipeId: r.id, title: r.title })}>
                    Hide
                  </Button>
                )}
              </Stack>
            </Stack>
```

In the invites_sent table body, replace the existing pending-row rendering with action buttons on pending rows:

```javascript
              <TableRow key={iv.to_user_id}>
                <TableCell>{iv.to_email || iv.to_user_id}</TableCell>
                <TableCell>
                  {iv.status}
                  {iv.status === 'pending' && (
                    <>
                      <Button size="small" sx={{ ml: 1 }} onClick={() => doResend(iv.to_user_id)}>Resend</Button>
                      <Button size="small" onClick={() => doForceAccept(iv.to_user_id)}>Force-accept</Button>
                    </>
                  )}
                </TableCell>
                <TableCell>{iv.recipe_count}</TableCell>
                <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
```

At the end of the component, before `</Box>`, add the modals:

```javascript
      <ConfirmModal
        open={confirm?.kind === 'soft_delete'}
        title="Soft-delete this account?"
        body={`User: ${p.email}. They will be hidden from feeds and friend lists immediately. Recipes preserved. Reversible by clearing profiles.deleted_at in D1.`}
        destructive
        confirmLabel="Soft-delete"
        onConfirm={() => { doSoftDelete(); setConfirm(null); }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm?.kind === 'hide_recipe'}
        title={`Hide recipe "${confirm?.title}"?`}
        body="This recipe will be hidden from public landing and friend feeds. Owner can still see it. Reversible by clearing recipes.hidden_at in D1."
        destructive
        confirmLabel="Hide"
        onConfirm={() => { doHideRecipe(confirm.recipeId); setConfirm(null); }}
        onClose={() => setConfirm(null)}
      />
      <Dialog open={editName.open} onClose={() => setEditName({ ...editName, open: false })}>
        <DialogTitle>Edit display name</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth value={editName.value}
            onChange={(e) => setEditName({ ...editName, value: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditName({ open: false, value: '' })}>Cancel</Button>
          <Button variant="contained" onClick={doEditName}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={magicLink.open} onClose={() => setMagicLink({ open: false, url: '' })}>
        <DialogTitle>Magic link</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }} variant="body2">
            Send this URL to the user. It logs them in directly.
          </Typography>
          <TextField fullWidth value={magicLink.url} InputProps={{ readOnly: true }}
            onClick={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { navigator.clipboard.writeText(magicLink.url); setToast('Copied'); }}>Copy</Button>
          <Button onClick={() => setMagicLink({ open: false, url: '' })}>Close</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
```

Add `Dialog, DialogTitle, DialogContent, DialogActions` to the MUI imports if not already present.

- [ ] **Step 3: Smoke test each action**

Worker on :8787, admin-ui on :5174. Sign in. Pick a test user. Run through:
- Resend invite (use a pending invite — verify Resend dashboard shows the email send)
- Force-accept (verify a `friends` row appears in D1)
- Magic link (verify URL is generated; do NOT click — magic links are one-shot)
- Edit display name (verify D1 row updated)
- Hide a recipe (verify `hidden_at` timestamp set)
- Soft-delete (verify `deleted_at` set; verify the user disappears from friend feeds — check by inspecting your own logged-in app)

Verify each action shows up in `admin_audit_log` table:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --local \
  --command="SELECT created_at, admin_email, action, target_user_id, target_recipe_id, payload FROM admin_audit_log ORDER BY id DESC LIMIT 20"
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin-ui/src/pages/UserDrilldown.jsx apps/admin-ui/src/components/ConfirmModal.jsx
git commit -m "feat(admin-ui): wire all 6 Support actions into user drill-down"
```

---

## Phase 7 — Audit log page

### Task 23: GET /admin/audit-log + AuditLog page

**Files:**
- Modify: `apps/worker/src/routes/admin.ts`
- Modify: `apps/worker/src/routes/admin.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/admin-ui/src/pages/AuditLog.jsx`

- [ ] **Step 1: Test for handler**

```typescript
import { handleAdminAuditLog } from './admin';

describe('handleAdminAuditLog', () => {
  it('returns 403 for non-admin', async () => {
    const res = await handleAdminAuditLog({
      env: { DB: {} as any },
      user: { userId: 'u', email: 'no@x.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/audit-log'),
    });
    expect(res.status).toBe(403);
  });

  it('returns paginated entries', async () => {
    const allMock = vi.fn().mockResolvedValue({ results: [
      { id: 1, admin_email: 'a@b', action: 'hide_recipe', target_user_id: null, target_recipe_id: 'r1', payload: '{}', created_at: '2026-05-14' },
    ]});
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), all: allMock }) } as unknown as D1Database;
    const res = await handleAdminAuditLog({
      env: { DB: mockDb },
      user: { userId: 'u', email: 'elisa.widjaja@gmail.com' },
      adminEmails: 'elisa.widjaja@gmail.com',
      url: new URL('http://x/admin/audit-log?limit=10&offset=0'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement handler**

```typescript
export async function handleAdminAuditLog(args: {
  env: { DB: D1Database };
  user: { userId: string; email?: string };
  adminEmails: string | undefined;
  url: URL;
}): Promise<Response> {
  const denied = requireAdmin({ user: args.user, adminEmails: args.adminEmails });
  if (denied) return denied;

  const limit = Math.min(parseInt(args.url.searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(args.url.searchParams.get('offset') || '0', 10);
  const adminEmail = args.url.searchParams.get('adminEmail') || undefined;
  const action = args.url.searchParams.get('action') || undefined;

  const where: string[] = [];
  const params: unknown[] = [];
  if (adminEmail) { where.push('admin_email = ?'); params.push(adminEmail); }
  if (action) { where.push('action = ?'); params.push(action); }
  const sql = `SELECT id, admin_email, action, target_user_id, target_recipe_id, payload, created_at
               FROM admin_audit_log
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await args.env.DB.prepare(sql).bind(...params).all();
  return json(200, { entries: rows.results || [], page: { limit, offset } });
}
```

- [ ] **Step 3: Wire route**

```typescript
if (url.pathname === '/admin/audit-log' && request.method === 'GET') {
  const { handleAdminAuditLog } = await import('./routes/admin');
  return await handleAdminAuditLog({ env, user, adminEmails: env.ADMIN_EMAILS, url });
}
```

- [ ] **Step 4: Implement AuditLog page**

Replace `apps/admin-ui/src/pages/AuditLog.jsx`:

```javascript
import { useEffect, useState } from 'react';
import { Box, Table, TableHead, TableRow, TableCell, TableBody, TextField, Typography, MenuItem, Select } from '@mui/material';
import { fetchAdmin } from '../api';

const ACTIONS = ['', 'resend_invite', 'force_accept', 'generate_magic_link', 'edit_profile', 'soft_delete_user', 'hide_recipe'];

export default function AuditLog() {
  const [data, setData] = useState({ entries: [] });
  const [adminEmail, setAdminEmail] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (adminEmail) params.set('adminEmail', adminEmail);
    if (action) params.set('action', action);
    fetchAdmin(`/admin/audit-log?${params.toString()}`).then(setData);
  }, [adminEmail, action]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Audit log</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" placeholder="Admin email" value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)} />
        <Select size="small" value={action} onChange={(e) => setAction(e.target.value)} displayEmpty>
          {ACTIONS.map((a) => <MenuItem key={a} value={a}>{a || 'All actions'}</MenuItem>)}
        </Select>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Admin</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Target user</TableCell>
            <TableCell>Target recipe</TableCell>
            <TableCell>Payload</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{new Date(e.created_at).toLocaleString()}</TableCell>
              <TableCell>{e.admin_email}</TableCell>
              <TableCell>{e.action}</TableCell>
              <TableCell>{e.target_user_id || '—'}</TableCell>
              <TableCell>{e.target_recipe_id || '—'}</TableCell>
              <TableCell><code style={{ fontSize: 11 }}>{e.payload || ''}</code></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
```

- [ ] **Step 5: Smoke test**

Trigger an action in another tab, then refresh `http://localhost:5174/#/audit-log`. Expected: row appears.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/admin.ts apps/worker/src/routes/admin.test.ts apps/worker/src/index.ts apps/admin-ui/src/pages/AuditLog.jsx
git commit -m "feat(admin): GET /admin/audit-log + audit log page"
```

---

## Phase 8 — Production rollout + smoke test

### Task 24: Apply schema migration to production D1

- [ ] **Step 1: Backup current production schema**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --remote --command="SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('recipes','profiles')"`
Save the output to `/tmp/d1-schema-backup-pre-admin.txt`.

- [ ] **Step 2: Apply the migration to production D1**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --remote --file=migrations/0016_admin_dashboard.sql`
Expected: 5 commands executed.

- [ ] **Step 3: Verify**

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_log'"`
Expected: row showing `admin_audit_log`.

Run: `cd apps/worker && npx wrangler d1 execute recipes-db --remote --command="PRAGMA table_info(recipes)" | grep hidden_at`
Expected: row showing `hidden_at TEXT`.

- [ ] **Step 4: Set ADMIN_EMAILS production secret**

Already done in Task 2 — verify with:
```bash
cd apps/worker && npx wrangler secret list | grep ADMIN_EMAILS
```
Expected: ADMIN_EMAILS appears in the list.

- [ ] **Step 5: Deploy worker to production**

Run: `cd apps/worker && npx wrangler deploy`
Expected: deploy succeeds.

- [ ] **Step 6: Deploy admin-ui to production**

Run: `cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin`
Expected: deploy succeeds.

---

### Task 25: End-to-end smoke test on production

- [ ] **Step 1: Open admin.recifriend.com in an incognito window**

Expected sequence:
1. Cloudflare Access screen → Google login
2. Admin app loads → Sign in with Google (Supabase)
3. Dashboard renders with real production data

- [ ] **Step 2: Verify each page**

- `/` (Dashboard) — tiles populated, charts render
- `/users` — at least your own row visible. Test each filter shows reasonable counts
- Click into your own user — drill-down loads
- `/audit-log` — empty (no admin actions on prod yet)

- [ ] **Step 3: Test ONE Support action against your own account**

The safest test: hide one of your own test recipes. Verify it disappears from the public landing page (open recifriend.com in another incognito tab). Then un-hide manually:
```bash
cd apps/worker && npx wrangler d1 execute recipes-db --remote --command="UPDATE recipes SET hidden_at = NULL WHERE id = '<your-test-recipe-id>'"
```

- [ ] **Step 4: Verify audit log captured the action**

`/audit-log` page should show the `hide_recipe` entry.

- [ ] **Step 5: Update CLAUDE.md and memory**

Append to `CLAUDE.md` deployment section:
```
- **Admin UI deploy** (separate Pages project): `cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin`
- Admin URL: https://admin.recifriend.com (behind Cloudflare Access — Google SSO)
- Admin secret: `wrangler secret put ADMIN_EMAILS` (comma-separated emails)
```

Add a memory file `~/.claude/projects/-Users-elisa-Desktop-VibeCode/memory/project_admin_dashboard.md`:
```markdown
---
name: admin-dashboard
description: ReciFriend admin tool — visibility (filterable user table + trend charts) and Support actions
metadata:
  type: project
---

Admin dashboard at admin.recifriend.com (separate Vite app at apps/admin-ui).

- Two-layer auth: CF Access (Google SSO, allowlist policy in CF dashboard) + worker JWT email check against ADMIN_EMAILS secret
- Worker routes under /admin/* in apps/worker/src/routes/admin.ts (existing worker, not a new one)
- D1 schema additions: recipes.hidden_at, profiles.deleted_at, admin_audit_log table (migration 0016)
- Soft-delete is admin-only; user-initiated delete-my-account is still hard delete
- Slices 2 (Curation) and 4 (Moderation) deferred to future spec/plan cycles
```

Add the entry to `MEMORY.md` index.

- [ ] **Step 6: Commit doc updates**

```bash
git add CLAUDE.md
git commit -m "docs: add admin UI deploy command + ADMIN_EMAILS secret note"
```

---

## Self-review checklist

After implementing, run through this:

- [ ] Every spec section has at least one task implementing it
- [ ] All 6 Support actions exist as endpoints AND have UI buttons
- [ ] Audit log captures all 6 mutating actions
- [ ] Soft-delete filter applied to every user-facing query that JOINs profiles (Task 3)
- [ ] Hidden filter applied to every public/friend-feed recipe query (Task 21)
- [ ] `apps/worker/src/index.ts` did NOT grow significantly (admin code lives in `routes/admin.ts`)
- [ ] All worker tests pass: `cd apps/worker && npm test`
- [ ] Admin app builds clean: `cd apps/admin-ui && npm run build`
- [ ] CF Access blocks an unauthorized email (test in incognito)
- [ ] Worker returns 403 on `/admin/me` for an authenticated-but-not-admin email

---

## Deferred — explicitly NOT in this plan

- Curation tooling (slice 2)
- Moderation queue, ban-by-email, hard-delete account, mass actions (slice 4)
- Real-time / WebSocket dashboards
- Mobile responsive admin UI
- CF Access JWT path (`CF-Access-Jwt-Assertion`) replacing Supabase login
- Multi-admin self-service management (admins managed via `wrangler secret put`)
- Soft-delete cleanup cron job (manual D1 query for v1)
- URL hash for filter state on `/users`
- Impersonate / "view as user" action
- Hard-delete recipe action (only Hide is in scope)
