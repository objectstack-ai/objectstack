/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36423 — many records' open-thread and attachment counts, ONE
 * grouped read per counted object over the records drawn.
 *
 * Legs: the compiled reads; the answer's reading (only asked records, only
 * whole positive counts, a partial answer keeping the records it names); the
 * hook asks nothing for a count not asked, no records, or a source without
 * the grouped door, asks each once for the set, again when the set or the
 * reload key changes, and draws no count of another set or a refused read.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import {
  compileAttachmentCountQuery,
  compileCommentCountQuery,
  readRecordCounts,
  recordCountIds,
  useRecordCounts,
} from './recordCounts';

afterEach(cleanup);

describe('the count reads', () => {
  it('asks the open top-level threads of the object\'s records, grouped by record', () => {
    expect(compileCommentCountQuery('deal', ['d1', 'd2'])).toEqual({
      where: { object_name: 'deal', record_id: { $in: ['d1', 'd2'] }, parent_id: null, is_resolved: { $ne: true } },
      groupBy: ['record_id'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
  });

  it('asks the attachments of the object\'s records, grouped by record', () => {
    expect(compileAttachmentCountQuery('deal', ['d1'])).toEqual({
      where: { parent_object: 'deal', parent_id: { $in: ['d1'] } },
      groupBy: ['parent_id'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
  });

  it('keys the records by distinct non-empty id, in a stable order', () => {
    expect(recordCountIds(['d2', 'd1', 'd2', '', null, undefined, 7, Number.NaN, {}])).toEqual(['7', 'd1', 'd2']);
  });

  it('reads only the asked records\' whole positive counts', () => {
    const answer = [
      { record_id: 'd1', count: 2 },
      { record_id: 'd2', count: '3' },
      { record_id: 'other', count: 9 },
      { record_id: null, count: 4 },
      { record_id: 'd3', count: 0 },
      { record_id: 'd4', count: 1.5 },
    ];
    expect(readRecordCounts(answer, 'record_id', ['d1', 'd2', 'd3', 'd4'])).toEqual({ d1: 2, d2: 3 });
    expect(readRecordCounts({ records: [] }, 'record_id', ['d1'])).toBeNull();
    const partial = Object.assign([{ record_id: 'd1', count: 2 }], { hasMore: true });
    expect(readRecordCounts(partial, 'record_id', ['d1', 'd2'])).toEqual({ d1: 2 });
  });
});

describe('useRecordCounts', () => {
  const source = (answers: Record<string, unknown> = {}) => ({
    queryGroupHeaders: vi.fn(async (object: string) => {
      const a = answers[object];
      if (a instanceof Error) throw a;
      return (a ?? []) as any;
    }),
  });

  it('asks each asked count once for the set, and reads its answer', async () => {
    const dataSource = source({
      sys_comment: [{ record_id: 'd1', count: 2 }],
      sys_attachment: [{ parent_id: 'd2', count: 1 }],
    });
    const { result } = renderHook(() =>
      useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: ['d1', 'd2'], comments: true, attachments: true }),
    );
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 2 }));
    await waitFor(() => expect(result.current.attachments).toEqual({ d2: 1 }));
    expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for a count not asked, no records, or a source without the grouped door', async () => {
    const dataSource = source();
    const a = renderHook(() => useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: ['d1'], comments: false, attachments: false }));
    const b = renderHook(() => useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: [], comments: true, attachments: true }));
    const c = renderHook(() => useRecordCounts({ dataSource: { find: vi.fn() } as any, objectName: 'deal', recordIds: ['d1'], comments: true, attachments: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dataSource.queryGroupHeaders).not.toHaveBeenCalled();
    for (const r of [a, b, c]) expect(r.result.current).toEqual({ comments: null, attachments: null });
  });

  it('asks again when the set or the reload key changes, and never draws another set\'s counts', async () => {
    let answer: unknown = [{ record_id: 'd1', count: 2 }];
    const dataSource = { queryGroupHeaders: vi.fn(async () => answer as any) };
    const { result, rerender } = renderHook(
      ({ ids, reload }: { ids: string[]; reload: number }) =>
        useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: ids, comments: true, attachments: false, reloadKey: reload }),
      { initialProps: { ids: ['d1'], reload: 0 } },
    );
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 2 }));
    answer = [{ record_id: 'd1', count: 1 }, { record_id: 'd2', count: 4 }];
    rerender({ ids: ['d1', 'd2'], reload: 0 });
    // The new set's question: the old set's counts are not drawn for it.
    expect(result.current.comments).toBeNull();
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 1, d2: 4 }));
    answer = [{ record_id: 'd1', count: 5 }];
    rerender({ ids: ['d1', 'd2'], reload: 1 });
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 5 }));
    expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(3);
  });

  it('draws no count for a refused read', async () => {
    const dataSource = source({ sys_comment: new Error('forbidden') });
    const { result } = renderHook(() =>
      useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: ['d1'], comments: true, attachments: false }),
    );
    await waitFor(() => expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.comments).toBeNull();
  });
});
