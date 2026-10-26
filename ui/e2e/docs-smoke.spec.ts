import { test, expect } from '@playwright/test';

/**
 * Docs site smoke tests.
 *
 * These tests run against the production build of the docs site (Next.js)
 * and verify that documentation pages render without client-side errors.
 * This catches issues like:
 *   - Missing React context providers (e.g. SchemaRendererProvider)
 *   - Broken component demos that throw during hydration
 *   - Non-array `.map()` crashes in component renderers
 *   - Failed asset loading (JS/CSS bundles returning 404)
 *
 * The docs site must be running separately (e.g. via `pnpm --filter @object-ui/site dev`).
 * If the site is unreachable, tests are automatically skipped.
 */

const DOCS_BASE = process.env.DOCS_BASE_URL || 'http://localhost:3000';

/**
 * Check if the docs site is reachable before running the suite.
 * The Playwright webServer config only starts the console app — the docs
 * site requires a separate process. Skipping avoids 19+ ERR_CONNECTION_REFUSED
 * failures in CI when the docs site isn't running.
 */
let docsAvailable = false;
test.beforeAll(async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${DOCS_BASE}/docs`, { signal: controller.signal });
    clearTimeout(timer);
    // Require a successful response — a 404 from another server (e.g. the
    // framework backend running on the same port during local dev) would
    // otherwise mark the suite as available and cause every test to fail
    // with a 404 from the wrong host.
    docsAvailable = response.ok;
  } catch {
    docsAvailable = false;
  }
});

/** Representative pages across all documentation categories */
const SMOKE_PAGES = [
  '/docs',
  // Components
  '/docs/components/form/button',
  '/docs/components/layout/card',
  '/docs/components/layout/tabs',
  '/docs/components/feedback/alert',
  '/docs/components/complex/data-table',
  '/docs/components/complex/resizable',
  '/docs/components/data-display/list',
  // Fields
  '/docs/fields/text',
  '/docs/fields/select',
  // Core
  '/docs/core/schema-renderer',
  '/docs/core/form-renderer',
  // Plugins (these require SchemaRendererProvider)
  '/docs/plugins/plugin-grid',
  '/docs/plugins/plugin-kanban',
  '/docs/plugins/plugin-view',
  '/docs/plugins/plugin-charts',
  '/docs/plugins/plugin-timeline',
  // Blocks
  '/docs/blocks/dashboard',
  '/docs/blocks/marketing',
];

test.describe('Docs Site – Smoke', () => {
  for (const path of SMOKE_PAGES) {
    test(`${path} should load without client-side errors`, async ({ page }) => {
      test.skip(!docsAvailable, 'Docs site is not reachable');
      const errors: string[] = [];

      page.on('pageerror', (err) => {
        errors.push(err.message);
      });

      const response = await page.goto(`${DOCS_BASE}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Page must return a successful HTTP status
      expect(response?.status(), `${path} returned HTTP ${response?.status()}`).toBeLessThan(400);

      // Wait for hydration
      await page.waitForTimeout(2000);

      // Must not have thrown uncaught JS exceptions
      expect(errors, `Uncaught JS errors on ${path}:\n${errors.join('\n')}`).toEqual([]);

      // Must not show the Next.js error overlay
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Application error');
      expect(bodyText).not.toContain('client-side exception');
    });
  }

  test('should load all JS/CSS bundles without 404s', async ({ page }) => {
    test.skip(!docsAvailable, 'Docs site is not reachable');
    const failedAssets: string[] = [];

    page.on('response', (resp) => {
      const url = resp.url();
      if ((url.endsWith('.js') || url.endsWith('.css')) && resp.status() >= 400) {
        failedAssets.push(`${resp.status()} ${url}`);
      }
    });

    await page.goto(`${DOCS_BASE}/docs`, { waitUntil: 'networkidle', timeout: 30_000 });
    expect(failedAssets, 'Critical assets returned HTTP errors').toEqual([]);
  });
});
