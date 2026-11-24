import { test, expect, type APIRequestContext, type Dialog } from '@playwright/test';

/**
 * Live e2e for the generic Studio item page's save model (objectstack#36902,
 * epic objectstack#36890 decisions 1 and 12): Save makes the item live at once
 * (its draft, then that one item's publish), with no auto-save and no second
 * Publish step, and leaving with unsaved edits asks first through × and ‹ ›
 * while the browser's Back is not intercepted.
 *
 * The item under edit is a page the test authors in the environment (a copy of
 * the showcase's `showcase_project_workspace`), removed again at the end, as
 * `studio-editor.spec.ts` does.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const SHIPPED_PAGE = 'showcase_project_workspace';

async function authorEditablePage(request: APIRequestContext): Promise<{ name: string; firstRegionBlocks: number }> {
  const res = await request.get(`${API}/api/v1/meta/page/${SHIPPED_PAGE}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const shipped = (await res.json()).item as Record<string, unknown>;
  const body = Object.fromEntries(Object.entries(shipped).filter(([k]) => !k.startsWith('_')));
  const firstRegionBlocks = ((body.regions as { components?: unknown[] }[])[0].components ?? []).length;
  const name = `e2e_save_at_once_${Date.now()}`;
  const put = await request.put(`${API}/api/v1/meta/page/${name}`, {
    data: { ...body, name, label: `E2E Save At Once ${name.slice(-6)}` },
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  return { name, firstRegionBlocks };
}

test('Save makes the edit live at once, and an unsaved edit is guarded on × but not on Back', async ({ page, request }) => {
  const { name, firstRegionBlocks } = await authorEditablePage(request);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/api/v1/meta/page/${name}`) && ['PUT', 'POST'].includes(r.method())) {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  try {
    await page.goto('/studio/~all/metadata/page');
    await page.goto(`/studio/~all/metadata/page/${name}`);
    await expect(page.getByTestId('metadata-edit-page')).toBeVisible();

    await test.step('an edit stays on the page: no auto-save sends it', async () => {
      await page.getByRole('button', { name: /Add block/i }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: /Card/i }).first().click();
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'unsaved');
      await page.waitForTimeout(2500);
      expect(writes).toEqual([]);
    });

    await test.step('× asks before dropping the edit; Cancel stays', async () => {
      const asked: string[] = [];
      const dismiss = (d: Dialog) => {
        asked.push(d.type());
        void d.dismiss();
      };
      page.on('dialog', dismiss);
      await page.getByTestId('studio-detail-close').click();
      await expect.poll(() => asked).toEqual(['confirm']);
      page.off('dialog', dismiss);
      await expect(page).toHaveURL(new RegExp(`/metadata/page/${name}`));
    });

    await test.step('Save writes the draft, then publishes the one item; nothing is left to publish', async () => {
      const published = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes(`/api/v1/meta/page/${name}/publish`),
      );
      await page.getByTestId('resource-save').click();
      const publish = await published;
      expect(publish.ok(), await publish.text()).toBeTruthy();
      expect(writes).toEqual([`PUT /api/v1/meta/page/${name}`, `POST /api/v1/meta/page/${name}/publish`]);
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
      await expect(page.getByTestId('resource-unpublished-changes')).toHaveCount(0);
      const live = await request.get(`${API}/api/v1/meta/page/${name}`, { headers: { 'Cache-Control': 'no-cache' } });
      const blocks = (await live.json()).item.regions[0].components as unknown[];
      expect(blocks).toHaveLength(firstRegionBlocks + 1);
      const draft = await request.get(`${API}/api/v1/meta/page/${name}?state=draft`);
      expect(draft.status()).toBe(404);
    });

    await test.step('browser Back is not intercepted, even with an unsaved edit', async () => {
      await page.getByRole('button', { name: /Add block/i }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: /Card/i }).first().click();
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'unsaved');
      const asked: string[] = [];
      const accept = (d: Dialog) => {
        asked.push(d.type());
        void d.accept();
      };
      page.on('dialog', accept);
      await page.goBack();
      await expect(page).toHaveURL(/\/metadata\/page(\?|$)/);
      page.off('dialog', accept);
      expect(asked).toEqual([]);
    });
  } finally {
    await request.delete(`${API}/api/v1/meta/page/${name}`);
  }
});
