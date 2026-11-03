import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';

/**
 * Live e2e for the ADR-0146 customization journey, walked through the Studio
 * door on a read-only base: the showcase (`com.example.showcase`), a package
 * the deployment boots from code, so Studio reads it as read-only and every
 * change goes into its paired customization package `com.example.showcase.custom`.
 *
 *   1. Customize a list view: Customize on `showcase_task.in_progress`, drop a
 *      column, publish the pair, and read the columns the SERVER serves at the
 *      base's name (the read naming no package, the read naming the base, the
 *      type's list) — not what the canvas draws.
 *   2. Restore package original: the pair's draft and row are deleted at the
 *      pair, and the three reads serve the shipped column set again.
 *   3. Add `region__c`: Add field on the base object's Form writes an
 *      `object_extension` into the pair; once published, the base object is
 *      served with the field and the pair's own read and export carry it.
 *   4. Uninstall the base: the uninstall door refuses the read-only showcase
 *      with 422 `WRITABLE_PACKAGE_REQUIRED` and removes nothing. This is the
 *      refusal `main` answers here, and the one asserted: `DELETE
 *      /api/v1/packages/:id` asks `requireWritablePackage` before the registry
 *      is asked whether a pair is installed, so on a read-only base the 409
 *      that names the pair is never reached (pinned in-process by
 *      packages/runtime/src/domains/packages-uninstall-refuse-before-mutate.test.ts;
 *      the 409 is reachable only for a writable base with an exported pair).
 *      The console offers no uninstall for a read-only package, so the door is
 *      called with the signed-in session, as a person or script would.
 *
 * The run leaves the stack as it found it: when the pair did not exist before
 * the test, the test deletes it, and with it every row the journey wrote. A
 * pair that was already installed is left in place, with only this test's
 * items removed (an extension of the object it already held is left too).
 *
 * Checklist items whose live leg this spec drives:
 * `studio-authoring.package-customize-restore-display` (the view variant),
 * `studio-authoring.package-extension-field-c` and
 * `platform-core.customization-pair-ensure-door` (the read-only base's
 * uninstall refusal).
 *
 * In the required `Live E2E UI` job's `test:e2e:live:ci` allowlist since
 * objectstack#28579, under the promotion rule (3/3 consecutive green, plus a
 * 5/5 run of the enlarged allowlist on a fresh backend each) and the job's
 * two-minute budget for the specs step; the readings are on that card's PR.
 */

const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const BASE = 'com.example.showcase';
const PAIR = `${BASE}.custom`;
const VIEW = 'showcase_task.in_progress';
const OBJECT = 'showcase_task';
/** The column the customization drops, by its field name and its label in the inspector. */
const DROPPED = { field: 'due_date', label: 'Due Date' };
const FIELD = { label: 'Region', name: 'region__c' };

type Column = string | { field?: string };
const columnNames = (columns: Column[] | undefined): string[] =>
  (columns ?? []).map((c) => (typeof c === 'string' ? c : String(c.field)));

