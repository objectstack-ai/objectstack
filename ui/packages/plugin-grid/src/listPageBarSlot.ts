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
 *   slot, tells the host when a selection is open, and reports its match total
 *   for the count beside the view name.
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
  /** The list's match total (every row the query matches), when the list knows it. */
  total?: number;
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
  const { selecting, total } = state;
  React.useLayoutEffect(() => {
    const host = hostOf(slot);
    if (!host) return undefined;
    host.state = { selecting, total };
    emit();
    return () => {
      // Only clear what is still ours: a re-render may have written newer state.
      if (hosts.has(host)) {
        host.state = EMPTY_STATE;
        emit();
      }
    };
  }, [slot, selecting, total]);
}
