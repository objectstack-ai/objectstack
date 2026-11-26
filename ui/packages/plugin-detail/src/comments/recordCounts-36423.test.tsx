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
 * whole positive counts, a partial answer keeping the records it names); a
 * cut answer (`hasMore`) asked again over the records it did not name, never
 * read as their zero; the hook asks nothing for a count not asked, no
 * records, or a source without the grouped door, asks each once for the set,
 * again when the set, the reload key or a write to the counted object
 * changes, keeps the counts of records in both sets while a new set is asked,
 * and draws no count of another object or a refused read.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import {
  askRecordCounts,
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

describe('a cut answer (hasMore)', () => {
  /** A door that answers at most `page` groups, saying so with `hasMore`. */
  const cuttingDoor = (rows: Array<{ record_id: string; count: number }>, page: number) =>
    vi.fn(async (_object: string, query: any) => {
      const asked = new Set<string>(query.where.record_id.$in);
      const kept = rows.filter((r) => asked.has(r.record_id));
      return Object.assign(kept.slice(0, page), { hasMore: kept.length > page }) as any;
    });

  it('asks again over the records the answer did not name, until it is whole', async () => {
    const door = cuttingDoor(
      [{ record_id: 'd1', count: 2 }, { record_id: 'd2', count: 1 }, { record_id: 'd3', count: 4 }],
      2,
    );
    const counts = await askRecordCounts({ queryGroupHeaders: door }, 'sys_comment', 'deal', ['d1', 'd2', 'd3', 'd4']);
    expect(counts).toEqual({ d1: 2, d2: 1, d3: 4 });
    expect(door).toHaveBeenCalledTimes(2);
    // The second round asks only the records the first did not name.
    expect(door.mock.calls[1][1].where.record_id.$in).toEqual(['d3', 'd4']);
  });

  it('one read when the answer is whole', async () => {
    const door = cuttingDoor([{ record_id: 'd1', count: 2 }], 50);
    expect(await askRecordCounts({ queryGroupHeaders: door }, 'sys_comment', 'deal', ['d1', 'd2'])).toEqual({ d1: 2 });
    expect(door).toHaveBeenCalledTimes(1);
  });

  it('stops on an answer that names none of the records, leaving them without a count', async () => {
    const door = vi.fn(async () => Object.assign([] as any[], { hasMore: true }) as any);
    expect(await askRecordCounts({ queryGroupHeaders: door }, 'sys_comment', 'deal', ['d1'])).toEqual({});
    expect(door).toHaveBeenCalledTimes(1);
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
    // The new set's question: the count of the record in both sets stays drawn
    // until the new answer, and nothing is drawn for the record not yet asked.
    expect(result.current.comments).toEqual({ d1: 2 });
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 1, d2: 4 }));
    answer = [{ record_id: 'd1', count: 5 }];
    rerender({ ids: ['d1', 'd2'], reload: 1 });
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 5 }));
    expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(3);
  });

  it('never draws another object\'s counts for a new object', async () => {
    const dataSource = { queryGroupHeaders: vi.fn(async () => [{ record_id: 'd1', count: 2 }] as any) };
    const { result, rerender } = renderHook(
      ({ objectName }: { objectName: string }) =>
        useRecordCounts({ dataSource: dataSource as any, objectName, recordIds: ['d1'], comments: true, attachments: false }),
      { initialProps: { objectName: 'deal' } },
    );
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 2 }));
    rerender({ objectName: 'lead' });
    expect(result.current.comments).toBeNull();
  });

  it('asks again when a write to the counted object is announced, and not for another object', async () => {
    let answer: unknown = [{ record_id: 'd1', count: 1 }];
    const dataSource = { queryGroupHeaders: vi.fn(async () => answer as any) };
    const { result } = renderHook(() =>
      useRecordCounts({ dataSource: dataSource as any, objectName: 'deal', recordIds: ['d1'], comments: true, attachments: false }),
    );
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 1 }));
    act(() => notifyDataChanged({ objectName: 'sys_attachment', recordId: 'a1' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(1);
    answer = [{ record_id: 'd1', count: 2 }];
    act(() => notifyDataChanged({ objectName: 'sys_comment', recordId: 'c9' }));
    await waitFor(() => expect(result.current.comments).toEqual({ d1: 2 }));
    expect(dataSource.queryGroupHeaders).toHaveBeenCalledTimes(2);
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
