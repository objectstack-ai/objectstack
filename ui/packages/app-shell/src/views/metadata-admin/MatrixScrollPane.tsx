/**
 * The permission matrix's scroll pane (objectstack#27866): the grid's floor is
 * wider than the content column at 1440 px, so the pane scrolls sideways. A
 * fade on the right edge says columns are cut while any remain past it, and
 * `data-scrolled-x` lets the pinned first column draw its edge once rows slide
 * under it.
 */
import * as React from 'react';
import { cn } from '@object-ui/components';

/** Where the pane's horizontal scroll sits: content cut on the right, scrolled off the left. */
export interface PaneOverflow {
  right: boolean;
  left: boolean;
}

/** Read off the pane's box; a sub-pixel remainder is not a cut column. */
export function readPaneOverflow(el: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): PaneOverflow {
  return {
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    left: el.scrollLeft > 0,
  };
}

export function MatrixScrollPane({
  className,
  testId,
  children,
}: {
  /** Classes of the pane's outer box (its place in the page's flex column). */
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = React.useState<PaneOverflow>({ right: false, left: false });
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = readPaneOverflow(el);
    setOverflow((prev) => (prev.right === next.right && prev.left === next.left ? prev : next));
  }, []);
  React.useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // The pane and the grid both resize: the window, and a field list opening.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div
        ref={ref}
        onScroll={measure}
        data-testid={testId}
        data-scrolled-x={overflow.left || undefined}
        className="group/matrix min-h-0 flex-1 overflow-auto"
      >
        {children}
      </div>
      {overflow.right && (
        <div
          aria-hidden="true"
          data-testid="perm-matrix-overflow-cue"
          className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 bg-gradient-to-l from-background via-background/70 to-transparent"
        />
      )}
    </div>
  );
}
