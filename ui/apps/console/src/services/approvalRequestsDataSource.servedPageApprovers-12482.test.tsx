/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12482 (face 1 of ruling C on objectui#12438; folds objectui#12077):
 * the page objectstack serves for an approval request names each pending
 * approver, with a position's label and the countersign group the slot fills,
 * as the approvals inbox's request sheet names them.
 *
 * Mounted as objectui#12077's measurement mounted it: the REAL
 * `RecordDetailView`, opened by the generic record route under the console's
 * `ApprovalRecordReads`, so the request is read from the approvals get route
 * exactly as the shipped code reads it. `SERVED_PAGE` is objectstack
 * `plugin-approvals`' `sys_approval_request_detail` as it ships (copied whole,
 * as `approvalRequestsDataSource.servedPage.test.tsx` copies it); the object
 * definition is abridged to the fields that page reads, plus
 * `pending_approvers` as the object declares it (a `textarea` in the `State`
 * group). Only the HTTP transport, the console adapter and the metadata store
 * are doubled.
 *
 * The names come from the row the get serves (`pending_approver_names`,
 * `pending_approver_groups`) and, for a `position:` slot the server left
 * unnamed, from the `position` registry the metadata store lists and the
 * seat's holders the adapter reads. The face the sheet asserted is the
 * reference: two people sharing a name in two groups stay two labelled chips
 * (`ApprovalsInboxPage.characterizationPins.test.tsx`), and a position reads its
 * registry label, never `positi…ager` (`ApprovalsInboxPage.approverHeadline-12110.test.tsx`).
 * Both sheet pins retired with the sheet (objectui#12484), against this file
 * and the decision panel's own pins.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
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

const REQ = 'req_12482';

/** A user id of the length the auth service mints, which the sheet middle-truncates. */
const ADA = 'usr_qFpo8Zk2LmN4pR7t';

/** The request as the approvals get serves it; each case overrides the slate. */
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
};

/** The countersign case: the sheet's characterization fixture, plus a position slot. */
const COUNTERSIGN_ROW = {
  ...BASE_ROW,
  pending_approvers: ['u_fin', 'u_leg', 'position:sales_manager'],
  pending_approver_names: { u_fin: 'Dev Admin', u_leg: 'Dev Admin' },
  pending_approver_groups: { u_fin: ['Finance'], u_leg: ['Legal'], 'position:sales_manager': ['Legal'] },
  decision_progress: {
    behavior: 'per_group',
    got: 0,
    need: 2,
    groups: [
      { group: 'Finance', got: 0, need: 1, satisfied: false },
      { group: 'Legal', got: 0, need: 1, satisfied: false },
    ],
  },
};

/** objectui#12077's case: one approver holding three quorum slots. */
const QUORUM_ROW = {
  ...BASE_ROW,
  pending_approvers: [ADA, ADA, ADA],
  pending_approver_names: { [ADA]: 'Ada Lovelace' },
  decision_progress: { behavior: 'quorum', got: 0, need: 2 },
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

/** The `position` registry, as `GET /api/v1/meta/position` serves it. */
const POSITIONS = [{ name: 'sales_manager', label: 'Regional Sales Manager' }];

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

/** The console adapter: the directory reads a position slot needs, and nothing else answered. */
const host = {
  find: vi.fn(async (resource: string, _params?: unknown) => {
    if (resource === 'sys_user_position') return { data: [{ position: 'sales_manager', user_id: 'u_7' }], total: 1 };
    if (resource === 'sys_user') return { data: [{ id: 'u_7', full_name: 'Grace Hopper' }], total: 1 };
    return { data: [], total: 0 };
  }),
  findOne: vi.fn(async (_resource: string, _id: string) => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};

const ensureType = vi.fn(async (type: string) => (type === 'position' ? POSITIONS : []));
const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF], dashboards: [], reports: [],
  pages: [SERVED_PAGE], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType,
  getItem: vi.fn(async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null)),
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** `DefaultAppContent`'s generic record route: the view over `useAdapter()`. */
function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

