/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s per-cell save in the select-first model (objectstack#35685),
 * through its default `dataSource` save. The table's side is
 * `data-table-autosave-35685.test.tsx` in `@object-ui/components`.
 *
 *   1. A committed cell sends ONE update for its record and no read: the
 *      grid redraws that row from the write's answer, so a value a server
 *      hook rewrote shows as stored, and no other row is read again, though
 *      the write is announced on the data-invalidation bus.
 *   2. The `If-Match` of the next save on the row is the version that
 *      answer carried.
 *   3. A 409 the user keeps as theirs ("Overwrite anyway") re-reads nothing
 *      either; "Reload latest" does read again.
 *   4. Control: without `cellSelection` the save bar's row save still
 *      re-reads the grid.
 *   5. Undo (slice S2): the save toast's Undo button and Ctrl+Z / Cmd+Z on a
 *      cell take a save back as a NEW guarded update of the prior value,
 *      newest first, each once, guarded by the version the grid's own write
 *      answered (a later change by someone else answers 409); an open editor
 *      keeps Ctrl+Z for its text.
 *   6. A grid without `cellSelection` inside a list's own-writes registry
 *      (the related list in that list's record drawer) still re-reads on a
 *      write the outer grid holds.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// The grid's toast, to read the save toast's Undo button (the components
// entry is the module the grid imports `toast` from).
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: Object.assign(vi.fn(), toasts) };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, notifyDataChanged, createOwnWrites, OwnWritesContext } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';
import { installExplainDouble } from './explainDouble';

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(toasts)) fn.mockClear();
});

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'deal';

/**
 * A fake server whose update hook rewrites the name it is sent to upper case,
 * and whose writes are announced on the data-invalidation bus.
 */
function makeDataSource() {
  const store: Record<string, any> = {
    d1: { id: 'd1', name: 'alpha', amount: 10, updated_at: '2026-11-20T10:00:00.000Z' },
    d2: { id: 'd2', name: 'beta', amount: 20, updated_at: '2026-11-20T10:00:00.000Z' },
  };
  let clock = 0;
  const find = vi.fn(async () => {
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    const next = { ...store[id], ...changes };
    if (typeof changes.name === 'string') next.name = changes.name.toUpperCase();
    next.updated_at = `2026-11-20T11:00:0${++clock}.000Z`;
    store[id] = next;
    // Announced on the bus inside the write, as the console's mutation bridge
    // does, so a grid that re-read on its own write would read again here.
    notifyDataChanged({ objectName: OBJECT, recordId: id });
    return { ...next };
  });
  return {
    store,
    find,
    update,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
        updated_at: { type: 'datetime' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any, cellSelection: boolean) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} cellSelection={cellSelection || undefined} />
    </ActionProvider>,
  );
}

const dataCell = (container: HTMLElement, row: number, text: string) =>
  Array.from(container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td'))
    .find((td) => td.textContent === text)!;

/** Select a cell, open its editor with Enter, type `value`, commit with Enter. */
async function editSelectFirst(container: HTMLElement, cell: HTMLElement, value: string) {
  fireEvent.click(cell);
  const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  fireEvent.keyDown(catcher, { key: 'Enter' });
  const input = await waitFor(() => {
    const el = container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
    expect(el).toBeTruthy();
    return el!;
  });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ObjectGrid autosave — one update, this row only (objectstack#35685)', () => {
  it('sends one guarded update, reads nothing again, and draws the answer', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'alpha one');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith(OBJECT, 'd1', { name: 'alpha one' }, { ifMatch: '2026-11-20T10:00:00.000Z' });
    // The server's rewrite is what the row shows; nothing was read again.
    await screen.findByText('ALPHA ONE');
    expect(ds.find.mock.calls.length).toBe(reads);
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.queryByText(/Save All/)).toBeNull();
  });

  it('the next save on the row sends the version the first one answered', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'a2');
    await screen.findByText('A2');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(ds.update.mock.calls[1][2]).toEqual({ amount: 11 });
    expect(ds.update.mock.calls[1][3]).toEqual({ ifMatch: '2026-11-20T11:00:01.000Z' });
  });
});

