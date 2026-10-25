/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView — `type: 'modal'` dispatch is CLIENT-SIDE ONLY
 * (objectstack#3959 / objectui#3320).
 *
 * The record page wires its own `modal` handler into its `<ActionProvider>`,
 * shadowing the shared console runtime for every action on the record surface.
 * objectstack#3959 removed the "fall back to the server-side handler" branch
 * from `useConsoleActionRuntime.modalActionHandler` — the framework's
 * `headlessActionTypeError` rejects `type: 'modal'` over REST with a 400, so
 * the fallthrough could never succeed and only converted an authoring mistake
 * (a target naming no page) into a confusing round-trip. This copy kept the
 * pre-#3959 shape, so the SAME dud modal action reported a descriptive
 * authoring error on a list page and an opaque 400 on the record page.
 *
 * This file is the RecordDetailView-side counterpart of
 * `useConsoleActionRuntime.test.tsx`'s "reports an unresolvable target instead
 * of POSTing to /actions": it exercises the handler set the view REALLY hands
 * to its ActionProvider (captured via a pass-through wrapper), so re-adding the
 * fallthrough — `return serverActionHandler(action)` — turns it red.
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
// file about the modal dispatch (same posture as the feed-signal tests).
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

// The client modal transport is stubbed for the same reason as in
// useConsoleActionRuntime.test.tsx — importing it for real drags in
// <ModalForm> and the whole plugin-form graph. `resolveTargetSpy` stands in
// for the page/object lookup so each case below chooses whether the target
// resolves; its real resolution rules are covered in
// useActionModal.resolve.test.tsx.
const modalHandlerSpy = vi.fn(async () => ({ success: true }));
const resolveTargetSpy = vi.fn(async (_schema: any): Promise<any> => null);
vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: modalHandlerSpy,
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: resolveTargetSpy,
  }),
}));

// The server-side dispatch the dead fallthrough used to reach. Returns
// success so a re-added `return serverActionHandler(action)` flips BOTH the
// not-called assertion AND the `success: false` assertion below.
const serverActionSpy = vi.fn(async () => ({ success: true }));
vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => serverActionSpy,
}));

// Capture the handler set each <ActionProvider> receives while KEEPING the
// real provider (children still get a working action context). The record
// page's own provider is the only one whose CONTEXT carries this page's
// record, so the capture below selects it even if a nested surface mounts a
// provider of its own (the approval decision bar mounts one — objectui#3055,
// which is also why the old "the only set carrying `approval`" discriminator
// is gone: the record page no longer registers a bespoke approval handler).
// The page body itself is orthogonal here — SchemaRenderer is stubbed so the
// file stays about the wiring, not the render tree.
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
import { modalTargetRefusalMessage } from '../utils/modalTargetDiagnostics';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
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

/** The record page's OWN handler set — the only provider given this record. */
function recordPageHandlers() {
  return [...captured]
    .reverse()
    .find((c) => c.handlers && c.context?.record?.id === RECORD_ID)?.handlers;
}

/** Render the view and hand back its ActionProvider handlers, spies cleared. */
async function mountAndCaptureHandlers() {
  renderDetail();
  await waitFor(() => expect(recordPageHandlers()).toBeTruthy());
  const handlers = recordPageHandlers()!;
  // Anything the mount itself fetched is not the dispatch under test.
  authFetchSpy.mockClear();
  serverActionSpy.mockClear();
  resolveTargetSpy.mockClear();
  modalHandlerSpy.mockClear();
  return handlers;
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockClear();
  serverActionSpy.mockClear();
  modalHandlerSpy.mockClear();
  resolveTargetSpy.mockReset();
  resolveTargetSpy.mockResolvedValue(null);
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

describe("RecordDetailView modal dispatch — CLIENT-SIDE ONLY (objectstack#3959 / objectui#3320)", () => {
  it('opens the resolved target client-side and never POSTs to /actions', async () => {
    const handlers = await mountAndCaptureHandlers();
    resolveTargetSpy.mockResolvedValue({ content: { name: 'log_call', type: 'utility' } });

    let r: any;
    await act(async () => {
      r = await handlers.modal({ name: 'log_call', type: 'modal', target: 'log_call' });
    });

    expect(resolveTargetSpy).toHaveBeenCalledWith('log_call');
    expect(modalHandlerSpy).toHaveBeenCalledWith({ content: { name: 'log_call', type: 'utility' } });
    expect(serverActionSpy).not.toHaveBeenCalled();
    expect(authFetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true });
  });

  // The RecordDetailView-side counterpart of useConsoleActionRuntime.test.tsx's
  // case of the same name. Until objectui#3320 this handler fell back to
  // `serverActionHandler(action)`, POSTing the modal to /actions — which the
  // framework rejects with a 400 (headlessActionTypeError) — while the shared
  // runtime already reported the authoring error (objectstack#3959).
  it('reports an unresolvable target instead of POSTing to /actions', async () => {
    const handlers = await mountAndCaptureHandlers();
    resolveTargetSpy.mockResolvedValue(null);

    let r: any;
    await act(async () => {
      r = await handlers.modal({
        name: 'log_call', type: 'modal', target: 'log_call', params: { subject: 'Intro' },
      });
    });

    expect(modalHandlerSpy).not.toHaveBeenCalled();
    expect(serverActionSpy).not.toHaveBeenCalled();
    expect(authFetchSpy).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    // The message must name the action, the dud target, and the way out —
    // the same copy the shared runtime reports, so the two surfaces cannot
    // drift apart silently again.
    expect(String(r.error)).toContain('log_call');
    expect(String(r.error)).toMatch(/`type: 'script'` with `params`/);
    // objectui#4767 — "cannot drift apart silently again" was aspirational
    // until now: the two copies were hand-written, and PR #4764's object-
    // fallback retirement reached only `useActionModal`'s. This one kept
    // "names no page or object" and never named `type: 'form'`, the validated
    // way to open an object's form. Same constructor, byte for byte.
    expect(String(r.error)).toContain("type: 'form'");
    expect(String(r.error)).not.toMatch(/or object/);
    expect(String(r.error)).toBe(
      modalTargetRefusalMessage({ actionName: 'log_call', target: 'log_call', serverHandlerHint: true }),
    );
  });
});
