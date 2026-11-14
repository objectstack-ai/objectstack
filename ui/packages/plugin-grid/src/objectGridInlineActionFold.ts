/**
 * Whether `ObjectGrid` folds its inline primary row actions into the row's
 * "⋮" menu (objectstack#33230).
 *
 * The Actions column is pinned to the scroll box's right edge
 * (`./objectGridActionsColumn`), so while the table overflows the box the
 * column sits over whichever data column reaches that edge at rest. An inline
 * primary button roughly doubles the column (one button beside the "⋮"
 * trigger), and in a narrow host — a related list enlarged inside a record
 * drawer — that width alone can tip a table whose data columns fit into one
 * that overflows, and put the pinned column over the last data column.
 *
 * The rule: inline buttons are drawn only while the table fits its scroll box
 * with them. A table that overflows with them folds them: each primary action
 * moves to the top of its row's "⋮" menu (`planRowActionMenu`'s inline budget
 * of 0), so no action is dropped, and the pinned column shrinks to the
 * trigger. The buttons come back once the box is as wide as the table was with
 * them. Where the table still overflows menu-only, the narrower pinned column
 * still sits over the data at the box's edge, as on any list that scrolls
 * sideways.
 *
 * Every reading is taken once the table's size has held for two frames: the
 * table re-sizes its columns from what their cells drew over several passes,
 * and a decision taken mid-pass would read a width the table never settles at.
 */

import * as React from 'react';

/** Sub-pixel rounding is not an overflow. */
const OVERFLOW_SLACK_PX = 1;
/** Frames the table's size must hold before it is read. */
const SETTLED_FRAMES = 2;

/**
 * Reads the grid's table scroll box under the element `hostRef` is attached
 * to and answers whether the inline row actions fold. Starts unfolded, and
 * starts again unfolded whenever `rows` or `columnsKey` change.
 */
export function useInlineRowActionFold(rows: unknown, columnsKey: string): {
  hostRef: (element: HTMLElement | null) => void;
  folded: boolean;
} {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [folded, setFolded] = React.useState(false);
  // The decision the readings act on, written only where it is made.
  const foldedRef = React.useRef(false);
  // While folded: the table's width with the buttons, read when it folded.
  const unfoldedWidthRef = React.useRef(0);

  React.useLayoutEffect(() => {
    unfoldedWidthRef.current = 0;
    foldedRef.current = false;
    setFolded(false);
  }, [rows, columnsKey]);

  React.useLayoutEffect(() => {
    if (!host || typeof window === 'undefined') return undefined;
    let resizes: ResizeObserver | null = null;
    let mounts: MutationObserver | null = null;
    let watched: HTMLElement | null = null;
    let frame = 0;
    let lastSize = '';
    let heldFrames = 0;

    const decide = (next: boolean) => {
      if (next === foldedRef.current) return;
      foldedRef.current = next;
      setFolded(next);
    };
    const read = (box: HTMLElement) => {
      const boxWidth = box.clientWidth;
      if (boxWidth <= 0) return;
      if (foldedRef.current) {
        if (boxWidth >= unfoldedWidthRef.current) decide(false);
        return;
      }
      const tableWidth = box.scrollWidth;
      if (tableWidth - boxWidth <= OVERFLOW_SLACK_PX) return;
      if (!box.querySelector('[data-testid^="row-action-inline-"]')) return;
      unfoldedWidthRef.current = tableWidth;
      decide(true);
    };
    const tick = () => {
      frame = 0;
      const box = watched;
      if (!box || !box.isConnected) return;
      const size = `${box.clientWidth}:${box.scrollWidth}`;
      heldFrames = size === lastSize ? heldFrames + 1 : 0;
      lastSize = size;
      if (heldFrames >= SETTLED_FRAMES) {
        read(box);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    const schedule = () => {
      heldFrames = 0;
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    const watch = (box: HTMLElement) => {
      watched = box;
      schedule();
      if (typeof ResizeObserver === 'undefined') return;
      resizes = new ResizeObserver(schedule);
      resizes.observe(box);
      const table = box.querySelector('table');
      if (table) resizes.observe(table);
    };
    const findBox = () => host.querySelector<HTMLElement>('[data-table-scroll-box]');
    const box = findBox();
    if (box) {
      watch(box);
    } else if (typeof MutationObserver !== 'undefined') {
      // The table can mount after the grid does: wait for its scroll box.
      mounts = new MutationObserver(() => {
        const found = findBox();
        if (!found) return;
        mounts?.disconnect();
        mounts = null;
        watch(found);
      });
      mounts.observe(host, { childList: true, subtree: true });
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mounts?.disconnect();
      resizes?.disconnect();
    };
  }, [host]);

  return { hostRef: setHost, folded };
}
