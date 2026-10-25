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
import { Bot, X } from "lucide-react"
import { useFloatingChatbot } from "./FloatingChatbotProvider"
import { useObjectTranslation } from "@object-ui/react"

function useChatbotLabel() {
  // useObjectTranslation is provider-safe (never throws); no try/catch, which
  // would wrap the hook call and violate rules-of-hooks. The `fallback` still
  // applies below when the key is missing/untranslated.
  const { t } = useObjectTranslation();
  return (key: 'openChat' | 'closeChat', fallback: string) => {
    const v = t(`common.${key}`);
    return !v || v === `common.${key}` ? fallback : v;
  };
}

export interface FloatingChatbotTriggerProps {
  /** Position of the FAB */
  position?: "bottom-right" | "bottom-left"
  /** Size of the trigger button in pixels */
  size?: number
  /** Custom className */
  className?: string
}

const TRIGGER_SIZE_CLASSES: Record<number, string> = {
  32: "size-8",
  36: "size-9",
  40: "size-10",
  44: "size-11",
  48: "size-12",
  52: "size-[52px]",
  56: "size-14",
  60: "size-[60px]",
  64: "size-16",
  72: "size-[72px]",
  80: "size-20",
}

function closestSize(size: number, sizes: number[]) {
  return sizes.reduce((best, next) =>
    Math.abs(next - size) < Math.abs(best - size) ? next : best
  )
}

function getTriggerSizeClass(size: number) {
  return TRIGGER_SIZE_CLASSES[size] ?? TRIGGER_SIZE_CLASSES[closestSize(size, Object.keys(TRIGGER_SIZE_CLASSES).map(Number))]
}

/**
 * Floating Action Button (FAB) trigger for the chatbot.
 * Renders a circular button fixed to the viewport corner.
 */
export function FloatingChatbotTrigger({
  position = "bottom-right",
  size = 56,
  className,
}: FloatingChatbotTriggerProps) {
  const { isOpen, toggle } = useFloatingChatbot()
  const label = useChatbotLabel()

  return (
    <Button
      onClick={toggle}
      className={cn(
        "fixed z-50 rounded-full shadow-lg transition-transform hover:scale-105",
        getTriggerSizeClass(size),
        isOpen && "hidden",
        // Lift the FAB above the mobile bottom navigation bar (~56px) so it
        // doesn't sit on top of the nav icons. On desktop we use the
        // standard 24px gap from the bottom edge.
        position === "bottom-right" ? "right-6 bottom-20 sm:bottom-6" : "left-6 bottom-20 sm:bottom-6",
        className
      )}
      size="icon"
      aria-label={isOpen ? label('closeChat', 'Close chat') : label('openChat', 'Open chat')}
      data-testid="floating-chatbot-trigger"
    >
      {isOpen ? (
        <X className="h-6 w-6" />
      ) : (
        <Bot className="h-6 w-6" />
      )}
    </Button>
  )
}
