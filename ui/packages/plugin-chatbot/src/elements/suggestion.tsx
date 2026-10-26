/*!
 * Sourced from vercel/ai-elements (https://elements.ai-sdk.dev) — MIT.
 * Vendored via the shadcn-style copy-into-source model. Do NOT edit business
 * logic directly; create a wrapper next to the consumer instead. To re-sync,
 * fetch the latest from https://registry.ai-sdk.dev/<name>.json.
 */
"use client";

import { Button } from "@object-ui/components";
import {
  ScrollArea,
  ScrollBar,
} from "@object-ui/components";
import { cn } from "@object-ui/components";
import type { ComponentProps } from "react";

export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
    <div className={cn("flex w-max flex-nowrap items-center gap-2", className)}>
      {children}
    </div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = () => {
    onClick?.(suggestion);
  };

  return (
    <Button
      className={cn("cursor-pointer rounded-full px-4", className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};

