// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals QUEUE — the rows, and the amount sort, honour each row's own
 * object `hidden: true` declaration (objectui#6020).
 *
 * ## The defect
 *
 * objectui#5565 put the filter INSIDE `decisionAmountEntry` behind an optional
 * `hiddenKeys` parameter, and passed it at exactly one of five call sites — the
 * drawer. The desktop row, the mobile card and both halves of the amount
 * comparator called it bare, so a field the author declared `hidden: true`
 * still rendered inline in the queue and still ordered the list. A filter
 * present in a function body but unpassed at the call site reads exactly like a
 * fixed defect, which is why this file measures the CALL SITES.
 *
 * ## ⚠️ Why the fixture spans TWO objects — the naive fix passes a one-object test
 *
 * The obvious repair is to thread the page's existing `hiddenPayloadKeys` into
 * the four sites. That set is keyed to the OPEN request (`useHiddenFields(
 * selected?.object_name)`), while the queue is N rows spanning K objects, so it
 * would apply one object's declarations to every row: fields hidden on rows
 * whose object never declared them, fields missed on rows whose object did.
 * A single-object fixture cannot tell that apart from the real fix, so the
 * fixture below is two objects with DIFFERENT declarations and asserts both
 * directions:
 *
 *   showcase_purchase — declares `total_amount` hidden
 *   showcase_invoice  — declares `service_fee` hidden, `total_amount` NOT
 *
 *   row P  (purchase) `total_amount` → trimmed   … the reported defect
 *   row I1 (invoice)  `total_amount` → RENDERS   … ⭐ the naive fix hides this
 *   row I2 (invoice)  `service_fee`  → trimmed   … ⭐ a one-object fix misses this
 *
 * ## Why the trimmed row still shows a figure
 *
 * Row P carries a second, undeclared amount key (`freight_cost`) after the
 * hidden one. Trimmed, the row renders THAT — so the drop happens inside the
 * scan, before the field is chosen, and "the amount is gone" cannot be
 * satisfied by a row that simply stopped rendering amounts. It is the same
 * promotion signal the side sheet's `ApprovalsInboxPage.hiddenFieldTrim.test.tsx`
 * used for its 6-field cut, transposed onto the pick; that pin retired with the
 * sheet (objectui#12484), against
 * `approvalRequestsDataSource.servedPageSummary-12483.test.tsx`.
 *
 * ## Why every figure is asserted TWICE
 *
 * The queue ships two surfaces — the desktop table row and the `md:hidden`
 * mobile card — and both are in the DOM here (no stylesheet applies media
 * queries). A rendered figure is therefore exactly 2 nodes and a trimmed one
 * exactly 0, which fails a fix that repairs one surface and forgets the other.
 *
 * ## The sort is the half that leaks without rendering anything
 *
 * Ordering IS disclosure: sorting on a hidden figure tells a viewer who never
 * sees it how it compares to every other row. The posture pinned below is
 * **the queue orders on exactly the figure it renders** — a row left with no
 * renderable amount sinks with the other amount-less rows, which is the
 * behaviour that surface already has for a request with no amount at all.
 *
 * ## Counter-probes
 *
 * "The figure is gone" and "the row sank" are both satisfiable by breaking the
 * queue. So every denial case asserts the three record titles are still there,
 * and each half has a counter-probe running the SAME fixture with nothing
 * declared hidden, where the figure renders and the row sorts where its amount
 * puts it.
 *
 * No build artifact sits between the edit and this test: the root Vitest config
 * aliases every `@object-ui` specifier at that package's source directory, and
 * the page under test is this app's own source.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const APP = 'com.objectstack.account';
const PURCHASE = 'showcase_purchase';
const INVOICE = 'showcase_invoice';

/** `showcase_purchase` declares this hidden — must never reach the queue. */
const HIDDEN_PURCHASE_AMOUNT = 'USD 99,000.00';
/** Second amount key on the same row: renders ONLY once the hidden one drops. */
const PROMOTED_PURCHASE_AMOUNT = 'USD 320.00';
/** `showcase_invoice` does NOT declare `total_amount` hidden — must render. */
const VISIBLE_INVOICE_AMOUNT = 'USD 5,000.00';
/** `showcase_invoice` DOES declare `service_fee` hidden — must not render. */
const HIDDEN_INVOICE_FEE = 'USD 250.00';

const TITLES = ['PO-4417', 'INV-8801', 'INV-8802'];

const { approvalsApiStub, getObjectSchema, SCHEMAS, ADAPTER, AUTH, I18N, ROWS } = vi.hoisted(() => {
  /** Three rows, two objects — see the header on why one object cannot do. */
  const ROWS: Array<Record<string, unknown>> = [
    {
      id: 'req_p',
      process_name: 'purchase_approval',
      process_label: 'Purchase Approval',
      object_name: 'showcase_purchase',
      object_label: 'Purchase',
      record_id: 'po_1',
      record_title: 'PO-4417',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-20T03:00:00.000Z',
      payload: {
        total_amount: 99000,
        subject: 'Ventilator service contract',
        freight_cost: 320,
      },
      payload_display: { total_amount: 'USD 99,000.00', freight_cost: 'USD 320.00' },
    },
    {
      id: 'req_i1',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_1',
      record_title: 'INV-8801',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-20T02:00:00.000Z',
      payload: { total_amount: 5000, subject: 'Quarterly retainer' },
      payload_display: { total_amount: 'USD 5,000.00' },
    },
    {
      id: 'req_i2',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_2',
      record_title: 'INV-8802',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-20T01:00:00.000Z',
      payload: { service_fee: 250, subject: 'Filing service' },
      payload_display: { service_fee: 'USD 250.00' },
    },
  ];

  /** Per-object metadata, rewritten by each test through `declare()`. */
  const SCHEMAS: Record<string, unknown> = {};
  const getObjectSchema = vi.fn(async (name: string): Promise<unknown> => {
    const schema = SCHEMAS[name];
    if (schema === undefined) return { fields: {} };
    if (schema instanceof Error) throw schema;
    return schema;
  });

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getRequest: vi.fn(async () => ({ data: ROWS[0] })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: ROWS[0], finalized: true })),
    reject: vi.fn(async () => ({ data: ROWS[0], finalized: true })),
  };

  // STABLE singletons: a mocked hook handing back a fresh object per render
  // re-runs the page's load effect forever and the queue never settles.
  const ADAPTER = {
    // Echo the probed ids back so every row stays readable (objectui#5211) and
    // the record link is not what this file is measuring.
    find: vi.fn(async (_object: string, params?: Record<string, any>) => {
      const ids: string[] = params?.$filter?.id?.$in ?? [];
      return { data: ids.map((id) => ({ id })) };
    }),
    getObjectSchema,
  };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };

  return { approvalsApiStub, getObjectSchema, SCHEMAS, ADAPTER, AUTH, I18N, ROWS };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => I18N,
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const authFetch = vi.fn(async () => new Response('{}', { status: 200 }));
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => AUTH,
    createAuthenticatedFetch: () => authFetch,
    TokenStorage: { get: () => null },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

