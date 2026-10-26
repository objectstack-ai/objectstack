/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12569 — on the page objectstack serves for an approval request,
 * Enter on a lookup link inside the target card opens that record instead of
 * copying the Details row's value.
 *
 * The Details tab draws the request's `record_id` / `object_name` pointer pair
 * through `RecordPreviewCard`, by way of the pointer card renderer, inside the
 * `record:details` grid's "Record ID" row. That row offers copy (the request is
 * not editable on this page), so it is a `role="button"` with its own tab stop,
 * and the card's highlight strip draws the target's lookup value as a link
 * inside it. The row's key handler used to cancel Enter aimed at that link and
 * copy the request's raw `record_id` instead.
 *
 * The page is the REAL `RecordDetailView` on the console's app-scoped record
 * route, reading through `ApprovalRecordReads`, under the root
 * `SchemaRendererProvider` as `ConsoleShell` mounts it. `SERVED_PAGE` is
 * objectstack's `sys_approval_request_detail` as `plugin-approvals` ships it,
 * copied whole. Only the HTTP transport and the console adapter are doubled.
 *
 * The object list handed to the view carries the invoice's and the account's
 * definitions, as the console's metadata catalog does: the record page links
 * only to an object it can route to.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const REQ = 'req_12569';
const TARGET_ID = 'ViHKp_h_qq07iTZ7';
const TARGET_TITLE = 'INV-1010';
const ACCOUNT_ID = 'acc-2';
const ACCOUNT_TITLE = 'ACC-000002 - Globex Industries';

const ACCOUNT_DEF = {
  name: 'account',
  label: 'Account',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Account Name' } },
};
const INVOICE_DEF = {
  name: 'invoice',
  label: 'Invoice',
  nameField: 'name',
  // The card's key fields: the declared list, so the account lookup is drawn.
  highlightFields: ['account_id', 'amount'],
  fields: {
    name: { type: 'text', label: 'Invoice Number' },
    account_id: { type: 'lookup', reference: 'account', label: 'Account' },
    amount: { type: 'currency', label: 'Invoice Amount' },
  },
};
const REQUEST_DEF = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  nameField: 'process_label',
  titleFormat: '{process_name}',
  // As `plugin-approvals` declares it. It is what makes the Details rows
  // read-only here, and a read-only row with a value is a copy row.
  managedBy: 'engine-owned',
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
  account: ACCOUNT_DEF,
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

const SERVED_ROW = {
  id: REQ, process_name: 'flow:invoice_approval', process_label: 'Invoice Approval', object_name: 'invoice',
  record_id: TARGET_ID, current_step: 'manager_review', current_step_label: 'Manager Review', submitter_id: 'u2',
  status: 'pending', record_title: TARGET_TITLE,
  updated_at: '2026-10-02T09:00:00Z', viewer: { can_act: false, is_submitter: false, can_override: false },
  pending_approvers: [],
};
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, SERVED_ROW);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

const host = {
  find: vi.fn(async () => ({ data: [], total: 0 })),
  findOne: vi.fn(async (resource: string, id: string) =>
    resource === 'invoice'
      ? { id, name: TARGET_TITLE, amount: 12500, account_id: { id: ACCOUNT_ID, name: ACCOUNT_TITLE } }
      : null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};
const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF, INVOICE_DEF, ACCOUNT_DEF], dashboards: [], reports: [],
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

/** Where the router is, read after a key press. */
function WhereAmI() {
  const { pathname } = useLocation();
  return <output data-testid="router-pathname">{pathname}</output>;
}

/**
 * Open the served page. `userEvent.setup()` installs its own clipboard stub,
 * so the spy is installed AFTER it.
 */
function openServedPage() {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = render(
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
  return { user, writeText, container: view.container };
}

/** Wait for the target card to draw the readable record and its lookup link. */
async function settledLookupLink(container: HTMLElement): Promise<HTMLElement> {
  await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  await waitFor(() => {
    const card = container.querySelector('[data-record-preview]');
    expect(card?.getAttribute('data-record-preview')).toBe('readable');
  }, { timeout: 8000 });
  const card = container.querySelector('[data-record-preview]') as HTMLElement;
  return within(card).findByRole('link', { name: ACCOUNT_TITLE }, { timeout: 8000 });
}

/** The details grid's "Record ID" row: the element after its label. */
function recordIdRow(): HTMLElement {
  const label = screen.getByText('Record ID');
  return (label.parentElement as HTMLElement).lastElementChild as HTMLElement;
}

const accountPath = `/apps/${APP}/account/record/${ACCOUNT_ID}`;

afterEach(() => {
  cleanup();
  host.findOne.mockClear();
  transport.mockClear();
});

describe('the served request page: Enter on the target card lookup link (objectui#12569)', () => {
  it('the served page parses as a spec page', () => {
    expect(PageSchema.safeParse(SERVED_PAGE).success).toBe(true);
  });

  it('the lookup link is drawn inside the Details grid Record ID row, a copy row', async () => {
    const { container } = openServedPage();
    const link = await settledLookupLink(container);
    const row = recordIdRow();

    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.contains(link)).toBe(true);
    expect(link.closest('[role="button"]')).toBe(row);
  });

  it('Enter on the lookup link opens the account and copies nothing', async () => {
    const { user, writeText, container } = openServedPage();
    const link = await settledLookupLink(container);

    link.focus();
    expect(document.activeElement).toBe(link);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByTestId('router-pathname').textContent).toBe(accountPath));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('CONTROL: Enter on the Record ID row itself still copies the raw record id', async () => {
    const { writeText, container } = openServedPage();
    await settledLookupLink(container);

    const notPrevented = fireEvent.keyDown(recordIdRow(), { key: 'Enter', code: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([TARGET_ID]);
  });
});
