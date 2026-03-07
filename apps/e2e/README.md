# ReciFind E2E Tests

Playwright test suite covering Recipe CRUD, sharing, friends, and search/filter flows.

## Setup (one-time)

### 1. Start local dev servers

In separate terminals:

```bash
# Terminal 1 — Frontend
cd apps/recipe-ui && npm run dev

# Terminal 2 — Worker API
cd apps/worker && npx wrangler dev
```

### 2. Install dependencies

```bash
cd apps/e2e && npm install
```

### 3. Authenticate test accounts

Run the interactive setup — it will open a browser and pause for you to log in with Google for each account:

```bash
cd apps/e2e && npm run test:setup
```

- When prompted, log in as **Alice** (account 1) and click "Resume" in Playwright Inspector
- Then log in as **Bob** (account 2) and click "Resume"
- Sessions are saved to `.auth/alice.json` and `.auth/bob.json` (gitignored)

Re-run `npm run test:setup` when sessions expire (~1 week).

## Running Tests

```bash
cd apps/e2e

npm test                        # all tests
npm run test:recipe-crud        # recipe CRUD only
npm run test:sharing            # sharing only
npm run test:friends            # friend flow only
npm run test:search             # search & filter only
npm run test:ui                 # interactive Playwright UI
```

## Test Accounts

Two Google accounts are required:
- **Alice** — primary tester (recipe CRUD, sharing, search)
- **Bob** — friend flow partner (accepts Alice's friend requests)

## Notes

- All test-created recipes are prefixed with `[TEST]` for identification
- Tests clean up via API after each run; if a test crashes mid-way, search for `[TEST]` recipes and delete manually
- Friend flow tests (`friends.spec.ts`) are stateful — run the full file, not individual tests
- Meal type filter chips are only visible on non-mobile viewport (Desktop Chrome is used by default)
