/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13324 — the served approval request page, opened by a NON-ADMIN
 * approver, under the REAL `MePermissionsProvider`.
 *
 * The other served-page tests mount no permission provider, so
 * `usePermissions()` answers every field readable and nothing is ever
 * stripped. The console mounts `MePermissionsProvider` over every app
 * (`ConsolePermissionsScope`), and a member's `/auth/me/permissions` answer
 * names neither `sys_approval_request` nor `sys_approval_action`: objectstack
 * keeps the data API closed on both to non-administrators on purpose (the
 * approvals routes answer who may see a request). `checkField` and
 * `check(object, 'read')` fail closed for an object the answer does not
 * mention, so before this fix the record page folded the row the approvals get
 * served down to its `id` and dropped the Timeline's related list: a heading
 * with no fields, no tally, no decisions and an empty Timeline
 * (objectstack-ai/objectstack#25228).
 *
 * The control mounts the same page through the routed adapter WITHOUT
 * `ApprovalRecordReads`, under the same answer, and pins that blank page: it is
 * what proves the member answer here is one that strips, so the first test can
 * only pass because `ApprovalRecordReads` scopes the field-read gate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
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
import { MePermissionsProvider, usePermissions, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordDetailView } from '@object-ui/app-shell';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT, routeApprovalRecordReads } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const REQ = 'req_13324';
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
  updated_at: '2026-10-22T09:00:00Z',
  viewer: { can_act: true, is_submitter: false, can_override: false },
  decision_progress: { behavior: 'quorum', got: 1, need: 2 },
};
const TIMELINE = [
  { id: 'act_1', request_id: REQ, action: 'submit', actor_id: 'u2', step_name: 'manager_review', comment: 'Please review the laptop order', created_at: '2026-10-21T09:00:00Z' },
  { id: 'act_2', request_id: REQ, action: 'approve', actor_id: 'u3', step_name: 'manager_review', comment: 'Budget checked', created_at: '2026-10-22T09:00:00Z' },
];

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

/**
 * A signed-in member's `/auth/me/permissions` answer, in the shape objectstack
 * serves it: read on the objects a member works with, and NO entry for either
 * approval object, so `checkField` takes its authenticated unknown-object
 * default (closed) for both.
 */