/** The view's columns as one read serves them (`query` names the package, or nothing). */
async function servedColumns(request: APIRequestContext, query: string): Promise<string[]> {
  const res = await request.get(`${API}/api/v1/meta/view/${VIEW}${query}`, { headers: { 'Cache-Control': 'no-cache' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  return columnNames((body.item ?? body).config?.columns);
}

/** The view's columns as the type's list serves them. */
async function listedColumns(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${API}/api/v1/meta/view?object=${OBJECT}`, { headers: { 'Cache-Control': 'no-cache' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const items = (await res.json()).items as { name?: string; config?: { columns?: Column[] } }[];
  const view = items.find((v) => v.name === VIEW);
  expect(view, `the list serves ${VIEW}`).toBeTruthy();
  return columnNames(view?.config?.columns);
}

/** The three reads of the view's name, which ADR-0146 D8 says agree. */
async function threeReads(request: APIRequestContext) {
  return {
    bare: await servedColumns(request, ''),
    base: await servedColumns(request, `?package=${BASE}`),
    list: await listedColumns(request),
  };
}

/** Publish the pair's drafts through the surface's Publish / Pending changes dialog. */
async function publishPair(page: Page) {
  await page.getByRole('button', { name: /^Publish/ }).first().click();
  const published = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(`/api/v1/packages/${PAIR}/publish-drafts`),
  );
  await page.getByTestId('draft-changes-publish').click();
  const res = await published;
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).data.outcome).toBe('published');
}

test('a read-only base is customized, restored and extended through Studio, and its uninstall is refused', async ({ page, request }) => {
  const baseRes = await request.get(`${API}/api/v1/packages/${BASE}`);
  expect(baseRes.ok(), await baseRes.text()).toBeTruthy();
  const basedOn = (await baseRes.json()).data.manifest.version as string;
  const pairExisted = (await request.get(`${API}/api/v1/packages/${PAIR}`)).ok();
  const extensionExisted = (await request.get(`${API}/api/v1/meta/object_extension/${OBJECT}?package=${PAIR}`)).ok();
  const shipped = await servedColumns(request, '');
  expect(shipped, `the shipped ${VIEW} shows ${DROPPED.field}`).toContain(DROPPED.field);
  const customized = shipped.filter((c) => c !== DROPPED.field);

  try {
    await test.step('Customize a view: the edit lands in the pair, and the server serves its columns', async () => {
      await page.goto(`/studio/${BASE}/interfaces?surface=${encodeURIComponent(`view:${VIEW}`)}`);
      await expect(page.getByTestId('studio-pkg-readonly')).toBeVisible();
      await page.getByTestId('studio-customize').click();

      const ensured = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes(`/api/v1/packages/${BASE}/ensure-customization`),
      );
      const drafted = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/meta/view/${VIEW}?`),
      );
      await page
        .getByTestId('if-inspector')
        .getByRole('button', { name: `Remove ${DROPPED.label}`, exact: true })
        .click();
      const ensure = await ensured;
      expect([200, 201], await ensure.text()).toContain(ensure.status());
      const draft = await drafted;
      expect(draft.ok(), await draft.text()).toBeTruthy();
      const draftUrl = new URL(draft.url());
      expect(draftUrl.searchParams.get('package')).toBe(PAIR);
      expect(draftUrl.searchParams.get('mode')).toBe('draft');
      const draftBody = draft.request().postDataJSON() as { overrides?: unknown; config?: { columns?: Column[] } };
      expect(draftBody.overrides).toEqual({ package: BASE, basedOn });
      expect(columnNames(draftBody.config?.columns)).toEqual(customized);

      await publishPair(page);
      expect(await threeReads(request)).toEqual({ bare: customized, base: customized, list: customized });
      await expect(page.getByTestId('studio-override-chip')).toBeVisible();
    });

    await test.step('Restore package original: the pair\'s draft and row go, and the shipped columns are served again', async () => {
      const deletes: string[] = [];
      const onResponse = (r: Response) => {
        if (r.request().method() === 'DELETE' && r.url().includes(`/api/v1/meta/view/${VIEW}`)) deletes.push(`${r.status()} ${r.url()}`);
      };
      page.on('response', onResponse);
      await page.getByTestId('if-item-more').click();
      await page.getByTestId('studio-restore-original').click();
      await page.getByTestId('studio-restore-original-confirm').click();
      await expect(page.getByTestId('studio-customize')).toBeVisible();
      await expect.poll(() => deletes.length).toBe(2);
      page.off('response', onResponse);
      for (const line of deletes) {
        expect(line).toMatch(/^200 /);
        expect(new URL(line.slice(4)).searchParams.get('package')).toBe(PAIR);
      }
      expect(await threeReads(request)).toEqual({ bare: shipped, base: shipped, list: shipped });
    });

    await test.step(`Add ${FIELD.name}: an extension in the pair, served on the base object`, async () => {
      await page.goto(`/studio/${BASE}/data?surface=${encodeURIComponent(`object:${OBJECT}`)}`);
      await page.getByTestId('data-object-header').getByRole('button', { name: 'Form', exact: true }).click();
      await page.getByTestId('data-form-add-extension-field').click();
      await page.getByTestId('add-field-label-input').fill(FIELD.label);
      await expect(page.getByTestId('add-field-api-name-preview')).toContainText(FIELD.name);

      const drafted = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/meta/object_extension/${OBJECT}?`),
      );
      await page.getByTestId('add-field-create').click();
      const draft = await drafted;
      expect(draft.ok(), await draft.text()).toBeTruthy();
      expect(new URL(draft.url()).searchParams.get('package')).toBe(PAIR);
      expect(draft.request().postDataJSON()).toEqual({
        extend: OBJECT,
        fields: { [FIELD.name]: { type: 'text', label: FIELD.label } },
      });

      await publishPair(page);
      const object = await request.get(`${API}/api/v1/meta/object/${OBJECT}`);
      expect(object.ok(), await object.text()).toBeTruthy();
      const objectBody = await object.json();
      expect(Object.keys((objectBody.item ?? objectBody).fields ?? {})).toContain(FIELD.name);

      const extension = await request.get(`${API}/api/v1/meta/object_extension/${OBJECT}?package=${PAIR}`);
      expect(extension.ok(), await extension.text()).toBeTruthy();
      const extensionItem = (await extension.json()).item;
      expect(extensionItem._packageId).toBe(PAIR);
      expect(extensionItem.fields[FIELD.name]).toEqual({ type: 'text', label: FIELD.label });

      const exported = await request.get(`${API}/api/v1/packages/${PAIR}/export`);
      expect(exported.ok(), await exported.text()).toBeTruthy();
      const extensions = (await exported.json()).data.objectExtensions as { extend?: string; fields?: Record<string, unknown> }[];
      expect(extensions.find((e) => e.extend === OBJECT)?.fields).toHaveProperty(FIELD.name);
    });

    await test.step('Uninstall the base: refused 422 WRITABLE_PACKAGE_REQUIRED, and nothing is removed', async () => {
      const res = await request.delete(`${API}/api/v1/packages/${BASE}`);
      expect(res.status(), await res.text()).toBe(422);
      expect((await res.json()).error.code).toBe('WRITABLE_PACKAGE_REQUIRED');
      expect((await request.get(`${API}/api/v1/packages/${BASE}`)).status()).toBe(200);
      expect((await request.get(`${API}/api/v1/packages/${PAIR}`)).status()).toBe(200);
    });
  } finally {
    if (!pairExisted) {
      // The pair is this test's: deleting it removes every row it holds.
      await request.delete(`${API}/api/v1/packages/${PAIR}`);
    } else {
      // A pair that was already installed keeps everything but this test's items.
      const items: [string, string][] = [['view', VIEW]];
      if (!extensionExisted) items.push(['object_extension', OBJECT]);
      for (const [type, name] of items) {
        await request.delete(`${API}/api/v1/meta/${type}/${name}?state=draft&package=${PAIR}`);
        await request.delete(`${API}/api/v1/meta/${type}/${name}?package=${PAIR}`);
      }
    }
  }
});
