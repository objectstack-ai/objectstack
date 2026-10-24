/**
 * SkeletonGrid
 *
 * Skeleton loading placeholder for grid/table views.
 * Renders animated pulse rows that mimic a data table layout.
 * @module
 */

import { Skeleton } from '@object-ui/components';

interface SkeletonGridProps {
  /** Number of skeleton rows to render */
  rows?: number;
  /** Number of columns to render */
  columns?: number;
}

export function SkeletonGrid({ rows = 8, columns = 5 }: SkeletonGridProps) {
  return (
    <div className="w-full space-y-4 p-4">
      {/* Toolbar skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-md border">
        {/* Header */}
        <div className="flex items-center gap-4 border-b px-4 py-3 bg-muted/30">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={`header-${i}`} className="h-4 flex-1" />
          ))}
        </div>

        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={`row-${rowIdx}`}
            className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3"
          >
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton
                key={`cell-${rowIdx}-${colIdx}`}
                className={`h-4 flex-1 ${colIdx === 0 ? 'max-w-[200px]' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
    </div>
  );
}