describe('ObjectGrid autosave — a 409 kept as mine re-reads nothing either (objectstack#35685)', () => {
  /** The first write meets a newer version; the "Overwrite anyway" write lands and is announced. */
  function conflictOnce(ds: any) {
    const land = ds.update.getMockImplementation();
    let refused = false;
    ds.update.mockImplementation(async (object: string, id: string, changes: Record<string, any>, opts?: any) => {
      if (!refused) {
        refused = true;
        throw Object.assign(new Error('Record changed since you read it'), {
          code: 'CONCURRENT_UPDATE',
          currentVersion: '2026-11-20T10:30:00.000Z',
          currentRecord: { ...ds.store[id], name: 'someone else' },
        });
      }
      return land(object, id, changes, opts);
    });
  }

  it('Overwrite anyway writes with the current version and reads no row again', async () => {
    const ds = makeDataSource();
    conflictOnce(ds);
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'mine');
    fireEvent.click(await screen.findByRole('button', { name: /Overwrite anyway/ }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(ds.update.mock.calls[1][3]).toEqual({ ifMatch: '2026-11-20T10:30:00.000Z' });
    await screen.findByText('MINE');
    expect(ds.find.mock.calls.length).toBe(reads);
  });

  it('control: Reload latest lets go of the record, so the grid reads again', async () => {
    const ds = makeDataSource();
    conflictOnce(ds);
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'mine');
    fireEvent.click(await screen.findByRole('button', { name: /Reload latest/ }));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(reads));
    expect(ds.update).toHaveBeenCalledTimes(1);
  });
});

describe('ObjectGrid autosave — control: without cellSelection the row save re-reads', () => {
  it('stages, saves from the bar, and reads the grid again', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, false);
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    const cell = dataCell(container, 0, 'alpha');
    fireEvent.click(cell);
    const input = await waitFor(() => {
      const el = cell.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: 'alpha one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ds.update).not.toHaveBeenCalled();
    const saveAll = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => /Save All/.test(b.textContent || ''));
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(saveAll);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(reads));
  });
});

/** The Undo button of the `n`th success toast (0-based), as the grid handed it to the toast. */
function undoOfToast(n: number): { label: string; onClick: () => void } | undefined {
  return (toasts.success.mock.calls[n]?.[1] as { action?: { label: string; onClick: () => void } } | undefined)?.action;
}

/** Ctrl+Z on the selected cell (its typing catcher holds the focus). */
function pressUndo(container: HTMLElement, init: Record<string, unknown> = { ctrlKey: true }) {
  const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  expect(catcher).toBeTruthy();
  fireEvent.keyDown(catcher, { key: 'z', ...init });
}

