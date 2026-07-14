import { defineConfig, devices } from '@playwright/test';

/**
 * Permission-model e2e (ADR-0090) — runs e2e/permission-model.spec.ts against
 * a live showcase backend and captures UI evidence screenshots into
 * docs/test/screenshots/.
 *
 * Run against an already-running dev server (recommended — keeps its DB):
 *   PERM_BASE_URL=http://localhost:3777 pnpm exec playwright test --config playwright.permission.config.ts
 *
 * Or let Playwright boot a fresh backend on :3000 (CI-style):
 *   pnpm exec playwright test --config playwright.permission.config.ts
 *
 * The spec provisions its own users/positions/BU memberships idempotently,
 * so both modes work. No shared storageState: each test signs in as the
 * persona it exercises.
 */
const BASE = process.env.PERM_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'permission-model.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.PERM_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'node node_modules/@objectstack/cli/bin/run.js serve --dev',
          url: `${BASE}/api/v1/runtime/config`,
          timeout: 180_000,
          reuseExistingServer: true,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      }),
});
