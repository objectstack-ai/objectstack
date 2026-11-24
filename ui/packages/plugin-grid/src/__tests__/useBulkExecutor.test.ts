/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkExecutor } from '../hooks/useBulkExecutor';
import type { BulkActionDef } from '@object-ui/types';

const upd = (op: Partial<BulkActionDef> = {}): BulkActionDef => ({
  name: 'set_priority',
  operation: 'update',
  patch: { priority: 'high' },
  ...op,
} as BulkActionDef);

describe('useBulkExecutor', () => {
  it('runs update across rows and reports succeeded/failed', async () => {
    const update = vi.fn(async (_, id) => {
      if (id === '2') throw new Error('boom');
      return { id };
    });
    const ds = { update, delete: vi.fn() };
    const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

    await act(async () => {
      await result.current.run(upd(), [{ id: '1' }, { id: '2' }, { id: '3' }], {});
    });

    expect(result.current.result?.succeeded).toBe(2);
    expect(result.current.result?.failed).toBe(1);
    expect(result.current.result?.errors).toHaveLength(1);
    expect(result.current.result?.errors[0]).toMatchObject({ id: '2', error: 'boom' });
  });

  it('captures pre-mutation snapshot and undo replays the prior values', async () => {
    const update = vi.fn(async () => ({}));
    const ds = { update, delete: vi.fn() };
    const rows = [
      { id: '1', priority: 'low', name: 'a' },
      { id: '2', priority: 'medium', name: 'b' },
    ];
    const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

    await act(async () => {
      await result.current.run(upd(), rows, {});
    });

    // run() called update twice with the patch
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, 'task', '1', { priority: 'high' });

    update.mockClear();

    await act(async () => {
      await result.current.undo();
    });

    // undo() restored the captured prior values for the touched key only
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith('task', '1', { priority: 'low' });
    expect(update).toHaveBeenCalledWith('task', '2', { priority: 'medium' });
  });

  it('snapshot excludes rows whose mutation failed', async () => {
    const update = vi.fn(async (_, id) => {
      if (id === '2') throw new Error('nope');
      return {};
    });
    const ds = { update, delete: vi.fn() };
    const rows = [
      { id: '1', priority: 'low' },
      { id: '2', priority: 'low' },
    ];
    const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

    await act(async () => {
      await result.current.run(upd(), rows, {});
    });

    update.mockClear();
    update.mockImplementation(async () => ({}));

    await act(async () => {
      await result.current.undo();
    });

    // Only id '1' should be reverted — id '2' never landed in the first place.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('task', '1', { priority: 'low' });
  });

  it('undo is a no-op for delete operations', async () => {
    const deleteFn = vi.fn(async () => ({}));
    const ds = { update: vi.fn(), delete: deleteFn };
    const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

    await act(async () => {
      await result.current.run(
        { name: 'rm', operation: 'delete' } as BulkActionDef,
        [{ id: '1' }],
        {},
      );
    });
    let undoResult: unknown;
    await act(async () => {
      undoResult = await result.current.undo();
    });
    expect(undoResult).toBeNull();
  });

  it('retry re-runs the original op for one failed row and drops it from errors', async () => {
    let fail = true;
    const update = vi.fn(async () => {
      if (fail) {
        fail = false;
        throw new Error('first attempt fails');
      }
      return {};
    });
    const ds = { update, delete: vi.fn() };
    const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

    await act(async () => {
      await result.current.run(upd(), [{ id: '1', priority: 'low' }], {});
    });
    expect(result.current.result?.failed).toBe(1);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.retry('1');
    });
    expect(ok).toBe(true);
    expect(result.current.result?.errors).toHaveLength(0);
    expect(result.current.result?.succeeded).toBe(1);
    expect(result.current.result?.failed).toBe(0);
  });

  describe('bulkUpdate fast-path', () => {
    it('collapses an update batch into a single bulkUpdate call when the adapter supports it', async () => {
      const update = vi.fn(async () => ({}));
      const bulkUpdate = vi.fn(async () => 3);
      const ds = { update, delete: vi.fn(), bulkUpdate };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          upd(),
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(bulkUpdate).toHaveBeenCalledTimes(1);
      expect(bulkUpdate).toHaveBeenCalledWith('task', ['1', '2', '3'], { priority: 'high' });
      // Per-row update must NOT fire when bulk succeeds.
      expect(update).not.toHaveBeenCalled();
      expect(result.current.result?.succeeded).toBe(3);
      expect(result.current.result?.failed).toBe(0);
    });

    it('skips the bulk path for single-row batches (no win, just overhead)', async () => {
      const update = vi.fn(async () => ({}));
      const bulkUpdate = vi.fn(async () => 1);
      const ds = { update, delete: vi.fn(), bulkUpdate };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(upd(), [{ id: '1' }], {});
      });

      expect(bulkUpdate).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.result?.succeeded).toBe(1);
    });

    it('reports the shortfall as an aggregate failure when bulkUpdate returns a partial count', async () => {
      const bulkUpdate = vi.fn(async () => 2); // server only updated 2 of 3
      const ds = { update: vi.fn(), delete: vi.fn(), bulkUpdate };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          upd(),
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(result.current.result?.succeeded).toBe(2);
      expect(result.current.result?.failed).toBe(1);
      expect(result.current.result?.errors).toHaveLength(1);
      expect(result.current.result?.errors[0]).toMatchObject({
        id: 'batch_0',
        error: expect.stringContaining('failed in bulk update'),
      });
    });

    it('falls back to per-row updates when bulkUpdate throws, preserving id-level error detail', async () => {
      const bulkUpdate = vi.fn(async () => {
        throw new Error('server unavailable');
      });
      const update = vi.fn(async (_: string, id: string) => {
        if (id === '2') throw new Error('row 2 RLS rejected');
        return {};
      });
      const ds = { update, delete: vi.fn(), bulkUpdate };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          upd(),
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      // Bulk was tried then fell back to N updates so the user gets per-row errors.
      expect(bulkUpdate).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(3);
      expect(result.current.result?.succeeded).toBe(2);
      expect(result.current.result?.failed).toBe(1);
      expect(result.current.result?.errors[0]).toMatchObject({ id: '2', error: 'row 2 RLS rejected' });
    });

    it('does not invoke bulkUpdate for delete operations (only for updates)', async () => {
      const bulkUpdate = vi.fn(async () => 99);
      const deleteFn = vi.fn(async () => ({}));
      // Note: no bulkDelete provided — verifies bulkUpdate is not accidentally
      // used for the delete code path.
      const ds = { update: vi.fn(), delete: deleteFn, bulkUpdate };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          { name: 'rm', operation: 'delete' } as BulkActionDef,
          [{ id: '1' }, { id: '2' }],
          {},
        );
      });

      expect(bulkUpdate).not.toHaveBeenCalled();
      expect(deleteFn).toHaveBeenCalledTimes(2);
    });

    it('uses bulkDelete for delete operations when the adapter supports it', async () => {
      const bulkDelete = vi.fn(async () => 3);
      const deleteFn = vi.fn(async () => ({}));
      const ds = { update: vi.fn(), delete: deleteFn, bulkDelete };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          { name: 'rm', operation: 'delete' } as BulkActionDef,
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(bulkDelete).toHaveBeenCalledTimes(1);
      expect(bulkDelete).toHaveBeenCalledWith('task', ['1', '2', '3']);
      expect(deleteFn).not.toHaveBeenCalled();
      expect(result.current.result?.succeeded).toBe(3);
    });

    it('falls back to per-row delete when bulkDelete throws', async () => {
      const bulkDelete = vi.fn(async () => {
        throw new Error('server down');
      });
      const deleteFn = vi.fn(async (_: string, id: string) => {
        if (id === '2') throw new Error('row 2 FK violation');
        return {};
      });
      const ds = { update: vi.fn(), delete: deleteFn, bulkDelete };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          { name: 'rm', operation: 'delete' } as BulkActionDef,
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(bulkDelete).toHaveBeenCalledTimes(1);
      expect(deleteFn).toHaveBeenCalledTimes(3);
      expect(result.current.result?.succeeded).toBe(2);
      expect(result.current.result?.errors[0]).toMatchObject({ id: '2', error: 'row 2 FK violation' });
    });

    it('reports partial bulkDelete count as aggregate batch failure', async () => {
      const bulkDelete = vi.fn(async () => 1); // server only deleted 1 of 3
      const ds = { update: vi.fn(), delete: vi.fn(), bulkDelete };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          { name: 'rm', operation: 'delete' } as BulkActionDef,
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(result.current.result?.succeeded).toBe(1);
      expect(result.current.result?.failed).toBe(2);
      expect(result.current.result?.errors[0]).toMatchObject({
        id: 'batch_0',
        error: expect.stringContaining('bulk delete'),
      });
    });

    it('still captures pre-mutation snapshot so undo works even when bulk succeeded', async () => {
      const bulkUpdate = vi.fn(async () => 2);
      const update = vi.fn(async () => ({}));
      const ds = { update, delete: vi.fn(), bulkUpdate };
      const rows = [
        { id: '1', priority: 'low' },
        { id: '2', priority: 'medium' },
      ];
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(upd(), rows, {});
      });

      expect(bulkUpdate).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.undo();
      });

      // Undo replays per-row prev values because each row has its own snapshot.
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith('task', '1', { priority: 'low' });
      expect(update).toHaveBeenCalledWith('task', '2', { priority: 'medium' });
    });
  });

  // objectui#13442 — a bulk call that names its failed rows keeps them per
  // record, and a run's writes notify subscribed views once, not per row.
  describe('per-record bulk results and one refresh per run (objectui#13442)', () => {
    it('keeps each failed row under its own id and reason when bulkUpdate returns a BulkWriteResult', async () => {
      const bulkUpdate = vi.fn(async () => ({
        succeeded: 2,
        errors: [{ id: '2', error: 'Discharge date is required before push' }],
      }));
      const ds = { update: vi.fn(), delete: vi.fn(), bulkUpdate };
      const rows = [
        { id: '1', priority: 'low' },
        { id: '2', priority: 'low' },
        { id: '3', priority: 'low' },
      ];
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(upd(), rows, {});
      });

      expect(result.current.result).toEqual({
        total: 3,
        succeeded: 2,
        failed: 1,
        errors: [{ id: '2', error: 'Discharge date is required before push' }],
      });
      expect(ds.update).not.toHaveBeenCalled();

      // The failed row is now a record Retry can act on.
      ds.update.mockResolvedValueOnce({});
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.retry('2');
      });
      expect(ok).toBe(true);
      expect(ds.update).toHaveBeenCalledWith('task', '2', { priority: 'high' });
      expect(result.current.result?.errors).toEqual([]);

      // ...and undo skips it: only the rows that landed in the run are reverted.
      ds.update.mockClear();
      ds.update.mockResolvedValue({});
      await act(async () => {
        await result.current.undo();
      });
      expect(ds.update.mock.calls.map((c) => c[1]).sort()).toEqual(['1', '3']);
    });

    it('keeps each failed row of a bulkDelete BulkWriteResult too', async () => {
      const bulkDelete = vi.fn(async () => ({
        succeeded: 1,
        errors: [
          { id: '1', error: 'Cannot delete a closed order' },
          { id: '3', error: 'Record was not deleted' },
        ],
      }));
      const ds = { update: vi.fn(), delete: vi.fn(), bulkDelete };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(
          { name: 'rm', operation: 'delete' } as BulkActionDef,
          [{ id: '1' }, { id: '2' }, { id: '3' }],
          {},
        );
      });

      expect(result.current.result?.failed).toBe(2);
      expect(result.current.result?.errors).toEqual([
        { id: '1', error: 'Cannot delete a closed order' },
        { id: '3', error: 'Record was not deleted' },
      ]);
    });

    it('runs every write of a run inside ONE batchMutationEvents scope when the adapter has it', async () => {
      let open = 0;
      let scopes = 0;
      const writesInsideScope: string[] = [];
      const writesOutsideScope: string[] = [];
      // A plain generic function, not a `vi.fn`: a mock's type is not generic,
      // so it would not satisfy the `DataSource` member it stands in for.
      async function batchMutationEvents<R>(work: () => Promise<R>): Promise<R> {
        scopes += 1;
        open += 1;
        try {
          return await work();
        } finally {
          open -= 1;
        }
      }
      const update = vi.fn(async (_: string, id: string) => {
        (open > 0 ? writesInsideScope : writesOutsideScope).push(id);
        return {};
      });
      const ds = { update, delete: vi.fn(), batchMutationEvents };
      const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), priority: 'low' }));
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      // batchSize 1: every row on the per-row path, one batch per row.
      await act(async () => {
        await result.current.run(upd({ batchSize: 1 }), rows, {});
      });

      expect(scopes).toBe(1);
      expect(writesInsideScope).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(writesOutsideScope).toEqual([]);

      // Undo replays N updates: one scope for the whole replay as well.
      writesInsideScope.length = 0;
      await act(async () => {
        await result.current.undo();
      });
      expect(scopes).toBe(2);
      expect(writesInsideScope.sort()).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(writesOutsideScope).toEqual([]);
    });

    it('runs unscoped, as before, when the adapter has no batchMutationEvents', async () => {
      const update = vi.fn(async () => ({}));
      const ds = { update, delete: vi.fn() };
      const { result } = renderHook(() => useBulkExecutor({ resource: 'task', dataSource: ds }));

      await act(async () => {
        await result.current.run(upd({ batchSize: 1 }), [{ id: '1' }, { id: '2' }], {});
      });

      expect(update).toHaveBeenCalledTimes(2);
      expect(result.current.result?.succeeded).toBe(2);
    });
  });

  // [#3139] `execution: 'aggregate'` — ONE dispatch for the whole selection,
  // pinned side by side with the per-record semantics above so neither can
  // drift into the other.
  describe('aggregate execution', () => {
    const agg = (op: Partial<BulkActionDef> = {}): BulkActionDef => ({
      name: 'generate_qr_zip',
      operation: 'custom',
      execution: 'aggregate',
      actionDef: { name: 'generate_qr_zip', type: 'api', target: '/api/v1/qr/zip' },
      ...op,
    } as BulkActionDef);
    const ds = () => ({ update: vi.fn(), delete: vi.fn() });

    // A stub that DECLARES the parameters the hook really passes.
    // `BulkExecutorOptions.runAggregate` is `(def, rows, params)` and the hook
    // dispatches it with all three (`hooks/useBulkExecutor.ts`), but a bare
    // `vi.fn(async () => undefined)` declares none of them: vitest records the
    // real arguments at runtime, so `mock.calls[0][1]` works while the compiler
    // is told the call tuple has length 0. The cases below read that second
    // argument and papered over the contradiction with casts — a types-only lie
    // about the exact signature they exist to pin (#4277). Typing it here once
    // makes the reads compile on their own and keeps every aggregate case
    // agreeing about the dispatcher's shape.
    const aggregateStub = () =>
      vi.fn(
        async (
          _def: BulkActionDef,
          _rows: Array<Record<string, unknown>>,
          _params: Record<string, unknown>,
        ): Promise<unknown> => undefined,
      );

    it('dispatches runAggregate exactly once with every row and the params', async () => {
      const runAggregate = aggregateStub();
      const runAction = vi.fn(async () => undefined);
      const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction, runAggregate }));

      await act(async () => {
        await result.current.run(agg(), rows, { format: 'png' });
      });

      expect(runAggregate).toHaveBeenCalledTimes(1);
      const [defArg, rowsArg, paramsArg] = runAggregate.mock.calls[0];
      expect(defArg.name).toBe('generate_qr_zip');
      expect(rowsArg.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
      expect(paramsArg).toEqual({ format: 'png' });
      // The per-record dispatcher must never fire in aggregate mode.
      expect(runAction).not.toHaveBeenCalled();
      expect(result.current.result).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
    });

    it('a single-row selection still goes through the ONE aggregate call, never per-record', async () => {
      const runAggregate = aggregateStub();
      const runAction = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction, runAggregate }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'only' }], {});
      });

      expect(runAggregate).toHaveBeenCalledTimes(1);
      expect(runAction).not.toHaveBeenCalled();
      expect(result.current.result?.succeeded).toBe(1);
    });

    it('ignores batchSize — 5 rows with batchSize 2 is still one call', async () => {
      const runAggregate = aggregateStub();
      const rows = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAggregate }));

      await act(async () => {
        await result.current.run(agg({ batchSize: 2 }), rows, {});
      });

      expect(runAggregate).toHaveBeenCalledTimes(1);
      expect(runAggregate.mock.calls[0][1].length).toBe(5);
      expect(result.current.result?.succeeded).toBe(5);
    });

    // [objectstack#34173] A rejection is ONE outcome for the selection, not
    // the same error attributed to every id: the one call cannot say which
    // rows it wrote before it stopped.
    it('a failed aggregate call is one outcome for the selection — no per-id error, no per-record re-dispatch', async () => {
      const runAggregate = vi.fn(async () => {
        throw new Error('zip generation failed');
      });
      const runAction = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction, runAggregate }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }, { id: 'b' }], {});
      });

      expect(runAggregate).toHaveBeenCalledTimes(1);
      expect(runAction).not.toHaveBeenCalled();
      expect(result.current.result?.aggregateRejection).toEqual({ message: 'zip generation failed' });
      expect(result.current.result?.errors).toEqual([]);
      expect(result.current.result?.succeeded).toBe(0);
    });

    it('the rejection reports its producer-marked userMessage, not its message', async () => {
      const runAggregate = vi.fn(async () => {
        throw Object.assign(new Error('HOOK_ABORTED: deal_b is closed_won'), {
          userMessage: 'Deal B is Closed Won and was not moved.',
        });
      });
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'opportunity', dataSource: ds(), runAggregate }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }, { id: 'b' }], {});
      });

      expect(result.current.result?.aggregateRejection).toEqual({
        message: 'Deal B is Closed Won and was not moved.',
      });
      expect(result.current.result?.errors).toEqual([]);
    });

    it('a resolved aggregate call carries no rejection', async () => {
      const runAggregate = aggregateStub();
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAggregate }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }, { id: 'b' }], {});
      });

      expect(result.current.result?.aggregateRejection).toBeUndefined();
      expect(result.current.result).toMatchObject({ total: 2, succeeded: 2, failed: 0, errors: [] });
    });

    it('fails loudly when no runAggregate is wired instead of degrading to per-record fan-out', async () => {
      const runAction = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }, { id: 'b' }], {});
      });

      expect(runAction).not.toHaveBeenCalled();
      expect(result.current.result?.aggregateRejection?.message).toContain('no dispatcher wired');
      expect(result.current.result?.errors).toEqual([]);
    });

    it('retry() refuses aggregate rows — the whole-run re-run is the retry', async () => {
      const runAggregate = vi.fn(async () => {
        throw new Error('boom');
      });
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAggregate }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }], {});
      });
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.retry('a');
      });
      expect(ok).toBe(false);
      expect(runAggregate).toHaveBeenCalledTimes(1);
    });

    it('a def WITHOUT execution: aggregate keeps per-record dispatch even when runAggregate is wired', async () => {
      const runAggregate = aggregateStub();
      const runAction = vi.fn(async () => undefined);
      const rows = [{ id: '1' }, { id: '2' }];
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction, runAggregate }));

      await act(async () => {
        await result.current.run(agg({ execution: undefined }), rows, {});
      });

      // Mode selection lives on the def, not on which capabilities are wired.
      expect(runAggregate).not.toHaveBeenCalled();
      expect(runAction).toHaveBeenCalledTimes(2);
      expect(result.current.result?.succeeded).toBe(2);
    });
  });
});

