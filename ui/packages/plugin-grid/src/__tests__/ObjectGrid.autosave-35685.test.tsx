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
 *   7. A move of a state-machine field (slice S3) opens a confirm naming the
 *      field and both values and saying automation may run; Cancel writes
 *      nothing, Change writes the move. A field no active machine governs
 *      saves without asking.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
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
import { withinBand } from './groupBandScope';

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

describe("ObjectGrid autosave — a write asked while the row's lock is read waits for it (objectstack#35795)", () => {
  /**
   * The approvals service answers the page's locks after `delay` ms; explain
   * answers after `explain.delay` ms (at once by default), refusing `update`
   * on the rows in `explain.refused`.
   */
  function stubSlowLocks(
    locked: ReadonlySet<string>,
    delay: number,
    explain: { delay?: number; refused?: ReadonlySet<string> } = {},
  ) {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const ids: string[] = Array.isArray(body.recordIds) ? body.recordIds : [];
      if (String(url).endsWith(`/api/v1/approvals/records/${OBJECT}/locks`)) {
        const answer = {
          ok: true, status: 200,
          json: async () => ({ success: true, data: { records: ids.map((id) => ({ recordId: id, locked: locked.has(id) })) } }),
        };
        return new Promise((resolve) => setTimeout(() => resolve(answer), delay));
      }
      const verdicts = {
        ok: true, status: 200,
        json: async () => ({ allowed: true, records: ids.map((id) => ({ recordId: id, visible: !explain.refused?.has(id) })) }),
      };
      return explain.delay ? new Promise((resolve) => setTimeout(() => resolve(verdicts), explain.delay)) : verdicts;
    }));
  }
  function paste(container: HTMLElement, cell: HTMLElement, text: string) {
    fireEvent.click(cell);
    const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.paste(catcher, { clipboardData: { getData: () => text } });
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a paste is not written while the lock is read, and is written once it answers unlocked', async () => {
    stubSlowLocks(new Set(), 2000);
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    vi.useFakeTimers();
    paste(container, dataCell(container, 0, 'alpha'), 'zeta');
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('Checking whether this record can be edited…');
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(ds.update).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    vi.useRealTimers();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ name: 'zeta' });
  });

  it('a paste on a row the answer says is locked is never written, and the cell says why', async () => {
    stubSlowLocks(new Set(['d1']), 2000);
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    vi.useFakeTimers();
    paste(container, dataCell(container, 0, 'alpha'), 'zeta');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent("This record is locked while it's in approval.");
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('a paste on a row whose slow record verdict refuses it is never written, and the cell says why', async () => {
    stubSlowLocks(new Set(), 0, { delay: 2000, refused: new Set(['d1']) });
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    vi.useFakeTimers();
    paste(container, dataCell(container, 0, 'alpha'), 'zeta');
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('Checking whether this record can be edited…');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent("You don't have permission to edit this record.");
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(ds.update).not.toHaveBeenCalled();
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

  it("an earlier save's Undo pressed the moment a newer save is drawn keeps the newer save on screen", async () => {
    // The Undo runs in the very turn the newer row reaches the DOM, before
    // React's effects for that render have run: what the undo draws over must
    // already be the newer save, or the row falls back to the values it was
    // read with (objectstack#35999).
    const ds = makeDataSource();
    const { container } = renderGrid(ds, true);
    await screen.findByText('beta');
    await editSelectFirst(container, dataCell(container, 0, '10'), '11');
    await screen.findByText('11');
    let pressed = false;
    const observer = new MutationObserver(() => {
      if (pressed || !container.textContent?.includes('A2')) return;
      pressed = true;
      undoOfToast(0)!.onClick();
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    try {
      await editSelectFirst(container, dataCell(container, 0, 'alpha'), 'a2');
      await waitFor(() => expect(pressed).toBe(true));
    } finally {
      observer.disconnect();
    }
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(3));
    expect(ds.update.mock.calls[2].slice(1)).toEqual(['d1', { amount: 10 }, { ifMatch: '2026-11-20T11:00:02.000Z' }]);
    await screen.findByText('10');
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
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

describe('ObjectGrid — groups, subtotals and the footer total after a cell save (objectstack#35689)', () => {
  /**
   * Deals by stage (Prospect / Won) with an amount: Prospect holds Acme 100
   * and Bolt 50, Won holds Cord 30. One store serves every read the grid
   * makes: the group header query (grouped, or ungrouped for the footer's
   * whole-set figure), each group's row page, a flat window, and the write,
   * which is announced on the data-invalidation bus as the console's
   * mutation bridge announces it.
   */
  type Deal = { id: string; name: string; stage: string; amount: number; updated_at: string };
  type Agg = { function: string; field?: string; alias: string };
  function matchesWhere(row: Record<string, unknown>, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
      if (key === '$and') return (value as unknown[]).every((c) => matchesWhere(row, c));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const op = value as Record<string, unknown>;
        if ('$eq' in op) return row[key] === op.$eq;
        if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
        throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
      }
      return row[key] === value;
    });
  }
  function makeDealSource() {
    const store: Record<string, Deal> = {
      o1: { id: 'o1', name: 'Acme', stage: 'prospect', amount: 100, updated_at: '2026-11-20T10:00:00.000Z' },
      o2: { id: 'o2', name: 'Bolt', stage: 'prospect', amount: 50, updated_at: '2026-11-20T10:00:00.000Z' },
      o3: { id: 'o3', name: 'Cord', stage: 'won', amount: 30, updated_at: '2026-11-20T10:00:00.000Z' },
    };
    let clock = 0;
    const rows = () => Object.values(store);
    const ds = {
      store,
      queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[]; aggregations?: Agg[] }) => {
        const groupBy = query.groupBy ?? [];
        const buckets = new Map<string, Deal[]>();
        for (const row of rows().filter((r) => matchesWhere(r, query.where))) {
          const key = JSON.stringify(groupBy.map((f) => (row as any)[f] ?? null));
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(row);
        }
        return [...buckets.entries()].map(([key, members]) => {
          const values = JSON.parse(key) as unknown[];
          const out: Record<string, unknown> = Object.fromEntries(groupBy.map((f, i) => [f, values[i]]));
          for (const agg of query.aggregations ?? []) {
            out[agg.alias] = agg.function === 'count'
              ? members.length
              : agg.function === 'sum'
                ? members.reduce((a, m) => a + Number((m as any)[agg.field!]), 0)
                : null;
          }
          return out as { count: number };
        });
      }),
      find: vi.fn(async (_object: string, params: Record<string, unknown> = {}) => {
        const where = Array.isArray(params.$filter) ? undefined : params.$filter;
        const matching = rows().filter((r) => matchesWhere(r, where)).sort((a, b) => a.name.localeCompare(b.name));
        const skip = (params.$skip as number | undefined) ?? 0;
        const top = (params.$top as number | undefined) ?? matching.length;
        return { data: matching.slice(skip, skip + top).map((r) => ({ ...r })), total: matching.length };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
        store[id] = { ...store[id], ...changes, updated_at: `2026-11-20T11:00:0${++clock}.000Z` };
        notifyDataChanged({ objectName: OBJECT, recordId: id });
        return { ...store[id] };
      }),
      getObjectSchema: vi.fn(async (name: string) => ({
        name,
        fields: {
          id: { type: 'text' },
          name: { type: 'text', label: 'Name' },
          stage: { type: 'select', label: 'Stage', options: [{ value: 'prospect', label: 'Prospect' }, { value: 'won', label: 'Won' }] },
          amount: { type: 'number', label: 'Amount' },
          updated_at: { type: 'datetime' },
        },
      })),
    };
    return ds;
  }
  type DealSource = ReturnType<typeof makeDealSource>;

  const COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'stage', label: 'Stage' },
    { field: 'amount', label: 'Amount', type: 'number' },
  ];
  /**
   * The grid grouped by stage with an amount subtotal: on the server
   * (`server`, the grid reads its own groups) or bucketed in the browser over
   * the rows a host hands it (`browser`).
   */
  function renderGrouped(ds: DealSource, path: 'server' | 'browser', cellSelection = true) {
    const schema: any = {
      type: 'object-grid',
      objectName: OBJECT,
      editable: true,
      columns: COLUMNS,
      grouping: { fields: [{ field: 'stage' }] },
      aggregations: [{ field: 'amount', type: 'sum' }],
      pagination: { pageSize: 50 },
    };
    return render(
      <ActionProvider>
        <ObjectGrid
          schema={schema}
          dataSource={ds as any}
          cellSelection={cellSelection || undefined}
          {...(path === 'browser' ? { data: Object.values(ds.store).map((r) => ({ ...r })) } : {})}
        />
      </ActionProvider>,
    );
  }
  const bands = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
  const bandOf = (label: string) => bands().find((b) => b.querySelector('.group-label')?.textContent === label)!;
  /** Each group as 「count · sum」, by its label. */
  const groupFigures = () => Object.fromEntries(bands().map((b) => [
    b.querySelector('.group-label')?.textContent ?? '',
    `${b.querySelector('.group-count')?.textContent} · ${b.querySelector('.group-aggregations')?.textContent?.replace(/^\s*sum:\s*/, '')}`,
  ]));
  const namesIn = (label: string) => withinBand(bandOf(label)).queryAllByText(/^(Acme|Bolt|Cord)$/).map((n) => n.textContent);
  const cellOf = (container: HTMLElement, text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('tbody td')).find((td) => td.textContent === text)!;
  const cellIn = (container: HTMLElement, rowName: string, text: string) => {
    const row = cellOf(container, rowName).closest('tr')!;
    return Array.from(row.querySelectorAll<HTMLElement>('td')).find((td) => td.textContent === text)!;
  };
  function pasteInto(container: HTMLElement, cell: HTMLElement, text: string) {
    fireEvent.click(cell);
    const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.paste(catcher, { clipboardData: { getData: () => text } });
  }

  describe.each(['server', 'browser'] as const)('%s grouping', (path) => {
    it("a row whose stage changed stays in its group until another row is selected, then counts and sums in its new one", async () => {
      const ds = makeDealSource();
      const { container } = renderGrouped(ds, path);
      await waitFor(() => expect(namesIn('Won')).toEqual(['Cord']));
      expect(groupFigures()).toEqual({ Prospect: '2 · 150', Won: '1 · 30' });
      pasteInto(container, cellIn(container, 'Bolt', 'Prospect'), 'Won');
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
      // Still on the row: it keeps its place, and the groups their figures.
      await waitFor(() => expect(cellIn(container, 'Bolt', 'Won')).toBeTruthy());
      expect(namesIn('Prospect')).toEqual(['Acme', 'Bolt']);
      expect(groupFigures()).toEqual({ Prospect: '2 · 150', Won: '1 · 30' });
      // Another cell of the same row is not leaving it.
      fireEvent.click(cellOf(container, 'Bolt'));
      expect(namesIn('Prospect')).toEqual(['Acme', 'Bolt']);
      expect(groupFigures()).toEqual({ Prospect: '2 · 150', Won: '1 · 30' });
      // Leaving it: a cell of another row is selected.
      fireEvent.click(cellOf(container, 'Acme'));
      await waitFor(() => expect(namesIn('Won')).toEqual(['Bolt', 'Cord']));
      expect(namesIn('Prospect')).toEqual(['Acme']);
      await waitFor(() => expect(groupFigures()).toEqual({ Prospect: '1 · 100', Won: '2 · 80' }));
    });

    it('an amount saved is in its group subtotal at once', async () => {
      const ds = makeDealSource();
      const { container } = renderGrouped(ds, path);
      await waitFor(() => expect(namesIn('Won')).toEqual(['Cord']));
      const reads = ds.find.mock.calls.length;
      const headerReads = ds.queryGroupHeaders.mock.calls.length;
      await editSelectFirst(container, cellIn(container, 'Bolt', '50'), '70');
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(groupFigures()).toEqual({ Prospect: '2 · 170', Won: '1 · 30' }));
      expect(namesIn('Prospect')).toEqual(['Acme', 'Bolt']);
      // The figures, and no row, are read again: a server-grouped grid asks
      // its headers once more; a grid bucketing in the browser asks nothing.
      expect(ds.find.mock.calls.length).toBe(reads);
      expect(ds.queryGroupHeaders.mock.calls.length).toBe(headerReads + (path === 'server' ? 1 : 0));
    });
  });

  it('control: without cellSelection a write announced on the bus re-reads the grouped grid at once', async () => {
    const ds = makeDealSource();
    renderGrouped(ds, 'server', false);
    await waitFor(() => expect(namesIn('Won')).toEqual(['Cord']));
    ds.store.o2 = { ...ds.store.o2, stage: 'won' };
    notifyDataChanged({ objectName: OBJECT, recordId: 'o2' });
    await waitFor(() => expect(namesIn('Won')).toEqual(['Bolt', 'Cord']));
    expect(groupFigures()).toEqual({ Prospect: '1 · 100', Won: '2 · 80' });
  });

  /** A column's footer figure (the table's own summary row). */
  const footerOf = (field: string) => screen.queryByTestId(`data-table-summary-${field}`)?.textContent ?? null;
  const FOOTER_COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'amount', label: 'Amount', type: 'number', summary: 'sum' },
  ];

  it('the footer total of a grid whose rows are the set follows an amount saved', async () => {
    const ds = makeDealSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, editable: true, columns: FOOTER_COLUMNS, pagination: { pageSize: 50 } } as any}
          dataSource={ds as any}
          cellSelection
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(footerOf('amount')).toMatch(/180/));
    await editSelectFirst(container, cellIn(container, 'Bolt', '50'), '70');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(footerOf('amount')).toMatch(/200/));
  });

  it('the footer total read from the server for a paged grid is read again after an amount saved', async () => {
    const ds = makeDealSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, editable: true, columns: FOOTER_COLUMNS, pagination: { pageSize: 2 } } as any}
          dataSource={ds as any}
          cellSelection
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(footerOf('amount')).toMatch(/180/));
    await editSelectFirst(container, cellIn(container, 'Bolt', '50'), '70');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(footerOf('amount')).toMatch(/200/));
  });
});

