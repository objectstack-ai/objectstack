/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11122 — on the record page, Undo of an update that wrote a lookup
 * restores the id the lookup stored, never the related record `$expand` put in
 * its place.
 *
 * The page reads its record with `$expand` on every relation the reader may
 * read, and the server replaces each id in place with the related record. The
 * Undo snapshot copied that record, so Undo wrote `{ id: 'a1', name: 'Acme' }`
 * into a reference slot that stores `'a1'`: the card's probe, reproduced here
 * as the first case. A `json` field holding an object with an `id` is that
 * object, and Undo restores it unchanged.
 *
 * Two writers share the page's provider and both are driven: the page's own
 * `api` handler, and the runner's `operation: 'update'` path, which reads the
 * object's field definitions from the `objectFields` the page publishes beside
 * `objectName`.
 *
 * Harness: `RecordDetailView.undoCapture-11082`'s, unchanged — the real view,
 * a probe inside its own `<ActionProvider>` handing back `execute`, and Undo
 * run by pressing the success toast's button, which calls the real
 * `useGlobalUndo`; its `dataSource.update` call is what Undo writes.
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

const OBJECT_NAME = 'crm_opportunity';
const RECORD_ID = 'o1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Opportunity',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
      config: { type: 'json', label: 'Config' },
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
const MESSAGE = 'Opportunity updated';

/**
 * What `findOne` answers for the `$expand`-ed read, the way objectql's
 * `expandRelatedRecords` shapes it: `account` stores `'a1'` and arrives as
 * the account record.
 */
const EXPANDED_RECORD = {
  id: RECORD_ID,
  name: 'Deal',
  account: { id: 'a1', name: 'Acme' },
  config: { id: 'cfg1', mode: 'strict' },
};

/** The page's own `api` handler: an undoable write of `bodyExtra`. */
function apiUpdate(bodyExtra: Record<string, unknown>): ActionDef {
  return {
    type: 'api',
    name: 'reassign_account',
    label: 'Reassign',
    target: 'reassign_account',
    undoable: true,
    successMessage: MESSAGE,
    bodyExtra,
  } as ActionDef;
}

/** The runner's own path: an undoable `operation: 'update'` on the page record. */
function operationUpdate(patch: Record<string, unknown>, row: Record<string, unknown>): ActionDef {
  return {
    type: 'script',
    name: 'set_account',
    label: 'Set account',
    operation: 'update',
    undoable: true,
    successMessage: MESSAGE,
    patch,
    params: { _rowRecord: row },
  } as ActionDef;
}

/**
 * Mount the page on `record`, run `action` through the page's own runner, and
 * hand back the success toast's Undo button.
 */
async function runOnRecordPage(record: Record<string, unknown>, action: (loaded: Record<string, unknown>) => ActionDef) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => structuredClone(record)),
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
      .find((c) => c.handlers?.api && (c.context?.record as { id?: unknown } | undefined)?.id === RECORD_ID);
  await waitFor(() => expect(pick()).toBeTruthy());
  const provider = pick()!;

  let result: Awaited<ReturnType<Execute>> = { success: false };
  await act(async () => {
    result = await provider.execute(action(provider.context!.record as Record<string, unknown>));
  });
  expect(result.success).toBe(true);

  const call = vi.mocked(toast.success).mock.calls.find(([message]) => message === MESSAGE);
  expect(call).toBeTruthy();
  const options = call![1] as { action?: { label: string; onClick: () => void } } | undefined;
  expect(options?.action).toBeDefined();
  const undo = async () => {
    await act(async () => { options!.action!.onClick(); });
  };
  return { dataSource, result, context: provider.context, undo };
}

afterEach(() => {
  cleanup();
  captured.length = 0;
  vi.mocked(toast.success).mockClear();
  globalUndoManager.clear();
});

describe('record page — Undo of a lookup update restores the stored id (objectui#11122)', () => {
  it('the page\'s `api` handler: Undo writes `\'a1\'` back, not the expanded account', async () => {
    const { dataSource, result, undo } = await runOnRecordPage(EXPANDED_RECORD, () => apiUpdate({ account: 'a2' }));

    // The record was read expanded because the page asked for it.
    expect(dataSource.findOne).toHaveBeenCalledWith(
      OBJECT_NAME, RECORD_ID, { $expand: expect.arrayContaining(['account']) },
    );
    expect(dataSource.update).toHaveBeenCalledWith(OBJECT_NAME, RECORD_ID, { account: 'a2' });
    expect(result.undo?.undoData).toEqual({ account: 'a1' });

    await undo();
    // Before the fix: `{ account: { id: 'a1', name: 'Acme' } }`.
    await waitFor(() =>
      expect(dataSource.update).toHaveBeenLastCalledWith(OBJECT_NAME, RECORD_ID, { account: 'a1' }),
    );
  });

  it('the page\'s `api` handler: a `json` field holding `{ id, … }` is restored unchanged', async () => {
    const { dataSource, undo } = await runOnRecordPage(EXPANDED_RECORD, () => apiUpdate({ config: { id: 'cfg2' } }));

    await undo();
    await waitFor(() =>
      expect(dataSource.update).toHaveBeenLastCalledWith(OBJECT_NAME, RECORD_ID, { config: { id: 'cfg1', mode: 'strict' } }),
    );
  });

  it('the runner\'s `operation: \'update\'`: the page publishes its field definitions, and Undo writes `\'a1\'` back', async () => {
    const { dataSource, result, context, undo } = await runOnRecordPage(
      EXPANDED_RECORD,
      (loaded) => operationUpdate({ account: 'a2', config: { id: 'cfg2' } }, loaded),
    );

    expect(context?.objectName).toBe(OBJECT_NAME);
    expect(context?.objectFields).toBe(OBJECTS[0].fields);
    expect(result.undo?.undoData).toEqual({ account: 'a1', config: { id: 'cfg1', mode: 'strict' } });

    await undo();
    await waitFor(() =>
      expect(dataSource.update).toHaveBeenLastCalledWith(
        OBJECT_NAME, RECORD_ID, { account: 'a1', config: { id: 'cfg1', mode: 'strict' } },
      ),
    );
  });
});
