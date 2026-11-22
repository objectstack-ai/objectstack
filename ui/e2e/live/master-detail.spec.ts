import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { selectOption, fillLookup, addLineItem } from './helpers';

/**
 * Live e2e for the master-detail entry form (showcase "New Project + Tasks").
 *
 * What this spec proves, per test, against the real backend:
 *   1. the click on Create sends ONE `POST /api/v1/batch` whose operations
 *      carry what the user typed (request shape: names WHICH half broke when a
 *      save fails — the form, or the server);
 *   2. the server answers that batch 2xx;
 *   3. the data API then reads back what the batch stored: the parent with the
 *      typed name, the chosen lookup and status, and (second test) the child
 *      task pointing at that parent's id.
 *
 * The regression it was written for is "click Create, nothing happens": a
 * `form.reset()` firing on a parent re-render between the click and the
 * deferred requestSubmit wiped the form, so RHF validated blank required
 * fields and never submitted. Step 1 guards that; steps 2 and 3 guard the
 * server half, which a request-only assertion reads green when the batch is
 * refused, stores only the parent, or drops the child's parent reference.
 *
 * Each test also checks the header still holds the typed name before it
 * clicks Create (objectstack#28471). A keystroke the form dropped used to
 * surface 15 s later as "no batch request": the click was refused by the
 * required-field check on a name the user had typed. The check names that
 * half at the line where it broke.
 *
 * Auth: the page writes with the bearer token global-setup puts in the app
 * origin's localStorage; the read-back goes through the `request` fixture,
 * which carries the better-auth session cookie of the same storageState.
 */
const PAGE = '/apps/showcase_app/page/showcase_project_workspace';
const API = process.env.LIVE_API_URL || 'http://localhost:3000';

/** Click Create and resolve with the batch response it provoked. */
async function submitBatch(page: Page): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/batch'),
      { timeout: 15_000 },
    ),
    page.getByTestId('md-form-submit').click(),
  ]);
  return response;
}

