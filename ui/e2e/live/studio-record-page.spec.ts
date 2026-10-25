import { test, expect } from '@playwright/test';

/**
 * Live e2e for #1541 (record-page authoring via Studio, ADR-0034). Creating a
 * `pageType: 'record'` page bound to an object in Studio's "New page" form
 * persists it as a draft AND seeds its `regions` from the object's synthesized
 * default detail page (via the `page` resource's `createSeed` hook) — so the
 * author starts from the auto-generated layout, not a blank canvas.
 *
 * (The page is then composed in the PagePreview canvas and published through
 * the existing ResourceEditPage draft/publish chrome; render-on-records is
 * handled by usePageAssignment over the synthesized default.)
 */
test('Studio: a new record page is created bound to its object and seeded from the default layout', async ({ page }) => {
  const puts: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/meta\/page\//.test(r.url())) {
      try { puts.push(r.postDataJSON()); } catch { /* ignore */ }
    }
  });

  await page.goto('/apps/showcase_app/metadata/page/new');
  // The create form is generated from the page resource's createSchema.
  await page.getByLabel(/^Label/i).first().waitFor({ state: 'visible', timeout: 20_000 });

  const uniq = Date.now().toString().slice(-6);
  // Label slugifies into Name; bind the object. Page type defaults to 'list'
  // (the interface page, the most-built type), so a record page is picked.
  await page.getByLabel(/^Label/i).first().fill(`Invoice Page ${uniq}`);
  await page.getByLabel(/^Page type/i).click();
  await page.getByRole('option', { name: 'record', exact: true }).click();
  await expect(page.getByLabel(/^Page type/i)).toContainText('record');
  // The Object control is a select (`role=combobox`) listing the objects, not a
  // text input. Anchored on the whole label: `/^Object/` also matches the app
  // bar's "ObjectOS home" link.
  await page.getByLabel(/^Object$/i).click();
  await page.getByRole('option', { name: 'showcase_invoice', exact: true }).click();
  await expect(page.getByLabel(/^Object$/i)).toContainText('showcase_invoice');

  await Promise.all([
    page.waitForRequest((r) => r.method() === 'PUT' && /\/meta\/page\//.test(r.url()), { timeout: 15_000 }).catch(() => null),
    page.locator('button[title^="Save"]').first().click(),
  ]);
  await page.waitForTimeout(800);

  expect(puts.length).toBeGreaterThan(0);
  const item = (puts[puts.length - 1]?.item ?? puts[puts.length - 1]) as any;
  expect(item.type).toBe('record');
  expect(item.object).toBe('showcase_invoice');
  // Seeded from buildDefaultPageSchema — NOT a blank `regions: []`.
  expect(Array.isArray(item.regions)).toBe(true);
  const blocks: string[] = item.regions.flatMap((r: any) => (r?.components || []).map((c: any) => c?.type));
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks).toContain('record:highlights');
});
