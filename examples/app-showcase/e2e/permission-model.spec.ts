import { test, expect, request as pwRequest } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Permission-model e2e (ADR-0090 / docs/design/permission-model.md).
 *
 * Repeatable evidence for the permission-model test checklist
 * (docs/test/permission-model-test-checklist.md). The exhaustive REST matrix
 * lives in docs/test/scripts/perm-test.sh; this spec re-verifies the
 * representative REST cases in TypeScript and then walks the console UI
 * (checklist section L), saving screenshots into docs/test/screenshots/.
 *
 * Run (see playwright.permission.config.ts):
 *   PERM_BASE_URL=http://localhost:3777 pnpm exec playwright test --config playwright.permission.config.ts
 *
 * The spec provisions its own personas (sign-up + position/BU assignment via
 * the admin API) and is idempotent, so it also works against a freshly booted
 * `objectstack dev --seed-admin` instance.
 */

const BASE = process.env.PERM_BASE_URL || 'http://localhost:3000';
const PASSWORD = 'Passw0rd!234';
const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_PASSWORD = 'admin123';
const SHOTS = 'docs/test/screenshots';

const PERSONAS: { email: string; name: string; position?: string; bu?: string }[] = [
  { email: 'ada@example.com', name: 'Ada', position: 'contributor' },
  { email: 'mia@example.com', name: 'Mia', position: 'manager' },
  { email: 'max@example.com', name: 'Max', position: 'exec' },
  { email: 'audrey@example.com', name: 'Audrey', position: 'auditor' },
  { email: 'oskar@example.com', name: 'Oskar', position: 'ops' },
  { email: 'dana@example.com', name: 'Dana', position: 'field_ops_delegate', bu: 'bu_field_ops' },
  { email: 'wes@example.com', name: 'Wes', bu: 'bu_west_coast' },
  { email: 'newbie@example.com', name: 'Newbie' },
];

async function signIn(email: string, password = PASSWORD) {
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const res = await anon.post('/api/v1/auth/sign-in/email', {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`sign-in ${email} failed (${res.status()}): ${await res.text()}`);
  const token = ((await res.json()) as { token: string }).token;
  const cookies = (await anon.storageState()).cookies;
  await anon.dispose();
  const api = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  return { token, cookies, api };
}

/** Console reads the bearer token from localStorage `auth-session-token`. */
async function uiContext(browser: Browser, email: string): Promise<BrowserContext> {
  const { token, cookies } = await signIn(email);
  return browser.newContext({
    storageState: {
      cookies,
      origins: [{ origin: BASE, localStorage: [{ name: 'auth-session-token', value: token }] }],
    },
  });
}

async function records(api: APIRequestContext, path: string): Promise<Record<string, unknown>[]> {
  const res = await api.get(`/api/v1/data/${path}`);
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBe(true);
  return ((await res.json()) as { records?: Record<string, unknown>[] }).records ?? [];
}

async function openObjectList(page: Page, object: string) {
  await page.goto(`${BASE}/_console/apps/showcase_app/${object}`);
  // First paint may show the workspace-init splash; the record count footer
  // (or the empty state) marks the grid as settled.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

let admin: APIRequestContext;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  admin = (await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).api;

  // -- provision personas (idempotent) --------------------------------------
  const anon = await pwRequest.newContext({ baseURL: BASE });
  for (const p of PERSONAS) {
    // Existing accounts answer 4xx; that's fine.
    await anon.post('/api/v1/auth/sign-up/email', {
      data: { email: p.email, password: PASSWORD, name: p.name },
      headers: { 'Content-Type': 'application/json' },
    });
  }
  await anon.dispose();

  const users = await records(admin, 'sys_user?limit=200');
  const idOf = (email: string) => users.find((u) => u.email === email)?.id as string | undefined;

  const held = await records(admin, 'sys_user_position?limit=500');
  for (const p of PERSONAS.filter((p) => p.position)) {
    const uid = idOf(p.email);
    expect(uid, `user ${p.email} must exist`).toBeTruthy();
    if (!held.some((h) => h.user_id === uid && h.position === p.position)) {
      const res = await admin.post('/api/v1/data/sys_user_position', {
        data: { user_id: uid, position: p.position },
      });
      expect(res.ok(), `assign ${p.position} to ${p.email} -> ${res.status()}`).toBe(true);
    }
  }

  const members = await records(admin, 'sys_business_unit_member?limit=500');
  for (const p of PERSONAS.filter((p) => p.bu)) {
    const uid = idOf(p.email);
    if (!members.some((m) => m.user_id === uid && m.business_unit_id === p.bu)) {
      const res = await admin.post('/api/v1/data/sys_business_unit_member', {
        data: { user_id: uid, business_unit_id: p.bu },
      });
      expect(res.ok(), `add ${p.email} to ${p.bu} -> ${res.status()}`).toBe(true);
    }
  }
});

