import { test, expect } from '@playwright/test';
import { expectToast } from './helpers';

/**
 * Live e2e for the full-page record form opened by DIRECT URL — a pasted link,
 * a new tab, a deep link — rather than by in-app navigation
 * (objectstack-ai/objectstack#27454).
 *
 * After a save the form page returns to where the user came from. With no page
 * of this console behind it, a history Back crosses the document boundary: the
 * save toast is lost with the unloaded document and the user lands outside the
 * app. The page must instead go to the record inside the app. A fresh
 * Playwright page is exactly that entry: its only earlier history entry is
 * `about:blank`, not a console page. The URL is the app's one address (its
 * package id), the one the console's own links and its address bar carry.
 *
 * The record is the test's own, created and deleted through the data API;
 * the stored value is read back through the same API after the save.
 *
 * In the required `Live E2E UI` job's `test:e2e:live:ci` allowlist since
 * objectstack#27555, under the promotion rule (3/3 consecutive green, plus a
 * 5/5 run of the enlarged allowlist); the readings are on that card's PR.
 */

const APP = 'com.example.showcase';
const OBJECT = 'showcase_task';
const API = process.env.LIVE_API_URL || 'http://localhost:3000';

test('a full-page edit form opened by URL saves, toasts, and stays inside the app', async ({ page, request }) => {
  // A seeded project to hang the task on (`project` is a required master-detail).
  const projectsRes = await request.get(`${API}/api/v1/data/showcase_project?$top=1`);
  expect(projectsRes.ok(), await projectsRes.text()).toBeTruthy();
  const projectsBody = await projectsRes.json();
  const project = (projectsBody?.records ?? projectsBody?.data ?? [])[0];
  expect(project, 'a seeded showcase_project exists').toBeTruthy();

  const stamp = Date.now();
  const createRes = await request.post(`${API}/api/v1/data/${OBJECT}`, {
    data: { title: `E2E Direct URL ${stamp}`, project: project.id ?? project._id, status: 'backlog' },
  });
  expect(createRes.ok(), await createRes.text()).toBeTruthy();
  const created = await createRes.json();
  const recordId = created?.id ?? created?.record?.id ?? created?.data?.id;
  expect(recordId, 'created task id').toBeTruthy();

  try {
    const recordPath = `/apps/${APP}/${OBJECT}/record/${encodeURIComponent(recordId)}`;
    await page.goto(`${recordPath}/edit`);
    const form = page.getByTestId('record-form-page');
    await expect(form).toHaveAttribute('data-mode', 'edit');

    const title = form.locator('input[name="title"]');
    await expect(title).toHaveValue(`E2E Direct URL ${stamp}`);
    const renamed = `E2E Direct URL renamed ${stamp}`;
    await title.fill(renamed);

    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) => ['PATCH', 'PUT'].includes(r.request().method()) && r.url().includes(`/api/v1/data/${OBJECT}/`),
        { timeout: 15_000 },
      ),
      form.locator('button[type="submit"]').click(),
    ]);
    expect(saved.ok(), `the save answered ${saved.status()}`).toBe(true);

    // The toast survives because the document did not unload…
    await expectToast(page, new RegExp(`Task "${renamed}" updated`));
    // …and the page landed on the record, inside the app.
    await expect(page).toHaveURL((url) => url.pathname === recordPath);
    await expect(page.getByTestId('record-form-page')).toHaveCount(0);

    const readRes = await request.get(`${API}/api/v1/data/${OBJECT}/${encodeURIComponent(recordId)}`);
    expect(readRes.ok(), `GET ${OBJECT}/${recordId} answered ${readRes.status()}`).toBe(true);
    expect((await readRes.json()).record?.title).toBe(renamed);
  } finally {
    await request.delete(`${API}/api/v1/data/${OBJECT}/${encodeURIComponent(recordId)}`);
  }
});
