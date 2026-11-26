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

/**
 * The CSS custom property that carries the height of the banners drawn in
 * place, above the console's routes: `0px` (unset) while none is drawn there.
 */
export const CHROME_BANNERS_HEIGHT_VAR = '--os-chrome-banners';

/**
 * Full-height classes that give the banners drawn in place their height back
 * (objectstack#37528). A banner in place is in flow above the page, so a page
 * that takes the whole viewport would be taller than the window by the
 * banner's height. Outside the console, or while no banner is drawn in place,
 * the property is unset and these are the plain viewport heights.
 *
 * Literal strings, so Tailwind's scan sees every class.
 */
export const CONSOLE_FULL_HEIGHT = {
  /** `h-screen` less the banners. */
  screen: 'h-[calc(100vh-var(--os-chrome-banners,0px))]',
  /** `h-svh` less the banners. */
  svh: 'h-[calc(100svh-var(--os-chrome-banners,0px))]',
  /** `min-h-svh` less the banners. */
  minSvh: 'min-h-[calc(100svh-var(--os-chrome-banners,0px))]',
} as const;

/**
 * Publishes the summed height of `wrapper`'s children as
 * {@link CHROME_BANNERS_HEIGHT_VAR} on the document root, and clears it on
 * unmount. The wrapper is `display: contents`, so the banners keep their own
 * boxes (and the impersonation banner its `sticky`); each child is measured.
 */
function usePublishedBannerHeight(wrapper: React.RefObject<HTMLDivElement | null>) {
  React.useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const publish = () => {
      let height = 0;
      for (const child of Array.from(el.children)) height += child.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty(CHROME_BANNERS_HEIGHT_VAR, `${height}px`);
      else root.style.removeProperty(CHROME_BANNERS_HEIGHT_VAR);
    };
    const sizes = new ResizeObserver(publish);
    const observeChildren = () => {
      sizes.disconnect();
      for (const child of Array.from(el.children)) sizes.observe(child);
      publish();
    };
    const children = typeof MutationObserver === 'undefined' ? null : new MutationObserver(observeChildren);
    children?.observe(el, { childList: true });
    observeChildren();
    return () => {
      sizes.disconnect();
      children?.disconnect();
      root.style.removeProperty(CHROME_BANNERS_HEIGHT_VAR);
    };
  }, [wrapper]);
}

function InPlaceBanners({ children }: { children: React.ReactNode }) {
  const wrapper = React.useRef<HTMLDivElement | null>(null);
  usePublishedBannerHeight(wrapper);
  return (
    <div ref={wrapper} className="contents" data-testid="console-chrome-banners-inline">
      {children}
    </div>
  );
}

/**
 * Draws `children` into the app layout's host when one is mounted, in place
 * otherwise. In place, their height is published for the full-height pages
 * below them ({@link CONSOLE_FULL_HEIGHT}); in the host it is not, since the
 * host sits inside the content area the page already sizes.
 */
export function ChromeBannerSlot({ children }: { children: React.ReactNode }) {
  const target = useChromeBannerHost();
  return target ? createPortal(children, target) : <InPlaceBanners>{children}</InPlaceBanners>;
}
