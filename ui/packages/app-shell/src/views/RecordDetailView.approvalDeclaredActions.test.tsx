/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The business record page runs `sys_approval_request`'s OWN declared decision
 * actions (objectui#3055).
 *
 * Before this, the record page spliced two hand-written buttons into its header
 * — approve and reject, nothing else — behind a bespoke `type:'approval'`
 * handler and a CLIENT-side approver test. The approvals list, looking at the
 * SAME request over the SAME nine REST routes, offered five decisions plus the
 * submitter's levers, took decision attachments, and gated on the server's own
 * `viewer` block. On a business record, reassign / send back / request info had
 * no entry point at all and a decision could not carry a file.
 *
 * These tests mount the real record page and assert the surface an approver
 * standing on a business record actually gets. The action set is NOT restated
 * as an expectation of console code — it is read from the object definition,
 * which is the whole point: a ninth decision action must land here by shipping
 * metadata, with no console change.
 *
 * Gating is asserted through the server-computed `viewer` block
 * (framework#3310 / #3424) rather than any client-side membership test — the
 * record page must not hold a second opinion about who may act, because that
 * is exactly how it drifted from the approvals list.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The header stub reads the record header's state context. It is handed to the
// stub through `headerHost.stateContext` at module top, never imported inside
// the `@object-ui/react` mock factory: `@object-ui/components` imports
// `@object-ui/react` itself, so importing it from that factory awaits the very
// module the factory is building, and the file hangs at collection with no
// test clock running.
import { RecordHeaderStateContext } from '@object-ui/components';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_qcdir', name: 'QC Director', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Auto-answering dialog stubs. The runner chains confirm → param collection →
// dispatch, and both steps are `await`ed, so a null-rendering stub would park
// every action forever. These resolve immediately, which keeps the file about
// WHICH actions the page offers and WHERE their dispatch lands — the dialogs
// themselves are covered by ActionParamDialog's own suites.
vi.mock('./ActionConfirmDialog', () => ({
  ActionConfirmDialog: ({ state }: any) => {
    React.useEffect(() => {
      if (state?.open) state.resolve?.(true);
    }, [state]);
    return null;
  },
}));
// The param sets the dialog was opened with, newest last — read by the
// reject-reason pin (objectstack#35593).
const paramDialogOpens = vi.hoisted(() => [] as Array<Array<{ name: string; required?: boolean }>>);
vi.mock('./ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) => {
    React.useEffect(() => {
      if (state?.open) paramDialogOpens.push(state.params ?? []);
      if (state?.open) state.resolve?.({ comment: 'looks good', 'outputs.next_reviewer': 'u_plant_mgr' });
    }, [state]);
    return null;
  },
}));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

// The page body is orthogonal — the decision group is handed out by the view
// itself (objectstack#35593), not built by the schema tree. With
// `headerHost.on` the stub stands in for `page:header`: it reads the
// record's header state and draws the tags and the ONE group the view hands
// it, around a record row of its own. Without it no header draws, which is a
// page whose layout has no `page:header`: the view keeps its fallback band.
const headerHost = vi.hoisted(() => ({
  on: false,
  stateContext: null as React.Context<any> | null,
}));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  const HeaderStub = ({ schema }: any) => {
    const state = React.useContext(headerHost.stateContext!);
    if (!headerHost.on || schema?.type !== 'page:header') return null;
    const recordRow = <span data-testid="stub-record-row" />;
    const recordMenuItems = <div role="menuitem" data-testid="stub-record-menu-item">Delete</div>;
    return (
      <div data-testid="stub-page-header">
        <span data-testid="stub-header-tags">{state?.tags}</span>
        <span data-testid="stub-header-group">
          {state?.group ? state.group({ recordRow, recordMenuItems, face: 'row' }) : recordRow}
        </span>
      </div>
    );
  };
  return { ...actual, SchemaRenderer: HeaderStub };
});

headerHost.stateContext = RecordHeaderStateContext;

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import {
  SYS_APPROVAL_REQUEST_OBJECT,
  RECORD_APPROVAL_ACTION_LOCATION,
  RECORD_APPROVAL_EXCLUDED_ACTIONS,
} from './recordApprovalActions';

const OBJECT_NAME = 'qif_report';
const RECORD_ID = 'QIF202607310002';
const REQUEST_ID = 'req_qif_1';

