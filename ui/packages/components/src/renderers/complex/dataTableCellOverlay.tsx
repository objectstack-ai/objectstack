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
import { isCellHidden, revealCell, type CellOverlaySize } from './dataTableCellOverlayDom';


/**
 * A layer drawn over one grid cell, top-left on the cell's own corner, at least
 * as wide as the cell, free to grow wider and taller (objectstack#35688).
 *
 * Invariants:
 * - The table's layout never moves: the layer is `position: fixed` (Radix
 *   Popper), so neither the row height nor any column width changes.
 * - The layer stays in the cell's DOM subtree (no portal). Every `contains`
 *   read the grid makes — click-outside, focus, keydown routing — keeps seeing
 *   the editor as inside its cell.
 * - Near the viewport's bottom it flips so its bottom edge sits on the cell's
 *   bottom edge; near the right edge it shifts left. Its height is capped at
 *   the space available and scrolls inside.
 * - On open, the cell is scrolled clear of the frozen columns, the right-pinned
 *   columns and the sticky header; once a scroll hides the cell behind them or
 *   out of the table's box, `onHidden` runs (the grid commits or collapses).
 * - The host cell is raised above the sticky header and frozen columns while
 *   the layer is open (`CELL_OVERLAY_HOST_CLASS`), because a fixed descendant
 *   still paints inside its nearest stacking context.
 */
export function CellOverlay({
  children,
  className,
  kind,
  minSize,
  onHidden,
}: {
  children: React.ReactNode;
  className?: string;
  /** `preview` = the read-only full content of a selected cell; `editor` = the editor. */
  kind: 'preview' | 'editor';
  minSize?: CellOverlaySize | null;
  onHidden?: () => void;
}) {
  const markerRef = React.useRef<HTMLSpanElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [cell, setCell] = React.useState<HTMLElement | null>(null);
  const [cellHeight, setCellHeight] = React.useState(0);
  const onHiddenRef = React.useRef(onHidden);
  React.useLayoutEffect(() => {
    onHiddenRef.current = onHidden;
  });

  React.useLayoutEffect(() => {
    const td = markerRef.current?.closest<HTMLElement>('td,[role="gridcell"]') ?? null;
    if (td) {
      revealCell(td);
      setCellHeight(td.getBoundingClientRect().height);
    }
    setCell(td);
  }, []);

  // A scroll that hides the cell closes its layer.
  React.useEffect(() => {
    if (!cell || typeof document === 'undefined') return undefined;
    let fired = false;
    const onScroll = () => {
      if (fired || !isCellHidden(cell)) return;
      fired = true;
      onHiddenRef.current?.();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [cell]);

  // The editor takes the caret once the layer is placed: Radix keeps an
  // unplaced layer hidden, and a hidden control refuses focus.
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

  // Seeded sizes travel as custom properties the static utilities below read.
  const seeded = minSize
    ? ({ '--cell-overlay-min-w': `${Math.round(minSize.width)}px`, '--cell-overlay-min-h': `${Math.round(minSize.height)}px` } as React.CSSProperties)
    : undefined;

  return (
    <>
      <span ref={markerRef} aria-hidden="true" className="hidden" />
      {cell && (
        <PopoverPrimitive.Root open modal={false}>
          <PopoverPrimitive.Anchor virtualRef={virtualRef} />
          <PopoverPrimitive.Content
            ref={contentRef}
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
            style={seeded}
            className={cn(
              'z-50 w-max max-w-[min(32rem,var(--radix-popper-available-width))]',
              'min-w-[max(var(--radix-popper-anchor-width),var(--cell-overlay-min-w,0px))] min-h-(--cell-overlay-min-h)',
              'max-h-(--radix-popper-available-height) overflow-auto',
              'rounded-md border border-primary bg-popover text-popover-foreground shadow-lg outline-none',
              kind === 'preview'
                ? [PREVIEW_UNCLIP_CLASS, 'px-3 py-1.5 text-[13px] leading-normal whitespace-pre-wrap break-words']
                : EDITOR_DENSITY_CLASS,
              className,
            )}
          >
            {/* Tab belongs to the grid's editor or to the browser, never to the
                layer's own focus loop (Radix loops focus inside a popover). */}
            <div className="contents" onKeyDown={(e) => { if (e.key === 'Tab') e.stopPropagation(); }}>
              {children}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Root>
      )}
    </>
  );
}

/**
 * What a preview undoes so a cell renderer's content wraps instead of
 * truncating. Its height cap keeps the space-available cap in the same class:
 * a second `max-h-*` would replace the layer's own.
 */
const PREVIEW_UNCLIP_CLASS =
  'max-h-[min(16rem,var(--radix-popper-available-height))] [&_*]:whitespace-normal! [&_*]:overflow-visible! [&_*]:text-clip! [&_*]:max-w-none! [&_.flex]:flex-wrap';

/**
 * A form control at the row's density inside the editor layer: single-line
 * controls are one row tall, and a textarea starts as tall as the preview it
 * replaces.
 */
const EDITOR_DENSITY_CLASS = cn(
  'p-1',
  '[&_input:not([type=checkbox]):not([type=radio]):not([type=range])]:h-8 [&_[role=combobox]]:h-8',
  '[&_input]:text-[13px] [&_textarea]:text-[13px]',
  '[&_textarea]:min-h-[max(5rem,calc(var(--cell-overlay-min-h,0px)-0.625rem))]',
);

