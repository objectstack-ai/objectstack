/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32165 — the render-scoped coalescer: which queries share a batch
 * request, and how each caller gets its own outcome back.
 */
import { describe, it, expect, vi } from 'vitest';
import { createDatasetQueryCoalescer, type DatasetBatchOutcome } from '../datasetQueryBatch';

function makeSource(batch = true) {
  const queryDataset = vi.fn(async (dataset: unknown) => ({ single: dataset }));
  const queryDatasetBatch = vi.fn(async (queries: Array<{ dataset: unknown }>, _options?: { packageId?: string }): Promise<DatasetBatchOutcome[]> =>
    queries.map(({ dataset }) => (dataset === 'refused'
      ? { status: 'rejected', reason: new Error(`refused ${String(dataset)}`) }
      : { status: 'fulfilled', value: { batched: dataset } })));
  return { queryDataset, queryDatasetBatch, source: batch ? { queryDataset, queryDatasetBatch } : { queryDataset } };
}

describe('createDatasetQueryCoalescer (objectstack#32165)', () => {
  it('sends the queries asked in one task as one batch, and settles each caller with its own outcome', async () => {
    const { source, queryDataset, queryDatasetBatch } = makeSource();
    const coalescer = createDatasetQueryCoalescer(source);
    const asked = [
      coalescer.queryDataset('a', { measures: ['n'] }),
      coalescer.queryDataset('refused', { measures: ['n'] }),
      coalescer.queryDataset('b', { measures: ['n'] }),
    ];
    const settled = await Promise.allSettled(asked);
    expect(queryDatasetBatch).toHaveBeenCalledTimes(1);
    expect(queryDatasetBatch.mock.calls[0][0].map((q) => q.dataset)).toEqual(['a', 'refused', 'b']);
    expect(queryDataset).not.toHaveBeenCalled();
    expect(settled[0]).toEqual({ status: 'fulfilled', value: { batched: 'a' } });
    expect(settled[1].status).toBe('rejected');
    expect(settled[2]).toEqual({ status: 'fulfilled', value: { batched: 'b' } });
  });

  it('one batch per package and preview intent; a query alone in its group takes the single door with its own arguments', async () => {
    const { source, queryDataset, queryDatasetBatch } = makeSource();
    const coalescer = createDatasetQueryCoalescer(source);
    await Promise.all([
      coalescer.queryDataset('a', {}, { packageId: 'crm' }),
      coalescer.queryDataset('b', {}, { packageId: 'crm' }),
      coalescer.queryDataset('c', {}),
      coalescer.queryDataset('d', {}, { packageId: 'hr' }),
      coalescer.queryDataset('e', {}, { packageId: 'hr' }),
    ]);
    expect(queryDatasetBatch.mock.calls.map(([queries, options]) => [queries.map((q) => q.dataset), options]))
      .toEqual([[['a', 'b'], { packageId: 'crm' }], [['d', 'e'], { packageId: 'hr' }]]);
    expect(queryDataset.mock.calls).toEqual([['c', {}]]);
  });

  it('a later task opens a new window', async () => {
    const { source, queryDatasetBatch, queryDataset } = makeSource();
    const coalescer = createDatasetQueryCoalescer(source);
    await Promise.all([coalescer.queryDataset('a', {}), coalescer.queryDataset('b', {})]);
    await coalescer.queryDataset('c', {});
    expect(queryDatasetBatch).toHaveBeenCalledTimes(1);
    expect(queryDataset.mock.calls).toEqual([['c', {}]]);
  });

  it('a data source with no batch door is asked once per query, unchanged', async () => {
    const { source, queryDataset } = makeSource(false);
    const coalescer = createDatasetQueryCoalescer(source);
    await Promise.all([coalescer.queryDataset('a', {}), coalescer.queryDataset('b', {}, { packageId: 'crm' })]);
    expect(queryDataset.mock.calls).toEqual([['a', {}], ['b', {}, { packageId: 'crm' }]]);
  });

  it('a batch door that throws refuses every query it was handed with that error', async () => {
    const failure = new Error('batch door down');
    const source = { queryDataset: vi.fn(), queryDatasetBatch: vi.fn(async () => { throw failure; }) };
    const coalescer = createDatasetQueryCoalescer(source);
    const settled = await Promise.allSettled([coalescer.queryDataset('a', {}), coalescer.queryDataset('b', {})]);
    expect(settled).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
  });
});
