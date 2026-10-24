/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * VirtualGrid Component
 * 
 * Implements virtual scrolling using @tanstack/react-virtual for efficient
 * rendering of large datasets. Only renders visible rows, dramatically improving
 * performance with datasets of 1000+ items.
 * 
 * Features:
 * - Virtual scrolling for rows
 * - Configurable row height
 * - Overscan for smooth scrolling
 * - Minimal DOM nodes (only visible items)
 */

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualGridColumn {
  header: string;
  accessorKey: string;
  cell?: (value: any, row: any) => React.ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
}

export interface VirtualGridProps {
  data: any[];
  columns: VirtualGridColumn[];
  rowHeight?: number;
  height?: number | string;
  className?: string;
  headerClassName?: string;
  rowClassName?: string | ((row: any, index: number) => string);
  onRowClick?: (row: any, index: number) => void;
  overscan?: number;
}

/**
 * Virtual scrolling grid component
 * 
 * @example
 * ```tsx
 * <VirtualGrid
 *   data={items}
 *   columns={[
 *     { header: 'Name', accessorKey: 'name' },
 *     { header: 'Age', accessorKey: 'age' },
 *   ]}
 *   rowHeight={40}
 * />
 * ```
 */
export const VirtualGrid: React.FC<VirtualGridProps> = ({
  data,
  columns,
  rowHeight = 40,
  height = 600,
  className = '',
  headerClassName = '',
  rowClassName,
  onRowClick,
  overscan = 5,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div className={className}>
      {/* Header */}
      <div
        className={`grid border-b sticky top-0 bg-muted/30 z-10 ${headerClassName}`}
        style={{
          gridTemplateColumns: columns
            .map((col) => col.width || '1fr')
            .join(' '),
        }}
      >
        {columns.map((column, index) => (
          <div
            key={index}
            className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 ${
              column.align === 'center'
                ? 'text-center'
                : column.align === 'right'
                ? 'text-right'
                : 'text-left'
            }`}
          >
            {column.header}
          </div>
        ))}
      </div>

      {/* Virtual scrolling container */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ 
          height: typeof height === 'number' ? `${height}px` : height,
          contain: 'strict' 
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {items.map((virtualRow) => {
            const row = data[virtualRow.index];
            const rowClasses =
              typeof rowClassName === 'function'
                ? rowClassName(row, virtualRow.index)
                : rowClassName || '';

            return (
              <div
                key={virtualRow.key}
                className={`grid border-b hover:bg-muted/50 cursor-pointer ${rowClasses}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: columns
                    .map((col) => col.width || '1fr')
                    .join(' '),
                }}
                onClick={(e) => {
                  // objectui#13188 — a drag that selected text in the row is
                  // a copy gesture, not an open.
                  const selection = window.getSelection();
                  if (selection && !selection.isCollapsed && selection.toString().trim() !== ''
                    && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(e.currentTarget)) return;
                  onRowClick?.(row, virtualRow.index);
                }}
              >
                {columns.map((column, colIndex) => {
                  const value = row[column.accessorKey];
                  const cellContent = column.cell
                    ? column.cell(value, row)
                    : (value != null && typeof value === 'object' ? String(value) : value);

                  return (
                    <div
                      key={colIndex}
                      className={`px-4 py-2 text-sm flex items-center ${
                        column.align === 'center'
                          ? 'text-center justify-center'
                          : column.align === 'right'
                          ? 'text-right justify-end'
                          : 'text-left justify-start'
                      }`}
                    >
                      {cellContent}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Showing {items.length} of {data.length} rows (virtual scrolling enabled)
      </div>
    </div>
  );
};
