/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Geometry reads behind the grid's cell layer (`dataTableCellOverlay.tsx`,
 * objectstack#35688): what of a cell can be seen, and the scroll that shows it.
 */

/** The size a layer opens at, at least: the preview it replaces. */
export interface CellOverlaySize {
  width: number;
  height: number;
}

/** Raises the cell that hosts an open {@link CellOverlay} above sticky cells and the header. */
export const CELL_OVERLAY_HOST_CLASS = 'z-30';

/** True when a cell's drawn content is cut off, by width or by height. */
export function isCellContentTruncated(el: HTMLElement | null): boolean {
  if (!el) return false;
  const cut = (n: Element) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
  // A cell renderer often truncates on its own element inside the cell.
  return cut(el) || Array.from(el.querySelectorAll('*')).some((n) => n.clientWidth > 0 && cut(n));
}

function isScrollBox(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return /(auto|scroll)/.test(`${s.overflowX} ${s.overflowY}`);
}

function scrollBoxOf(td: HTMLElement): HTMLElement | null {
  for (let el = td.parentElement; el; el = el.parentElement) {
    if (isScrollBox(el)) return el;
  }
  return null;
}

/**
 * The part of the table's box a cell can be seen in: inside the scroll box,
 * right of the frozen columns, left of the right-pinned ones, below the
 * sticky header.
 */
function visibleBoxOf(td: HTMLElement): { left: number; right: number; top: number; bottom: number } | null {
  const box = scrollBoxOf(td);
  if (!box) return null;
  const b = box.getBoundingClientRect();
  let left = b.left;
  let right = b.left + box.clientWidth;
  let top = b.top;
  const bottom = b.top + box.clientHeight;
  const row = td.parentElement;
  if (row && getComputedStyle(td).position !== 'sticky') {
    for (const sib of Array.from(row.children) as HTMLElement[]) {
      if (sib === td) continue;
      const s = getComputedStyle(sib);
      if (s.position !== 'sticky') continue;
      const r = sib.getBoundingClientRect();
      if (s.left !== 'auto') left = Math.max(left, r.right);
      else if (s.right !== 'auto') right = Math.min(right, r.left);
    }
  }
  const head = td.closest('table')?.querySelector('thead');
  if (head && getComputedStyle(head).position === 'sticky') top = Math.max(top, head.getBoundingClientRect().bottom);
  return { left, right, top, bottom };
}

/** Scroll the table so the whole cell sits in its visible box (when it fits). */
export function revealCell(td: HTMLElement): void {
  const box = scrollBoxOf(td);
  const vis = visibleBoxOf(td);
  if (!box || !vis) return;
  const r = td.getBoundingClientRect();
  if (r.left < vis.left) box.scrollLeft -= vis.left - r.left;
  else if (r.right > vis.right && r.width <= vis.right - vis.left) box.scrollLeft += r.right - vis.right;
  if (r.top < vis.top) box.scrollTop -= vis.top - r.top;
  else if (r.bottom > vis.bottom && r.height <= vis.bottom - vis.top) box.scrollTop += r.bottom - vis.bottom;
}

/** True once no part of the cell can be seen in the table's visible box. */
export function isCellHidden(td: HTMLElement): boolean {
  const vis = visibleBoxOf(td);
  if (!vis) return false;
  const r = td.getBoundingClientRect();
  return r.right <= vis.left || r.left >= vis.right || r.bottom <= vis.top || r.top >= vis.bottom;
}
