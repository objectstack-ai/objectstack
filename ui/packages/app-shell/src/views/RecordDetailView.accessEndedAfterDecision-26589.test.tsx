/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page right after this viewer's own approval decision
 * (objectstack#26589).
 *
 * A pending approver with no standing access reads the record only while their
 * step waits, and the server revokes that read when the step ends
 * (objectstack#26180). The record page re-reads the record after every decision
 * (`handleApprovalActionDone`), so for that approver the re-read answers 404 —
 * and the page used to draw "Record not found" under the "Approved" toast, for a
 * record that exists.
 *
 * The ruling: show "decision recorded, your access to this record has ended"
 * with a link back to the approvals inbox. The read is not kept any longer. And
 * a genuine not-found is never masked: the new state is drawn only for a 404
 * that follows THIS viewer's decision on THIS record.
 *
 * The mock preamble is the one `RecordDetailView.approvalDeclaredActions.test.tsx`
 * uses — the real record page and the real declared-action bar, with
 * auto-answering dialogs — so the decision here travels the same path a click
 * does.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// The decision POST — through the action door, which forwards it to the
// declared decide route (objectstack#27611). It also flips `readEnded` the way
// the server's step end does (objectstack#26180): from then on the business
// record answers 404 to a viewer whose only read was the pending step's.
let readEnded = false;
let revokesOnDecision = true;
const authFetchSpy = vi.fn(async (url: string) => {
  if (revokesOnDecision && /\/actions\/sys_approval_request\/approval_(approve|reject)$/.test(String(url))) readEnded = true;
  return new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
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
vi.mock('./ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) => {
    React.useEffect(() => {
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

// The page body is orthogonal — the decision bar is rendered by the view
// itself, not through the schema tree.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return { ...actual, SchemaRenderer: () => null };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { SYS_APPROVAL_REQUEST_OBJECT } from './recordApprovalActions';

const APP = 'qms';
const OBJECT_NAME = 'qif_report';
const RECORD_ID = 'QIF202607310002';
const OTHER_RECORD_ID = 'QIF202607310099';
const REQUEST_ID = 'req_qif_1';

/** The two decisions the card names, as `sys_approval_request` declares them. */
const SYS_APPROVAL_REQUEST_DEF = {
  name: SYS_APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  fields: {
    id: { type: 'text', label: 'Id' },
    status: { type: 'text', label: 'Status' },
  },
  actions: [
    {
      name: 'approval_approve', label: 'Approve', variant: 'primary', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve',
      params: [{ name: 'comment', label: 'Comment', type: 'textarea', required: false }],
      visible: 'record.viewer.can_act || record.viewer.can_override',
      locations: ['record_section', 'list_item'],
      successMessage: 'Approved.', refreshAfter: true,
    },
    {
      name: 'approval_reject', label: 'Reject', variant: 'danger', type: 'api', method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reject',
      params: [{ name: 'comment', label: 'Comment', type: 'textarea', required: false }],
      visible: 'record.viewer.can_act || record.viewer.can_override',
      confirmText: 'Reject this request?',
      locations: ['record_section', 'list_item'],
      successMessage: 'Rejected.', refreshAfter: true,
    },
  ],
};

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

const PENDING_ROW = {
  id: REQUEST_ID,
  process_name: 'flow:qif_quality_review',
  object_name: OBJECT_NAME,
  record_id: RECORD_ID,
  status: 'pending',
  submitter_id: 'u_inspector',
  current_step: 'line_manager_review',
  pending_approvers: ['u_qcdir'],
  lock_record: true,
  viewer: { can_act: true, is_submitter: false, can_override: false },
};

/**
 * One `fetch` double for the whole file, never torn down — the reason is the
 * one `RecordDetailView.approvalDeclaredActions.test.tsx` records: the
 * fire-and-forget approvals re-read after a decision can outlive the test.
 */
vi.stubGlobal(
  'fetch',
  (async (url: string) => {
    const u = String(url);
    if (u.includes(`/approvals/requests/${REQUEST_ID}/actions`)) {
      return { ok: true, json: async () => ({ data: [] }) } as any;
    }
    if (u.endsWith(`/approvals/requests/${REQUEST_ID}`)) {
      return { ok: true, json: async () => PENDING_ROW } as any;
    }
    if (u.includes(`/approvals/requests?object=${OBJECT_NAME}`) && u.includes(RECORD_ID) && !readEnded) {
      return { ok: true, json: async () => ({ data: [PENDING_ROW] }) } as any;
    }
    return { ok: true, json: async () => ({ data: [] }) } as any;
  }) as unknown as typeof globalThis.fetch,
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

/**
 * The adapter answers a 404 by resolving `null` (`ObjectStackAdapter.findOne`).
 * `RECORD_ID` exists until the decision ends this viewer's read; `missing` ids
 * never exist.
 */
function makeDataSource(missing: string[] = []) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (_object: string, id: string) =>
      (missing.includes(id) || (id === RECORD_ID && readEnded) ? null : { id, name: 'Incoming batch 0731' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function page(dataSource: any, recordId: string) {
  return (
    <MemoryRouter initialEntries={[`/apps/${APP}/${OBJECT_NAME}/record/${recordId}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={
              <RecordDetailView
                dataSource={dataSource}
                objects={OBJECTS}
                onEdit={() => {}}
                objectNameOverride={OBJECT_NAME}
                recordIdOverride={recordId}
                embedded
              />
            }
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
}

const decisionButton = (name: string) => screen.queryByTestId(`declared-action-${name}`);

beforeEach(() => {
  cleanup();
  readEnded = false;
  revokesOnDecision = true;
  authFetchSpy.mockClear();
});

describe('record page after this viewer\'s own decision (objectstack#26589)', () => {
  it.each(['approval_approve', 'approval_reject'])(
    'draws the ended-access state with an inbox link when %s ends the read',
    async (action) => {
      const dataSource = makeDataSource();
      render(page(dataSource, RECORD_ID));
      await waitFor(() => expect(decisionButton(action)).toBeTruthy());
      const readsBefore = dataSource.findOne.mock.calls.length;

      fireEvent.click(decisionButton(action)!);

      const state = await screen.findByTestId('record-access-ended');
      expect(state.textContent).toContain('Decision recorded');
      expect(state.textContent).toContain('your access to this record has ended');
      expect(state.textContent).not.toContain('Record not found');
      expect(screen.queryByText('Record not found')).toBeNull();
      // The re-read really was the 404 — the state is not drawn from the POST.
      expect(dataSource.findOne.mock.calls.length).toBeGreaterThan(readsBefore);

      const link = screen.getByTestId('record-access-ended-inbox');
      expect(link.getAttribute('href')).toBe(`/apps/${APP}/system/approvals`);
    },
  );

  it('keeps the record on screen for a decider whose read does not end', async () => {
    // A viewer with standing access (an owner, a sharing rule) still reads the
    // record after the step ends: the page simply refreshes.
    revokesOnDecision = false;
    const dataSource = makeDataSource();
    render(page(dataSource, RECORD_ID));
    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());
    const readsBefore = dataSource.findOne.mock.calls.length;

    fireEvent.click(decisionButton('approval_approve')!);
    await waitFor(() => expect(dataSource.findOne.mock.calls.length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());

    expect(screen.queryByTestId('record-access-ended')).toBeNull();
    expect(screen.queryByText('Record not found')).toBeNull();
  });
});

describe('a genuine not-found is never masked (objectstack#26589)', () => {
  it('draws "Record not found" for a plain 404 with no decision', async () => {
    render(page(makeDataSource([RECORD_ID]), RECORD_ID));

    await screen.findByText('Record not found');
    expect(screen.queryByTestId('record-access-ended')).toBeNull();
  });

  it('draws "Record not found" for another record after a decision on this one', async () => {
    const dataSource = makeDataSource([OTHER_RECORD_ID]);
    const view = render(page(dataSource, RECORD_ID));
    await waitFor(() => expect(decisionButton('approval_approve')).toBeTruthy());
    fireEvent.click(decisionButton('approval_approve')!);
    // The decision ended the read on THIS record, and the page says so.
    await screen.findByTestId('record-access-ended');

    // Same mounted page, moved to a record that does not exist: that 404 is
    // not this viewer's decision, so it stays "Record not found".
    view.rerender(page(dataSource, OTHER_RECORD_ID));

    await screen.findByText('Record not found');
    expect(screen.queryByTestId('record-access-ended')).toBeNull();
  });
});
