/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import * as ReactDOM from "react-dom"
import { cn } from "@object-ui/components"
import type { FloatingChatbotConfig } from "@object-ui/types"
import { FloatingChatbotProvider } from "./FloatingChatbotProvider"
import { FloatingChatbotTrigger } from "./FloatingChatbotTrigger"
import { FloatingChatbotPanel } from "./FloatingChatbotPanel"
import { ChatbotEnhanced, type ChatbotEnhancedProps } from "./ChatbotEnhanced"

export interface FloatingChatbotProps extends ChatbotEnhancedProps {
  /** Floating configuration */
  floatingConfig?: FloatingChatbotConfig
  /** Optional content rendered in the panel header (e.g. an agent picker) */
  headerExtra?: React.ReactNode
  /** Extra action buttons rendered to the left of the panel's fullscreen / close controls. */
  headerActions?: React.ReactNode
}

/**
 * Floating Chatbot — Airtable-style FAB widget.
 *
 * Wraps `ChatbotEnhanced` in a floating panel that can be toggled
 * via a fixed FAB trigger button. Uses React portal to avoid
 * DOM/z-index conflicts.
 */
export function FloatingChatbot({
  floatingConfig,
  headerExtra,
  headerActions,
  ...chatbotProps
}: FloatingChatbotProps) {
  const {
    position = "bottom-right",
    defaultOpen = false,
    panelWidth = 400,
    panelHeight = 520,
    title = "Chat",
    triggerSize = 56,
  } = floatingConfig ?? {}

  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    // Create a portal root so the floating UI sits outside the normal DOM tree
    let container = document.getElementById("floating-chatbot-portal")
    if (!container) {
      container = document.createElement("div")
      container.id = "floating-chatbot-portal"
      document.body.appendChild(container)
    }
    setPortalContainer(container)

    return () => {
      // Only remove if we created it and it's still in the DOM
      if (container && container.parentNode && !container.hasChildNodes()) {
        container.parentNode.removeChild(container)
      }
    }
  }, [])

  const content = (
    <FloatingChatbotProvider defaultOpen={defaultOpen}>
      <FloatingChatbotTrigger
        position={position}
        size={triggerSize}
      />
      <FloatingChatbotPanel
        title={title}
        position={position}
        width={panelWidth}
        height={panelHeight}
        headerExtra={headerExtra}
        headerActions={headerActions}
      >
        <ChatbotEnhanced
          {...chatbotProps}
          // FORCED, and the only thing this element keeps by force (objectui#8078).
          // Load-bearing: `<ChatbotEnhanced>` defaults `maxHeight` to `'500px'`,
          // which would cap the conversation well inside a panel whose height is
          // `floatingConfig.panelHeight` (up to 800px, and the whole viewport in
          // fullscreen). Nothing authored is dropped by writing it here:
          // `ChatbotFloatingSchema` deliberately does not declare `maxHeight` — its
          // docblock says the key is "NOT declared, on purpose" for exactly this
          // reason — and the `chatbot-floating` registration forwards no such prop.
          // Its twin below WAS dropping an authored value; this one has none to drop.
          maxHeight="100%"
          // MERGED, author last (objectui#8078). These three are the panel's DEFAULT
          // fit, not its property: the surrounding `<FloatingChatbotPanel>` already
          // draws the border and the radius, so the inner surface starts borderless,
          // square and filling its container. `cn` is `twMerge(clsx(...))`, so the
          // LAST conflicting utility wins — an author who declares `rounded-xl` or
          // `border-2` on a `chatbot-floating` node gets it, which is the escape hatch
          // AGENTS.md #3 requires every widget to expose, while an author who declares
          // nothing about size still gets `h-full`. This was a bare literal written
          // after `{...chatbotProps}`, which REPLACED an authored `className` outright.
          className={cn("h-full border-0 rounded-none", chatbotProps.className)}
        />
      </FloatingChatbotPanel>
    </FloatingChatbotProvider>
  )

  // Use portal rendering when in browser, fallback to inline for SSR / tests
  if (portalContainer) {
    return ReactDOM.createPortal(content, portalContainer)
  }

  return content
}
