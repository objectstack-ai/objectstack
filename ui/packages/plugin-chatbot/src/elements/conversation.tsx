/*!
 * Sourced from vercel/ai-elements (https://elements.ai-sdk.dev) — MIT.
 * Vendored via the shadcn-style copy-into-source model. Do NOT edit business
 * logic directly; create a wrapper next to the consumer instead. To re-sync,
 * fetch the latest from https://registry.ai-sdk.dev/<name>.json.
 */
"use client";

import { Button } from "@object-ui/components";
import { cn } from "@object-ui/components";
import { useObjectTranslation } from "@object-ui/i18n";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

// objectui#13032 — the conversation is a column: the scrolling message list
// on top and, below it, the row the scroll-to-bottom button sits in. The
// button is laid out OUTSIDE the list instead of floating over it, so at no
// scroll position does it cover a line of text, a table cell or a heading.
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex flex-1 flex-col overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    scrollClassName={cn("min-h-0 flex-1", scrollClassName)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { t } = useObjectTranslation();
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <div
        className="flex shrink-0 justify-center py-2"
        data-conversation-scroll-row=""
      >
        <Button
          className={cn("rounded-full", className)}
          onClick={handleScrollToBottom}
          size="icon"
          type="button"
          variant="outline"
          // Before the spread, so a caller's own name still wins.
          aria-label={t("chatbot.scrollToBottom")}
          {...props}
        >
          <ArrowDownIcon className="size-4" />
        </Button>
      </div>
    )
  );
};