/**
 * `sys_approval_request`'s declared actions, mirroring the framework's
 * `packages/plugins/plugin-approvals/src/sys-approval-request.object.ts`
 * (objectui#2678 P2-4). Copied rather than imported because the console does
 * not depend on the plugin package — the console's contract is "render what the
 * object declares", and this fixture is the shape it must render.
 */
const SYS_APPROVAL_REQUEST_DEF = {
  name: SYS_APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  fields: {
    id: { type: 'text', label: 'Id' },
    status: { type: 'text', label: 'Status' },
    submitter_id: { type: 'lookup', label: 'Submitter', reference: 'sys_user' },
  },
  actions: [
    {
      name: 'approval_approve', label: 'Approve', variant: 'primary', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
        { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
      ],
      visible: 'record.viewer.can_act || record.viewer.can_override',
      locations: ['record_section', 'list_item'],
      successMessage: 'Approved.', refreshAfter: true,
    },
    {
      name: 'approval_reject', label: 'Reject', variant: 'danger', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reject',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
        { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
      ],
      visible: 'record.viewer.can_act || record.viewer.can_override',
      confirmText: 'Reject this request? A rejection is final for every approver.',
      locations: ['record_section', 'list_item'],
      successMessage: 'Rejected.', refreshAfter: true,
    },
    {
      name: 'approval_reassign', label: 'Reassign', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reassign',
      params: [
        { field: 'submitter_id', name: 'to', label: 'New approver', required: true },
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      visible: 'record.viewer.can_act || record.viewer.can_override',
      locations: ['record_section'],
      successMessage: 'Reassigned.', refreshAfter: true,
    },
    {
      name: 'approval_send_back', label: 'Send back', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/revise',
      params: [{ name: 'comment', label: 'Reason', type: 'textarea', required: false }],
      visible: 'record.viewer.can_act',
      locations: ['record_section'],
      successMessage: 'Sent back for revision.', refreshAfter: true,
    },
    {
      name: 'approval_request_info', label: 'Request info', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/request-info',
      params: [{ name: 'comment', label: 'What do you need?', type: 'textarea', required: true }],
      visible: 'record.viewer.can_act',
      locations: ['record_section'],
      successMessage: 'Information requested.', refreshAfter: true,
    },
    {
      name: 'approval_remind', label: 'Send reminder', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/remind',
      params: [{ name: 'comment', label: 'Note', type: 'textarea', required: false }],
      visible: 'record.status == "pending" && record.viewer.is_submitter',
      locations: ['record_section'],
      successMessage: 'Reminder sent.', refreshAfter: true,
    },
    {
      name: 'approval_recall', label: 'Recall', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/recall',
      params: [{ name: 'comment', label: 'Comment', type: 'textarea', required: false }],
      visible: '(record.status == "pending" || record.status == "returned") && record.viewer.is_submitter',
      confirmText: 'Recall this request?',
      locations: ['record_section'],
      successMessage: 'Recalled.', refreshAfter: true,
    },
    {
      name: 'approval_resubmit', label: 'Resubmit', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/resubmit',
      params: [{ name: 'comment', label: 'What changed?', type: 'textarea', required: false }],
      visible: 'record.status == "returned" && record.viewer.is_submitter',
      locations: ['record_section'],
      successMessage: 'Resubmitted.', refreshAfter: true,
    },
  ],
};

/** The five decisions an APPROVER gets — the acceptance set of objectui#3055. */
const APPROVER_DECISIONS = [
  'approval_approve',
  'approval_reject',
  'approval_reassign',
  'approval_send_back',
  'approval_request_info',
];

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'QIF Report',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

/**
 * The pending request as the server sends it. `pending_approvers` deliberately
 * carries NO entry equal to the signed-in user id: the slot is keyed by the
 * group-routed identity, which is precisely the shape the record page's old
 * client-side `includes(currentUserId)` could not match. `viewer` is the
 * server's own answer to the same question and is what the actions read.
 */
const pendingRequest = (viewer: Record<string, unknown> | undefined) => ({
  id: REQUEST_ID,
  process_name: 'flow:qif_quality_review',
  object_name: OBJECT_NAME,
  record_id: RECORD_ID,
  status: 'pending',
  submitter_id: 'u_inspector',
  current_step: 'qc_director_review',
  pending_approvers: ['position:qc_director'],
  lock_record: true,
  ...(viewer ? { viewer } : {}),
});

/**
 * The approvals router the current test is being served by. Swapped per test
 * (`stubApprovalsApi`) so a call count still means "this test's reads"; the
 * GLOBAL `fetch` double that forwards to it is installed once, below.
 */
type ApprovalsRouter = (url: string, init?: RequestInit) => Promise<unknown>;
let approvalsFetch: ReturnType<typeof vi.fn<ApprovalsRouter>>;

function makeApprovalsApi(row: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes(`/approvals/requests/${REQUEST_ID}/actions`)) {
      return { ok: true, json: async () => ({ data: [] }) } as any;
    }
    if (u.endsWith(`/approvals/requests/${REQUEST_ID}`)) {
      // `getRequest` — the read that attaches the `viewer` block.
      return { ok: true, json: async () => row } as any;
    }
    if (u.includes('/approvals/requests?object=')) {
      return { ok: true, json: async () => ({ data: [row] }) } as any;
    }
    return { ok: true, json: async () => ({ data: [] }) } as any;
  });
}

