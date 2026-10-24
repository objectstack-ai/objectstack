/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"

export interface FloatingChatbotState {
  /** Whether the floating panel is currently open */
  isOpen: boolean
  /** Whether the panel is in fullscreen mode */
  isFullscreen: boolean
}

export interface FloatingChatbotActions {
  /** Open the floating panel */
  open: () => void
  /** Close the floating panel */
  close: () => void
  /** Toggle the floating panel open/closed */
  toggle: () => void
  /** Toggle fullscreen mode */
  toggleFullscreen: () => void
}

export type FloatingChatbotContextValue = FloatingChatbotState & FloatingChatbotActions

const FloatingChatbotContext = React.createContext<FloatingChatbotContextValue | null>(null)

export interface FloatingChatbotProviderProps {
  /** Whether the panel is open by default */
  defaultOpen?: boolean
  children: React.ReactNode
}

export function FloatingChatbotProvider({
  defaultOpen = false,
  children,
}: FloatingChatbotProviderProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const value = React.useMemo<FloatingChatbotContextValue>(
    () => ({
      isOpen,
      isFullscreen,
      open: () => setIsOpen(true),
      close: () => {
        setIsOpen(false)
        setIsFullscreen(false)
      },
      toggle: () => setIsOpen((prev) => !prev),
      toggleFullscreen: () => setIsFullscreen((prev) => !prev),
    }),
    [isOpen, isFullscreen]
  )

  return (
    <FloatingChatbotContext.Provider value={value}>
      {children}
    </FloatingChatbotContext.Provider>
  )
}

/**
 * Hook to access the floating chatbot state and actions.
 * Must be used within a `FloatingChatbotProvider`.
 */
export function useFloatingChatbot(): FloatingChatbotContextValue {
  const context = React.useContext(FloatingChatbotContext)
  if (!context) {
    throw new Error(
      "useFloatingChatbot must be used within a <FloatingChatbotProvider>"
    )
  }
  return context
}
