/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Roll-up totals on the page objectstack serves for an approval request
 * (objectstack#34588, was objectui#12534). The page used to summarize the
 * snapshot under a lead amount, and objectui#12534 let a `summary` field whose
 * `summaryOperations` is a `sum` over a `currency` field take that lead, which
 * cost a read of the summarized object's definition. #34588 draws the record
 * WHOLE (maintainer 2026-11-17: 「审批页应该直接显示完整的记录」), so there is
 * no lead to take: every roll-up is an ordinary field in its place, through
 * its own field's cell, and no summarized object's definition is read for it.
 * The record's child lines are drawn instead, as a read-only table of the
 * CURRENT rows (the snapshot keeps the record's own row only).
 *
 * Mounted as `approvalRequestsDataSource.servedPageSummary-12483.test.tsx`
 * mounts it (the REAL `RecordDetailView`, opened by the generic record route
 * under the console's `ApprovalRecordReads`, so the request is read from the
 * approvals get route as the shipped code reads it), with the root
 * `SchemaRendererProvider` the console shell mounts around everything.
 * `SERVED_PAGE` is objectstack `plugin-approvals`' `sys_approval_request_detail`
 * copied whole. The target and child objects are objectstack's showcase
 * declarations (`examples/app-showcase`, objectstack `9e0945cf4`):
 * `showcase_expense_report` with its `showcase_expense_line` roll-ups,
 * `showcase_invoice.total` over `showcase_invoice_line.amount`, and
 * `showcase_product.unit_price`. Only the HTTP transport, the console adapter
 * and the metadata store are doubled.
 */import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { RecordDetailView } from '@object-ui/app-shell';
import { ObjectSchema } from '@objectstack/spec/data';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const REQ = 'req_12534';

/** The system columns the registry injects into every object. */
const SYSTEM_FIELDS = {
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', system: true },
  created_at: { type: 'datetime', label: 'Created At', readonly: true, system: true },
};

/** `showcase_expense_report`: six roll-ups of one child, three `sum`s and three `count`s. */
const EXPENSE_REPORT_DEF = {
  name: 'showcase_expense_report',
  label: 'Expense Report',
  fields: {
    ...SYSTEM_FIELDS,
    name: { type: 'text', label: 'Report Title', required: true, searchable: true, maxLength: 120 },
    employee: { type: 'text', label: 'Employee', searchable: true, maxLength: 120 },
    status: {
      type: 'select', label: 'Status', required: true,
      options: [
        { label: 'Draft', value: 'draft', default: true },
        { label: 'Submitted', value: 'submitted' },
        { label: 'Approved', value: 'approved' },
        { label: 'Reimbursed', value: 'reimbursed' },
      ],
    },
    submitted_on: { type: 'date', label: 'Submitted On' },
    total_amount: {
      type: 'summary', label: 'Total',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'sum' },
    },
    approved_amount: {
      type: 'summary', label: 'Approved',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'sum', filter: { status: 'approved' } },
    },
    reimbursable_amount: {
      type: 'summary', label: 'Reimbursable',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'sum', filter: { billable: true } },
    },
    line_count: {
      type: 'summary', label: 'Lines',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'count' },
    },
    rejected_count: {
      type: 'summary', label: 'Rejected',
      summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: 'count', filter: { status: 'rejected' } },
    },
    over_limit_count: {
      type: 'summary', label: 'Over $500',
      summaryOperations: {
        object: 'showcase_expense_line', field: 'amount', function: 'count', filter: { amount: { $gte: 500 } },
      },
    },
  },
};

/** `showcase_expense_line`: the child, whose `amount` is `currency`. */
const EXPENSE_LINE_DEF = {
  name: 'showcase_expense_line',
  label: 'Expense Line',
  fields: {
    expense_report: { type: 'master_detail', reference: 'showcase_expense_report', label: 'Report', required: true },
    merchant: { type: 'text', label: 'Merchant', required: true, maxLength: 120 },
    amount: { type: 'currency', label: 'Amount', required: true, min: 0 },
    billable: { type: 'boolean', label: 'Billable to client', defaultValue: false },
    incurred_on: { type: 'date', label: 'Incurred On' },
  },
};

