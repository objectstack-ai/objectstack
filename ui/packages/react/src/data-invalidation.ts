/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * data-invalidation — the client-side data invalidation bus (objectui#2269).
 *
 * "Refresh data, don't rebuild UI": after a write (create / update / delete /
 * record action), the WRITER declares what changed — `notifyDataChanged({
 * objectName, recordId? })` — and every mounted READER of that data refetches
 * in place via {@link useDataInvalidation}. The component tree is never
 * remounted for a data refresh, so UI state that lives in components (scroll,
 * collapsed sections, in-progress inline edits) survives every save.
 *
 * This generalizes two pre-existing one-off mechanisms into one seam:
 *   - the `objectui:related-changed` window event (RelatedList refetch) — the
 *     bus still dispatches it for backward compatibility, and
 *     `notifyRelatedChanged` in app-shell now delegates here;
 *   - `RelatedCountStore.invalidate` (tab count badges) — wired to the bus by
 *     `@object-ui/components`.
 *
 * It deliberately replaces the `key={refreshKey}`-style "bump a key to
 * remount the subtree" pattern, which conflated data refresh with UI
 * reconstruction (AGENTS.md Commandment #8).
 *
 * Scope semantics:
 *   - `notifyDataChanged({ objectName })` — object-wide: lists, counts, and
 *     every record of that object may be stale;
 *   - `notifyDataChanged({ objectName, recordId })` — one record changed
 *     (lists of that object are still refreshed — membership/ordering may
 *     have changed);
 *   - `notifyDataChanged({ objectName: '*' })` — everything (undo/redo of an
 *     unknown operation).
 */

import { useEffect, useState } from 'react';

/** What changed. `objectName: '*'` means "unknown — treat everything as stale". */
export interface DataChange {
  objectName: string;
  recordId?: string;
}

type DataChangeListener = (change: DataChange) => void;

const listeners = new Set<DataChangeListener>();

/** Legacy window event kept for pre-#2269 listeners (see RelatedList). */
export const RELATED_CHANGED_EVENT = 'objectui:related-changed';

/**
 * Declare that data changed. Call this from every WRITE path after the
 * mutation succeeds; matching {@link useDataInvalidation} readers refetch.
 */
export function notifyDataChanged(change: DataChange): void {
  for (const l of Array.from(listeners)) {
    try {
      l(change);
    } catch {
      // one bad listener must not starve the rest
    }
  }
  // Backward-compat bridge: pre-bus consumers listen for this window event.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(RELATED_CHANGED_EVENT, { detail: { objectName: change.objectName, recordId: change.recordId } }),
    );
  }
}

/** Subscribe to every change (unfiltered). Returns the unsubscribe function. */
export function subscribeDataChanges(listener: DataChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when `change` makes data for (objectName, recordId?) stale. */
export function dataChangeMatches(
  change: DataChange,
  objectName: string,
  recordId?: string,
): boolean {
  if (change.objectName === '*') return true;
  if (change.objectName !== objectName) return false;
  // An object-scoped change staled every record; a record-scoped change
  // stales that record and the object's lists (a hook WITHOUT recordId is a
  // list/aggregate reader — membership or ordering may have shifted).
  if (recordId === undefined || change.recordId === undefined) return true;
  return change.recordId === recordId;
}

/**
 * Reader hook: returns a nonce that bumps whenever matching data changes.
 * Put it in your fetch effect's dependency array — the refetch happens in
 * place, no remount:
 *
 * ```ts
 * const invalidationNonce = useDataInvalidation(objectName, recordId);
 * useEffect(() => { void load(); }, [objectName, recordId, invalidationNonce]);
 * ```
 */
export function useDataInvalidation(objectName?: string, recordId?: string): number {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!objectName) return;
    return subscribeDataChanges((change) => {
      if (dataChangeMatches(change, objectName, recordId)) {
        setNonce((n) => n + 1);
      }
    });
  }, [objectName, recordId]);
  return nonce;
}

/**
 * Bridge `DataSource.onMutation` (the automatic event every dataSource write
 * already emits — see `MutationEvent` in `@object-ui/types`) onto this bus.
 * Mount ONCE per app (the console does it in `AppContent`); after that, every
 * create/update/delete performed through the dataSource reaches all
 * {@link useDataInvalidation} readers with no manual `notifyDataChanged`
 * call. Manual calls remain for writes that BYPASS the dataSource (server
 * actions over raw HTTP, flow completions, approvals).
 */
export function useMutationInvalidationBridge(dataSource: unknown): void {
  useEffect(() => {
    const ds = dataSource as { onMutation?: (cb: (e: { resource: string; id?: string | number }) => void) => () => void } | null;
    if (!ds?.onMutation) return;
    return ds.onMutation((e) => {
      if (!e?.resource) return;
      notifyDataChanged({
        objectName: e.resource,
        recordId: e.id != null ? String(e.id) : undefined,
      });
    });
  }, [dataSource]);
}
