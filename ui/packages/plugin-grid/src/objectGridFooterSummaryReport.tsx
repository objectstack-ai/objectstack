/**
 * `FooterSummaryReport`, the renderless reporter `ObjectGrid` (`./ObjectGrid.tsx`)
 * mounts to hand its column summaries to a host, moved out of that file
 * verbatim (objectstack#25994, slice 2).
 */

import React, { useEffect } from 'react';
import type { ObjectGridFooterSummary } from './objectGridProps';

/**
 * [objectui#12528] Reports the grid's column summaries to a host that draws
 * them in its own footer row (`onColumnSummaryChange`). Renders nothing.
 *
 * Keyed on the summaries' TEXT, never on the array's identity (AGENTS.md #10):
 * every grid render builds a new array, and an equal one must send nothing.
 * Unmounting — whatever stops the grid drawing the row — reports `null`.
 */
export function FooterSummaryReport({
  summaries,
  onChange,
}: {
  summaries: ObjectGridFooterSummary[];
  onChange: (summaries: readonly ObjectGridFooterSummary[] | null) => void;
}) {
  const key = JSON.stringify(summaries);
  const onChangeRef = React.useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(JSON.parse(key) as ObjectGridFooterSummary[]);
  }, [key]);
  useEffect(() => () => onChangeRef.current(null), []);
  return null;
}
