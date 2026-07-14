import { defineConfig, devices } from '@playwright/test';

/**
 * Showcase smoke — drives the console (served by the backend at /_console)
 * across every nav surface. `webServer` boots the real backend so CI only needs
 * to run `playwright test`; locally it reuses an already-running :3000.
 *
 * Run:  pnpm --filter @objectstack/example-showcase exec playwright test
 *       (or via the ci/showcase-smoke workflow). Non-blocking by design.
 */
const PORT = 3000;
export default defineConfig({
  testDir: './e2e',
  // permission-model.spec.ts has its own opt-in config (playwright.permission.config.ts)
  testIgnore: 'permission-model.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: 'e2e/.auth/state.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@objectstack/cli/bin/run.js serve --dev',
    url: `http://localhost:${PORT}/api/v1/runtime/config`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
