/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35554 — a list that loads as it scrolls, and comes back where
 * it was left.
 *
 * The host owns the rows and the fetch (`ListView` on the list page): it hands
 * the grid `onLoadMore` and `hasMoreRows`, and this hook calls `onLoadMore`
 * when the table's own scroll box (`data-table-scroll-box`) comes within
 * {@link LOAD_MORE_THRESHOLD_PX} of its end — or when the loaded rows do not
 * fill the box at all, so a short first window never strands the rest.
 *
 * The scroll position is kept in session storage under the host's
 * `scrollRestoreKey`, with the number of rows loaded when it was taken. The
 * host reads that number back on its next mount ({@link readListScrollState})
 * to load as many rows again, and this hook restores the position once they
 * are on screen. Clicking into a record on its own page and coming back
 * therefore lands near the row that was left.
 */

import React from 'react';

/** How close to the end of the scroll box the next window is asked for. */
export const LOAD_MORE_THRESHOLD_PX = 320;

const STORAGE_PREFIX = 'os:list-scroll:';

export interface ListScrollState {
  /** The scroll box's `scrollTop`. */
  top: number;
  /** Rows the list held when the position was taken. */
  rows: number;
}

/** The kept position of the list `key` names, or `null`. Never throws. */
export function readListScrollState(key: string | undefined): ListScrollState | null {
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ListScrollState>;
    if (typeof parsed?.top !== 'number' || typeof parsed?.rows !== 'number') return null;
    if (!Number.isFinite(parsed.top) || !Number.isFinite(parsed.rows) || parsed.top < 0 || parsed.rows < 0) return null;
    return { top: parsed.top, rows: parsed.rows };
  } catch {
    return null;
  }
}

function writeListScrollState(key: string, state: ListScrollState): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
  } catch {
    // Storage refused (private mode, quota): the position is a convenience.
  }
}

function scrollBoxOf(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[data-table-scroll-box]') ?? null;
}

export function useInfiniteRowLoad({
  root,
  enabled,
  hasMore,
  loading,
  rowCount,
  onLoadMore,
  restoreKey,
}: {
  root: HTMLElement | null;
  enabled: boolean;
  hasMore: boolean;
  loading: boolean;
  rowCount: number;
  onLoadMore?: () => void;
  restoreKey?: string;
}): void {
  // The latest inputs, read by the scroll listener without re-binding it.
  const latest = React.useRef({ enabled, hasMore, loading, rowCount, onLoadMore, restoreKey });
  React.useLayoutEffect(() => {
    latest.current = { enabled, hasMore, loading, rowCount, onLoadMore, restoreKey };
  });
  // One request per row count: the host's next window arrives as more rows,
  // and only then may the end of the box ask again.
  const askedAtRows = React.useRef<number | null>(null);
  // The kept position, read once per list, restored once its rows are loaded.
  const pendingRestore = React.useRef<{ key: string; state: ListScrollState } | null>(null);
  const restoreReadFor = React.useRef<string | undefined>(undefined);

  const maybeLoadMore = React.useCallback((box: HTMLElement) => {
    const now = latest.current;
    if (!now.enabled || !now.hasMore || now.loading || !now.onLoadMore) return;
    if (pendingRestore.current) return; // the host is still loading back to the kept position
    if (askedAtRows.current === now.rowCount) return;
    // A box with no height is not laid out (hidden, or not yet measured): it
    // has no end to be near, so it asks for nothing.
    if (box.clientHeight === 0) return;
    const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (remaining > LOAD_MORE_THRESHOLD_PX) return;
    askedAtRows.current = now.rowCount;
    now.onLoadMore();
  }, []);

  // A new window landed (or a load ended): allow the next ask, restore a kept
  // position once enough rows are back, and fill a box the rows do not.
  React.useLayoutEffect(() => {
    if (!enabled) return;
    if (restoreKey && restoreReadFor.current !== restoreKey) {
      restoreReadFor.current = restoreKey;
      const state = readListScrollState(restoreKey);
      pendingRestore.current = state && state.top > 0 ? { key: restoreKey, state } : null;
    }
    if (askedAtRows.current !== null && askedAtRows.current !== rowCount) askedAtRows.current = null;
    const box = scrollBoxOf(root);
    if (!box || loading) return;
    const pending = pendingRestore.current;
    if (pending && (rowCount >= pending.state.rows || !hasMore)) {
      pendingRestore.current = null;
      box.scrollTop = pending.state.top;
    }
    maybeLoadMore(box);
  }, [enabled, root, rowCount, loading, hasMore, restoreKey, maybeLoadMore]);

  React.useEffect(() => {
    if (!enabled) return undefined;
    const box = scrollBoxOf(root);
    if (!box) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const now = latest.current;
        if (now.restoreKey && !pendingRestore.current) {
          writeListScrollState(now.restoreKey, { top: box.scrollTop, rows: now.rowCount });
        }
        maybeLoadMore(box);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled, root, rowCount, maybeLoadMore]);
}
