// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list LAYOUT a reader keeps in this browser: per object, the order of the
 * view tabs, and per view the column widths and the row height.
 *
 * These three only arrange what the list shows; they never change which
 * records it shows. So they are this browser's alone (objectstack#35955):
 * dragging a width, picking a row height or reordering the tabs writes
 * nothing to the server, lights no Discard / Save, and never reaches another
 * user, device or browser. Everything else a reader changes on a list is the
 * list's draft (`./listDraftStore.ts`).
 *
 * ## Where it is kept
 *
 * One localStorage entry per signed-in reader and object,
 * `list-layout:<user id>:<object>`, holding these three parts and nothing else:
 *
 * ```json
 * { "viewOrder": ["<view id>", …],
 *   "perView": { "<view id>": { "widths": { "<field>": 180 }, "rowHeight": "compact" } } }
 * ```
 *
 * The keys an earlier Console wrote for list state (`list-state:*`, the cache
 * of the retired server row `ui.list.<object>`; `list-filters:*`;
 * `viewOrder:*`) are removed once per page load and never read: what they
 * held is not carried over, so every list opens on its view's own layout
 * until the reader changes it again.
 *
 * With no signed-in reader there is no entry: nothing is read or written, and
 * the list opens on its view's own layout.
 *
 * A sign-out clears this browser's storage, these entries with it
 * (`@object-ui/auth`'s signed-out purge).
 *
 * @module
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@object-ui/auth';
import { ROW_HEIGHT_TO_DENSITY_MODE, type RowHeight } from '@object-ui/core';

// ---------------------------------------------------------------------------
// The entry's shape
// ---------------------------------------------------------------------------

/** One view's layout: the widths the reader dragged and the row height they picked. */
export interface ListViewLayout {
  /** Column width in pixels, by field name. */
  widths?: Record<string, number>;
  /** One of the spec's row heights; the view's own `rowHeight` while absent. */
  rowHeight?: RowHeight;
}

/** One object's layout: the tab order and each view's layout. */
export interface ObjectListLayout {
  viewOrder?: string[];
  perView?: Record<string, ListViewLayout>;
}

/**
 * A patch to one view's layout. A part present as `null` (or, for `widths`,
 * an empty map) goes back to the view's own; an absent part is left as it is.
 */
export interface ListViewLayoutPatch {
  widths?: Record<string, number> | null;
  rowHeight?: RowHeight | null;
}

/** The localStorage key family this module owns. */
export const LIST_LAYOUT_STORAGE_PREFIX = 'list-layout';

/**
 * The localStorage key of one reader's layout for one object; `null` with no
 * signed-in reader or no object, which keeps no entry.
 */
export function listLayoutStorageKey(userId: string | null | undefined, objectName: string): string | null {
  if (!userId || !objectName) return null;
  return `${LIST_LAYOUT_STORAGE_PREFIX}:${userId}:${objectName}`;
}

/**
 * The key prefixes an earlier Console wrote list state under. Removed, never
 * read ({@link clearRetiredListStateKeys}).
 */
export const RETIRED_LIST_STATE_KEY_PREFIXES: readonly string[] = Object.freeze([
  'list-state:',
  'list-filters:',
  'viewOrder:',
]);

const EMPTY: ObjectListLayout = Object.freeze({}) as ObjectListLayout;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function sanitizeWidths(v: unknown): Record<string, number> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [field, width] of Object.entries(v)) {
    if (field && typeof width === 'number' && Number.isFinite(width) && width > 0) out[field] = width;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeRowHeight(v: unknown): RowHeight | undefined {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROW_HEIGHT_TO_DENSITY_MODE, v)
    ? (v as RowHeight)
    : undefined;
}

function sanitizeViewLayout(v: unknown): ListViewLayout | undefined {
  if (!isRecord(v)) return undefined;
  const out: ListViewLayout = {};
  const widths = sanitizeWidths(v.widths);
  if (widths) out.widths = widths;
  const rowHeight = sanitizeRowHeight(v.rowHeight);
  if (rowHeight) out.rowHeight = rowHeight;
  return out.widths || out.rowHeight ? out : undefined;
}

/** Keep only the parts of a stored value this entry declares, well formed. */
export function sanitizeObjectListLayout(v: unknown): ObjectListLayout {
  if (!isRecord(v)) return {};
  const out: ObjectListLayout = {};
  if (Array.isArray(v.viewOrder)) {
    const ids = v.viewOrder.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) out.viewOrder = ids;
  }
  if (isRecord(v.perView)) {
    const perView: Record<string, ListViewLayout> = {};
    for (const [viewId, view] of Object.entries(v.perView)) {
      const clean = sanitizeViewLayout(view);
      if (viewId && clean) perView[viewId] = clean;
    }
    if (Object.keys(perView).length > 0) out.perView = perView;
  }
  return out;
}

