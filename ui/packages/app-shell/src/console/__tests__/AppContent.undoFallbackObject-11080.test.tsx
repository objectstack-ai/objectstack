// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11080 — an unlabelled undoable action's Ctrl+Z / Ctrl+Shift+Z toast
 * names the object, with no English verb.
 *
 * The operation an undoable update leaves on the stack is described by the
 * action's `label`, or, when the action declared none, by the object it acted
 * on. That fallback used to be `Undo <object>`: it doubled the toast's own
 * verb on undo (`撤销：Undo crm_call`) and was wrong on redo
 * (`重做：Undo crm_call`). `AppContent` now says Undo / Redo from a pack key
 * (`actions.undoneOperation` / `actions.redoneOperation`, pinned for a labelled
 * action in `AppContent.undoRedoToast-11080`), so each of the three places that
 * build the operation writes only the object.
 *
 * Harness: the operation is produced by each REAL producer, the way a user's
 * click produces it, and left on the real `globalUndoManager` by the real
 * runner. Then the real `AppContent` (routing reduced to the zero-app empty
 * state, as in `AppContent.undoRedoToast-11080`) under a real `I18nProvider`
 * has the real keyboard shortcut pressed on `window`, and the toast text that
 * follows is asserted.
 *
 * - the runner: `@object-ui/core`'s `ActionRunner` running an `update`
 *   operation;
 * - the console runtime: the `api` handler `useConsoleActionRuntime` returns,
 *   registered on a real `ActionRunner`;
 * - the record page: the `api` handler `RecordDetailView` registers, reached
 *   through the probe of `RecordDetailView.undoCapture-11082`.
 *
 * The en run is the control, and a labelled action pins that the label still
 * reaches each producer's description and the toast unchanged.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', image: null },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

// The adapter is the `dataSource` `useGlobalUndo` writes the undo / redo
// through; `update` is the write an `update` operation makes.
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: [],
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: async () => {},
  }),
}));

// Orthogonal: the signed-in user's language column. Stubbed so nothing but the
// provider's configured language decides which pack renders.
vi.mock('../../hooks/useUserLocale', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSignedInUserLocale: () => {},
}));

// Orthogonal chrome the record page and the console runtime mount — the same
// posture as `RecordDetailView.undoCapture-11082`.
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('../../views/MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('../../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

type ProviderProps = React.ComponentProps<typeof import('@object-ui/react').ActionProvider>;
type Execute = (action: import('@object-ui/core').ActionDef) => Promise<import('@object-ui/core').ActionResult>;

/**
 * Every `<ActionProvider>` rendered, with the `execute` of the real provider it
 * renders (a probe child reads it through `useAction`, the provider's own
 * consumer hook). `AppContent` itself reads `useActionRunner`, which stays a
 * stub: no action runs through the console shell in this file.
 */
const captured: Array<{ context: ProviderProps['context']; handlers: ProviderProps['handlers']; execute: Execute }> = [];
const shellRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  const Probe = ({ onExecute }: { onExecute: (execute: Execute) => void }) => {
    onExecute(actual.useAction().execute);
    return null;
  };
  return {
    ...actual,
    ActionProvider: (props: ProviderProps) =>
      React.createElement(
        actual.ActionProvider,
        props,
        React.createElement(Probe, {
          onExecute: (execute: Execute) => {
            captured.push({ context: props.context, handlers: props.handlers, execute });
          },
        }),
        props.children,
      ),
    SchemaRenderer: () => null,
    useActionRunner: () => ({ execute: vi.fn(), runner: shellRunnerStub }),
    useMutationInvalidationBridge: () => {},
  };
});

/** One global `fetch` double, never torn down (see RecordDetailView.undoneToast-11056). */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
);

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { ActionRunner, globalUndoManager, type ActionDef, type UndoableOperation } from '@object-ui/core';
import { MetadataCtx } from '@object-ui/react';
import { AppContent } from '../AppContent';
import { RecordDetailView } from '../../views/RecordDetailView';
import { useConsoleActionRuntime } from '../../hooks/useConsoleActionRuntime';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';
const ROW = { id: RECORD_ID, name: 'Intro call', status: 'open' };

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
    },
  },
];

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
} as never;

/** An undoable action writing `status`; `label` is what the case varies. */
function completeCall(label: string | undefined): ActionDef {
  return {
    type: 'api',
    name: 'complete_call',
    ...(label === undefined ? {} : { label }),
    target: 'complete_call',
    undoable: true,
    bodyExtra: { status: 'done' },
    // The console runtime and the runner read the row a list action ran on
    // from here; the record page reads its own loaded record instead.
    params: { _rowRecord: { ...ROW } },
  } as ActionDef;
}

/** What a producer left behind: the operation's description, and that it is on the stack. */
type Produced = { description: string | undefined; onStack: UndoableOperation | undefined };

const produced = (result: { undo?: UndoableOperation }): Produced => ({
  description: result.undo?.description,
  onStack: globalUndoManager.peekUndo(),
});

