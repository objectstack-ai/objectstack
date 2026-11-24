// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals QUEUE — the figure each row shows beside its object name, and the
 * amount sort, are the field the row's OWN object DECLARES: the first numeric
 * entry of its `highlightFields` (ADR-0085) that it did not declare
 * `hidden: true`. Never a field picked by its NAME; no declaration, no figure.
 *
 * ## Why the fixture is built the way it is
 *
 * Every row carries a money-looking key (`total_amount`, `overdue_amount`,
 * `service_fee`) that a name-based guess would pick, declared BEFORE the field
 * the object's `highlightFields` names. So each assertion fails on a guess:
 *
 *   showcase_purchase — highlightFields [subject, total_amount, freight_cost],
 *                       `total_amount` declared hidden
 *   showcase_invoice  — highlightFields [subject, total_score],
 *                       `overdue_amount` declared first
 *
 *   row P  (purchase) → `freight_cost` 320   … the hidden entry is skipped
 *   row I1 (invoice)  → `total_score` 81     … not `overdue_amount` 80,000
 *   row I2 (invoice)  → `total_score` 0      … a declared 0 shows; not 250
 *
 * Two objects with DIFFERENT declarations, because the lookup is per object:
 * one object's answer applied to every row would show the wrong field on the
 * other object's rows.
 *
 * ## Why every figure is asserted TWICE
 *
 * The queue ships two surfaces — the desktop table row and the `md:hidden`
 * mobile card — and both are in the DOM here (no stylesheet applies media
 * queries). A rendered figure is therefore exactly 2 nodes and an absent one
 * exactly 0, which fails a fix that repairs one surface and forgets the other.
 *
 * ## The sort orders on exactly the figure it renders
 *
 * A row with no declared figure sinks with the other figure-less rows. Ordering
 * IS disclosure, so a figure the object declares `hidden: true` orders nothing.
 *
 * ## Counter-probes
 *
 * "No figure" and "the row sank" are both satisfiable by breaking the queue.
 * So every absence case asserts the three record titles are still there, and
 * the sort has a counter-probe where the same row ranks on a declared figure.
 *
 * No build artifact sits between the edit and this test: the root Vitest config
 * aliases every `@object-ui` specifier at that package's source directory, and
 * the page under test is this app's own source.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

const APP = 'com.objectstack.account';
const PURCHASE = 'showcase_purchase';
const INVOICE = 'showcase_invoice';

/** Row P's `total_amount` — a highlight entry, but declared hidden. */
const HIDDEN_PURCHASE_TOTAL = 'USD 99,000.00';
/** Row P's figure: the next numeric highlight entry, `freight_cost`. */
const PURCHASE_FIGURE = 'USD 320.00';
/** Row I1's `overdue_amount` — declared first, money-named, not a highlight. */
const GUESSED_INVOICE_AMOUNT = 'USD 80,000.00';
/** Row I1's figure: `total_score`, the invoice's numeric highlight. */
const INVOICE_FIGURE = '81';
/** Row I2's figure: a declared `total_score` of 0, shown. */
const ZERO_INVOICE_FIGURE = '0';
/** Row I2's `service_fee` — money-named, not a highlight. */
const GUESSED_INVOICE_FEE = 'USD 250.00';

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
      payload: { overdue_amount: 80000, total_score: 81, subject: 'Quarterly retainer' },
      payload_display: { overdue_amount: 'USD 80,000.00' },
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
      payload: { overdue_amount: 0, total_score: 0, service_fee: 250, subject: 'Filing service' },
      payload_display: { overdue_amount: 'USD 0.00', service_fee: 'USD 250.00' },
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

function permissionsPayload(): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: 't_1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
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

const PURCHASE_FIELDS = {
  total_amount: { type: 'currency', hidden: true },
  subject: { type: 'text' },
  freight_cost: { type: 'currency' },
};

/** `overdue_amount` declared first, so a declaration-order scan meets it first. */
function invoiceFields(serviceFee: Record<string, unknown> = { type: 'currency' }) {
  return {
    overdue_amount: { type: 'currency' },
    total_score: { type: 'number' },
    service_fee: serviceFee,
    subject: { type: 'text' },
  };
}

/** Both objects as the header's table declares them. */
function declareTheFigures(): void {
  declare(PURCHASE, {
    highlightFields: ['subject', 'total_amount', 'freight_cost'],
    fields: PURCHASE_FIELDS,
  });
  declare(INVOICE, {
    highlightFields: ['subject', 'total_score'],
    fields: invoiceFields(),
  });
}

