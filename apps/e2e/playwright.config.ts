import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\/auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
      },
    },
    {
      name: 'alice',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testIgnore: /friends\.spec\.ts/,
    },
    {
      name: 'bob',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/bob.json',
      },
      dependencies: [],
      testMatch: /friends\.spec\.ts/,
    },
    {
      name: 'alice-friends',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testMatch: /friends\.spec\.ts/,
    },
  ],
  reporter: [['html', { open: 'never' }], ['list']],
});