function stubApprovalsApi(row: Record<string, unknown>) {
  approvalsFetch = makeApprovalsApi(row);
}

/**
 * The `fetch` double is installed ONCE, here at module scope, and is
 * deliberately NEVER torn down — there is no `vi.unstubAllGlobals()` in this
 * file's `afterEach`, and adding one back re-opens objectui#7439.
 *
 * ⛔ Why the usual per-test install/teardown pair does not work here. A decision
 * dispatched by `DeclaredActionsBar` carries `refreshAfter: true`, so on success
 * the record page re-reads the approval state — `RecordDetailView`'s
 * `handleApprovalActionDone` calls `void approvals.refresh()`, and the
 * `notifyDataChanged` it fires alongside runs the same read again through the
 * record-invalidation effect. Both are fire-and-forget by design: nothing in the
 * console awaits them, and no test barrier here waits for them either — the
 * decision cases assert on the POST and return. That leaves a
 * `GET /api/v1/approvals/requests?object=…` in flight when the test ends.
 *
 * Vitest runs `afterEach` hooks in reverse registration order, so a teardown in
 * THIS file runs FIRST — before the root setup's RTL `cleanup()` and before the
 * network-escape guard's assertion. A `vi.unstubAllGlobals()` there restored the
 * real `fetch` while that read was still pending, and whether the read landed
 * before or after that restore was pure timing: green on a fast worker, a
 * `Network escape` red under load. Keeping ONE double installed for the whole
 * file removes the window instead of widening the stub — the late read is served
 * by the same router either way, and no test can ever end with the real `fetch`
 * back in place.
 *
 * The default below answers "no requests on this record", so the double is
 * honest even before the first `stubApprovalsApi` call and after the last test.
 */
approvalsFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
vi.stubGlobal(
  'fetch',
  ((url: string, init?: RequestInit) => approvalsFetch(url, init)) as unknown as typeof globalThis.fetch,
);

