/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12491 (face 5 of ruling C on objectui#12438, the seat's Q1 A, Q2 A
 * and Q3 A): on the page objectstack serves for an approval request, a
 * multi-step request shows its vertical step line, and a request no person
 * submitted shows its flow origin, as the approvals inbox's request sheet
 * shows both.
 *
 * Mounted as the other served-page pins mount it: the REAL `RecordDetailView`,
 * opened by the generic record route under the console's `ApprovalRecordReads`,
 * so the request is read from the approvals get route exactly as the shipped
 * code reads it. `SERVED_PAGE` is objectstack `plugin-approvals`'
 * `sys_approval_request_detail` as it ships (copied whole); the object
 * definition is abridged to the fields that page reads. Only the HTTP
 * transport, the console adapter and the metadata store are doubled.
 *
 * The row is shaped as the approvals get serves it: `flow_steps` attached on
 * the single read, and a request opened by a flow run with no user context
 * served with NO `submitter_id` key (the column is null, ADR-0118 D1, and the
 * get serves a null as an absent key). The sheet's own characterization pin
 * drives its marker with a `flow:` sentinel id instead; that shape is not the
 * contract's, so it is not asserted here.
 *
 * Copy is asserted as the pack rows the panel reads (`approvalsInbox.stepProgress`
 * names the line, `approvalsInbox.flowOrigin` is the marker), never as English.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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
import { builtInLocales } from '@object-ui/i18n/locales';
import { RecordDetailView } from '@object-ui/app-shell';
import { PageSchema } from '@objectstack/spec/ui';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT } from './approvalRequestsDataSource';
import { ApprovalRecordReads } from '../AppContent';

const REQ = 'req_12491';

/** The `en` pack's `approvalsInbox` rows the panel reads. */
const PACK = (builtInLocales as unknown as { en: { approvalsInbox: { stepProgress: string; flowOrigin: string } } })
  .en.approvalsInbox;

/** The owning flow's approval trunk, as `attachFlowSteps` serves it on the single read. */
const FLOW_STEPS = [
  { id: 'manager_review', label: 'Manager review', state: 'done' },
  { id: 'finance_review', label: 'Finance review', state: 'current' },
  { id: 'director_signoff', label: 'Director sign-off', state: 'upcoming' },
  { id: 'cfo_signoff', label: 'CFO sign-off', state: 'upcoming' },
];

/**
 * A pending `first_response` node (no tally) of a flow opened with no user
 * context: no `submitter_id` key, as the approvals get serves a null column.
 */
const FLOW_ROW: Record<string, unknown> = {
  id: REQ,
  process_name: 'flow:budget_escalation',
  process_label: 'Budget Escalation',
  object_name: 'invoice',
  record_id: 'inv_1',
  status: 'pending',
  current_step: 'finance_review',
  current_step_label: 'Finance review',
  step_label: 'Finance review',
  updated_at: '2026-10-18T09:00:00Z',
  pending_approvers: [],
  flow_steps: FLOW_STEPS,
  viewer: { can_act: true, is_submitter: false, can_override: false },
};

/** The same request, submitted by a person. */
const HUMAN_ROW: Record<string, unknown> = {
  ...FLOW_ROW,
  submitter_id: 'usr_qFpo8Zk2LmN4pR7t',
  submitter_name: 'Ada Lovelace',
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
    updated_at: { label: 'Updated At', type: 'datetime', group: 'System' },
  },
  actions: [
    {
      name: 'approval_approve', label: 'Approve', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve', params: DECISION_PARAMS,
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The row the approvals get serves for this case. */
let served: Record<string, unknown> = FLOW_ROW;

const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://test.local');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}`) return json(200, served);
  if (method === 'GET' && url.pathname === `/api/v1/approvals/requests/${REQ}/actions`) return json(200, { data: [] });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

/** The console adapter: nothing answered. */
const host = {
  find: vi.fn(async (_resource: string, _params?: unknown) => ({ data: [], total: 0 })),
  findOne: vi.fn(async (_resource: string, _id: string) => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => DEFS[name] ?? null),
};

const metadata = {
  apps: [], objects: [REQUEST_DEF, ACTION_DEF, USER_DEF], dashboards: [], reports: [],
  pages: [SERVED_PAGE], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: vi.fn(async () => []),
  getItem: vi.fn(async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null)),
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** `DefaultAppContent`'s generic record route: the view over `useAdapter()`. */
function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

/** Opens the served page over `row` and waits for the decision panel to draw the served row. */
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
  return screen.findByTestId('approval-decision-panel', undefined, { timeout: 8000 });
}

const marker = (panel: HTMLElement) => within(panel).queryByTestId('approval-decision-flow-origin');
const pageText = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  served = FLOW_ROW;
});

describe('the served request page shows the flow origin and the step line (objectui#12491)', () => {
  it('the served page parses as a spec page, with no node or prop added for either', () => {
    const parsed = PageSchema.safeParse(SERVED_PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(SERVED_PAGE.slots.actions).toEqual([{ type: 'record:approval_decision' }]);
  });

  it('a multi-step request shows its vertical step line, every step in order, the current one marked', async () => {
    const panel = await openServedPage(FLOW_ROW);
    const line = await within(panel).findByLabelText(PACK.stepProgress, undefined, { timeout: 8000 });
    expect(line.tagName).toBe('OL');
    expect(line.getAttribute('class')?.split(/\s+/)).toContain('flex-col');
    const rows = within(line).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Manager review', '2Finance review', '3Director sign-off', '4CFO sign-off']);
    expect(within(rows[1]).getByText('Finance review').getAttribute('class')?.split(/\s+/)).toContain('font-medium');
    // A first_response node carries no tally; the line is drawn without one.
    expect(within(panel).queryByRole('progressbar')).toBeNull();
  });

  it('a request served with no submitter is marked with the flow origin', async () => {
    expect('submitter_id' in FLOW_ROW).toBe(false);
    const panel = await openServedPage(FLOW_ROW);
    await within(panel).findByLabelText(PACK.stepProgress, undefined, { timeout: 8000 });
    expect(marker(panel)?.textContent).toBe(PACK.flowOrigin);
  });

  it('a decided request still shows its line and its origin', async () => {
    const decided = {
      ...FLOW_ROW,
      status: 'approved',
      flow_steps: FLOW_STEPS.map((s) => ({ ...s, state: 'done' })),
      viewer: { can_act: false, is_submitter: false, can_override: false },
    };
    const panel = await openServedPage(decided);
    const line = await within(panel).findByLabelText(PACK.stepProgress, undefined, { timeout: 8000 });
    expect(within(line).getAllByRole('listitem')).toHaveLength(FLOW_STEPS.length);
    expect(marker(panel)?.textContent).toBe(PACK.flowOrigin);
  });

  it('CONTROL: a request a person submitted carries no flow-origin marker, and its line is unchanged', async () => {
    const panel = await openServedPage(HUMAN_ROW);
    const line = await within(panel).findByLabelText(PACK.stepProgress, undefined, { timeout: 8000 });
    expect(within(line).getAllByRole('listitem')).toHaveLength(FLOW_STEPS.length);
    expect(marker(panel)).toBeNull();
    expect(pageText()).not.toContain(PACK.flowOrigin);
  });

  it('CONTROL: a one-step flow draws no line', async () => {
    const panel = await openServedPage({ ...FLOW_ROW, flow_steps: [FLOW_STEPS[1]] });
    await within(panel).findByTestId('approval-decision-flow-origin', undefined, { timeout: 8000 });
    expect(within(panel).queryByLabelText(PACK.stepProgress)).toBeNull();
  });
});
