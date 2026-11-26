// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The live `?surface=<type>:<name>` request — objectui#5476.
 *
 * Studio's pre-publish security block names the draft the publish door would
 * refuse (`object/crmext_visit`) from a sheet opened over a mounted page, and
 * asks the host to put the author in front of it. Pinned here:
 *
 *  - the producer gets `null` wherever no host is listening (the degradation
 *    the Home / draft-preview bar depends on);
 *  - every request reaches the host's `onRequest`, a repeat of the same
 *    target included: clicking the same offending object twice has to move
 *    the author twice.
 *
 * objectstack#36909 — the half that published the request to mounted pillars
 * (`useRequestedSurface`) went with the pillars; the host navigates instead.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import { SurfaceDeepLinkProvider, useSurfaceNavigator } from './surfaceDeepLinkChannel';

afterEach(cleanup);

describe('surfaceDeepLinkChannel — the live request (objectui#5476)', () => {
  it('degrades to null for producers with no host listening', () => {
    // Rendered by the Home / draft-preview bar, the Studio designer is not a
    // destination at all. Producers branch on this null and render prose.
    const { result } = renderHook(() => useSurfaceNavigator());
    expect(result.current).toBeNull();
  });

  it('hands every request to the host, a repeat of the same target included', () => {
    const onRequest = vi.fn();
    const { result } = renderHook(() => useSurfaceNavigator(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <SurfaceDeepLinkProvider onRequest={onRequest}>{children}</SurfaceDeepLinkProvider>
      ),
    });
    act(() => result.current!({ type: 'object', name: 'crmext_visit' }));
    act(() => result.current!({ type: 'object', name: 'crmext_visit' }));
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenLastCalledWith({ type: 'object', name: 'crmext_visit' });
  });

  it('keeps one producer handle while the host rebuilds its handler each render', () => {
    // Producers pass the handle straight into effect deps.
    const first = vi.fn();
    const second = vi.fn();
    let handler = first;
    const { result, rerender } = renderHook(() => useSurfaceNavigator(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <SurfaceDeepLinkProvider onRequest={handler}>{children}</SurfaceDeepLinkProvider>
      ),
    });
    const handle = result.current;
    handler = second;
    rerender();
    expect(result.current).toBe(handle);
    act(() => result.current!({ type: 'permission', name: 'sales_rep' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ type: 'permission', name: 'sales_rep' });
  });
});
