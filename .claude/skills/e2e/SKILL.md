---
name: e2e
description: Run Playwright e2e tests against local dev or production. Use when the user wants to run e2e tests, verify the app works end-to-end, or test before deploying.
---

Run ReciFind's Playwright e2e test suite. Tests use iPhone 17 Pro mobile viewport and run headed so you can watch the browser.

## Modes

Controlled by `E2E_MODE` env var:

| Mode | Frontend | API | Data |
|------|----------|-----|------|
| `local` (default) | `http://localhost:5173` | `http://localhost:8787` | Local D1/KV |
| `local` + tunnel | tunnel URL via `E2E_FRONTEND_URL` | `http://localhost:8787` | Local D1/KV |
| `prod` | `https://recifind.elisawidjaja.com` | prod worker | Prod D1/KV |

## Prerequisites

### Local mode
Both servers must be running:
```bash
# Terminal 1 — Worker (local D1/KV)
cd apps/worker && npx wrangler dev --port 8787

# Terminal 2 — Frontend
cd apps/recipe-ui && npm run dev -- --host
```

Local D1 migrations must be applied (one-time):
```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --local
```

### Local + tunnel (for mobile viewport testing)
Same as local, plus start the cloudflared tunnel:
```bash
cloudflared tunnel run recifind-dev
```
This maps `dev-recifind.elisawidjaja.com` → :5173 and `api-dev-recifind.elisawidjaja.com` → :8787.

### Prod mode
No local servers needed — tests hit production directly.

### Auth setup (all modes)
`.env.e2e` must exist at `apps/e2e/.env.e2e` with Supabase credentials:
```
SUPABASE_URL=https://jpjuaaxwfpemecbwwthk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from apps/worker/.dev.vars>
SUPABASE_ANON_KEY=<from apps/recipe-ui/.env.local VITE_SUPABASE_ANON_KEY>
```

## Running Tests

```bash
cd apps/e2e

# Local mode (localhost)
npm test

# Local mode via tunnel (mobile testing on device)
npm run test:tunnel

# Production mode
npm run test:prod

# Individual suites
npm run test:recipe-crud
npm run test:sharing
npm run test:friends
npm run test:search

# Setup only (refresh auth sessions)
npm run test:setup

# Interactive Playwright UI
npm run test:ui
```

### With headed browser (default — tests run headed)
Tests run headed by default. To run headless:
```bash
npx playwright test --project=alice
```

## Steps to run

1. **Check prerequisites** — verify servers are running (local mode) or skip (prod mode):
   ```bash
   lsof -i :5173 | grep LISTEN   # Frontend
   lsof -i :8787 | grep LISTEN   # Worker
   ```

2. **Run the tests**:
   ```bash
   cd apps/e2e && npm test          # local
   cd apps/e2e && npm run test:tunnel  # local + tunnel
   cd apps/e2e && npm run test:prod    # production
   ```

3. **Report results** — show pass/fail counts per suite.

## Test Suites

| Suite | File | Tests | What it covers |
|-------|------|-------|----------------|
| Setup | `setup/auth.setup.ts` | 2 | Creates Alice + Bob sessions via Supabase admin API |
| Recipe CRUD | `tests/recipe-crud.spec.ts` | 4 | Add, view, edit, delete recipes |
| Sharing | `tests/recipe-sharing.spec.ts` | 2 | Share button visible, anonymous share view |
| Search & Filter | `tests/search-filter.spec.ts` | 4 | Meal type filter, ingredient search, favorites, clear filter |
| Friends | `tests/friends.spec.ts` | 4 | Connect via API, see friend, see shared recipe, open invite snackbar |

## Test Accounts

| Account | Email | Role |
|---------|-------|------|
| Alice | `e2e-alice@recifind.test` | Primary tester |
| Bob | `e2e-bob@recifind.test` | Friend flow partner |

## Troubleshooting

- **"Token expired"** — re-run `npm run test:setup` to refresh sessions
- **Onboarding dialog blocks tests** — setup sets `onboarding_seen` in localStorage; if it still appears, the session injection may have failed
- **Friends list empty** — ensure worker is running WITHOUT `--remote` for local mode (local D1). With `--remote`, Node.js API calls to localhost get Cloudflare 1031 errors
- **Meal type filter not found** — on mobile viewport, filters are in the hamburger drawer, not on the page directly
- **"Add Recipe" strict mode violation** — there are two buttons (toolbar + floating FAB); selectors use `.first()`
