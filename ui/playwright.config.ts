import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Object UI
 *
 * Tests run against the **production build** of the console app so that
 * deployment-time issues (blank pages, broken imports, missing polyfills)
 * are caught before they reach Vercel / other hosting platforms.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  // Live specs (e2e/live/**) drive the REAL running stack (backend :3000 +
  // console :5180) via playwright.live.config.ts + an auth global-setup.
  // Exclude them from the default/CI run, which serves a mocked production
  // build with no backend.
  testIgnore: ['**/live/**'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use */
  reporter: process.env.CI ? 'github' : 'html',
  /* Shared settings for all projects */
  use: {
    /* Base URL – vite preview defaults to port 4173 */
    baseURL: 'http://localhost:4173',
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Test against mobile viewports */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /**
   * Build the console app and serve the production bundle via `vite preview`.
   * This mirrors the Vercel deployment pipeline and catches blank-page issues
   * caused by build-time errors (broken imports, missing polyfills, etc.).
   *
   * In CI the "Build Core" job already produces the dist/ artifacts and the
   * E2E job downloads them, so we skip the build step and only serve.
   */
  webServer: {
    command: process.env.CI
      ? 'VITE_BASE_PATH=/console/ pnpm --filter @object-ui/console preview --port 4173'
      : 'VITE_BASE_PATH=/console/ pnpm turbo run build --filter=@object-ui/console && VITE_BASE_PATH=/console/ pnpm --filter @object-ui/console preview --port 4173',
    url: 'http://localhost:4173/console/',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
