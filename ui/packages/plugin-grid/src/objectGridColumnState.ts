/**
 * The column-state persistence of `ObjectGrid` (`./ObjectGrid.tsx`): the
 * storage key, the `columnState` seed with the host's inbound channel, the
 * sync of an external `columnState` and the outbound `saveColumnState`, moved
 * out of the component verbatim (objectstack#25994, slice 7). The
 * NON-AUTHOR SURFACE comment stays directly above the seed it documents.
 */

import React, { useState, useCallback } from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import type { ObjectGridColumnState, ObjectGridExternalPaginationProps } from './objectGridProps';

/**
 * `ObjectGrid`'s column order and widths: the persisted state and the save
 * the column handlers call. `ObjectGrid` calls it where these lines used to
 * stand, so the order of the component's hooks does not change.
 */
export function useObjectGridColumnState({
  schema, onColumnStateChange,
}: {
  schema: ObjectGridSchema;
  onColumnStateChange: ObjectGridExternalPaginationProps['onColumnStateChange'];
}) {
  // Column state persistence (order and widths)
  const columnStorageKey = React.useMemo(() => {
    return schema.id
      ? `grid-columns-${schema.objectName}-${schema.id}`
      : `grid-columns-${schema.objectName}`;
  }, [schema.objectName, schema.id]);

  /**
   * NON-AUTHOR SURFACE — `columnState` is deliberately absent from
   * `GRID_QUERY_INPUTS` (`index.tsx`), by the maintainer ruling of 2026-08-18
   * on objectui#5091. The cast reads in this block are therefore DELIBERATELY
   * unlisted, not missed.
   *
   * It is the USER-STATE persistence payload, not authoring surface: the host
   * hands in whatever the user last saved (app-shell's `ObjectView` reads it
   * off the user's own list state, then off the view def) and stores their
   * drags back on that state (`persistListColumnState` there; `saveColumnState`
   * below is the outbound half). Publishing it would put
   * column widths and order in the designer panel and in the generated
   * `sdui-intrinsics.d.ts` — i.e. bless hand-authoring a payload the product
   * writes on the user's behalf.
   *
   * The contract says the same thing independently: `ComponentPropsMap
   * ['object-grid']` (`@objectstack/spec@17`) is a `strictObject` and rejects
   * `columnState` BY NAME (`unrecognized_keys`), so an author who took the
   * offer could not save the document. Both halves — unlisted here, rejected
   * there — are pinned by `__tests__/gridNonAuthorKeys.test.tsx`, together with
   * the reads themselves, so this exemption cannot decay into a silent drop.
   */
  const [columnState, setColumnState] = useState<ObjectGridColumnState>(() => {
    // Priority: 1) externally provided (e.g. persisted view override),
    // 2) localStorage (per-browser fallback), 3) empty.
    const fromProps = (schema as any).columnState;
    if (fromProps && typeof fromProps === 'object') return fromProps;
    try {
      const saved = localStorage.getItem(columnStorageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Sync when external columnState changes (e.g. switching views, reload pulls
  // a saved override from the server). Wrapped in a stable string key to
  // avoid re-renders when the parent passes a fresh-but-equal object.
  // Non-author surface, same ruling as the seed above (objectui#5091): these
  // two reads are the host's inbound channel, never an authored key.
  const externalColumnStateKey = React.useMemo(
    () => JSON.stringify((schema as any).columnState ?? null),
    [(schema as any).columnState]
  );
  React.useEffect(() => {
    const fromProps = (schema as any).columnState;
    if (fromProps && typeof fromProps === 'object') {
      setColumnState(fromProps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalColumnStateKey]);

  const saveColumnState = useCallback((state: typeof columnState) => {
    setColumnState(state);
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to persist column state:', e);
    }
    // Notify the host so it can persist the layout (the console stores it on
    // the signed-in user's own list state).
    if (typeof onColumnStateChange === 'function') {
      try { onColumnStateChange(state); } catch (e) { console.warn('onColumnStateChange threw:', e); }
    }
  }, [columnStorageKey, onColumnStateChange]);

  return { columnState, saveColumnState };
}
