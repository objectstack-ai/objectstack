/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Native shell mode: `window.ObjectStackNative`, as the ObjectStack mobile
 * shell injects it (bridge contract: objectstack-ai/mobile `docs/HYBRID-SHELL.md`,
 * "Native bridge").
 *
 * The fake bridge below has the contract's members and records what the page
 * posts. Each block's control case is the one without a bridge, which must
 * stay exactly as before: no host, no post, no listener.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import {
  NATIVE_HOST_GLOBAL,
  NATIVE_NAVIGATE_EVENT,
  getNativeHost,
  isInAppRoute,
  nativeGetPushToken,
  nativeHaptic,
  nativeNavigate,
  nativeOpenExternal,
  nativeResetServer,
  postNativeReady,
  postNativeRouteChanged,
  resetNativeHostEventsForTests,
  type NativeHostMethod,
  type ObjectStackNative,
} from '../nativeHost';
import {
  NATIVE_HOST_POST_LOAD_RECHECKS_MS,
  resetNativeHostWatchForTests,
  useNativeHost,
  useNativeHostRouting,
} from '../useNativeHost';

const ALL_METHODS: NativeHostMethod[] = ['getPushToken', 'haptic', 'openExternal', 'navigate', 'resetServer'];

function fakeBridge(capabilities: readonly string[] = ALL_METHODS): ObjectStackNative & {
  ready: ReturnType<typeof vi.fn>;
  routeChanged: ReturnType<typeof vi.fn>;
} {
  return {
    version: 1,
    platform: 'ios',
    appVersion: '2.0.0',
    capabilities,
    safeArea: { top: 47, bottom: 34, left: 0, right: 0 },
    has: (capability: string) => capabilities.includes(capability),
    getPushToken: vi.fn(async () => ({ token: 'tok', vendor: 'apns' as const })),
    haptic: vi.fn(async () => null),
    openExternal: vi.fn(async () => null),
    navigate: vi.fn(async () => null),
    resetServer: vi.fn(async () => null),
    ready: vi.fn(),
    routeChanged: vi.fn(),
  };
}

function install(bridge: unknown): void {
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = bridge;
}

function uninstall(): void {
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
}

beforeEach(() => {
  uninstall();
  resetNativeHostEventsForTests();
  resetNativeHostWatchForTests();
});

afterEach(() => {
  cleanup();
  uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('detection', () => {
  it('getNativeHost is null without the global and the bridge with it, read at call time', () => {
    expect(getNativeHost()).toBeNull();
    const bridge = fakeBridge();
    install(bridge);
    expect(getNativeHost()).toBe(bridge);
    uninstall();
    expect(getNativeHost()).toBeNull();
  });

  it('a non-object global is not a bridge', () => {
    install('yes');
    expect(getNativeHost()).toBeNull();
    install(null);
    expect(getNativeHost()).toBeNull();
  });

  it('useNativeHost returns null without the global, and the bridge when it was injected before render', () => {
    const seen: Array<ObjectStackNative | null> = [];
    function Probe() {
      seen.push(useNativeHost());
      return null;
    }
    render(<Probe />);
    expect(seen.at(-1)).toBeNull();
    cleanup();

    const bridge = fakeBridge();
    install(bridge);
    render(<Probe />);
    expect(seen.at(-1)).toBe(bridge);
  });
});

describe('late injection', () => {
  function Probe({ onHost }: { onHost: (host: ObjectStackNative | null) => void }) {
    onHost(useNativeHost());
    return null;
  }

  it('a bridge injected after the first render re-renders the caller with it (after load)', async () => {
    vi.useFakeTimers();
    const seen: Array<ObjectStackNative | null> = [];
    render(<Probe onHost={(h) => seen.push(h)} />);
    expect(seen.at(-1)).toBeNull();

    // The Android case: the shell evaluates the bootstrap again once the page
    // has loaded, which can land just after `load` fired.
    const bridge = fakeBridge();
    install(bridge);
    await act(async () => {
      vi.advanceTimersByTime(Math.max(...NATIVE_HOST_POST_LOAD_RECHECKS_MS));
    });
    expect(seen.at(-1)).toBe(bridge);
  });

  it('a bridge injected while the document is still loading is picked up at DOMContentLoaded', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const seen: Array<ObjectStackNative | null> = [];
    render(<Probe onHost={(h) => seen.push(h)} />);
    expect(seen.at(-1)).toBeNull();

    const bridge = fakeBridge();
    install(bridge);
    await act(async () => {
      document.dispatchEvent(new Event('DOMContentLoaded'));
    });
    expect(seen.at(-1)).toBe(bridge);
  });

  it('a bridge injected while the document is loading is picked up at load', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const seen: Array<ObjectStackNative | null> = [];
    render(<Probe onHost={(h) => seen.push(h)} />);
    expect(seen.at(-1)).toBeNull();

    const bridge = fakeBridge();
    install(bridge);
    await act(async () => {
      window.dispatchEvent(new Event('load'));
    });
    expect(seen.at(-1)).toBe(bridge);
  });

  it('control: with no bridge ever injected, the hook stays null through every re-check', async () => {
    vi.useFakeTimers();
    const seen: Array<ObjectStackNative | null> = [];
    render(<Probe onHost={(h) => seen.push(h)} />);
    await act(async () => {
      window.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(Math.max(...NATIVE_HOST_POST_LOAD_RECHECKS_MS));
    });
    expect(seen.every((h) => h === null)).toBe(true);
  });
});

