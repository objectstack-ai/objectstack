/**
 * SkeletonDashboard
 *
 * Skeleton loading placeholder for dashboard views.
 * Renders animated pulse cards that mimic a dashboard grid layout.
 * @module
 */

import { Skeleton } from '@object-ui/components';

interface SkeletonDashboardProps {
  /** Number of widget cards to render */
  cards?: number;
}

export function SkeletonDashboard({ cards = 6 }: SkeletonDashboardProps) {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      {/* Dashboard header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`stat-${i}`} className="rounded-lg border p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Widget grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={`widget-${i}`} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <Skeleton className="h-40 w-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
