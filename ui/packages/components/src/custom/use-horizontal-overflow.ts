import * as React from 'react';

/**
 * The horizontal-overflow affordance every wide table shares (objectui#12708):
 * a box that scrolls sideways says so with a right-edge shadow while columns
 * remain to its right, and shows its scrollbar while the pointer is over it or
 * focus is inside it. Built once, here, and used by `data-table`'s own scroll
 * box, `ObjectGrid`'s grouped scroller and any table a page mounts itself.
 */

/** Whether `box` can scroll further to the right (one pixel of slack for sub-pixel layouts). */
export function hasOverflowRight(box: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): boolean {
  return box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
}

/**
 * Track {@link hasOverflowRight} for the box `ref` points at: read in a layout
 * effect, so the first painted frame is already right, and again on every
 * scroll and whenever the box or its content (the box's children and their
 * children) changes size. `false` while `disabled` (the box does not scroll
 * on its own).
 */
export function useHorizontalOverflow(
  ref: React.RefObject<HTMLElement | null>,
  { disabled = false }: { disabled?: boolean } = {},
): boolean {
  const [overflowRight, setOverflowRight] = React.useState(false);
  React.useLayoutEffect(() => {
    const box = ref.current;
    if (disabled || !box) {
      setOverflowRight(false);
      return;
    }
    const read = () => setOverflowRight(hasOverflowRight(box));
    read();
    box.addEventListener('scroll', read, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(read);
      observer.observe(box);
      // The content's own size moves `scrollWidth` without resizing the box
      // (rows arrive, a column is resized). The content is each child of the
      // box AND each child's own children: a table usually sits in a wrapper
      // that keeps the box's width (the shadcn `Table`'s `w-full` container,
      // `overflow-visible` inside a box that scrolls), so the wrapper never
      // resizes while the `<table>` in it widens past the box. Measured on
      // the Studio metadata list (objectstack#37239): the rows drew at the
      // box's width, then the columns widened the table from 1134 to 1826 px
      // with no row added, and a read keyed on the wrapper alone never ran.
      for (const child of Array.from(box.children)) {
        observer.observe(child);
        for (const grandchild of Array.from(child.children)) observer.observe(grandchild);
      }
    }
    return () => {
      box.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  }, [ref, disabled]);
  return overflowRight;
}

/**
 * Scrollbar colours for a box that scrolls: transparent until the pointer is
 * over the box or focus is inside it, then the theme's muted foreground. The bar
 * keeps its place, so nothing shifts when it appears. Marked important
 * because a host may theme every scrollbar with an unlayered `*` rule (the
 * console does), which outranks any layered utility.
 */
export const HOVER_SCROLLBAR_CLASSES =
  '[scrollbar-width:thin]! [scrollbar-color:transparent_transparent]! hover:[scrollbar-color:var(--color-muted-foreground)_transparent]! focus-within:[scrollbar-color:var(--color-muted-foreground)_transparent]!';

/**
 * Classes for a RIGHT-PINNED cell inside a {@link HorizontalOverflowBox} with
 * `seam="pinned"`: the cell draws the shadow on its own left edge, the seam
 * where the scrolling columns slide under it, while the box can scroll further
 * right. Needs no measurement, because the pinned cell is where the seam is.
 * Spelled out in full (as the edge overlay below is) so Tailwind's source scan
 * sees every utility.
 */
export const PINNED_RIGHT_SEAM_SHADOW_CLASSES =
  'before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-6 before:bg-gradient-to-l before:from-foreground/10 before:to-transparent before:opacity-0 group-data-[overflow-right=true]/hscroll:before:opacity-100';