/** `showcase_invoice`: no currency field of its own; its total is a roll-up. */
const INVOICE_DEF = {
  name: 'showcase_invoice',
  label: 'Invoice',
  fields: {
    ...SYSTEM_FIELDS,
    name: { type: 'text', label: 'Invoice Number', required: true, searchable: true, maxLength: 60 },
    owner: { type: 'text', label: 'Owner', maxLength: 200 },
    region: {
      type: 'select', label: 'Region',
      options: [{ label: 'AMER', value: 'amer', default: true }, { label: 'EMEA', value: 'emea' }, { label: 'APAC', value: 'apac' }],
    },
    issued_on: { type: 'date', label: 'Issued On' },
    tax_rate: { type: 'number', label: 'Tax Rate (%)', min: 0, max: 100, defaultValue: 0 },
    total: {
      type: 'summary', label: 'Subtotal',
      summaryOperations: { object: 'showcase_invoice_line', field: 'amount', function: 'sum' },
    },
  },
};

/** `showcase_invoice_line`: `quantity` is a `number`, `unit_price` and `amount` are `currency`. */
const INVOICE_LINE_DEF = {
  name: 'showcase_invoice_line',
  label: 'Invoice Line',
  fields: {
    invoice: { type: 'master_detail', reference: 'showcase_invoice', label: 'Invoice', required: true },
    quantity: { type: 'number', label: 'Quantity', min: 0 },
    unit_price: { type: 'currency', label: 'Unit Price', min: 0 },
    amount: { type: 'currency', label: 'Amount', min: 0 },
  },
};

/** `showcase_product`: a declared `currency` field and no roll-up. */
const PRODUCT_DEF = {
  name: 'showcase_product',
  label: 'Product',
  fields: {
    ...SYSTEM_FIELDS,
    name: { type: 'text', label: 'Name', required: true, searchable: true, maxLength: 120 },
    sku: { type: 'text', label: 'SKU', searchable: true, maxLength: 40 },
    unit_price: { type: 'currency', label: 'Unit Price', min: 0 },
  },
};

