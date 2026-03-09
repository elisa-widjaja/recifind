import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
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
        headless: false,
      },
    },
    {
      name: 'alice',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: [],
      testMatch: /tests\/(?!friends).*\.spec\.ts/,
    },
    {
      name: 'bob',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/bob.json',
      },
      dependencies: ['setup'],
      testMatch: /friends\.spec\.ts/,
    },
    {
      name: 'alice-friends',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/alice.json',
      },
      dependencies: ['setup'],
      testMatch: /friends\.spec\.ts/,
    },
  ],
  reporter: [['html', { open: 'never' }], ['list']],
});