async function openServedPage(row: Record<string, unknown>): Promise<HTMLElement> {
  served = row;
  render(
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
  const panel = await screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
  await within(panel).findByTestId('declared-action-approval_approve', undefined, { timeout: 8000 });
  return panel;
}

const chips = (panel: HTMLElement) => within(panel).queryAllByTestId('approver-chip');
const pageText = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  served = BASE_ROW;
  host.find.mockClear();
  ensureType.mockClear();
});

describe('the served request page names who the pending step waits on (objectui#12482)', () => {
  it('the served page parses as a spec page, with no node or prop added for the names', () => {
    const parsed = PageSchema.safeParse(SERVED_PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(SERVED_PAGE.slots.actions).toEqual([{ type: 'record:approval_decision' }]);
  });

  it('names each pending approver, with the countersign group it fills and a position by its registry label', async () => {
    const panel = await openServedPage(COUNTERSIGN_ROW);
    const row = within(panel).getByTestId('approval-decision-pending-approvers');
    expect(row.textContent).toContain('Waiting on');

    // The sheet's characterization case: two people sharing one name, in two
    // groups, are two labelled chips, not one chip with a count.
    expect(within(panel).getByTitle('u_fin').textContent).toBe('Dev Admin· Finance');
    expect(within(panel).getByTitle('u_leg').textContent).toBe('Dev Admin· Legal');

    // The sheet's objectui#12110 case: a position reads its registry label.
    // Re-queried each time: the chip is keyed by its label, so it is a new
    // element once the label resolves.
    await waitFor(
      () =>
        expect(within(panel).getByTitle('position:sales_manager').textContent).toBe(
          'Regional Sales Manager· Grace Hopper· Legal',
        ),
      { timeout: 8000 },
    );
    expect(chips(panel)).toHaveLength(3);
  });

  it('no pending approver id is shown anywhere on the page, only on hover', async () => {
    const panel = await openServedPage(COUNTERSIGN_ROW);
    await waitFor(
      () => expect(within(panel).getByTitle('position:sales_manager').textContent).toContain('Regional Sales Manager'),
      { timeout: 8000 },
    );
    for (const raw of ['u_fin', 'u_leg', 'position:', 'positi…']) {
      expect(pageText(), `${raw} is not printed`).not.toContain(raw);
    }
  });

  it("objectui#12077's case: one approver in three quorum slots is named once, with a count, and the id is printed nowhere", async () => {
    const panel = await openServedPage(QUORUM_ROW);
    expect(chips(panel).map((chip) => chip.textContent)).toEqual(['Ada Lovelace×3']);
    expect(pageText()).not.toContain('qFpo');
    expect(pageText().match(/Ada Lovelace/g) ?? []).toHaveLength(1);
  });

  it('a slate the approvals get named whole costs no directory read', async () => {
    await openServedPage(QUORUM_ROW);
    expect(ensureType).not.toHaveBeenCalledWith('position');
    const directoryReads = host.find.mock.calls.filter(([resource]) =>
      ['sys_user_position', 'sys_team', 'sys_business_unit'].includes(String(resource)),
    );
    expect(directoryReads).toEqual([]);
  });

  it('CONTROL: a request with no pending approvers draws no "Waiting on" row, and still its tally and decisions', async () => {
    const panel = await openServedPage({ ...QUORUM_ROW, pending_approvers: [], pending_approver_names: {} });
    expect(within(panel).queryByTestId('approval-decision-pending-approvers')).toBeNull();
    expect(chips(panel)).toHaveLength(0);
    expect(within(panel).getByRole('progressbar')).toBeTruthy();
    expect(within(panel).getByTestId('declared-action-approval_reject')).toBeTruthy();
  });

  it('CONTROL: an approver id nothing can name is drawn as the inbox sheet draws it, middle-truncated, whole only on hover', async () => {
    const unnamed = 'zzUnresolvedIdXyz123';
    const panel = await openServedPage({ ...QUORUM_ROW, pending_approvers: [unnamed], pending_approver_names: {} });
    expect(within(panel).getByTitle(unnamed).textContent).toBe('zzUnre…z123');
    expect(pageText()).not.toContain(unnamed);
  });
});