const CAN_ACT = {
  dialect: 'cel',
  source: 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true',
};
const REQUEST_DEF = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  nameField: 'process_label',
  titleFormat: '{process_name}',
  highlightFields: ['process_label', 'record_id', 'status', 'current_step_label', 'submitter_id', 'updated_at'],
  fields: {
    id: { label: 'Request ID', type: 'text', readonly: true, group: 'System' },
    display_title: { label: 'Title', type: 'formula', returnType: 'text', group: 'Target' },
    process_name: { label: 'Source', type: 'text', group: 'Target' },
    process_label: { label: 'Flow', type: 'text', readonly: true, group: 'Target' },
    object_name: { label: 'Object', type: 'text', group: 'Target' },
    record_id: { label: 'Record ID', type: 'text', referenceVia: 'object_name', group: 'Target' },
    submitter_id: { label: 'Submitter', type: 'lookup', reference: 'sys_user', group: 'Target' },
    status: {
      label: 'Status', type: 'select', group: 'State',
      options: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }],
    },
    current_step: { label: 'Current Step', type: 'text', group: 'State' },
    current_step_label: { label: 'Approval Step', type: 'text', readonly: true, group: 'State' },
    updated_at: { label: 'Updated At', type: 'datetime', group: 'System' },
  },
  actions: [
    {
      name: 'approval_approve', label: 'Approve', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve',
      visible: CAN_ACT, locations: ['record_section', 'list_item'], refreshAfter: true,
    },
  ],
  enable: { apiMethods: ['get', 'list'] },
};
const ACTION_DEF = {
  name: APPROVAL_ACTION_OBJECT,
  label: 'Approval Action',
  pluralLabel: 'Approval Actions',
  nameField: 'display_title',
  fields: {
    id: { label: 'Action ID', type: 'text', readonly: true },
    request_id: { label: 'Request', type: 'lookup', reference: APPROVAL_REQUEST_OBJECT },
    created_at: { label: 'Created At', type: 'datetime' },
  },
  enable: { apiMethods: ['get', 'list'] },
};
const USER_DEF = { name: 'sys_user', label: 'User', nameField: 'name', fields: { name: { label: 'Name', type: 'text' } } };
const DEFS: Record<string, unknown> = {
  [APPROVAL_REQUEST_OBJECT]: REQUEST_DEF,
  [APPROVAL_ACTION_OBJECT]: ACTION_DEF,
  sys_user: USER_DEF,
  showcase_expense_report: EXPENSE_REPORT_DEF,
  showcase_expense_line: EXPENSE_LINE_DEF,
  showcase_invoice: INVOICE_DEF,
  showcase_invoice_line: INVOICE_LINE_DEF,
  showcase_product: PRODUCT_DEF,
};

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage`, whole (as of objectstack#34588). */
const SERVED_PAGE = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: 'sys_approval_request',
  template: 'default',
  kind: 'full',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header', properties: { placedActions: true } },
        {
          type: 'record:highlights',
          properties: {
            fields: ['process_label', 'status', 'current_step_label', 'submitter_id', 'updated_at'],
          },
        },
        { type: 'record:approval_decision' },
      ],
    },
  ],
};

/** An expense report's snapshot as the approvals get serves it, in the stored column order. */
const EXPENSE_PAYLOAD = {
  id: 'exp_1',
  created_at: '2026-10-06T06:44:23.359Z',
  owner_id: 'rOrg4X8TWQKqZDDLH3dH7JDhSZ69dEwm',
  name: 'Berlin offsite',
  employee: 'Ada Lovelace',
  status: 'submitted',
  submitted_on: '2026-10-05',
  total_amount: 1840.5,
  approved_amount: 1200,
  reimbursable_amount: 0,
  line_count: 4,
  rejected_count: 1,
  over_limit_count: 1,
};
const INVOICE_PAYLOAD = {
  id: 'inv_1',
  created_at: '2026-10-06T06:44:23.359Z',
  owner_id: 'rOrg4X8TWQKqZDDLH3dH7JDhSZ69dEwm',
  name: 'INV-1010',
  owner: 'Grace Hopper',
  region: 'emea',
  issued_on: '2026-07-23',
  tax_rate: 20,
  total: 9876.25,
};

function requestRow(objectName: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    id: REQ,
    process_name: `flow:${objectName}_approval`,
    process_label: `${objectName} approval`,
    object_name: objectName,
    record_id: payload.id,
    status: 'pending',
    current_step: 'manager_review',
    current_step_label: 'Manager Review',
    submitter_id: 'u2',
    updated_at: '2026-10-02T09:00:00Z',
    viewer: { can_act: true, is_submitter: false, can_override: false },
    pending_approvers: [],
    payload,
    payload_display: { owner_id: 'Dev Admin' },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The row the approvals get serves for this case. */
let served: Record<string, unknown> = requestRow('showcase_expense_report', EXPENSE_PAYLOAD);

const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, served);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

/** The target record as it reads now; null reads as not found. */
let current: Record<string, unknown> | null = null;

/** The expense report's lines as they read now. */
const EXPENSE_LINES = [
  { id: 'line_1', expense_report: 'exp_1', merchant: 'Deutsche Bahn', amount: 240.5, billable: false, incurred_on: '2026-10-01' },
  { id: 'line_2', expense_report: 'exp_1', merchant: 'Hotel Adlon', amount: 1600, billable: false, incurred_on: '2026-10-02' },
];

const host = {
  find: vi.fn(async (resource: string, _params?: unknown) =>
    resource === 'showcase_expense_line' ? { data: EXPENSE_LINES, total: EXPENSE_LINES.length } : { data: [], total: 0 }),
  findOne: vi.fn(async (_resource: string, id: string) => (current && current.id === id ? current : null)),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};

/** What the metadata store answers for an object definition; a case may withhold or change one. */
let defs: Record<string, unknown> = DEFS;
const getItem = vi.fn(async (type: string, name: string) => (type === 'object' ? (defs[name] ?? null) : null));
const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF] as unknown[], dashboards: [], reports: [],
  pages: [SERVED_PAGE], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

/** A signed-in reader who may read everything except the expense report fields named. */
function readerWithout(...denied: string[]): MePermissionsResponse {
  const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 't1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    objects: { '*': all } as never,
    fields: Object.fromEntries(denied.map((f) => [`showcase_expense_report.${f}`, { readable: false, editable: false }])),
    systemPermissions: [],
  };
}

async function openServedPage(row: Record<string, unknown>, permissions?: MePermissionsResponse): Promise<HTMLElement> {
  served = row;
  const page = (
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
        <SchemaRendererProvider dataSource={host as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>
              <ApprovalRecordReads>
                <Routes>
                  <Route path=":objectName/record/:recordId" element={<GenericRecordRoute />} />
                </Routes>
              </ApprovalRecordReads>
            </AdapterCtx.Provider>
          </MetadataCtx.Provider>
        </SchemaRendererProvider>
      </MemoryRouter>
    </I18nProvider>
  );
  const wrapped: ReactNode = permissions
    ? <MePermissionsProvider initialPermissions={permissions}>{page}</MePermissionsProvider>
    : page;
  render(<>{wrapped}</>);
  const panel = await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  await within(panel).findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 });
  return panel;
}

async function recordOf(panel: HTMLElement): Promise<HTMLElement> {
  return within(panel).findByTestId('submitted-record', undefined, { timeout: 8000 });
}

/** The card's fields, in drawn order, as `{ field key -> { label, value } }`. */
function recordFields(panel: HTMLElement): Map<string, { label: string; value: string }> {
  const out = new Map<string, { label: string; value: string }>();
  for (const row of panel.querySelectorAll('[data-submitted-field]')) {
    const value = row.querySelector('dd');
    const note = value?.querySelector('[data-submitted-current]');
    out.set(row.getAttribute('data-submitted-field') as string, {
      label: (row.querySelector('dt')?.textContent ?? '').trim(),
      value: (value?.textContent ?? '').replace(note?.textContent ?? '\u0000', '').trim(),
    });
  }
  return out;
}

/** What the record page draws for this declaration and stored value, standalone. */
function recordPageFace(def: Record<string, unknown>, field: string, value: unknown): string {
  const declared = { ...(def.fields as Record<string, Record<string, unknown>>)[field], name: field };
  const Cell = getCellRenderer(resolveCellRendererType(declared as { type?: string; format?: string }));
  const { container, unmount } = render(<Cell value={value} field={declared as never} />);
  const text = (container.textContent ?? '').trim();
  unmount();
  return text;
}

/** The object definitions the metadata store was asked for, in order. */
const definitionsRead = () => getItem.mock.calls.filter(([type]) => type === 'object').map(([, name]) => name);

const pageText = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  served = requestRow('showcase_expense_report', EXPENSE_PAYLOAD);
  current = null;
  defs = DEFS;
  metadata.objects = [REQUEST_DEF, ACTION_DEF, USER_DEF];
  host.find.mockClear();
  host.findOne.mockClear();
  getItem.mockClear();
  transport.mockClear();
});

describe('roll-up totals are ordinary fields of the whole record (objectstack#34588, was objectui#12534)', () => {
  it('the showcase declarations parse as spec objects, and the served page as a spec page', () => {
    for (const def of [EXPENSE_REPORT_DEF, EXPENSE_LINE_DEF, INVOICE_DEF, INVOICE_LINE_DEF, PRODUCT_DEF]) {
      const { owner_id: _o, created_at: _c, ...authored } = def.fields as Record<string, unknown>;
      const parsed = ObjectSchema.safeParse({ ...def, fields: authored });
      expect(parsed.success, `${def.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`).toBe(true);
    }
    expect(PageSchema.safeParse(SERVED_PAGE).success).toBe(true);
  });

  it("the expense report's total is drawn in its place, under its declared label, through its own field's cell, once", async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await recordOf(panel);
    expect(panel.querySelector('[data-summary-lead]')).toBeNull();
    const rows = recordFields(panel);
    expect(rows.get('total_amount')).toEqual({
      label: 'Total',
      value: recordPageFace(EXPENSE_REPORT_DEF, 'total_amount', 1840.5),
    });
    // Every roll-up of the same child, `sum` and `count` alike, in declared order.
    expect([...rows.keys()]).toEqual([
      'name', 'employee', 'status', 'submitted_on',
      'total_amount', 'approved_amount', 'reimbursable_amount', 'line_count', 'rejected_count', 'over_limit_count',
    ]);
    expect(rows.get('line_count')).toEqual({ label: 'Lines', value: recordPageFace(EXPENSE_REPORT_DEF, 'line_count', 4) });
  });

  it("the invoice's subtotal is an ordinary field", async () => {
    const panel = await openServedPage(requestRow('showcase_invoice', INVOICE_PAYLOAD));
    await recordOf(panel);
    expect(recordFields(panel).get('total')).toEqual({ label: 'Subtotal', value: recordPageFace(INVOICE_DEF, 'total', 9876.25) });
  });

  it("no summarized object's definition is read to draw a roll-up", async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await recordOf(panel);
    const reads = definitionsRead();
    expect(reads).toContain('showcase_expense_report');
    expect(reads).not.toContain('showcase_expense_line');
  });

  it('a field the reader may not read is never drawn; the other roll-ups still are', async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD), readerWithout('total_amount'));
    await recordOf(panel);
    const rows = recordFields(panel);
    expect(rows.has('total_amount')).toBe(false);
    expect(rows.has('approved_amount')).toBe(true);
    expect(pageText()).not.toContain('1,840.5');
  });

  it("the product's unit price, a plain currency field, is an ordinary field", async () => {
    const product = { id: 'prd_1', created_at: '2026-10-06T06:44:23.359Z', name: 'Widget', sku: 'W-1', unit_price: 49.5 };
    const panel = await openServedPage(requestRow('showcase_product', product));
    await recordOf(panel);
    expect(recordFields(panel).get('unit_price')).toEqual({
      label: 'Unit Price',
      value: recordPageFace(PRODUCT_DEF, 'unit_price', 49.5),
    });
  });
});

describe("the record's child lines (objectstack#34588)", () => {
  it('are drawn once the record reads: its current lines, read-only, headed as current rows', async () => {
    metadata.objects = [REQUEST_DEF, ACTION_DEF, USER_DEF, EXPENSE_REPORT_DEF, EXPENSE_LINE_DEF];
    current = { ...EXPENSE_PAYLOAD };
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    const child = await within(panel).findByTestId('submitted-child-tables', undefined, { timeout: 8000 });
    const lines = child.querySelector('[data-submitted-child="showcase_expense_line"]') as HTMLElement;
    expect(lines).not.toBeNull();
    expect(lines.querySelector('[data-submitted-child-note]')?.textContent)
      .toBe('Current rows: the submission does not keep child rows.');
    expect(await within(lines).findByText('Hotel Adlon', undefined, { timeout: 8000 })).toBeTruthy();
    // Read-only: no New or Add.
    expect(within(lines).queryByRole('button', { name: /^New$|Add/ })).toBeNull();
    expect(host.find.mock.calls.some(([resource]) => resource === 'showcase_expense_line')).toBe(true);
  });

  it('CONTROL: a record that does not read draws no child lines, and asks for none', async () => {
    metadata.objects = [REQUEST_DEF, ACTION_DEF, USER_DEF, EXPENSE_REPORT_DEF, EXPENSE_LINE_DEF];
    current = null;
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await within(panel).findByTestId('submitted-record-current-unreadable', undefined, { timeout: 8000 });
    expect(within(panel).queryByTestId('submitted-child-tables')).toBeNull();
    expect(host.find.mock.calls.some(([resource]) => resource === 'showcase_expense_line')).toBe(false);
  });
});
