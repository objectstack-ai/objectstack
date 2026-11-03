/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#28546 — an approval request's record page reads the request from
 * the approvals service, never through the data API's record page payload.
 *
 * Measured by the card's two QA runs at objectstack `eeec88d1`: the record page
 * took its record from `DataSource.getRecordPage` (objectstack#27627), which
 * `routeApprovalRecordReads` forwarded to the console's adapter, so a request's
 * page read `POST /data/sys_approval_request/:id/page`. An ordinary approver is
 * refused that object on the data API (403 `PERMISSION_DENIED`), and the page
 * drew the access-denied screen. An admin approver was answered the data API's
 * row: no `viewer` block, so no Approve or Reject, and `pending_approvers` as
 * the stored comma-joined string, so the "Waiting on" strip drew one chip per
 * character.
 *
 * The harness is the console's own composition: the REAL `ObjectStackAdapter`
 * (the adapter the console runs, record page payload included) under
 * `ApprovalRecordReads`, the REAL inbox page and the REAL `RecordDetailView`
 * drawing the page objectstack serves for a request. Only `fetch` and the
 * inbox's queue read are doubled. The transport answers as the server does,
 * for two personas:
 *
 *   - `member`: a non-admin pending approver. The data API refuses every read
 *     of `sys_approval_request`, its page route included; the approvals get
 *     serves the request with `viewer`.
 *   - `admin`: a platform admin who is a pending approver. The data API's page
 *     route answers 200 with the stored row; the approvals get serves the
 *     request with `viewer` and its approvers as an array.
 *
 * Pinned: `approvals.account-app-entry` acceptance[3] (a row click opens the
 * request's page, whose decision panel draws and moves the request) and
 * acceptance[4] (`?request=` on the account app's component route lands on
 * that request's page), the admin approver's decisions and its chip strip, and
 * that the page sends no read of `sys_approval_request` to the data API at all.
 * The routed sources' own refusal of a request's payload is pinned at the end.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

const { approvalsApiStub, INBOX_ROW, AUTH } = vi.hoisted(() => {
  const INBOX_ROW = {
    id: 'req_28546',
    process_name: 'flow:showcase_invoice_signoff',
    process_label: 'Invoice Sign-off',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    record_id: 'inv_1',
    record_title: 'INV-1',
    status: 'pending',
    current_step: 'finance_review',
    current_step_label: 'Finance Review',
    step_label: 'Finance Review',
    pending_approvers: ['u1'],
    submitter_id: 'u9',
    submitter_name: 'Sam Submitter',
    submitted_at: '2026-11-01T05:00:00.000Z',
    updated_at: '2026-11-01T05:00:00.000Z',
  };
  // The inbox's own queue read. The request page never reads through it.
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: [INBOX_ROW], total: 1 })),
    getRequest: vi.fn(async () => ({ data: INBOX_ROW })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: INBOX_ROW, finalized: true })),
    reject: vi.fn(async () => ({ data: INBOX_ROW, finalized: true })),
  };
  // A STABLE singleton: a fresh user per render re-runs the inbox's load effect.
  const AUTH = { user: { id: 'u1', name: 'Xavier Member', image: null }, activeOrganization: null };
  return { approvalsApiStub, INBOX_ROW, AUTH };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
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
vi.mock('./approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DataSource } from '@object-ui/types';
import {
  APPROVAL_ACTION_OBJECT,
  APPROVAL_REQUEST_OBJECT,
  createApprovalRequestsDataSource,
  routeApprovalRecordReads,
} from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';
import { ApprovalsInboxPage } from '../pages/system/ApprovalsInboxPage';

const BASE = 'http://test.local';
const REQ = INBOX_ROW.id;
/** The account app's package id, the segment its Approvals nav entry lands on. */
const APP = 'com.objectstack.account';
/** The account app's Approvals entry: the `approvals:inbox` component route. */
const INBOX = `/apps/${APP}/component/approvals/inbox`;
const REQUEST_PAGE = `/apps/${APP}/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`;
const APPROVE_DOOR = `/api/v1/actions/${APPROVAL_REQUEST_OBJECT}/approval_approve`;

/** The served decision gate: the leaf-guarded form the object declares. */
const CAN_ACT = {
  dialect: 'cel',
  source: 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true',
};
const DECISION_PARAMS = [{ name: 'comment', label: 'Comment', type: 'textarea', required: false }];
const REQUEST_DEF = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  nameField: 'process_label',
  titleFormat: '{process_name}',
  highlightFields: ['process_label', 'record_id', 'status', 'current_step_label', 'submitter_id', 'updated_at'],
  fields: {
    id: { label: 'Request ID', type: 'text', readonly: true, group: 'System' },
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
    action: { label: 'Action', type: 'text' },
    comment: { label: 'Comment', type: 'textarea' },
    created_at: { label: 'Created At', type: 'datetime' },
  },
  enable: { apiMethods: ['get', 'list'] },
};
const USER_DEF = { name: 'sys_user', label: 'User', nameField: 'name', fields: { name: { label: 'Name', type: 'text' } } };
const INVOICE_DEF = { name: 'showcase_invoice', label: 'Invoice', nameField: 'name', fields: { name: { label: 'Invoice', type: 'text' } } };
const DEFS: Record<string, unknown> = {
  [APPROVAL_REQUEST_OBJECT]: REQUEST_DEF,
  [APPROVAL_ACTION_OBJECT]: ACTION_DEF,
  sys_user: USER_DEF,
  showcase_invoice: INVOICE_DEF,
};

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage`, the parts this file reads. */
const SERVED_PAGE = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: APPROVAL_REQUEST_OBJECT,
  template: 'default',
  kind: 'full',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header' },
        { type: 'record:approval_decision' },
        {
          type: 'page:tabs',
          properties: {
            tabStyle: 'line',
            position: 'top',
            items: [
              { label: 'Details', icon: 'file-text', children: [{ type: 'record:details' }] },
              {
                label: 'Timeline',
                icon: 'history',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: APPROVAL_ACTION_OBJECT,
                      relationshipField: 'request_id',
                      columns: ['created_at', 'action', 'comment'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 50,
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

type Persona = 'member' | 'admin';
const SLATE: Record<Persona, { approvers: string[]; names: Record<string, string>; override: boolean }> = {
  member: { approvers: ['u1'], names: { u1: 'Xavier Member' }, override: false },
  admin: { approvers: ['u1', 'u2', 'u3'], names: { u1: 'Dev Admin', u2: 'Ada Auditor', u3: 'Lee Legal' }, override: true },
};

/** The persona the transport answers for, and whether its decision landed. */
let persona: Persona = 'member';
let decided = false;

/** The request as `GET /approvals/requests/:id` serves it to the persona. */
function servedRequest() {
  const { process_name, process_label, object_name, record_id, current_step, current_step_label, submitter_id, updated_at } = INBOX_ROW;
  const slate = SLATE[persona];
  return {
    id: REQ, process_name, process_label, object_name, record_id, current_step, current_step_label, submitter_id, updated_at,
    status: decided ? 'approved' : 'pending',
    pending_approvers: decided ? [] : slate.approvers,
    pending_approver_names: decided ? {} : slate.names,
    viewer: { can_act: !decided, is_submitter: false, can_override: slate.override },
  };
}

/** The same request as the data API stores and serves it: no `viewer`, the slate comma-joined. */
function dataApiRow() {
  const { viewer: _viewer, pending_approver_names: _names, ...row } = servedRequest();
  return { ...row, pending_approvers: SLATE[persona].approvers.join(',') };
}

/** The data API's refusal of the object to an ordinary approver, in the server's body shape. */
const REFUSAL = {
  error: 'You do not have permission to perform this action. Contact your administrator if you need access.',
  code: 'PERMISSION_DENIED',
  object: APPROVAL_REQUEST_OBJECT,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Every request sent over HTTP: method, path with query (decoded), body. */
let wire: Array<{ method: string; path: string; body?: unknown }> = [];

const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, BASE);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  wire.push({ method, path: decodeURIComponent(url.pathname + url.search), body });
  if (url.pathname === '/api/v1/discovery') return json(200, { success: true, data: { version: 'v1', routes: {} } });
  const meta = /^\/api\/v1\/meta\/object\/([^/]+)$/.exec(url.pathname);
  if (meta) return json(200, { success: true, data: DEFS[meta[1]] ?? null });
  if (url.pathname.startsWith(`/api/v1/data/${APPROVAL_REQUEST_OBJECT}`)) {
    if (persona === 'member') return json(403, REFUSAL);
    if (method === 'POST' && url.pathname.endsWith('/page')) {
      return json(200, { success: true, data: { object: APPROVAL_REQUEST_OBJECT, id: REQ, record: dataApiRow(), related: [] } });
    }
    return json(200, { success: true, data: { records: [dataApiRow()], total: 1 } });
  }
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, servedRequest());
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  // The decision goes through the action door (objectstack#27611).
  if (method === 'POST' && url.pathname === APPROVE_DOOR) {
    decided = true;
    return json(200, { success: true, data: { request: servedRequest(), finalized: true } });
  }
  if (url.pathname.startsWith('/api/v1/data/')) return json(200, { success: true, data: { records: [], total: 0 } });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF, INVOICE_DEF], dashboards: [], reports: [],
  pages: [SERVED_PAGE], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem: vi.fn(async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null)),
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};
const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** `DefaultAppContent`'s generic record route: the view over `useAdapter()`. */
function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

/** Where the router is, and a Back button, outside the routes. */
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate(-1)}>probe-back</button>
    </>
  );
}

/** The console's composition at `entries`, over the real adapter. */
async function renderAt(entries: string[]) {
  const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: transport as never, autoReconnect: false });
  await adapter.connect();
  expect(typeof adapter.getRecordPage, 'the harness runs the adapter that answers the record page payload').toBe('function');
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <SchemaRendererProvider dataSource={adapter as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={adapter as never}>
              <ApprovalRecordReads>
                <RouterProbe />
                <Routes>
                  <Route path="/apps/:appName/home" element={<div>home</div>} />
                  <Route path="/apps/:appName/component/approvals/inbox" element={<ApprovalsInboxPage />} />
                  <Route path="/apps/:appName/:objectName/record/:recordId" element={<GenericRecordRoute />} />
                </Routes>
              </ApprovalRecordReads>
            </AdapterCtx.Provider>
          </MetadataCtx.Provider>
        </SchemaRendererProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const requestGets = () => wire.filter((w) => w.method === 'GET' && w.path === `/api/v1/approvals/requests/${REQ}`);
/** Every read of the request the page sent to the data API: the page payload, a get, a list. */
const dataApiReadsOfRequests = () => wire.filter((w) => w.path.startsWith(`/api/v1/data/${APPROVAL_REQUEST_OBJECT}`));

/** The request's page has drawn its decision panel, with both decisions, for this request. */
async function decisionPanel(): Promise<HTMLElement> {
  const panel = await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  expect(await within(panel).findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 })).toBeTruthy();
  expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
  expect((await screen.findByRole('heading', { level: 1 }, { timeout: 8000 })).textContent).toBe(INBOX_ROW.process_label);
  return panel;
}

/** The page read the request from the approvals get alone, and drew no lock screen. */
function readFromTheApprovalsGetOnly(): void {
  expect(requestGets().length).toBeGreaterThan(0);
  expect(dataApiReadsOfRequests().map((w) => `${w.method} ${w.path}`)).toEqual([]);
  expect(screen.queryByTestId('record-access-denied')).toBeNull();
}

beforeEach(() => {
  persona = 'member';
  decided = false;
  wire = [];
  transport.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe("a non-admin approver opens a request from the account app's inbox (approvals.account-app-entry)", () => {
  it('acceptance[3]: a row click opens the request page, whose decision panel draws, and one decision moves the request', async () => {
    await renderAt([INBOX]);
    await screen.findAllByText(INBOX_ROW.record_title, undefined, { timeout: 8000 });
    const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText(INBOX_ROW.record_title).length > 0);
    if (!row) throw new Error('no inbox row for the request');
    fireEvent.click(row);

    const panel = await decisionPanel();
    expect(where()).toBe(REQUEST_PAGE);
    readFromTheApprovalsGetOnly();

    const before = requestGets().length;
    fireEvent.click(within(panel).getByTestId('declared-action-approval_approve'));
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 8000 });
    fireEvent.change(await within(dialog).findByRole('textbox', undefined, { timeout: 8000 }), { target: { value: 'Checked' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(wire.some((w) => w.method === 'POST' && w.path === APPROVE_DOOR)).toBe(true), { timeout: 8000 });
    expect(wire.find((w) => w.method === 'POST' && w.path === APPROVE_DOOR)?.body).toMatchObject({ recordId: REQ });

    // The request is re-read from the approvals get, and the decisions stop
    // rendering: their visible predicates read `record.viewer.can_act`, now false.
    await waitFor(() => expect(requestGets().length).toBeGreaterThan(before), { timeout: 8000 });
    await waitFor(
      () => expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull(),
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('declared-action-approval_reject')).toBeNull();
    expect(dataApiReadsOfRequests()).toEqual([]);
  });

  it('acceptance[3], cold: a load of the record route on the account app draws the decision panel', async () => {
    await renderAt([REQUEST_PAGE]);
    await decisionPanel();
    readFromTheApprovalsGetOnly();
  });

  it('acceptance[4]: ?request= on the component route replaces itself with the record route, which shows that request', async () => {
    await renderAt([`/apps/${APP}/home`, `${INBOX}?request=${REQ}`]);
    await decisionPanel();
    expect(where()).toBe(REQUEST_PAGE);
    readFromTheApprovalsGetOnly();
    // Replaced, not stacked: Back leaves to where the reader came from.
    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }));
    expect(where()).toBe(`/apps/${APP}/home`);
  });
});

describe('an admin who is a pending approver, whom the data API would answer (objectstack#28546)', () => {
  it('the page draws Approve and Reject from the served viewer, and one chip per approver', async () => {
    persona = 'admin';
    await renderAt([`/apps/com.objectstack.setup/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]);
    const panel = await decisionPanel();
    readFromTheApprovalsGetOnly();
    const strip = await within(panel).findByTestId('approval-decision-pending-approvers', undefined, { timeout: 8000 });
    const chips = within(strip).getAllByTestId('approver-chip').map((chip) => chip.textContent);
    expect(chips).toEqual(['Dev Admin', 'Ada Auditor', 'Lee Legal']);
  });
});

