import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Live e2e for the Studio metadata page editor — guards the "Add block works
 * and blocks are configurable" contract the SDUI runtime depends on. Drives the
 * real editor at /apps/:app/metadata/page/:name against the running stack.
 *
 * The page under edit is one the test authors in the environment: a copy of the
 * showcase's `showcase_project_workspace` (its regions and blocks) under a fresh
 * name, removed again at the end. The shipped page itself opens read-only, by
 * design: `page` is a create-only type (`allowEnvironmentOverlay: false`,
 * `allowRuntimeCreate: true`), and under ADR-0005's two-tier rule an item a code
 * package ships stays immutable there while a page the environment authors is
 * editable.
 *
 * The page's layout — its regions and the blocks in them — is authored on the
 * canvas, not in a "Layout" form section: the page form prunes `regions`
 * (`PAGE_FIELDS_OWNED_ELSEWHERE` in app-shell's `page-schema.ts`), so the
 * canvas's region controls are where the layout config renders.
 *
 * In the required `Live E2E UI` job's `test:e2e:live:ci` allowlist since
 * objectstack#27554, under the promotion rule (3/3 consecutive green, plus a
 * 5/5 run of the enlarged allowlist); the readings are on that card's PR.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const SHIPPED_PAGE = 'showcase_project_workspace';

/** Author an editable copy of the shipped page; returns its name, how many regions it lays out and how many blocks its first region holds. */
async function authorEditablePage(
  request: APIRequestContext,
): Promise<{ name: string; regions: number; firstRegionBlocks: number }> {
  const res = await request.get(`${API}/api/v1/meta/page/${SHIPPED_PAGE}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const shipped = (await res.json()).item as Record<string, unknown>;
  // Underscore keys are the server's provenance stamps, not page content.
  const body = Object.fromEntries(Object.entries(shipped).filter(([k]) => !k.startsWith('_')));
  const regions = Array.isArray(body.regions) ? body.regions.length : 0;
  expect(regions, 'the shipped page lays out regions to copy').toBeGreaterThan(0);
  const firstRegionBlocks = ((body.regions as { components?: unknown[] }[])[0].components ?? []).length;

  const name = `e2e_studio_editor_${Date.now()}`;
  const put = await request.put(`${API}/api/v1/meta/page/${name}`, {
    data: { ...body, name, label: `E2E Studio Editor ${name.slice(-6)}` },
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  return { name, regions, firstRegionBlocks };
}

async function removePage(request: APIRequestContext, name: string) {
  await request.delete(`${API}/api/v1/meta/page/${name}`);
}

test('the page editor loads with its config sections', async ({ page, request }) => {
  const { name, regions } = await authorEditablePage(request);
  try {
    await page.goto(`/apps/showcase_app/metadata/page/${name}`);
    await expect(page.getByTestId('metadata-edit-page')).toBeVisible();
    // The environment's own page: no lock stands between the test and the editor.
    await expect(page.getByText(/is locked and cannot be edited/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Basics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Context' })).toBeVisible();
    // Layout: every region renders on the canvas with its own Add block, and
    // the canvas offers Add region.
    await expect(page.getByRole('button', { name: /Add block/i })).toHaveCount(regions);
    await expect(page.getByRole('button', { name: /Add region/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add block/i }).first()).toBeVisible();
  } finally {
    await removePage(request, name);
  }
});

test('Add block opens a block-type picker with configurable block kinds, and the added block is stored', async ({ page, request }) => {
  const { name, firstRegionBlocks } = await authorEditablePage(request);
  try {
    await page.goto(`/apps/showcase_app/metadata/page/${name}`);
    await expect(page.getByTestId('metadata-edit-page')).toBeVisible();

    await page.getByRole('button', { name: /Add block/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The picker offers selectable, schema-backed block kinds (SDUI slots).
    await expect(dialog.getByRole('button', { name: /Card/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Section/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Record details/i })).toBeVisible();

    // The save round trip, not only the canvas: picking a kind autosaves a
    // draft, and the draft read back through /meta holds the new block at the
    // end of the first region.
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/meta/page/${name}?mode=draft`),
    );
    await dialog.getByRole('button', { name: /Card/i }).first().click();
    const save = await saved;
    expect(save.ok(), await save.text()).toBeTruthy();
    const stored = await request.get(`${API}/api/v1/meta/page/${name}?state=draft`);
    expect(stored.ok(), await stored.text()).toBeTruthy();
    const blocks = (await stored.json()).item.regions[0].components as { type?: string }[];
    expect(blocks).toHaveLength(firstRegionBlocks + 1);
    expect(blocks[firstRegionBlocks].type).toBe('page:card');
  } finally {
    await removePage(request, name);
  }
});
