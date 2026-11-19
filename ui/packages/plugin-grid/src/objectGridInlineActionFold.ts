/**
 * Whether `ObjectGrid` folds its inline primary row actions into the row's
 * "⋮" menu (objectstack#33230), and whether the Actions column leaves the
 * right edge for the frozen zone (objectstack#35446).
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
 * them.
 *
 * Where the table still overflows menu-only, a column pinned to the right edge
 * would sit over the data column that reaches that edge at rest (the amount
 * column of a list in a main area narrowed by the AI panel, a small window or
 * the record drawer). So while the table overflows, the Actions column joins
 * the frozen zone instead (`actionsFrozen`): `ObjectGrid` draws it right after
 * the frozen columns, which never cover a column at rest, and the data columns
 * all scroll. It goes back to the right edge once the box is as wide as the
 * table was when it moved. The move swaps the frozen zone's edge rule from the
 * name column to the Actions column, a few pixels at most
 * ({@link MOVE_WIDTH_SLACK_PX}), so the way back reads the width recorded
 * before the move and the two placements cannot flip-flop.
 *
 * Every reading is taken once the table's size has held for two frames: the
 * table re-sizes its columns from what their cells drew over several passes,
 * and a decision taken mid-pass would read a width the table never settles at.
 */

import * as React from 'react';

/** Sub-pixel rounding is not an overflow. */
const OVERFLOW_SLACK_PX = 1;
/**
 * How much the move to the frozen zone may narrow the table (the edge rules it
 * swaps). A frozen table that fits its box with more room than this to spare
 * goes back to the right edge even before the box reaches the width recorded
 * at the move, so a table that shrank while frozen is not held there.
 */
const MOVE_WIDTH_SLACK_PX = 4;
/** Frames the table's size must hold before it is read. */
const SETTLED_FRAMES = 2;

/**
 * Reads the grid's table scroll box under the element `hostRef` is attached
 * to and answers whether the inline row actions fold and whether the Actions
 * column is drawn in the frozen zone. Starts unfolded, and starts again
 * unfolded whenever `rows` or `columnsKey` change; the column's placement is
 * kept across those changes and read again from the widths they draw, so a
 * refresh does not move it to the right edge and back.
 */
export function useInlineRowActionFold(rows: unknown, columnsKey: string): {
  hostRef: (element: HTMLElement | null) => void;
  folded: boolean;
  actionsFrozen: boolean;
} {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [folded, setFolded] = React.useState(false);
  // The decision the readings act on, written only where it is made.
  const foldedRef = React.useRef(false);
  // While folded: the table's width with the buttons, read when it folded.
  const unfoldedWidthRef = React.useRef(0);
  const [actionsFrozen, setActionsFrozen] = React.useState(false);
  const frozenRef = React.useRef(false);
  // While frozen: the table's width with the column at the right edge.
  const pinnedWidthRef = React.useRef(0);

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
    const freeze = (next: boolean, tableWidth: number) => {
      if (next === frozenRef.current) return;
      frozenRef.current = next;
      if (next) pinnedWidthRef.current = tableWidth;
      setActionsFrozen(next);
    };
    const read = (box: HTMLElement) => {
      const boxWidth = box.clientWidth;
      if (boxWidth <= 0) return;
      const tableWidth = box.scrollWidth;
      const overflow = tableWidth - boxWidth;
      if (foldedRef.current) {
        if (boxWidth >= unfoldedWidthRef.current) {
          // The buttons fit again, so the table fits at the right edge too.
          freeze(false, tableWidth);
          decide(false);
          return;
        }
      } else if (overflow > OVERFLOW_SLACK_PX && box.querySelector('[data-testid^="row-action-inline-"]')) {
        // Fold first: the column's placement is read from the menu-only face.
        unfoldedWidthRef.current = tableWidth;
        decide(true);
        return;
      }
      if (!box.querySelector('th[data-column-key="_actions"]')) return;
      if (!frozenRef.current) {
        if (overflow > OVERFLOW_SLACK_PX) freeze(true, tableWidth);
      } else if (boxWidth >= pinnedWidthRef.current || overflow < -MOVE_WIDTH_SLACK_PX) {
        freeze(false, tableWidth);
      }
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

  return { hostRef: setHost, folded, actionsFrozen };
}
