// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where the console's standing-condition banners (impersonation, the read-rate
 * report, storage capacity) are drawn (objectstack#36112).
 *
 * `ConsoleShell` mounts them once, above every route, so a page with no app
 * shell (Home, the organization pages, Studio, a phone) still carries them.
 * From 768 px up an app has no top bar, and its layout offers a host at the top
 * of the content area, the width of the content: while a host is mounted the
 * same banners are drawn into it instead, so they never span the sidebar's
 * column and are never drawn twice.
 * @module
 */

import * as React from 'react';
import { createPortal } from 'react-dom';

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHost(next: HTMLElement | null): void {
  if (host === next) return;
  host = next;
  for (const listener of listeners) listener();
}

/** The host element the app layout offers, or `null` where none is mounted. */
export function useChromeBannerHost(): HTMLElement | null {
  return React.useSyncExternalStore(subscribe, () => host, () => null);
}

/**
 * The app layout's host: an empty box at the top of the content area. One is
 * mounted at a time; unmounting it hands the banners back to the shell.
 */
export function ChromeBannerHost() {
  const mounted = React.useRef<HTMLElement | null>(null);
  const ref = React.useCallback((el: HTMLDivElement | null) => {
    if (el) {
      mounted.current = el;
      setHost(el);
    } else if (mounted.current) {
      if (host === mounted.current) setHost(null);
      mounted.current = null;
    }
  }, []);
  return <div ref={ref} data-testid="console-chrome-banners" className="contents" />;
}

/** Draws `children` into the app layout's host when one is mounted, in place otherwise. */
export function ChromeBannerSlot({ children }: { children: React.ReactNode }) {
  const target = useChromeBannerHost();
  return target ? createPortal(children, target) : <>{children}</>;
}
