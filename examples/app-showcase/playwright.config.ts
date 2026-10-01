import { defineConfig, devices } from '@playwright/test';

// Ambient `process` with `env` — types/node-shim.d.ts declares the global as
// `{ cwd(): string }` only, so each module that reads env widens it locally.
// Declared above the block comment below so that comment stays attached to the
// first emitted statement.
declare const process: { env: Record<string, string | undefined> };

/**
 * Showcase smoke — drives the console (served by the backend at /_console)
 * across every nav surface. `webServer` boots the real backend so CI only needs
 * to run `playwright test`; locally it reuses an already-running :3000.
 *
 * Run:  pnpm --filter @objectstack/example-showcase exec playwright test
 *       (or via the ci/showcase-smoke workflow). Non-blocking by design.
 *
 * ## Where the server is, and which browser drives it
 *
 * `SMOKE_API_URL` is the ONE address the harness uses: `e2e/global-setup.ts`
 * already signs in against it, and the `baseURL` and the `webServer` below now
 * read it too, so the sign-in, every page load, and the server this config
 * boots (`-p` is that URL's port) can no longer point at three different
 * places. Unset, all three stay on :3000. On a shared box where :3000 is
 * somebody else's dev server, `reuseExistingServer` would otherwise attach to
 * it: pass `SMOKE_API_URL=http://localhost:<free port>` instead.
 *
 * `OS_TEST_CHROMIUM_EXECUTABLE_PATH` points Playwright at a chromium binary
 * when the browser cache holds a different build than this `@playwright/test`
 * resolves, in which case every test dies at launch (RUNNER.md, "Environment
 * facts"). Unset, Playwright resolves its own browser exactly as before.
 */
const BASE_URL = new URL(process.env.SMOKE_API_URL || 'http://localhost:3000');
const PORT = BASE_URL.port || '3000';
const CHROMIUM_EXECUTABLE = process.env.OS_TEST_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  use: {
    baseURL: BASE_URL.origin,
    storageState: 'e2e/.auth/state.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } } : {}),
    },
  }],
  webServer: {
    command: `node node_modules/@objectstack/cli/bin/run.js serve --dev -p ${PORT}`,
    url: `${BASE_URL.origin}/api/v1/runtime/config`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
