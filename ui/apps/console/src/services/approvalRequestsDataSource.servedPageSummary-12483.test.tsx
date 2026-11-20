/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The page objectstack serves for an approval request draws the business
 * record WHOLE (objectstack#34588; maintainer 2026-11-17: 「审批页应该直接显示
 * 完整的记录」): every field of the request's snapshot the reader may read,
 * under the target object's declared labels, each value through the record
 * page's own cell, with the object's `hidden: true` fields trimmed and a field
 * the reader may not read never drawn. A field changed after submission is
 * marked, with its current value.
 *
 * This file pinned the summary that came before it (objectui#12483, face 2 of
 * ruling C on objectui#12438): the declared amount as a lead, then at most six
 * rows, with no read of the record. #34588 retires the lead, the six-row cut
 * and the no-read rule; the faces it keeps (declared labels, the record page's
 * cell, the hidden trim, field permissions, an undeclared key takes no row,
 * labels told apart) are pinned here against the full record.
 *
 * Mounted as `approvalRequestsDataSource.servedPageApprovers-12482.test.tsx`
 * mounts it: the REAL `RecordDetailView`, opened by the generic record route
 * under the console's `ApprovalRecordReads`, so the request is read from the
 * approvals get route exactly as the shipped code reads it, and `SERVED_PAGE`
 * is objectstack `plugin-approvals`' `sys_approval_request_detail` copied
 * whole. Only the HTTP transport, the console adapter and the metadata store
 * are doubled.
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The row the approvals get serves for this case. */
let served: Record<string, unknown> = BASE_ROW;

/** The target record as it reads now; null reads as not found. */
let current: Record<string, unknown> | null = null;

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
  findOne: vi.fn(async (resource: string, id: string) => (resource === 'invoice' && id === 'inv_1' ? current : null)),
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
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    objects: { '*': all } as never,
    fields: Object.fromEntries(denied.map((f) => [`invoice.${f}`, { readable: false, editable: false }])),
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

/** The record card once the target's definition answered. */
async function recordOf(panel: HTMLElement): Promise<HTMLElement> {
  return within(panel).findByTestId('submitted-record', undefined, { timeout: 8000 });
}

/** The card's fields, in drawn order, as `{ field key -> { label, value } }`. */
function recordFields(panel: HTMLElement): Map<string, { label: string; value: string }> {
  const out = new Map<string, { label: string; value: string }>();
  for (const row of panel.querySelectorAll('[data-submitted-field]')) {
    const label = row.querySelector('dt');
    const value = row.querySelector('dd');
    // The value as submitted; a "Changed" note under it is read separately.
    const note = value?.querySelector('[data-submitted-current]');
    const text = (value?.textContent ?? '').replace(note?.textContent ?? '\u0000', '');
    out.set(row.getAttribute('data-submitted-field') as string, {
      label: (label?.textContent ?? '').trim(),
      value: text.trim(),
    });
  }
  return out;
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
  current = null;
  defs = DEFS;
  host.findOne.mockClear();
  getItem.mockClear();
  transport.mockClear();
});

/** Every declared, visible, non-bookkeeping field of `PAYLOAD`, in the object's declared order. */
const ALL_DRAWN = ['name', 'account', 'contact', 'cost_center', 'region', 'status', 'issued_on', 'amount', 'total_amount', 'tax_rate'];