// Imported after the mocks so the page picks them up.
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

function permissionsPayload(): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: 't_1',
    roles: [],
    permissionSets: [],
    objects: {},
    fields: {},
    // A real, reported grant that is NOT platform-admin-only — the same
    // business-approver posture the drawer trim test renders under.
    systemPermissions: ['setup.access'],
  };
}

/** Point an object's metadata at a schema (or at a read that throws). */
function declare(objectName: string, schema: unknown): void {
  SCHEMAS[objectName] = schema;
}

/** Both objects, as the app author wrote them for the defect case. */
function declareTheReportedHiddenFields(): void {
  declare(PURCHASE, {
    fields: {
      total_amount: { type: 'currency', hidden: true },
      freight_cost: { type: 'currency' },
      subject: { type: 'text' },
    },
  });
  declare(INVOICE, {
    fields: {
      total_amount: { type: 'currency' },
      service_fee: { type: 'currency', hidden: true },
      subject: { type: 'text' },
    },
  });
}

/** The same two objects with nothing hidden — the counter-probe. */
function declareNothingHidden(): void {
  declare(PURCHASE, {
    fields: {
      total_amount: { type: 'currency' },
      freight_cost: { type: 'currency' },
      subject: { type: 'text' },
    },
  });
  declare(INVOICE, {
    fields: {
      total_amount: { type: 'currency' },
      service_fee: { type: 'currency' },
      subject: { type: 'text' },
    },
  });
}

