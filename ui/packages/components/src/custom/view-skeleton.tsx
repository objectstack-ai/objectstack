/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn } from "../lib/utils"
import { Skeleton } from "../ui/skeleton"

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ViewSkeletonProps extends React.ComponentProps<"div"> {
  /** Number of rows/items to render */
  rows?: number
}

// ---------------------------------------------------------------------------
// GridSkeleton – table rows with header and column cells
// ---------------------------------------------------------------------------

export interface GridSkeletonProps extends ViewSkeletonProps {
  /** Number of columns to render */
  columns?: number
}

function GridSkeleton({
  rows = 5,
  columns = 4,
  className,
  ...props
}: GridSkeletonProps) {
  return (
    <div
      data-slot="grid-skeleton"
      className={cn("w-full space-y-2", className)}
      {...props}
    >
      {/* Header row */}
      <div className="flex gap-4 px-4 py-2">
        {Array.from({ length: columns }).map((_, col) => (
          <Skeleton key={col} className="h-4 flex-1 rounded" />
        ))}
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 rounded-md border px-4 py-3">
          {Array.from({ length: columns }).map((_, col) => (
            <Skeleton
              key={col}
              className={cn("h-4 flex-1 rounded", col === 0 && "max-w-[40%]")}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KanbanSkeleton – columns with placeholder cards
// ---------------------------------------------------------------------------

export interface KanbanSkeletonProps extends ViewSkeletonProps {
  /** Number of kanban columns to render */
  columns?: number
  /** Number of cards per column */
  cardsPerColumn?: number
}

function KanbanSkeleton({
  columns = 3,
  cardsPerColumn = 3,
  className,
  ...props
}: KanbanSkeletonProps) {
  return (
    <div
      data-slot="kanban-skeleton"
      className={cn("flex gap-4 overflow-x-auto", className)}
      {...props}
    >
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={col}
          className="flex w-72 shrink-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3"
        >
          {/* Column header */}
          <Skeleton className="h-5 w-24 rounded" />

          {/* Cards */}
          {Array.from({ length: cardsPerColumn }).map((_, card) => (
            <div key={card} className="space-y-2 rounded-md border bg-background p-3">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FormSkeleton – labeled form fields
// ---------------------------------------------------------------------------

function FormSkeleton({
  rows = 4,
  className,
  ...props
}: ViewSkeletonProps) {
  return (
    <div
      data-slot="form-skeleton"
      className={cn("w-full max-w-lg space-y-6", className)}
      {...props}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          {/* Label */}
          <Skeleton className="h-4 w-28 rounded" />
          {/* Input */}
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}

      {/* Submit button */}
      <Skeleton className="h-9 w-24 rounded-md" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ListSkeleton – stacked list items
// ---------------------------------------------------------------------------

function ListSkeleton({
  rows = 5,
  className,
  ...props
}: ViewSkeletonProps) {
  return (
    <div
      data-slot="list-skeleton"
      className={cn("w-full space-y-3", className)}
      {...props}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border px-4 py-3"
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5 rounded" />
            <Skeleton className="h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChartSkeleton – chart area placeholder
// ---------------------------------------------------------------------------

function ChartSkeleton({
  className,
  ...props
}: Omit<ViewSkeletonProps, "rows">) {
  return (
    <div
      data-slot="chart-skeleton"
      className={cn("w-full space-y-4", className)}
      {...props}
    >
      {/* Chart title */}
      <Skeleton className="h-5 w-40 rounded" />

      {/* Chart area with bar placeholders */}
      <div className="flex h-48 items-end gap-2 rounded-md border p-4">
        {(["h-2/5", "h-3/5", "h-1/3", "h-4/5", "h-1/2", "h-3/4", "h-2/5"] as const).map((heightClass, i) => (
          <Skeleton
            key={i}
            className={cn("flex-1 rounded-t", heightClass)}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ViewSkeleton – convenience wrapper that dispatches by variant
// ---------------------------------------------------------------------------

export type ViewSkeletonVariant = "grid" | "kanban" | "form" | "list" | "chart"

export interface ViewSkeletonDispatchProps extends ViewSkeletonProps {
  variant: ViewSkeletonVariant
  /** Number of columns (grid / kanban) */
  columns?: number
  /** Cards per column (kanban only) */
  cardsPerColumn?: number
}

function ViewSkeleton({ variant, ...props }: ViewSkeletonDispatchProps) {
  switch (variant) {
    case "grid":
      return <GridSkeleton {...props} />
    case "kanban":
      return <KanbanSkeleton {...props} />
    case "form":
      return <FormSkeleton {...props} />
    case "list":
      return <ListSkeleton {...props} />
    case "chart":
      return <ChartSkeleton {...props} />
  }
}

export {
  ViewSkeleton,
  GridSkeleton,
  KanbanSkeleton,
  FormSkeleton,
  ListSkeleton,
  ChartSkeleton,
}
