/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView's `type:'api'` handler seeds `recordIdParam` via the
 * shared `resolveRecordIdParamSeed` helper (objectstack#8018, objectui#4669).
 *
 * The read used to be `if (rowValue != null) body[param] = rowValue;` with a
 * silent `else` — a row (or, on this call site, the fallback chain below)
 * that could not supply the key sent the request anyway, minus the
 * parameter naming the record. A backend reading a missing selector as
 * "match nothing" then answers success for having changed nothing.
 *
 * This call site has two sources `resolveRecordIdParamSeed` alone does not
 * know about, on top of the row: a literal `recordId` override, and the
 * `pageRecord` fallback `record_header` actions rely on when no row is
 * stashed (same fallback `interpolationRecord` above uses for `{field}` URL
 * tokens). Both are preserved — the tests below pin that, alongside the two
 * refusal wordings and the happy path — so adopting the helper here did not
 * quietly narrow the sources this call site already read from.
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
// file about the api dispatch (same posture as the modal-dispatch and
// header-interpolation tests it borrows its harness from).
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
// while KEEPING the real provider — same discriminator as the header
// interpolation tests: the record page's own provider is the only one whose
// context carries this page's record, and the mount waits for handlers built
// against the LOADED record (apiHandler closes over `pageRecord`).
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
      code: { type: 'text', label: 'Code' },
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

describe('RecordDetailView api handler — recordIdParam seeding refuses instead of under-specifying (objectstack#8018)', () => {
  it('refuses when the row lacks the recordIdField key entirely', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'link_code',
        label: 'Link by Code',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/link`,
        recordIdParam: 'targetCode',
        recordIdField: 'code',
        params: { _rowRecord: { id: 'row-1', name: 'Row' } },
      });
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain('Link by Code');
    expect(r.error).toContain('code');
    // The point of the whole card: no under-specified request goes out.
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when the key is present but null — a different repair, worded differently', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      // `objectName` retargets away from the page's own object, which — same
      // guard as `interpolationRecord` above — disables the page-record
      // fallback. That isolates the row's `null` as the value actually
      // inspected, instead of falling through to a page record that lacks
      // the key entirely (a *different*, and separately covered, refusal).
      r = await handlers.api({
        name: 'link_code',
        label: 'Link by Code',
        type: 'api',
        method: 'POST',
        objectName: 'other_object',
        target: '/api/v1/data/other_object/link',
        recordIdParam: 'targetCode',
        recordIdField: 'code',
        params: { _rowRecord: { id: 'row-1', code: null } },
      });
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain('this record has no value');
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('injects the value and dispatches when the row supplies it', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'link_code',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/link`,
        recordIdParam: 'targetCode',
        recordIdField: 'code',
        params: { _rowRecord: { id: 'row-1', code: 'INV-1' } },
      });
    });

    expect(r.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ targetCode: 'INV-1' });
  });

  it('falls back to the page record when no row is stashed (record_header actions)', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      // A record_header-style action: no `_rowRecord` stash, so the only
      // source is the page's own loaded record — the fallback
      // `interpolationRecord` above also relies on. `recordIdField`
      // defaults to `id`.
      r = await handlers.api({
        name: 'archive_plan',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/archive`,
        recordIdParam: 'planId',
      });
    });

    expect(r.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ planId: RECORD_ID });
  });

  it('honors a literal `recordId` override ahead of the page-record fallback', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'archive_plan',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/archive`,
        recordIdParam: 'planId',
        // Not a declared ActionDef field — the pre-existing escape hatch
        // this call site read via `(action as any).recordId`.
        recordId: 'explicit-plan-9',
      } as any);
    });

    expect(r.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ planId: 'explicit-plan-9' });
  });

  it('leaves an action declaring no recordIdParam completely alone', async () => {
    const handlers = await mountAndCaptureHandlers();

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'ping',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/ping`,
      });
    });

    expect(r.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
  });
});