/** The same fields, no `highlightFields` at all — nothing declares a figure. */
function declareNoFigure(): void {
  declare(PURCHASE, { fields: PURCHASE_FIELDS });
  declare(INVOICE, { fields: invoiceFields() });
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

/**
 * Wait until every metadata read has settled and React has rendered on it, so
 * an absence assertion reads the answered queue, not the first paint.
 */
async function metadataSettled(): Promise<void> {
  await act(async () => {
    await Promise.all(getObjectSchema.mock.results.map((r) => Promise.resolve(r.value).catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 0));
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


describe('Approvals queue rows — the figure is the object’s declared highlight, never a guess', () => {
  it('shows the first numeric `highlightFields` entry of each row’s OWN object', async () => {
    declareTheFigures();
    await loadedQueue();

    // Purchase: `total_amount` is the first numeric highlight but is declared
    // hidden, so the next one, `freight_cost`, is the figure.
    await waitFor(() => expect(amountNodes(PURCHASE_FIGURE)).toHaveLength(2));
    expect(amountNodes(HIDDEN_PURCHASE_TOTAL)).toHaveLength(0);

    // Invoice: the declared `total_score`, not the money-named
    // `overdue_amount` declared before it.
    expect(amountNodes(INVOICE_FIGURE)).toHaveLength(2);
    expect(amountNodes(GUESSED_INVOICE_AMOUNT)).toHaveLength(0);

    // A declared 0 is the value of the chosen field, so it shows — and the
    // money-named keys on the same row do not stand in for it.
    expect(amountNodes(ZERO_INVOICE_FIGURE)).toHaveLength(2);
    expect(amountNodes(GUESSED_INVOICE_FEE)).toHaveLength(0);
    expect(amountNodes('USD 0.00')).toHaveLength(0);

    expectQueueIntact();
  });

  it('shows NO figure when the objects declare no `highlightFields`', async () => {
    declareNoFigure();
    await loadedQueue();
    await metadataSettled();

    for (const display of [HIDDEN_PURCHASE_TOTAL, PURCHASE_FIGURE, GUESSED_INVOICE_AMOUNT,
      INVOICE_FIGURE, ZERO_INVOICE_FIGURE, GUESSED_INVOICE_FEE, 'USD 0.00']) {
      expect(amountNodes(display)).toHaveLength(0);
    }
    expectQueueIntact();
  });

  it('shows NO figure when the source cannot describe the objects', async () => {
    declare(PURCHASE, Object.assign(new Error('Forbidden'), { status: 403 }));
    declare(INVOICE, Object.assign(new Error('Forbidden'), { status: 403 }));
    await loadedQueue();
    await metadataSettled();

    // Unknown is not a declaration: nothing is guessed in its place. The
    // queue itself is not degraded.
    for (const display of [HIDDEN_PURCHASE_TOTAL, PURCHASE_FIGURE, GUESSED_INVOICE_AMOUNT,
      INVOICE_FIGURE, GUESSED_INVOICE_FEE]) {
      expect(amountNodes(display)).toHaveLength(0);
    }
    expectQueueIntact();
  });

  it('costs one metadata read per distinct OBJECT, not one per row', async () => {
    declareTheFigures();
    await loadedQueue();

    // Three rows, two objects. Per-row reads would be 3 — and would grow with
    // the page. `planHiddenFieldReads` is the cost model; this pins it at the
    // call site.
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalledTimes(2));
    expect(getObjectSchema.mock.calls.map(([name]) => name).sort())
      .toEqual([INVOICE, PURCHASE].sort());
  });
});

describe('Approvals amount sort — orders on the declared figure only', () => {
  /**
   * Three orders, two permutations that never coincide with the default:
   *
   *   default, newest-first           INV-8802 · INV-8801 · PO-4417
   *   invoice figure `total_score`    PO-4417(9,000) · INV-8802(900) · INV-8801(sunk)
   *   invoice figure `service_fee`    PO-4417(9,000) · INV-8801(5,000) · INV-8802(sunk)
   *
   * INV-8801 carries only `service_fee` 5,000 — the value a name guess ranks
   * second. It ranks only when its object declares that field as the figure.
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
      payload: { total_score: 900 },
      payload_display: {},
    },
  ];

  beforeEach(() => {
    approvalsApiStub.listRequests.mockResolvedValue({ data: SORT_ROWS, total: SORT_ROWS.length });
  });

  it('sinks a row whose object’s declared figure it does not carry', async () => {
    declareTheFigures();
    await loadedQueue();
    await sortByAmount();

    // INV-8801's 5,000 is `service_fee`, which the invoice does not declare as
    // its figure: it sinks instead of sitting second on a guessed value.
    expect(desktopRowTitles()).toEqual(['PO-4417', 'INV-8802', 'INV-8801']);
    expect(amountNodes('900')).toHaveLength(2);
    expect(amountNodes('USD 5,000.00')).toHaveLength(0);
    expectQueueIntact();
  });

  it('COUNTER-PROBE: the invoice declares `service_fee` — the same row ranks on it', async () => {
    declareTheFigures();
    declare(INVOICE, { highlightFields: ['service_fee'], fields: invoiceFields() });
    await loadedQueue();
    await sortByAmount();

    expect(desktopRowTitles()).toEqual(['PO-4417', 'INV-8801', 'INV-8802']);
    expect(amountNodes('USD 5,000.00')).toHaveLength(2);
  });

  it('does not order the queue on a declared figure the object declares hidden', async () => {
    declareTheFigures();
    declare(INVOICE, {
      highlightFields: ['service_fee'],
      fields: invoiceFields({ type: 'currency', hidden: true }),
    });
    await loadedQueue();
    await sortByAmount();

    // Ordering IS disclosure: with `service_fee` hidden the invoice has no
    // figure, so both invoice rows sink in newest-first order instead of
    // INV-8801 telling the viewer where its hidden 5,000 falls.
    expect(desktopRowTitles()).toEqual(['PO-4417', 'INV-8802', 'INV-8801']);
    expect(amountNodes('USD 5,000.00')).toHaveLength(0);
    expectQueueIntact();
  });
});
