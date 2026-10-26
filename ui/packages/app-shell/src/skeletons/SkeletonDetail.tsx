/**
 * SkeletonDetail
 *
 * Skeleton loading placeholder for record detail views.
 * Renders animated pulse fields that mimic a detail form layout.
 * @module
 */

import { Skeleton } from '@object-ui/components';

interface SkeletonDetailProps {
  /** Number of field rows to render */
  fields?: number;
  /** Number of columns */
  columns?: number;
}

export function SkeletonDetail({ fields = 8, columns = 2 }: SkeletonDetailProps) {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>

      {/* Section title */}
      <Skeleton className="h-5 w-24" />

      {/* Field grid */}
      <div className={`grid grid-cols-1 ${columns === 2 ? 'md:grid-cols-2' : ''} gap-4`}>
        {Array.from({ length: fields }).map((_, i) => (
          <div key={`field-${i}`} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>

      {/* Related section */}
      <div className="space-y-3 pt-4 border-t">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`related-${i}`} className="flex items-center gap-3 py-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
