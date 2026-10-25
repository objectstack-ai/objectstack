/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { cn } from "@object-ui/components"
import { Button } from "@object-ui/components"
import { X, Maximize2, Minimize2 } from "lucide-react"
import { useFloatingChatbot } from "./FloatingChatbotProvider"

export interface FloatingChatbotPanelProps {
  /** Panel title */
  title?: string
  /** Position of the panel (anchored to FAB corner) */
  position?: "bottom-right" | "bottom-left"
  /** Panel width in pixels (ignored in fullscreen) */
  width?: number
  /** Panel height in pixels (ignored in fullscreen) */
  height?: number
  /** Content to render inside the panel body */
  children: React.ReactNode
  /** Custom className for the panel container */
  className?: string
  /** Optional content rendered in the header, between the title and the action buttons (e.g. an agent picker) */
  headerExtra?: React.ReactNode
  /** Extra action buttons rendered to the left of the fullscreen / close controls. */
  headerActions?: React.ReactNode
}

const PANEL_WIDTH_CLASSES: Record<number, string> = {
  300: "sm:w-[300px]",
  320: "sm:w-[320px]",
  340: "sm:w-[340px]",
  360: "sm:w-[360px]",
  380: "sm:w-[380px]",
  400: "sm:w-[400px]",
  420: "sm:w-[420px]",
  440: "sm:w-[440px]",
  450: "sm:w-[450px]",
  460: "sm:w-[460px]",
  480: "sm:w-[480px]",
  500: "sm:w-[500px]",
  520: "sm:w-[520px]",
  560: "sm:w-[560px]",
  600: "sm:w-[600px]",
  640: "sm:w-[640px]",
  720: "sm:w-[720px]",
  800: "sm:w-[800px]",
}

const PANEL_HEIGHT_CLASSES: Record<number, string> = {
  360: "h-[min(360px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[360px]",
  400: "h-[min(400px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[400px]",
  420: "h-[min(420px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[420px]",
  440: "h-[min(440px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[440px]",
  480: "h-[min(480px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[480px]",
  500: "h-[min(500px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[500px]",
  520: "h-[min(520px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[520px]",
  560: "h-[min(560px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[560px]",
  600: "h-[min(600px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[600px]",
  640: "h-[min(640px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[640px]",
  720: "h-[min(720px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[720px]",
  800: "h-[min(800px,calc(100svh_-_6rem_-_env(safe-area-inset-bottom)))] sm:h-[800px]",
}

function closestSize(size: number, sizes: number[]) {
  return sizes.reduce((best, next) =>
    Math.abs(next - size) < Math.abs(best - size) ? next : best
  )
}

function getPanelWidthClass(width: number) {
  return PANEL_WIDTH_CLASSES[width] ?? PANEL_WIDTH_CLASSES[closestSize(width, Object.keys(PANEL_WIDTH_CLASSES).map(Number))]
}

function getPanelHeightClass(height: number) {
  return PANEL_HEIGHT_CLASSES[height] ?? PANEL_HEIGHT_CLASSES[closestSize(height, Object.keys(PANEL_HEIGHT_CLASSES).map(Number))]
}

/**
 * Floating panel overlay for the chatbot.
 * Renders above all content, anchored to the configured position.
 * Supports fullscreen toggle and close.
 */
export function FloatingChatbotPanel({
  title = "Chat",
  position = "bottom-right",
  width = 400,
  height = 520,
  children,
  className,
  headerExtra,
  headerActions,
}: FloatingChatbotPanelProps) {
  const { isOpen, isFullscreen, close, toggleFullscreen } = useFloatingChatbot()

  if (!isOpen) return null

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-xl transition-all",
        isFullscreen
          ? "inset-0 h-svh w-screen rounded-none"
          : position === "bottom-right"
            ? cn(
                "left-3 right-3 bottom-[calc(4rem_+_env(safe-area-inset-bottom))] rounded-lg",
                "sm:left-auto sm:right-6 sm:bottom-20 sm:max-h-[calc(100vh_-_100px)]",
                getPanelWidthClass(width),
                getPanelHeightClass(height)
              )
            : cn(
                "left-3 right-3 bottom-[calc(4rem_+_env(safe-area-inset-bottom))] rounded-lg",
                "sm:right-auto sm:left-6 sm:bottom-20 sm:max-h-[calc(100vh_-_100px)]",
                getPanelWidthClass(width),
                getPanelHeightClass(height)
              ),
        className
      )}
      role="dialog"
      aria-label={title}
      data-testid="floating-chatbot-panel"
    >
      {/* Header */}
      <div className="flex min-h-10 items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {headerExtra ? (
          <div className="mr-1 flex min-w-0 items-center justify-end" data-testid="floating-chatbot-header-extra">
            {headerExtra}
          </div>
        ) : null}
        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            data-testid="floating-chatbot-fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={close}
            aria-label="Close chat"
            data-testid="floating-chatbot-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