function renderQueue() {
  return render(
    <MePermissionsProvider initialPermissions={permissionsPayload()}>
      <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
        <Routes>
          <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
        </Routes>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

/** Render and settle: the queue has its rows AND both objects have answered. */
async function loadedQueue(): Promise<void> {
  renderQueue();
  await screen.findAllByText(TITLES[0]);
  await waitFor(() => {
    expect(getObjectSchema).toHaveBeenCalledWith(PURCHASE);
    expect(getObjectSchema).toHaveBeenCalledWith(INVOICE);
  });
}

/**
 * The leaf nodes carrying an inline figure (`· USD 5,000.00`).
 *
 * Leaf-only so an ancestor cannot match, and the count is the assertion: 2 for
 * a rendered figure (desktop row + mobile card), 0 for a trimmed one.
 */
function amountNodes(display: string): HTMLElement[] {
  return screen.queryAllByText((_content, element) => {
    if (!element || element.children.length > 0) return false;
    return element.textContent?.replace(/\s+/g, ' ').trim() === `· ${display}`;
  });
}

/** The queue really rendered its rows — run by every denial case. */
function expectQueueIntact(): void {
  for (const title of TITLES) {
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  }
}

/** Record titles in desktop table order — the amount sort's observable. */
function desktopRowTitles(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1) // header
    .map((row) => TITLES.find((t) => row.textContent?.includes(t)) ?? '?');
}

/** Switch the queue to "Amount (high→low)" the way a reviewer does. */
async function sortByAmount(): Promise<void> {
  const trigger = Array.from(document.body.querySelectorAll('[role="combobox"]'))
    .find((el) => el.textContent?.includes('Newest first'));
  expect(trigger, 'the sort select is rendered').toBeTruthy();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('option', { name: 'Amount (high→low)' }));
  // Settled: the default newest-first order leads with INV-8802, every
  // amount order with PO-4417 — so this waits for the sort, not for a paint.
  await waitFor(() => expect(desktopRowTitles()[0]).toBe('PO-4417'));
}

beforeAll(() => {
  // Radix Select drives its trigger off pointer events, which happy-dom does
  // not implement — the same shim the components-side Select tests install.
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: any = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as any).PointerEvent = MockPointerEvent;
  (HTMLElement.prototype as any).hasPointerCapture = vi.fn();
  (HTMLElement.prototype as any).releasePointerCapture = vi.fn();
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

beforeEach(() => {
  ADAPTER.find.mockClear();
  getObjectSchema.mockClear();
  for (const key of Object.keys(SCHEMAS)) delete SCHEMAS[key];
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  approvalsApiStub.listRequests.mockResolvedValue({ data: ROWS, total: ROWS.length });
});
afterEach(cleanup);

describe('Approvals queue rows — per-object `hidden: true` trim (objectui#6020)', () => {
  it('trims the figure each row’s OWN object declares hidden, and only that one', async () => {
    declareTheReportedHiddenFields();
    await loadedQueue();

    // The reported defect: the purchase row's hidden amount.
    await waitFor(() => expect(amountNodes(HIDDEN_PURCHASE_AMOUNT)).toHaveLength(0));
    // …and the row still carries an amount — its next, undeclared one — so the
    // drop is inside the scan, not the row giving up on amounts.
    expect(amountNodes(PROMOTED_PURCHASE_AMOUNT)).toHaveLength(2);

    // ⭐ The invoice object does NOT declare `total_amount` hidden. A fix that
    // threads the drawer's single set through the queue hides this figure.
    expect(amountNodes(VISIBLE_INVOICE_AMOUNT)).toHaveLength(2);

    // ⭐ The invoice object DOES declare `service_fee` hidden. A fix that reads
    // only one object's declarations leaves this figure on screen.
    expect(amountNodes(HIDDEN_INVOICE_FEE)).toHaveLength(0);

    expectQueueIntact();
  });

  it('COUNTER-PROBE: same rows, nothing declared hidden — every figure renders', async () => {
    declareNothingHidden();
    await loadedQueue();

    expect(amountNodes(HIDDEN_PURCHASE_AMOUNT)).toHaveLength(2);
    expect(amountNodes(VISIBLE_INVOICE_AMOUNT)).toHaveLength(2);
    expect(amountNodes(HIDDEN_INVOICE_FEE)).toHaveLength(2);
    // Untrimmed, the purchase row leads with the first amount key, so the
    // second one stays out — the mirror image of the promotion above.
    expect(amountNodes(PROMOTED_PURCHASE_AMOUNT)).toHaveLength(0);
    expectQueueIntact();
  });

  it('FAILS OPEN: a source that cannot describe the objects renders today’s figures', async () => {
    declare(PURCHASE, Object.assign(new Error('Forbidden'), { status: 403 }));
    declare(INVOICE, Object.assign(new Error('Forbidden'), { status: 403 }));
    await loadedQueue();

    // Unknown is not hidden: the queue must not degrade an approver's decision
    // surface on a metadata error. See `hiddenFields.ts` on failing open.
    expect(amountNodes(HIDDEN_PURCHASE_AMOUNT)).toHaveLength(2);
    expect(amountNodes(HIDDEN_INVOICE_FEE)).toHaveLength(2);
    expectQueueIntact();
  });

  it('costs one metadata read per distinct OBJECT, not one per row', async () => {
    declareTheReportedHiddenFields();
    await loadedQueue();

    // Three rows, two objects. Per-row reads would be 3 — and would grow with
    // the page. `planHiddenFieldReads` is the cost model; this pins it at the
    // call site.
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalledTimes(2));
    expect(getObjectSchema.mock.calls.map(([name]) => name).sort())
      .toEqual([INVOICE, PURCHASE].sort());
  });
});