/** The runner: `@object-ui/core`'s own `update` operation, dispatched to a stub. */
async function runViaRunner(label: string | undefined): Promise<Produced> {
  const runner = new ActionRunner({ objectName: OBJECT_NAME });
  // The runner registers an undoable result on the stack from its success toast.
  runner.setToastHandler(() => {});
  runner.registerHandler('script', vi.fn(async () => ({ success: true })));
  const result = await runner.execute({
    ...completeCall(label),
    type: 'script',
    operation: 'update',
    patch: { status: 'done' },
  } as ActionDef);
  return produced(result);
}

/** The console runtime: the `api` handler `useConsoleActionRuntime` returns, on a real runner. */
async function runViaConsoleRuntime(label: string | undefined): Promise<Produced> {
  const dataSource = { update: vi.fn(async () => ({})) };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter>{children}</MemoryRouter>
    </I18nProvider>
  );
  const hook = renderHook(
    () => useConsoleActionRuntime({ dataSource, objects: OBJECTS, objectName: OBJECT_NAME }),
    { wrapper },
  );
  const runner = new ActionRunner({ objectName: OBJECT_NAME });
  runner.setToastHandler(() => {});
  runner.registerHandler('api', hook.result.current.apiHandler);
  let result: Awaited<ReturnType<ActionRunner['execute']>> = { success: false };
  await act(async () => { result = await runner.execute(completeCall(label)); });
  expect(dataSource.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { status: 'done' });
  // Nothing of the hook may stay mounted: it owns a keyboard listener of its own.
  hook.unmount();
  return produced(result);
}

/** The record page: the `api` handler `RecordDetailView` registers, on the page's own runner. */
async function runViaRecordPage(label: string | undefined): Promise<Produced> {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ ...ROW })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
        <MetadataCtx.Provider value={METADATA}>
          <RecordDetailView
            dataSource={dataSource}
            objects={OBJECTS}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  // The view's own provider (it registers the `api` handler) once the page
  // record has loaded into its context.
  const pick = () =>
    [...captured]
      .reverse()
      .find((c) => c.handlers?.api && (c.context?.record as { id?: unknown } | undefined)?.id === RECORD_ID)
      ?.execute;
  await waitFor(() => expect(pick()).toBeTruthy());

  let result: Awaited<ReturnType<Execute>> = { success: false };
  // The page runs the action with the toast handler its provider carries, so
  // the real runner registers the undoable result on the stack.
  await act(async () => { result = await pick()!(completeCall(label)); });
  expect(dataSource.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { status: 'done' });
  // The page owns a keyboard listener of its own; only the console's may stay.
  cleanup();
  return produced(result);
}

const PRODUCERS: Array<{ name: string; run: (label: string | undefined) => Promise<Produced> }> = [
  { name: 'ActionRunner (core)', run: runViaRunner },
  { name: 'the console runtime api handler', run: runViaConsoleRuntime },
  { name: 'the record page api handler', run: runViaRecordPage },
];

function renderConsole(config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/setup']}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const pressUndo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
const pressRedo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
const infoMessages = () => vi.mocked(toast.info).mock.calls.map(([message]) => message);

/** Ctrl+Z then Ctrl+Shift+Z on a mounted console, once each toast has been raised. */
async function pressUndoThenRedo() {
  pressUndo();
  await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
  pressRedo();
  await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalUndoManager.clear();
  captured.length = 0;
});
afterEach(() => {
  cleanup();
  globalUndoManager.clear();
});

describe.each(PRODUCERS)('$name — an unlabelled undoable action is named by its object in the undo / redo toasts (objectui#11080)', ({ run }) => {
  it.each([
    ['declared no label', undefined],
    ['declared an empty label', ''],
  ])('zh: an action that %s reads 撤销：OBJECT and 重做：OBJECT, with no English verb', async (_case, label) => {
    const op = await run(label);

    renderConsole(ZH);
    await screen.findByTestId('create-first-app-btn');
    await pressUndoThenRedo();

    expect(infoMessages()).toEqual([`撤销：${OBJECT_NAME}`, `重做：${OBJECT_NAME}`]);
    // The undo really ran through the adapter before its toast was raised.
    expect(dataSourceStub.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { status: 'open' });
    // And the producer's own description, which the toast interpolated.
    expect(op.description).toBe(OBJECT_NAME);
    expect(op.onStack?.description).toBe(OBJECT_NAME);
  });

  it('en control: the same action reads Undo: OBJECT and Redo: OBJECT, the verb said once', async () => {
    await run(undefined);

    renderConsole(EN);
    await screen.findByTestId('create-first-app-btn');
    await pressUndoThenRedo();

    expect(infoMessages()).toEqual([`Undo: ${OBJECT_NAME}`, `Redo: ${OBJECT_NAME}`]);
  });

  it('control: an authored label is the description and reaches both zh toasts byte for byte', async () => {
    const label = '标记为完成 & notify "owner"';
    const op = await run(label);

    renderConsole(ZH);
    await screen.findByTestId('create-first-app-btn');
    await pressUndoThenRedo();

    expect(infoMessages()).toEqual([`撤销：${label}`, `重做：${label}`]);
    expect(op.description).toBe(label);
  });
});
