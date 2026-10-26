import type { Page } from '@playwright/test';

/**
 * Base path for the console app.
 * Matches `base` in `apps/console/vite.config.ts` (defaults to '/console/').
 */
export const CONSOLE_BASE = '/console';

/** Wait for React to mount (at least one child inside #root). */
export async function waitForReactMount(page: Page) {
  await page.waitForFunction(
    () => (document.getElementById('root')?.children.length ?? 0) > 0,
    { timeout: 30_000 },
  );
}
