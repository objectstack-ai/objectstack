/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⚠️ NOT a synced Shadcn file, despite living in `ui/` (AGENTS.md #7).
 *
 * `shadcn-components.json` lists `resizable` under `customComponents`, so
 * `pnpm shadcn:update`/`update-all` deliberately skip it. Re-syncing would
 * **break the build**: upstream still ships the react-resizable-panels **v3**
 * file, whose `import * as ResizablePrimitive` reaches for `PanelGroup` and
 * `PanelResizeHandle` — two names v4 (the installed major) does not export at
 * all. It renamed them to `Group` / `Panel` / `Separator`, which is what the
 * imports below use. That break already happened once, in `00b61d6d8`
 * ("upgrade shadcn components and fix build issues").
 *
 * The same rename reached the DOM: v4 emits **no** `data-panel-group-direction`
 * anywhere, so every `data-[panel-group-direction=vertical]:` utility upstream
 * still carries is a dead selector. What v4 does emit on the separator is
 * `aria-orientation`, so the stacked-group styles below key on that instead.
 *
 * ⚠️ That attribute is the **inverse** of the group's `orientation`, and
 * deliberately so: `aria-orientation` describes the separator, not the group.
 * A stacked group's divider is a *horizontal* line.
 *
 *   orientation="horizontal" → panels side-by-side → separator aria-orientation="vertical"   (base classes)
 *   orientation="vertical"   → panels stacked      → separator aria-orientation="horizontal" (the variants)
 *
 * Pinned by `src/__tests__/resizable-orientation.test.tsx`. Restore this file
 * to `components` in the manifest only once upstream regenerates for v4.
 */

"use client"

import { GripVertical } from "lucide-react"
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "../lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof Group>) => (
  <Group
    className={cn(
      // No stacked variant needed: v4 writes `flex-direction: row | column`
      // as an inline style off `orientation`, which outranks any class.
      "flex h-full w-full",
      className
    )}
    {...props}
  />
)

const ResizablePanel = Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) => (
  <Separator
    className={cn(
      // Base — the side-by-side case (separator aria-orientation="vertical"):
      // a 1px-wide rule with a 4px-wide drag strip centred across it.
      "relative flex w-px items-center justify-center bg-border",
      "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      // Stacked — the rule itself: a full-width hairline, not a 1px sliver.
      "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
      // Stacked — the drag strip runs ALONG the rule rather than across it.
      "aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full",
      "aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0",
      // Stacked — the grip reads as a drag affordance only when it crosses the rule.
      "[&[aria-orientation=horizontal]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
