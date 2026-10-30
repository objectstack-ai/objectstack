/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27831 — the two runner members a launch control draws from.
 *
 * - `launchRefusal(action)` answers the early refusal `execute` would give the
 *   action against the runner's current context (the dispatch handler's
 *   `refuseBeforeInput`, translated by its key), and runs, sends and shows
 *   nothing. A list header asks it to draw a single-record action disabled
 *   while the selection is not exactly one row.
 * - `subscribeContext(listener)` tells a listener that `updateContext` ran, so
 *   that header redraws when the grid publishes its selection.
 *
 * Through the real runner and the real `createServerActionHandler` with a
 * stubbed transport.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { ActionRunner, type ActionDef, type ToastHandler } from '../ActionRunner';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';

const MULTI_ROW_REFUSAL = 'This action runs on a single record — select exactly one row.';
const ZERO_ROW_REFUSAL = 'This action runs on a single record — select a row first.';

/** A single-record action: mounted on rows and on the toolbar. */
const REASSIGN: ActionDef = {
  type: 'script',
  name: 'reassign',
  objectName: 'task',
  locations: ['list_item', 'list_toolbar'],
};

/** An object-level action: the toolbar alone. */
const EXPORT_ALL: ActionDef = {
  type: 'script',
  name: 'export_all',
  objectName: 'task',
  locations: ['list_toolbar'],
};

function runnerWith(rows?: Record<string, unknown>[]) {
  const fetch = vi.fn() as unknown as ServerActionFetch & Mock;
  const toast = vi.fn() as Mock<ToastHandler>;
  const runner = new ActionRunner(rows ? { selectedRecords: rows } : {});
  runner.setToastHandler(toast);
  runner.registerHandler('script', createServerActionHandler({ fetch }));
  return { runner, fetch, toast };
}

describe('objectstack#27831 — ActionRunner.launchRefusal', () => {
  it('0 rows: the "select a row first" refusal, and nothing runs, is sent or shown', () => {
    const { runner, fetch, toast } = runnerWith([]);
    expect(runner.launchRefusal(REASSIGN)).toBe(ZERO_ROW_REFUSAL);
    expect(fetch).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('no selection published at all reads as 0 rows', () => {
    expect(runnerWith().runner.launchRefusal(REASSIGN)).toBe(ZERO_ROW_REFUSAL);
  });

  it('1 row: no refusal', () => {
    expect(runnerWith([{ id: 't1' }]).runner.launchRefusal(REASSIGN)).toBeUndefined();
  });

  it('2 rows: the "exactly one row" refusal', () => {
    expect(runnerWith([{ id: 't1' }, { id: 't2' }]).runner.launchRefusal(REASSIGN)).toBe(MULTI_ROW_REFUSAL);
  });

  it('answers what execute refuses: the same text, for the same context', async () => {
    const { runner, toast, fetch } = runnerWith([]);
    const asked = runner.launchRefusal(REASSIGN);
    const result = await runner.execute({ ...REASSIGN });
    expect(result).toEqual({ success: false, error: asked });
    expect(toast).toHaveBeenCalledWith(asked, expect.objectContaining({ type: 'error' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows the context the runner holds now', () => {
    const { runner } = runnerWith([]);
    expect(runner.launchRefusal(REASSIGN)).toBe(ZERO_ROW_REFUSAL);
    runner.updateContext({ selectedRecords: [{ id: 't1' }] });
    expect(runner.launchRefusal(REASSIGN)).toBeUndefined();
  });

  it('is translated by the refusal\'s own key, with the English source as the default', () => {
    const { runner } = runnerWith([]);
    const translate = vi.fn((key: string) => `[${key}]`);
    runner.setTranslator(translate);
    expect(runner.launchRefusal(REASSIGN)).toBe('[actions.selectRowFirst]');
    expect(translate).toHaveBeenCalledWith('actions.selectRowFirst', { defaultValue: ZERO_ROW_REFUSAL });
  });

  it('a typeless declaration is asked of the handler its spec default type routes to', () => {
    const { type: _type, ...typeless } = REASSIGN;
    expect(runnerWith([]).runner.launchRefusal(typeless as ActionDef)).toBe(ZERO_ROW_REFUSAL);
  });

  it('CONTROL — an object-level action with 0 rows is not refused', () => {
    expect(runnerWith([]).runner.launchRefusal(EXPORT_ALL)).toBeUndefined();
  });

  it('CONTROL — a handler with no early refusal is never refused', () => {
    const runner = new ActionRunner({ selectedRecords: [] });
    runner.registerHandler('script', vi.fn(async () => ({ success: true })));
    expect(runner.launchRefusal(REASSIGN)).toBeUndefined();
  });
});

describe('objectstack#27831 — ActionRunner.subscribeContext', () => {
  it('tells a listener after each updateContext, with the new context readable, until it unsubscribes', () => {
    const runner = new ActionRunner();
    const seen: unknown[] = [];
    const unsubscribe = runner.subscribeContext(() => { seen.push(runner.getContext().selectedRecords); });

    const rows = [{ id: 't1' }];
    runner.updateContext({ selectedRecords: rows });
    expect(seen).toEqual([rows]);

    unsubscribe();
    runner.updateContext({ selectedRecords: [] });
    expect(seen).toEqual([rows]);
  });
});
