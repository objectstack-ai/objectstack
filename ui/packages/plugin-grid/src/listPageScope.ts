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

const scopes = new Set<HTMLElement>();
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
    scopes.add(scope);
    emit();
    return () => {
      scopes.delete(scope);
      emit();
    };
  }, [scope]);
}

function inScope(el: HTMLElement | null): boolean {
  if (!el) return false;
  for (const scope of scopes) if (scope.contains(el)) return true;
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