describe("both routed sources refuse a request's record page payload (objectstack#28546)", () => {
  function hostWithPayload() {
    return {
      find: vi.fn(async () => ({ data: [], total: 0 })),
      findOne: vi.fn(async () => null),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
      getObjectSchema: vi.fn(async () => null),
      getRecordPage: vi.fn(async (resource: string, id: string) => ({ object: resource, id, record: { id } })),
      prefetchRecordPage: vi.fn(),
    };
  }
  const SOURCES: Array<[string, (host: DataSource) => DataSource]> = [
    ['routeApprovalRecordReads', (host) => routeApprovalRecordReads(host, { fetch: transport, baseUrl: `${BASE}/api/v1` })],
    [
      'createApprovalRequestsDataSource',
      (host) => createApprovalRequestsDataSource({ host, scope: { kind: 'all' }, fetch: transport, baseUrl: `${BASE}/api/v1` }),
    ],
  ];

  for (const [name, routed] of SOURCES) {
    it(`${name}: a request's getRecordPage rejects before any request goes out; another object's is the host's`, async () => {
      const host = hostWithPayload();
      const source = routed(host as unknown as DataSource);
      await expect(source.getRecordPage!(APPROVAL_REQUEST_OBJECT, REQ, { approvals: true })).rejects.toMatchObject({
        code: 'UNSUPPORTED_QUERY_PARAM',
      });
      expect(host.getRecordPage).not.toHaveBeenCalled();
      expect(wire).toEqual([]);
      await expect(source.getRecordPage!('showcase_invoice', 'inv_1', { approvals: true })).resolves.toMatchObject({ id: 'inv_1' });
      expect(host.getRecordPage).toHaveBeenCalledWith('showcase_invoice', 'inv_1', { approvals: true });
    });

    it(`${name}: a request's prefetch sends nothing; another object's is the host's`, () => {
      const host = hostWithPayload();
      const source = routed(host as unknown as DataSource);
      source.prefetchRecordPage!(APPROVAL_REQUEST_OBJECT, REQ, {});
      expect(host.prefetchRecordPage).not.toHaveBeenCalled();
      source.prefetchRecordPage!('showcase_invoice', 'inv_1', {});
      expect(host.prefetchRecordPage).toHaveBeenCalledWith('showcase_invoice', 'inv_1', {});
      expect(wire).toEqual([]);
    });

    it(`${name}: CONTROL: over a host without the payload, it offers none`, () => {
      const { getRecordPage: _get, prefetchRecordPage: _prefetch, ...host } = hostWithPayload();
      const source = routed(host as unknown as DataSource);
      expect(typeof source.getRecordPage).toBe('undefined');
      expect(typeof source.prefetchRecordPage).toBe('undefined');
    });
  }
});
