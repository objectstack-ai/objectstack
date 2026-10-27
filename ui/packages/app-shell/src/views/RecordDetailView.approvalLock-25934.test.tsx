/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A reader outside the approval is not offered an edit on a locked record
 * (objectstack#25934, ruling A).
 *
 * The approvals list serves a request only to its participants, so a member
 * who can read the record but is not on the slate, did not submit and holds no
 * override reads `GET /approvals/requests?object=…&recordId=…` as
 * `200 { data: [] }` while a `lockRecord: true` approval runs. The page took
 * that for "no approval is running" and offered inline edit, and the save
 * answered `409 RECORD_LOCKED`. The page now asks the record's own lock
 * (`client.approvals.getRecordLock`, answered to every reader) when the list
 * finds no pending request.
 *
 * Same probe as `RecordDetailView.approvalLock-12220`: it prints what the page
 * threads into its `<InlineEditProvider>`. The record carries no
 * `approval_status` mirror (showcase's shape), so no column fallback can stand
 * in for the signal.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_owner', name: 'Account Owner', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
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

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
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

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  const Probe = () => {
    const inline = actual.useInlineEdit();
    return (
      <div
        data-testid="inline-probe"
        data-locked={String(inline?.locked)}
        data-approval-pending={String(inline?.approvalPending)}
        data-approval-read-answered={String(inline?.approvalReadAnswered)}
        data-can-edit={String(inline?.canEdit)}
        data-approval-is-submitter={String(inline?.approvalIsSubmitter)}
      />
    );
  };
  return { ...actual, SchemaRenderer: Probe };
});

import { AdapterCtx, MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';

const OBJECT_NAME = 'account';
const RECORD_ID = 'acc_northwind';
const REQUEST_ID = 'req_account_1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const pendingRequest = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  process_name: 'flow:account_review',
  object_name: OBJECT_NAME,
  record_id: RECORD_ID,
  status: 'pending',
  submitter_id: 'u_submitter',
  current_step: 'manager_review',
  pending_approvers: ['u_manager'],
  lock_record: true,
  ...over,
});

let listGets: string[];

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * What the approvals list route answers: `{ row }` is a 200, with `row: null`
 * for the empty list a composition without the approvals service sends;
 * `{ absent }` is an absent route answering that status.
 */
type ListAnswer = { row: Record<string, unknown> | null } | { absent: number };

function stubApprovalsApi(answer: ListAnswer) {
  listGets = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/approvals/requests?object=')) {
        listGets.push(u);
        if ('absent' in answer) return jsonResponse(answer.absent, { code: 'NOT_FOUND' });
        return jsonResponse(200, { data: answer.row ? [answer.row] : [] });
      }
      if ('row' in answer && answer.row && u.endsWith(`/approvals/requests/${REQUEST_ID}`)) {
        return jsonResponse(200, answer.row);
      }
      return jsonResponse(200, { data: [] });
    }),
  );
}

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    // Like showcase: no `approval_status` mirror for a fallback to read.
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Northwind' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    cancelPendingApproval: vi.fn(async () => ({ requestId: REQUEST_ID, status: 'recalled' })),
  } as any;
}

/**
 * The record-lock read as the SDK answers it: `{ locked }`, or a refusal
 * carrying the route's status (501 when the approvals service is absent).
 */
type LockAnswer = { locked: boolean } | { refused: number };
let getRecordLock: ReturnType<typeof vi.fn>;

function makeAdapter(answer: LockAnswer) {
  getRecordLock = vi.fn(async () => {
    if ('refused' in answer) throw Object.assign(new Error(`HTTP ${answer.refused}`), { status: answer.refused });
    return { locked: answer.locked };
  });
  return { getClient: () => ({ approvals: { getRecordLock } }) } as any;
}

function renderRecordPage(lock: LockAnswer) {
  return render(
    <MemoryRouter initialEntries={[`/app/crm/${OBJECT_NAME}/${RECORD_ID}`]}>
      <AdapterCtx.Provider value={makeAdapter(lock)}>
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
      </AdapterCtx.Provider>
    </MemoryRouter>,
  );
}

const attr = (probe: HTMLElement, name: string) => probe.getAttribute(`data-${name}`);

beforeEach(() => {
  cleanup();
  __resetRecordApprovalsStore();
  authFetchSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('record page lock for a reader outside the approval (objectstack#25934)', () => {
  it('a non-participant on a record held by a locking approval is offered no inline edit', async () => {
    stubApprovalsApi({ row: null });
    renderRecordPage({ locked: true });
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'locked')).toBe('true'));
    expect(getRecordLock).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID);
    expect(attr(probe, 'approval-read-answered')).toBe('true');
    expect(attr(probe, 'approval-pending')).toBe('true');
    expect(attr(probe, 'can-edit')).toBe('false');
    // Their request is unreadable to them, so they did not submit it: no recall.
    expect(attr(probe, 'approval-is-submitter')).toBe('false');
  });

  it('a record the server reports unlocked opens editable', async () => {
    stubApprovalsApi({ row: null });
    renderRecordPage({ locked: false });
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(getRecordLock).toHaveBeenCalled());
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    expect(attr(probe, 'approval-pending')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });

  it('without the approvals service (lock read 501) nothing changes: an answered empty read is not locked', async () => {
    stubApprovalsApi({ row: null });
    renderRecordPage({ refused: 501 });
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(getRecordLock).toHaveBeenCalled());
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    expect(attr(probe, 'approval-pending')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });

  it('a participant\'s pending request decides, and the record lock is not read', async () => {
    stubApprovalsApi({ row: pendingRequest({ lock_record: false }) });
    renderRecordPage({ locked: true });
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'approval-pending')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
    expect(getRecordLock).not.toHaveBeenCalled();
  });
});
