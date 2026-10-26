/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDensityMode } from '../hooks/useDensityMode';

const flushMicrotasks = () => Promise.resolve();

describe('useDensityMode persistence', () => {
  it('honours initialMode and exposes the matching row height', () => {
    const { result } = renderHook(() => useDensityMode('compact'));
    expect(result.current.mode).toBe('compact');
    expect(result.current.rowHeight).toBe(32);
  });

  it('cycle() advances through the three densities and notifies onChange', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDensityMode('compact', { onChange })
    );

    act(() => result.current.cycle());
    await flushMicrotasks();
    expect(result.current.mode).toBe('comfortable');
    expect(onChange).toHaveBeenLastCalledWith('comfortable');

    act(() => result.current.cycle());
    await flushMicrotasks();
    expect(result.current.mode).toBe('spacious');
    expect(onChange).toHaveBeenLastCalledWith('spacious');

    act(() => result.current.cycle());
    await flushMicrotasks();
    expect(result.current.mode).toBe('compact');
    expect(onChange).toHaveBeenLastCalledWith('compact');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('setMode() emits onChange exactly once per real transition', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDensityMode('comfortable', { onChange })
    );

    act(() => result.current.setMode('spacious'));
    await flushMicrotasks();
    // Setting to the same value must not re-emit
    act(() => result.current.setMode('spacious'));
    await flushMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('spacious');
  });

  it('does NOT fire onChange on the initial mount', async () => {
    const onChange = vi.fn();
    renderHook(() => useDensityMode('spacious', { onChange }));
    await flushMicrotasks();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows external initialMode changes (e.g. switching views) without re-firing onChange', async () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ initial }: { initial: 'compact' | 'comfortable' | 'spacious' }) =>
        useDensityMode(initial, { onChange }),
      // No `as const` on `initial`: it would pin the hook's Props to the
      // literal `'compact'` and make the `rerender` below — the whole point of
      // the case — a type error rather than an external change.
      { initialProps: { initial: 'compact' } }
    );

    expect(result.current.mode).toBe('compact');

    rerender({ initial: 'spacious' });
    await flushMicrotasks();

    expect(result.current.mode).toBe('spacious');
    // External changes must not be reported as user transitions
    expect(onChange).not.toHaveBeenCalled();
  });
});