test.afterAll(async () => {
  await admin?.dispose();
});

// ---------------------------------------------------------------------------
// REST — representative cases per checklist section (full matrix: perm-test.sh)
// ---------------------------------------------------------------------------

test.describe.serial('REST representative cases', () => {
  test('A. capability gate — ada cannot create a project, can read products (baseline union)', async () => {
    const { api } = await signIn('ada@example.com');
    const create = await api.post('/api/v1/data/showcase_project', { data: { name: 'perm-e2e-proj' } });
    expect(create.status()).toBe(403);
    const products = await api.get('/api/v1/data/showcase_product?limit=5');
    expect(products.ok()).toBe(true);
    await api.dispose();
  });

  test('B. FLS — ada cannot change showcase_project.budget (editable:false)', async () => {
    const { api } = await signIn('ada@example.com');
    const audit = (await records(api, 'showcase_project?limit=50')).find((p) =>
      String(p.name).includes('Compliance'),
    );
    expect(audit).toBeTruthy();
    const before = ((await (await api.get(`/api/v1/data/showcase_project/${audit!.id}`)).json()) as {
      record: { budget: number };
    }).record.budget;
    await api.patch(`/api/v1/data/showcase_project/${audit!.id}`, { data: { budget: before + 5000 } });
    const after = ((await (await admin.get(`/api/v1/data/showcase_project/${audit!.id}`)).json()) as {
      record: { budget: number };
    }).record.budget;
    expect(after, 'budget must be unchanged (rejected or stripped)').toBe(before);
    await api.dispose();
  });

  test('G. RLS — ada sees only her tasks and invoices', async () => {
    const { api } = await signIn('ada@example.com');
    const tasks = await records(api, 'showcase_task?limit=200');
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.every((t) => t.assignee === 'ada@example.com')).toBe(true);
    const invoices = await records(api, 'showcase_invoice?limit=100');
    expect(invoices.map((i) => i.name).sort()).toEqual(['INV-1001', 'INV-1002']);
    await api.dispose();
  });

  test('G4/G5. write-time check (ADR-0058 D4) — owner transfer blocked, same-owner update passes', async () => {
    const { api } = await signIn('ada@example.com');
    const inv = (await records(api, 'showcase_invoice?limit=100')).find((i) => i.name === 'INV-1001')!;
    const steal = await api.patch(`/api/v1/data/showcase_invoice/${inv.id}`, {
      data: { owner: 'linus@example.com' },
    });
    // Regression guard for the computeWriteCheckFilter fix: a `check` policy
    // scoped to positions must fire for holders of those positions.
    expect(steal.status()).toBe(403);
    const keep = await api.patch(`/api/v1/data/showcase_invoice/${inv.id}`, {
      data: { status: inv.status },
    });
    expect(keep.ok()).toBe(true);
    await api.dispose();
  });

  test('F. VAMA — audrey (viewAllRecords) sees every invoice, read-only', async () => {
    const { api } = await signIn('audrey@example.com');
    const all = await records(admin, 'showcase_invoice?limit=100');
    const mine = await records(api, 'showcase_invoice?limit=100');
    expect(mine.length).toBe(all.length);
    const write = await api.patch(`/api/v1/data/showcase_invoice/${all[0].id}`, {
      data: { customer: 'vama-write-attempt' },
    });
    expect(write.status()).toBeGreaterThanOrEqual(400);
    await api.dispose();
  });

  test('D. depth — mia (readScope:org) sees seed inquiries, newbie does not', async () => {
    const seed = /meridian|brightline|oldrequest/;
    const mia = await signIn('mia@example.com');
    const miaSeed = (await records(mia.api, 'showcase_inquiry?limit=100')).filter((i) =>
      seed.test(String(i.email)),
    );
    expect(miaSeed.length).toBe(3);
    await mia.api.dispose();
    const newbie = await signIn('newbie@example.com');
    const nbSeed = (await records(newbie.api, 'showcase_inquiry?limit=100')).filter((i) =>
      seed.test(String(i.email)),
    );
    expect(nbSeed.length).toBe(0);
    await newbie.api.dispose();
  });
});

