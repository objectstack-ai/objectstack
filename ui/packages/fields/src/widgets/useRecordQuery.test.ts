/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRecordQuery } from './useRecordQuery';

function makeDataSource(result: any = { data: [], total: 0 }) {
  return { find: vi.fn().mockResolvedValue(result) } as any;
}

describe('useRecordQuery', () => {
  it('fetches on mount with $top and exposes records/total', async () => {
    const ds = makeDataSource({ data: [{ id: 1 }], total: 5 });
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'sys_user' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ds.find).toHaveBeenCalledWith('sys_user', { $top: 50 });
    expect(result.current.records).toEqual([{ id: 1 }]);
    expect(result.current.total).toBe(5);
  });

  it('tolerates a bare-array response (no { data } envelope)', async () => {
    const ds = { find: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) } as any;
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'o' }),
    );

    await waitFor(() => expect(result.current.records).toHaveLength(2));
    expect(result.current.total).toBe(2);
  });

  it('adds $skip only when paginate is set', async () => {
    const ds = makeDataSource({ data: [], total: 100 });
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'o', pageSize: 10, paginate: true }),
    );

    await waitFor(() => expect(ds.find).toHaveBeenLastCalledWith('o', { $top: 10, $skip: 0 }));
    // waitFor: the call firing doesn't guarantee its promise resolved and
    // setTotal flushed — assert on the settled state, not a bare read.
    await waitFor(() => expect(result.current.totalPages).toBe(10));

    act(() => result.current.setPage(3));
    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', { $top: 10, $skip: 20 }),
    );
  });

  it('debounces setSearch, resets to page 1, and coalesces rapid input', async () => {
    const ds = makeDataSource();
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'o', debounceMs: 20 }),
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1)); // mount fetch

    act(() => {
      result.current.setSearch('a');
      result.current.setSearch('ab');
    });

    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', { $top: 50, $search: 'ab' }),
    );
    // The superseded 'a' term never reached the server.
    expect(ds.find).not.toHaveBeenCalledWith('o', { $top: 50, $search: 'a' });
  });

  it('toggleSort sets $orderby asc then flips to desc', async () => {
    const ds = makeDataSource();
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'o' }),
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    act(() => result.current.toggleSort('name'));
    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', { $top: 50, $orderby: { name: 'asc' } }),
    );

    act(() => result.current.toggleSort('name'));
    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', { $top: 50, $orderby: { name: 'desc' } }),
    );
  });

  it('passes $filter and refetches when the filter value changes', async () => {
    const ds = makeDataSource();
    const { rerender } = renderHook(
      ({ filter }) => useRecordQuery({ dataSource: ds, objectName: 'o', filter }),
      { initialProps: { filter: { banned: { $ne: true } } as Record<string, any> } },
    );

    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', {
        $top: 50,
        $filter: { banned: { $ne: true } },
      }),
    );

    rerender({ filter: { banned: { $ne: true }, active: true } });
    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('o', {
        $top: 50,
        $filter: { banned: { $ne: true }, active: true },
      }),
    );
  });

  it('passes $expand and $searchFields through', async () => {
    const ds = makeDataSource();
    renderHook(() =>
      useRecordQuery({
        dataSource: ds,
        objectName: 'sys_user',
        expand: ['primary_business_unit_id'],
        searchFields: ['name', 'email'],
      }),
    );

    await waitFor(() =>
      expect(ds.find).toHaveBeenLastCalledWith('sys_user', {
        $top: 50,
        $expand: ['primary_business_unit_id'],
        $searchFields: ['name', 'email'],
      }),
    );
  });

  it('does not fetch while disabled and clears records when re-disabled', async () => {
    const ds = makeDataSource({ data: [{ id: 1 }], total: 1 });
    const { result, rerender } = renderHook(
      ({ enabled }) => useRecordQuery({ dataSource: ds, objectName: 'o', enabled }),
      { initialProps: { enabled: false } },
    );

    await new Promise(r => setTimeout(r, 20));
    expect(ds.find).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.records).toEqual([{ id: 1 }]));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.records).toEqual([]));
  });

  it('captures fetch errors and empties the result set', async () => {
    const ds = { find: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: ds, objectName: 'o' }),
    );

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.records).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('stays idle when no dataSource is provided', async () => {
    const { result } = renderHook(() =>
      useRecordQuery({ dataSource: null, objectName: 'o' }),
    );

    await new Promise(r => setTimeout(r, 10));
    expect(result.current.loading).toBe(false);
    expect(result.current.records).toEqual([]);
  });
});