const METADATA = {
  objects: [...OBJECTS, SYS_APPROVAL_REQUEST_DEF],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async (type: string, name: string) =>
    (type === 'object' && name === SYS_APPROVAL_REQUEST_OBJECT ? SYS_APPROVAL_REQUEST_DEF : null),
  getItemsByType: () => [],
} as any;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Incoming batch 0731' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function renderRecordPage() {
  return render(
    <MemoryRouter initialEntries={[`/app/qms/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={makeDataSource()}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const decisionButton = (name: string) => screen.queryByTestId(`declared-action-${name}`);

/**
 * objectstack#34361 (ruling A) — the approver's band keeps the two decisions
 * as buttons and folds every other lever into one menu, so those levers are
 * read from the open menu.
 */
async function openDecisionMenu() {
  const trigger = await screen.findByTestId('declared-actions-decision-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

/** The approver's levers that the band folds behind its menu. */
const APPROVER_FOLDED = ['approval_reassign', 'approval_send_back', 'approval_request_info'];

beforeEach(() => {
  cleanup();
  authFetchSpy.mockClear();
  headerHost.on = false;
});

// The describes below render no `page:header` (`headerHost.on` is false), so
// they read the fallback band a header-less layout keeps (objectstack#35593).
describe('record page decision actions — a GROUP approver (objectui#3055)', () => {
  /**
   * The acceptance case: the signed-in user holds the slot through a position,
   * so their bare id is nowhere in `pending_approvers` — the server says
   * `can_act`, and that is the only opinion the page is entitled to have.
   */
  it('offers all five declared decisions on the business record page', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();

    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());
    expect(decisionButton('approval_approve')?.tagName).toBe('BUTTON');
    expect(decisionButton('approval_reject')?.tagName).toBe('BUTTON');
    await openDecisionMenu();
    for (const name of APPROVER_DECISIONS) {
      expect(decisionButton(name), `${name} must be offered to a pending approver`).toBeTruthy();
    }
    for (const name of APPROVER_FOLDED) {
      expect(decisionButton(name)?.getAttribute('role'), `${name} sits in the band's menu`).toBe('menuitem');
    }
  });

  it('offers reassign / send back / request info — the three that had NO entry point', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();

    await openDecisionMenu();
    expect(decisionButton('approval_reassign')).toBeTruthy();
    expect(decisionButton('approval_send_back')).toBeTruthy();
    expect(decisionButton('approval_request_info')).toBeTruthy();
  });

  it('carries the decision attachments param the hand-written buttons could not', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();
    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());

    // Read from the declaration the page renders — the console never restates
    // the param set, which is why it cannot drift from the approvals list.
    const approve = SYS_APPROVAL_REQUEST_DEF.actions.find((a) => a.name === 'approval_approve')!;
    expect(approve.params).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'attachments', type: 'file', multiple: true })]),
    );
  });

  it('hides the submitter-only levers from an approver who is not the submitter', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();
    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());

    expect(decisionButton('approval_recall')).toBeNull();
    expect(decisionButton('approval_resubmit')).toBeNull();
  });

  it('dispatches the decision on the REQUEST, not on the business record it is opened on', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();
    await openDecisionMenu();
    await waitFor(() => expect(decisionButton('approval_send_back')).toBeTruthy());
    authFetchSpy.mockClear();

    fireEvent.click(decisionButton('approval_send_back')!);
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());

    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // A declared same-origin api action goes through the action door
    // (objectstack#27611), which resolves `{id}` in the target from the
    // subject row it loads by `recordId` — the request row. Naming the host
    // page's record would have aimed the decision at
    // `/approvals/requests/QIF202607310002/revise`.
    expect(url).toContain('/api/v1/actions/sys_approval_request/approval_send_back');
    expect(url).not.toContain(RECORD_ID);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).recordId).toBe(REQUEST_ID);
  });

  it('sends a declared decision output as its `outputs.<key>` param, for the door to fold', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();
    await openDecisionMenu();
    await waitFor(() => expect(decisionButton('approval_send_back')).toBeTruthy());
    authFetchSpy.mockClear();

    fireEvent.click(decisionButton('approval_send_back')!);
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());

    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    // The dotted `outputs.<key>` param the bar synthesizes per request rides
    // the params bag to the action door (objectstack#27611), which folds it
    // into the nested `outputs` the decide routes read back as
    // `vars.<node>.<key>` (objectui#2955 / framework#3447) when it assembles
    // the target's body from the declaration.
    expect(body).toEqual({
      recordId: REQUEST_ID,
      params: { comment: 'looks good', 'outputs.next_reviewer': 'u_plant_mgr' },
    });
  });
});

