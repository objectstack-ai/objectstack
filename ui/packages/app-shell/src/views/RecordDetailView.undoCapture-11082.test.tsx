/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11082 — the record page's own `api` handler never captures a field
 * the page record does not carry as `null` in its Undo snapshot.
 *
 * `RecordDetailView` builds its own action runtime, and its `api` handler's
 * undoable single-record update read each written field's prior value off the
 * loaded page record as `pageRecord[k] ?? null`: the shape objectui#10404
 * removed from `ActionRunner` and `useConsoleActionRuntime`. The page record is
 * read with no column list, but ObjectStack's `FieldMasker` deletes every field
 * the reader may not read, so an action writing such a field found it absent,
 * captured `null`, and Undo wrote `null` over the stored value. The handler now
 * calls `@object-ui/core`'s `captureUpdateUndoData`, the one capture rule.
 *
 * Harness: the real view (the harness of `RecordDetailView.undoneToast-11056`),
 * with a probe inside the view's own `<ActionProvider>` that hands back its
 * `execute`, so an action runs through the real runner, the view's registered
 * `api` handler and the view's toast handler. The Undo affordance is the
 * success toast's action button; pressing it runs the real `useGlobalUndo`,
 * whose `dataSource.update` call is what Undo writes.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
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

// Orthogonal chrome — same posture as RecordDetailView.undoneToast-11056.
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

type ProviderProps = React.ComponentProps<typeof import('@object-ui/react').ActionProvider>;
type Execute = (action: import('@object-ui/core').ActionDef) => Promise<import('@object-ui/core').ActionResult>;

/**
 * Every `<ActionProvider>` rendered, with the `execute` of the real provider
 * it renders. A probe child reads it through `useAction`, the provider's own
 * consumer hook.
 */
const captured: Array<{ context: ProviderProps['context']; handlers: ProviderProps['handlers']; execute: Execute }> = [];
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
  };
});

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { globalUndoManager, type ActionDef } from '@object-ui/core';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
      outcome: { type: 'text', label: 'Outcome' },
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

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const MESSAGE = 'Call completed';

/** The record page's undoable action: it writes `status` (and, where given, more). */
function completeCall(bodyExtra: Record<string, unknown> = { status: 'done' }): ActionDef {
  return {
    type: 'api',
    name: 'complete_call',
    label: 'Complete',
    target: 'complete_call',
    undoable: true,
    successMessage: MESSAGE,
    bodyExtra,
  } as ActionDef;
}

/**
 * Mount the page on `record` (what `findOne` answers: the server's record with
 * every field the reader may not read already removed), run `action` through
 * the page's own runner, and hand back the success toast's options.
 */
async function runOnRecordPage(record: Record<string, unknown>, action: ActionDef) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ ...record })),
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
  await act(async () => { result = await pick()!(action); });
  expect(result.success).toBe(true);

  const call = vi.mocked(toast.success).mock.calls.find(([message]) => message === MESSAGE);
  expect(call).toBeTruthy();
  const options = call![1] as { action?: { label: string; onClick: () => void } } | undefined;
  return { dataSource, result, undoButton: options?.action };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  captured.length = 0;
  vi.mocked(toast.success).mockClear();
  globalUndoManager.clear();
  warn.mockRestore();
});

describe('RecordDetailView `api` handler — the Undo snapshot never records an uncarried field as `null` (objectui#11082)', () => {
  it('a written field the page record does not carry gives no Undo button, and the write still happens', async () => {
    // The field-level-security case: `status` is readable to nobody here, so
    // the server removed it from the record the page loaded.
    const { dataSource, result, undoButton } = await runOnRecordPage(
      { id: RECORD_ID, name: 'Intro call' },
      completeCall(),
    );

    expect(dataSource.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { status: 'done' });
    expect(result.undo).toBeUndefined();
    expect(undoButton).toBeUndefined();
    expect(globalUndoManager.canUndo).toBe(false);
    // The author is told which field blocked the capture.
    const noUndo = warn.mock.calls.find((args: unknown[]) => String(args[0]).startsWith('[RecordDetailView]'));
    expect(noUndo?.[1]).toEqual({ action: 'complete_call', missing: ['status'] });
  });

  it('no partial Undo: a carried field beside an uncarried one is no Undo at all', async () => {
    const { result, undoButton } = await runOnRecordPage(
      { id: RECORD_ID, name: 'Intro call', status: 'open' },
      completeCall({ status: 'done', outcome: 'booked' }),
    );

    expect(result.undo).toBeUndefined();
    expect(undoButton).toBeUndefined();
  });

  it('a `null` the record carries is restored as `null`', async () => {
    const { dataSource, undoButton } = await runOnRecordPage(
      { id: RECORD_ID, name: 'Intro call', status: null },
      completeCall(),
    );

    expect(undoButton).toBeDefined();
    await act(async () => { undoButton!.onClick(); });
    await waitFor(() =>
      expect(dataSource.update).toHaveBeenLastCalledWith(OBJECT_NAME, RECORD_ID, { status: null }),
    );
  });

  it('a value the record carries is restored as that value', async () => {
    const { dataSource, undoButton } = await runOnRecordPage(
      { id: RECORD_ID, name: 'Intro call', status: 'open' },
      completeCall(),
    );

    expect(undoButton).toBeDefined();
    await act(async () => { undoButton!.onClick(); });
    await waitFor(() =>
      expect(dataSource.update).toHaveBeenLastCalledWith(OBJECT_NAME, RECORD_ID, { status: 'open' }),
    );
  });
});
