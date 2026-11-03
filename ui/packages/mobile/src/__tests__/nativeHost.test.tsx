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
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import {
  NATIVE_BRIDGE_VERSION,
  NATIVE_CONNECTION_REMOVED_EVENT,
  NATIVE_HOST_GLOBAL,
  NATIVE_NAVIGATE_EVENT,
  getNativeHost,
  isInAppRoute,
  nativeGetPushToken,
  nativeHaptic,
  nativeNavigate,
  nativeOpenExternal,
  nativeHostCan,
  nativeResetServer,
  nativeScan,
  nativeShowConnectionSwitcher,
  nativeGetAppLock,
  nativeOpenAppLockSettings,
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

const ALL_METHODS: NativeHostMethod[] = [
  'getPushToken',
  'haptic',
  'openExternal',
  'navigate',
  'resetServer',
  'scan',
  'showConnectionSwitcher',
  'getAppLock',
  'openAppLockSettings',
];

function fakeBridge(capabilities: readonly string[] = ALL_METHODS): ObjectStackNative & {
  ready: Mock<() => void>;
  routeChanged: Mock<(route: string) => void>;
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
    scan: vi.fn(async () => 'ASSET-0042'),
    showConnectionSwitcher: vi.fn(async () => null),
    getAppLock: vi.fn(async () => ({ enabled: true, timeoutSeconds: 300 })),
    openAppLockSettings: vi.fn(async () => null),
    ready: vi.fn<() => void>(),
    routeChanged: vi.fn<(route: string) => void>(),
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

describe('an open platform set and the bridge protocol version', () => {
  it('a platform other than ios or android is a bridge like any other', () => {
    const bridge = { ...fakeBridge(['haptic']), platform: 'desktop' };
    install(bridge);
    expect(getNativeHost()).toBe(bridge);
    expect(getNativeHost()?.platform).toBe('desktop');
  });

  it('this package speaks protocol version 1', () => {
    expect(NATIVE_BRIDGE_VERSION).toBe(1);
  });

  it.each([
    ['a newer version', NATIVE_BRIDGE_VERSION + 1],
    ['a string version', '1'],
    ['NaN', Number.NaN],
    ['no version', undefined],
  ])('%s reads as no bridge: getNativeHost is null and every call is unavailable', async (_label, version) => {
    const bridge = { ...fakeBridge(), version };
    install(bridge);
    expect(getNativeHost()).toBeNull();
    await expect(nativeHaptic('light')).resolves.toEqual({ status: 'unavailable' });
    expect(bridge.haptic).not.toHaveBeenCalled();
  });

  it('control: the version this package speaks, and an older one, are the bridge', () => {
    for (const version of [NATIVE_BRIDGE_VERSION, 0]) {
      const bridge = { ...fakeBridge(), version };
      install(bridge);
      expect(getNativeHost()).toBe(bridge);
    }
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
    ['scan', () => nativeScan()],
    ['showConnectionSwitcher', () => nativeShowConnectionSwitcher()],
    ['getAppLock', () => nativeGetAppLock()],
    ['openAppLockSettings', () => nativeOpenAppLockSettings()],
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
    await expect(nativeShowConnectionSwitcher()).resolves.toEqual({ status: 'ok', value: null });
    expect(bridge.showConnectionSwitcher).toHaveBeenCalledTimes(1);
  });

  it('the app-lock pair reads the setting and opens the native screen, with no arguments', async () => {
    const bridge = fakeBridge();
    install(bridge);
    await expect(nativeGetAppLock()).resolves.toEqual({ status: 'ok', value: { enabled: true, timeoutSeconds: 300 } });
    expect(bridge.getAppLock).toHaveBeenCalledWith();
    await expect(nativeOpenAppLockSettings()).resolves.toEqual({ status: 'ok', value: null });
    expect(bridge.openAppLockSettings).toHaveBeenCalledTimes(1);
    expect(bridge.openAppLockSettings).toHaveBeenCalledWith();
  });

  it('openAppLockSettings refused while the app is locked resolves "failed" with the shell\'s message', async () => {
    const bridge = fakeBridge();
    bridge.openAppLockSettings = vi.fn(async () => {
      throw Object.assign(new Error('The app is locked'), { code: 'failed' });
    });
    install(bridge);
    await expect(nativeOpenAppLockSettings()).resolves.toEqual({
      status: 'failed',
      code: 'failed',
      message: 'The app is locked',
    });
  });

  it('nativeHostCan answers what a wrapper would: announced and carried, nothing else', () => {
    expect(nativeHostCan(null, 'showConnectionSwitcher')).toBe(false);
    expect(nativeHostCan(fakeBridge(), 'showConnectionSwitcher')).toBe(true);
    expect(nativeHostCan(fakeBridge(ALL_METHODS.filter((m) => m !== 'showConnectionSwitcher')), 'showConnectionSwitcher')).toBe(false);
    const missing = fakeBridge() as unknown as Record<string, unknown>;
    delete missing.showConnectionSwitcher;
    expect(nativeHostCan(missing as unknown as ObjectStackNative, 'showConnectionSwitcher')).toBe(false);
  });

  it('scan resolves "ok" with the decoded text, forwards the formats, and keeps the bridge as `this`', async () => {
    const bridge = fakeBridge();
    const scan = vi.fn(async () => 'ASSET-0042');
    bridge.scan = scan;
    install(bridge);
    await expect(nativeScan({ formats: ['qr', 'ean13'] })).resolves.toEqual({ status: 'ok', value: 'ASSET-0042' });
    expect(scan).toHaveBeenCalledWith({ formats: ['qr', 'ean13'] });
    expect(scan.mock.contexts[0]).toBe(bridge);
  });

  it('scan resolves "ok" with null when the user closes the scanner', async () => {
    const bridge = fakeBridge();
    bridge.scan = vi.fn(async () => null);
    install(bridge);
    await expect(nativeScan()).resolves.toEqual({ status: 'ok', value: null });
  });

  it('scan resolves "failed" with the shell message when the camera is refused', async () => {
    const bridge = fakeBridge();
    bridge.scan = vi.fn(async () => {
      throw Object.assign(new Error('Camera permission denied'), { code: 'failed' });
    });
    install(bridge);
    await expect(nativeScan()).resolves.toEqual({
      status: 'failed',
      code: 'failed',
      message: 'Camera permission denied',
    });
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

  it('a bridge speaking a newer protocol gets no ready, no route and no navigate listener', () => {
    const bridge = { ...fakeBridge(), version: NATIVE_BRIDGE_VERSION + 1 };
    install(bridge);
    const add = vi.spyOn(window, 'addEventListener');
    const navigate = vi.fn();
    render(<Router route="/home" navigate={navigate} />);
    expect(bridge.ready).not.toHaveBeenCalled();
    expect(bridge.routeChanged).not.toHaveBeenCalled();
    expect(add.mock.calls.some(([type]) => type === NATIVE_NAVIGATE_EVENT)).toBe(false);
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

describe('connectionRemoved', () => {
  function Router({ onConnectionRemoved }: { onConnectionRemoved?: () => Promise<unknown> }) {
    useNativeHostRouting({ route: '/home', navigate: () => {}, onConnectionRemoved });
    return null;
  }

  /** The shell's event: a window Event carrying `waitUntil`, which records the promise. */
  function removedEvent(): { event: Event; held: Promise<unknown>[] } {
    const held: Promise<unknown>[] = [];
    const event = Object.assign(new Event(NATIVE_CONNECTION_REMOVED_EVENT), {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        held.push(promise);
      }),
    });
    return { event, held };
  }

  it('with no unregister step, the shell is held by a promise that resolves at once', async () => {
    install(fakeBridge());
    render(<Router />);
    const { event, held } = removedEvent();
    window.dispatchEvent(event);
    expect(held).toHaveLength(1);
    await expect(held[0]).resolves.toBeUndefined();
  });

  it('with an unregister step, the shell is held until it settles, and the step runs once', async () => {
    install(fakeBridge());
    let finish!: () => void;
    const unregister = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Router onConnectionRemoved={unregister} />);
    const { event, held } = removedEvent();
    window.dispatchEvent(event);
    expect(held).toHaveLength(1);

    let settled = false;
    void held[0].then(() => (settled = true));
    await act(async () => {});
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finish();
    await held[0];
    expect(settled).toBe(true);
  });

  it('the latest handler runs, without re-installing the listener per render', () => {
    install(fakeBridge());
    const add = vi.spyOn(window, 'addEventListener');
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const { rerender } = render(<Router onConnectionRemoved={first} />);
    rerender(<Router onConnectionRemoved={second} />);
    expect(add.mock.calls.filter(([type]) => type === NATIVE_CONNECTION_REMOVED_EVENT)).toHaveLength(1);
    const { event, held } = removedEvent();
    window.dispatchEvent(event);
    return held[0].then(() => {
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });
  });

  it('an event without waitUntil is left alone', () => {
    install(fakeBridge());
    const unregister = vi.fn(async () => {});
    render(<Router onConnectionRemoved={unregister} />);
    window.dispatchEvent(new Event(NATIVE_CONNECTION_REMOVED_EVENT));
    expect(unregister).not.toHaveBeenCalled();
  });

  it('control: outside shell mode no connectionRemoved listener is installed', () => {
    const add = vi.spyOn(window, 'addEventListener');
    render(<Router />);
    expect(add.mock.calls.some(([type]) => type === NATIVE_CONNECTION_REMOVED_EVENT)).toBe(false);
    const { event, held } = removedEvent();
    window.dispatchEvent(event);
    expect(held).toHaveLength(0);
  });

  it('removes its listener on unmount', () => {
    install(fakeBridge());
    const { unmount } = render(<Router />);
    unmount();
    const { event, held } = removedEvent();
    window.dispatchEvent(event);
    expect(held).toHaveLength(0);
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
