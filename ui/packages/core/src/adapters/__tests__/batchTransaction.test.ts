/**
 * ObjectUI — batchTransaction emulation tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BatchTransactionOperation, DataSource } from '@object-ui/types';
import { emulateBatchTransaction, runBatchTransaction } from '../batchTransaction';
import { ValueDataSource } from '../ValueDataSource';

/**
 * Minimal recording DataSource: `create` mints sequential ids, every call is
 * spied so tests can assert order and compensation. `idShape` controls which
 * field the created id is exposed under (to prove `$ref` resolution across
 * `id` / `_id` / `recordId`).
 */
function makeRecordingDataSource(opts?: {
  idShape?: 'id' | '_id' | 'recordId';
  failCreateOn?: string; // object name whose create rejects
}): DataSource & {
  calls: Array<{ op: string; object: string; id?: string | number }>;
} {
  const idShape = opts?.idShape ?? 'id';
  let seq = 0;
  const calls: Array<{ op: string; object: string; id?: string | number }> = [];
  return {
    calls,
    find: vi.fn(),
    findOne: vi.fn(),
    getObjectSchema: vi.fn(),
    create: vi.fn(async (object: string, data: any) => {
      calls.push({ op: 'create', object });
      if (opts?.failCreateOn === object) {
        throw new Error(`create failed for ${object}`);
      }
      const id = `${object}-${++seq}`;
      return { [idShape]: id, ...data };
    }),
    update: vi.fn(async (object: string, id: string | number, data: any) => {
      calls.push({ op: 'update', object, id });
      return { id, ...data };
    }),
    delete: vi.fn(async (object: string, id: string | number) => {
      calls.push({ op: 'delete', object, id });
      return true;
    }),
  } as any;
}

describe('emulateBatchTransaction — happy path', () => {
  it('executes ops in order and returns index-aligned results', async () => {
    const ds = makeRecordingDataSource();
    const ops: BatchTransactionOperation[] = [
      { object: 'project', action: 'create', data: { name: 'Apollo' } },
      { object: 'task', action: 'update', id: 't1', data: { title: 'Kickoff' } },
      { object: 'note', action: 'delete', id: 'n9' },
    ];
    const { results } = await emulateBatchTransaction(ds, ops);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ id: 'project-1', name: 'Apollo' });
    expect(results[1]).toMatchObject({ id: 't1', title: 'Kickoff' });
    expect(results[2]).toBe(true);
    expect(ds.calls.map((c) => c.op)).toEqual(['create', 'update', 'delete']);
  });

  it('defaults a missing action to create', async () => {
    const ds = makeRecordingDataSource();
    await emulateBatchTransaction(ds, [{ object: 'project', data: { name: 'X' } }]);
    expect(ds.create).toHaveBeenCalledTimes(1);
  });
});

describe('emulateBatchTransaction — $ref resolution', () => {
  it.each(['id', '_id', 'recordId'] as const)(
    'resolves { $ref: 0 } against the parent created under %s',
    async (idShape) => {
      const ds = makeRecordingDataSource({ idShape });
      const ops: BatchTransactionOperation[] = [
        { object: 'project', action: 'create', data: { name: 'Apollo' } },
        { object: 'task', action: 'create', data: { title: 'A', project: { $ref: 0 } } },
      ];
      await emulateBatchTransaction(ds, ops);

      // The child's create payload had its { $ref: 0 } rewritten to the
      // parent's minted id.
      expect(ds.create).toHaveBeenLastCalledWith('task', {
        title: 'A',
        project: 'project-1',
      });
    },
  );

  it('throws (and compensates) on a forward / unresolved $ref', async () => {
    const ds = makeRecordingDataSource();
    const ops: BatchTransactionOperation[] = [
      { object: 'project', action: 'create', data: { name: 'P' } },
      // references op 5, which does not exist yet
      { object: 'task', action: 'create', data: { project: { $ref: 5 } } },
    ];
    await expect(emulateBatchTransaction(ds, ops)).rejects.toThrow(/\$ref/);
    // The one successful create (op 0) is compensated.
    expect(ds.delete).toHaveBeenCalledWith('project', 'project-1');
  });
});

