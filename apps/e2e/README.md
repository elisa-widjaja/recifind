# ReciFind E2E Tests

Playwright test suite covering Recipe CRUD, sharing, friends, and search/filter flows.

## Prerequisites

Both local servers must be running before any test run:

```bash
# Terminal 1 — Worker API
cd apps/worker && npx wrangler dev

# Terminal 2 — Frontend
cd apps/recipe-ui && npm run dev
```

Local D1 migrations must be applied (one-time, or after schema changes):

```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --local
```

## First-Time Setup

### 1. Install dependencies

```bash
cd apps/e2e && npm install
```

### 2. Create `.env.e2e`

```bash
# apps/e2e/.env.e2e  (gitignored)
SUPABASE_URL=https://jpjuaaxwfpemecbwwthk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from apps/worker/.dev.vars>
SUPABASE_ANON_KEY=<from apps/recipe-ui/.env.local VITE_SUPABASE_ANON_KEY>
```

### 3. Verify worker has JWT secret

`apps/worker/.dev.vars` must contain:

```
SUPABASE_JWT_SECRET="<value from Supabase dashboard → Settings → API → JWT Settings>"
AUTH_AUDIENCE="authenticated"
```

### 4. Create test sessions

```bash
cd apps/e2e && npm run test:setup
```

This uses the Supabase admin API to create two test accounts (`e2e-alice@recifind.test`, `e2e-bob@recifind.test`) and saves browser sessions to `.auth/alice.json` and `.auth/bob.json` (gitignored).

Re-run when sessions expire (access tokens last ~1 hour per run; re-run setup before each test session if needed).

## Running Tests

```bash
cd apps/e2e

npm test                        # all tests (runs setup automatically)
npm run test:recipe-crud        # recipe CRUD only
npm run test:sharing            # sharing only
npm run test:friends            # friend flow only
npm run test:search             # search & filter only
npm run test:ui                 # interactive Playwright UI
```

## Test Accounts

Two programmatic test accounts are created automatically:

| Account | Email | Role |
|---------|-------|------|
| Alice | `e2e-alice@recifind.test` | Primary tester (CRUD, sharing, search) |
| Bob | `e2e-bob@recifind.test` | Friend flow partner |

These accounts are created via Supabase admin API and confirmed automatically — no email required.

## Project Structure

```
apps/e2e/
├── setup/
│   └── auth.setup.ts          # Creates Alice + Bob sessions
├── tests/
│   ├── recipe-crud.spec.ts    # Add, view, edit, delete recipes
│   ├── recipe-sharing.spec.ts # Share button, anonymous share view
│   ├── friends.spec.ts        # Send request, accept, view friend recipes
│   └── search-filter.spec.ts  # Meal type filter, ingredient search, favorites
├── helpers/
│   ├── api.ts                 # Auth token reader, recipe/friend cleanup helpers
│   └── selectors.ts           # Shared data-testid and role-based locators
├── .auth/                     # Saved browser sessions (gitignored)
├── .env.e2e                   # Local secrets (gitignored)
└── playwright.config.ts
```

## Notes

- All test-created recipes are prefixed with `[TEST]` and cleaned up after each test
- If a test crashes mid-way, delete `[TEST]` recipes manually from the UI or via API
- Friends tests (`friends.spec.ts`) are stateful — tests within the suite depend on each other
- Meal type filter chips are only visible on non-mobile viewport (Desktop Chrome is used by default)
- The `bob` project runs Bob's perspective tests; `alice-friends` runs Alice's perspective tests in the friends suite
