import { defineConfig, devices } from '@playwright/test';

/**
 * Two modes controlled by E2E_MODE env var:
 *
 *   E2E_MODE=local  (default)
 *     - Worker runs locally: `npx wrangler dev --port 8787` (local D1/KV)
 *     - Frontend: localhost:5173 or tunnel URL for mobile testing
 *     - API_BASE: http://localhost:8787
 *
 *   E2E_MODE=prod
 *     - Tests against production deployment
 *     - Frontend: https://recifind.elisawidjaja.com
 *     - API_BASE: https://recipes-worker.elisa-widjaja.workers.dev
 */
const mode = process.env.E2E_MODE || 'local';

const LOCAL_FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:5173';
const LOCAL_API = 'http://localhost:8787';

const PROD_FRONTEND = 'https://recifind.elisawidjaja.com';
const PROD_API = 'https://recipes-worker.elisa-widjaja.workers.dev';

const baseURL = mode === 'prod' ? PROD_FRONTEND : LOCAL_FRONTEND;
const apiBase = mode === 'prod' ? PROD_API : LOCAL_API;

// Expose API_BASE so test files can import it via process.env
process.env.API_BASE = apiBase;

const iphone17Pro = {
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
};

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    headless: false,
    ...iphone17Pro,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\/auth\.setup\.ts/,
      use: {
        ...iphone17Pro,
        storageState: undefined,
        headless: false,
      },
    },
    {
      name: 'alice',
      use: {
        ...iphone17Pro,
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testMatch: /tests\/(?!friends).*\.spec\.ts/,
    },
    {
      name: 'bob',
      use: {
        ...iphone17Pro,
        storageState: '.auth/bob.json',
      },
      dependencies: ['setup'],
      testMatch: /friends\.spec\.ts/,
    },
    {
      name: 'alice-friends',
      use: {
        ...iphone17Pro,
        storageState: '.auth/alice.json',
      },
      dependencies: ['setup'],
      testMatch: /friends\.spec\.ts/,
    },
  ],
  reporter: [['html', { open: 'never' }], ['list']],
});
