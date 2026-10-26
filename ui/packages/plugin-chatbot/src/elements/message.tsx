/*!
 * Sourced from vercel/ai-elements (https://elements.ai-sdk.dev) — MIT.
 * Vendored via the shadcn-style copy-into-source model. Do NOT edit business
 * logic directly; create a wrapper next to the consumer instead. To re-sync,
 * fetch the latest from https://registry.ai-sdk.dev/<name>.json.
 */
"use client";

import { Button } from "@object-ui/components";
import {
  ButtonGroup,
  ButtonGroupText,
} from "./ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@object-ui/components";
import { cn } from "@object-ui/components";
import type { FileUIPart, UIMessage } from "ai";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSafeTranslate } from "@object-ui/i18n";
import { Streamdown } from "streamdown";
import { RecordLinkContext, withRecordLinks } from "../recordLink";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

type MessageBranchContextType = {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
};

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = (newBranch: number) => {
    setCurrentBranch(newBranch);
    onBranchChange?.(newBranch);
  };

  const goToPrevious = () => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  };

  const goToNext = () => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  };

  const contextValue: MessageBranchContextType = {
    currentBranch,
    totalBranches: branches.length,
    goToPrevious,
    goToNext,
    branches,
    setBranches,
  };

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = Array.isArray(children) ? children : [children];

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const MessageBranchSelector = ({
  className,
  from,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className="[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md"
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  className,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

/*
 * objectui#13032 — an assistant answer read in a narrow chat panel (the
 * console's ~420px assistant rail) rather than on an article page.
 *
 * - Headings render at chat size: h1–h3 are 15–16px and differ by weight and
 *   spacing only, never by the article-page 20–30px scale.
 * - Tables: 13px text, the first column frozen while the rest scrolls, and the
 *   table's own expand control (streamdown's fullscreen button) turned into a
 *   labelled, clearly visible button whenever the columns overflow the width.
 * - A finished answer taller than ANSWER_FOLD_VIEWPORTS heights of its scroll
 *   container is folded, with a control to show the full text and to fold it
 *   again. A streaming answer (`isAnimating`) is never folded.
 */

/** An answer taller than this many heights of its scroll container folds. */
const ANSWER_FOLD_VIEWPORTS = 2;

/** `data-chat-table-expand` value the expand button carries while its table overflows. */
const TABLE_EXPAND_OVERFLOW = "overflow";

const ANSWER_COMPONENTS: NonNullable<MessageResponseProps["components"]> = {
  h1: ({ className, node: _node, ...props }) => (
    <h1
      className={cn("mt-5 mb-2 font-bold text-base leading-snug", className)}
      data-streamdown="heading-1"
      {...props}
    />
  ),
  h2: ({ className, node: _node, ...props }) => (
    <h2
      className={cn("mt-4 mb-2 font-bold text-[15px] leading-snug", className)}
      data-streamdown="heading-2"
      {...props}
    />
  ),
  h3: ({ className, node: _node, ...props }) => (
    <h3
      className={cn("mt-3 mb-1.5 font-semibold text-[15px] leading-snug", className)}
      data-streamdown="heading-3"
      {...props}
    />
  ),
  th: ({ className, node: _node, ...props }) => (
    <th
      className={cn(
        "whitespace-nowrap bg-muted px-3 py-1.5 text-left font-semibold text-[13px]",
        "first:sticky first:left-0 first:z-[1] first:border-r first:border-border",
        className
      )}
      data-streamdown="table-header-cell"
      {...props}
    />
  ),
  td: ({ className, node: _node, ...props }) => (
    <td
      className={cn(
        "px-3 py-1.5 text-[13px]",
        "first:sticky first:left-0 first:z-[1] first:border-r first:border-border first:bg-background",
        className
      )}
      data-streamdown="table-cell"
      {...props}
    />
  ),
};

/** The nearest ancestor that scrolls vertically — the conversation's viewport. */
const findScrollParent = (element: HTMLElement): HTMLElement | null => {
  let node = element.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

const MessageResponseImpl = ({
  className,
  components,
  translations,
  isAnimating,
  linkSafety,
  ...props
}: MessageResponseProps) => {
  const tt = useSafeTranslate();
  // objectui#13037 — a record link (`/record/OBJECT/ID`) opens the record in
  // the console through the host's opener; every other link keeps the
  // caller's (by default streamdown's) link safety. See `../recordLink`.
  const openRecordLink = useContext(RecordLinkContext);
  const answerLinkSafety = useMemo(
    () => withRecordLinks(linkSafety, openRecordLink),
    [linkSafety, openRecordLink]
  );
  const showFullLabel = tt("chatbot.answer.showFull", "Show full answer");
  const collapseLabel = tt("chatbot.answer.collapse", "Collapse");
  const expandTableLabel =
    translations?.viewFullscreen ?? tt("chatbot.answer.expandTable", "Expand");
  const exitTableLabel =
    translations?.exitFullscreen ??
    tt("chatbot.answer.exitExpandedTable", "Close");

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tooTall, setTooTall] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const streaming = Boolean(isAnimating);
  const folded = tooTall && !expanded && !streaming;

  useEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) {
      return;
    }
    const measure = () => {
      // Tables: mark the expand control of every table whose columns overflow.
      for (const wrapper of root.querySelectorAll<HTMLElement>(
        '[data-streamdown="table-wrapper"]'
      )) {
        const scroller = wrapper.querySelector<HTMLElement>(
          '[data-streamdown="table"]'
        )?.parentElement;
        const expand = Array.from(wrapper.querySelectorAll("button")).find(
          (button) => button.title === expandTableLabel
        );
        if (!scroller || !expand) {
          continue;
        }
        expand.setAttribute(
          "data-chat-table-expand",
          scroller.scrollWidth > scroller.clientWidth ? TABLE_EXPAND_OVERFLOW : "fit"
        );
      }
      // Fold: decided only once the answer has finished streaming.
      if (streaming) {
        return;
      }
      const viewport =
        findScrollParent(root)?.clientHeight || window.innerHeight;
      setTooTall(
        viewport > 0 && body.scrollHeight > ANSWER_FOLD_VIEWPORTS * viewport
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [props.children, streaming, expandTableLabel]);

  const toggle = () => {
    setExpanded((value) => !value);
    if (expanded) {
      rootRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2",
        "[&_[data-chat-table-expand=overflow]]:inline-flex [&_[data-chat-table-expand=overflow]]:items-center [&_[data-chat-table-expand=overflow]]:gap-1 [&_[data-chat-table-expand=overflow]]:rounded-md [&_[data-chat-table-expand=overflow]]:border [&_[data-chat-table-expand=overflow]]:border-border [&_[data-chat-table-expand=overflow]]:bg-background [&_[data-chat-table-expand=overflow]]:px-2 [&_[data-chat-table-expand=overflow]]:py-0.5 [&_[data-chat-table-expand=overflow]]:font-medium [&_[data-chat-table-expand=overflow]]:text-foreground [&_[data-chat-table-expand=overflow]]:text-xs [&_[data-chat-table-expand=overflow]]:after:content-[attr(title)]"
      )}
      data-chat-answer=""
      data-folded={folded ? "true" : undefined}
      ref={rootRef}
    >
      <div
        className={cn(
          "min-w-0",
          folded &&
            "max-h-[28rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
        )}
        data-chat-answer-body=""
        ref={bodyRef}
      >
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            className
          )}
          components={{ ...ANSWER_COMPONENTS, ...components }}
          isAnimating={isAnimating}
          linkSafety={answerLinkSafety}
          translations={{
            ...translations,
            viewFullscreen: expandTableLabel,
            exitFullscreen: exitTableLabel,
          }}
          {...props}
        />
      </div>
      {tooTall && !streaming ? (
        <Button
          aria-expanded={!folded}
          className="self-start"
          data-chat-answer-toggle=""
          onClick={toggle}
          size="sm"
          type="button"
          variant="outline"
        >
          {folded ? showFullLabel : collapseLabel}
        </Button>
      ) : null}
    </div>
  );
};

