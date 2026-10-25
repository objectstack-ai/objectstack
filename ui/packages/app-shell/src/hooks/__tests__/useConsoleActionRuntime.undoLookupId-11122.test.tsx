/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11122 — on a grid row, Undo of an update that wrote a lookup
 * restores the id the lookup stored, never the related record `$expand` put in
 * its place.
 *
 * A grid expands the relations it shows as columns, so its row carries
 * `account: { id: 'a1', name: 'Acme' }` where the server stores `'a1'`. The
 * Undo snapshot copied that record, and Undo wrote it into the reference slot.
 * Both console writers are driven here, on a real `ObjectGrid` row inside the
 * real `ConsoleActionRuntimeProvider` (the host `ObjectView` and
 * `DeclaredActionsBar` mount):
 *
 *  - a `type: 'api'` row action (the shape of objectstack's published
 *    `ReassignLeadAction`: undoable, on `list_item`, writing a lookup), run by
 *    the runtime's own `api` handler, which looks the object's field
 *    definitions up itself;
 *  - an `operation: 'update'` row action, run by `ActionRunner`, which reads
 *    them from the `objectFields` this runtime publishes beside `objectName`.
 *
 * Undo is the success toast's button, which runs the runtime's real
 * `useGlobalUndo`; its `dataSource.update` call is what Undo writes. A `json`
 * field holding an object with an `id` is that object, and is restored
 * unchanged. The handler's other source of field definitions, the console's
 * metadata store, is pinned on the handler directly.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
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

// Imported for real these drag in the modal/form graph; nothing here renders them.
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
// The runtime's `script` dispatch stands in for the platform action route:
// it writes the action's declared `patch` UNDER the params it is sent, as the
// route does (`declarativeUpdateWrite`). The patch is read off the action the
// stub is handed, standing in for the declaration the route resolves by name:
// the request never carries it (objectui#12941).
const routeWrites: Array<Record<string, unknown>> = [];
vi.mock('../../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async (action: {
    params?: Record<string, unknown>;
    patch?: Record<string, unknown>;
  }) => {
    const { _rowRecord: _row, recordId: _id, ...fields } = action.params ?? {};
    routeWrites.push({ ...(action.patch ?? {}), ...fields });
    return { success: true };
  }),
}));

import { toast } from 'sonner';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { registerAllFields } from '@object-ui/fields';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx, SchemaRendererProvider } from '@object-ui/react';
import { globalUndoManager, type ActionDef, type ActionResult } from '@object-ui/core';
import { ConsoleActionRuntimeProvider, useConsoleActionRuntime } from '../useConsoleActionRuntime';

registerAllFields();

const OBJECT = 'crm_opportunity';
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
  config: { type: 'json', label: 'Config' },
};
const OBJECT_DEF = { name: OBJECT, label: 'Opportunity', fields: FIELDS };

/** The stored row: `account` holds the id. */
const STORED = { id: 'o1', name: 'Deal', account: 'a1', config: { id: 'cfg1', mode: 'strict' } };
const ACCOUNTS: Record<string, Record<string, unknown>> = { a1: { id: 'a1', name: 'Acme' } };

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const MESSAGE = 'Opportunity updated';

/**
 * A data source that answers `$expand` the way objectql's
 * `expandRelatedRecords` does: the id is replaced in place by the record.
 */
function makeDataSource() {
  const find = vi.fn(async (_object: string, params?: { $expand?: string[] }) => {
    const row: Record<string, unknown> = structuredClone(STORED);
    if (params?.$expand?.includes('account')) row.account = ACCOUNTS[row.account as string] ?? row.account;
    return { data: [row], total: 1 };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  };
}

/** Run `action` on the grid's one row, and hand back the success toast's Undo button. */
async function runOnGridRow(action: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter>
        <ConsoleActionRuntimeProvider dataSource={dataSource} objects={[OBJECT_DEF]} objectName={OBJECT}>
          <SchemaRendererProvider dataSource={dataSource as never}>
            <ObjectGrid
              schema={{
                type: 'object-grid',
                objectName: OBJECT,
                columns: ['name', 'account'],
                rowActionDefs: [{ locations: ['list_item'], successMessage: MESSAGE, ...action }],
              } as never}
              dataSource={dataSource as never}
            />
          </SchemaRendererProvider>
        </ConsoleActionRuntimeProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('Deal')).toBeInTheDocument());
  await userEvent.click(await screen.findByTestId('row-action-trigger'));
  await userEvent.click(await screen.findByTestId(`row-action-${String(action.name)}`));

  const call = await waitFor(() => {
    const found = vi.mocked(toast.success).mock.calls.find(([message]) => message === MESSAGE);
    expect(found).toBeTruthy();
    return found!;
  });
  const options = call[1] as { action?: { label: string; onClick: () => void } } | undefined;
  expect(options?.action).toBeDefined();
  return {
    dataSource,
    expand: (dataSource.find.mock.calls.at(-1)?.[1] as { $expand?: string[] } | undefined)?.$expand,
    captured: globalUndoManager.peekUndo()?.undoData,
    undo: () => act(async () => { options!.action!.onClick(); }),
  };
}

