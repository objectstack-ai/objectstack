/**
 * The row-height sync of `ObjectGrid` (`./ObjectGrid.tsx`): the effect that
 * follows a changed `schema.rowHeight` into the grid's own row-height state,
 * moved out of the component verbatim (objectstack#25994, slice 7). The state
 * and its setter stay in the component, which passes them in.
 */

import React from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import { type RowHeightMode, resolveRowHeightMode } from './objectGridDefaults';

/**
 * Runs `ObjectGrid`'s row-height sync effect. It declares no state and returns
 * nothing. `ObjectGrid` calls it where the effect used to stand, so the order
 * of the component's hooks does not change.
 */
export function useObjectGridRowHeightSync({
  schema, rowHeightMode, setRowHeightMode,
}: {
  schema: ObjectGridSchema;
  rowHeightMode: RowHeightMode;
  setRowHeightMode: React.Dispatch<React.SetStateAction<RowHeightMode>>;
}): void {
  // Sync internal rowHeightMode when schema.rowHeight prop changes (e.g., parent ListView density toggle).
  // Routed through the same resolver as the seed above: this is the component's
  // second entry point for an author-supplied `rowHeight`, and one resolver at
  // every entry is what keeps the answer single (objectui#4443).
  React.useEffect(() => {
    if (!schema.rowHeight) return;
    const next = resolveRowHeightMode(schema.rowHeight);
    if (next !== rowHeightMode) {
      setRowHeightMode(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.rowHeight]);
}
