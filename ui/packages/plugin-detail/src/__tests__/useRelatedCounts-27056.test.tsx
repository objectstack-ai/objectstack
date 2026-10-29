/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27056, Targets 1 and 4 — the related column's counts, first.
 *
 * Every card of the column is counted in ONE request set, and the cards wait
 * for the whole set together (one loading state); a failed count leaves its
 * card to read for itself; a drawer's prefetch warms the store the next
 * record's page reads, so that page draws its counts without a read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { RelatedCountStore } from '@object-ui/components';
import {
  prefetchRelatedCounts,
  relatedCountTargetsIn,
  useRelatedCounts,
  type RelatedCountTarget,
} from '../useRelatedCounts';

interface HeldRead {
  object: string;
  query: any;
  resolve: (total: number) => void;
  reject: () => void;
}

function heldSource() {
  const reads: HeldRead[] = [];
  const find = vi.fn(
    (object: string, query: any) =>
      new Promise((resolve, reject) => {
        reads.push({
          object,
          query,
          resolve: (total) => resolve({ data: [], total }),
          reject: () => reject(new Error('refused')),
        });
      }),
  );
  return { reads, dataSource: { find } };
}

const TARGETS: RelatedCountTarget[] = [
  { id: 'task.account', objectName: 'task', relationshipField: 'account' },
  { id: 'note.account', objectName: 'note', relationshipField: 'account' },
  { id: 'case.account', objectName: 'case', relationshipField: 'account' },
];

const FIELDS = { account: { type: 'lookup', reference: 'account' } };

async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => RelatedCountStore._reset());