describe('ObjectGrid autosave — Undo takes a save back as a new guarded update (objectstack#35685)', () => {
  it("the save toast's Undo writes the prior value with the save's version, and reads nothing again", async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    const undo = undoOfToast(0);
    expect(undo?.label).toBe('Undo');
    undo!.onClick();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    // One more write, guarded by the version the save answered with: the
    // server's audit sees the save and its undo as two writes.
    expect(ds.update.mock.calls[1].slice(1)).toEqual(['d1', { amount: 10 }, { ifMatch: '2026-11-20T11:00:01.000Z' }]);
    expect(ds.store.d1.amount).toBe(10);
    await screen.findByText('10');
    expect(screen.queryByText('11')).toBeNull();
    await waitFor(() => expect(toasts.success).toHaveBeenLastCalledWith('Change undone'));
    expect(ds.find.mock.calls.length).toBe(reads);
    // Taken back once: the same button again writes nothing.
    undo!.onClick();
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+Z and Cmd+Z on a cell undo the newest save first, each once', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    await editSelectFirst(container, dataCell(container, 1, '20'), '21');
    await screen.findByText('21');
    expect(ds.update).toHaveBeenCalledTimes(2);
    pressUndo(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(3));
    expect(ds.update.mock.calls[2].slice(1, 3)).toEqual(['d2', { amount: 20 }]);
    await screen.findByText('20');
    pressUndo(container, { metaKey: true });
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(4));
    expect(ds.update.mock.calls[3].slice(1, 3)).toEqual(['d1', { amount: 10 }]);
    await screen.findByText('10');
    // Nothing left to take back: the key writes nothing.
    pressUndo(container);
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(4);
    // The toast of a save Ctrl+Z already took back does nothing either.
    undoOfToast(0)!.onClick();
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(4);
  });

  it("an earlier save's Undo is guarded by the newest version of its record", async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'a2');
    await screen.findByText('A2');
    undoOfToast(0)!.onClick();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(3));
    expect(ds.update.mock.calls[2].slice(1)).toEqual(['d1', { amount: 10 }, { ifMatch: '2026-11-20T11:00:02.000Z' }]);
    await screen.findByText('10');
    expect(screen.getByText('A2')).toBeInTheDocument();
  });

  it("someone else's later change answers 409 on the undo, even after a re-read: Cancel keeps their value", async () => {
    const ds = makeDataSource();
    // The server refuses a write whose If-Match is not the record's version.
    const land = ds.update.getMockImplementation();
    ds.update.mockImplementation(async (object: string, id: string, changes: Record<string, any>, opts?: any) => {
      if (opts?.ifMatch && opts.ifMatch !== ds.store[id].updated_at) {
        throw Object.assign(new Error('Record changed since you read it'), {
          code: 'CONCURRENT_UPDATE',
          currentVersion: ds.store[id].updated_at,
          currentRecord: { ...ds.store[id] },
        });
      }
      return land(object, id, changes, opts);
    });
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    // Another user sets the amount; a change naming no record makes the grid read again.
    ds.store.d1 = { ...ds.store.d1, amount: 50, updated_at: '2026-11-20T12:00:00.000Z' };
    notifyDataChanged({ objectName: OBJECT });
    await screen.findByText('50');
    undoOfToast(0)!.onClick();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    // Guarded by the version this grid's own save answered, not the re-read's.
    expect(ds.update.mock.calls[1][3]).toEqual({ ifMatch: '2026-11-20T11:00:01.000Z' });
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(2);
    expect(ds.store.d1.amount).toBe(50);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(toasts.success).not.toHaveBeenCalledWith('Change undone');
    // The cancelled undo is spent: the key has nothing left to send.
    pressUndo(container);
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(2);
  });

  it('an open editor keeps Ctrl+Z for its own text: no undo is sent', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    fireEvent.click(dataCell(container, 1, 'beta'));
    const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.keyDown(catcher, { key: 'Enter' });
    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.update).toHaveBeenCalledTimes(1);
  });

  it('a refused undo keeps the row and says why on a toast', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    ds.update.mockImplementationOnce(async () => { throw new Error('Amount is locked'); });
    pressUndo(container);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Save failed', { description: 'Amount is locked' }));
    expect(screen.getByText('11')).toBeInTheDocument();
  });

  it('control: without cellSelection the save toast carries no Undo', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, false);
    await screen.findByText('beta');
    const cell = dataCell(container, 0, 'alpha');
    fireEvent.click(cell);
    const input = await waitFor(() => {
      const el = cell.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: 'alpha one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const saveAll = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => /Save All/.test(b.textContent || ''));
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(saveAll);
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(undoOfToast(0)).toBeUndefined();
  });
});

describe("ObjectGrid — a grid without cellSelection re-reads on the host list's own write (objectstack#35685)", () => {
  it("the record drawer's related grid reads again while the outer grid holds the record", async () => {
    const ds = makeDataSource();
    const registry = createOwnWrites();
    const schema: any = {
      type: 'object-grid',
      objectName: OBJECT,
      columns: [{ field: 'name', label: 'Name' }],
      pagination: { pageSize: 50 },
    };
    render(
      <ActionProvider>
        <OwnWritesContext.Provider value={registry}>
          <ObjectGrid schema={schema} dataSource={ds} />
        </OwnWritesContext.Provider>
      </ActionProvider>,
    );
    await screen.findByText('beta');
    const reads = ds.find.mock.calls.length;
    // The outer list grid is writing d1 and draws that write itself.
    const release = registry.hold(OBJECT, 'd1');
    ds.store.d1 = { ...ds.store.d1, name: 'outer write' };
    notifyDataChanged({ objectName: OBJECT, recordId: 'd1' });
    await screen.findByText('outer write');
    expect(ds.find.mock.calls.length).toBeGreaterThan(reads);
    release();
  });
});
