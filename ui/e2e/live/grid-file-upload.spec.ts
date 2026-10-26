import { test, expect } from '@playwright/test';

/**
 * Tier 0 live e2e: a `file` field on a master-detail child renders a real
 * UPLOAD control inside the inline line-item grid — not a degraded text input —
 * and the uploaded file persists on the line in the atomic /api/v1/batch
 * (objectui#2360). `showcase_invoice_line.receipt` is a `Field.file()`, so every
 * standard Invoice form's "Line Items" grid gets a per-row Receipt upload cell,
 * auto-derived from the data model (no columns config).
 *
 * This codifies the manual dogfood pass that shipped #2360:
 *   • the Receipt column auto-derives into the grid (file fields are no longer
 *     dropped from auto-columns);
 *   • the cell is a genuine `input[type=file]` upload control (compact button +
 *     removable chip), never a text `<Input>`;
 *   • picking a file uploads it through the console's UploadProvider adapter and
 *     shows a chip with the file name;
 *   • submit carries the uploaded file's id on the line — ADR-0104's stored
 *     form for a file field is an opaque file id, never an inline
 *     { name, url } blob — and that id resolves through the file door
 *     (`GET /api/v1/storage/files/:fileId`) to the bytes that were uploaded.
 *
 * Live-only (needs the storage service + a real backend); runs under
 * `pnpm test:e2e:live`, not the mocked PR e2e job.
 */

// A 1×1 PNG — smallest valid image payload for the upload round-trip.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const API = process.env.LIVE_API_URL || 'http://localhost:3000';

test('inline line-item grid uploads a per-row file and persists it in the batch', async ({ page, request }) => {
  const batches: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/batch')) {
      try { batches.push(r.postDataJSON()); } catch { /* ignore */ }
    }
  });

  await page.goto('/apps/showcase_app/showcase_invoice');
  await page.getByRole('button', { name: /^New$/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('md-form-submit')).toBeVisible();
  // The section's heading, by role: a bare text match also hits the dialog's
  // sr-only description ("…its line items, then save.") and fails strict mode.
  await expect(dialog.getByRole('heading', { name: 'Line Items' })).toBeVisible();

  const li = dialog.getByTestId('line-items');
  // The child schema loads async — wait for real headers, then assert Receipt.
  await li.locator('th', { hasText: 'Product' }).first().waitFor();
  await expect(li.locator('th', { hasText: 'Receipt' })).toHaveCount(1);

  // The Receipt cell is a genuine upload control, NOT a text input (#2360 core).
  const fileInput = li.locator('input[type="file"]').first();
  await expect(fileInput).toHaveCount(1);
  await expect(li.locator('input[type="text"][aria-label="Receipt"]')).toHaveCount(0);

  // Materialise the ghost row via a product pick (auto-fills description/price),
  // then give the line a quantity so it's a valid billable line.
  await li.getByTestId('lookup-trigger').first().click();
  const option = page.getByRole('option', { name: /Widget A/i }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  await li.locator('input[aria-label="Qty"]').first().fill('1');

  // Upload into the row's Receipt cell → a removable chip with the file name.
  await fileInput.setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(li.getByTestId('file-cell-chip').first()).toContainText('receipt.png');

  // Header fields, then submit and capture the atomic batch.
  const name = `INV-${Date.now()}`;
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.getByTestId('lookup-trigger-account').first().click();
  const acct = page.getByRole('option').first();
  await acct.waitFor({ state: 'visible' });
  await acct.click();
  await dialog.getByTestId('select-trigger-status').first().click();
  await page.getByTestId('select-option-draft').first().click();

  await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/v1/batch'), { timeout: 15_000 }).catch(() => null),
    dialog.getByTestId('md-form-submit').click(),
  ]);
  await page.waitForTimeout(500);

  expect(batches.length).toBeGreaterThan(0);
  const ops = batches[0].operations;
  const child = ops.find((o: any) => o.object === 'showcase_invoice_line');
  expect(child).toBeTruthy();
  // The line carries the uploaded file's id (ADR-0104 D3, "Stored form": an
  // opaque file id), not an inline blob, a url, or the file name as text.
  const receipt = child?.data?.receipt;
  expect(typeof receipt, `the receipt is not a file id: ${JSON.stringify(receipt)}`).toBe('string');
  expect(receipt).not.toContain('receipt.png');
  // The id resolves through the file door to exactly the bytes uploaded above.
  const file = await request.get(`${API}/api/v1/storage/files/${encodeURIComponent(receipt)}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('image/png');
  expect(Buffer.compare(await file.body(), PNG)).toBe(0);
});
