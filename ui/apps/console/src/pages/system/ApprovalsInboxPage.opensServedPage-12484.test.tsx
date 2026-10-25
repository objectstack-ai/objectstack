/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12484 (the closing card ruling C on objectui#12438 directs, item 1)
 * — the approvals inbox opens a request on the page objectstack serves for it,
 * where the side sheet used to open, and the sheet is gone.
 *
 * The open is a navigation to the console's standard record route for
 * `sys_approval_request`, the route PR #12432 routes through
 * `ApprovalRecordReads`. Every way the inbox opens a request lands there: a
 * desktop row, a mobile card, Enter on the focused row, and the notification
 * deep link `?request=<id>`, which takes the deep link's place in history so
 * Back leaves the way the reader came.
 *
 * The harness mounts the REAL inbox page and, on the record route, the REAL
 * `RecordDetailView` under `ApprovalRecordReads`, with `SERVED_PAGE` copied
 * whole from objectstack `plugin-approvals` at objectui's pin and the request
 * definition abridged to the fields that page reads. Only the HTTP transport,
 * the console adapter and the inbox's list read (`approvalsApi.listRequests`)
 * are doubled. The served page's own pins live beside the routed source, in
 * `apps/console/src/services/approvalRequestsDataSource.servedPage*.test.tsx`;
 * this file pins only that the inbox gets the reader there.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

const { approvalsApiStub, ROW, AUTH } = vi.hoisted(() => {
  const ROW = {
    id: 'req_12484',
    process_name: 'flow:invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'invoice',
    object_label: 'Invoice',
    record_id: 'inv_1',
    record_title: 'INV-1010',
    status: 'pending',
    current_step: 'manager_review',
    current_step_label: 'Manager Review',
    step_label: 'Manager Review',
    pending_approvers: ['u1'],
    submitter_id: 'u2',
    submitter_name: 'Sam Submitter',
    submitted_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-20T09:00:00.000Z',
  };
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: [ROW], total: 1 })),
    // The sheet's two reads. Nothing in the inbox makes them any more.
    getRequest: vi.fn(async () => ({ data: ROW })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: ROW, finalized: true })),
    reject: vi.fn(async () => ({ data: ROW, finalized: true })),
  };
  // A STABLE singleton: a fresh user per render re-runs the inbox's load
  // effect forever, and the queue never leaves its skeleton.
  const AUTH = { user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null };
  return { approvalsApiStub, ROW, AUTH };
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
vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import { APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from '../../services/approvalRequestsDataSource';
import { ApprovalRecordReads } from '../../AppContent';
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

const APP = 'probe_app';
const REQ = ROW.id;
const INBOX = `/apps/${APP}/system/approvals`;
/** The served page's route: the console's standard record route for a request. */
const REQUEST_PAGE = `/apps/${APP}/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`;

/** objectstack `plugin-approvals`' `sys_approval_request`, abridged to what the page reads. */
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
      options: Object.entries(APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
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
const INVOICE_DEF = {
  name: 'invoice',
  label: 'Invoice',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Invoice Number' } },
};
const DEFS: Record<string, unknown> = {
  [APPROVAL_REQUEST_OBJECT]: REQUEST_DEF,
  [APPROVAL_ACTION_OBJECT]: ACTION_DEF,
  sys_user: USER_DEF,
  invoice: INVOICE_DEF,
};

/** objectstack `plugin-approvals`' `SysApprovalRequestDetailPage` at objectui's pin, whole. */
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

/** The approvals get, as the served page reads it through `ApprovalRecordReads`. */
const SERVED = { ...ROW, viewer: { can_act: false, is_submitter: false, can_override: false } };
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, SERVED);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

const host = {
  find: vi.fn(async () => ({ data: [], total: 0 })),
  findOne: vi.fn(async () => null),
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

function renderAt(entries: string[]) {
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <SchemaRendererProvider dataSource={host as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>
              <ApprovalRecordReads>
                <RouterProbe />
                <Routes>
                  <Route path="/apps/:appName/home" element={<div>home</div>} />
                  <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
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

/** The inbox's desktop row for the request (the mobile card renders no table row). */
async function inboxRow(): Promise<HTMLElement> {
  await screen.findAllByText(ROW.record_title, undefined, { timeout: 8000 });
  const row =screen.getAllByRole('row').find((r) => within(r).queryAllByText(ROW.record_title).length > 0);
  if (!row) throw new Error('no inbox row for the request');
  return row;
}

/** The served page has drawn: its decision panel and its H1. */
async function servedPage(): Promise<void> {
  await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  expect((await screen.findByRole('heading', { level: 1 }, { timeout: 8000 })).textContent).toBe(ROW.process_label);
}

/** The served get was read; the sheet's own reads were not, and no sheet (a dialog) is mounted. */
function openedOnTheServedPageOnly(): void {
  const reads = transport.mock.calls.map(([input]) => new URL(String(input), 'http://test.local').pathname);
  expect(reads).toContain(`/api/v1/approvals/requests/${REQ}`);
  expect(approvalsApiStub.getRequest).not.toHaveBeenCalled();
  expect(approvalsApiStub.listActions).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
}

beforeEach(() => {
  transport.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('the approvals inbox opens a request on its served page (objectui#12484)', () => {
  it('a row click lands on the request record route, where the served page draws, and no sheet mounts', async () => {
    renderAt([INBOX]);
    fireEvent.click(await inboxRow());

    await servedPage();
    expect(where()).toBe(REQUEST_PAGE);
    openedOnTheServedPageOnly();
  });

  it('Enter on the focused row opens the same page', async () => {
    renderAt([INBOX]);
    await inboxRow();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });

    await servedPage();
    expect(where()).toBe(REQUEST_PAGE);
    openedOnTheServedPageOnly();
  });

  it('the mobile card opens the same page', async () => {
    renderAt([INBOX]);
    await inboxRow();
    const cardTitle = screen.getAllByText(ROW.record_title).find((el) => !el.closest('tr'));
    const card = cardTitle?.closest('.cursor-pointer');
    if (!card) throw new Error('no mobile card for the request');
    fireEvent.click(card);

    await servedPage();
    expect(where()).toBe(REQUEST_PAGE);
    openedOnTheServedPageOnly();
  });

  it('the notification deep link lands on the served page in its own place, without reading the queue', async () => {
    renderAt([`/apps/${APP}/home`, `${INBOX}?request=${REQ}`]);

    await servedPage();
    expect(where()).toBe(REQUEST_PAGE);
    openedOnTheServedPageOnly();
    expect(approvalsApiStub.listRequests).not.toHaveBeenCalled();

    // The deep link was replaced, not stacked under the page: Back leaves to
    // where the reader came from, and does not bounce off the deep link again.
    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }));
    expect(where()).toBe(`/apps/${APP}/home`);
  });

  it('CONTROL: the queue itself still renders on the inbox route, with no request open', async () => {
    renderAt([INBOX]);
    await inboxRow();
    expect(where()).toBe(INBOX);
    expect(screen.queryByTestId('approval-decision-panel')).toBeNull();
    expect(approvalsApiStub.listRequests).toHaveBeenCalled();
  });
});