// ---------------------------------------------------------------------------
// L. console UI evidence (screenshots into docs/test/screenshots/)
// ---------------------------------------------------------------------------

test.describe.serial('L. console UI', () => {
  test('L1 — ada task list shows only her own tasks (RLS)', async ({ browser }) => {
    const ctx = await uiContext(browser, 'ada@example.com');
    const page = await ctx.newPage();
    await openObjectList(page, 'showcase_task');
    const body = await page.locator('body').innerText();
    expect(body).toContain('ada@example.com');
    // Seed assigns other tasks to these users; RLS must hide them.
    expect(body).not.toContain('linus@example.com');
    expect(body).not.toContain('grace@example.com');
    expect(body).not.toContain('sam@example.com');
    await shot(page, 'L1-ada-tasks-rls');
    await ctx.close();
  });

  test('L2 — ada invoice list shows only INV-1001/INV-1002 (RLS + owner)', async ({ browser }) => {
    const ctx = await uiContext(browser, 'ada@example.com');
    const page = await ctx.newPage();
    await openObjectList(page, 'showcase_invoice');
    const body = await page.locator('body').innerText();
    expect(body).toContain('INV-1001');
    expect(body).toContain('INV-1002');
    expect(body).not.toContain('INV-1003');
    expect(body).not.toContain('INV-1004');
    await shot(page, 'L2-ada-invoices-rls');
    await ctx.close();
  });

  test('L3 — audrey (viewAllRecords) sees all inquiries and foreign private notes', async ({
    browser,
  }) => {
    // A private note owned by newbie proves the VAMA bypass visually.
    const newbie = await signIn('newbie@example.com');
    const created = await newbie.api.post('/api/v1/data/showcase_private_note', {
      data: { title: 'ui-evidence-newbie-note' },
    });
    expect(created.ok()).toBe(true);
    const noteId = ((await created.json()) as { id: string }).id;
    await newbie.api.dispose();

    const ctx = await uiContext(browser, 'audrey@example.com');
    const page = await ctx.newPage();
    await openObjectList(page, 'showcase_inquiry');
    const adminCount = (await records(admin, 'showcase_inquiry?limit=200')).length;
    const audrey = await signIn('audrey@example.com');
    const audreyCount = (await records(audrey.api, 'showcase_inquiry?limit=200')).length;
    await audrey.api.dispose();
    expect(audreyCount).toBe(adminCount);
    await shot(page, 'L3a-audrey-inquiries-vama');

    await openObjectList(page, 'showcase_private_note');
    await expect(page.locator('body')).toContainText('ui-evidence-newbie-note');
    await shot(page, 'L3b-audrey-private-notes-vama');
    await ctx.close();

    await admin.delete(`/api/v1/data/showcase_private_note/${noteId}`);
  });

  test('L4 — newbie inquiry list is empty (private OWD)', async ({ browser }) => {
    const ctx = await uiContext(browser, 'newbie@example.com');
    const page = await ctx.newPage();
    await openObjectList(page, 'showcase_inquiry');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/meridian|brightline|oldrequest/);
    const newbie = await signIn('newbie@example.com');
    expect((await records(newbie.api, 'showcase_inquiry?limit=200')).length).toBe(0);
    await newbie.api.dispose();
    await shot(page, 'L4-newbie-inquiries-empty');
    await ctx.close();
  });

  test('L5 — ada edit form: budget locked by FLS, other fields editable', async ({ browser }) => {
    const ada = await signIn('ada@example.com');
    const project = (await records(ada.api, 'showcase_project?limit=50')).find(
      (p) => p.name === 'Website Relaunch',
    )!;
    await ada.api.dispose();

    const ctx = await uiContext(browser, 'ada@example.com');
    const page = await ctx.newPage();
    await page.goto(`${BASE}/_console/apps/showcase_app/showcase_project/record/${project.id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^(编辑|Edit)$/ }).first().click();

    const dialog = page.locator('[role="dialog"]');
    // The form hydrates disabled, then enables writable fields.
    await expect(dialog.locator('input[name="name"]')).toBeEnabled({ timeout: 15_000 });
    await expect(dialog.locator('input[name="budget"]')).toBeDisabled();
    await expect(dialog.locator('select[name="status"]')).toBeEnabled();
    // The dialog scrolls internally — bring the FLS-locked budget field into
    // the viewport so the evidence screenshot actually shows it disabled.
    await dialog.locator('input[name="budget"]').scrollIntoViewIfNeeded();
    await shot(page, 'L5-ada-project-budget-fls-locked');
    await ctx.close();
  });
});
