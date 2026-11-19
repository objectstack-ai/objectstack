/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34586 — the approvals queue, request to request.
 *
 * From 「待我审批」 a request opens with the queue as the list shows it
 * (filtered and sorted); the request page's top bar draws the counter and
 * ↓ ↑ over it, and the 「处理后打开下一条」 switch (default on). A decision that
 * takes the request out of the reader's queue opens the next one; with none
 * left the page goes back to the list. A request opened without the list (a
 * notification, a direct link) draws neither the counter nor the switch.
 *
 * The harness mounts the REAL inbox page and, on the record route, the REAL
 * `RecordDetailView` under `ApprovalRecordReads`, with the served request page
 * abridged to its decision panel and header, as
 * `ApprovalsInboxPage.opensServedPage-12484.test.tsx` mounts them. Only the
 * HTTP transport, the console adapter and the inbox's list read are doubled.
 * A decision is the panel's own after-decision step: the served row changes
 * and the request is announced changed on the data bus (`notifyDataChanged`),
 * which is what `ApprovalDecisionPanel` does once a declared action succeeds;
 * the advance logic itself is pinned beside its module
 * (`approvalQueueAdvance-34586.test.tsx`).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { approvalsApiStub, ROWS, AUTH, toastStub } = vi.hoisted(() => {
  const base = {
    process_name: 'flow:invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'invoice',
    object_label: 'Invoice',
    status: 'pending',
    current_step: 'manager_review',
    step_label: 'Manager Review',
    pending_approvers: ['u1'],
    submitter_id: 'u2',
    submitter_name: 'Sam Submitter',
  };
  // Newest first is the inbox's default order: req_a, req_b, req_c.
  const ROWS = [
    { ...base, id: 'req_a', record_id: 'inv_a', record_title: 'Alpha one', submitted_at: '2026-10-22T09:00:00.000Z' },
    { ...base, id: 'req_b', record_id: 'inv_b', record_title: 'Beta two', submitted_at: '2026-10-21T09:00:00.000Z' },
    { ...base, id: 'req_c', record_id: 'inv_c', record_title: 'Alpha three', submitted_at: '2026-10-20T09:00:00.000Z' },
  ];
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
    getRequest: vi.fn(async () => ({ data: ROWS[0] })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: ROWS[0], finalized: true })),
    reject: vi.fn(async () => ({ data: ROWS[0], finalized: true })),
  };
  const AUTH = { user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null };
  const toastStub = Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  });
  return { approvalsApiStub, ROWS, AUTH, toastStub };
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
vi.mock('sonner', () => ({ toast: toastStub }));
vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, notifyDataChanged, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import { APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from '../../services/approvalRequestsDataSource';
import { ApprovalRecordReads } from '../../AppContent';
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

const APP = 'probe_app';
const INBOX = `/apps/${APP}/system/approvals`;
const pageOf = (id: string) => `/apps/${APP}/${APPROVAL_REQUEST_OBJECT}/record/${id}`;

const REQUEST_DEF = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  nameField: 'process_label',
  fields: {
    id: { label: 'Request ID', type: 'text', readonly: true },
    process_label: { label: 'Flow', type: 'text', readonly: true },
    object_name: { label: 'Object', type: 'text' },
    record_id: { label: 'Record ID', type: 'text', referenceVia: 'object_name' },
    status: {
      label: 'Status', type: 'select',
      options: Object.entries(APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
  },
  actions: [],
  enable: { apiMethods: ['get', 'list'] },
};
const ACTION_DEF = {
  name: APPROVAL_ACTION_OBJECT,
  label: 'Approval Action',
  pluralLabel: 'Approval Actions',
  fields: { id: { label: 'Action ID', type: 'text' }, request_id: { label: 'Request', type: 'lookup', reference: APPROVAL_REQUEST_OBJECT } },
  enable: { apiMethods: ['get', 'list'] },
};
const INVOICE_DEF = { name: 'invoice', label: 'Invoice', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } };
const DEFS: Record<string, unknown> = { [APPROVAL_REQUEST_OBJECT]: REQUEST_DEF, [APPROVAL_ACTION_OBJECT]: ACTION_DEF, invoice: INVOICE_DEF };

/** objectstack's served request page, abridged to the header and the decision panel. */
const SERVED_PAGE = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: APPROVAL_REQUEST_OBJECT,
  template: 'default',
  kind: 'full',
  isDefault: true,
  regions: [{ name: 'main', width: 'full', components: [{ type: 'page:header' }, { type: 'record:approval_decision' }] }],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The approvals get per request, as `ApprovalRecordReads` reads it. A decision rewrites one. */
let served: Record<string, Record<string, unknown>> = {};
function resetServed() {
  served = Object.fromEntries(
    ROWS.map((r) => [r.id, { ...r, viewer: { can_act: true, is_submitter: false, can_override: false } }]),
  );
}
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const m = /^\/api\/v1\/approvals\/requests\/([^/]+)(\/actions)?$/.exec(url.pathname);
  if (method === 'GET' && m && served[m[1]]) return m[2] ? json(200, { data: [] }) : json(200, served[m[1]]);
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
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, INVOICE_DEF], dashboards: [], reports: [],
  pages: [SERVED_PAGE], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem: vi.fn(async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null)),
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};
const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

