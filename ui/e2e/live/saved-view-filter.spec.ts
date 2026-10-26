import { test, expect } from '@playwright/test';

/**
 * objectui#3431 — a saved view's `ViewFilterRule[]` must reach `$filter` as an
 * ObjectQL AST, not as bare rule objects.
 *
 * This is the empirical pin for the defect, run against the REAL stack because
 * only the server can answer the question the issue asked: does it accept a
 * rule array in `$filter`? It does not. Measured against the published backend
 * backend this lane pins — `OBJECTSTACK_VERSION` in `e2e/live/ci/backend.env`,
 * held to the lockfile by `scripts/__tests__/ci-cd-pipeline-doc.test.ts`
 * (objectui#7689), with the showcase-app commit derived from it at boot from
 * the matching `@objectstack/cli` release tag (objectui#7964). That pin has
 * moved since this measurement was first taken, which is why it is named by
 * FILE and not by value: a version literal written here goes stale behind the
 * pin silently, and the whole point of objectui#7689 is that it did — for two
 * minor versions, in the pin itself. The showcase app is the one that release
 * checks out:
 *
 *   GET /api/v1/data/showcase_task
 *     ?$filter=[{"field":"status","operator":"equals","value":"in_progress"}]
 *   -> HTTP 400 {"error":"Request failed","code":"INVALID_FILTER",...}
 *
 *   GET /api/v1/data/showcase_task?$filter=[["status","equals","in_progress"]]
 *   -> HTTP 200 {"total":2,...}
 *
 * `showcase_task.in_progress` is a SHIPPED saved view whose stored filter is
 * exactly that rule array (`src/ui/views/task.view.ts`), so no fixture setup is
 * needed — opening it is the reproduction. Before the fix the list renders no
 * rows at all (the request 400s, so `record-count-bar` never mounts); after it,
 * the 2 in-progress tasks out of 10.
 *
 * Prereqs: the usual live-e2e pair (see playwright.live.config.ts). Run:
 *   pnpm test:e2e:live e2e/live/saved-view-filter.spec.ts
 *
 * In the `test:e2e:live:ci` allowlist since objectui#3472, per live-e2e.yml's
 * promotion policy (prove flake-free first, then admit): 3/3 consecutive green
 * runs against the pinned live pair, plus a 5/5 run of the enlarged allowlist
 * to show it does not disturb the incumbent specs.
 */
const APP = process.env.SHOWCASE_APP_NAME || 'showcase_app';

test('a saved view filter reaches $filter as AST, and the server answers 200', async ({ page }) => {
  // Record every data response the page provokes, so a failure says WHICH
  // request was refused and with what payload — not just "no rows".
  const refused: string[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/v1/data/showcase_task')) return;
    if (res.status() < 400) return;
    let code = '';
    try {
      code = ((await res.json()) as { code?: string }).code ?? '';
    } catch {
      /* non-JSON error body — the status alone is the signal */
    }
    refused.push(`${res.status()} ${code} ${decodeURIComponent(url)}`);
  });

  await page.goto(`/apps/${APP}/showcase_task/view/showcase_task.in_progress`);

  // The filter applied: 2 of the 10 seeded tasks are in_progress.
  await expect(page.getByTestId('record-count-bar')).toContainText(/^2 /, { timeout: 20000 });

  // And it applied by being ACCEPTED, not by some later rescue.
  expect(refused, `data requests the backend refused:\n${refused.join('\n')}`).toEqual([]);
});