describe('Approvals amount sort — ordering is disclosure too (objectui#6020)', () => {
  /**
   * The hidden figure is deliberately the MIDDLE magnitude, and the three
   * orders are three DIFFERENT permutations — so "sorted", "not sorted" and
   * "sorted without the hidden figure" can never be confused for one another:
   *
   *   default, newest-first   INV-8802 · INV-8801 · PO-4417
   *   amount, undeclared      PO-4417(9,000) · INV-8801(5,000) · INV-8802(900)
   *   amount, declared hidden PO-4417(9,000) · INV-8802(900)   · INV-8801(sunk)
   *
   * Each row's amount key is one its OWN object leaves visible, except
   * INV-8801's `service_fee` — the one `showcase_invoice` declares hidden.
   */
  const SORT_ROWS = [
    {
      ...ROWS[0],
      submitted_at: '2026-08-20T01:00:00.000Z',
      payload: { freight_cost: 9000 },
      payload_display: { freight_cost: 'USD 9,000.00' },
    },
    {
      ...ROWS[1],
      submitted_at: '2026-08-20T02:00:00.000Z',
      payload: { service_fee: 5000 },
      payload_display: { service_fee: 'USD 5,000.00' },
    },
    {
      ...ROWS[2],
      submitted_at: '2026-08-20T03:00:00.000Z',
      payload: { total_amount: 900 },
      payload_display: { total_amount: 'USD 900.00' },
    },
  ];

  beforeEach(() => {
    approvalsApiStub.listRequests.mockResolvedValue({ data: SORT_ROWS, total: SORT_ROWS.length });
  });

  it('does not order the queue on a figure it declines to render', async () => {
    declareTheReportedHiddenFields();
    await loadedQueue();
    await sortByAmount();

    // INV-8801's 5,000 is `service_fee`, which its object hides: it has no
    // renderable amount, so it sinks with the amount-less rows instead of
    // sitting second and telling the viewer 900 < it < 9,000.
    expect(desktopRowTitles()).toEqual(['PO-4417', 'INV-8802', 'INV-8801']);
    expect(amountNodes('USD 5,000.00')).toHaveLength(0);
    expectQueueIntact();
  });

  it('COUNTER-PROBE: the same fixture, undeclared, orders by that same figure', async () => {
    declareNothingHidden();
    await loadedQueue();
    await sortByAmount();

    // Proof the assertion above is the trim and not a broken comparator: here
    // the very same row sorts into the middle, on the very same value.
    expect(desktopRowTitles()).toEqual(['PO-4417', 'INV-8801', 'INV-8802']);
    expect(amountNodes('USD 5,000.00')).toHaveLength(2);
  });
});