describe('useRelatedCounts (objectstack#27056)', () => {
  it('asks every count at once and holds every card until the whole set has answered', async () => {
    const { reads, dataSource } = heldSource();
    const { result } = renderHook(() =>
      useRelatedCounts(TARGETS, { parentId: 'acc-1', dataSource, fieldsOf: () => FIELDS }),
    );
    await flush();
    // One request set: the three counts are out together, none answered yet.
    expect(reads.map((r) => r.object)).toEqual(['task', 'note', 'case']);
    // A count reads the total: its one row carries the id alone.
    expect(reads.every((r) => r.query.$count === true && r.query.$top === 1)).toBe(true);
    expect(reads.map((r) => r.query.$select)).toEqual([['id'], ['id'], ['id']]);
    expect(reads.map((r) => r.query.$filter)).toEqual([{ account: 'acc-1' }, { account: 'acc-1' }, { account: 'acc-1' }]);
    expect(TARGETS.map((t) => result.current.stateOf(t.id).kind)).toEqual(['pending', 'pending', 'pending']);

    await act(async () => {
      reads[0].resolve(4);
      reads[1].resolve(0);
    });
    await flush();
    // Two of three answered: still one loading state.
    expect(TARGETS.map((t) => result.current.stateOf(t.id).kind)).toEqual(['pending', 'pending', 'pending']);

    await act(async () => reads[2].resolve(2));
    await flush();
    expect(TARGETS.map((t) => result.current.stateOf(t.id))).toEqual([
      { kind: 'counted', count: 4 },
      { kind: 'counted', count: 0 },
      { kind: 'counted', count: 2 },
    ]);
    // Nothing more is asked once the set has answered.
    expect(dataSource.find).toHaveBeenCalledTimes(3);
  });

  it('the store answering is not the set settling: the cards wait for their own set', async () => {
    const { reads, dataSource } = heldSource();
    const { result } = renderHook(() =>
      useRelatedCounts(TARGETS, { parentId: 'acc-1', dataSource, fieldsOf: () => FIELDS }),
    );
    await flush();
    // Another reader (a tab badge) fills the store while the set is out.
    act(() => {
      TARGETS.forEach((t, i) => RelatedCountStore.set(t.objectName, t.relationshipField, 'acc-1', i + 5));
    });
    expect(TARGETS.map((t) => result.current.stateOf(t.id).kind)).toEqual(['pending', 'pending', 'pending']);

    await act(async () => reads.forEach((r, i) => r.resolve(i + 5)));
    await flush();
    expect(TARGETS.map((t) => result.current.stateOf(t.id).kind)).toEqual(['counted', 'counted', 'counted']);
  });

  it('a drawer stepping back to a settled record draws its counts at once', async () => {
    const { reads, dataSource } = heldSource();
    // Every render's states, so a placeholder flash between two acts shows.
    const drawn: string[] = [];
    const { rerender } = renderHook(
      ({ parentId }) => {
        const counts = useRelatedCounts(TARGETS, { parentId, dataSource, fieldsOf: () => FIELDS });
        drawn.push(`${parentId}:${TARGETS.map((t) => counts.stateOf(t.id).kind).join(',')}`);
        return counts;
      },
      { initialProps: { parentId: 'acc-1' } },
    );
    await flush();
    await act(async () => reads.forEach((r) => r.resolve(1)));
    await flush();
    TARGETS.forEach((t) => RelatedCountStore.set(t.objectName, t.relationshipField, 'acc-2', 2));
    rerender({ parentId: 'acc-2' });
    await flush();
    drawn.length = 0;
    rerender({ parentId: 'acc-1' });
    await flush();
    // Every render back has them: no placeholder flash.
    expect(drawn.length).toBeGreaterThan(0);
    expect(new Set(drawn)).toEqual(new Set(['acc-1:counted,counted,counted']));
    expect(dataSource.find).toHaveBeenCalledTimes(3);
  });

  it('a failed count leaves its card to read for itself; the others are counted', async () => {
    const { reads, dataSource } = heldSource();
    const { result } = renderHook(() =>
      useRelatedCounts(TARGETS, { parentId: 'acc-1', dataSource, fieldsOf: () => FIELDS }),
    );
    await flush();
    await act(async () => {
      reads[0].resolve(3);
      reads[1].reject();
      reads[2].resolve(1);
    });
    await flush();
    expect(TARGETS.map((t) => result.current.stateOf(t.id))).toEqual([
      { kind: 'counted', count: 3 },
      { kind: 'uncounted' },
      { kind: 'counted', count: 1 },
    ]);
    // Not retried in a loop: the failed card reads for itself instead.
    expect(dataSource.find).toHaveBeenCalledTimes(3);
  });

  it('counts nothing without a data source or a parent: every card reads for itself', () => {
    const none = renderHook(() => useRelatedCounts(TARGETS, { parentId: 'acc-1', dataSource: undefined }));
    expect(none.result.current.stateOf('task.account')).toEqual({ kind: 'uncounted' });
    const { dataSource } = heldSource();
    const orphan = renderHook(() => useRelatedCounts(TARGETS, { parentId: null, dataSource }));
    expect(orphan.result.current.stateOf('task.account')).toEqual({ kind: 'uncounted' });
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('a prefetched parent draws its counts at once, with no read of its own (Target 4)', async () => {
    const { reads, dataSource } = heldSource();
    const warm = prefetchRelatedCounts(TARGETS, { parentId: 'acc-2', dataSource, fieldsOf: () => FIELDS });
    await flush();
    expect(reads.map((r) => r.query.$filter)).toEqual([{ account: 'acc-2' }, { account: 'acc-2' }, { account: 'acc-2' }]);
    await act(async () => {
      reads.forEach((r, i) => r.resolve(i + 1));
      await warm;
    });
    const { result } = renderHook(() =>
      useRelatedCounts(TARGETS, { parentId: 'acc-2', dataSource, fieldsOf: () => FIELDS }),
    );
    // The first render already has them.
    expect(TARGETS.map((t) => result.current.stateOf(t.id))).toEqual([
      { kind: 'counted', count: 1 },
      { kind: 'counted', count: 2 },
      { kind: 'counted', count: 3 },
    ]);
    await flush();
    expect(dataSource.find).toHaveBeenCalledTimes(3);
  });

  it('counts a declared scope as the rows read it, with its record token resolved', async () => {
    const { reads, dataSource } = heldSource();
    const scoped: RelatedCountTarget[] = [
      {
        id: 'task.account',
        objectName: 'task',
        relationshipField: 'account',
        filter: [{ field: 'status', operator: 'not_equals', value: 'done' }],
      },
    ];
    renderHook(() => useRelatedCounts(scoped, { parentId: 'acc-1', dataSource, fieldsOf: () => FIELDS }));
    await flush();
    expect(reads).toHaveLength(1);
    expect(JSON.stringify(reads[0].query.$filter)).toContain('not_equals');
    expect(JSON.stringify(reads[0].query.$filter)).toContain('acc-1');
  });
});

describe('relatedCountTargetsIn (objectstack#27056)', () => {
  it('names each related list a page places once, in order, and leaves out gated and bound ones', () => {
    const list = (objectName: string, relationshipField: string, extra: Record<string, unknown> = {}) => ({
      type: 'record:related_list',
      properties: { objectName, relationshipField, ...extra },
    });
    const page = {
      type: 'record',
      regions: [
        {
          components: [
            {
              type: 'page:tabs',
              properties: {
                items: [
                  { value: 'related', children: [list('task', 'account'), list('note', 'account'), list('task', 'account')] },
                  { value: 'gated', visibleWhen: 'record.tier == "gold"', children: [list('case', 'account')] },
                ],
              },
            },
            list('quote', 'account', { dataSource: { object: 'quote' } }),
            list('line', 'account_name', { relationshipValueField: 'name' }),
            list('order', 'account', { filter: { status: 'open' } }),
          ],
        },
      ],
    };
    expect(relatedCountTargetsIn(page)).toEqual([
      { id: 'task.account', objectName: 'task', relationshipField: 'account' },
      { id: 'note.account', objectName: 'note', relationshipField: 'account' },
      { id: 'order.account', objectName: 'order', relationshipField: 'account', filter: { status: 'open' } },
    ]);
  });
});
