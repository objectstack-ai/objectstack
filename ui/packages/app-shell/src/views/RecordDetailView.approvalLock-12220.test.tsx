/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's approval lock follows its ANSWERED approvals read
 * (objectui#12220).
 *
 * Measured on hosted free-plan HotCRM 4.0.1 accounts (objectstack-ai/hotcrm#2067):
 * a composition without the approvals service answers
 * `GET /api/v1/approvals/requests?object=…&recordId=…` with `200 { data: [] }`
 * and enforces no lock (`PATCH` answers 200), yet a record whose
 * `approval_status` column read `pending` opened with Edit disabled and the
 * "Locked for approval" band, because the page fell back to the column whenever
 * no pending request was FOUND. The fallback now stands in only while no read
 * has answered (a 404 / 501 route, or a read not yet landed).
 *
 * The page body is stubbed with a probe inside the page's own
 * `<InlineEditProvider>`, as `RecordDetailView.approvalRecallGate` does: it
 * prints what the page threads (`locked`, `approvalPending`,
 * `approvalReadAnswered`, and `canEdit`, which the header Edit and the body
 * pencils both follow). What the band does with those is pinned in
 * plugin-detail's `DetailView.approvalReadAnswered-12220.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
      />
    );
  };
  return { ...actual, SchemaRenderer: Probe };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

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
      approval_status: { type: 'text', label: 'Approval Status', readonly: true },
    },
  },
];

const pendingRequest = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  process_name: 'flow:account_review',
  object_name: OBJECT_NAME,
  record_id: RECORD_ID,
  status: 'pending',
  submitter_id: 'u_owner',
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
    // HotCRM 4.0.1 stamped `pending` on every account it created.
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Northwind', approval_status: 'pending' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    cancelPendingApproval: vi.fn(async () => ({ requestId: REQUEST_ID, status: 'recalled' })),
  } as any;
}

function renderRecordPage() {
  return render(
    <MemoryRouter initialEntries={[`/app/crm/${OBJECT_NAME}/${RECORD_ID}`]}>
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

const attr = (probe: HTMLElement, name: string) => probe.getAttribute(`data-${name}`);

beforeEach(() => {
  cleanup();
  authFetchSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('record page approval lock follows the answered read (objectui#12220)', () => {
  it('a `pending` record whose approvals read answers 200 empty opens editable, with no band to thread', async () => {
    stubApprovalsApi({ row: null });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    // Waiting on the flag the read flips is what makes the values below a
    // measurement of the answered state, not of the pre-read render.
    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    expect(listGets.length).toBeGreaterThan(0);
    expect(attr(probe, 'locked')).toBe('false');
    expect(attr(probe, 'approval-pending')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });

  it('a record with an open locking request stays locked', async () => {
    stubApprovalsApi({ row: pendingRequest() });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    await waitFor(() => expect(attr(probe, 'locked')).toBe('true'));
    expect(attr(probe, 'approval-pending')).toBe('true');
    expect(attr(probe, 'can-edit')).toBe('false');
  });

  for (const status of [404, 501]) {
    it(`with the approvals route absent (${status}), the column fallback still locks`, async () => {
      stubApprovalsApi({ absent: status });
      renderRecordPage();
      const probe = await screen.findByTestId('inline-probe');

      await waitFor(() => expect(listGets.length).toBeGreaterThan(0));
      // Let the refused read settle before reading what it left behind.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() => expect(attr(probe, 'locked')).toBe('true'));
      expect(attr(probe, 'approval-pending')).toBe('true');
      expect(attr(probe, 'approval-read-answered')).toBe('false');
      expect(attr(probe, 'can-edit')).toBe('false');
    });
  }

  it('control (objectui#2902): an open `lockRecord: false` request reads pending and editable over a `pending` column', async () => {
    stubApprovalsApi({ row: pendingRequest({ lock_record: false }) });
    renderRecordPage();
    const probe = await screen.findByTestId('inline-probe');

    await waitFor(() => expect(attr(probe, 'approval-read-answered')).toBe('true'));
    await waitFor(() => expect(attr(probe, 'approval-pending')).toBe('true'));
    expect(attr(probe, 'locked')).toBe('false');
    await waitFor(() => expect(attr(probe, 'can-edit')).toBe('true'));
  });
});