describe('the served request page draws the submitted record whole (objectstack#34588, was objectui#12483)', () => {
  it('the served page parses as a spec page, and the decision panel is its last node, with no prop', () => {
    const parsed = PageSchema.safeParse(SERVED_PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    const components = SERVED_PAGE.regions[0].components;
    expect(components[components.length - 1]).toEqual({ type: 'record:approval_decision' });
    expect(JSON.stringify(SERVED_PAGE)).not.toContain('page:tabs');
  });

  it('declared labels and the record page\'s faces: option labels, the date face, a resolved reference by its name', async () => {
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    const rows = recordFields(panel);

    expect(rows.get('region')).toEqual({ label: 'Region', value: recordPageFace('region', 'emea') });
    expect(rows.get('region')?.value).toBe('EMEA');
    expect(rows.get('status')).toEqual({ label: 'Status', value: 'Sent' });
    expect(rows.get('issued_on')).toEqual({ label: 'Issued On', value: recordPageFace('issued_on', '2026-07-23') });
    // The declared label, never the server's snapshot label nor a title-cased key.
    expect(rows.get('name')).toEqual({ label: 'Invoice Number', value: 'INV-1010' });
    expect(rows.get('account')).toEqual({ label: 'Account', value: 'Fabrikam' });

    const labels = [...rows.values()].map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    // Bookkeeping columns take no row.
    for (const key of ['id', 'owner_id', 'created_at']) expect(rows.has(key)).toBe(false);
    // A reference the service did not resolve for this reader is drawn as the
    // record page draws it: the lookup cell's unresolved-reference face. The
    // summary dropped it to fit six rows; the whole record keeps it.
    expect(rows.get('contact')).toEqual({ label: 'Contact', value: recordPageFace('contact', 'con_x8Pq2LmN4pR7tZk3') });
    for (const raw of ['acc_7Hq2LmN4pR7tZk91', '2026-07-23']) expect(within(panel).queryByText(raw)).toBeNull();
  });

  it('the amount is an ordinary field in its place, through the currency face, drawn once', async () => {
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    expect(panel.querySelector('[data-summary-lead]')).toBeNull();
    expect(recordFields(panel).get('amount')).toEqual({ label: 'Invoice Amount', value: recordPageFace('amount', 12500) });
    expect(panel.querySelectorAll('[data-submitted-field="amount"]')).toHaveLength(1);
  });

  it('a hidden field takes no row, and every other field is drawn: no row cut', async () => {
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    const rows = recordFields(panel);
    expect([...rows.keys()]).toEqual(ALL_DRAWN);
    expect(rows.has('internal_score')).toBe(false);
    expect(pageText()).not.toContain('87,654');
    expect(pageText()).not.toContain('87654');
  });

  it('COUNTER-PROBE: the same snapshot with nothing declared hidden draws that field, and nothing is cut', async () => {
    const shown = { ...INVOICE_FIELDS, internal_score: { type: 'number', label: 'Internal Score' } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: shown } };
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    const rows = recordFields(panel);
    expect(rows.get('internal_score')?.label).toBe('Internal Score');
    expect(rows.size).toBe(ALL_DRAWN.length + 1);
    expect(rows.has('tax_rate')).toBe(true);
  });

  it('a hidden amount is shown nowhere', async () => {
    const hiddenAmount = { ...INVOICE_FIELDS, amount: { ...INVOICE_FIELDS.amount, hidden: true } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: hiddenAmount } };
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    expect(recordFields(panel).has('amount')).toBe(false);
    expect(pageText()).not.toContain('12,500');
  });

  it('a field the reader may not read is never drawn', async () => {
    const panel = await openServedPage(BASE_ROW, readerWithout('cost_center', 'amount'));
    await recordOf(panel);
    const rows = recordFields(panel);
    expect(pageText()).not.toContain('CC-LEDGER-SECRET');
    expect(pageText()).not.toContain('12,500');
    expect([...rows.keys()]).toEqual(ALL_DRAWN.filter((k) => k !== 'cost_center' && k !== 'amount'));
  });

  it('COUNTER-PROBE: the same reader allowed every field sees the cost center and the amount', async () => {
    const panel = await openServedPage(BASE_ROW, readerWithout());
    await recordOf(panel);
    expect(recordFields(panel).get('cost_center')).toEqual({ label: 'Cost Center', value: 'CC-LEDGER-SECRET' });
    expect(recordFields(panel).has('amount')).toBe(true);
  });

  it('the record is read once, through the console adapter, to mark what changed after submission', async () => {
    current = { ...PAYLOAD, amount: 13250, account: { id: 'acc_7Hq2LmN4pR7tZk91', name: 'Fabrikam' } };
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    await waitFor(() => expect(panel.querySelector('[data-submitted-field="amount"][data-changed="true"]')).not.toBeNull(), { timeout: 8000 });
    const invoiceReads = host.findOne.mock.calls.filter(([resource]) => resource === 'invoice');
    expect(invoiceReads.map(([resource, id]) => [resource, id])).toEqual([['invoice', 'inv_1']]);
    // No params: the read the record page sends, not a narrowed one.
    expect((invoiceReads[0] as unknown[])[2]).toBeUndefined();
    // The submitted value stays the value; the current one is beside it.
    expect(recordFields(panel).get('amount')?.value).toBe(recordPageFace('amount', 12500));
    const amount = panel.querySelector('[data-submitted-field="amount"]') as HTMLElement;
    expect(within(amount).getByTestId('submitted-field-changed').textContent).toBe('Changed');
    expect(amount.querySelector('[data-submitted-current]')?.textContent).toContain(recordPageFace('amount', 13250));
    // The same account, served expanded, is not a change.
    expect(panel.querySelector('[data-submitted-field="account"]')?.getAttribute('data-changed')).not.toBe('true');
    expect(panel.querySelectorAll('[data-changed="true"]')).toHaveLength(1);
    // The approvals get stays the only read of the request; no invoice path reaches the transport.
    const paths = transport.mock.calls.map(([input]) =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://test.local').pathname);
    expect(paths.filter((p) => p.includes('invoice'))).toEqual([]);
  });

  it('CONTROL: a record that does not read marks nothing, says so, and still draws the snapshot', async () => {
    current = null;
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    expect(await within(panel).findByTestId('submitted-record-current-unreadable', undefined, { timeout: 8000 })).toBeTruthy();
    expect(panel.querySelectorAll('[data-changed="true"]')).toHaveLength(0);
    expect([...recordFields(panel).keys()]).toEqual(ALL_DRAWN);
  });
});