/** Apply a patch to one view's layout. Pure; a view left with nothing is removed. */
export function patchViewLayout(
  state: ObjectListLayout,
  viewId: string,
  patch: ListViewLayoutPatch,
): ObjectListLayout {
  const current: Record<string, unknown> = { ...(state.perView?.[viewId] ?? {}) };
  for (const key of ['widths', 'rowHeight'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined || value === null) delete current[key];
    else current[key] = value;
  }
  const clean = sanitizeViewLayout(current);
  const perView = { ...(state.perView ?? {}) };
  if (clean) perView[viewId] = clean;
  else delete perView[viewId];
  const next: ObjectListLayout = { ...state };
  if (Object.keys(perView).length > 0) next.perView = perView;
  else delete next.perView;
  return next;
}

/** Set (or, with an empty list, clear) the object's tab order. Pure. */
export function setViewOrderLayout(state: ObjectListLayout, ids: readonly string[]): ObjectListLayout {
  const next: ObjectListLayout = { ...state };
  if (ids.length > 0) next.viewOrder = [...ids];
  else delete next.viewOrder;
  return next;
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Remove every key an earlier Console wrote list state under
 * ({@link RETIRED_LIST_STATE_KEY_PREFIXES}). Never throws.
 */
export function clearRetiredListStateKeys(): void {
  const store = storage();
  if (!store) return;
  try {
    const retired: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && RETIRED_LIST_STATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) retired.push(key);
    }
    for (const key of retired) store.removeItem(key);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

let retiredKeysCleared = false;
function clearRetiredListStateKeysOnce(): void {
  if (retiredKeysCleared) return;
  retiredKeysCleared = true;
  clearRetiredListStateKeys();
}

/** This browser's layout for the reader and object; `{}` when there is none. */
export function readListLayout(userId: string | null | undefined, objectName: string): ObjectListLayout {
  const store = storage();
  const key = listLayoutStorageKey(userId, objectName);
  if (!key || !store) return {};
  try {
    const raw = store.getItem(key);
    return raw == null ? {} : sanitizeObjectListLayout(JSON.parse(raw));
  } catch {
    return {};
  }
}

// One snapshot per key and stored text, so `useSyncExternalStore` sees the
// same object until the entry changes.
const snapshots = new Map<string, { raw: string | null; value: ObjectListLayout }>();
const listeners = new Set<() => void>();

function snapshotOf(key: string): ObjectListLayout {
  let raw: string | null;
  try {
    raw = storage()?.getItem(key) ?? null;
  } catch {
    raw = null;
  }
  const held = snapshots.get(key);
  if (held && held.raw === raw) return held.value;
  let value: ObjectListLayout = EMPTY;
  if (raw != null) {
    try {
      value = sanitizeObjectListLayout(JSON.parse(raw));
    } catch {
      value = EMPTY;
    }
  }
  snapshots.set(key, { raw, value });
  return value;
}

/** Write the reader's layout for the object to this browser. Never throws. */
export function writeListLayout(
  userId: string | null | undefined,
  objectName: string,
  state: ObjectListLayout,
): void {
  const store = storage();
  const key = listLayoutStorageKey(userId, objectName);
  if (!key || !store) return;
  try {
    if (!state.viewOrder && !state.perView) store.removeItem(key);
    else store.setItem(key, JSON.stringify(state));
  } catch {
    /* quota / private mode: the layout is best-effort */
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget the held snapshots and let the retired-key sweep run again. */
export function resetListLayoutStoreForTests(): void {
  snapshots.clear();
  retiredKeysCleared = false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ObjectListLayoutHandle {
  /** The reader's layout for this object in this browser; `{}` when there is none. */
  layout: ObjectListLayout;
  /** Keep the reader's tab order. */
  setViewOrder(ids: readonly string[]): void;
  /** Keep (or clear, see {@link ListViewLayoutPatch}) part of one view's layout. */
  patchView(viewId: string, patch: ListViewLayoutPatch): void;
}

/** The signed-in reader's list layout for one object, in this browser; `{}` and no writes while nobody is signed in. */
export function useObjectListLayout(objectName: string | undefined): ObjectListLayoutHandle {
  clearRetiredListStateKeysOnce();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const name = objectName ?? '';
  const key = listLayoutStorageKey(userId, name);
  const layout = useSyncExternalStore(
    subscribe,
    () => (key ? snapshotOf(key) : EMPTY),
    () => EMPTY,
  );

  const update = useCallback(
    (fn: (prev: ObjectListLayout) => ObjectListLayout) => {
      if (!listLayoutStorageKey(userId, name)) return;
      const prev = readListLayout(userId, name);
      const next = fn(prev);
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      writeListLayout(userId, name, next);
    },
    [name, userId],
  );
  const setViewOrder = useCallback(
    (ids: readonly string[]) => update((prev) => setViewOrderLayout(prev, ids)),
    [update],
  );
  const patchView = useCallback(
    (viewId: string, patch: ListViewLayoutPatch) => {
      if (!viewId) return;
      update((prev) => patchViewLayout(prev, viewId, patch));
    },
    [update],
  );
  return { layout, setViewOrder, patchView };
}
