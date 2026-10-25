import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Live dogfood verification for the record-level inline edit polish
 * (objectui#2572 / PR #2604) against the REAL showcase stack:
 *
 *   1. $expand-ed lookup values pass through to the picker — the Account chip
 *      shows "Northwind" with ZERO hydration findOne fetches;
 *   2. approval-lock preflight — saving a budget change fires
 *      `showcase_budget_approval`. Its first step (`manager_review`) declares
 *      `lockRecord: false`, so the re-read approval state reads "In approval ·
 *      editable" and the inline edit affordances stay live. Approving that step
 *      routes a budget above 500k to `exec_review` (`lockRecord: true`), and
 *      the re-read lock state hides the inline edit affordances (enter()
 *      no-ops);
 *   3. currency edits in a real number input carrying metadata min/step;
 *   4. the header Edit CTA is disabled while the inline session is live;
 *   5. Esc cancels / Ctrl+Enter saves the shared session.
 *
 * Prereqs: showcase backend + console dev server (see playwright.live.config.ts;
 * override via LIVE_APP_URL / LIVE_API_URL). The test creates its own project;
 * its budget change opens an approval request on it, and the test approves the
 * first step so the record ends locked — run against a throwaway database.
 */

const APP = process.env.SHOWCASE_APP || 'com.example.showcase';
const API = process.env.LIVE_API_URL || 'http://localhost:3000';

// Remote sandbox: the pinned headless-shell build isn't installed; use the
// preinstalled full Chromium instead of downloading (per environment policy).
if (process.env.PW_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });
}

