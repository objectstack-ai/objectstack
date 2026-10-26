/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11056 — the record page's undo confirmation toast reads the
 * session's language.
 *
 * `RecordDetailView` builds its own action runtime rather than consuming
 * `useConsoleActionRuntime`, and so its own `useGlobalUndo` `onUndo`. That one
 * raised a hard-coded English "Change undone" toast after the (localised)
 * Undo button was pressed, just as the shared runtime's did. It now reads
 * `actions.undone` through the translator this view already holds; the shared
 * runtime's half is pinned in `useConsoleActionRuntime.undoneToast-11056`.
 *
 * Harness: the real view under a real `I18nProvider`. The toast handler is the
 * `onToast` of the provider whose context carries THIS record (the harness of
 * `RecordDetailView.confirmRuntimeParity-5835`), which is the only handle a
 * caller gets on it. It is handed an undoable success toast the way the runner
 * hands one; the toast's Undo button is then pressed, the real `useGlobalUndo`
 * writes the prior value back, and the toast that follows is what is asserted.
 * The en run is the control.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
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

// Orthogonal chrome — same posture as RecordDetailView.confirmRuntimeParity-5835.
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

/** Capture every `<ActionProvider>`'s props while keeping the real provider. */
const captured: Array<Pick<ProviderProps, 'onToast' | 'context'>> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: ProviderProps) => {
      captured.push({ onToast: props.onToast, context: props.context });
      return React.createElement(actual.ActionProvider, props);
    },
    SchemaRenderer: () => null,
  };
});

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { globalUndoManager } from '@object-ui/core';
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

/**
 * The view's side panels read over the global `fetch`, and the Undo's
 * `notifyDataChanged` sets off refetches no barrier awaits. ONE double at
 * module scope, never torn down, so no test can end with the real `fetch`
 * back in place (the network-escape guard's worked example,
 * `RecordDetailView.approvalDeclaredActions`).
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
);

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

const successToasts = () => vi.mocked(toast.success).mock.calls;

/** Mount the view, raise an undoable success toast on it, press its Undo button. */
async function undoOnRecordPage(config: typeof ZH | typeof EN, undoLabel: string) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call', status: 'done' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <I18nProvider config={config} persistLanguage={false}>
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
  const pick = () =>
    [...captured]
      .reverse()
      .find((c) => c.onToast && (c.context?.record as { id?: unknown } | undefined)?.id === RECORD_ID)
      ?.onToast;
  await waitFor(() => expect(pick()).toBeTruthy());

  // What the runner does for an undoable success: push the operation, then
  // hand the toast handler its message and the Undo label.
  globalUndoManager.push({
    id: `undo-${OBJECT_NAME}-${RECORD_ID}`,
    type: 'update',
    objectName: OBJECT_NAME,
    recordId: RECORD_ID,
    timestamp: 0,
    description: 'Complete',
    undoData: { status: 'open' },
    redoData: { status: 'done' },
  });
  await act(async () => { pick()!('Completed', { type: 'success', undo: { label: undoLabel } }); });

  const [, options] = successToasts().find(([message]) => message === 'Completed')!;
  const undoButton = (options as { action: { label: string; onClick: () => void } }).action;
  expect(undoButton.label).toBe(undoLabel);

  await act(async () => { undoButton.onClick(); });
  // The Undo wrote the prior value back — the toast below follows it.
  await waitFor(() =>
    expect(dataSource.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { status: 'open' }),
  );
}

afterEach(() => {
  cleanup();
  captured.length = 0;
  vi.mocked(toast.success).mockClear();
  globalUndoManager.clear();
});

describe('RecordDetailView — the undo confirmation toast (objectui#11056)', () => {
  it('zh: pressing the Chinese Undo button raises a Chinese confirmation', async () => {
    await undoOnRecordPage(ZH, '撤销');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已撤销更改'));
    expect(toast.success).not.toHaveBeenCalledWith('Change undone');
  });

  it('en: the confirmation is unchanged English', async () => {
    await undoOnRecordPage(EN, 'Undo');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Change undone'));
  });
});
