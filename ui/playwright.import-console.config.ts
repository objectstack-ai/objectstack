import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

/**
 * REAL-CONSOLE import-wizard E2E — the most faithful "how a user actually does
 * it" test: it logs into the real `apps/console`, navigates to an object's list
 * view (ObjectView), clicks the real toolbar Import button, and drives the
 * wizard through a BACKGROUND import → History → Undo, asserting the backend
 * record count before/after each step. No hand-mounted harness — the wizard is
 * reached exactly the way the product surfaces it.
 *
 * This differs from:
 *   - playwright.live.config.ts        — general live console specs
 *   - playwright.import-harness.config.ts — a standalone hand-mounted wizard
 *
 * Prereqs (long-lived dev processes — NOT started by this config):
 *   1. An ObjectStack backend with the async import-job routes
 *      (`/api/v1/data/import/jobs`), e.g. the framework `data-import` build:
 *        objectstack serve --dev --port 3002   (from examples/app-crm)
 *   2. The console dev server pointed at that backend AND at an
 *      import-job-capable `@objectstack/client`. The published client (11.2.0)
 *      predates the async import API, so the console must alias it via
 *      OBJECTSTACK_CLIENT_DIST (see apps/console/vite.config.ts):
 *        cd apps/console && VITE_SERVER_URL= VITE_USE_MOCK_SERVER=false \
 *          DEV_PROXY_TARGET=http://localhost:3002 \
 *          OBJECTSTACK_CLIENT_DIST=<framework>/packages/client \
 *          pnpm dev --port 5180 --strictPort
 *
 * Because the flow only works once that unshipped client is wired in, the spec
 * is gated on IMPORT_CONSOLE_LIVE=1 and additionally skips if the backend has
 * no import-job route — so an unconfigured CI run reports skipped, not failed.
 *
 * Run:  IMPORT_CONSOLE_LIVE=1 pnpm test:e2e:import-console
 *       IMPORT_CONSOLE_LIVE=1 pnpm test:e2e:import-console --headed
 *
 * Overrides: LIVE_APP_URL (console, default :5180), LIVE_API_URL (backend,
 * default :3000 — set :3002 for app-crm), LIVE_EMAIL / LIVE_PASSWORD,
 * LIVE_IMPORT_APP (default crm_app), LIVE_IMPORT_OBJECT (default crm_lead).
 */
const APP = process.env.LIVE_APP_URL || 'http://localhost:5180';

/**
 * `storageState` is a string this config hands to Playwright, and Playwright
 * resolves a relative one against the PROCESS CWD — measured on this tree with
 * playwright 1.62.1: a run launched from a subdirectory loaded the state file
 * under that subdirectory and ignored the one beside the config (it failed with
 * `Error reading storage state from state/probe-state.json` when only the
 * config-dir copy existed). `testDir` and `globalSetup` above are config-dir
 * rooted, this option is not — so it is rooted here, on this file, the same way
 * the specs root their read (objectui#9188) and the global setup roots its
 * write (objectui#9519).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 1; // this file, at the repo root
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const STATE_PATH = join(REPO_ROOT, 'e2e/live/.auth/state.json');

export default defineConfig({
  testDir: './e2e/import-console',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/live/global-setup.ts',
  use: {
    baseURL: APP,
    storageState: STATE_PATH,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