// An aggregate handler's resolve value is read per row against the ids the
// run dispatched (`readAggregateResult`, `BulkActionResultSchema` in
// `@objectstack/spec/ui`). A rejection stays the one-outcome report above.
describe('useBulkExecutor — an aggregate run reads its BulkActionResult per row', () => {
  const agg = (): BulkActionDef => ({
    name: 'mass_update_stage',
    operation: 'custom',
    execution: 'aggregate',
    actionDef: { name: 'mass_update_stage', type: 'script' },
  } as BulkActionDef);
  const ds = () => ({ update: vi.fn(), delete: vi.fn() });
  const ROWS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  async function runResolving(value: unknown) {
    const runAggregate = vi.fn(
      async (
        _def: BulkActionDef,
        _rows: Array<Record<string, unknown>>,
        _params: Record<string, unknown>,
      ): Promise<unknown> => value,
    );
    const { result } = renderHook(() =>
      useBulkExecutor({ resource: 'opportunity', dataSource: ds(), runAggregate }));
    await act(async () => {
      await result.current.run(agg(), ROWS, {});
    });
    expect(runAggregate).toHaveBeenCalledTimes(1);
    return result.current.result!;
  }

  it('reports the moved count and each failed row with its message', async () => {
    const r = await runResolving({ succeeded: ['a', 'c'], failed: [{ id: 'b', message: 'B is Closed Won' }] });
    expect(r).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(r.errors).toEqual([{ id: 'b', error: 'B is Closed Won' }]);
    expect(r.aggregateUnconfirmed).toBeUndefined();
    expect(r.aggregateUnreadable).toBeUndefined();
    expect(r.aggregateRejection).toBeUndefined();
  });

  it('drops an id outside the dispatched selection', async () => {
    const r = await runResolving({
      succeeded: ['a', 'b', 'c', 'zz'],
      failed: [{ id: 'yy', message: 'not selected' }],
    });
    expect(r).toMatchObject({ succeeded: 3, failed: 0, errors: [] });
  });

  it('counts a duplicate id once', async () => {
    const r = await runResolving({ succeeded: ['a', 'a', 'b', 'c', 'c'], failed: [] });
    expect(r).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
  });

  it('counts an id listed in both lists as failed', async () => {
    const r = await runResolving({ succeeded: ['a', 'b', 'c'], failed: [{ id: 'b', message: 'refused' }] });
    expect(r).toMatchObject({ succeeded: 2, failed: 1 });
    expect(r.errors).toEqual([{ id: 'b', error: 'refused' }]);
  });

  it('keeps the first entry when one id is in failed twice with different messages', async () => {
    const r = await runResolving({
      succeeded: ['a', 'c'],
      failed: [{ id: 'b', message: 'first reason' }, { id: 'b', message: 'second reason' }],
    });
    expect(r.failed).toBe(1);
    expect(r.errors).toEqual([{ id: 'b', error: 'first reason' }]);
  });

  it('reports a selected id in neither list as not confirmed, never as succeeded', async () => {
    const r = await runResolving({ succeeded: ['a'], failed: [] });
    expect(r).toMatchObject({ total: 3, succeeded: 1, failed: 0, errors: [] });
    expect(r.aggregateUnconfirmed).toEqual(['b', 'c']);
  });

  it.each([
    ['counts in place of lists (the data plane batch shape)', { succeeded: 2, failed: 1 }],
    ['a failed entry spelled with error instead of message', { succeeded: ['a'], failed: [{ id: 'b', error: 'x' }] }],
    ['only one of the two members', { succeeded: ['a', 'b', 'c'] }],
    ['a numeric id', { succeeded: [1, 2, 3], failed: [] }],
  ])('reports a value carrying succeeded/failed that does not parse as unreadable, never as full success: %s', async (_label, value) => {
    const r = await runResolving(value);
    expect(r.aggregateUnreadable).toBe(true);
    expect(r.succeeded).toBe(0);
    expect(r.errors).toEqual([]);
    expect(r.aggregateRejection).toBeUndefined();
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a summary', { moved: 3 }],
    ['an artifact link', { url: 'https://example.test/qr.zip' }],
    ['an array', ['a']],
  ])('CONTROL: a value with neither member keeps today\'s report: %s', async (_label, value) => {
    const r = await runResolving(value);
    expect(r).toEqual({ total: 3, succeeded: 3, failed: 0, errors: [] });
  });
});