describe('controls (objectui#12483, kept by objectstack#34588)', () => {
  it('CONTROL: a request with no payload draws no record card, asks for neither its definition nor its record, and still decides', async () => {
    const { payload: _p, payload_display: _d, ...bare } = BASE_ROW;
    const panel = await openServedPage(bare);
    // The panel has settled on the request: its decisions are drawn. Not the
    // "Approval progress" card: this row has no route, no tally and nobody
    // waiting, so that card has nothing to draw and is not drawn (objectstack#35730).
    expect(await within(panel).findByTestId('declared-action-approval_reject', undefined, { timeout: 8000 })).toBeTruthy();
    expect(within(panel).queryByTestId('submitted-record')).toBeNull();
    expect(getItem).not.toHaveBeenCalledWith('object', 'invoice');
    expect(host.findOne.mock.calls.filter(([resource]) => resource === 'invoice')).toEqual([]);
    expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
  });

  it('CONTROL: a payload key the object does not declare takes no row', async () => {
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    expect(recordFields(panel).has('legacy_note')).toBe(false);
    expect(pageText()).not.toContain('snapshot-era column');
  });

  it('CONTROL: two declared fields sharing one label are told apart', async () => {
    const clash = { ...INVOICE_FIELDS, region: { ...INVOICE_FIELDS.region, label: 'Status' } };
    defs = { ...DEFS, invoice: { ...INVOICE_DEF, fields: clash } };
    const panel = await openServedPage(BASE_ROW);
    await recordOf(panel);
    const rows = recordFields(panel);
    expect(rows.get('region')?.label).not.toBe(rows.get('status')?.label);
    expect(rows.get('region')?.label).toContain('Status');
    expect(rows.get('status')?.label).toContain('Status');
  });

  it('CONTROL: without the target object\'s definition nothing is drawn of the record, and the panel still decides', async () => {
    defs = { ...DEFS, invoice: null };
    const panel = await openServedPage(BASE_ROW);
    await waitFor(() => expect(getItem).toHaveBeenCalledWith('object', 'invoice'));
    expect(within(panel).queryByTestId('submitted-record')).toBeNull();
    expect(pageText()).not.toContain('CC-LEDGER-SECRET');
    expect(within(panel).getByTestId('declared-action-approval_approve')).toBeTruthy();
  });
});

describe('a key name is not read as the amount (objectui#12483, kept by objectstack#34588)', () => {
  it('a roll-up the sheet\'s name guess would match is an ordinary row, through its own cell', async () => {
    const { amount: _a, ...noCurrency } = PAYLOAD;
    const panel = await openServedPage({ ...BASE_ROW, payload: noCurrency });
    await recordOf(panel);
    expect(panel.querySelector('[data-summary-lead]')).toBeNull();
    expect(recordFields(panel).get('total_amount')).toEqual({
      label: 'Line Total',
      value: recordPageFace('total_amount', 4321),
    });
  });

  it('a declared amount of zero is drawn: zero is a value, not an empty field', async () => {
    const panel = await openServedPage({ ...BASE_ROW, payload: { ...PAYLOAD, amount: 0 } });
    await recordOf(panel);
    expect(recordFields(panel).get('amount')).toEqual({ label: 'Invoice Amount', value: recordPageFace('amount', 0) });
  });
});