describe('typed call wrappers feature-detect and never throw', () => {
  const calls: Array<[NativeHostMethod, () => Promise<unknown>]> = [
    ['getPushToken', () => nativeGetPushToken()],
    ['haptic', () => nativeHaptic('success')],
    ['openExternal', () => nativeOpenExternal('https://example.com')],
    ['navigate', () => nativeNavigate('/home')],
    ['resetServer', () => nativeResetServer()],
  ];

  it.each(calls)('%s resolves "unavailable" without a bridge', async (_method, call) => {
    await expect(call()).resolves.toEqual({ status: 'unavailable' });
  });

  it.each(calls)('%s resolves "unavailable" when has() says no, and never calls the method', async (method, call) => {
    const bridge = fakeBridge(ALL_METHODS.filter((m) => m !== method));
    install(bridge);
    await expect(call()).resolves.toEqual({ status: 'unavailable' });
    expect(bridge[method]).not.toHaveBeenCalled();
  });

  it.each(calls)('%s resolves "unavailable" when has() says yes but the method is missing', async (method, call) => {
    const bridge = fakeBridge() as unknown as Record<string, unknown>;
    delete bridge[method];
    install(bridge);
    await expect(call()).resolves.toEqual({ status: 'unavailable' });
  });

  it('a call the shell answers resolves "ok" with its value and forwards the argument', async () => {
    const bridge = fakeBridge();
    install(bridge);
    await expect(nativeGetPushToken()).resolves.toEqual({ status: 'ok', value: { token: 'tok', vendor: 'apns' } });
    await expect(nativeHaptic('warning')).resolves.toEqual({ status: 'ok', value: null });
    expect(bridge.haptic).toHaveBeenCalledWith('warning');
    await nativeOpenExternal('mailto:a@example.com');
    expect(bridge.openExternal).toHaveBeenCalledWith('mailto:a@example.com');
    await nativeNavigate('/apps/crm');
    expect(bridge.navigate).toHaveBeenCalledWith('/apps/crm');
  });

  it('a call the shell rejects resolves "failed" with the shell error code', async () => {
    const bridge = fakeBridge();
    bridge.openExternal = vi.fn(async () => {
      throw Object.assign(new Error('scheme not allowed'), { code: 'bad_args' });
    });
    install(bridge);
    await expect(nativeOpenExternal('ftp://x')).resolves.toEqual({
      status: 'failed',
      code: 'bad_args',
      message: 'scheme not allowed',
    });
  });

  it('a has() that throws reads as "unavailable"', async () => {
    const bridge = fakeBridge();
    bridge.has = () => {
      throw new Error('boom');
    };
    install(bridge);
    await expect(nativeHaptic('light')).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('ready and routeChanged posts', () => {
  it('postNativeReady posts once per page load', () => {
    const bridge = fakeBridge();
    expect(postNativeReady(bridge)).toBe(true);
    expect(postNativeReady(bridge)).toBe(false);
    expect(bridge.ready).toHaveBeenCalledTimes(1);
  });

  it('postNativeRouteChanged posts each new route once', () => {
    const bridge = fakeBridge();
    postNativeRouteChanged('/a', bridge);
    postNativeRouteChanged('/a', bridge);
    postNativeRouteChanged('/b?x=1', bridge);
    expect(bridge.routeChanged.mock.calls).toEqual([['/a'], ['/b?x=1']]);
  });

  it('control: without a bridge nothing is posted', () => {
    expect(postNativeReady()).toBe(false);
    expect(postNativeRouteChanged('/a')).toBe(false);
  });
});

describe('useNativeHostRouting', () => {
  function Router({ route, navigate }: { route: string; navigate: (r: string) => void }) {
    useNativeHostRouting({ route, navigate });
    return null;
  }

  it('posts ready once and routeChanged on every route change, once each', () => {
    const bridge = fakeBridge();
    install(bridge);
    const navigate = vi.fn();
    const { rerender } = render(
      <React.StrictMode>
        <Router route="/home" navigate={navigate} />
      </React.StrictMode>,
    );
    expect(bridge.ready).toHaveBeenCalledTimes(1);
    expect(bridge.routeChanged.mock.calls).toEqual([['/home']]);

    rerender(
      <React.StrictMode>
        <Router route="/apps/crm" navigate={navigate} />
      </React.StrictMode>,
    );
    rerender(
      <React.StrictMode>
        <Router route="/apps/crm" navigate={navigate} />
      </React.StrictMode>,
    );
    expect(bridge.ready).toHaveBeenCalledTimes(1);
    expect(bridge.routeChanged.mock.calls).toEqual([['/home'], ['/apps/crm']]);
  });

  it('a late bridge gets ready and the current route as soon as it appears', async () => {
    vi.useFakeTimers();
    render(<Router route="/home" navigate={vi.fn()} />);
    const bridge = fakeBridge();
    install(bridge);
    await act(async () => {
      vi.advanceTimersByTime(Math.max(...NATIVE_HOST_POST_LOAD_RECHECKS_MS));
    });
    expect(bridge.ready).toHaveBeenCalledTimes(1);
    expect(bridge.routeChanged.mock.calls).toEqual([['/home']]);
  });

  it('the shell navigate event moves the router to an in-app route and cancels the reload', () => {
    install(fakeBridge());
    const navigate = vi.fn();
    render(<Router route="/home" navigate={navigate} />);
    const event = new CustomEvent(NATIVE_NAVIGATE_EVENT, { cancelable: true, detail: { route: '/apps/crm/record/1?tab=a' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/apps/crm/record/1?tab=a');
  });

  it.each([
    ['protocol-relative', '//evil.example/x'],
    ['scheme', 'https://evil.example/x'],
    ['backslash', '/\\evil.example'],
    ['relative', 'apps/crm'],
    ['empty', ''],
    ['not a string', 42],
  ])('a %s route is left to the shell: not cancelled, router untouched', (_label, route) => {
    install(fakeBridge());
    const navigate = vi.fn();
    render(<Router route="/home" navigate={navigate} />);
    const event = new CustomEvent(NATIVE_NAVIGATE_EVENT, { cancelable: true, detail: { route } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('control: outside shell mode no navigate listener is installed and nothing is posted', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const navigate = vi.fn();
    render(<Router route="/home" navigate={navigate} />);
    expect(add.mock.calls.some(([type]) => type === NATIVE_NAVIGATE_EVENT)).toBe(false);
    const event = new CustomEvent(NATIVE_NAVIGATE_EVENT, { cancelable: true, detail: { route: '/apps/crm' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    install(fakeBridge());
    const navigate = vi.fn();
    const { unmount } = render(<Router route="/home" navigate={navigate} />);
    unmount();
    const event = new CustomEvent(NATIVE_NAVIGATE_EVENT, { cancelable: true, detail: { route: '/apps/crm' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('isInAppRoute', () => {
  it('accepts a single-slash path with query and hash, refuses escapes', () => {
    expect(isInAppRoute('/')).toBe(true);
    expect(isInAppRoute('/apps/crm?x=1#y')).toBe(true);
    expect(isInAppRoute('//x')).toBe(false);
    expect(isInAppRoute('/a\\b')).toBe(false);
    expect(isInAppRoute('/a\nb')).toBe(false);
    expect(isInAppRoute('javascript:alert(1)')).toBe(false);
    expect(isInAppRoute(undefined)).toBe(false);
  });
});