/** Assert the batch answered 2xx and return its per-operation results. */
async function batchResults(response: Response): Promise<any[]> {
  const body = await response.json().catch(() => null);
  expect(response.ok(), `POST /api/v1/batch answered ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  expect(Array.isArray(body?.results), `batch body carries results[]: ${JSON.stringify(body)}`).toBe(true);
  return body.results;
}

/** Read one stored record back through the data API. */
async function readBack(request: APIRequestContext, object: string, id: string) {
  const res = await request.get(`${API}/api/v1/data/${object}/${encodeURIComponent(id)}`);
  expect(res.ok(), `GET ${object}/${id} answered ${res.status()}`).toBe(true);
  return (await res.json()).record;
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'New Project + Tasks' })).toBeVisible();
});

test('the status select offers only the state the server admits on create', async ({ page }) => {
  // `project_status_flow` declares `initialStates: ['planned']`; every other
  // option would be refused 400 `invalid_initial_state` (#27763).
  await page.getByTestId('select-trigger-status').first().click();
  await expect(page.getByTestId('select-option-planned').first()).toBeVisible();
  for (const refused of ['active', 'on_hold', 'completed', 'cancelled']) {
    await expect(page.getByTestId(`select-option-${refused}`)).toHaveCount(0);
  }
});

test('Create stores the populated parent through one atomic batch', async ({ page, request }) => {
  const name = `E2E Project ${Date.now()}`;
  await page.locator('input[name="name"]').fill(name);
  await fillLookup(page, 'account', 'North');
  await selectOption(page, 'status', 'planned');
  await expect(page.getByText('Northwind', { exact: false })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue(name);

  const response = await submitBatch(page);

  const parentOp = response.request().postDataJSON()?.operations?.[0];
  expect(parentOp?.object).toBe('showcase_project');
  expect(parentOp?.data?.name).toBe(name);        // the form kept its value through submit
  expect(parentOp?.data?.account).toBeTruthy();    // lookup committed
  expect(parentOp?.data?.status).toBe('planned');  // Radix select committed

  const [parentResult] = await batchResults(response);
  expect(parentResult?.id, 'the batch echoes the created parent id').toBeTruthy();

  const stored = await readBack(request, 'showcase_project', parentResult.id);
  expect(stored?.name).toBe(name);
  expect(stored?.account).toBe(parentOp.data.account);
  expect(stored?.status).toBe('planned');
});

test('Create with a task line stores the child referencing the parent', async ({ page, request }) => {
  const name = `E2E MD ${Date.now()}`;
  await page.locator('input[name="name"]').fill(name);
  await fillLookup(page, 'account', 'North');
  // `planned` is the only status `project_status_flow` admits on create, and
  // the only one the select offers.
  await selectOption(page, 'status', 'planned');
  await expect(page.getByText('Northwind', { exact: false })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue(name);

  // `showcase_task` is a rich child, so its relationship smart-default resolves
  // to the per-row `form` factor: "Add task" opens the child's full form
  // inline (not editable grid cells). Fill the required fields and Apply to
  // stage the row, then save the whole thing as one atomic batch.
  await page.getByTestId('line-items-add').click();
  const editor = page.getByTestId('md-row-form');
  await expect(editor).toBeVisible();
  await editor.locator('input[name="title"]').fill('E2E Task A');
  await selectOption(editor, 'status', 'backlog');
  await editor.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor).toBeHidden();

  const response = await submitBatch(page);

  const ops = response.request().postDataJSON()?.operations ?? [];
  expect(ops[0]?.data?.name).toBe(name);
  // a child task op referencing the parent via $ref:0
  const childIndex = ops.findIndex((o: any) => o.object === 'showcase_task');
  expect(childIndex).toBeGreaterThan(0);
  expect(ops[childIndex]?.data?.title).toBe('E2E Task A');
  expect(ops[childIndex]?.data?.project).toEqual({ $ref: 0 });

  const results = await batchResults(response);
  const parentId = results[0]?.id;
  const childId = results[childIndex]?.id;
  expect(parentId, 'the batch echoes the created parent id').toBeTruthy();
  expect(childId, 'the batch echoes the created child id').toBeTruthy();

  const parent = await readBack(request, 'showcase_project', parentId);
  expect(parent?.name).toBe(name);
  expect(parent?.status).toBe('planned');
  const child = await readBack(request, 'showcase_task', childId);
  expect(child?.title).toBe('E2E Task A');
  expect(child?.project).toBe(parentId);
});

/**
 * objectstack#36102 — the line-item grid's body left the console's eager chunk:
 * `@object-ui/fields` exports a lazy face whose body loads through one
 * `import()`, which the record forms start when they mount and wait for with
 * the child schema they derive the columns from. On a form's FIRST open the
 * grid must therefore mount on its body, never on its loading placeholder
 * (`grid-field-loading`), and a cell the user is typing in must keep focus.
 *
 * The observer is installed before the document's first byte, so it sees every
 * attach of the placeholder, however brief. Its control is the grid itself: the
 * same observer must have seen `line-items` attach, or a zero count would only
 * say the observer saw nothing.
 */
test.describe('the line-item grid on a form\'s first open (objectstack#36102)', () => {
  const INVOICES = '/apps/showcase_app/showcase_invoice';

  /** Count every attach of the placeholder and of the grid, from document start. */
  async function watchGridMounts(page: Page) {
    await page.addInitScript(() => {
      const seen = { placeholder: 0, grid: 0 };
      (window as unknown as { __gridMounts: typeof seen }).__gridMounts = seen;
      const count = (node: Node) => {
        if (!(node instanceof Element)) return;
        seen.placeholder += node.matches('[data-testid="grid-field-loading"]') ? 1 : 0;
        seen.placeholder += node.querySelectorAll('[data-testid="grid-field-loading"]').length;
        seen.grid += node.matches('[data-testid="line-items"]') ? 1 : 0;
        seen.grid += node.querySelectorAll('[data-testid="line-items"]').length;
      };
      new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach(count);
      }).observe(document, { childList: true, subtree: true });
    });
  }

  const gridMounts = (page: Page) =>
    page.evaluate(() => (window as unknown as { __gridMounts: { placeholder: number; grid: number } }).__gridMounts);

  /** Type into the first Description cell and check the cell kept focus and the text. */
  async function typeKeepsFocus(page: Page, scope: ReturnType<Page['getByTestId']>) {
    const cell = scope.locator('input[aria-label="Description"]').first();
    await cell.click();
    // A stored line already has text: type at its end, not where the click landed.
    await cell.press('End');
    await cell.pressSequentially('first-open');
    // A beat for any late remount to land before it is checked.
    await page.waitForTimeout(300);
    await expect(cell).toBeFocused();
    await expect(cell).toHaveValue(/first-open$/);
  }

  test('the New Invoice form draws its line grid on its body, and a typed cell keeps focus', async ({ page }) => {
    await watchGridMounts(page);
    await page.goto(INVOICES);
    await page.getByTestId('object-view-new-button').first().click();
    const dialog = page.getByRole('dialog');
    const grid = dialog.getByTestId('line-items');
    await expect(grid).toBeVisible();

    await addLineItem(page);
    await typeKeepsFocus(page, grid);

    const mounts = await gridMounts(page);
    expect(mounts.grid, 'the observer saw the grid attach (its control)').toBeGreaterThan(0);
    expect(mounts.placeholder, 'the grid never mounted on its loading placeholder').toBe(0);
  });

  test('an invoice edit form draws its stored lines on the body, and a typed cell keeps focus', async ({ page, request }) => {
    const res = await request.get(`${API}/api/v1/data/showcase_invoice?$top=50`);
    expect(res.ok(), `GET showcase_invoice answered ${res.status()}`).toBe(true);
    const body = await res.json();
    const invoice = (body?.records ?? body?.data ?? []).find((r: { name?: string }) => r.name === 'INV-1002');
    expect(invoice, 'the seeded draft invoice INV-1002 exists').toBeTruthy();

    await watchGridMounts(page);
    await page.goto(`${INVOICES}/record/${encodeURIComponent(invoice.id ?? invoice._id)}/edit`);
    const grid = page.getByTestId('line-items');
    await expect(grid).toBeVisible();
    await expect(grid.locator('input[aria-label="Description"]').first()).not.toHaveValue('');

    await typeKeepsFocus(page, grid);

    const mounts = await gridMounts(page);
    expect(mounts.grid, 'the observer saw the grid attach (its control)').toBeGreaterThan(0);
    expect(mounts.placeholder, 'the grid never mounted on its loading placeholder').toBe(0);
  });
});
