/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10712 (objectui#10713 folded in) — `useRecordQuery` commits only
 * the answer to its LATEST query.
 *
 * `runQuery` is called from three places: the page / sort / filter effect, the
 * debounced search, and `refetch`. Each call awaits `dataSource.find`, and a
 * later call can be issued while an earlier one is still in flight. An earlier
 * call is then SUPERSEDED: whatever it answers, and whenever, it must neither
 * replace the current records, total or error, nor end the loading state the
 * current call is still in. `LookupField`, the people picker and
 * `RecordPickerDialog` read their results from this hook, so a user who types
 * or filters faster than the server answers otherwise sees the results of an
 * earlier query.
 *
 * Every `find` returns a promise the test settles by hand, so each ordering
 * below is the ordering the answers really land in.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRecordQuery } from './useRecordQuery';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type FindCall = Deferred<any> & { params: Record<string, any> };

/** Every `find` returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const calls: FindCall[] = [];
  const dataSource = {
    find: vi.fn((_objectName: string, params: Record<string, any>) => {
      const d = deferred<any>();
      calls.push({ ...d, params });
      return d.promise;
    }),
  } as any;
  return { dataSource, calls };
}

/** The `n`-th `find` call (1-based) once it has been issued. */
async function nth(calls: FindCall[], n: number): Promise<FindCall> {
  await waitFor(() => {
    if (calls.length < n) throw new Error(`find ${n} not issued yet (${calls.length} so far)`);
  });
  return calls[n - 1];
}

const answer = (call: FindCall, label: string, total: number) =>
  act(async () => {
    call.resolve({ data: [{ id: label, name: label }], total });
    await Promise.resolve();
  });

const reject = (call: FindCall, message: string) =>
  act(async () => {
    call.reject(new Error(message));
    await Promise.resolve();
  });

const names = (records: any[]) => records.map((r) => r.name);

describe('useRecordQuery keeps the answer to its LATEST query (objectui#10712, objectui#10713)', () => {
  it('control: a single query commits its records and total and ends loading', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o' }));

    const first = await nth(calls, 1);
    expect(result.current.loading).toBe(true);
    await answer(first, 'only', 1);

    expect(names(result.current.records)).toEqual(['only']);
    expect(result.current.total).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('filter change: a SUPERSEDED answer that lands last leaves the current records and total', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource, objectName: 'o', filter }),
      { initialProps: { filter: { status: 'open' } as Record<string, any> } },
    );
    const superseded = await nth(calls, 1);

    // The filter changes while the first query is still in flight.
    rerender({ filter: { status: 'closed' } });
    const current = await nth(calls, 2);
    expect(current.params.$filter).toEqual({ status: 'closed' });
    await answer(current, 'closed', 7);
    expect(names(result.current.records)).toEqual(['closed']);

    await answer(superseded, 'open (stale)', 99);

    expect(names(result.current.records), 'the superseded answer replaced the current results').toEqual(['closed']);
    expect(result.current.total).toBe(7);
    expect(result.current.loading).toBe(false);
  });

  it('debounced search: a SUPERSEDED search answer that lands last leaves the current results', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o', debounceMs: 0 }));
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    const superseded = await nth(calls, 2);
    expect(superseded.params.$search).toBe('a');
    act(() => result.current.setSearch('ab'));
    const current = await nth(calls, 3);
    expect(current.params.$search).toBe('ab');

    await answer(current, 'ab', 2);
    await answer(superseded, 'a (stale)', 5);

    expect(names(result.current.records), 'the answer for "a" replaced the answer for "ab"').toEqual(['ab']);
    expect(result.current.total).toBe(2);
  });

  it('sort: a SUPERSEDED answer that lands last leaves the sorted results', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o' }));
    const superseded = await nth(calls, 1);

    act(() => result.current.toggleSort('name'));
    const current = await nth(calls, 2);
    expect(current.params.$orderby).toEqual({ name: 'asc' });

    await answer(current, 'sorted', 3);
    await answer(superseded, 'unsorted (stale)', 3);

    expect(names(result.current.records), 'the unsorted answer replaced the sorted one').toEqual(['sorted']);
  });

  it('refetch: a SUPERSEDED answer that lands last leaves the refetched results', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o' }));
    const superseded = await nth(calls, 1);

    act(() => result.current.refetch());
    const current = await nth(calls, 2);

    await answer(current, 'refetched', 4);
    await answer(superseded, 'first (stale)', 4);

    expect(names(result.current.records), 'the first answer replaced the refetched one').toEqual(['refetched']);
  });

  it('loading: a SUPERSEDED answer that lands first does not end the loading state the current query is in', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource, objectName: 'o', filter }),
      { initialProps: { filter: { status: 'open' } as Record<string, any> } },
    );
    const superseded = await nth(calls, 1);
    rerender({ filter: { status: 'closed' } });
    const current = await nth(calls, 2);

    await answer(superseded, 'open (stale)', 99);

    expect(result.current.loading, 'a superseded answer ended the current query\'s loading state').toBe(true);
    expect(names(result.current.records), 'a superseded answer was committed').toEqual([]);

    await answer(current, 'closed', 7);
    expect(result.current.loading, 'the current query did not end the loading state').toBe(false);
    expect(names(result.current.records)).toEqual(['closed']);
  });

  it('errors: a SUPERSEDED query that fails last neither reports its error nor clears the current results', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource, objectName: 'o', filter }),
      { initialProps: { filter: { status: 'open' } as Record<string, any> } },
    );
    const superseded = await nth(calls, 1);
    rerender({ filter: { status: 'closed' } });
    const current = await nth(calls, 2);

    await answer(current, 'closed', 7);
    await reject(superseded, 'superseded query failed');

    expect(result.current.error, 'a superseded failure was reported over the current results').toBeNull();
    expect(names(result.current.records)).toEqual(['closed']);
  });

  it('errors: the CURRENT query that fails reports its error and ends loading, whatever the superseded one does', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource, objectName: 'o', filter }),
      { initialProps: { filter: { status: 'open' } as Record<string, any> } },
    );
    const superseded = await nth(calls, 1);
    rerender({ filter: { status: 'closed' } });
    const current = await nth(calls, 2);

    await reject(current, 'current query failed');
    expect(result.current.error).toBe('current query failed');
    expect(result.current.loading).toBe(false);

    await answer(superseded, 'open (stale)', 99);

    expect(result.current.error, 'a superseded answer cleared the current failure').toBe('current query failed');
    expect(names(result.current.records), 'a superseded answer was committed over the current failure').toEqual([]);
  });
});
