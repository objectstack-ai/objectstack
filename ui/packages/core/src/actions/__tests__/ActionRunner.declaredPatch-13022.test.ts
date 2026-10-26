/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13022 — the Undo snapshot of an `operation: 'update'` action covers
 * the `patch` of the DECLARATION the action's `name` names, plus the collected
 * params.
 *
 * The platform action route resolves the declaration by the dispatch's object
 * and the action's `name`, and writes `{ ...declaration.patch, ...params }`
 * (`declarativeUpdateWrite`). So that is the write an Undo must restore. A page
 * action row's own `patch` is never it: `@objectstack/spec` 18 retires the row
 * key, and no action renderer forwards it. The runner reads the declaration
 * from the `objectActions` its host publishes beside `objectName` (as the
 * console's `useConsoleActionRuntime` and `RecordDetailView` do), and, when the
 * host published none for the dispatch's object, off the def itself: a host
 * that dispatches an object's action whole hands the declaration in.
 *
 * The dispatch is the real `createServerActionHandler` over a fetch stub, so
 * every case also shows the request carries the collected params alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';

/** A fetch stub answering the route's success envelope. */
function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) }));
}

/** The parsed JSON body of the last request a fetch stub was sent. */
function sentBody(fetch: ReturnType<typeof okFetch>): { recordId?: unknown; params?: unknown } {
  const calls = fetch.mock.calls as unknown as Array<[string, { body: string }]>;
  return JSON.parse(calls[calls.length - 1][1].body);
}

/** The object's declared actions, as a host publishes them. */
const DECLARATIONS = [
  { name: 'close_task', objectName: 'task', operation: 'update', patch: { status: 'done' }, undoable: true },
  {
    name: 'set_note',
    objectName: 'task',
    operation: 'update',
    params: [{ name: 'note', type: 'text' }],
    undoable: true,
  },
];

/** The row the action runs on, stashed the way every invoking surface stashes it. */
const ROW = { id: 't1', status: 'open', priority: 'low', note: 'was' };

/** A runner wired as a console host wires one, publishing `context`. */
function wire(context: Record<string, unknown>) {
  const fetch = okFetch();
  const runner = new ActionRunner(context);
  runner.registerHandler(
    'script',
    createServerActionHandler({ fetch: fetch as unknown as ServerActionFetch, resolveObject: () => 'task' }),
  );
  return { runner, fetch };
}

/** A row's dispatch: the row names its action and carries the record stash. */
function rowDispatch(extra: Partial<ActionDef> & { params?: Record<string, unknown> } = {}): ActionDef {
  const { params, ...rest } = extra;
  return {
    name: 'close_task',
    operation: 'update',
    undoable: true,
    ...rest,
    params: { ...(params ?? {}), _rowRecord: ROW },
  } as ActionDef;
}

const PUBLISHED = { objectName: 'task', objectActions: DECLARATIONS };

describe("operation: 'update' — the snapshot covers the named declaration's `patch` (objectui#13022)", () => {
  it('a row that carries no `patch`: Undo covers the field the declaration writes', async () => {
    const { runner, fetch } = wire(PUBLISHED);

    const result = await runner.execute(rowDispatch());

    expect(result.success).toBe(true);
    expect(result.undo).toMatchObject({
      objectName: 'task',
      recordId: 't1',
      undoData: { status: 'open' },
      redoData: { status: 'done' },
    });
    // The route writes `status` from the declaration; the request carries none.
    expect(sentBody(fetch)).toEqual({ recordId: 't1', params: {} });
  });

  it('the declaration wins over a `patch` the def carries itself', async () => {
    // A def built from a row that still carries its own `patch` (the spec
    // accepts the key before 18): the route never writes it, so the snapshot
    // covers `status`, the declaration's field, and not `priority`.
    const { runner } = wire(PUBLISHED);

    const result = await runner.execute(rowDispatch({ patch: { priority: 'high' } as never }));

    expect(result.undo?.undoData).toEqual({ status: 'open' });
    expect(result.undo?.redoData).toEqual({ status: 'done' });
  });

  it('a declaration with no `patch`: the snapshot is the collected params alone', async () => {
    const { runner, fetch } = wire(PUBLISHED);
    runner.setParamCollectionHandler(async () => ({ note: 'typed' }));

    const result = await runner.execute(rowDispatch({
      name: 'set_note',
      actionParams: [{ name: 'note', type: 'text' }] as never,
    }));

    expect(result.undo?.undoData).toEqual({ note: 'was' });
    expect(result.undo?.redoData).toEqual({ note: 'typed' });
    expect(sentBody(fetch)).toEqual({ recordId: 't1', params: { note: 'typed' } });
  });

  it('a field the declaration writes that the row does not carry: no Undo, never an invented prior value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { runner } = wire(PUBLISHED);
      const { status: _status, ...rowWithoutStatus } = ROW;

      const result = await runner.execute({
        name: 'close_task',
        operation: 'update',
        undoable: true,
        params: { _rowRecord: rowWithoutStatus },
      } as ActionDef);

      expect(result.success).toBe(true);
      expect(result.undo).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('offers no Undo'),
        expect.objectContaining({ action: 'close_task', missing: ['status'] }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("operation: 'update' — when the host published no declaration for the dispatch's object", () => {
  it('a def that IS the declaration (a spread-based host) is read whole, `patch` included', async () => {
    const { runner } = wire({ objectName: 'task' });

    const result = await runner.execute(rowDispatch({ patch: { status: 'done' } as never }));

    expect(result.undo?.undoData).toEqual({ status: 'open' });
    expect(result.undo?.redoData).toEqual({ status: 'done' });
  });

  it('a dispatch to ANOTHER object does not read this object\'s declarations', async () => {
    // A related-list row on the record page: the child object's action, handed
    // in whole with its own `patch`. The host's list holds the PARENT's
    // declarations, so a same-named one there is not this action's.
    const { runner } = wire({
      objectName: 'project',
      objectActions: [{ name: 'close_task', operation: 'update', patch: { phase: 'closed' } }],
    });

    const result = await runner.execute(rowDispatch({ objectName: 'task', patch: { status: 'done' } as never }));

    expect(result.undo).toMatchObject({ objectName: 'task', undoData: { status: 'open' }, redoData: { status: 'done' } });
  });

  it('control: a row with no `patch` and no published declaration offers no Undo', async () => {
    // Nothing names a written field, so there is nothing to restore; the lit
    // rows above are lit by the declaration, not by the harness.
    const { runner } = wire({ objectName: 'task' });

    const result = await runner.execute(rowDispatch());

    expect(result.success).toBe(true);
    expect(result.undo).toBeUndefined();
  });
});