describe('record page decision actions — gating is the SERVER\'s (objectui#3055)', () => {
  it('shows nothing to a viewer the server says cannot act', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: false, can_override: false }));
    renderRecordPage();
    // Let the approvals read settle before asserting an absence.
    await waitFor(() => expect(approvalsFetch).toHaveBeenCalled());

    for (const name of [...APPROVER_DECISIONS, 'approval_recall', 'approval_resubmit']) {
      expect(decisionButton(name), `${name} must stay hidden`).toBeNull();
    }
  });

  it('gives an override admin the three rescue levers and not the secondary two', async () => {
    // framework#3424: a request routed to an unstaffed position is otherwise
    // undecidable — a platform/tenant admin may approve, reject or reassign it.
    // Send back / request info are approver-only and stay hidden, exactly as on
    // the approvals list, because both surfaces read the same declaration.
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: false, can_override: true }));
    renderRecordPage();

    // objectstack#25877 — for an admin who holds no slot the record page folds
    // the rescue levers into one marked menu, so they are read from there.
    const trigger = await screen.findByTestId('declared-actions-override-menu');
    expect(decisionButton('approval_approve'), 'folded, not a button').toBeNull();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await screen.findByRole('menu');
    expect(decisionButton('approval_approve')?.getAttribute('role')).toBe('menuitem');
    expect(decisionButton('approval_reject')?.getAttribute('role')).toBe('menuitem');
    expect(decisionButton('approval_reassign')?.getAttribute('role')).toBe('menuitem');
    expect(decisionButton('approval_send_back')).toBeNull();
    expect(decisionButton('approval_request_info')).toBeNull();
  });

  it('fails CLOSED on a backend too old to send a `viewer` block', async () => {
    // Pre-framework#3310. The predicate cannot be evaluated, so no decision is
    // offered — never a button whose precondition is unknown.
    stubApprovalsApi(pendingRequest(undefined));
    renderRecordPage();
    await waitFor(() => expect(approvalsFetch).toHaveBeenCalled());

    for (const name of APPROVER_DECISIONS) {
      expect(decisionButton(name), `${name} must fail closed without a viewer block`).toBeNull();
    }
  });
});

/** Opens the record header's ONE `⋮` (objectstack#35593). */
async function openHeaderMenu() {
  const trigger = await screen.findByTestId('declared-actions-header-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByTestId('declared-actions-header-menu-content');
}

describe('record header — the approval is the ONE button group (objectstack#35593)', () => {
  beforeEach(() => {
    headerHost.on = true;
  });

  it('pending on me: 通过 is the only primary, 驳回 beside it, the other levers then the record ops in ⋮', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();

    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());
    expect(decisionButton('approval_approve')?.getAttribute('data-header-tone')).toBe('primary');
    expect(decisionButton('approval_reject')?.getAttribute('data-header-tone')).toBe('secondary');
    // The state's levers take the row: the record's own row is not drawn.
    expect(screen.queryByTestId('stub-record-row')).toBeNull();
    // …and there is no band of its own below the header.
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();

    const menu = await openHeaderMenu();
    for (const name of APPROVER_FOLDED) {
      expect(decisionButton(name)?.getAttribute('role'), `${name} sits in the group's ⋮`).toBe('menuitem');
    }
    expect(screen.getByTestId('declared-actions-header-menu-separator')).toBeTruthy();
    // The record's ops come last, after the separator.
    const items = Array.from(menu.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
    expect(items.indexOf('stub-record-menu-item')).toBeGreaterThan(items.indexOf('declared-actions-header-menu-separator'));
  });

  it('pending on me: the tag reads 待你审批 and opens the approval detail', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();

    const tag = await screen.findByTestId('record-approval-tag');
    expect(tag.textContent).toMatch(/awaiting your|待你/i);
    expect(tag.tagName).toBe('BUTTON');
  });

  it('the tag opens the 审批 tab, where the approvals panel is drawn (objectstack#35595)', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    const { container } = renderRecordPage();
    const tag = await screen.findByTestId('record-approval-tag');
    // CONTROL: 概览 draws no approvals panel and no tab face.
    expect(container.querySelector('[data-testid="record-approvals-panel"]')).toBeNull();
    expect(container.querySelector('[data-related-enlarged]')).toBeNull();
    fireEvent.click(tag);
    await waitFor(() => expect(container.querySelector('[data-related-enlarged="approvals"]')).not.toBeNull());
    expect(container.querySelector('[role="tab"][data-record-tab="approvals"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('a reject from the record page requires its reason', async () => {
    stubApprovalsApi(pendingRequest({ can_act: true, is_submitter: false, can_override: false }));
    renderRecordPage();
    await waitFor(() => expect(decisionButton('approval_reject')).toBeTruthy());
    authFetchSpy.mockClear();

    paramDialogOpens.length = 0;
    fireEvent.click(decisionButton('approval_reject')!);
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());
    // The declaration keeps `comment` optional (the approvals list's reject is
    // unchanged); the record page's dialog asks for it as required.
    const comment = paramDialogOpens.at(-1)?.find((param) => param.name === 'comment');
    expect(comment?.required).toBe(true);
    expect(SYS_APPROVAL_REQUEST_DEF.actions.find((a) => a.name === 'approval_reject')!.params[0].required).toBe(false);
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/actions/sys_approval_request/approval_reject');
    expect(JSON.parse(String(init.body)).recordId).toBe(REQUEST_ID);
  });

  it('my submission pending: 撤回 and 催办 lead, no decisions, ⋮ holds the record ops', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: true, can_override: false }));
    renderRecordPage();

    await waitFor(() => expect(decisionButton('approval_recall')).toBeTruthy());
    expect(decisionButton('approval_remind')).toBeTruthy();
    expect(decisionButton('approval_recall')?.getAttribute('data-header-tone')).toBe('secondary');
    expect(decisionButton('approval_approve')).toBeNull();
    // Recall precedes remind in the row.
    const row = screen.getByTestId('stub-header-group');
    const order = Array.from(row.querySelectorAll('[data-testid^="declared-action-"]')).map((el) => el.getAttribute('data-testid'));
    expect(order.indexOf('declared-action-approval_recall')).toBeLessThan(order.indexOf('declared-action-approval_remind'));
    await openHeaderMenu();
    expect(screen.getByTestId('stub-record-menu-item')).toBeTruthy();
  });

  it('an unrelated viewer gets the record row unchanged and the 审批中 tag', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: false, can_override: false }));
    renderRecordPage();

    await waitFor(() => expect(screen.getByTestId('stub-record-row')).toBeTruthy());
    const tag = await screen.findByTestId('record-approval-tag');
    // objectstack#35890 (item 6) — 「审批中 · 当前步骤」: the step the request
    // waits at, drawn by the approvals panel's rule (its machine name, prettified).
    expect(tag.textContent).toBe('In approval · Qc Director Review');
    for (const name of [...APPROVER_DECISIONS, 'approval_recall', 'approval_remind']) {
      expect(decisionButton(name), `${name} must stay hidden`).toBeNull();
    }
  });

  it('the 审批中 tag names the step by its label when the request has one (objectstack#35890)', async () => {
    stubApprovalsApi({ ...pendingRequest({ can_act: false, is_submitter: false, can_override: false }), step_label: 'QC director' });
    renderRecordPage();
    const tag = await screen.findByTestId('record-approval-tag');
    await waitFor(() => expect(tag.textContent).toBe('In approval · QC director'));
  });

  it('an override-only admin keeps the record row and the marked override menu', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: false, can_override: true }));
    renderRecordPage();

    await screen.findByTestId('declared-actions-override-menu');
    expect(screen.getByTestId('stub-record-row')).toBeTruthy();
  });

  it('no pending request: the record row, no tag', async () => {
    approvalsFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as any);
    renderRecordPage();
    await waitFor(() => expect(approvalsFetch).toHaveBeenCalled());

    expect(screen.getByTestId('stub-record-row')).toBeTruthy();
    expect(screen.queryByTestId('record-approval-tag')).toBeNull();
  });
});

