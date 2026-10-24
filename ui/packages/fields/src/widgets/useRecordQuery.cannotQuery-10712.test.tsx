/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10712 — `useRecordQuery` commits nothing once it can no longer
 * query, and a pending debounced search never runs an older query.
 *
 * PR objectui#10723 numbered every `runQuery` call that issues a read
 * (`runSeqRef`), so only the latest call commits. Three ways a read in flight
 * is superseded were left outside that number:
 *
 *   - `enabled` goes false (a dialog closes). The reset effect cleared the
 *     records, but the read in flight was still the latest run: its answer
 *     then committed over the cleared state, and until it landed `loading`
 *     stayed true — against the hook's own header, which says it clears
 *     itself when `enabled` goes false. `reset()` had the same gap.
 *   - `objectName` or `dataSource` goes null. Nothing reset at all: the
 *     previous object's records stayed, and a read in flight committed.
 *   - The debounced `setSearch` timer closes over the `runQuery` in scope when
 *     it was armed. A filter, object or data-source change inside the debounce
 *     window re-ran the query through the fetch effect (with the typed term),
 *     and the timer then ran the OLDER closure — the previous filter — as a
 *     call numbered latest, so its answer won. A sort or page change inside
 *     the window did the same without moving `runQuery`: `setSearch` arms the
 *     timer with page 1 and the sort in scope, so it ran the older sort or
 *     page.
 *
 * Now the reset is keyed on the hook's ability to query (`enabled`, the data
 * source and the object together): it bumps the run number, ends `loading`,
 * clears a pending debounced search and clears the query state; `reset()`
 * does the same. And a pending debounced search is dropped whenever the fetch
 * effect is about to run a query (`runQuery`, `page` or `sort` moves), since
 * that query carries the typed term.
 *
 * Every `find` returns a promise the test settles by hand, so each ordering
 * below is the ordering the answers really land in. The one timer here is the
 * hook's own debounce, given a real window the test outwaits.
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

type FindCall = Deferred<any> & { objectName: string; params: Record<string, any> };

/** Every `find` returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const calls: FindCall[] = [];
  const dataSource = {
    find: vi.fn((objectName: string, params: Record<string, any>) => {
      const d = deferred<any>();
      calls.push({ ...d, objectName, params });
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

const names = (records: any[]) => records.map((r) => r.name);

/** Outwaits the hook's debounce window (`DEBOUNCE_MS`) with real timers. */
const DEBOUNCE_MS = 30;
const outwaitDebounce = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 3));
  });

describe('useRecordQuery commits nothing once it can no longer query (objectui#10712)', () => {
  it('control: an enabled query commits its records and ends loading', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o' }));

    const first = await nth(calls, 1);
    expect(result.current.loading).toBe(true);
    await answer(first, 'only', 1);

    expect(names(result.current.records)).toEqual(['only']);
    expect(result.current.loading).toBe(false);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('`enabled` goes false while a read is in flight: loading ends at once, and the late answer commits nothing', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ enabled }) => useRecordQuery({ dataSource, objectName: 'o', enabled }),
      { initialProps: { enabled: true } },
    );
    const inFlight = await nth(calls, 1);
    expect(result.current.loading).toBe(true);

    rerender({ enabled: false });
    expect(result.current.loading, 'the disable reset left the loading state of a read it superseded').toBe(false);
    expect(result.current.records).toEqual([]);

    await answer(inFlight, 'late', 1);

    expect(names(result.current.records), 'a read superseded by the disable committed after the reset').toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('control: re-enabled while the superseded read is still in flight, the new query is the one that commits (its run number already supersedes the earlier read)', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ enabled }) => useRecordQuery({ dataSource, objectName: 'o', enabled }),
      { initialProps: { enabled: true } },
    );
    const superseded = await nth(calls, 1);

    rerender({ enabled: false });
    rerender({ enabled: true });
    const current = await nth(calls, 2);
    expect(result.current.loading).toBe(true);

    await answer(superseded, 'late', 9);
    expect(names(result.current.records), 'the superseded read committed over the re-enabled query').toEqual([]);
    expect(result.current.loading, 'the superseded read ended the loading state of the re-enabled query').toBe(true);

    await answer(current, 'fresh', 1);
    expect(names(result.current.records)).toEqual(['fresh']);
    expect(result.current.total).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('`reset()` while a read is in flight: loading ends at once, and the late answer commits nothing', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o' }));
    const inFlight = await nth(calls, 1);
    expect(result.current.loading).toBe(true);

    act(() => result.current.reset());
    expect(result.current.loading, '`reset()` left the loading state of a read it superseded').toBe(false);

    await answer(inFlight, 'late', 1);

    expect(names(result.current.records), 'a read superseded by `reset()` committed after it').toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('`objectName` goes null: the previous object’s records are cleared, and a read in flight commits nothing', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ objectName }) => useRecordQuery({ dataSource, objectName }),
      { initialProps: { objectName: 'o' as string | null } },
    );
    await answer(await nth(calls, 1), 'first', 1);
    expect(names(result.current.records)).toEqual(['first']);

    act(() => result.current.refetch());
    const inFlight = await nth(calls, 2);
    expect(result.current.loading).toBe(true);

    rerender({ objectName: null });
    expect(names(result.current.records), 'the previous object’s records stayed after the object went null').toEqual([]);
    expect(result.current.loading, 'loading stayed on for a read of an object the hook no longer has').toBe(false);

    await answer(inFlight, 'late', 1);

    expect(names(result.current.records), 'a read for the previous object committed after it went null').toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(dataSource.find).toHaveBeenCalledTimes(2);
  });

  it('`dataSource` goes null: the same reset, and the read in flight commits nothing', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ ds }) => useRecordQuery({ dataSource: ds, objectName: 'o' }),
      { initialProps: { ds: dataSource as any | null } },
    );
    const inFlight = await nth(calls, 1);
    expect(result.current.loading).toBe(true);

    rerender({ ds: null });
    expect(result.current.loading, 'loading stayed on for a read through a data source the hook no longer has').toBe(false);

    await answer(inFlight, 'late', 1);

    expect(names(result.current.records), 'a read through the previous data source committed after it went null').toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

