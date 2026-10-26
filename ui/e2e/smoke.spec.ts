import { test, expect } from '@playwright/test';
import { waitForReactMount, CONSOLE_BASE } from './helpers';

/**
 * Smoke tests for the console production build.
 *
 * These tests run against `vite preview` (the same artefact deployed to Vercel)
 * and are designed to catch **blank-page** regressions caused by:
 *   - Broken imports or missing modules in the production bundle
 *   - Missing polyfills (e.g. `process`, `crypto`)
 *   - Uncaught JavaScript exceptions during bootstrap
 *   - Failed network requests for critical assets (JS/CSS bundles)
 *   - React failing to mount into #root
 */

test.describe('Console App – Smoke', () => {
  test('should load the page without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);

    // The page must not have thrown any uncaught exceptions
    expect(errors, 'Uncaught JS errors during page load').toEqual([]);
  });

  test('should render React content inside #root', async ({ page }) => {
    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);

    // #root must exist and have child elements (React mounted successfully)
    const root = page.locator('#root');
    await expect(root).toBeAttached();
    const childCount = await root.evaluate((el) => el.children.length);
    expect(childCount, '#root has no children – blank page detected').toBeGreaterThan(0);
  });

  test('should not show a blank page (meaningful text rendered)', async ({ page }) => {
    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);

    // Wait for visible text to appear (SPA may still be rendering after mount)
    await page.waitForFunction(
      () => (document.body.innerText?.trim().length ?? 0) > 0,
      { timeout: 15_000 },
    );

    // The visible page text must not be empty
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length, 'Page body has no visible text').toBeGreaterThan(0);
  });

  test('should load all JavaScript bundles without 404s', async ({ page }) => {
    const failedAssets: string[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (
        (url.endsWith('.js') || url.endsWith('.css')) &&
        response.status() >= 400
      ) {
        failedAssets.push(`${response.status()} ${url}`);
      }
    });

    await page.goto(`${CONSOLE_BASE}/`);
    await page.waitForLoadState('networkidle');

    expect(failedAssets, 'Critical assets returned HTTP errors').toEqual([]);
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto(`${CONSOLE_BASE}/`);
    await expect(page).toHaveTitle(/.+/);
  });

  /**
   * The app must settle into one of its RECOGNISED boot destinations. Which one
   * it reaches depends on the session, and in this suite — a production bundle
   * served by `vite preview` with no backend behind it — that is always the
   * signed-out sign-in screen: `/api/v1/auth/get-session` cannot resolve to a
   * session, so the shell is never entitled to render a `nav` and the router
   * lands on `/login`.
   *
   * Until objectui#4086 this test listed only the first two destinations, and
   * the boot splash it named is on screen for roughly 35 ms — measured against
   * this same production bundle at 30 ms polling granularity: blank until
   * ~70 ms, the boot splash (then "Initializing application…") from ~70 ms, replaced by the
   * sign-in screen from ~105 ms and never returning. So the assertion could
   * only ever pass by catching that window. On a runner where Playwright's
   * first poll landed after it, the expectation was ALREADY unsatisfiable and
   * burned the full 30 s timeout — identically on all three retries, because
   * each retry re-runs the same race. That is the whole of the `Build & E2E`
   * red on `main` at 9154d9e90, which no code change could explain and which
   * cleared on its own at 8497579db with the suspected commit still in place.
   *
   * The set below stays CLOSED on purpose: a blank page, a crashed render or an
   * error boundary matches none of these three and still fails the test. What
   * changes is that every state the app is legitimately allowed to be in is now
   * terminal-stable, including the sign-in screen's final state with no backend:
   * the "Cannot connect to server" panel that replaces the form once the
   * auth-config read fails (objectui#11806), so passing no longer depends on
   * winning a race.
   */
  test('should settle into a recognised boot state (app shell, loading screen or sign-in)', async ({
    page,
  }) => {
    await page.goto(`${CONSOLE_BASE}/`);

    const appShell = page.locator('nav').first();
    // The boot splash, matched by its language-independent marker rather than
    // its copy: its line depends on the locale and is absent until the
    // locale's catalogue lands, so a copy match can stop seeing the splash
    // while it is on screen (objectui#12187).
    const loadingScreen = page.locator('[data-boot-splash]').first();
    // The signed-out sign-in screen, matched structurally rather than by its
    // copy so a locale change cannot silently stop matching it: the auth-config
    // spinner it opens with, then the identifier field of whichever sign-in
    // mode the server reports (`LoginForm.tsx`), or the unreachable panel that
    // replaces the form when that read fails (objectui#11806).
    const signInScreen = page
      .locator(
        '[data-testid="login-config-loading"], #login-email, #login-phone, [data-testid="auth-server-unreachable"]',
      )
      .first();

    await expect(
      appShell.or(loadingScreen).or(signInScreen),
    ).toBeVisible({ timeout: 30_000 });
  });
});