function RouterProbe() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
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

/** The inbox's desktop row whose record title is `title`. */
async function inboxRow(title: string): Promise<HTMLElement> {
  await screen.findAllByText(title, undefined, { timeout: 8000 });
  const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText(title).length > 0);
  if (!row) throw new Error(`no inbox row for ${title}`);
  return row;
}

/** The request page has drawn its decision panel. */
async function requestPage(): Promise<void> {
  await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
}

/** The top bar's counter, by its accessible name (「第 N 条，共 M 条」 in zh-CN). */
const counter = () => document.querySelector('[data-record-top-bar-position]');

/** What `ApprovalDecisionPanel` does after a declared decision succeeds, with the server's new row. */
async function decide(id: string, next: Record<string, unknown>) {
  served[id] = { ...served[id], ...next };
  await act(async () => {
    notifyDataChanged({ objectName: APPROVAL_REQUEST_OBJECT, recordId: id });
  });
}

beforeEach(() => {
  transport.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  toastStub.success.mockClear();
  resetServed();
  try { window.localStorage.clear(); } catch { /* no storage */ }
});
afterEach(cleanup);

describe('the approvals queue steps from request to request (objectstack#34586)', () => {
  it('acceptance 1: the first of three pending opens as 1 of 3, and ↓ opens the second', async () => {
    renderAt([INBOX]);
    fireEvent.click(await inboxRow('Alpha one'));
    await requestPage();
    expect(where()).toBe(pageOf('req_a'));

    await waitFor(() => expect(counter()).not.toBeNull());
    expect(counter()).toHaveAttribute('aria-label', '1 of 3 in Approvals Inbox');
    expect(screen.getByTestId('approval-queue-open-next')).toBeInTheDocument();
    // The crumb leads back to the inbox, by its name.
    expect(document.querySelector('[data-record-crumb-object]')).toHaveTextContent('Approvals Inbox');

    fireEvent.click(document.querySelector('[data-record-top-bar-step="next"]') as HTMLElement);
    await waitFor(() => expect(where()).toBe(pageOf('req_b')));
    await waitFor(() => expect(counter()).toHaveAttribute('aria-label', '2 of 3 in Approvals Inbox'));
  });

  it('the set is the queue as the list shows it: a search narrows it', async () => {
    renderAt([INBOX]);
    await inboxRow('Alpha one');
    fireEvent.change(screen.getByPlaceholderText('Search record, process, requester…'), { target: { value: 'alpha' } });
    await waitFor(() => expect(screen.queryAllByText('Beta two')).toHaveLength(0));
    fireEvent.click(await inboxRow('Alpha three'));
    await requestPage();
    await waitFor(() => expect(counter()).toHaveAttribute('aria-label', '2 of 2 in Approvals Inbox'));
  });

  it('acceptance 2: approving the first lands on the second, and the last back on the list', async () => {
    renderAt([INBOX]);
    fireEvent.click(await inboxRow('Alpha one'));
    await requestPage();
    await waitFor(() => expect(counter()).not.toBeNull());

    await decide('req_a', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(pageOf('req_b')));
    // The decided request left the set: the second is now the first of two.
    await waitFor(() => expect(counter()).toHaveAttribute('aria-label', '1 of 2 in Approvals Inbox'));

    await requestPage();
    await decide('req_b', { status: 'rejected', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(pageOf('req_c')));
    await requestPage();
    await waitFor(() => expect(counter()).toHaveAttribute('aria-label', '1 of 1 in Approvals Inbox'));

    await decide('req_c', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(INBOX));
    expect(toastStub.success).toHaveBeenCalledWith('No more pending requests in this list.');
  });

  it('acceptance 3: with the switch off, the page stays on the decided request', async () => {
    renderAt([INBOX]);
    fireEvent.click(await inboxRow('Alpha one'));
    await requestPage();
    const toggle = within(await screen.findByTestId('approval-queue-open-next')).getByRole('checkbox');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await decide('req_a', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    // Give the page its re-read; it must not move.
    await waitFor(() => expect(transport.mock.calls.filter(([i]) => String(i).includes('/requests/req_a')).length).toBeGreaterThan(1));
    expect(where()).toBe(pageOf('req_a'));
  });

  it('acceptance 4: a request opened without the list draws no counter and no switch, and a decision moves nothing', async () => {
    renderAt([pageOf('req_b')]);
    await requestPage();
    expect(counter()).toBeNull();
    expect(screen.queryByTestId('approval-queue-open-next')).toBeNull();

    await decide('req_b', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(transport.mock.calls.filter(([i]) => String(i).includes('/requests/req_b')).length).toBeGreaterThan(1));
    expect(where()).toBe(pageOf('req_b'));
  });

  it('CONTROL: a request opened from another tab carries no queue', async () => {
    renderAt([INBOX]);
    await inboxRow('Alpha one');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^All/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }));
    fireEvent.click(await inboxRow('Alpha one'));
    await requestPage();
    expect(counter()).toBeNull();
    expect(screen.queryByTestId('approval-queue-open-next')).toBeNull();
  });
});