export const MessageResponse = memo(
  MessageResponseImpl,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isAnimating === nextProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart;
  className?: string;
  onRemove?: () => void;
};

export function MessageAttachment({
  data,
  className,
  onRemove,
  ...props
}: MessageAttachmentProps) {
  const filename = data.filename || "";
  const mediaType =
    data.mediaType?.startsWith("image/") && data.url ? "image" : "file";
  const isImage = mediaType === "image";
  const attachmentLabel = filename || (isImage ? "Image" : "Attachment");

  return (
    <div
      className={cn(
        "group relative size-24 overflow-hidden rounded-lg",
        className
      )}
      {...props}
    >
      {isImage ? (
        <>
          <img
            alt={filename || "attachment"}
            className="size-full object-cover"
            height={100}
            src={data.url}
            width={100}
          />
          {onRemove && (
            <Button
              aria-label="Remove attachment"
              className="absolute top-2 right-2 size-6 rounded-full bg-background/80 p-0 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 [&>svg]:size-3"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              type="button"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">Remove</span>
            </Button>
          )}
        </>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex size-full shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PaperclipIcon className="size-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{attachmentLabel}</p>
            </TooltipContent>
          </Tooltip>
          {onRemove && (
            <Button
              aria-label="Remove attachment"
              className="size-6 shrink-0 rounded-full p-0 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 [&>svg]:size-3"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              type="button"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">Remove</span>
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export type MessageAttachmentsProps = ComponentProps<"div">;

export function MessageAttachments({
  children,
  className,
  ...props
}: MessageAttachmentsProps) {
  if (!children) {
    return null;
  }

  return (
    <div
      className={cn(
        "ml-auto flex w-fit flex-wrap items-start gap-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

