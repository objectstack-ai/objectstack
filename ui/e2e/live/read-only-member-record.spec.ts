import { test, expect, type Page } from '@playwright/test';
import { signInMember } from './member';

/**
 * objectstack#27552 — a member who may READ a record but not WRITE it is
 * refused coherently by the Console, against the real server.
 *
 * Access is the defect class the admin-only live suite cannot see: the seeded
 * admin passes every check. #27138 is the escape this spec stands guard over:
 * the edit dialog offered editable fields on a row the caller could read but
 * not write, and the save was refused whole.
 *
 * The member holds the showcase's own `showcase_manager` set: on
 * `showcase_inquiry` (OWD `private`) it reads org-wide but writes only its own
 * rows (`readScope: 'org'`, `writeScope: 'own'`). An inquiry the admin creates
 * is therefore readable and not writable for the member: a ROW verdict, not an
 * object-level one, which is the shape #27138 had.
 *
 * What is asserted, in order:
 *  1. the premise, through the server: the member's read of the record answers
 *     and its update is refused (`PERMISSION_DENIED`, 403), so the UI half below
 *     can never pass on a record the member could write after all;
 *  2. as the member, the edit form opened by URL (`?form=`) says the record is
 *     read-only (`closed-affordance-notice`), draws every field disabled and
 *     offers no submit; the record page under it offers neither the Edit button
 *     nor the inline-edit pencils; and the member's browser sent no write;
 *  3. control, as the admin: the same form on the same record has no notice,
 *     the same record page offers Edit and the pencils (so step 2's absences are
 *     not a selector that finds nothing), and a save through the form persists.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const OBJECT = 'showcase_inquiry';
const recordPath = (id: string) => `/apps/showcase_app/${OBJECT}/record/${id}`;
const formPath = (id: string) => `${recordPath(id)}?form=${encodeURIComponent(id)}`;

// The record header's Edit CTA and the record body's inline-edit pencils carry
// no test id; their accessible names are the `detail.edit` and
// `detail.editInlineHint` strings, en or zh.
const editButton = (page: Page) => page.getByRole('button', { name: /^(Edit|编辑)$/ });
const inlineEditPencils = (page: Page) => page.getByRole('button', { name: /^(Double-click to edit|双击编辑)$/ });

test.use({ viewport: { width: 1440, height: 900 } });

test('a member who may read but not write an inquiry gets a read-only form and no edit affordance; the admin edits it', async ({
  browser,
  page,
  request,
  playwright,
}) => {
  // Three page loads in two browser contexts, one of them cold.
  test.setTimeout(120_000);
  // The record: created by the admin, so the admin owns it.
  const name = `Read-only member e2e ${Date.now()}`;
  const createRes = await request.post(`${API}/api/v1/data/${OBJECT}`, {
    data: { name, email: 'read-only-member@example.com', message: 'Created by the live access spec.' },
  });
  expect(createRes.ok(), `admin create answered ${createRes.status()}`).toBe(true);
  const created = await createRes.json();
  const id: string = created.id ?? created.record?.id ?? created.data?.id;
  expect(id, 'the created inquiry id').toBeTruthy();

  const member = await signInMember(request, 'showcase_manager');

  await test.step('premise: the server lets the member read the record and refuses its update', async () => {
    const api = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${member.token}` } });
    try {
      const read = await api.get(`${API}/api/v1/data/${OBJECT}/${id}`);
      expect(read.status(), 'the member reads the admin-owned inquiry').toBe(200);
      const write = await api.patch(`${API}/api/v1/data/${OBJECT}/${id}`, { data: { company: 'Member write' } });
      expect(write.status(), 'the member update is refused').toBe(403);
      expect((await write.json()).code).toBe('PERMISSION_DENIED');
    } finally {
      await api.dispose();
    }
  });

  await test.step('as the member: a read-only form with a named notice, no edit affordance, no write sent', async () => {
    const context = await browser.newContext({
      storageState: member.storageState,
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 1440, height: 900 },
    });
    try {
      const memberPage = await context.newPage();
      const writes: string[] = [];
      memberPage.on('request', (r) => {
        if (r.method() !== 'GET' && r.url().includes(`/api/v1/data/${OBJECT}`)) writes.push(`${r.method()} ${r.url()}`);
      });

      await memberPage.goto(formPath(id));
      const dialog = memberPage.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      // The notice is drawn from the server's row verdict, so once it shows the
      // verdict has arrived and the absences below are not read too early.
      await expect(dialog.getByTestId('closed-affordance-notice')).toBeVisible({ timeout: 30_000 });
      for (const field of ['name', 'email', 'company', 'message']) {
        await expect(dialog.locator(`[name="${field}"]`), `${field} is drawn read-only`).toBeDisabled();
      }
      await expect(dialog.getByTestId('modal-form-footer').locator('button[type="submit"]')).toHaveCount(0);

      await memberPage.goto(recordPath(id));
      await expect(memberPage.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByRole('button', { name: /^(More actions|更多操作)$/ })).toBeVisible();
      await expect(editButton(memberPage)).toHaveCount(0);
      await expect(inlineEditPencils(memberPage)).toHaveCount(0);

      expect(writes, 'the member browser attempted no write').toEqual([]);
    } finally {
      await context.close();
    }
  });

  await test.step('control, as the admin: the same form is editable and its save persists', async () => {
    await page.goto(recordPath(id));
    await expect(editButton(page)).toBeVisible({ timeout: 30_000 });
    await expect(inlineEditPencils(page).first()).toBeVisible();

    await page.goto(formPath(id));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const company = dialog.locator('input[name="company"]');
    await expect(company).toBeEnabled({ timeout: 30_000 });
    await expect(dialog.getByTestId('closed-affordance-notice')).toHaveCount(0);

    const value = `Admin edit ${Date.now()}`;
    await company.fill(value);
    const saved = page.waitForResponse(
      (r) => r.request().method() !== 'GET' && r.url().includes(`/api/v1/data/${OBJECT}/${id}`),
    );
    await dialog.getByTestId('modal-form-footer').locator('button[type="submit"]').click();
    expect((await saved).ok(), 'the admin save answered 2xx').toBe(true);

    const after = await (await request.get(`${API}/api/v1/data/${OBJECT}/${id}`)).json();
    expect((after.record ?? after.data ?? after).company).toBe(value);
  });
});
