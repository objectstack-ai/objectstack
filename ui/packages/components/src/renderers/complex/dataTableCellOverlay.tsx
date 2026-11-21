/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';
import { caretToEnd, firstEditorControl } from './dataTableCellSelection';

/**
 * A layer drawn over one grid cell, top-left on the cell's own corner, at least
 * as wide as the cell, free to grow wider and taller (objectstack#35688).
 *
 * Invariants:
 * - The table's layout never moves: the layer is `position: fixed` (Radix
 *   Popper), so neither the row height nor any column width changes.
 * - The layer stays in the cell's DOM subtree (no portal). Every `contains`
 *   read the grid already makes — click-outside, focus, keydown routing —
 *   keeps seeing the editor as inside its cell.
 * - Near the viewport's bottom it flips so its bottom edge sits on the cell's
 *   bottom edge; near the right edge it shifts left. Its height is capped at
 *   the space available and scrolls inside.
 * - The host cell is raised above the sticky header and frozen columns while
 *   the layer is open (`CELL_OVERLAY_HOST_CLASS`), because a fixed descendant
 *   still paints inside its nearest stacking context.
 */
export function CellOverlay({
  children,
  className,
  kind,
  layerRef,
  onKeyDown,
}: {
  children: React.ReactNode;
  className?: string;
  /** `preview` = the read-only full-content view of a selected cell; `editor` = the editor. */
  kind: 'preview' | 'editor';
  layerRef?: (node: HTMLDivElement | null) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  const markerRef = React.useRef<HTMLSpanElement | null>(null);
  const [cell, setCell] = React.useState<HTMLElement | null>(null);
  const [cellHeight, setCellHeight] = React.useState(0);

  React.useLayoutEffect(() => {
    const td = markerRef.current?.closest('td,[role="gridcell"]') as HTMLElement | null;
    setCell(td);
    if (td) setCellHeight(td.getBoundingClientRect().height);
  }, []);

  // The editor takes the caret once the layer is placed: Radix keeps an
  // unplaced layer hidden, and a hidden control refuses focus.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (kind !== 'editor' || !cell) return undefined;
    let frame = 0;
    let frames = 0;
    const place = () => {
      const host = contentRef.current;
      if (host?.contains(document.activeElement)) return;
      const control = host ? firstEditorControl(host) : null;
      if (control) {
        control.focus({ preventScroll: true });
        caretToEnd(control);
        if (host?.contains(document.activeElement)) return;
      }
      if (++frames < 30) frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [kind, cell]);

  const virtualRef = React.useMemo(
    () => ({ current: { getBoundingClientRect: () => (cell ?? markerRef.current!).getBoundingClientRect() } }),
    [cell],
  );

  return (
    <>
      <span ref={markerRef} aria-hidden="true" className="hidden" />
      {cell && (
        <PopoverPrimitive.Root open modal={false}>
          <PopoverPrimitive.Anchor virtualRef={virtualRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
          <PopoverPrimitive.Content
            ref={(node) => { contentRef.current = node; layerRef?.(node); }}
            data-slot={kind === 'editor' ? 'cell-editor-overlay' : 'cell-preview-overlay'}
            side="bottom"
            align="start"
            sideOffset={-cellHeight}
            avoidCollisions
            collisionPadding={8}
            // The grid owns focus, Escape and click-outside; the layer only places.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onFocusOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
            className={cn(
              'z-50 w-max min-w-(--radix-popper-anchor-width) max-w-[min(32rem,var(--radix-popper-available-width))]',
              'max-h-(--radix-popper-available-height) overflow-auto',
              'rounded-sm border border-primary bg-popover text-popover-foreground shadow-lg outline-none',
              kind === 'preview' && 'pointer-events-auto px-3 py-1.5 text-[13px] leading-normal whitespace-pre-wrap break-words',
              className,
            )}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Root>
      )}
    </>
  );
}

/** Raises the cell that hosts an open {@link CellOverlay} above sticky cells and the header. */
export const CELL_OVERLAY_HOST_CLASS = 'z-30';

/** True when a cell's drawn content is cut off (by width or by height). */
export function isCellContentTruncated(el: HTMLElement | null): boolean {
  if (!el) return false;
  const cut = (n: Element) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
  // A cell renderer often truncates on its own element inside the cell.
  return cut(el) || Array.from(el.querySelectorAll('*')).some((n) => n.clientWidth > 0 && cut(n));
}