afterEach(() => {
  cleanup();
  routeWrites.length = 0;
  vi.mocked(toast.success).mockClear();
  globalUndoManager.clear();
});

describe('grid row — Undo of a lookup update restores the stored id (objectui#11122)', () => {
  it('`type: \'api\'` row action: Undo writes `\'a1\'` back, not the expanded account', async () => {
    const run = await runOnGridRow({
      name: 'reassign_account',
      label: 'Reassign',
      type: 'api',
      target: 'reassign_account',
      undoable: true,
      bodyExtra: { account: 'a2' },
    });

    // The row carried the account expanded because the grid shows it.
    expect(run.expand).toEqual(expect.arrayContaining(['account']));
    expect(run.dataSource.update).toHaveBeenCalledWith(OBJECT, 'o1', { account: 'a2' });
    expect(run.captured).toEqual({ account: 'a1' });

    await run.undo();
    // Before the fix: `{ account: { id: 'a1', name: 'Acme' } }`.
    await waitFor(() => expect(run.dataSource.update).toHaveBeenLastCalledWith(OBJECT, 'o1', { account: 'a1' }));
  });

  it('`operation: \'update\'` row action: the runner reads the runtime\'s field definitions, and Undo writes `\'a1\'` back', async () => {
    const run = await runOnGridRow({
      name: 'set_account',
      label: 'Set account',
      type: 'script',
      operation: 'update',
      undoable: true,
      patch: { account: 'a2' },
    });

    expect(routeWrites).toEqual([{ account: 'a2' }]);
    expect(run.captured).toEqual({ account: 'a1' });

    await run.undo();
    await waitFor(() => expect(run.dataSource.update).toHaveBeenLastCalledWith(OBJECT, 'o1', { account: 'a1' }));
  });

  it('a `json` field holding `{ id, … }` is restored unchanged', async () => {
    const run = await runOnGridRow({
      name: 'reset_config',
      label: 'Reset config',
      type: 'api',
      target: 'reset_config',
      undoable: true,
      bodyExtra: { config: { id: 'cfg2' } },
    });

    await run.undo();
    await waitFor(() =>
      expect(run.dataSource.update).toHaveBeenLastCalledWith(OBJECT, 'o1', { config: { id: 'cfg1', mode: 'strict' } }),
    );
  });
});

describe('console runtime — where the field definitions come from (objectui#11122)', () => {
  const EXPANDED_ROW = { id: 'o1', name: 'Deal', account: { id: 'a1', name: 'Acme' } };

  async function reassign(options: { objects?: unknown[]; objectName?: string; metadataObjects?: unknown[] }) {
    const dataSource = { update: vi.fn(async () => ({})) };
    const ensureType = vi.fn(async () => []);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter>
        <MetadataCtx.Provider
          value={{
            apps: [], objects: options.metadataObjects ?? [], dashboards: [], reports: [], pages: [],
            loading: false, error: null, refresh: async () => {}, invalidate: () => {},
            ensureType, getItem: async () => null, getItemsByType: () => [],
          } as never}
        >
          {children}
        </MetadataCtx.Provider>
      </MemoryRouter>
    );
    const { result } = renderHook(
      () => useConsoleActionRuntime({ dataSource, objects: options.objects as never, objectName: options.objectName }),
      { wrapper },
    );
    let res: ActionResult = { success: false };
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api',
        name: 'reassign_account',
        objectName: OBJECT,
        target: 'reassign_account',
        undoable: true,
        bodyExtra: { account: 'a2' },
        params: { _rowRecord: EXPANDED_ROW },
      } as ActionDef);
    });
    return { res, ensureType, context: result.current.actionProviderProps.context };
  }

  it('the `api` handler finds them in the console\'s metadata store when the caller passes none, after asking it to load', async () => {
    // `ConsoleShell`'s root runtime passes no `objects`.
    const { res, ensureType } = await reassign({ metadataObjects: [OBJECT_DEF] });

    expect(ensureType).toHaveBeenCalledWith('object');
    expect(res.undo?.undoData).toEqual({ account: 'a1' });
  });

  it('the runtime publishes its object\'s field definitions beside `objectName`, and nothing without one', async () => {
    const withObject = await reassign({ objects: [OBJECT_DEF], objectName: OBJECT });
    expect(withObject.context.objectName).toBe(OBJECT);
    expect(withObject.context.objectFields).toBe(FIELDS);

    const global = await reassign({ objects: [OBJECT_DEF] });
    expect(global.context).not.toHaveProperty('objectName');
    expect(global.context).not.toHaveProperty('objectFields');
  });
});
