/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10404 — Undo on a projected grid row restores the stored value, and
 * never writes `null` over one.
 *
 * The grid projects what it displays plus what its actions read off the row. An
 * `undoable` update reads the prior value of every field it writes off that row,
 * so a written field no column shows was ABSENT from it. The runner captured it
 * as `null`, and Undo wrote `null` over the stored value: measured on `main`
 * before the fix with this fixture, `$select` was `["id","name"]`, `undoData`
 * `{ status: null }`, and after Undo the stored `status` was `null`, not
 * `'open'`. Control: with `status` as a column, `undoData` read `{ status: 'open' }`.
 *
 * Everything here is real except the network: the `ObjectGrid`, its kebab, the
 * `ActionRunner` behind `ActionProvider`, and the Undo itself, which runs through
 * the real `useGlobalUndo` executor. The `script` dispatch stands in for the
 * platform action route and writes the declared `patch` under the params it is
 * sent, and the data source
 * honours `$select` the way a real backend does (an unselected key is absent,
 * not `undefined`-valued).
 *
 * PIN 1 is the card's pin (the harvest): the row carries `status`, and Undo puts
 * `'open'` back. PIN 2 is the backstop: a field the harvest cannot make the row
 * carry (declared, writable, but not readable by the principal) gets no Undo at
 * all, so nothing ever writes `null` over it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

/** Field-level read policy, switched per test. Stable identity: `ObjectGrid` keys memos on `perms`. */
const { permsStub, policy } = vi.hoisted(() => {
  const policy: { readable: string[] } = { readable: [] };
  return {
    policy,
    permsStub: {
      isLoaded: true,
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? policy.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as never };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider, useGlobalUndo, type UseGlobalUndoOptions } from '@object-ui/react';
import { globalUndoManager } from '@object-ui/core';

registerAllFields();

const OBJECT = 'task';
const OBJECT_FIELDS = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
};

/** The card's action: an undoable update whose written field is no column. */
const CLOSE_TASK = {
  name: 'close_task',
  label: 'Close',
  type: 'script',
  operation: 'update',
  undoable: true,
  locations: ['list_item'],
  patch: { status: 'closed' },
};

function makeWorld() {
  const stored: Record<string, unknown> = { id: 't_1', name: 'Ada', status: 'open' };
  const dataSource = {
    find: vi.fn(async (_object: string, params?: { $select?: string[] }) => {
      const select = params?.$select;
      const row = select
        ? Object.fromEntries(Object.entries(stored).filter(([key]) => select.includes(key)))
        : { ...stored };
      return { data: [row], total: 1 };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(async (_object: string, _id: string, data: Record<string, unknown>) => {
      Object.assign(stored, data);
      return { ...stored };
    }),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
  // Stands in for the platform action route: writes the action's declared
  // `patch` UNDER the params it is sent, as the route does
  // (`declarativeUpdateWrite`). The patch is read off the action the stub is
  // handed, standing in for the declaration the route resolves by name: the
  // request never carries it (objectui#12941).
  const script = vi.fn(async (action: { params?: Record<string, unknown>; patch?: Record<string, unknown> }) => {
    const { _rowRecord: _row, recordId: _id, ...fields } = action.params ?? {};
    Object.assign(stored, { ...(action.patch ?? {}), ...fields });
    return { success: true };
  });
  return { stored, dataSource, script };
}

/** Exposes the real `useGlobalUndo` executor — the one the console's Undo button calls. */
function UndoHandle({ dataSource, onReady }: {
  dataSource: UseGlobalUndoOptions['dataSource'];
  onReady: (undo: () => Promise<void>) => void;
}) {
  const { undo } = useGlobalUndo({ dataSource });
  onReady(undo);
  return null;
}

async function closeTheRow(readable: string[]) {
  policy.readable = readable;
  const world = makeWorld();
  const toasts: Array<{ type?: string; undo: boolean }> = [];
  let undo: (() => Promise<void>) | undefined;
  render(
    <ActionProvider
      context={{ objectName: OBJECT }}
      handlers={{ script: world.script as never }}
      onToast={(_message, opts) => { toasts.push({ type: opts?.type, undo: opts?.undo !== undefined }); }}
    >
      <SchemaRendererProvider dataSource={world.dataSource as never}>
        <UndoHandle dataSource={world.dataSource} onReady={(fn) => { undo = fn; }} />
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name'], rowActionDefs: [CLOSE_TASK] } as never}
          dataSource={world.dataSource as never}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
  const select = (world.dataSource.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
  await userEvent.click(await screen.findByTestId('row-action-trigger'));
  await userEvent.click(await screen.findByTestId('row-action-close_task'));
  await waitFor(() => expect(toasts).toHaveLength(1));
  return { ...world, select, toasts, undo: () => act(async () => { await undo!(); }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  globalUndoManager.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalUndoManager.clear();
});

describe('ObjectGrid — Undo of an `undoable` update on a projected row (objectui#10404)', () => {
  it('PIN 1: the row carries the written field, and Undo puts the stored value back', async () => {
    const run = await closeTheRow(['name', 'status']);
    const afterWrite = run.stored.status;
    const captured = globalUndoManager.peekUndo()?.undoData;

    await run.undo();

    // The card's outcome first, so a regression reads as what the user sees:
    // before the fix this was `null`.
    expect(run.stored.status).toBe('open');
    expect(run.dataSource.update).toHaveBeenCalledWith(OBJECT, 't_1', { status: 'open' });
    expect(captured).toEqual({ status: 'open' });
    // The write happened, and the toast offered Undo.
    expect(afterWrite).toBe('closed');
    expect(run.toasts).toEqual([{ type: 'success', undo: true }]);
    // Why the row carried it: the harvest asked for the written field though no
    // column shows it.
    expect(run.select).toEqual(expect.arrayContaining(['id', 'name', 'status']));
  });

  it('PIN 2: a written field the row cannot carry gets no Undo, so nothing writes `null` over it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `status` is writable but not readable: the harvest names it and the FLS
    // gate drops it, exactly as it must (harvesting is not a read grant).
    const run = await closeTheRow(['name']);
    const pending = globalUndoManager.peekUndo();

    // Ctrl+Z / the Undo executor finds nothing to run, so no `null` is written.
    // Before the fix this wrote `{ status: null }`.
    await run.undo();
    expect(run.stored.status).toBe('closed');
    expect(run.dataSource.update).not.toHaveBeenCalled();

    // No Undo affordance on the toast, nothing on the Undo stack, and the
    // author is told which field was missing.
    expect(pending).toBeUndefined();
    expect(run.toasts).toEqual([{ type: 'success', undo: false }]);
    expect(warn.mock.calls.some(([, detail]) =>
      JSON.stringify(detail) === JSON.stringify({ action: 'close_task', missing: ['status'] }))).toBe(true);
    expect(run.select).not.toContain('status');
  });
});
