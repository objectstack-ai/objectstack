/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35554 — the list page bar's selection slot.
 *
 * On the object list page the page bar (the Console's page header) and the
 * grid are siblings: neither renders the other, and the component that renders
 * both is not the place a selection belongs. The page bar therefore offers a
 * SLOT, and the grid fills it:
 *
 * - The page bar registers a host: the element its selection content is drawn
 *   into (`slot`) and the element whose subtree it speaks for (`scope`, the
 *   page column that holds the page bar and the list).
 * - A grid whose root sits inside a host's scope is that page's list. It
 *   portals its selection content (「已选 N 条」, Cancel, the actions) into the
 *   slot and tells the host when a selection is open.
 * - A grid inside no host's scope — a related list, a page block, a grid in
 *   the record drawer (which is not inside the page column) — finds no host
 *   and keeps its own row-end actions and its own bulk bar, as before.
 *
 * The host's state lives here rather than in a React context because no
 * common ancestor of the two is in reach of either package; the store is a
 * plain external store read through `useSyncExternalStore`.
 */

import React from 'react';

export interface ListPageBarState {
  /** A selection is open: the page bar shows the slot in place of its own content. */
  selecting: boolean;
}

interface Host {
  slot: HTMLElement;
  scope: HTMLElement;
  state: ListPageBarState;
}

const EMPTY_STATE: ListPageBarState = { selecting: false };

const hosts = new Set<Host>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hostOf(slot: HTMLElement | null): Host | undefined {
  if (!slot) return undefined;
  for (const host of hosts) if (host.slot === slot) return host;
  return undefined;
}

/**
 * The page bar's side: register `slot` (drawn by the page bar) for the subtree
 * of `scope`, and read the state the list writes. Unregisters on unmount.
 */
export function useListPageBarHost(
  slot: HTMLElement | null,
  scope: HTMLElement | null,
): ListPageBarState {
  React.useLayoutEffect(() => {
    if (!slot || !scope) return undefined;
    const host: Host = { slot, scope, state: EMPTY_STATE };
    hosts.add(host);
    emit();
    return () => {
      hosts.delete(host);
      emit();
    };
  }, [slot, scope]);
  return React.useSyncExternalStore(
    subscribe,
    () => hostOf(slot)?.state ?? EMPTY_STATE,
    () => EMPTY_STATE,
  );
}

/** The slot of the host whose scope holds `el`, or `null`. */
function findSlotFor(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  for (const host of hosts) if (host.scope.contains(el)) return host.slot;
  return null;
}

/**
 * The grid's side: the page bar slot the grid rooted at `root` fills, or
 * `null` when the grid is not a list page's list.
 */
export function useListPageBarSlot(root: HTMLElement | null): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribe,
    () => findSlotFor(root),
    () => null,
  );
}

/** Write the list's side of the host state (a no-op when `slot` is `null`). */
export function useListPageBarState(slot: HTMLElement | null, state: ListPageBarState): void {
  const { selecting } = state;
  React.useLayoutEffect(() => {
    const host = hostOf(slot);
    if (!host) return undefined;
    host.state = { selecting };
    emit();
    return () => {
      // Only clear what is still ours: a re-render may have written newer state.
      if (hosts.has(host)) {
        host.state = EMPTY_STATE;
        emit();
      }
    };
  }, [slot, selecting]);
}

// ---------------------------------------------------------------------------
// objectstack#35883 — the phone's 「Select」: the page asks its list to open a
// selection, and reads whether one is open.
// ---------------------------------------------------------------------------

/** How many times each page column has asked its list to start selecting. */
const selectRequests = new Map<HTMLElement, number>();

/**
 * The page's side: ask the list inside `scope` (the page column) to start
 * selecting, as a long press on a card does. The phone's 「⋮ More」 →
 * 「Select」 calls it. A no-op when no list in `scope` hosts a page bar.
 */
export function requestListSelection(scope: HTMLElement | null): void {
  if (!scope) return;
  selectRequests.set(scope, (selectRequests.get(scope) ?? 0) + 1);
  emit();
}

/**
 * The grid's side: a number that grows each time the page column holding
 * `root` asks for a selection (`requestListSelection`); `0` before any.
 */
export function useListSelectionRequest(root: HTMLElement | null): number {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      if (!root) return 0;
      for (const [scope, count] of selectRequests) if (scope.contains(root)) return count;
      return 0;
    },
    () => 0,
  );
}

/**
 * The page's side: is a selection open in the list inside `scope`? The page
 * hides its floating create button while it is (objectstack#35883).
 */
export function useListPageSelecting(scope: HTMLElement | null): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      if (!scope) return false;
      for (const host of hosts) if (host.scope === scope && host.state.selecting) return true;
      return false;
    },
    () => false,
  );
}
