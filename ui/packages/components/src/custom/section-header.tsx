/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ChevronDown, ChevronRight } from "lucide-react"

import { cn } from "../lib/utils"

export interface SectionHeaderProps {
  /** Section heading text */
  title: string
  /** Icon rendered before the title */
  icon?: React.ReactNode
  /** Enable collapse/expand toggle */
  collapsible?: boolean
  /** Current collapsed state */
  collapsed?: boolean
  /** Callback when toggling collapse/expand */
  onToggle?: () => void
  /** Data-testid attribute */
  testId?: string
  /** Additional CSS class name */
  className?: string
}

/**
 * Section heading with optional collapse/expand support.
 *
 * Renders as a `<button>` when collapsible, with a chevron icon
 * indicating the expand/collapse state. Uses `aria-expanded` for accessibility.
 */
function SectionHeader({ title, icon, collapsible, collapsed, onToggle, testId, className }: SectionHeaderProps) {
  const titleContent = (
    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
      {icon && <span className="text-muted-foreground shrink-0" aria-hidden="true">{icon}</span>}
      {title}
    </h3>
  )
  if (collapsible) {
    return (
      <button
        data-testid={testId}
        className={cn("flex items-center justify-between pt-4 pb-1.5 first:pt-0 w-full text-left", className)}
        onClick={onToggle}
        type="button"
        aria-expanded={!collapsed}
      >
        {titleContent}
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    )
  }
  return (
    <div className={cn("pt-4 pb-1.5 first:pt-0", className)} data-testid={testId}>
      {titleContent}
    </div>
  )
}

export { SectionHeader }
