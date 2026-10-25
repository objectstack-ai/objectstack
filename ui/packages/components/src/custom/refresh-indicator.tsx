/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn } from "../lib/utils"

// Single shared keyframe injection — guarded so multiple mounts don't
// pollute the document with duplicate <style> tags.
let keyframeInjected = false
function ensureKeyframe() {
  if (keyframeInjected) return
  if (typeof document === "undefined") return
  const id = "objui-refresh-indicator-kf"
  if (document.getElementById(id)) {
    keyframeInjected = true
    return
  }
  const style = document.createElement("style")
  style.id = id
  style.textContent = `
@keyframes objui-refresh-bar {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
`
  document.head.appendChild(style)
  keyframeInjected = true
}

export interface RefreshIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the indicator is active. When false, nothing is rendered. */
  active: boolean
  /**
   * Accessible name of the progress bar, rendered as its `aria-label`.
   * Required, with no default: the caller passes a string from its own
   * translation layer, so the name a screen reader announces is in the active
   * locale. An English default here reached every non-English screen-reader
   * user through the callers that passed nothing (objectui#10580).
   */
  ariaLabel: string
}

/**
 * Thin, absolutely-positioned indeterminate progress bar that animates across
 * the top edge of its nearest positioned ancestor. Use it to signal that a
 * re-fetch is in flight while existing data stays visible underneath — covers
 * the gap between "loading skeleton (no data yet)" and "data swapped in".
 *
 * The parent **must** be `position: relative` (or absolute/fixed) for the
 * indicator to anchor to its top edge.
 */
export const RefreshIndicator: React.FC<RefreshIndicatorProps> = ({
  active,
  ariaLabel,
  className,
  ...props
}) => {
  React.useEffect(() => {
    if (active) ensureKeyframe()
  }, [active])

  if (!active) return null

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden",
        className,
      )}
      role="progressbar"
      aria-busy="true"
      aria-label={ariaLabel}
      data-testid="refresh-indicator"
      {...props}
    >
      <div
        className="h-full w-1/4 rounded-full bg-primary/70"
        style={{ animation: "objui-refresh-bar 1.1s ease-in-out infinite" }}
      />
    </div>
  )
}

RefreshIndicator.displayName = "RefreshIndicator"
