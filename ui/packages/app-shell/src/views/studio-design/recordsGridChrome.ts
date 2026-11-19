// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * recordsGridChrome — what the Data pillar's Records tab adds, from the host
 * side, to the runtime records grid it mounts (objectstack#35061, item 3).
 *
 * The grid is the runtime one (plugin-view's ObjectView → plugin-list's
 * ListView → the components data table), unchanged for every list page. It
 * already keeps its widths (each column's width is its min and max width, an
 * estimate clamped to 80–400 px, so a long text column stops at 400 px and
 * truncates), freezes its first column (the name field, objectstack#34794),
 * and scrolls sideways in its own box, the element it marks
 * `data-table-scroll-box` for a host to read. Two things it does not do for
 * the Studio, and this module does from the host:
 *
 *  - its scrollbar is transparent until the pointer is over the box, so with
 *    the right slot open nothing says more columns are to the right; on the
 *    Records tab it is always drawn ({@link RECORDS_SCROLLBAR_VISIBLE});
 *  - a column selected by its header (or from the field list) may sit under
 *    the frozen name column or past the right edge; it is scrolled into view
 *    ({@link revealColumn}).
 */

/**
 * On the Records tab's body: the grid's scroll box draws its scrollbar at
 * rest. A literal (Tailwind scans source text); the descendant selector
 * outranks the grid's own transparent colour, which is `!important` too.
 */
export const RECORDS_SCROLLBAR_VISIBLE =
  '[&_[data-table-scroll-box]]:[scrollbar-color:var(--color-muted-foreground)_transparent]!';

/**
 * Scrolls the grid's box sideways, the least that brings `header`'s column
 * whole into the part of the box no pinned column covers: right of the frozen
 * columns before it, left of the pinned columns after it (the row actions).
 * Vertical scroll is never touched. Returns the new `scrollLeft`, or `null`
 * when the column was already in view or the header is not in a scroll box.
 */
export function revealColumn(header: Element): number | null {
  const box = header.closest('[data-table-scroll-box]') as HTMLElement | null;
  const row = header.parentElement;
  if (!box || !row) return null;
  // A frozen column is always in view.
  if (getComputedStyle(header).position === 'sticky') return null;
  const boxRect = box.getBoundingClientRect();
  let left = boxRect.left;
  let right = boxRect.left + box.clientWidth;
  let after = false;
  for (const cell of Array.from(row.children)) {
    if (cell === header) {
      after = true;
      continue;
    }
    if (getComputedStyle(cell).position !== 'sticky') continue;
    const r = cell.getBoundingClientRect();
    if (after) right = Math.min(right, r.left);
    else left = Math.max(left, r.right);
  }
  const h = header.getBoundingClientRect();
  let delta = 0;
  if (h.left < left) delta = h.left - left;
  else if (h.right > right) delta = Math.min(h.right - right, h.left - left);
  if (delta === 0) return null;
  box.scrollLeft = Math.max(0, box.scrollLeft + delta);
  return box.scrollLeft;
}