describe('ObjectGrid — a state-machine field is confirmed before a list cell saves it (objectstack#35685)', () => {
  /** Deals whose `stage` a state machine governs, and whose `priority` none does. */
  function makeMachineDataSource(rule: Record<string, unknown> = {}) {
    const ds = makeDataSource();
    ds.store.d1.stage = 'new';
    ds.store.d1.priority = 'low';
    ds.getObjectSchema = async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        stage: {
          type: 'select',
          label: 'Stage',
          options: [
            { value: 'new', label: 'New' },
            { value: 'qualified', label: 'Qualified' },
            { value: 'won', label: 'Won' },
          ],
        },
        priority: { type: 'select', label: 'Priority', options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
        updated_at: { type: 'datetime' },
      },
      validations: [{
        name: 'stage_flow',
        type: 'state_machine',
        field: 'stage',
        transitions: { new: ['qualified', 'won'], qualified: ['won'] },
        ...rule,
      }],
    });
    return ds;
  }

  function renderMachineGrid(ds: any) {
    const schema: any = {
      type: 'object-grid',
      objectName: OBJECT,
      editable: true,
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'stage', label: 'Stage' },
        { field: 'priority', label: 'Priority' },
      ],
      pagination: { pageSize: 50 },
    };
    return render(
      <ActionProvider>
        <ObjectGrid schema={schema} dataSource={ds} cellSelection />
      </ActionProvider>,
    );
  }

  /** Select a cell and paste `text` into it (a commit made without an editor). */
  function pasteInto(container: HTMLElement, cell: HTMLElement, text: string) {
    fireEvent.click(cell);
    const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.paste(catcher, { clipboardData: { getData: () => text } });
  }

  it('names the field and both values, says automation may run, and Cancel saves nothing', async () => {
    const ds = makeMachineDataSource();
    const { container } = renderMachineGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Change Stage?');
    expect(dialog).toHaveTextContent('Stage changes from New to Won. Saving may trigger related automation.');
    expect(ds.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await act(async () => {});
    expect(ds.update).not.toHaveBeenCalled();
    expect(dataCell(container, 0, 'New')).toBeTruthy();
  });

  it('Change sends the move as one guarded update', async () => {
    const ds = makeMachineDataSource();
    const { container } = renderMachineGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith(OBJECT, 'd1', { stage: 'won' }, { ifMatch: '2026-11-20T10:00:00.000Z' });
    await waitFor(() => expect(dataCell(container, 0, 'Won')).toBeTruthy());
  });

  it('a field no state machine governs, and an inactive machine, save without asking', async () => {
    const ds = makeMachineDataSource({ active: false });
    const { container } = renderMachineGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'Low'), 'High');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ priority: 'high' });
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a machine bound to insert alone does not govern an update: the move saves without asking', async () => {
    const ds = makeMachineDataSource({ events: ['insert'] });
    const { container } = renderMachineGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('an advisory (warning-severity) machine still asks: the move is what automation listens for', async () => {
    const ds = makeMachineDataSource({ severity: 'warning', events: ['update'] });
    const { container } = renderMachineGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Stage changes from New to Won.');
    expect(ds.update).not.toHaveBeenCalled();
  });
});
