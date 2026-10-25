/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10404 — an `undoable` update never records a field the row does not
 * carry as `null`.
 *
 * The capture reads each written field's prior value off the row the surface
 * stashed under `params._rowRecord`. A list row is projected by `$select`, so a
 * written field no column shows is ABSENT from it while the server holds a real
 * value. It used to be captured as `null`, and Undo then wrote `null` over the
 * value it existed to restore (measured with a real `ObjectGrid`:
 * `undoData` `{ status: null }` against a stored `'open'`).
 *
 * The list harvest now makes a projected row carry the written fields (see
 * `predicate-fields.test.ts` and plugin-grid's `undoProjectedRow-10404`); this
 * file pins the backstop for a row that still lacks one: no Undo at all, and a
 * success toast without the Undo affordance. A `null` the row DOES carry is a
 * real empty value and is still captured, so a full record is not regressed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { globalUndoManager } from '../UndoManager';

afterEach(() => {
  vi.restoreAllMocks();
  globalUndoManager.clear();
});

/**
 * A runner with a `script` dispatch that answers success, and a toast spy that
 * records whether the success toast offered Undo.
 */
function wireRunner() {
  const runner = new ActionRunner({ objectName: 'task' });
  const toasts: Array<{ type?: string; undo: boolean }> = [];
  runner.setToastHandler((_message, opts) => {
    toasts.push({ type: opts?.type, undo: opts?.undo !== undefined });
  });
  runner.registerHandler('script', vi.fn(async () => ({ success: true })));
  return { runner, toasts };
}

/** The card's action: an undoable update writing a field no column shows. */
function closeTask(row: Record<string, unknown>, extra: Partial<ActionDef> = {}): ActionDef {
  return {
    type: 'script',
    name: 'close_task',
    label: 'Close',
    operation: 'update',
    undoable: true,
    patch: { status: 'closed' },
    params: { _rowRecord: row },
    ...extra,
  } as ActionDef;
}

describe('undoable update — a field the row does not carry is never captured as `null` (objectui#10404)', () => {
  it('offers no Undo when the row lacks the written field, and the toast carries no Undo button', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const push = vi.spyOn(globalUndoManager, 'push');
    const { runner, toasts } = wireRunner();

    // A projected row: `status` was not selected, so the key is simply absent.
    const result = await runner.execute(closeTask({ id: 't_1', name: 'Ada' }));

    expect(result.success).toBe(true);
    expect(result.undo).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
    expect(toasts).toEqual([{ type: 'success', undo: false }]);
    // The author is told which field was missing.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ action: 'close_task', missing: ['status'] });
  });

  it('control: the same action on a row that carries the field captures its stored value', async () => {
    const push = vi.spyOn(globalUndoManager, 'push');
    const { runner, toasts } = wireRunner();

    const result = await runner.execute(closeTask({ id: 't_1', name: 'Ada', status: 'open' }));

    expect(result.undo?.undoData).toEqual({ status: 'open' });
    expect(result.undo?.redoData).toEqual({ status: 'closed' });
    expect(push).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([{ type: 'success', undo: true }]);
  });

  it('still captures a `null` the row carries — an empty field restored to empty (a full record is not regressed)', async () => {
    const { runner } = wireRunner();

    const result = await runner.execute(closeTask({ id: 't_1', name: 'Ada', status: null }));

    expect(result.undo?.undoData).toEqual({ status: null });
  });

  it('treats an own key holding `undefined` as not carried — JSON cannot send one, so it says nothing stored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner } = wireRunner();

    const result = await runner.execute(closeTask({ id: 't_1', status: undefined }));

    expect(result.success).toBe(true);
    expect(result.undo).toBeUndefined();
  });

  it('offers no partial Undo: one carried field and one absent field is no Undo at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner } = wireRunner();

    // `note` is a collected param the row does not carry; `status` is carried.
    const result = await runner.execute(closeTask(
      { id: 't_1', status: 'open' },
      { params: { _rowRecord: { id: 't_1', status: 'open' }, note: 'typed' } as never },
    ));

    expect(result.success).toBe(true);
    expect(result.undo).toBeUndefined();
    expect(warn.mock.calls[0][1]).toEqual({ action: 'close_task', missing: ['note'] });
  });
});
