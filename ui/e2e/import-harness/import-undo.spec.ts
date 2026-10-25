import { test, expect } from '@playwright/test';

/**
 * Full-stack Import Wizard flow against a real backend:
 *   upload a small CSV → opt into a BACKGROUND import → run it → open History →
 *   Undo → assert the created rows are gone.
 *
 * This is the regression guard for the "background import" gap: the wizard used
 * to run a job only for files over the async threshold (5000 rows), but the
 * server only captures undo state for files at or under it — so an undoable job
 * was unreachable through the UI. The `import-opt-background` toggle closes that
 * gap; this test proves a 3-row import made through the UI is actually undoable.
 *
 * Prereqs and skip behaviour: see playwright.import-harness.config.ts. The test
 * skips (does not fail) when the harness origin isn't serving `/live.html`, so
 * it's CI-safe.
 */
const HARNESS_PATH = '/live.html';
const OBJECT = process.env.IMPORT_HARNESS_OBJECT || 'crm_lead';

test.describe('Import Wizard — background import + undo (live UI + backend)', () => {
  test('a small background import creates an undoable job; Undo deletes the rows', async ({ page, baseURL }) => {
    // Reachability guard: skip cleanly when the machine-specific harness is down.
    let reachable = false;
    try {
      const res = await page.request.get(`${baseURL}${HARNESS_PATH}`);
      reachable = res.ok();
    } catch {
      // A throw reads the same as "not reachable" here, which is the initialiser
      // above — reassigning it is what `no-useless-assignment` reports, because
      // nothing can observe the difference.
    }
    test.skip(!reachable, `import harness not reachable at ${baseURL}${HARNESS_PATH}`);

    // Backend record count via the same proxied origin the harness uses.
    const countRecords = async (): Promise<number> => {
      const res = await page.request.get(`/api/v1/data/${OBJECT}`);
      const body = await res.json();
      return (body.records ?? []).length;
    };

    await page.goto(HARNESS_PATH);
    await expect(page.getByText('connected & authenticated')).toBeVisible({ timeout: 15_000 });

    const baseline = await countRecords();

    // 1) Open the wizard and upload a 3-row CSV (well under the async threshold).
    await page.getByRole('button', { name: 'Open import' }).click();
    const stamp = Date.now();
    const csv = [
      'first_name,last_name,email',
      `Bg,One,bg.one.${stamp}@example.test`,
      `Bg,Two,bg.two.${stamp}@example.test`,
      `Bg,Three,bg.three.${stamp}@example.test`,
      '',
    ].join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'bg-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    // 2) Mapping → Preview.
    await page.getByRole('button', { name: /^Next/ }).click();

    // 3) The background-import toggle must be offered for a sub-threshold file
    //    when the data source supports jobs — this is the gap fix.
    const backgroundOpt = page.getByTestId('import-opt-background');
    await expect(backgroundOpt).toBeVisible();
    await backgroundOpt.getByRole('checkbox').click();

    // 4) Run it — routes through the async job path because of the toggle.
    const jobCreate = page.waitForResponse(
      (r) => /\/import\/jobs$/.test(r.url()) && r.request().method() === 'POST' && r.status() === 201,
    );
    await page.getByRole('button', { name: /Import\s+3\s+Rows/i }).click();
    await jobCreate;

    // Rows land at the backend.
    await expect.poll(countRecords, { timeout: 20_000 }).toBe(baseline + 3);

    // Identify the fresh, undoable job created by this run.
    const jobsBody = await (await page.request.get('/api/v1/data/import/jobs')).json();
    const jobs: Array<{ jobId: string; undoable: boolean; revertedAt: string | null; createdAt: string }> =
      jobsBody.jobs ?? jobsBody.records ?? jobsBody;
    const mine = jobs
      .filter((j) => j.undoable && !j.revertedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    expect(mine, 'a fresh undoable job should exist').toBeTruthy();

    // 5) Undo through the History UI. Reload for a clean wizard rather than
    //    dismissing the result screen (whose Close button re-renders as the job
    //    settles, making the click flaky).
    page.on('dialog', (d) => d.accept()); // accept the confirm() prompt
    await page.reload();
    await expect(page.getByText('connected & authenticated')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Open import' }).click();
    await page.getByTestId('import-history-toggle').click();
    await page.getByTestId(`import-history-undo-${mine.jobId}`).click();

    // 6) The created rows are deleted and the row flips to reverted.
    await expect.poll(countRecords, { timeout: 20_000 }).toBe(baseline);
    await expect(page.getByTestId(`import-history-reverted-${mine.jobId}`)).toBeVisible();
  });
});
