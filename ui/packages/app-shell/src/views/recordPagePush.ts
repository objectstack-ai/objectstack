/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One level down on a phone (objectstack#27058): a related row or a lookup on
 * a record page opens its record as a page pushed over the current one. There
 * is no drawer on a phone, so the record route is navigated to, with the
 * `?from=` trail extended (`RelatedRecordActionsBridge`) and the history state
 * this module builds: the parent as the page's origin, the parent's related
 * rows as its ↓ ↑ set, and a marker that says the page was pushed in this
 * session, so its 「‹」 goes back in the history rather than forward to a fresh
 * copy of the parent. Going back restores the parent's scroll position, which
 * the parent remembers per history entry ({@link useRecordPageScrollMemory}).
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** The history-state key that marks a page pushed from a parent record in this session. */
export const RECORD_PAGE_PUSHED_STATE = 'recordPagePushed';

/**
 * The history state a pushed page is navigated with: the parent page as its
 * `from` (what the page's way back and its counter read, as a list's row
 * navigation hands a page its list), the sibling set when the row came from a
 * related list, and the pushed marker.
 */
export function recordPagePushState(
  parent: { pathname: string; search: string },
  parentTitle: string | undefined,
  siblings?: ReadonlyArray<string | number>,
): Record<string, unknown> {
  const ids = siblings?.map(String);
  return {
    from: {
      pathname: parent.pathname + (parent.search || ''),
      ...(parentTitle ? { label: parentTitle } : {}),
      ...(ids && ids.length > 0 ? { siblings: ids } : {}),
    },
    [RECORD_PAGE_PUSHED_STATE]: true,
  };
}

/** Was this page pushed from a parent record in this session? */
export function isRecordPagePushed(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[RECORD_PAGE_PUSHED_STATE] === true;
}

/**
 * The last scroll position of each record page, by history entry. Bounded:
 * only the entries a reader can still go back to matter.
 */
const scrollByEntry = new Map<string, number>();
const SCROLL_MEMORY_LIMIT = 50;

function rememberScroll(entryKey: string, top: number): void {
  scrollByEntry.delete(entryKey);
  scrollByEntry.set(entryKey, top);
  if (scrollByEntry.size > SCROLL_MEMORY_LIMIT) {
    const oldest = scrollByEntry.keys().next().value;
    if (oldest !== undefined) scrollByEntry.delete(oldest);
  }
}

/** How long a restore keeps trying while the page's panels are still loading. */
const RESTORE_TIMEOUT_MS = 3000;
const RESTORE_INTERVAL_MS = 100;

/**
 * Remember the scroller's position for this history entry, and restore it when
 * the reader comes back to the entry (a back or forward navigation, which is
 * what 「‹」 on a pushed page is). The page's panels load after its record, so
 * the restore retries until the scroller can reach the position, and stops as
 * soon as the reader touches or scrolls it.
 *
 * `enabled` waits for the record: before it loads, the page has nothing to
 * scroll.
 */
export function useRecordPageScrollMemory(scroller: HTMLElement | null, enabled: boolean): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = location.key;
  // The arrival is read once per entry: a later render of the same entry is
  // not a second return to it.
  const arrival = useRef<{ key: string; pop: boolean } | null>(null);
  if (arrival.current?.key !== entryKey) arrival.current = { key: entryKey, pop: navigationType === 'POP' };
  const arrivedByPop = arrival.current.pop;

  useEffect(() => {
    if (!scroller || !enabled) return;
    const onScroll = () => rememberScroll(entryKey, scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, enabled, entryKey]);

  useEffect(() => {
    if (!scroller || !enabled || !arrivedByPop) return;
    const target = scrollByEntry.get(entryKey);
    if (!target) return;
    // `stop` and `apply` run only after the timers below exist: from the
    // timers themselves, the reader's touch, or the first `apply()` call.
    const stop = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      scroller.removeEventListener('touchstart', stop);
      scroller.removeEventListener('wheel', stop);
    };
    const apply = () => {
      scroller.scrollTop = target;
      if (Math.abs(scroller.scrollTop - target) < 1) stop();
    };
    const interval = setInterval(apply, RESTORE_INTERVAL_MS);
    const timeout = setTimeout(stop, RESTORE_TIMEOUT_MS);
    scroller.addEventListener('touchstart', stop, { passive: true });
    scroller.addEventListener('wheel', stop, { passive: true });
    apply();
    return stop;
  }, [scroller, enabled, arrivedByPop, entryKey]);
}
