/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12483 (face 2 of ruling C on objectui#12438): the page objectstack
 * serves for an approval request shows the request's declared amount and a
 * summary of its record snapshot, under the target object's declared labels,
 * each value through the record page's own cell, with the object's
 * `hidden: true` fields trimmed and a field the reader may not read never
 * drawn, as the approvals inbox's request sheet shows them.
 *
 * Mounted as `approvalRequestsDataSource.servedPageApprovers-12482.test.tsx`
 * mounts it: the REAL `RecordDetailView`, opened by the generic record route
 * under the console's `ApprovalRecordReads`, so the request is read from the
 * approvals get route exactly as the shipped code reads it, and `SERVED_PAGE`
 * is objectstack `plugin-approvals`' `sys_approval_request_detail` copied
 * whole. Only the HTTP transport, the console adapter and the metadata store
 * are doubled.
 *
 * The sheet's pins were the spec of the face, matched by assertion and not by
 * markup, and the first two retired with the sheet (objectui#12484), against
 * this file: `ApprovalsInboxPage.summaryFaces-11677.test.tsx` (declared labels,
 * the record page's cell, an undeclared key takes no row, labels told apart),
 * `ApprovalsInboxPage.hiddenFieldTrim.test.tsx` (a hidden field is dropped
 * before the row cut and never leads) and
 * `ApprovalsInboxPage.queueHiddenAmount.test.tsx` (a hidden amount is not
 * shown). The amount here is the DECLARED one, a `currency` field: the sheet's
 * key-name guess is deliberately not ported, and the last describe block pins
 * that boundary.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
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

import { AdapterCtx, MetadataCtx, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { RecordDetailView } from '@object-ui/app-shell';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const REQ = 'req_12483';

/** The target object, with the system columns the registry injects. */
const INVOICE_FIELDS: Record<string, Record<string, unknown>> = {
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', system: true },
  created_at: { type: 'datetime', label: 'Created At', readonly: true, system: true },
  name: { type: 'text', label: 'Invoice Number' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  contact: { type: 'lookup', reference: 'contact', label: 'Contact' },
  cost_center: { type: 'text', label: 'Cost Center' },
  internal_score: { type: 'number', label: 'Internal Score', hidden: true },
  region: {
    type: 'select', label: 'Region',
    options: [{ label: 'AMER', value: 'amer' }, { label: 'EMEA', value: 'emea' }],
  },
  status: {
    type: 'select', label: 'Status',
    options: [{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' }],
  },
  issued_on: { type: 'date', label: 'Issued On' },
  amount: { type: 'currency', label: 'Invoice Amount' },
  // A roll-up whose NAME the sheet's amount guess matches; declared `summary`.
  total_amount: { type: 'summary', label: 'Line Total' },
  tax_rate: { type: 'number', label: 'Tax Rate (%)' },
};
const INVOICE_DEF = { name: 'invoice', label: 'Invoice', nameField: 'name', fields: INVOICE_FIELDS };

/** The snapshot as the approvals get serves it, in the stored column order. */
const PAYLOAD = {
  id: 'inv_1',
  created_at: '2026-10-06T06:44:23.359Z',
  owner_id: 'rOrg4X8TWQKqZDDLH3dH7JDhSZ69dEwm',
  name: 'INV-1010',
  account: 'acc_7Hq2LmN4pR7tZk91',
  contact: 'con_x8Pq2LmN4pR7tZk3',
  cost_center: 'CC-LEDGER-SECRET',
  internal_score: 87654,
  region: 'emea',
  status: 'sent',
  issued_on: '2026-07-23',
  amount: 12500,
  legacy_note: 'snapshot-era column',
  total_amount: 4321,
  tax_rate: 20,
};

const BASE_ROW = {
  id: REQ,
  process_name: 'flow:invoice_approval',
  process_label: 'Invoice Approval',
  object_name: 'invoice',
  record_id: 'inv_1',
  status: 'pending',
  current_step: 'manager_review',
  current_step_label: 'Manager Review',
  submitter_id: 'u2',
  updated_at: '2026-10-02T09:00:00Z',
  viewer: { can_act: true, is_submitter: false, can_override: false },
  pending_approvers: [],
  payload: PAYLOAD,
  // The service resolves `owner_id` and `account`; `contact` stays unresolved.
  payload_display: { owner_id: 'Dev Admin', account: 'Fabrikam' },
  payload_labels: { name: 'Invoice No (server)' },
};

const CAN_ACT = {
  dialect: 'cel',
  source: 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true',
};
const DECISION_PARAMS = [
  { name: 'comment', label: 'Comment', type: 'textarea', required: false },
  { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
];
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
    pending_approvers: { label: 'Pending Approvers', type: 'textarea', group: 'State' },
    updated_at: { label: 'Updated At', type: 'datetime', group: 'System' },
  },
  actions: [
    {
      name: 'approval_approve', label: 'Approve', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve', params: DECISION_PARAMS,
      visible: CAN_ACT, locations: ['record_section', 'list_item'], refreshAfter: true,
    },
    {
      name: 'approval_reject', label: 'Reject', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reject', params: DECISION_PARAMS,
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
    step_name: { label: 'Step', type: 'text' },
    action: { label: 'Action', type: 'select', options: [{ value: 'submit', label: 'Submitted' }] },
    actor_id: { label: 'Actor', type: 'lookup', reference: 'sys_user' },
    comment: { label: 'Comment', type: 'textarea' },
    attachments: { label: 'Attachments', type: 'file', multiple: true },
    created_at: { label: 'Created At', type: 'datetime' },
  },
  enable: { apiMethods: ['get', 'list'] },
};
const USER_DEF = { name: 'sys_user', label: 'User', nameField: 'name', fields: { name: { label: 'Name', type: 'text' } } };
const DEFS: Record<string, unknown> = {
  [APPROVAL_REQUEST_OBJECT]: REQUEST_DEF,
  [APPROVAL_ACTION_OBJECT]: ACTION_DEF,
  sys_user: USER_DEF,
  invoice: INVOICE_DEF,
};

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage`, whole (as of objectstack `09dd537193`). */
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The row the approvals get serves for this case. */
let served: Record<string, unknown> = BASE_ROW;

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

/** What the metadata store answers for an object definition; a case may withhold one. */
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

/** A signed-in reader who may read everything except the fields named. */
function readerWithout(...denied: string[]): MePermissionsResponse {
  const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    objects: { '*': all } as never,
    fields: Object.fromEntries(denied.map((f) => [`invoice.${f}`, { readable: false }])),
    systemPermissions: [],
  };
}

async function openServedPage(
  row: Record<string, unknown>,
  permissions?: MePermissionsResponse,
): Promise<HTMLElement> {
  served = row;
  const page = (
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
        <MetadataCtx.Provider value={metadata as never}>
          <AdapterCtx.Provider value={host as never}>
            <ApprovalRecordReads>
              <Routes>
                <Route path=":objectName/record/:recordId" element={<GenericRecordRoute />} />
              </Routes>
            </ApprovalRecordReads>
          </AdapterCtx.Provider>
        </MetadataCtx.Provider>
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

/** The summary once the target's definition answered. */
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
function recordPageFace(field: string, value: unknown): string {
  const def = { ...INVOICE_FIELDS[field], name: field };
  const Cell = getCellRenderer(resolveCellRendererType(def as { type?: string; format?: string }));
  const { container, unmount } = render(<Cell value={value} field={def as never} />);
  const text = (container.textContent ?? '').trim();
  unmount();
  return text;
}

const pageText = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  served = BASE_ROW;
  defs = DEFS;
  getItem.mockClear();
  transport.mockClear();
});

describe('the served request page shows the declared amount and a summary of the snapshot (objectui#12483)', () => {
  it('the served page parses as a spec page, with no node or prop added for the summary', () => {
    const parsed = PageSchema.safeParse(SERVED_PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(SERVED_PAGE.slots.actions).toEqual([{ type: 'record:approval_decision' }]);
  });

  it('declared labels and the record page\'s faces: option labels, the date face, a resolved reference by its name', async () => {
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    const rows = summaryRows(panel);

    expect(rows.get('region')).toEqual({ label: 'Region', value: recordPageFace('region', 'emea') });
    expect(rows.get('region')?.value).toBe('EMEA');
    expect(rows.get('status')).toEqual({ label: 'Status', value: 'Sent' });
    expect(rows.get('issued_on')).toEqual({ label: 'Issued On', value: recordPageFace('issued_on', '2026-07-23') });
    // The declared label, never the server's snapshot label nor a title-cased key.
    expect(rows.get('name')).toEqual({ label: 'Invoice Number', value: 'INV-1010' });
    expect(rows.get('account')).toEqual({ label: 'Account', value: 'Fabrikam' });

    const labels = [...rows.values()].map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    // Bookkeeping columns and the unresolved reference take no row, and no id is printed.
    for (const key of ['id', 'owner_id', 'created_at', 'contact']) expect(rows.has(key)).toBe(false);
    for (const raw of ['con_x8Pq2LmN4pR7tZk3', 'acc_7Hq2LmN4pR7tZk91', '2026-07-23']) {
      expect(within(panel).queryByText(raw)).toBeNull();
    }
  });

  it('the declared amount leads, under its declared label, through the currency face, and is not repeated as a row', async () => {
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    expect(lead(panel)).toEqual({ key: 'amount', label: 'Invoice Amount', value: recordPageFace('amount', 12500) });
    expect(lead(panel)?.value).toContain('12,500');
    expect(summaryRows(panel).has('amount')).toBe(false);
  });

  it('a hidden field takes no row and the next field takes its slot', async () => {
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    const rows = summaryRows(panel);
    expect([...rows.keys()]).toEqual(['name', 'account', 'cost_center', 'region', 'status', 'issued_on']);
    expect(rows.has('internal_score')).toBe(false);
    expect(pageText()).not.toContain('87,654');
    expect(pageText()).not.toContain('87654');
  });

  it('COUNTER-PROBE: the same snapshot with nothing declared hidden draws that field, and the last row is cut', async () => {
    const shown = { ...INVOICE_FIELDS, internal_score: { type: 'number', label: 'Internal Score' } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: shown } };
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    const rows = summaryRows(panel);
    expect([...rows.keys()]).toEqual(['name', 'account', 'cost_center', 'internal_score', 'region', 'status']);
    expect(rows.get('internal_score')?.label).toBe('Internal Score');
  });

  it('a hidden amount never leads, and is shown nowhere', async () => {
    const hiddenAmount = { ...INVOICE_FIELDS, amount: { ...INVOICE_FIELDS.amount, hidden: true } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: hiddenAmount } };
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    expect(lead(panel)).toBeNull();
    expect(summaryRows(panel).has('amount')).toBe(false);
    expect(pageText()).not.toContain('12,500');
  });

  it('a field the reader may not read is never drawn, and its slot goes to the next field', async () => {
    const panel = await openServedPage(BASE_ROW, readerWithout('cost_center', 'amount'));
    await summaryOf(panel);
    const rows = summaryRows(panel);
    expect(rows.has('cost_center')).toBe(false);
    expect(lead(panel)).toBeNull();
    expect(pageText()).not.toContain('CC-LEDGER-SECRET');
    expect(pageText()).not.toContain('12,500');
    expect([...rows.keys()]).toEqual(['name', 'account', 'region', 'status', 'issued_on', 'total_amount']);
  });

  it('COUNTER-PROBE: the same reader allowed every field sees the cost center', async () => {
    const panel = await openServedPage(BASE_ROW, readerWithout());
    await summaryOf(panel);
    expect(summaryRows(panel).get('cost_center')).toEqual({ label: 'Cost Center', value: 'CC-LEDGER-SECRET' });
    expect(lead(panel)?.key).toBe('amount');
  });

  it('the summary costs no read beyond the approvals get: the snapshot is in the row, the definition in the metadata store', async () => {
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    expect(getItem).toHaveBeenCalledWith('object', 'invoice');
    const paths = transport.mock.calls.map(([input]) =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://test.local').pathname);
    expect(paths.filter((p) => p.includes('invoice'))).toEqual([]);
  });
});

describe('controls (objectui#12483)', () => {
  it('CONTROL: a request with no payload draws no summary, and still its decisions', async () => {
    const { payload: _p, payload_display: _d, ...bare } = BASE_ROW;
    const panel = await openServedPage(bare);
    await waitFor(() => expect(getItem).toHaveBeenCalledWith('object', 'invoice'));
    expect(within(panel).queryByTestId('record-snapshot-summary')).toBeNull();
    expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
  });

  it('CONTROL: a payload key the object does not declare takes no row, as the sheet drops it', async () => {
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    expect(summaryRows(panel).has('legacy_note')).toBe(false);
    expect(pageText()).not.toContain('snapshot-era column');
  });

  it('CONTROL: two declared fields sharing one label are told apart', async () => {
    const clash = { ...INVOICE_FIELDS, region: { ...INVOICE_FIELDS.region, label: 'Status' } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: clash } };
    const panel = await openServedPage(BASE_ROW);
    await summaryOf(panel);
    const rows = summaryRows(panel);
    expect(rows.get('region')?.label).not.toBe(rows.get('status')?.label);
    expect(rows.get('region')?.label).toContain('Status');
    expect(rows.get('status')?.label).toContain('Status');
  });

  it('CONTROL: without the target object\'s definition nothing is summarized, and the panel still decides', async () => {
    defs = { ...DEFS, invoice: null };
    const panel = await openServedPage(BASE_ROW);
    await waitFor(() => expect(getItem).toHaveBeenCalledWith('object', 'invoice'));
    expect(within(panel).queryByTestId('record-snapshot-summary')).toBeNull();
    expect(pageText()).not.toContain('CC-LEDGER-SECRET');
    expect(within(panel).getByTestId('declared-action-approval_approve')).toBeTruthy();
  });
});

describe('the amount is the declared one; a key name is not read (objectui#12483)', () => {
  it('a roll-up the sheet\'s name guess would match is an ordinary row, not the amount', async () => {
    // No currency field in the snapshot; `cost_center` is left out too, so the
    // roll-up falls inside the six rows rather than being cut.
    const { amount: _a, cost_center: _c, ...noCurrency } = PAYLOAD;
    const panel = await openServedPage({ ...BASE_ROW, payload: noCurrency });
    await summaryOf(panel);
    expect(lead(panel)).toBeNull();
    expect(summaryRows(panel).get('total_amount')).toEqual({
      label: 'Line Total',
      value: recordPageFace('total_amount', 4321),
    });
  });

  it('a declared amount of zero still leads: it is the record\'s amount', async () => {
    const panel = await openServedPage({ ...BASE_ROW, payload: { ...PAYLOAD, amount: 0 } });
    await summaryOf(panel);
    expect(lead(panel)).toEqual({ key: 'amount', label: 'Invoice Amount', value: recordPageFace('amount', 0) });
  });
});
