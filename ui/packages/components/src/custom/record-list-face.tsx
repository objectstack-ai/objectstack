/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What a list drawn beside an open record reads from the record pane around
 * it (objectstack#27545): the face it draws at its narrowed width, and which of
 * its rows is the record the pane shows.
 *
 * Both are published by `NavigationOverlay` around the `mainContent` it is
 * handed (the list), so a list under no pane reads the defaults: the full
 * face, and no row is the open one.
 *
 * The open row is a store, not a context value: the pane changes record on
 * every row click and every `↑` / `↓` step, and a context value would re-render
 * the whole list each time. Each row subscribes to its own answer instead, so
 * a step re-renders the row it leaves and the row it reaches, never the list.
 */

import * as React from 'react';

/**
 * The face of a list a record pane has narrowed:
 *
 * - `full` — no pane beside it (closed, an overlay drawer, or maximized): the
 *   list draws as it always does;
 * - `columns` — the pane is beside it and it is at least
 *   {@link RECORD_LIST_CARD_FACE_BELOW_PX} wide: a table of its first
 *   {@link RECORD_LIST_NARROW_COLUMN_COUNT} non-avatar view columns;
 * - `cards` — narrower than that: one card row per record, its name and two
 *   chips.
 */
export type RecordListFace = 'full' | 'columns' | 'cards';

/** Below this width a list beside a record pane draws card rows. */
export const RECORD_LIST_CARD_FACE_BELOW_PX = 440;

/** How many view columns a narrowed list keeps in its `columns` face. */
export const RECORD_LIST_NARROW_COLUMN_COUNT = 3;

const RecordListFaceContext = React.createContext<RecordListFace>('full');

/** Publishes the face of the list below it. */
export const RecordListFaceProvider = RecordListFaceContext.Provider;

/** The face this list draws in — `full` under no record pane. */
export function useRecordListFace(): RecordListFace {
  return React.useContext(RecordListFaceContext);
}

/** The face a list beside an open record pane takes at `widthPx`. */
export function recordListFaceFor(widthPx: number): Exclude<RecordListFace, 'full'> {
  return widthPx < RECORD_LIST_CARD_FACE_BELOW_PX ? 'cards' : 'columns';
}

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

/** A list row's record id as the pane names it: `id`, else `_id`, as text. */
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

/** Whether the row of `recordId` is the record the pane beside the list shows. */
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
