import { test, expect } from '@playwright/test';

/**
 * The real-product Import Wizard flow, driven exactly the way a user reaches it:
 *
 *   log in → open an object's list view (ObjectView) → click the toolbar
 *   "Import" button → upload a small CSV → opt into a BACKGROUND import → run it
 *   → open History → Undo → confirm the created rows are gone.
 *
 * This is the end-to-end guard for the "background import" gap fix: the wizard
 * only routed to an undoable async job for files over the async threshold (5000
 * rows), but the server only captures undo state at/under it — so an undoable
 * job was unreachable through the UI. The `import-opt-background` toggle closes
 * that gap; here we prove a 3-row import made through the *real console* is
 * actually undoable, asserting record counts at the backend on both sides.
 *
 * Setup + skip behaviour: see playwright.import-console.config.ts. Gated on
 * IMPORT_CONSOLE_LIVE=1 (the flow needs an import-job-capable client wired into
 * the console) and additionally skips when the backend exposes no import-job
 * route — so an unconfigured run reports skipped, not failed.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const APP_NAME = process.env.LIVE_IMPORT_APP || 'crm_app';
const OBJECT = process.env.LIVE_IMPORT_OBJECT || 'crm_lead';

test.describe('Import Wizard — real console: background import + undo', () => {
  test('a small background import made through the console is undoable', async ({ page }) => {
    test.skip(
      process.env.IMPORT_CONSOLE_LIVE !== '1',
      'set IMPORT_CONSOLE_LIVE=1 (and wire an import-job-capable client into the console) to run this real-console flow',
    );

    // The whole flow depends on the backend having the async import-job routes.
    let jobsSupported = false;
    try {
      const r = await page.request.get(`${API}/api/v1/data/import/jobs`);
      jobsSupported = r.status() !== 404;
    } catch {
      // Unreachable backend reads the same as "no import-job route" here, which
      // is the initialiser above — reassigning it is what `no-useless-assignment`
      // reports, because nothing can observe the difference.
    }
    test.skip(!jobsSupported, `backend at ${API} has no import-job route (/api/v1/data/import/jobs)`);

    // Count rows straight from the backend (cookie carried by the auth context).
    const countRecords = async (): Promise<number> => {
      const res = await page.request.get(`${API}/api/v1/data/${OBJECT}`);
      const body = await res.json();
      return (body.records ?? []).length;
    };

    // 1) Land on the REAL object list view and find the REAL toolbar button.
    await page.goto(`/apps/${APP_NAME}/${OBJECT}`);
    const importBtn = page.getByTestId('object-view-import-button');
    await expect(importBtn).toBeVisible({ timeout: 20_000 });

    const baseline = await countRecords();

    // 2) Open the wizard and upload a 3-row CSV (well under the async threshold).
    await importBtn.click();
    const stamp = Date.now();
    const csv = [
      'name,email,status',
      `RC One,rc.one.${stamp}@example.test,new`,
      `RC Two,rc.two.${stamp}@example.test,new`,
      `RC Three,rc.three.${stamp}@example.test,new`,
      '',
    ].join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'rc-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    // 3) Mapping → Preview (exact-name headers auto-map name/email/status).
    await page.getByTestId('import-next-btn').click();

    // 4) The background-import toggle must be offered for a sub-threshold file —
    //    this is the gap fix — and we opt in.
    const backgroundOpt = page.getByTestId('import-opt-background');
    await expect(backgroundOpt).toBeVisible();
    await backgroundOpt.getByRole('checkbox').click();

    // 5) Run it — the toggle routes it through the async job path.
    const jobCreate = page.waitForResponse(
      (r) => /\/import\/jobs$/.test(r.url()) && r.request().method() === 'POST' && r.status() === 201,
    );
    await page.getByTestId('import-run-btn').click();
    await jobCreate;

    // Rows land at the backend.
    await expect.poll(countRecords, { timeout: 20_000 }).toBe(baseline + 3);

    // Identify the fresh, undoable job created by this run.
    const jobsBody = await (await page.request.get(`${API}/api/v1/data/import/jobs`)).json();
    const jobs: Array<{ jobId: string; undoable: boolean; revertedAt: string | null; createdAt: string }> =
      jobsBody.jobs ?? jobsBody.records ?? jobsBody;
    const mine = jobs
      .filter((j) => j.undoable && !j.revertedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    expect(mine, 'a fresh undoable job should exist').toBeTruthy();

    // 6) Undo through the History UI. Reload for a clean wizard rather than
    //    dismissing the result screen (whose Close button re-renders as the job
    //    settles, making the click flaky).
    page.on('dialog', (d) => d.accept()); // accept the confirm() prompt
    await page.reload();
    await page.getByTestId('object-view-import-button').click();
    await page.getByTestId('import-history-toggle').click();
    await page.getByTestId(`import-history-undo-${mine.jobId}`).click();

    // 7) The created rows are deleted and the job row flips to reverted.
    await expect.poll(countRecords, { timeout: 20_000 }).toBe(baseline);
    await expect(page.getByTestId(`import-history-reverted-${mine.jobId}`)).toBeVisible();
  });
});
