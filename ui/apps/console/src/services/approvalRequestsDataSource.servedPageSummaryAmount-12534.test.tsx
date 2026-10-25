/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12534 (the summed-currency half of objectui#12483's declared
 * amount): on the page objectstack serves for an approval request, the
 * snapshot summary also leads with a `summary` field whose spec
 * `summaryOperations` is a `sum` over a field the summarized object declares
 * `type: 'currency'`, so the showcase's expense-report and invoice roll-up
 * totals lead. The summarized object's definition is read through the same
 * metadata-store path as the target's, once, for one object.
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
 * `showcase_product.unit_price` for the currency-only CONTROL. Only the HTTP
 * transport, the console adapter and the metadata store are doubled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
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

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage`, whole (as of objectstack `9e0945cf4`). */
const SERVED_PAGE = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: 'sys_approval_request',
  template: 'default',
  kind: 'slotted',
  isDefault: true,
  regions: [],
  slots: {
    actions: [{ type: 'record:approval_decision' }],
    highlights: {
      type: 'record:highlights',
      properties: {
        fields: ['process_label', 'status', 'current_step_label', 'submitter_id', 'updated_at'],
      },
    },
    tabs: {
      type: 'page:tabs',
      properties: {
        tabStyle: 'line',
        position: 'top',
        items: [
          {
            label: { en: 'Details', 'zh-CN': '详情', 'ja-JP': '詳細', 'es-ES': 'Detalles' },
            icon: 'file-text',
            children: [{ type: 'record:details' }],
          },
          {
            label: { en: 'Timeline', 'zh-CN': '时间线', 'ja-JP': 'タイムライン', 'es-ES': 'Cronología' },
            icon: 'history',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_approval_action',
                  relationshipField: 'request_id',
                  columns: ['created_at', 'action', 'actor_id', 'step_name', 'comment', 'attachments'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 50,
                  showViewAll: true,
                  title: { en: 'Timeline', 'zh-CN': '时间线', 'ja-JP': 'タイムライン', 'es-ES': 'Cronología' },
                },
              },
            ],
          },
        ],
      },
    },
    discussion: [],
  },
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

const host = {
  find: vi.fn(async (_resource: string, _params?: unknown) => ({ data: [], total: 0 })),
  findOne: vi.fn(async (_resource: string, _id: string) => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};

/** What the metadata store answers for an object definition; a case may withhold or change one. */
let defs: Record<string, unknown> = DEFS;
const getItem = vi.fn(async (type: string, name: string) => (type === 'object' ? (defs[name] ?? null) : null));
const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF], dashboards: [], reports: [],
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
    roles: [],
    permissionSets: [],
    objects: { '*': all } as never,
    fields: Object.fromEntries(denied.map((f) => [`showcase_expense_report.${f}`, { readable: false }])),
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

async function summaryOf(panel: HTMLElement): Promise<HTMLElement> {
  return within(panel).findByTestId('record-snapshot-summary', undefined, { timeout: 8000 });
}

/** The summary's rows, as `{ field key -> { label, value } }`. */
function summaryRows(panel: HTMLElement): Map<string, { label: string; value: string }> {
  const out = new Map<string, { label: string; value: string }>();
  for (const row of panel.querySelectorAll('[data-summary-field]')) {
    const [label, value] = Array.from(row.children);
    out.set(row.getAttribute('data-summary-field') as string, {
      label: (label?.textContent ?? '').trim(),
      value: (value?.textContent ?? '').trim(),
    });
  }
  return out;
}

function lead(panel: HTMLElement): { key: string | null; label: string; value: string } | null {
  const el = panel.querySelector('[data-summary-lead]');
  if (!el) return null;
  return {
    key: el.getAttribute('data-summary-lead'),
    label: (el.children[0]?.textContent ?? '').trim(),
    value: (el.children[1]?.textContent ?? '').trim(),
  };
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
  defs = DEFS;
  getItem.mockClear();
  transport.mockClear();
});

describe('a `sum` summary over a currency field leads the served request page (objectui#12534)', () => {
  it('the showcase declarations parse as spec objects, and the served page as a spec page', () => {
    for (const def of [EXPENSE_REPORT_DEF, EXPENSE_LINE_DEF, INVOICE_DEF, INVOICE_LINE_DEF, PRODUCT_DEF]) {
      const { owner_id: _o, created_at: _c, ...authored } = def.fields as Record<string, unknown>;
      const parsed = ObjectSchema.safeParse({ ...def, fields: authored });
      expect(parsed.success, `${def.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`).toBe(true);
    }
    expect(PageSchema.safeParse(SERVED_PAGE).success).toBe(true);
  });

  it('the expense report\'s total leads, under its declared label, through its own field\'s cell, and is not repeated as a row', async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await summaryOf(panel);
    expect(lead(panel)).toEqual({
      key: 'total_amount',
      label: 'Total',
      value: recordPageFace(EXPENSE_REPORT_DEF, 'total_amount', 1840.5),
    });
    expect(lead(panel)?.value).toContain('1,840.5');
    const rows = summaryRows(panel);
    expect(rows.has('total_amount')).toBe(false);
    // The other roll-ups of the same child are ordinary rows below it.
    expect([...rows.keys()]).toEqual(['name', 'employee', 'status', 'submitted_on', 'approved_amount', 'reimbursable_amount']);
  });

  it('the invoice, which declares no currency field of its own, leads with its subtotal', async () => {
    const panel = await openServedPage(requestRow('showcase_invoice', INVOICE_PAYLOAD));
    await summaryOf(panel);
    expect(lead(panel)).toEqual({
      key: 'total',
      label: 'Subtotal',
      value: recordPageFace(INVOICE_DEF, 'total', 9876.25),
    });
    expect(summaryRows(panel).has('total')).toBe(false);
  });

  it('the summarized object\'s definition is read once, through the metadata store, and no record is read', async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await summaryOf(panel);
    const reads = definitionsRead();
    expect(reads.filter((n) => n === 'showcase_expense_report').length).toBeGreaterThan(0);
    // Three `sum`s over one child, one read of that child.
    expect(reads.filter((n) => n === 'showcase_expense_line')).toEqual(['showcase_expense_line']);
    const paths = transport.mock.calls.map(([input]) =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://test.local').pathname);
    expect(paths.filter((p) => p.includes('expense'))).toEqual([]);
    expect(host.findOne.mock.calls.filter(([resource]) => resource === 'showcase_expense_line')).toEqual([]);
  });

  it('a field the reader may not read is never drawn: without the total, the next `sum` leads', async () => {
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD), readerWithout('total_amount'));
    await summaryOf(panel);
    expect(lead(panel)?.key).toBe('approved_amount');
    expect(summaryRows(panel).has('total_amount')).toBe(false);
    expect(pageText()).not.toContain('1,840.5');
  });
});

describe('controls (objectui#12534)', () => {
  it('CONTROL: a summary that is not a `sum` is an ordinary row, and no other definition is read', async () => {
    const { total_amount: _t, approved_amount: _a, reimbursable_amount: _r, ...counts } = EXPENSE_PAYLOAD;
    const panel = await openServedPage(requestRow('showcase_expense_report', counts));
    await summaryOf(panel);
    expect(lead(panel)).toBeNull();
    const rows = summaryRows(panel);
    expect(rows.get('line_count')).toEqual({ label: 'Lines', value: recordPageFace(EXPENSE_REPORT_DEF, 'line_count', 4) });
    expect(rows.has('rejected_count')).toBe(true);
    expect(definitionsRead()).not.toContain('showcase_expense_line');
  });

  it('CONTROL: a `sum` over a field the summarized object declares `number` is an ordinary row', async () => {
    const overQuantity = {
      ...INVOICE_DEF,
      fields: {
        ...INVOICE_DEF.fields,
        total: { ...INVOICE_DEF.fields.total, summaryOperations: { object: 'showcase_invoice_line', field: 'quantity', function: 'sum' } },
      },
    };
    defs = { ...DEFS, showcase_invoice: overQuantity };
    const panel = await openServedPage(requestRow('showcase_invoice', INVOICE_PAYLOAD));
    await summaryOf(panel);
    expect(lead(panel)).toBeNull();
    expect(summaryRows(panel).get('total')).toEqual({ label: 'Subtotal', value: recordPageFace(INVOICE_DEF, 'total', 9876.25) });
  });

  it('CONTROL: the currency-only case keeps objectui#12483\'s amount, and reads no other definition', async () => {
    const product = { id: 'prd_1', created_at: '2026-10-06T06:44:23.359Z', name: 'Widget', sku: 'W-1', unit_price: 49.5 };
    const panel = await openServedPage(requestRow('showcase_product', product));
    await summaryOf(panel);
    expect(lead(panel)).toEqual({
      key: 'unit_price',
      label: 'Unit Price',
      value: recordPageFace(PRODUCT_DEF, 'unit_price', 49.5),
    });
    expect(definitionsRead().every((n) => !n.endsWith('_line'))).toBe(true);
  });

  it('CONTROL: when the summarized object\'s definition cannot be read, the total is an ordinary row', async () => {
    defs = { ...DEFS, showcase_expense_line: null };
    const panel = await openServedPage(requestRow('showcase_expense_report', EXPENSE_PAYLOAD));
    await summaryOf(panel);
    expect(lead(panel)).toBeNull();
    expect(summaryRows(panel).get('total_amount')).toEqual({
      label: 'Total',
      value: recordPageFace(EXPENSE_REPORT_DEF, 'total_amount', 1840.5),
    });
  });
});
