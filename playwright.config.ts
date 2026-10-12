import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx tests/serve.mjs',
    url: 'http://127.0.0.1:4317/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
