/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12557 — on the page objectstack serves for an approval request, the
 * target reference links to the record when, and only when, the approver may
 * read it.
 *
 * The Details tab draws the request's `record_id` / `object_name` pointer pair
 * through `RecordPreviewCard`, by way of the pointer card renderer. The inbox
 * sheet links the same reference to the app-scoped record path
 * (`ApprovalsInboxPage.recordLink.test.tsx`); before this card, the served page
 * drew the readable target with no link at all (objectui#12489's fit check).
 *
 * The page is the REAL `RecordDetailView` on the console's app-scoped record
 * route, reading through `ApprovalRecordReads`, under the root
 * `SchemaRendererProvider` as `ConsoleShell` mounts it. `SERVED_PAGE` is
 * objectstack's `sys_approval_request_detail` as `plugin-approvals` ships it,
 * copied whole. Only the HTTP transport and the console adapter are doubled;
 * the target invoice's by-id read is the adapter's `findOne`, answered per case.
 *
 * The object list handed to the view carries the invoice's definition, as the
 * console's metadata catalog does: the record page links only to an object it
 * can route to.
 *
 * Links are counted by the pathname their href resolves to, so the pins hold
 * whatever query string the record page's builder adds (its `?from=` trail).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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
import { RecordDetailView } from '@object-ui/app-shell';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const APP = 'probe_app';
const REQ = 'req_12557';
const TARGET_TITLE = 'INV-1010';

const INVOICE_DEF = {
  name: 'invoice',
  label: 'Invoice',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Invoice Number' },
    amount: { type: 'currency', label: 'Invoice Amount' },
  },
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
  actions: [],
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
  invoice: INVOICE_DEF,
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

/** The request row the approvals get answers, per case. */
let served: Record<string, unknown> = {};
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, served);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

const httpError = (status: number, code: string) => Object.assign(new Error(code), { httpStatus: status, status, code });

/** How the target invoice's by-id read answers, per case. */
let targetAnswer: (id: string) => Promise<unknown> = async () => null;
const host = {
  find: vi.fn(async () => ({ data: [], total: 0 })),
  findOne: vi.fn(async (resource: string, id: string) => (resource === 'invoice' ? targetAnswer(id) : null)),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};
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

/** Where the router is, read after a click. */
function WhereAmI() {
  const { pathname } = useLocation();
  return <output data-testid="router-pathname">{pathname}</output>;
}

function openServedPage(row: Record<string, unknown>) {
  served = {
    id: REQ, process_name: 'flow:invoice_approval', process_label: 'Invoice Approval', object_name: 'invoice',
    current_step: 'manager_review', current_step_label: 'Manager Review', submitter_id: 'u2',
    updated_at: '2026-10-02T09:00:00Z', viewer: { can_act: false, is_submitter: false, can_override: false },
    pending_approvers: [], ...row,
  };
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/${APP}/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
        <SchemaRendererProvider dataSource={host as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>
              <ApprovalRecordReads>
                <Routes>
                  <Route path="/apps/:appName/:objectName/record/:recordId" element={<GenericRecordRoute />} />
                </Routes>
                <WhereAmI />
              </ApprovalRecordReads>
            </AdapterCtx.Provider>
          </MetadataCtx.Provider>
        </SchemaRendererProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Wait for the page, then for the target card to settle out of `loading`. */
async function settledCard(container: HTMLElement): Promise<HTMLElement> {
  await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  await waitFor(() => {
    const card = container.querySelector('[data-record-preview]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-record-preview')).not.toBe('loading');
  }, { timeout: 8000 });
  return container.querySelector('[data-record-preview]') as HTMLElement;
}

/** The app-scoped record path of the target. */
const recordPath = (id: string) => `/apps/${APP}/invoice/record/${encodeURIComponent(id)}`;

/** Every anchor on the page whose href resolves to `path`, query aside. */
const linksTo = (path: string) =>
  Array.from(document.body.querySelectorAll('a[href]')).filter(
    (a) => new URL(a.getAttribute('href') as string, 'http://test.local').pathname === path,
  );

afterEach(() => {
  cleanup();
  host.findOne.mockClear();
  transport.mockClear();
});

describe('the served request page links a readable target to its record (objectui#12557)', () => {
  it('the served page parses as a spec page', () => {
    expect(PageSchema.safeParse(SERVED_PAGE).success).toBe(true);
  });

  it('readable: one link to the app-scoped record path, named by the card title, inside the card', async () => {
    const id = 'Rd4bl3RecordQQQQ';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({ record_id: id, status: 'pending', record_title: TARGET_TITLE });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('readable');
    const links = linksTo(recordPath(id));
    expect(links).toHaveLength(1);
    expect(card.contains(links[0])).toBe(true);
    expect(screen.getByRole('link', { name: TARGET_TITLE })).toBe(links[0]);
  });

  it('readable: a plain click navigates in-app to the record path', async () => {
    const id = 'Rd4bl3RecordQQQQ';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({ record_id: id, status: 'pending', record_title: TARGET_TITLE });
    await settledCard(container);

    const notPrevented = fireEvent.click(screen.getByRole('link', { name: TARGET_TITLE }), { button: 0 });
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(screen.getByTestId('router-pathname').textContent).toBe(recordPath(id)));
  });

  it('CONTROL: refused (the target read rejects 403) draws no link to the target anywhere', async () => {
    const id = 'R3fus3dRecordQQQ';
    targetAnswer = async () => { throw httpError(403, 'PERMISSION_DENIED'); };
    const { container } = openServedPage({ record_id: id, status: 'pending', record_title: 'INV-2020' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('unreadable');
    expect(card.querySelectorAll('a[href]')).toHaveLength(0);
    expect(linksTo(recordPath(id))).toHaveLength(0);
  });

  it('CONTROL: unresolvable (the target read resolves with no record) draws no link to the target anywhere', async () => {
    const id = 'Un0penRecordQQQQ';
    targetAnswer = async () => null;
    const { container } = openServedPage({ record_id: id, status: 'approved' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('unreadable');
    expect(card.querySelectorAll('a[href]')).toHaveLength(0);
    expect(linksTo(recordPath(id))).toHaveLength(0);
  });

  it('CONTROL: absent (the row names no target object) draws no card and no link, and reads nothing', async () => {
    const id = 'Abs3ntRecordQQQQ';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({ record_id: id, object_name: undefined, status: 'pending' });
    await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
    await screen.findByText('Record ID', undefined, { timeout: 8000 });

    expect(container.querySelector('[data-record-preview]')).toBeNull();
    expect(linksTo(recordPath(id))).toHaveLength(0);
    expect(Array.from(document.body.querySelectorAll('a[href]')).filter((a) => (a.getAttribute('href') ?? '').includes(id))).toHaveLength(0);
    expect(host.findOne.mock.calls.filter(([resource]) => resource === 'invoice')).toHaveLength(0);
  });
});