/**
 * Rooted on THIS FILE, never on `process.cwd()` (objectui#9188): a bare relative
 * path handed to `readFileSync` names no root, so it gets the ambient one and
 * the read lands in a different tree depending on the directory the run was
 * launched from.
 *
 * Bare `import.meta.url` taken apart by hand — the spelling PR #7796 landed and
 * PR #7806 reused. ⛔ Not `new URL(rel, import.meta.url)`: this repo prescribes
 * one spelling, on grounds of spelling uniqueness (objectui#9191).
 *
 * This is a PLAYWRIGHT spec, so the Vitest measurements behind that rule do not
 * cover it and objectui#8953 registered this read rather than repair it blind.
 * Measured for objectui#9188 under `playwright.live.config.ts`: `import.meta.url`
 * arrives as this file's own absolute `file:` URL, identical from two different
 * launch directories, while the bare relative path moved between them.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 3; // e2e / live / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

const EDIT_HINT = 'Double-click to edit';

function authToken(): string {
  const state = JSON.parse(readFileSync(join(REPO_ROOT, 'e2e/live/.auth/state.json'), 'utf8'));
  const entry = state.origins?.[0]?.localStorage?.find((e: any) => e.name === 'auth-session-token');
  if (!entry) throw new Error('No auth-session-token in storage state');
  return entry.value;
}

test('record inline-edit polish (#2572) — showcase Project end-to-end', async ({ page, request }) => {
  test.setTimeout(240_000);

  // ── A project of its own, created through the API (authoritative). The
  //    budget change below opens an approval request and moves the budget, so
  //    driving the seeded "Website Relaunch" spent it: a second run met a
  //    different budget and an already-pending request. Same shape as that
  //    seed row — Northwind's account, a 150k budget, 60k spent — and born
  //    `planned`, the status flow's only entry state. ──
  const token = authToken();
  const authHeader = { Authorization: `Bearer ${token}` };
  const accountsRes = await request.get(`${API}/api/v1/data/showcase_account?$top=50`, {
    headers: authHeader,
  });
  expect(accountsRes.ok()).toBeTruthy();
  const accountsBody = await accountsRes.json();
  const accounts: any[] = accountsBody?.records ?? accountsBody?.data ?? [];
  const northwind = accounts.find((r) => r.name === 'Northwind');
  expect(northwind, 'seeded "Northwind" account exists').toBeTruthy();
  const projectName = `Inline Polish ${Date.now()}`;
  const createRes = await request.post(`${API}/api/v1/data/showcase_project`, {
    headers: authHeader,
    data: {
      name: projectName,
      account: northwind.id ?? northwind._id,
      status: 'planned',
      health: 'green',
      budget: 150000,
      spent: 60000,
    },
  });
  expect(createRes.ok(), await createRes.text()).toBeTruthy();
  const created = await createRes.json();
  const recordId = created?.id ?? created?.record?.id ?? created?.data?.id;
  expect(recordId, 'created project id').toBeTruthy();

  // ── Open the record page. ──
  await page.goto(`/apps/${APP}/showcase_project/record/${recordId}`);
  await expect(page.getByRole('heading', { name: projectName }).first()).toBeVisible({
    timeout: 30_000,
  });

  const headerToolbar = page.getByRole('toolbar', { name: 'Page header actions' });
  const headerEdit = headerToolbar.getByRole('button', { name: 'Edit', exact: true });
  await expect(headerEdit, 'header Edit CTA enabled before any session').toBeEnabled();

  // ── Item 1 instrumentation: count lookup hydration fetches from now on. ──
  const accountHydrations: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/data\/showcase_account\/[^/?]+/.test(r.url())) accountHydrations.push(r.url());
  });

  // ── Enter the shared inline-edit session (double-click a details-body field). ──
  const spentGroup = page
    .locator('div.group')
    .filter({ has: page.getByText('Spent', { exact: true }) })
    .last();
  await spentGroup.locator(`[title="${EDIT_HINT}"]`).dblclick();

  const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
  await expect(saveBtn, 'save bar appears once the session is live').toBeVisible();

  // ── Item 3: budget edits in a real numeric input with metadata min/step. ──
  const budgetInput = page.locator('input[type="number"][min="0"][step="0.01"]').first();
  await expect(budgetInput, 'currency renders as number input with min=0 step=0.01').toBeVisible();
  await expect(budgetInput).toHaveValue('150000');

  // ── Item 1: the Account picker shows the expanded record's name with no re-fetch. ──
  await expect(page.getByText('Northwind', { exact: true }).first()).toBeVisible();
  expect(accountHydrations, 'no findOne hydration fetch for the expanded account value').toEqual([]);

  // ── Item 4: header Edit CTA disabled while the session is live. ──
  await expect(headerEdit, 'header Edit CTA disabled during inline session').toBeDisabled();

  // ── Item 5a: Esc cancels the session (no popover open). ──
  await page.keyboard.press('Escape');
  await expect(saveBtn, 'Esc tears the session down').toBeHidden();
  await expect(headerEdit, 'header Edit CTA re-enabled after cancel').toBeEnabled();

  // ── Item 5b: re-enter, change the budget, Ctrl+Enter commits ONE atomic PATCH. ──
  const budgetGroup = page
    .locator('div.group')
    .filter({ has: page.getByText('Budget', { exact: true }) })
    .last();
  await budgetGroup.locator(`[title="${EDIT_HINT}"]`).dblclick();
  await expect(saveBtn).toBeVisible();
  const budgetInput2 = page.locator('input[type="number"][min="0"][step="0.01"]').first();
  // Above the flow's 500k decision edge, so approving `manager_review` routes
  // the request on to the locking `exec_review` step (item 2).
  await budgetInput2.fill('600000');
  const patchPromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'PATCH' &&
      res.url().includes(`/data/showcase_project/`) &&
      res.ok(),
    { timeout: 20_000 },
  );
  await page.keyboard.press('Control+Enter');
  const patchRes = await patchPromise;
  const patchBody = patchRes.request().postDataJSON?.() ?? {};
  expect(Number(patchBody.budget), 'PATCH carries the edited budget').toBe(600000);
  expect(patchBody, 'PATCH carries ONLY the edited key').not.toHaveProperty('spent');
  await expect(saveBtn, 'session ends after a successful save').toBeHidden({ timeout: 15_000 });

  // ── Item 2: the budget change (>100k, changed) fires showcase_budget_approval.
  //    (This backend does NOT materialize `approval_status` on the record — the
  //    lock signal is the pending request from the approvals API, the second
  //    branch of RecordDetailView's approval state, and its `lock_record` flag
  //    carries the step's `lockRecord` policy.) ──
  /** The approvals API's request row, as far as this test reads it. */
  type ApprovalRequestRow = { id: string; status: string; flow_node_id?: string; lock_record?: boolean };
  const pendingRequests = async () => {
    const res = await request.get(
      `${API}/api/v1/approvals/requests?object=showcase_project&recordId=${recordId}`,
      { headers: authHeader },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    return ((body?.data ?? []) as ApprovalRequestRow[]).filter((r) => r.status === 'pending');
  };
  const budgetGroupOnPage = () =>
    page.locator('div.group').filter({ has: page.getByText('Budget', { exact: true }) }).last();

  // 2a. The request opens on its first step, `manager_review`, which declares
  //     `lockRecord: false` — the showcase's unlocked-step fixture
  //     (objectui#2902). The re-read approval state reads "In approval ·
  //     editable" and the inline edit affordances stay live.
  let managerReview: ApprovalRequestRow | undefined;
  await expect
    .poll(
      async () => {
        managerReview = (await pendingRequests()).find((r) => r.flow_node_id === 'manager_review');
        return managerReview?.lock_record;
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(false);

  await page.reload();
  await page.getByRole('heading', { name: projectName }).first().waitFor({ timeout: 20_000 });
  await expect(
    page.getByRole('status').filter({ hasText: 'In approval · editable' }),
    'an unlocked approval step reads "In approval · editable"',
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Locked for approval')).toHaveCount(0);
  // A double-click on the budget still opens an inline-edit session.
  await budgetGroupOnPage().locator(`[title="${EDIT_HINT}"]`).dblclick();
  await expect(saveBtn, 'inline editing stays live during an unlocked approval').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saveBtn).toBeHidden();

  // 2b. Approve `manager_review` through the approvals API (the seeded admin
  //     holds the `manager` position). The budget is above 500k, so the run
  //     moves on to `exec_review`, which declares `lockRecord: true`.
  const approveRes = await request.post(`${API}/api/v1/approvals/requests/${managerReview!.id}/approve`, {
    headers: authHeader,
    data: { comment: 'e2e: route the request on to exec_review' },
  });
  expect(approveRes.ok(), await approveRes.text()).toBeTruthy();
  await expect
    .poll(
      async () => (await pendingRequests()).find((r) => r.flow_node_id === 'exec_review')?.lock_record,
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);

  // Fresh mount reads the locking request → locked → zero inline-edit
  // affordances anywhere on the page…
  await expect
    .poll(
      async () => {
        await page.reload();
        await page.getByRole('heading', { name: projectName }).first().waitFor({ timeout: 20_000 });
        // Editable-record pages render the hint; wait a beat for hydration
        // so an empty count means "locked", not "not yet rendered".
        await page.waitForTimeout(1_500);
        return page.locator(`[title="${EDIT_HINT}"]`).count();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(0);
  await expect(page.getByText('Locked for approval').first()).toBeVisible();

  // …and a double-click on the (former) budget field must NOT open a session.
  await budgetGroupOnPage().dblclick();
  await expect(saveBtn).toBeHidden();
});
