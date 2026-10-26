/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDesignerHistory } from '../hooks/useDesignerHistory';

describe('useDesignerHistory', () => {
  it('should initialize with the given state', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    expect(result.current.current).toEqual({ count: 0 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('should push new state and enable undo', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    act(() => result.current.push({ count: 1 }));

    expect(result.current.current).toEqual({ count: 1 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should undo to previous state', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    act(() => result.current.push({ count: 1 }));
    act(() => result.current.undo());

    expect(result.current.current).toEqual({ count: 0 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('should redo after undo', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    act(() => result.current.push({ count: 1 }));
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(result.current.current).toEqual({ count: 1 });
  });

  it('should clear redo stack on new push', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    act(() => result.current.push({ count: 1 }));
    act(() => result.current.push({ count: 2 }));
    act(() => result.current.undo());
    act(() => result.current.push({ count: 3 }));

    expect(result.current.current).toEqual({ count: 3 });
    expect(result.current.canRedo).toBe(false);
  });

  it('should respect maxHistory option', () => {
    const { result } = renderHook(() =>
      useDesignerHistory({ count: 0 }, { maxHistory: 3 }),
    );

    for (let i = 1; i <= 5; i++) {
      act(() => result.current.push({ count: i }));
    }

    expect(result.current.undoCount).toBeLessThanOrEqual(3);
  });

  it('should reset to new state clearing history', () => {
    const { result } = renderHook(() => useDesignerHistory({ count: 0 }));

    act(() => result.current.push({ count: 1 }));
    act(() => result.current.push({ count: 2 }));
    act(() => result.current.reset({ count: 10 }));

    expect(result.current.current).toEqual({ count: 10 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