describe('emulateBatchTransaction — failure compensation', () => {
  it('deletes created records in reverse order (children before parent) and rethrows', async () => {
    const ds = makeRecordingDataSource({ failCreateOn: 'invoice_line_bad' });
    const ops: BatchTransactionOperation[] = [
      { object: 'invoice', action: 'create', data: { no: 'INV-1' } },
      { object: 'invoice_line', action: 'create', data: { amt: 10, invoice: { $ref: 0 } } },
      { object: 'invoice_line_bad', action: 'create', data: { amt: 20, invoice: { $ref: 0 } } },
    ];
    await expect(emulateBatchTransaction(ds, ops)).rejects.toThrow(/create failed/);

    const deletes = ds.calls.filter((c) => c.op === 'delete');
    // Only the two successful creates are compensated, newest first.
    expect(deletes).toEqual([
      { op: 'delete', object: 'invoice_line', id: 'invoice_line-2' },
      { op: 'delete', object: 'invoice', id: 'invoice-1' },
    ]);
  });

  it('does NOT compensate updates or deletes (only creates)', async () => {
    const ds = makeRecordingDataSource({ failCreateOn: 'boom' });
    const ops: BatchTransactionOperation[] = [
      { object: 'thing', action: 'update', id: 'x1', data: { a: 1 } },
      { object: 'boom', action: 'create', data: {} },
    ];
    await expect(emulateBatchTransaction(ds, ops)).rejects.toThrow();
    // The update ran but no create succeeded → nothing to compensate.
    expect(ds.delete).not.toHaveBeenCalled();
  });

  it('swallows a compensation-delete failure and still rethrows the original error', async () => {
    const ds = makeRecordingDataSource({ failCreateOn: 'child' });
    (ds.delete as any).mockRejectedValueOnce(new Error('delete blew up'));
    const ops: BatchTransactionOperation[] = [
      { object: 'parent', action: 'create', data: {} },
      { object: 'child', action: 'create', data: {} },
    ];
    await expect(emulateBatchTransaction(ds, ops)).rejects.toThrow(/create failed for child/);
  });
});

describe('runBatchTransaction — delegation', () => {
  it('prefers a native batchTransaction when present', async () => {
    const native = vi.fn(async () => ({ results: ['native'] }));
    const ds = { ...makeRecordingDataSource(), batchTransaction: native } as any;
    const res = await runBatchTransaction(ds, [{ object: 'x', data: {} }]);
    expect(native).toHaveBeenCalledTimes(1);
    expect(res.results).toEqual(['native']);
    // The emulation primitives were NOT used.
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('falls back to emulation when batchTransaction is absent', async () => {
    const ds = makeRecordingDataSource();
    delete (ds as any).batchTransaction;
    await runBatchTransaction(ds, [{ object: 'x', action: 'create', data: {} }]);
    expect(ds.create).toHaveBeenCalledTimes(1);
  });
});

describe('emulateBatchTransaction — MutationEvents fire exactly once per op', () => {
  it('drives a real ValueDataSource and emits one event per operation (no double-emit)', async () => {
    const ds = new ValueDataSource({ items: [] as any[] });
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.batchTransaction([
      { object: 'project', action: 'create', data: { id: 'p1', name: 'Apollo' } },
      { object: 'task', action: 'create', data: { id: 't1', title: 'A', project: { $ref: 0 } } },
    ]);

    // Two creates → exactly two events, emitted by the primitives (the
    // emulation helper itself must not emit).
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['create', 'create']);
    // $ref resolved end-to-end through the real adapter.
    const stored = await ds.findOne('task', 't1');
    expect(stored).toMatchObject({ project: 'p1' });
  });
});
