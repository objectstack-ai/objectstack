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
 * (`GET /approvals/records/:object/:recordId/lock`, answered to every reader)
 * when the list finds no pending request.
 *
 * A composition without the approvals service answers that read 501, its
 * designed "no lock service": the page reads it silently and does not ask
 * again, while any other failure still logs (objectstack#26632).
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
let lockGets: string[];

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * What the approvals list route answers: `{ row }` is a 200, with `row: null`
 * for the empty list a composition without the approvals service sends;
 * `{ absent }` is an absent route answering that status.
 */
type ListAnswer = { row: Record<string, unknown> | null } | { absent: number };

/**
 * What the record-lock route answers: `{ locked }` in the declared envelope,
 * or a refusal carrying the route's status (501 when the approvals service is
 * absent, the body `respond501` sends).
 */
type LockAnswer = { locked: boolean } | { refused: number };

const LOCK_PATH = `/approvals/records/${OBJECT_NAME}/${RECORD_ID}/lock`;

function stubApprovalsApi(answer: ListAnswer, lock: LockAnswer) {
  listGets = [];
  lockGets = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith(LOCK_PATH)) {
        lockGets.push(u);
        if ('refused' in lock) {
          return lock.refused === 501
            ? jsonResponse(501, { code: 'NOT_IMPLEMENTED', message: 'Approvals service is not configured on this deployment' })
            : jsonResponse(lock.refused, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
        }
        return jsonResponse(200, { success: true, data: { locked: lock.locked } });
      }
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
 * The SDK's own record-lock read. The page must not use it: the client logs
 * every non-2xx as an error before the page sees the answer (objectstack#26632).
 */
let getRecordLock: ReturnType<typeof vi.fn>;

function makeAdapter() {
  getRecordLock = vi.fn(async () => ({ locked: false }));
  return { getClient: () => ({ approvals: { getRecordLock } }) } as any;
}

function renderRecordPage() {
  return render(
    <MemoryRouter initialEntries={[`/app/crm/${OBJECT_NAME}/${RECORD_ID}`]}>
      <AdapterCtx.Provider value={makeAdapter()}>
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

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cleanup();
  __resetRecordApprovalsStore();
  authFetchSpy.mockClear();
  consoleError = vi.spyOn(console, 'error');
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

/** The `console.error` lines that name the record-lock read. */
const lockErrorLines = () =>
  consoleError.mock.calls.filter((args: unknown[]) => args.some((a) => String(a).includes(LOCK_PATH)));

describe('record page lock for a reader outside the approval (objectstack#25934)', () => {
  it('a non-participant on a record held by a locking approval is offered no inline edit', async () => {
    stubApprovalsApi({ row: null }, { locked: true });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'locked')).toBe('true'));
    expect(lockGets).toHaveLength(1);
    expect(attr(probe, 'approval-read-answered')).toBe('true');
    expect(attr(probe, 'approval-pending')).toBe('true');
    expect(attr(probe, 'can-edit')).toBe('false');
    // Their request is unreadable to them, so they did not submit it: no recall.
    expect(attr(probe, 'approval-is-submitter')).toBe('false');
  });

  it('a record the server reports unlocked opens editable', async () => {
    stubApprovalsApi({ row: null }, { locked: false });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(lockGets).toHaveLength(1));
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    expect(attr(probe, 'approval-pending')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });

  it('without the approvals service (lock read 501) nothing changes: an answered empty read is not locked', async () => {
    stubApprovalsApi({ row: null }, { refused: 501 });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(lockGets).toHaveLength(1));
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    expect(attr(probe, 'approval-pending')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });

  it('the 501 of a composition without the approvals service logs nothing, and the lock is not read again (objectstack#26632)', async () => {
    stubApprovalsApi({ row: null }, { refused: 501 });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    await waitFor(() => expect(lockGets).toHaveLength(1));
    expect(lockErrorLines()).toEqual([]);
    expect(getRecordLock).not.toHaveBeenCalled();

    // Open the record again: the list is read again, the lock is not.
    cleanup();
    renderRecordPage();
    await waitFor(() => expect(listGets.length).toBeGreaterThanOrEqual(2));
    const again = await screen.findByTestId('inline-probe');
    await waitFor(() => expect(attr(again, 'approval-read-answered')).toBe('true'));
    expect(attr(again, 'locked')).toBe('false');
    expect(lockGets).toHaveLength(1);
    expect(lockErrorLines()).toEqual([]);
  });

  it('any other lock-read failure still logs, and the next open asks again', async () => {
    stubApprovalsApi({ row: null }, { refused: 500 });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    await waitFor(() => expect(lockErrorLines()).toHaveLength(1));
    expect(String(lockErrorLines()[0][0])).toContain(`GET `);
    expect(String(lockErrorLines()[0][0])).toContain('-> 500');
    expect(attr(probe, 'locked')).toBe('false');

    cleanup();
    renderRecordPage();
    await waitFor(() => expect(lockGets).toHaveLength(2));
  });

  it('a participant\'s pending request decides, and the record lock is not read', async () => {
    stubApprovalsApi({ row: pendingRequest({ lock_record: false }) }, { locked: true });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'approval-pending')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
    expect(lockGets).toEqual([]);
  });
});
