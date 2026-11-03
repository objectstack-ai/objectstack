/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  NATIVE_CONNECTION_REMOVED_EVENT,
  NATIVE_NAVIGATE_EVENT,
  getNativeHost,
  isInAppRoute,
  postNativeReady,
  postNativeRouteChanged,
  type NativeConnectionRemovedEvent,
  type ObjectStackNative,
} from './nativeHost.js';

/**
 * Re-check delays after the window `load` event, in milliseconds. On Android
 * the shell guarantees the bridge only by evaluating it again once the page
 * has loaded, which can land just after `load` fires.
 */
export const NATIVE_HOST_POST_LOAD_RECHECKS_MS: readonly number[] = [100, 500, 2000];

const listeners = new Set<() => void>();
let watching = false;

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

/**
 * Re-check points for a bridge that is not there yet: `DOMContentLoaded`
 * (while the document is still loading), `load`, and a few timed re-checks
 * after `load`. Installed once, on the first subscriber, and only while no
 * bridge is present; each point stops itself once one is.
 */
function watchForLateInjection(): void {
  if (watching || typeof window === 'undefined' || getNativeHost()) return;
  watching = true;
  const recheck = () => {
    if (getNativeHost()) notify();
  };
  const afterLoad = () => {
    recheck();
    for (const ms of NATIVE_HOST_POST_LOAD_RECHECKS_MS) {
      window.setTimeout(recheck, ms);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recheck, { once: true });
  }
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad, { once: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watchForLateInjection();
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = (): ObjectStackNative | null => null;

/**
 * The native shell bridge (`window.ObjectStackNative`) when the Console runs
 * inside the ObjectStack mobile shell, otherwise `null`.
 *
 * Detection is lazy: the global is read at render time, re-read on mount, and
 * re-read at `DOMContentLoaded`, `load` and a few timed points after `load`,
 * so a bridge the shell injects after the first render re-renders the caller
 * with it. Without the global the hook returns `null` for good and changes
 * nothing; so does a bridge speaking a newer protocol than
 * `NATIVE_BRIDGE_VERSION` (see `getNativeHost`).
 */
export function useNativeHost(): ObjectStackNative | null {
  const host = useSyncExternalStore(subscribe, getNativeHost, getServerSnapshot);
  // The bridge can land between render and subscription; re-read once mounted.
  useEffect(() => {
    if (!host && getNativeHost()) notify();
  }, [host]);
  return host;
}

export interface UseNativeHostRoutingOptions {
  /**
   * The current route, as the router sees it: path, query and hash, without
   * the deployment's basename.
   */
  route: string;
  /** Move the app's own router to an in-app route (no document reload). */
  navigate: (route: string) => void;
  /**
   * Run when the shell removes this Console's connection
   * (`objectstack-native:connectionRemoved`): unregister this device's push
   * token under the Console's own session. The shell is held until the
   * returned promise settles, at most 10 s. Omitted, the shell is released at
   * once: there is no registered token to unregister.
   */
  onConnectionRemoved?: () => Promise<unknown>;
}

/**
 * Wires the app to the native shell. Call it once, inside the router, from a
 * component that renders beside the routes. In the shell it:
 *
 * - posts `ready()` once per page load, after the first commit of the router
 *   tree (or as soon as a late bridge appears). That commit is the Console's
 *   own UI and may be a loading fallback, such as the auth guard's spinner
 *   while the session is read on a cold start: `ready` means "the Console has
 *   painted", not "the page's data has settled". The shell lifts its loading
 *   cover on it, handing over to that spinner instead of holding the native
 *   cover through the session round-trip;
 * - posts `routeChanged(route)` on every navigation, once per route change;
 * - listens for the shell's `objectstack-native:navigate` event, moves the
 *   router to `detail.route` when it is an in-app path, and cancels the event
 *   so the shell does not reload the page. Anything else is left alone, and
 *   the shell's own full-load fallback runs;
 * - answers the shell's `objectstack-native:connectionRemoved` event: calls
 *   `event.waitUntil()` with the promise `onConnectionRemoved` returns, or with
 *   one already resolved when it is omitted. An unregister that fails rejects
 *   that promise, so the shell is never held past the step itself.
 *
 * Outside the shell it does nothing and installs no listener. Returns the
 * bridge, or `null`.
 */
export function useNativeHostRouting({
  route,
  navigate,
  onConnectionRemoved,
}: UseNativeHostRoutingOptions): ObjectStackNative | null {
  const host = useNativeHost();
  // The latest handler, read when the event fires, so the listener does not
  // re-install on every render that passes a new function.
  const onConnectionRemovedRef = useRef(onConnectionRemoved);
  useEffect(() => {
    onConnectionRemovedRef.current = onConnectionRemoved;
  }, [onConnectionRemoved]);

  useEffect(() => {
    if (host) postNativeReady(host);
  }, [host]);

  useEffect(() => {
    if (host) postNativeRouteChanged(route, host);
  }, [host, route]);

  useEffect(() => {
    if (!host) return undefined;
    const onNavigate = (event: Event) => {
      const target = (event as CustomEvent<{ route?: unknown } | null>).detail?.route;
      if (!isInAppRoute(target)) return;
      event.preventDefault();
      navigate(target);
    };
    window.addEventListener(NATIVE_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NATIVE_NAVIGATE_EVENT, onNavigate);
  }, [host, navigate]);

  useEffect(() => {
    if (!host) return undefined;
    const onRemoved = (event: Event) => {
      const { waitUntil } = event as Partial<NativeConnectionRemovedEvent>;
      if (typeof waitUntil !== 'function') return;
      const handler = onConnectionRemovedRef.current;
      waitUntil.call(event, handler ? Promise.resolve().then(handler) : Promise.resolve());
    };
    window.addEventListener(NATIVE_CONNECTION_REMOVED_EVENT, onRemoved);
    return () => window.removeEventListener(NATIVE_CONNECTION_REMOVED_EVENT, onRemoved);
  }, [host]);

  return host;
}

/** Test seam: drop subscribers and re-arm the late-injection watch. Not exported from the package entry. */
export function resetNativeHostWatchForTests(): void {
  listeners.clear();
  watching = false;
}
