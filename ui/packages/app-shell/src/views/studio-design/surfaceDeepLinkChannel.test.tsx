// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The live half of the `?surface=<type>:<name>` plumbing — objectui#5476.
 *
 * Studio's pre-publish security block names the draft the publish door would
 * refuse (`object/crmext_visit`) and could not navigate to it: the block is
 * rendered from a sheet opened over an ALREADY-MOUNTED pillar, and the
 * capture half of the deep-link reads the URL exactly once, at mount.
 *
 * Two claims are pinned here, and they have to hold TOGETHER — the point of
 * the card is a capability ADDED, not one swapped for another:
 *
 *  - CONTROL: `useSurfaceDeepLink` still captures at mount and nothing after
 *    it — a later URL change (its own mirror writes one on every selection)
 *    must not move the captured value. That ref is why in-pillar selections
 *    don't re-trigger a restore.
 *  - NEW: a request published on the channel reaches subscribers after mount,
 *    exactly once per request, and is `null` for producers wherever no host
 *    is listening (the degradation the Home / draft-preview bar depends on).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, act, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';

import { useSurfaceDeepLink, type SurfaceTarget } from './useSurfaceDeepLink';
import {
  SurfaceDeepLinkProvider,
  useSurfaceNavigator,
  useRequestedSurface,
} from './surfaceDeepLinkChannel';

afterEach(cleanup);

describe('useSurfaceDeepLink — the mount-time capture (control)', () => {
  it('captures the URL target at mount and ignores every later URL change', () => {
    // The pillar's own mirror rewrites `?surface=` on each selection; a
    // capture that followed the URL would restore on every one of them.
    const seen: Array<SurfaceTarget | null> = [];
    function Probe(): React.ReactElement {
      const [, setParams] = useSearchParams();
      const [current, setCurrent] = React.useState<SurfaceTarget | null>(null);
      seen.push(useSurfaceDeepLink(current));
      return (
        <button
          type="button"
          onClick={() => {
            setParams({ surface: 'object:later_pick' }, { replace: true });
            setCurrent({ type: 'object', name: 'later_pick' });
          }}
        >
          pick
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/studio/com.test/data?surface=object:crmext_visit']}>
        <Probe />
      </MemoryRouter>,
    );
    expect(seen[0]).toEqual({ type: 'object', name: 'crmext_visit' });
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    // Every render since — still the mount-time value, never `later_pick`.
    for (const value of seen) expect(value).toEqual({ type: 'object', name: 'crmext_visit' });
  });
});

describe('surfaceDeepLinkChannel — the live half (objectui#5476)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SurfaceDeepLinkProvider>{children}</SurfaceDeepLinkProvider>
  );

  it('degrades to null for producers with no host listening', () => {
    // Rendered by the Home / draft-preview bar, the Studio designer is not a
    // destination at all. Producers branch on this null and render prose.
    const { result } = renderHook(() => useSurfaceNavigator());
    expect(result.current).toBeNull();
  });

  it('delivers a request to subscribers after mount', () => {
    const { result } = renderHook(
      () => ({ open: useSurfaceNavigator(), requested: useRequestedSurface() }),
      { wrapper },
    );
    expect(result.current.requested).toBeNull();
    act(() => result.current.open!({ type: 'object', name: 'crmext_visit' }));
    expect(result.current.requested?.target).toEqual({ type: 'object', name: 'crmext_visit' });
  });

  it('stamps each request with a fresh id, so a repeat of the same target is a new request', () => {
    // Clicking the same offending object twice has to move the author twice,
    // even though the target is identical.
    const { result } = renderHook(
      () => ({ open: useSurfaceNavigator(), requested: useRequestedSurface() }),
      { wrapper },
    );
    act(() => result.current.open!({ type: 'object', name: 'crmext_visit' }));
    const first = result.current.requested!.id;
    act(() => result.current.open!({ type: 'object', name: 'crmext_visit' }));
    expect(result.current.requested!.id).toBeGreaterThan(first);
  });

  it('publishes nothing when the host vetoes — a declined navigation leaves no standing request', () => {
    // The host asks about unsaved pillar edits; the author says no. If the
    // request were published anyway it would fire later, when that pillar
    // finally mounts, and move them somewhere they already refused to go.
    const onRequest = vi.fn(() => false as const);
    const { result } = renderHook(
      () => ({ open: useSurfaceNavigator(), requested: useRequestedSurface() }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <SurfaceDeepLinkProvider onRequest={onRequest}>{children}</SurfaceDeepLinkProvider>
        ),
      },
    );
    act(() => result.current.open!({ type: 'object', name: 'crmext_visit' }));
    expect(onRequest).toHaveBeenCalledWith({ type: 'object', name: 'crmext_visit' });
    expect(result.current.requested).toBeNull();
  });

  it('leaves the mount-time capture alone — the two halves are independent', () => {
    // The regression this card must not author: a live channel that also
    // moved the captured value would re-arm the restore the ref suppresses.
    function Probe(): React.ReactElement {
      const open = useSurfaceNavigator();
      const captured = useSurfaceDeepLink(null);
      return (
        <>
          <button type="button" onClick={() => open?.({ type: 'object', name: 'other_object' })}>
            request
          </button>
          <span data-testid="captured">{captured ? `${captured.type}:${captured.name}` : 'none'}</span>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/studio/com.test/data?surface=object:crmext_visit']}>
        <SurfaceDeepLinkProvider>
          <Probe />
        </SurfaceDeepLinkProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('captured')).toHaveTextContent('object:crmext_visit');
    fireEvent.click(screen.getByRole('button', { name: 'request' }));
    expect(screen.getByTestId('captured')).toHaveTextContent('object:crmext_visit');
  });
});