const MEMBER_ANSWER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: ['member'],
  permissionSets: ['member_default'],
  systemPermissions: [],
  objects: {
    sys_user: { allowRead: true },
    invoice: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  fields: {},
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

/** The console adapter, doubled: everything the approvals routes do not serve lands here. */
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

/** The console's mount order: the member's permission answer above the app. */
function openAsMember(appLayer: (routes: ReactNode) => ReactNode) {
  const routes = (
    <Routes>
      <Route path=":objectName/record/:recordId" element={<GenericRecordRoute />} />
    </Routes>
  );
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={MEMBER_ANSWER}>
        <MemoryRouter initialEntries={[`/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>{appLayer(routes)}</AdapterCtx.Provider>
          </MetadataCtx.Provider>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

/** As the console mounts it: `AppContent` puts `ApprovalRecordReads` over every app. */
const consoleLayer = (routes: ReactNode) => <ApprovalRecordReads>{routes}</ApprovalRecordReads>;

/** The control: the same routed reads, without `ApprovalRecordReads` around them. */
const routedReadsOnly = (routes: ReactNode) => (
  <AdapterCtx.Provider value={routeApprovalRecordReads(host as never) as never}>{routes}</AdapterCtx.Provider>
);

const requestGets = () => wire.filter((w) => w === `GET /api/v1/approvals/requests/${REQ}`);
const timelineGets = () => wire.filter((w) => w === `GET /api/v1/approvals/requests/${REQ}/actions`);
const pageText = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  wire = [];
  host.find.mockClear();
  host.findOne.mockClear();
});

describe('the served request page for a non-admin approver, under the real MePermissionsProvider (objectui#13324)', () => {
  it("draws the tally and the decisions the served viewer may take, though the member's answer names neither approval object", async () => {
    openAsMember(consoleLayer);
    const panel = await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
    expect(await within(panel).findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 })).toBeTruthy();
    expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
    const bar = await within(panel).findByRole('progressbar', undefined, { timeout: 8000 });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(requestGets().length).toBeGreaterThan(0);
  });

  it("draws the request's fields: the flow and step chips the highlights strip reads from the served row", async () => {
    openAsMember(consoleLayer);
    await screen.findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 });
    await waitFor(() => expect(pageText()).toContain('Invoice Approval'), { timeout: 8000 });
    expect(pageText()).toContain('Manager Review');
  });

  it("lists the request's timeline, read from the actions route", async () => {
    openAsMember(consoleLayer);
    const tab = await screen.findByRole('tab', { name: /Timeline/ }, { timeout: 8000 });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText('Budget checked', undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Please review the laptop order')).toBeTruthy();
  });

  it('control: the same answer strips the served row to its id when the routed reads are mounted without ApprovalRecordReads', async () => {
    openAsMember(routedReadsOnly);
    // The page is up and the approvals get answered: the tab strip is drawn
    // and the heading names the request by its object label and id, the
    // title's last rung, as the blank page the report describes does.
    await screen.findByRole('tab', { name: /Details/ }, { timeout: 8000 });
    await waitFor(() => expect(requestGets().length).toBeGreaterThan(0), { timeout: 8000 });
    await screen.findByRole('heading', { level: 1, name: /^Approval Request req_/ }, { timeout: 8000 });
    expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
    expect(screen.queryByTestId('declared-action-approval_reject')).toBeNull();
    expect(pageText()).not.toContain('Invoice Approval');
    expect(pageText()).not.toContain('Manager Review');
    const tab = screen.getByRole('tab', { name: /Timeline/ });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'), { timeout: 8000 });
    // The member may not read `sys_approval_action` by the data API's answer,
    // so the Timeline's related list is not drawn and never reads the route.
    expect(timelineGets()).toEqual([]);
    expect(pageText()).not.toContain('Budget checked');
  });
});

describe("ApprovalRecordReads' read scope (objectui#13324)", () => {
  function Probe({ seen }: { seen: ReturnType<typeof usePermissions>[] }) {
    seen.push(usePermissions());
    return null;
  }

  it("answers reads of both approval objects as allowed, and leaves writes and every other object to the member's answer", () => {
    const seen: ReturnType<typeof usePermissions>[] = [];
    render(
      <MePermissionsProvider initialPermissions={MEMBER_ANSWER}>
        <AdapterCtx.Provider value={host as never}>
          <ApprovalRecordReads>
            <Probe seen={seen} />
          </ApprovalRecordReads>
        </AdapterCtx.Provider>
      </MePermissionsProvider>,
    );
    const perms = seen[seen.length - 1];
    expect(perms.isLoaded).toBe(true);
    expect(perms.checkField(APPROVAL_REQUEST_OBJECT, 'status', 'read')).toBe(true);
    expect(perms.checkField(APPROVAL_REQUEST_OBJECT, 'viewer', 'read')).toBe(true);
    expect(perms.checkField(APPROVAL_ACTION_OBJECT, 'comment', 'read')).toBe(true);
    expect(perms.can(APPROVAL_REQUEST_OBJECT, 'read')).toBe(true);
    expect(perms.can(APPROVAL_ACTION_OBJECT, 'read')).toBe(true);
    expect(perms.checkField(APPROVAL_REQUEST_OBJECT, 'status', 'write')).toBe(false);
    expect(perms.checkField(APPROVAL_ACTION_OBJECT, 'comment', 'create')).toBe(false);
    expect(perms.can(APPROVAL_REQUEST_OBJECT, 'update')).toBe(false);
    expect(perms.can(APPROVAL_ACTION_OBJECT, 'create')).toBe(false);
    expect(perms.can(APPROVAL_REQUEST_OBJECT, 'export')).toBe(false);
    expect(perms.can('showcase_secret', 'read')).toBe(false);
    expect(perms.checkField('showcase_secret', 'value', 'read')).toBe(false);
    expect(perms.checkField('invoice', 'name', 'read')).toBe(true);
  });
});
