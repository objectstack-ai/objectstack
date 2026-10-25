import { defineConfig, devices } from '@playwright/test';

/**
 * LIVE import-wizard E2E — drives the REAL Import Wizard UI against a REAL
 * ObjectStack backend, end to end (upload → background import → History → Undo),
 * asserting record counts at the backend before and after each step.
 *
 * Unlike `playwright.live.config.ts` (which auths into the full console), this
 * config targets the standalone import harness served by
 * `packages/plugin-grid/demo/vite.live.config.ts`. That harness self-authenticates
 * its adapter in-page, so there is no globalSetup / storageState here.
 *
 * Prereqs (long-lived dev processes — NOT started by this config):
 *   - An ObjectStack backend the harness proxies to (default app-crm on :3002).
 *   - The harness dev server:
 *       pnpm --filter @object-ui/plugin-grid exec \
 *         vite --config demo/vite.live.config.ts
 *     serving http://localhost:5200/live.html
 *
 * The single spec SKIPS itself when the harness origin isn't reachable, so this
 * config is safe to run in CI (where the harness isn't up) — it reports 0 run,
 * 1 skipped rather than failing.
 *
 * Run:  pnpm test:e2e:import-harness           (headless)
 *       pnpm test:e2e:import-harness --headed   (watch it drive the UI)
 *
 * Override the target via IMPORT_HARNESS_ORIGIN (default http://localhost:5200)
 * and the object under test via IMPORT_HARNESS_OBJECT (default crm_lead).
 */
const ORIGIN = process.env.IMPORT_HARNESS_ORIGIN || 'http://localhost:5200';

export default defineConfig({
  testDir: './e2e/import-harness',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