describe('record page decision actions — the submitter (objectui#3055)', () => {
  it('offers recall to the submitter but not the approver decisions', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: true, can_override: false }));
    renderRecordPage();

    await waitFor(() => expect(decisionButton('approval_recall')).toBeTruthy());
    expect(decisionButton('approval_approve')).toBeNull();
    expect(decisionButton('approval_reject')).toBeNull();
  });

  it('leaves remind to the approvals panel, which already owns a richer one', async () => {
    stubApprovalsApi(pendingRequest({ can_act: false, is_submitter: true, can_override: false }));
    renderRecordPage();
    await waitFor(() => expect(decisionButton('approval_recall')).toBeTruthy());

    expect(RECORD_APPROVAL_EXCLUDED_ACTIONS).toContain('approval_remind');
    expect(decisionButton('approval_remind')).toBeNull();
  });
});

describe('record page decision actions — no bar without a pending request', () => {
  it('renders no decision chrome when the record has no requests', async () => {
    approvalsFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as any);
    renderRecordPage();
    await waitFor(() => expect(approvalsFetch).toHaveBeenCalled());

    expect(decisionButton('approval_approve')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('reads the location the metadata declares, not a host-specific one', () => {
    // The record page consumes `record_section` verbatim; every decision action
    // on `sys_approval_request` declares it, so none is dropped in translation.
    for (const action of SYS_APPROVAL_REQUEST_DEF.actions) {
      expect(action.locations).toContain(RECORD_APPROVAL_ACTION_LOCATION);
    }
  });
});
