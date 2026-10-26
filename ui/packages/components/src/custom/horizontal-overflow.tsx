import * as React from 'react';
import { cn } from '../lib/utils';
import { useHorizontalOverflow, HOVER_SCROLLBAR_CLASSES } from './use-horizontal-overflow';

export interface HorizontalOverflowBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Where the shadow is drawn: `edge` (default) overlays the box's right edge;
   * `pinned` leaves it to the right-pinned cells inside, which carry
   * `PINNED_RIGHT_SEAM_SHADOW_CLASSES` (`./use-horizontal-overflow`).
   */
  seam?: 'edge' | 'pinned';
  /** Classes for the positioned wrapper around the scrolling box. */
  outerClassName?: string;
}

/**
 * A horizontally scrolling box with the shared overflow affordance. The
 * scrolling element is the inner `div` (`className`, the ref and every other
 * prop land on it); the edge shadow is its sibling, so it never scrolls away
 * with the content.
 */
export const HorizontalOverflowBox = React.forwardRef<HTMLDivElement, HorizontalOverflowBoxProps>(
  ({ seam = 'edge', outerClassName, className, children, ...rest }, forwardedRef) => {
    const boxRef = React.useRef<HTMLDivElement | null>(null);
    const setRef = React.useCallback((node: HTMLDivElement | null) => {
      boxRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);
    const overflowRight = useHorizontalOverflow(boxRef);
    return (
      <div className={cn('relative min-w-0', outerClassName)}>
        <div
          {...rest}
          ref={setRef}
          data-overflow-right={overflowRight ? 'true' : undefined}
          className={cn('group/hscroll overflow-x-auto', HOVER_SCROLLBAR_CLASSES, className)}
        >
          {children}
        </div>
        {overflowRight && seam === 'edge' && (
          <div
            aria-hidden="true"
            data-testid="horizontal-overflow-shadow"
            className="pointer-events-none absolute inset-y-0 right-0 z-30 w-6 bg-gradient-to-l from-foreground/10 to-transparent"
          />
        )}
      </div>
    );
  },
);
HorizontalOverflowBox.displayName = 'HorizontalOverflowBox';
