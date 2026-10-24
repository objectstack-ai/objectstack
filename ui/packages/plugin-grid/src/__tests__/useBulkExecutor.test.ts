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

    it('attributes a failed aggregate call to every id with the real error — no per-record re-dispatch', async () => {
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
      expect(result.current.result?.succeeded).toBe(0);
      expect(result.current.result?.failed).toBe(2);
      expect(result.current.result?.errors).toEqual([
        { id: 'a', error: 'zip generation failed' },
        { id: 'b', error: 'zip generation failed' },
      ]);
    });

    it('fails loudly when no runAggregate is wired instead of degrading to per-record fan-out', async () => {
      const runAction = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useBulkExecutor({ resource: 'device', dataSource: ds(), runAction }));

      await act(async () => {
        await result.current.run(agg(), [{ id: 'a' }, { id: 'b' }], {});
      });

      expect(runAction).not.toHaveBeenCalled();
      expect(result.current.result?.failed).toBe(2);
      expect(result.current.result?.errors[0].error).toContain('no dispatcher wired');
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
