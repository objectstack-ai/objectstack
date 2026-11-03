/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What a list under an open record reads from the record drawer around it
 * (objectstack#27545): which of its rows is the record the drawer shows.
 *
 * It is published by `NavigationOverlay` around the `mainContent` it is handed
 * (the list), so a list under no drawer reads the default: no row is the open
 * one. The narrowed list faces (`columns`, `cards`) a list drew beside the
 * split pane retired with it (objectstack#28915): the list keeps its full
 * width under the drawer.
 *
 * The open row is a store, not a context value: the drawer changes record on
 * every row click and every `↑` / `↓` step, and a context value would re-render
 * the whole list each time. Each row subscribes to its own answer instead, so
 * a step re-renders the row it leaves and the row it reaches, never the list.
 */

import * as React from 'react';

interface ActiveListRecordStore {
  get(): string | null;
  set(recordId: string | null): void;
  subscribe(listener: () => void): () => void;
}

function createActiveListRecordStore(initial: string | null): ActiveListRecordStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (recordId) => {
      if (recordId === current) return;
      current = recordId;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ActiveListRecordContext = React.createContext<ActiveListRecordStore | null>(null);

const NO_SUBSCRIPTION = () => () => {};

/** A list row's record id as the drawer names it: `id`, else `_id`, as text. */
export function listRecordIdOf(row: unknown): string | null {
  const record = row as { id?: unknown; _id?: unknown } | null | undefined;
  const id = record?.id ?? record?._id;
  return (typeof id === 'string' && id !== '') || typeof id === 'number' ? String(id) : null;
}

/**
 * Publishes which row of the list below is the open record. Changing
 * `recordId` notifies the rows that subscribed through
 * {@link useIsActiveListRecord}; it re-renders nothing else below.
 */
export function ActiveListRecordProvider({
  recordId,
  children,
}: {
  recordId: string | null | undefined;
  children: React.ReactNode;
}) {
  const [store] = React.useState(() => createActiveListRecordStore(recordId ?? null));
  // After the commit, never during render: notifying a subscribed row while
  // this provider renders would update another component mid-render.
  React.useLayoutEffect(() => {
    store.set(recordId ?? null);
  }, [store, recordId]);
  return <ActiveListRecordContext.Provider value={store}>{children}</ActiveListRecordContext.Provider>;
}

/** Whether the row of `recordId` is the record the drawer over the list shows. */
export function useIsActiveListRecord(recordId: string | null): boolean {
  const store = React.useContext(ActiveListRecordContext);
  return React.useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIPTION,
    () => !!store && recordId !== null && store.get() === recordId,
    () => false,
  );
}

/**
 * The open row's DOM side: once its row becomes the open record — a row click,
 * a step, a deep link — it is scrolled into view, by the least distance.
 */
export function useScrollActiveListRecordIntoView<T extends HTMLElement>(active: boolean) {
  const ref = React.useRef<T | null>(null);
  React.useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return ref;
}

/**
 * One list row's subscription to the open record: `children` draws the row,
 * told whether it is the open one and handed the ref that scrolls it into
 * view. Only this component re-renders when its answer changes.
 */
export function ActiveListRow<T extends HTMLElement = HTMLTableRowElement>({
  recordId,
  children,
}: {
  recordId: string | null;
  children: (active: boolean, ref: React.RefObject<T | null>) => React.ReactNode;
}) {
  const active = useIsActiveListRecord(recordId);
  const ref = useScrollActiveListRecordIntoView<T>(active);
  return <>{children(active, ref)}</>;
}
