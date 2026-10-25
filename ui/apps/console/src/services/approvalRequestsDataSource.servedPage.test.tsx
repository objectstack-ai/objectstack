/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12045 (B1's page-mount step) — the page objectstack serves for an
 * approval request, on the REAL `RecordDetailView`, opened the way the console
 * opens it: the generic record route reads the adapter the console's
 * `ApprovalRecordReads` provides.
 *
 * `SERVED_PAGE` is objectstack's `sys_approval_request_detail` as
 * `plugin-approvals` ships it (`sys-approval-request.page.ts`), copied whole,
 * not the build round's in-repo fixture. The object definitions are the
 * served objects' own fields, field groups, `highlightFields` and declared
 * actions that the page reads, abridged to those. Only the HTTP transport and
 * the console adapter are doubled.
 *
 * What the page reads, and from where:
 *   - the request from `GET /approvals/requests/:id` (with `viewer` and
 *     `decision_progress`), through the provider, never through the adapter;
 *   - the Timeline tab's list AND its count from
 *     `GET /approvals/requests/:id/actions`;
 *   - the timeline's label read of its `request_id` column from the adapter,
 *     never refused (the build round's carried pin: under its route the same
 *     read was refused by the routed source's list).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
import { RecordDetailView } from '@object-ui/app-shell';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const REQ = 'req_12045';
const ROW = {
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
  decision_progress: { behavior: 'quorum', got: 1, need: 2 },
};
const TIMELINE = [
  { id: 'act_1', request_id: REQ, action: 'submit', actor_id: 'u2', step_name: 'manager_review', comment: 'Please review the laptop order', created_at: '2026-10-01T09:00:00Z' },
  { id: 'act_2', request_id: REQ, action: 'approve', actor_id: 'u3', step_name: 'manager_review', comment: 'Budget checked', created_at: '2026-10-02T09:00:00Z' },
];

/** The served decision gate: the leaf-guarded form the object declares. */
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
    action: {
      label: 'Action', type: 'select',
      options: [{ value: 'submit', label: 'Submitted' }, { value: 'approve', label: 'Approved' }],
    },
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
};

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage`, whole. */
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

/** Every request the page sent over HTTP: method, then path and query. */
let wire: string[] = [];

/** The approvals routes, answered as objectstack's REST server answers them. */
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  wire.push(`${method} ${url.pathname}${url.search}`);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, ROW);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: TIMELINE });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

/** The console adapter, doubled: everything the provider does not route lands here. */
const host = {
  find: vi.fn(async (_resource: string, _params?: unknown) => ({ data: [], total: 0 })),
  findOne: vi.fn(async (_resource: string, _id: string) => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};

const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF], dashboards: [], reports: [],
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

function openServedPage() {
  return render(
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
    </I18nProvider>,
  );
}

const requestGets = () => wire.filter((w) => w === `GET /api/v1/approvals/requests/${REQ}`);
const timelineGets = () => wire.filter((w) => w === `GET /api/v1/approvals/requests/${REQ}/actions`);

afterEach(() => {
  cleanup();
  wire = [];
  host.find.mockClear();
  host.findOne.mockClear();
});

describe("the served request page, opened through the console's adapter layer (objectui#12045)", () => {
  it('the served page parses as a spec page', () => {
    const parsed = PageSchema.safeParse(SERVED_PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it("draws the decision panel's tally and the decisions the served viewer may take, read from the approvals get", async () => {
    openServedPage();
    const panel = await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
    const bar = await within(panel).findByRole('progressbar', undefined, { timeout: 8000 });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(await within(panel).findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 })).toBeTruthy();
    expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
    expect(requestGets().length).toBeGreaterThan(0);
    expect(host.findOne.mock.calls.some(([resource]) => resource === APPROVAL_REQUEST_OBJECT)).toBe(false);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Details', 'Timeline']);
  });

  it("the Timeline tab counts and lists the request's actions from the actions route, never from the adapter", async () => {
    openServedPage();
    const tab = await screen.findByRole('tab', { name: /Timeline/ }, { timeout: 8000 });
    expect(await within(tab).findByText('2', undefined, { timeout: 8000 })).toBeTruthy();
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText('Budget checked', undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Please review the laptop order')).toBeTruthy();
    expect(timelineGets().length).toBeGreaterThan(0);
    expect(host.find.mock.calls.some(([resource]) => resource === APPROVAL_ACTION_OBJECT)).toBe(false);
  });

  it("the timeline's label read of its request_id column reaches the adapter, and no read the page makes is refused", async () => {
    const warn = vi.spyOn(console, 'warn');
    try {
      openServedPage();
      const tab = await screen.findByRole('tab', { name: /Timeline/ }, { timeout: 8000 });
      fireEvent.mouseDown(tab);
      fireEvent.click(tab);
      await screen.findByText('Budget checked', undefined, { timeout: 8000 });
      await waitFor(
        () =>
          expect(
            host.find.mock.calls.some(
              ([resource, params]) =>
                resource === APPROVAL_REQUEST_OBJECT &&
                JSON.stringify((params as { $filter?: unknown })?.$filter ?? null).includes(REQ),
            ),
            'the label read asked the adapter for the parent request',
          ).toBe(true),
        { timeout: 8000 },
      );
      const lookupFailures = warn.mock.calls.filter(([message]) => String(message).includes('Failed to resolve lookups'));
      expect(lookupFailures, 'no lookup-label read was refused').toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('ApprovalRecordReads (objectui#12045)', () => {
  function Probe({ seen }: { seen: unknown[] }) {
    seen.push(useAdapter());
    return null;
  }

  it('answers useAdapter() with one routed adapter per console adapter, across renders and remounts', () => {
    const seen: unknown[] = [];
    const tree = () => (
      <AdapterCtx.Provider value={host as never}>
        <ApprovalRecordReads>
          <Probe seen={seen} />
        </ApprovalRecordReads>
      </AdapterCtx.Provider>
    );
    const first = render(tree());
    first.rerender(tree());
    first.unmount();
    render(tree());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0]).not.toBe(host);
    expect(new Set(seen).size, 'one identity for every surface below, whatever React keeps or discards').toBe(1);
  });

  it("sends a request's findOne to the approvals get, and leaves another object's read and a list of requests to the adapter", async () => {
    const seen: unknown[] = [];
    render(
      <AdapterCtx.Provider value={host as never}>
        <ApprovalRecordReads>
          <Probe seen={seen} />
        </ApprovalRecordReads>
      </AdapterCtx.Provider>,
    );
    expect(seen[0]).toBeTruthy();
    const source = seen[0] as { findOne: typeof host.findOne; find: typeof host.find };
    await expect(source.findOne(APPROVAL_REQUEST_OBJECT, REQ)).resolves.toMatchObject({ id: REQ, viewer: ROW.viewer });
    await source.findOne('invoice', 'inv_1');
    await source.find(APPROVAL_REQUEST_OBJECT, { $filter: { status: 'pending' } });
    expect(requestGets()).toHaveLength(1);
    expect(host.findOne.mock.calls.map(([resource]) => resource)).toEqual(['invoice']);
    expect(host.find).toHaveBeenCalledWith(APPROVAL_REQUEST_OBJECT, { $filter: { status: 'pending' } });
  });

  it('control: with no console adapter yet, it provides none', () => {
    const seen: unknown[] = [];
    render(
      <ApprovalRecordReads>
        <Probe seen={seen} />
      </ApprovalRecordReads>,
    );
    expect(seen.every((value) => value === null)).toBe(true);
  });
});
