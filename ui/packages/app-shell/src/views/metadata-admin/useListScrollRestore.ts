// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's scroll position, kept across a trip to a detail and
 * back (objectstack#36896): × or Back from a detail lands where the list was.
 *
 * Positions are kept in memory for this tab, keyed by the list's address
 * (path and query), so the same list with the same filters comes back to the
 * same place, and a list with other filters starts at the top. A refresh
 * starts at the top; the filters survive it through the address.
 *
 * The scroller is whatever the list sits in — the nearest ancestor that
 * scrolls vertically, else the page — so the Setup page, the Studio area and
 * any later host behave alike.
 */

import * as React from 'react';

/** How many list positions are kept; the oldest is forgotten first. */
const MAX_KEPT = 50;
const kept = new Map<string, number>();

function keep(key: string, top: number): void {
  kept.delete(key);
  kept.set(key, top);
  if (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
}

/** The position kept for a list address, if any (tests read it). */
export function keptListScroll(key: string): number | undefined {
  return kept.get(key);
}

/** Forget every kept position (tests). */
export function forgetListScrolls(): void {
  kept.clear();
}

/** The nearest ancestor of `el` that scrolls vertically, else the document's scroller. */
export function scrollParentOf(el: Element | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
  }
  return typeof document !== 'undefined' ? ((document.scrollingElement as HTMLElement | null) ?? document.documentElement) : null;
}

/**
 * Keep and restore the list's scroll position under `key`.
 *
 * Attach the returned ref to an element inside the list. `ready` is the
 * moment the rows are drawn: the kept position is restored once, then, and
 * only from then on is the position recorded — so the scroll a short loading
 * page or the previous page's content leaves behind never overwrites it.
 */
export function useListScrollRestore<T extends HTMLElement>(key: string, ready: boolean): React.RefObject<T | null> {
  const anchorRef = React.useRef<T | null>(null);
  const restoredRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const scroller = scrollParentOf(anchorRef.current);
    const top = kept.get(key);
    if (scroller && top !== undefined) scroller.scrollTop = top;
  }, [ready, key]);

  // A layout effect, so its cleanup reads the position before the list's rows
  // leave the DOM (which would clamp it).
  React.useLayoutEffect(() => {
    const scroller = scrollParentOf(anchorRef.current);
    if (!scroller) return;
    const isPage = typeof document !== 'undefined' && scroller === document.scrollingElement;
    const target: HTMLElement | Window = isPage ? window : scroller;
    const record = () => {
      if (restoredRef.current) keep(key, scroller.scrollTop);
    };
    target.addEventListener('scroll', record, { passive: true });
    return () => {
      target.removeEventListener('scroll', record);
      record();
    };
  }, [key]);

  return anchorRef;
}
