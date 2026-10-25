/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { cn } from "../lib/utils"

export interface ConfigRowProps {
  /** Left-side label text */
  label: string
  /** Right-side display value (used when children are not provided) */
  value?: string
  /** Makes row clickable with hover effect */
  onClick?: () => void
  /** Custom content replacing value */
  children?: React.ReactNode
  /** Additional CSS class name */
  className?: string
}

/**
 * A single labeled row in a configuration panel.
 *
 * Renders as a `<button>` when `onClick` is provided, otherwise as a `<div>`.
 * Shows label on the left and either custom children or a text value on the right.
 */
function ConfigRow({ label, value, onClick, children, className }: ConfigRowProps) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      className={cn(
        'flex items-center justify-between py-1.5 min-h-[32px] w-full text-left',
        onClick && 'cursor-pointer hover:bg-accent/50 rounded-sm -mx-1 px-1',
        className,
      )}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <span className="text-xs text-muted-foreground shrink-0 max-w-[45%] truncate" title={label}>{label}</span>
      {children || (
        <span className="text-xs text-foreground truncate ml-4 text-right max-w-[55%]" title={value}>{value}</span>
      )}
    </Wrapper>
  )
}

export { ConfigRow }
