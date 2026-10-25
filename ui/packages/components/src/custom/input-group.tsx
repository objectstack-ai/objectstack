/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn } from "../lib/utils"

export interface InputGroupProps extends React.ComponentProps<"div"> {
  startContent?: React.ReactNode
  endContent?: React.ReactNode
}

const InputGroup = React.forwardRef<HTMLDivElement, InputGroupProps>(
  ({ className, startContent, endContent, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full items-center rounded-md border border-input bg-transparent ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          "has-[[data-invalid]]:border-destructive",
          className
        )}
        {...props}
      >
        {startContent && (
          <div className="flex items-center px-3 text-muted-foreground bg-muted/50 border-r h-full self-stretch rounded-l-md">
            {startContent}
          </div>
        )}
        
        {/* We need to process children to remove their default borders/rings if they are Inputs */}
        <div className="flex-1 relative [&_input]:border-0 [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_input]:bg-transparent">
          {children}
        </div>

        {endContent && (
          <div className="flex items-center px-3 text-muted-foreground bg-muted/50 border-l h-full self-stretch rounded-r-md">
            {endContent}
          </div>
        )}
      </div>
    )
  }
)
InputGroup.displayName = "InputGroup"

export { InputGroup }
