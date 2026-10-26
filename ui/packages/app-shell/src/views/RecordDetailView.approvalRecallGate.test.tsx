/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page resolves WHO MAY SEE the recall lever, and threads that
 * verdict to the approval band (objectui#6464).
 *
 * `DetailView.approvalRecallGate` pins what the band does with the verdict, and
 * `useRecordApprovals.isSubmitterOf` pins how the verdict is derived. Neither
 * can catch a host that derives it correctly and forgets to thread it — the
 * whole defect lives in that seam, so this suite mounts the real record page
 * against a stubbed approvals API and reads the verdict off the live
 * `InlineEditContext`.
 *
 * The band itself is rendered through the page's schema tree; stubbing
 * `SchemaRenderer` with a PROBE instead of `null` keeps the mount cheap while
 * still measuring the one value the seam carries. What the probe renders is
 * the tri-state verbatim, so `false` (a resolved non-submitter) never reads the
 * same as `undefined` (a host that resolved nothing).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const SIGNED_IN_USER = 'u_qcdir';

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

/**
 * The probe. It stands exactly where the page body (and with it the approval
 * band) would render, inside the page's own `<InlineEditProvider>`, and prints
 * the threaded verdict rather than the band — so this file measures the seam
 * and `DetailView.approvalRecallGate` measures the band.
 */
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  const Probe = () => {
    const inline = actual.useInlineEdit();
    return (
      <div
        data-testid="inline-probe"
        data-approval-is-submitter={String(inline?.approvalIsSubmitter)}
        data-approval-pending={String(inline?.approvalPending)}
      />
    );
  };
  return { ...actual, SchemaRenderer: Probe };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'qif_report';
const RECORD_ID = 'QIF202607310002';
const REQUEST_ID = 'req_qif_1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'QIF Report',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

/**
 * The pending request as the server sends it. `submitter_id` is deliberately
 * NOT the signed-in user in the default row: the discriminating case is a
 * reader who is not the submitter, which is the whole field report.
 */
const pendingRequest = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  process_name: 'flow:qif_quality_review',
  object_name: OBJECT_NAME,
  record_id: RECORD_ID,
  status: 'pending',
  submitter_id: 'u_inspector',
  current_step: 'qc_director_review',
  pending_approvers: ['position:qc_director'],
  lock_record: true,
  ...over,
});

let approvalsFetch: ReturnType<typeof vi.fn>;

/**
 * `row: null` with `listStatus` is a backend with no approvals route at all.
 * An empty `200` is NOT that backend (objectui#12220): it is an answered read
 * with no request, on which the page threads no approval at all.
 */
function stubApprovalsApi(row: Record<string, unknown> | null, listStatus = 200) {
  approvalsFetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes(`/approvals/requests/${REQUEST_ID}/actions`)) {
      return { ok: true, json: async () => ({ data: [] }) } as any;
    }
    if (u.endsWith(`/approvals/requests/${REQUEST_ID}`)) {
      // `getRequest` — the read that attaches the `viewer` block.
      return { ok: true, json: async () => row } as any;
    }
    if (u.includes('/approvals/requests?object=')) {
      if (listStatus !== 200) {
        return { ok: false, status: listStatus, json: async () => ({ code: 'NOT_FOUND' }) } as any;
      }
      return { ok: true, json: async () => ({ data: row ? [row] : [] }) } as any;
    }
    return { ok: true, json: async () => ({ data: [] }) } as any;
  });
  vi.stubGlobal('fetch', approvalsFetch);
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
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Incoming batch 0731', approval_status: 'pending' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    cancelPendingApproval: vi.fn(async () => ({ requestId: REQUEST_ID, status: 'recalled' })),
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

/**
 * Read the verdict off the live context. Waiting on `approval-pending` first is
 * what keeps every assertion below a MEASUREMENT: the approvals read is async,
 * and a probe queried before it lands reports `undefined` for every case —
 * which happens to be the right answer for one of them, so a bare read would
 * make the "no approvals API" case pass without ever exercising it.
 */
async function settledProbe(expectPending: boolean) {
  const probe = await screen.findByTestId('inline-probe');
  await waitFor(() =>
    expect(probe.getAttribute('data-approval-pending')).toBe(String(expectPending)),
  );
  return probe;
}

beforeEach(() => {
  cleanup();
  authFetchSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('record page → band: who may see recall (objectui#6464)', () => {
  /**
   * THE DEFECT, at the seam. A reader who is not the submitter: the server
   * resolved `is_submitter: false`, and the page must carry that verdict down
   * to the band rather than leaving it unset.
   */
  it('threads a resolved NON-submitter verdict to the band', async () => {
    stubApprovalsApi(pendingRequest({ viewer: { can_act: true, is_submitter: false, can_override: false } }));
    renderRecordPage();

    const probe = await settledProbe(true);
    expect(probe.getAttribute('data-approval-is-submitter')).toBe('false');
  });

  /** The opposite failure: the submitter must not lose the lever. */
  it('threads a resolved SUBMITTER verdict to the band', async () => {
    stubApprovalsApi(pendingRequest({ viewer: { can_act: false, is_submitter: true, can_override: false } }));
    renderRecordPage();

    const probe = await settledProbe(true);
    expect(probe.getAttribute('data-approval-is-submitter')).toBe('true');
  });

  /**
   * Older server, no `viewer` block: the page falls back to comparing the row's
   * `submitter_id` against the signed-in id — and must reach the SAME verdict,
   * both ways.
   */
  it('falls back to the id comparison when the server sends no viewer block', async () => {
    stubApprovalsApi(pendingRequest({ submitter_id: SIGNED_IN_USER }));
    renderRecordPage();

    const probe = await settledProbe(true);
    expect(probe.getAttribute('data-approval-is-submitter')).toBe('true');
  });

  it('resolves a non-submitter through the fallback too', async () => {
    stubApprovalsApi(pendingRequest({ submitter_id: 'u_inspector' }));
    renderRecordPage();

    const probe = await settledProbe(true);
    expect(probe.getAttribute('data-approval-is-submitter')).toBe('false');
  });

  /**
   * No pending request to consult — the band runs off the record's own
   * `approval_status` mirror. The page resolves NO identity here and must
   * thread `undefined`, which the band reads as "unchanged from before this
   * gate existed". Threading `false` instead would hide recall from the
   * submitter on every backend without an approvals API.
   */
  it('threads `undefined` — not `false` — when there is no request to consult', async () => {
    // No approvals route (404): the column is the only source, which is the
    // case this pin is about. An empty 200 would mean "no approval running"
    // and thread no band at all (objectui#12220).
    stubApprovalsApi(null, 404);
    renderRecordPage();

    // Still pending: `approval_status: 'pending'` on the record is the mirror
    // that keeps the band up with no approvals row behind it.
    const probe = await settledProbe(true);
    expect(probe.getAttribute('data-approval-is-submitter')).toBe('undefined');
  });
});
