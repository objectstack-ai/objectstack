/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn } from "../lib/utils"

/**
 * `ShimmerSkeleton` — drop-in replacement for `Skeleton` with a Linear /
 * Notion-style shimmer effect instead of the default pulse.
 *
 * Why: the canonical `Skeleton` from `ui/skeleton.tsx` uses
 * `animate-pulse`, which fades opacity uniformly. That reads as "this
 * page is loading" but doesn't suggest direction or progress. A
 * left-to-right shimmer is the modern enterprise-app convention and
 * subjectively feels faster.
 *
 * Requires the `@keyframes shimmer` + `@utility animate-shimmer`
 * declarations in `@object-ui/app-shell/styles.css` (already imported
 * by every host app).
 *
 * Respects `prefers-reduced-motion` automatically: the shimmer is
 * applied via `motion-safe:`, so reduced-motion users see a static
 * muted block that still communicates "loading" via shape.
 *
 * @example
 * <ShimmerSkeleton className="h-4 w-32 rounded-md" />
 */
export type ShimmerSkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function ShimmerSkeleton({
  className,
  ...props
}: ShimmerSkeletonProps) {
  return (
    <div
      data-slot="shimmer-skeleton"
      className={cn(
        // Base block — same look as the canonical Skeleton when motion
        // is off so reduced-motion users get a stable muted placeholder.
        "rounded-md bg-muted",
        // Motion-on: stretch a 200%-wide gradient and slide it via the
        // shared `animate-shimmer` utility. The gradient uses the muted
        // token + a translucent foreground for the highlight, so it
        // adapts cleanly to light/dark themes.
        "motion-safe:bg-[linear-gradient(90deg,hsl(var(--muted))_0%,hsl(var(--muted-foreground)/0.12)_50%,hsl(var(--muted))_100%)]",
        "motion-safe:bg-[length:200%_100%] motion-safe:animate-shimmer",
        className
      )}
      {...props}
    />
  )
}
