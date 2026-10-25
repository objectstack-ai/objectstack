/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useRef, useCallback, useState } from 'react';
import { cn } from '@object-ui/components';
import { GripVertical } from 'lucide-react';

export interface SplitPaneGridProps {
  /** Initial width (px) of the frozen (left) pane. */
  frozenWidth: number;
  /** Called with the new frozen width while the user drags the divider. */
  onResize?: (frozenWidth: number) => void;
  /** Minimum width (px) allowed for the frozen pane. */
  minFrozenWidth?: number;
  /** Minimum width (px) allowed for the scrollable pane. */
  minScrollableWidth?: number;
  /** Content rendered in the frozen (left) pane. */
  left: React.ReactNode;
  /** Content rendered in the scrollable (right) pane. */
  right: React.ReactNode;
  /** Additional class names for the outer container. */
  className?: string;
}

/**
 * Split-pane wrapper that places a resizable vertical divider between a frozen
 * (left) area and a scrollable (right) area.  Drag the handle to resize.
 */
export function SplitPaneGrid({
  frozenWidth: frozenWidthProp,
  onResize,
  minFrozenWidth = 100,
  minScrollableWidth = 200,
  left,
  right,
  className,
}: SplitPaneGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localWidth, setLocalWidth] = useState(frozenWidthProp);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const frozenWidth = onResize ? frozenWidthProp : localWidth;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = frozenWidth;

      const onPointerMove = (ev: PointerEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const containerWidth = containerRef.current.offsetWidth;
        const delta = ev.clientX - startX.current;
        let newWidth = startWidth.current + delta;

        // Enforce constraints.
        newWidth = Math.max(newWidth, minFrozenWidth);
        newWidth = Math.min(newWidth, containerWidth - minScrollableWidth);

        if (onResize) {
          onResize(newWidth);
        } else {
          setLocalWidth(newWidth);
        }
      };

      const onPointerUp = () => {
        dragging.current = false;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [frozenWidth, minFrozenWidth, minScrollableWidth, onResize],
  );

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full overflow-hidden', className)}
    >
      {/* Frozen (left) pane */}
      <div
        className="shrink-0 overflow-auto"
        style={{ width: frozenWidth }}
      >
        {left}
      </div>

      {/* Resizable divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handlePointerDown}
        className={cn(
          'flex w-2 cursor-col-resize items-center justify-center',
          'border-x border-border bg-muted/50 hover:bg-muted',
          'transition-colors',
        )}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Scrollable (right) pane */}
      <div className="min-w-0 flex-1 overflow-auto">
        {right}
      </div>
    </div>
  );
}
