/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35554, objectstack#35678 — is this grid a list page's list?
 *
 * On the object list page the page's bars (the Console's page header, the
 * view bar) and the grid are siblings: neither renders the other, and the
 * component that renders both is not the place to say so. The page therefore
 * registers a SCOPE — the page column that holds its bars and the list — and a
 * grid whose root sits inside a registered scope is that page's list: it draws
 * no row-end controls (a row's actions are its context menu and, once ticked,
 * the selection bar's). A grid inside no scope — a related list, a page block,
 * a grid in the record drawer (which is not inside the page column) — keeps
 * its row-end controls. Every grid draws the same selection bar either way.
 *
 * The registry lives here rather than in a React context because no common
 * ancestor of the two is in reach of either package; it is a plain external
 * store read through `useSyncExternalStore`.
 */

import React from 'react';

// Counted, not a set: two registrants may hold one page column (the page
// header and the view bar's trailing end both do, and one unmounts as the
// other mounts), so the scope goes only when its last registrant does.
const scopes = new Map<HTMLElement, number>();
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

/** The page's side: register `scope` (the page column) while mounted. */
export function useListPageScope(scope: HTMLElement | null): void {
  React.useLayoutEffect(() => {
    if (!scope) return undefined;
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    emit();
    return () => {
      const left = (scopes.get(scope) ?? 1) - 1;
      if (left > 0) scopes.set(scope, left);
      else scopes.delete(scope);
      emit();
    };
  }, [scope]);
}

function inScope(el: HTMLElement | null): boolean {
  if (!el) return false;
  for (const scope of scopes.keys()) if (scope.contains(el)) return true;
  return false;
}

/** The grid's side: is the grid rooted at `root` inside a list page's scope? */
export function useIsListPageGrid(root: HTMLElement | null): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => inScope(root),
    () => false,
  );
}

// ---------------------------------------------------------------------------
// objectstack#35883 — the phone's 「Select」: the page asks its list to start a
// selection, and reads whether one is open (to hide its floating create
// button, which would sit on the selection bar).
// ---------------------------------------------------------------------------

/** How many times each page column has asked its list to start selecting. */
const selectRequests = new Map<HTMLElement, number>();

/**
 * The page's side: ask the list inside `scope` (the page column) to start
 * selecting with nothing ticked, as a long press on a card does with that
 * card. The phone's 「⋮ More」 → 「Select」 calls it.
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

/** The grid roots whose selection is open now. */
const selectingRoots = new Set<HTMLElement>();

/** The grid's side: publish whether the grid rooted at `root` is selecting. */
export function usePublishListSelecting(root: HTMLElement | null, selecting: boolean): void {
  React.useLayoutEffect(() => {
    if (!root || !selecting) return undefined;
    selectingRoots.add(root);
    emit();
    return () => {
      selectingRoots.delete(root);
      emit();
    };
  }, [root, selecting]);
}

/** The page's side: is a selection open in a list inside `scope`? */
export function useListPageSelecting(scope: HTMLElement | null): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      if (!scope) return false;
      for (const root of selectingRoots) if (scope.contains(root)) return true;
      return false;
    },
    () => false,
  );
}
