/**
 * ObjectUI — useDataRefresh Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Tests for the reusable data-refresh hook (P1/P2).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataRefresh } from '../useDataRefresh';

describe('useDataRefresh', () => {
  it('should return refreshKey=0 and a refresh function', () => {
    const { result } = renderHook(() => useDataRefresh(undefined, undefined));

    expect(result.current.refreshKey).toBe(0);
    expect(typeof result.current.refresh).toBe('function');
  });

  it('should increment refreshKey when refresh() is called', () => {
    const { result } = renderHook(() => useDataRefresh(undefined, 'contacts'));

    act(() => {
      result.current.refresh();
    });

    expect(result.current.refreshKey).toBe(1);

    act(() => {
      result.current.refresh();
    });

    expect(result.current.refreshKey).toBe(2);
  });

  it('should auto-subscribe to DataSource.onMutation() when available', () => {
    let listener: ((event: any) => void) | null = null;
    const unsub = vi.fn();
    const ds: any = {
      onMutation: vi.fn((cb: any) => {
        listener = cb;
        return unsub;
      }),
    };

    const { result } = renderHook(() => useDataRefresh(ds, 'contacts'));

    expect(ds.onMutation).toHaveBeenCalledOnce();

    // Simulate a mutation on the same resource
    act(() => {
      listener?.({ type: 'create', resource: 'contacts' });
    });

    expect(result.current.refreshKey).toBe(1);
  });

  it('should NOT increment refreshKey for mutations on a different resource', () => {
    let listener: ((event: any) => void) | null = null;
    const ds: any = {
      onMutation: vi.fn((cb: any) => {
        listener = cb;
        return vi.fn();
      }),
    };

    const { result } = renderHook(() => useDataRefresh(ds, 'contacts'));

    act(() => {
      listener?.({ type: 'create', resource: 'accounts' });
    });

    expect(result.current.refreshKey).toBe(0);
  });

  it('should unsubscribe on unmount', () => {
    const unsub = vi.fn();
    const ds: any = {
      onMutation: vi.fn(() => unsub),
    };

    const { unmount } = renderHook(() => useDataRefresh(ds, 'contacts'));

    expect(unsub).not.toHaveBeenCalled();

    unmount();

    expect(unsub).toHaveBeenCalledOnce();
  });

  it('should work without onMutation (backward compatible)', () => {
    const ds: any = {
      find: vi.fn(),
    };

    const { result } = renderHook(() => useDataRefresh(ds, 'contacts'));

    expect(result.current.refreshKey).toBe(0);
    // Should not throw
    act(() => {
      result.current.refresh();
    });
    expect(result.current.refreshKey).toBe(1);
  });

  it('should skip subscription when objectName is undefined', () => {
    const ds: any = {
      onMutation: vi.fn(() => vi.fn()),
    };

    renderHook(() => useDataRefresh(ds, undefined));

    expect(ds.onMutation).not.toHaveBeenCalled();
  });
});