describe('the queue stays in the app its inbox is mounted in (objectstack#35412)', () => {
  /** The inbox's app lists another object; another app owns the requests' records; Setup is there too. */
  const apps = [
    { name: APP, navigation: [{ type: 'object', objectName: 'leave_request' }] },
    { name: 'finance', _packageId: 'com.example.finance', navigation: [{ type: 'object', objectName: 'invoice' }] },
    { name: 'setup', _packageId: 'com.objectstack.setup', navigation: [{ type: 'object', objectName: 'sys_user' }] },
  ];
  beforeEach(() => {
    (metadata as { apps: unknown[] }).apps = apps;
  });
  afterEach(() => {
    (metadata as { apps: unknown[] }).apps = [];
  });

  it('a row opens under the inbox\'s app, and each decision opens the next one there, then returns to the inbox', async () => {
    renderAt([INBOX]);
    fireEvent.click(await inboxRow('Alpha one'));
    await requestPage();
    expect(where()).toBe(pageOf('req_a'));
    await waitFor(() => expect(counter()).not.toBeNull());

    await decide('req_a', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(pageOf('req_b')));
    await requestPage();
    await decide('req_b', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(pageOf('req_c')));
    await requestPage();
    await decide('req_c', { status: 'approved', viewer: { can_act: false, is_submitter: false, can_override: false } });
    await waitFor(() => expect(where()).toBe(INBOX));
  });
});
