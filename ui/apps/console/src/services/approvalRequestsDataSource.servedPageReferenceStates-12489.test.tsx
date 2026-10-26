/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12489 — on the page objectstack serves for an approval request, the
 * target reference draws the four states the inbox side sheet drew: a link
 * when the approver may read the record, no link when the read is refused, the
 * tombstone when the platform deleted the record, and a cause-free text when
 * the reference cannot be resolved.
 *
 * The sheet's pins were the reference: `ApprovalsInboxPage.recordLink.test.tsx`,
 * `ApprovalsInboxPage.recordLinkRefused-11878.test.tsx`,
 * `ApprovalsInboxPage.tombstone.test.tsx` and
 * `ApprovalsInboxPage.unresolvableReference.test.tsx`, all under
 * `apps/console/src/pages/system/`. objectui#12484 deleted the sheet; their
 * queue cases stay there, and their drawer cases ("not one click deeper")
 * retired against this file. Two of those drawer cases read the bare record id
 * nowhere in the drawer, so the cases below for the same states read it
 * nowhere on the page, the H1 included.
 *
 * The tombstone is the declaration ruling A of objectui#12489 put on the field
 * that owns the pointer pair: `record_id` declares
 * `referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' }`
 * beside `referenceVia` (`@objectstack/spec` `FieldSchema`; the services half
 * is objectstack-ai/objectstack#23736). The request definition below carries
 * that declaration and the `cancel_reason` options with the contract's own
 * labels (`APPROVAL_CANCEL_REASON_LABELS`), the text the sheet's tombstone
 * pin reads. The tombstone reads nothing and links nothing, so the target
 * invoice's by-id read is counted on the adapter's `findOne`.
 *
 * The harness is `approvalRequestsDataSource.servedPageRecordLink-12557.test.tsx`'s:
 * the REAL `RecordDetailView` on the console's app-scoped record route, reading
 * through `ApprovalRecordReads`, under the root `SchemaRendererProvider` as
 * `ConsoleShell` mounts it, with `SERVED_PAGE` copied whole from objectstack's
 * `plugin-approvals`. Only the HTTP transport and the console adapter are
 * doubled.
 *
 * The page H1 is the request's title. The request definition below follows
 * objectstack's: `nameField` is `process_label`, the flow's label the approvals
 * get serves (objectstack-ai/objectstack#24665), so the H1 names the flow and
 * never the subject record's id or the machine source `flow:NAME`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_CANCEL_REASON_LABELS, APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const APP = 'probe_app';
const REQ = 'req_12489';
const TARGET_TITLE = 'INV-1010';
/** The machine source the approvals get serves as `process_name`, and the flow's label. */
const FLOW_SOURCE = 'flow:invoice_approval';
const FLOW_LABEL = 'Invoice Approval';

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
    record_id: {
      label: 'Record ID', type: 'text', referenceVia: 'object_name', group: 'Target',
      referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' },
    },
    submitter_id: { label: 'Submitter', type: 'lookup', reference: 'sys_user', group: 'Target' },
    status: {
      label: 'Status', type: 'select', group: 'State',
      options: Object.entries(APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
    cancel_reason: {
      label: 'Cancel Reason', type: 'select', group: 'State',
      options: Object.entries(APPROVAL_CANCEL_REASON_LABELS).map(([value, label]) => ({ value, label })),
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
/** A console whose loaded bundle localizes the platform's option label, as `/api/v1/i18n` serves it. */
const ZH: I18nConfig = {
  defaultLanguage: 'zh-CN',
  detectBrowserLanguage: false,
  resources: {
    'zh-CN': {
      platform: {
        objects: {},
        fieldOptions: { [APPROVAL_REQUEST_OBJECT]: { cancel_reason: { record_deleted: '关联记录已删除' } } },
      },
    },
  },
};

/** `DefaultAppContent`'s generic record route: the view over `useAdapter()`. */
function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

function openServedPage(row: Record<string, unknown>, i18n: I18nConfig = EN) {
  served = {
    id: REQ, process_name: FLOW_SOURCE, process_label: FLOW_LABEL, object_name: 'invoice',
    current_step: 'manager_review', current_step_label: 'Manager Review', submitter_id: 'u1',
    updated_at: '2026-10-02T09:00:00Z', viewer: { can_act: false, is_submitter: false, can_override: false },
    pending_approvers: [], ...row,
  };
  return render(
    <I18nProvider config={i18n} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/${APP}/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
        <SchemaRendererProvider dataSource={host as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>
              <ApprovalRecordReads>
                <Routes>
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

/** The page H1, the request's title. */
const pageTitle = () => screen.findByRole('heading', { level: 1 }, { timeout: 8000 });

/** The Details tab the reference sits in. */
const detailsTab = (el: Element) => el.closest('[role="tabpanel"]') as HTMLElement | null;

/** Invoice by-id reads the page made. */
const targetReads = () => host.findOne.mock.calls.filter(([resource]) => resource === 'invoice');

const DELETED = APPROVAL_CANCEL_REASON_LABELS.record_deleted;
const UNRESOLVABLE = 'This record cannot be opened';

afterEach(() => {
  cleanup();
  host.findOne.mockClear();
  transport.mockClear();
});

describe('the served request page draws the four reference states the sheet draws (objectui#12489)', () => {
  it('the served page parses as a spec page', () => {
    expect(PageSchema.safeParse(SERVED_PAGE).success).toBe(true);
  });

  it('readable (sheet: recordLink): one link to the record path, inside the card, named by its title', async () => {
    const id = 'Rd4bl3Rec12489QQ';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({ record_id: id, status: 'pending', record_title: TARGET_TITLE });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('readable');
    const links = linksTo(recordPath(id));
    expect(links).toHaveLength(1);
    expect(card.contains(links[0])).toBe(true);
    expect(links[0].textContent).toContain(TARGET_TITLE);
    expect(container.querySelector('[data-record-pointer="deleted"]')).toBeNull();
    // The H1 names the flow by its label: not the subject's id, not `flow:NAME`.
    const h1 = await pageTitle();
    expect(h1.textContent).toBe(FLOW_LABEL);
    expect(h1.textContent).not.toContain(id);
    expect(h1.textContent).not.toContain(FLOW_SOURCE);
  });

  it('refused (sheet: recordLinkRefused-11878): the target read rejects 403, and no link to it anywhere', async () => {
    const id = 'R3fus3dRec12489Q';
    targetAnswer = async () => { throw httpError(403, 'PERMISSION_DENIED'); };
    const { container } = openServedPage({ record_id: id, status: 'pending', record_title: 'INV-2020' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('unreadable');
    expect(card.querySelectorAll('a[href]')).toHaveLength(0);
    expect(linksTo(recordPath(id))).toHaveLength(0);
    expect(container.textContent).not.toContain(DELETED);
  });

  it('deleted (sheet: tombstone): the platform-asserted deletion draws the option label, reads nothing, links nothing', async () => {
    const id = 'D3l3t3dRec12489Q';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({
      record_id: id, status: 'cancelled', cancel_reason: 'record_deleted', record_title: 'INV-3030',
    });
    await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
    const tombstone = await waitFor(() => {
      const found = container.querySelector('[data-record-pointer="deleted"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    }, { timeout: 8000 });

    expect(tombstone.textContent).toBe(DELETED);
    expect(container.querySelector('[data-record-preview]')).toBeNull();
    expect(targetReads()).toHaveLength(0);
    expect(linksTo(recordPath(id))).toHaveLength(0);
    expect(tombstone.querySelectorAll('a[href]')).toHaveLength(0);
    // The bare id never shows at the reference: not in the tombstone, not in the Details tab.
    expect(tombstone.innerHTML).not.toContain(id);
    const tab = detailsTab(tombstone);
    expect(tab).not.toBeNull();
    expect(tab?.textContent).not.toContain(id);
    // …and nowhere on the page, the H1 included: the counterpart of the sheet's
    // drawer case "tombstones the same reference in the drawer — not one click
    // deeper" (`ApprovalsInboxPage.tombstone.test.tsx`, objectui#7108).
    expect((await pageTitle()).textContent).toBe(FLOW_LABEL);
    expect(document.body.innerHTML).not.toContain(id);
  });

  it("deleted, in a console whose bundle localizes the option: the tombstone is the option's localized label", async () => {
    const id = 'D3l3t3dRec12489Z';
    const { container } = openServedPage({ record_id: id, status: 'cancelled', cancel_reason: 'record_deleted' }, ZH);
    await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
    await waitFor(() => {
      expect(container.querySelector('[data-record-pointer="deleted"]')?.textContent).toBe('关联记录已删除');
    }, { timeout: 8000 });
    expect(targetReads()).toHaveLength(0);
  });

  it('unresolvable (sheet: unresolvableReference): the cause-free text, no link, no id in the card', async () => {
    const id = 'Un0penRec12489QQ';
    targetAnswer = async () => null;
    const { container } = openServedPage({ record_id: id, status: 'approved' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('unreadable');
    expect(card.textContent).toBe(UNRESOLVABLE);
    expect(card.querySelectorAll('a[href]')).toHaveLength(0);
    expect(linksTo(recordPath(id))).toHaveLength(0);
    expect(card.innerHTML).not.toContain(id);
    expect(container.textContent).not.toContain(DELETED);
    // No id anywhere on the page, the H1 included: the counterpart of the
    // sheet's drawer case "renders the same affordance in the drawer — not one
    // click deeper" (`ApprovalsInboxPage.unresolvableReference.test.tsx`,
    // objectui#8631).
    expect((await pageTitle()).textContent).toBe(FLOW_LABEL);
    expect(document.body.innerHTML).not.toContain(id);
  });

  it('CONTROL: a cancelled row with no cancel_reason is not a deletion: the card reads the target', async () => {
    const id = 'Canc3ll3dRec1248';
    targetAnswer = async (rid) => ({ id: rid, name: TARGET_TITLE, amount: 12500 });
    const { container } = openServedPage({ record_id: id, status: 'cancelled' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('readable');
    expect(container.querySelector('[data-record-pointer="deleted"]')).toBeNull();
    expect(targetReads().map(([, rid]) => rid)).toContain(id);
  });

  it('CONTROL: an unreadable target the platform did not flag gets no tombstone (a failed read is not a deletion)', async () => {
    const id = 'N0tFl4ggedRec124';
    targetAnswer = async () => { throw httpError(404, 'RECORD_NOT_FOUND'); };
    const { container } = openServedPage({ record_id: id, status: 'cancelled' });
    const card = await settledCard(container);

    expect(card.getAttribute('data-record-preview')).toBe('unreadable');
    expect(container.querySelector('[data-record-pointer="deleted"]')).toBeNull();
    expect(container.textContent).not.toContain(DELETED);
  });
});