describe('useRecordQuery drops a pending debounced search when the query it was armed for changes (objectui#10712)', () => {
  it('control: with nothing else changing, the debounced search fires once with its term', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource, objectName: 'o', filter: { status: 'open' }, debounceMs: DEBOUNCE_MS }),
    );
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    await outwaitDebounce();

    expect(dataSource.find).toHaveBeenCalledTimes(2);
    const searched = calls[1];
    expect(searched.params.$search).toBe('a');
    expect(searched.params.$filter).toEqual({ status: 'open' });
    await answer(searched, 'a', 1);
    expect(names(result.current.records)).toEqual(['a']);
  });

  it('a filter change inside the debounce window: the fetch effect carries the typed term, and the armed timer runs no older query', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource, objectName: 'o', filter, debounceMs: DEBOUNCE_MS }),
      { initialProps: { filter: { status: 'open' } as Record<string, any> } },
    );
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    // The filter changes before the debounce fires. The fetch effect re-runs
    // the query at once, with the current filter and the typed term.
    rerender({ filter: { status: 'closed' } });
    const current = await nth(calls, 2);
    expect(current.params.$filter).toEqual({ status: 'closed' });
    expect(current.params.$search).toBe('a');

    await outwaitDebounce();

    expect(dataSource.find, 'the debounced timer ran the query it was armed with, for the previous filter').toHaveBeenCalledTimes(2);

    await answer(current, 'closed a', 1);
    expect(names(result.current.records)).toEqual(['closed a']);
    expect(result.current.loading).toBe(false);
  });

  it('a sort change inside the debounce window: the fetch effect carries the typed term with the new sort, and the armed timer runs no older query', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o', debounceMs: DEBOUNCE_MS }));
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    // The sort changes before the debounce fires. `runQuery`'s identity does
    // not move on a sort change, so the timer's closure is the current one;
    // what it lacks is the sort, which the fetch effect already carried.
    act(() => result.current.toggleSort('name'));
    const current = await nth(calls, 2);
    expect(current.params.$orderby).toEqual({ name: 'asc' });
    expect(current.params.$search).toBe('a');

    await outwaitDebounce();

    expect(dataSource.find, 'the debounced timer ran the query it was armed with, without the sort').toHaveBeenCalledTimes(2);

    await answer(current, 'sorted a', 1);
    expect(names(result.current.records)).toEqual(['sorted a']);
    expect(result.current.sort).toEqual({ field: 'name', direction: 'asc' });
    expect(result.current.loading).toBe(false);
  });

  it('a page change inside the debounce window (paginate): the fetch effect carries the typed term on the new page, and the armed timer runs no older query', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource, objectName: 'o', paginate: true, pageSize: 10, debounceMs: DEBOUNCE_MS }),
    );
    const first = await nth(calls, 1);
    expect(first.params.$skip).toBe(0);
    await answer(first, 'initial', 30);

    act(() => result.current.setSearch('a'));
    act(() => result.current.setPage(2));
    const current = await nth(calls, 2);
    expect(current.params.$skip).toBe(10);
    expect(current.params.$search).toBe('a');

    await outwaitDebounce();

    expect(dataSource.find, 'the debounced timer ran the query it was armed with, for page 1').toHaveBeenCalledTimes(2);

    await answer(current, 'page 2 a', 30);
    expect(names(result.current.records)).toEqual(['page 2 a']);
    expect(result.current.page).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it('control: `reset()` inside the debounce window drops the pending search, as before', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result } = renderHook(() => useRecordQuery({ dataSource, objectName: 'o', debounceMs: DEBOUNCE_MS }));
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    act(() => result.current.reset());
    await outwaitDebounce();

    expect(dataSource.find, 'a pending search ran after `reset()`').toHaveBeenCalledTimes(1);
    expect(result.current.search).toBe('');
    expect(result.current.records).toEqual([]);
  });

  it('`enabled` goes false inside the debounce window: the pending search never runs', async () => {
    const { dataSource, calls } = makeDeferredDataSource();
    const { result, rerender } = renderHook(
      ({ enabled }) => useRecordQuery({ dataSource, objectName: 'o', enabled, debounceMs: DEBOUNCE_MS }),
      { initialProps: { enabled: true } },
    );
    await answer(await nth(calls, 1), 'initial', 1);

    act(() => result.current.setSearch('a'));
    rerender({ enabled: false });
    await outwaitDebounce();

    expect(dataSource.find, 'a pending search ran after the hook was disabled').toHaveBeenCalledTimes(1);
    expect(result.current.records).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
