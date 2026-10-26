/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView — `type:'api'` target URL `{field}` interpolation for
 * record-header actions (objectui#3391).
 *
 * The record page's api handler used to gate `{field}` interpolation on
 * `params._rowRecord` alone — a stash only related-list row dispatches
 * carried. A `record_header` action targeting `/api/v1/data/:object/{id}`
 * therefore went out with the literal `{id}` (`%7Bid%7D` on the wire → 400),
 * while the SAME declaration on `list_item` interpolated fine.
 *
 * These tests exercise the handler set the view REALLY hands to its
 * ActionProvider (captured via a pass-through wrapper, same harness as
 * RecordDetailView.modalDispatch.test.tsx) and pin the fixed contract:
 *   1. no stash → interpolate from THIS page's record;
 *   2. a stashed `_rowRecord` still wins over the page record;
 *   3. an action retargeting ANOTHER object never interpolates from the
 *      parent page record (wrong record's fields);
 *   4. the flow trigger body never carries the client-side `_rowRecord` stash.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
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

// The dialogs / flow runner are orthogonal chrome; stubbing them keeps this
// file about the api dispatch (same posture as the modal-dispatch tests).
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

// Capture BOTH the handler set and the context each <ActionProvider> receives
// while KEEPING the real provider. The record page's own provider is the only
// one whose CONTEXT carries this page's record — the discriminator used to be
// "the only handler set carrying `approval`", which objectui#3055 retired when
// the record page stopped registering a bespoke approval handler (decisions are
// ordinary declared `type:'api'` actions now). The context capture also lets
// the mount wait until the handlers were built AGAINST THE LOADED RECORD
// (apiHandler closes over `pageRecord`, so grabbing an earlier capture would
// test the null-record closure instead).
const captured: Array<{ handlers: Record<string, (action: any) => Promise<any>>; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ handlers: props.handlers, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'os_production_plan';
const RECORD_ID = 'rec-plan-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Production Plan',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Plan A' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
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

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
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

/** The record page's OWN provider capture, built against the LOADED record. */
function recordPageCapture() {
  return [...captured]
    .reverse()
    .find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

/** Render the view and hand back its ActionProvider handlers, spies cleared. */
async function mountAndCaptureHandlers() {
  renderDetail();
  await waitFor(() => expect(recordPageCapture()).toBeTruthy());
  const handlers = recordPageCapture()!.handlers;
  // Anything the mount itself fetched is not the dispatch under test.
  authFetchSpy.mockClear();
  return handlers;
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockClear();
  // Unrelated chrome on this view (approvals, favourites, …) reaches for the
  // platform API; in jsdom that is a real socket. Answer it locally so the
  // only asynchrony left is the record load the capture waits on.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecordDetailView api handler — `{field}` target interpolation (objectui#3391)", () => {
  it('interpolates {id} from the page record when no _rowRecord is stashed', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'copy_plan_row',
        type: 'api',
        method: 'PATCH',
        target: `/api/v1/data/${OBJECT_NAME}/{id}`,
        params: { copy_ovr_start: '2026-01-01' },
        bodyExtra: { copy_now: true },
      });
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(`/api/v1/data/${OBJECT_NAME}/${RECORD_ID}`)).toBe(true);
    expect(url).not.toContain('{');
    expect(url).not.toContain('%7B');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({
      copy_ovr_start: '2026-01-01',
      copy_now: true,
    });
    expect(r.success).toBe(true);
  });

  it('lets a stashed _rowRecord win over the page record and strips it from the body', async () => {
    const handlers = await mountAndCaptureHandlers();

    await act(async () => {
      await handlers.api({
        name: 'child_action',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/{id}`,
        params: { _rowRecord: { id: 'child-9' }, note: 'n' },
      });
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(`/api/v1/data/${OBJECT_NAME}/child-9`)).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ note: 'n' });
    expect(body).not.toHaveProperty('_rowRecord');
  });

  it('never interpolates a retargeted action from the parent page record', async () => {
    const handlers = await mountAndCaptureHandlers();

    await act(async () => {
      await handlers.api({
        name: 'child_only',
        type: 'api',
        method: 'POST',
        objectName: 'other_object',
        target: '/api/v1/data/other_object/{id}',
      });
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // The parent record's id must NOT be substituted into a child target —
    // the literal token going out (and the server 4xx) is the correct
    // fail-loud outcome for a dispatch that lost its row.
    expect(url).toContain('{id}');
    expect(url).not.toContain(RECORD_ID);
  });

  it('strips the _rowRecord stash from the flow trigger body', async () => {
    const handlers = await mountAndCaptureHandlers();

    await act(async () => {
      await handlers.flow({
        name: 'copy_plan_flow',
        type: 'flow',
        target: 'copy_plan_flow',
        params: { _rowRecord: { id: 'r1' }, comment: 'hi' },
      });
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/automation/copy_plan_flow/trigger');
    const body = JSON.parse(String(init.body));
    expect(body.params).toEqual({ comment: 'hi' });
    expect(body.recordId).toBe(RECORD_ID);
    expect(body.objectName).toBe(OBJECT_NAME);
  });
});
