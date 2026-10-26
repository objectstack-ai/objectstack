/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUrlOverlay } from '../useUrlOverlay';

function wrapperFor(initial: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

function useHarness(key: string, opts?: Parameters<typeof useUrlOverlay>[1]) {
  const controls = useUrlOverlay(key, opts);
  const { search } = useLocation();
  return { ...controls, search };
}

describe('useUrlOverlay', () => {
  it('is closed when the param is absent', () => {
    const { result } = renderHook(() => useHarness('palette'), { wrapper: wrapperFor('/') });
    expect(result.current.open).toBe(false);
  });

  it('is open when the param is present on first render (deep-link)', () => {
    const { result } = renderHook(() => useHarness('palette'), {
      wrapper: wrapperFor('/apps/foo?palette=1'),
    });
    expect(result.current.open).toBe(true);
  });

  it('openOverlay writes ?key=1 and is idempotent', () => {
    const { result } = renderHook(() => useHarness('palette'), { wrapper: wrapperFor('/') });

    act(() => result.current.openOverlay());
    expect(result.current.open).toBe(true);
    expect(result.current.search).toBe('?palette=1');

    // Idempotent: calling again leaves it open with the same URL (no toggle).
    act(() => result.current.openOverlay());
    expect(result.current.open).toBe(true);
    expect(result.current.search).toBe('?palette=1');
  });

  it('closeOverlay removes the param', () => {
    const { result } = renderHook(() => useHarness('palette'), {
      wrapper: wrapperFor('/?palette=1'),
    });
    expect(result.current.open).toBe(true);
    act(() => result.current.closeOverlay());
    expect(result.current.open).toBe(false);
    expect(result.current.search).toBe('');
  });

  it('toggleOverlay flips open state', () => {
    const { result } = renderHook(() => useHarness('palette'), { wrapper: wrapperFor('/') });
    act(() => result.current.toggleOverlay());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggleOverlay());
    expect(result.current.open).toBe(false);
  });

  it('preserves unrelated params when toggling', () => {
    const { result } = renderHook(() => useHarness('palette'), {
      wrapper: wrapperFor('/?tab=details'),
    });
    act(() => result.current.openOverlay());
    expect(result.current.search).toContain('tab=details');
    expect(result.current.search).toContain('palette=1');
    act(() => result.current.closeOverlay());
    expect(result.current.search).toBe('?tab=details');
  });

  it('reads an alias param as open and normalizes it on write', () => {
    const { result } = renderHook(() => useHarness('palette', { alias: 'cmdk' }), {
      wrapper: wrapperFor('/?cmdk=1'),
    });
    // alias counts as open
    expect(result.current.open).toBe(true);
    // closing clears both the canonical key and the alias
    act(() => result.current.closeOverlay());
    expect(result.current.open).toBe(false);
    expect(result.current.search).toBe('');
  });

  it('writes the canonical key (not the alias) when opening', () => {
    const { result } = renderHook(() => useHarness('palette', { alias: 'cmdk' }), {
      wrapper: wrapperFor('/'),
    });
    act(() => result.current.openOverlay());
    expect(result.current.search).toBe('?palette=1');
  });
});
