/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDesignerTranslation } from '../hooks/useDesignerTranslation';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export interface MinimapItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  selected?: boolean;
}

export interface MinimapProps {
  /** Items to display on the minimap */
  items: MinimapItem[];
  /** Canvas width */
  canvasWidth: number;
  /** Canvas height */
  canvasHeight: number;
  /** Position of the minimap */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Minimap size */
  size?: number;
  /** CSS class */
  className?: string;
}

/**
 * Minimap component for canvas-based designers.
 * Shows a bird's-eye view of all items on the canvas.
 */
export function Minimap({
  items,
  canvasWidth,
  canvasHeight,
  position = 'bottom-right',
  size = 150,
  className,
}: MinimapProps) {
  const { t } = useDesignerTranslation();
  const scale = Math.min(size / canvasWidth, size / canvasHeight);
  const scaledWidth = canvasWidth * scale;
  const scaledHeight = canvasHeight * scale;

  const positionClasses = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };

  return (
    <div
      className={cn(
        'absolute border rounded bg-background/90 shadow-sm overflow-hidden',
        positionClasses[position],
        className,
      )}
      role="img"
      aria-label={t('designer.canvasMinimap')}
    >
      <svg width={scaledWidth} height={scaledHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
        <rect width={canvasWidth} height={canvasHeight} fill="hsl(var(--muted))" opacity="0.3" />
        {items.map((item) => (
          <rect
            key={item.id}
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.height}
            fill={item.selected ? 'hsl(var(--primary))' : (item.color ?? 'hsl(var(--foreground) / 0.3)')}
            rx="2"
          />
        ))}
      </svg>
    </div>
  );
}
