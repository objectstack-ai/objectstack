/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3a — the ChatDock: the console AI chat rendered as a right-docked,
 * collapsible, resizable rail (the VS Code / Cursor idiom) that REFLOWS the main
 * content beside it (via {@link AppShell}'s `rightRail`), rather than overlaying
 * it like the FAB. Additive and DEFAULT-OFF (`features.chatDock`): until an
 * operator opts in, none of this renders and the FAB stays the canonical entry.
 *
 * It reuses the shared {@link ChatPane} engine over the P1 `(user, app, product)`
 * conversation, so the dock is a VIEW, not a new conversation. (P3c also reused the panel
 * under Studio; objectui#12725 moved the Studio copilot into that surface's own
 * right slot, `StudioRightSlot`, so the console is this panel's one host.)
 *
 * objectstack#34608 (ADR-0057 as amended) — the drawer is the console's ONLY
 * chat container. The top-bar robot opens and closes it; there is no floating
 * button and no full-page chat route. Expanding fills the window IN PLACE (the
 * page stays mounted under it and the address does not change) and the same
 * button restores the rail; the conversation history sits beside the chat in
 * the full window and behind a History button in the rail.
 *
 * objectstack#34610 — there is no Live Canvas pane any more (the build's app
 * shows in the main area beside the drawer), so P3c's auto-maximize latch
 * (`maximize` / `restore`, the rail widened while the canvas was open) is gone.
 */
import * as React from 'react';
import {
  cn,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import { History, Maximize2, MessagesSquare, Minimize2, PanelRightClose, X } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveApiBase } from '../console/ai/resolveApiBase.js';
import { AiUsageIndicator } from './AiUsageIndicator.js';
import { usePlanApprovalPending } from '../assistant/assistantBus.js';
import type { ChatSurfaceContext } from './chatSurfaceContext.js';
import {
  readStoredDockFullWindow,
  writeStoredDockFullWindow,
  type ChatDockHandoff,
  type ChatDockTarget,
} from './chatDockTarget.js';
import {
  clampDockWidth,
  readStoredDockExpanded,
  writeStoredDockExpanded,
  DOCK_DEFAULT_WIDTH,
  DOCK_WIDTH_STORAGE_KEY,
} from './chatDockState.js';

function readStoredWidth(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DOCK_DEFAULT_WIDTH;
  } catch {
    return DOCK_DEFAULT_WIDTH;
  }
}

export interface ChatDockOptions {
  /**
   * Mount expanded when no stored preference exists. The console rail keeps
   * P3a's default-collapsed posture.
   */
  defaultExpanded?: boolean;
  /**
   * sessionStorage key the expanded/collapsed state round-trips through (see
   * {@link DOCK_EXPANDED_STORAGE_KEY}). Omitted → in-memory only, so each mount
   * starts from `defaultExpanded`. The console dock passes its own key; the
   * Studio right slot keeps its shown state under a different one, so the two
   * never share one collapse (#2477 item 2).
   */
  persistExpandedKey?: string;
  /**
   * localStorage key the rail WIDTH round-trips through. Defaults to the shared
   * console key. (The Studio dock passed its own, issue #2477 item 6, until
   * objectui#12725 gave Studio a fixed-width right slot.)
   */
  persistWidthKey?: string;
  /**
   * objectstack#34608 — round-trip the full-window flag through sessionStorage
   * (`DOCK_FULL_WINDOW_STORAGE_KEY`), so an old full-page link the console
   * routes into the drawer opens it filling the window. The console drawer
   * sets it; off, the flag lives in memory.
   */
  persistFullWindow?: boolean;
}

export interface ChatDockState {
  expanded: boolean;
  width: number;
  dragging: boolean;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
  /**
   * objectstack#34608 — true while the drawer fills the window in place. It
   * covers the page, which stays mounted under it.
   */
  fullWindow: boolean;
  /** Fill the window, or go back to the rail. Opening is implied when filling. */
  setFullWindow: (fullWindow: boolean) => void;
  /** Pointer-down on the rail's left-edge resize handle. */
  onResizePointerDown: (e: React.PointerEvent) => void;
}

/**
 * ChatDock open/collapsed + width state. Default COLLAPSED — the dock has zero
 * layout cost until invoked (preserving the FAB's virtue of not reflowing dense
 * data grids). Width persists to localStorage; the drag anchors the rail's LEFT
 * edge (dragging left widens it). All DOM reads happen in handlers, never render.
 *
 * P3c's `persistExpandedKey` (opt-in, the bare `useChatDockState()` call is
 * unchanged) round-trips expanded/collapsed through sessionStorage so the
 * console rail survives in-tab navigation and the `/ai` addresses can arm it
 * ({@link armChatDockExpanded}).
 */
export function useChatDockState(options?: ChatDockOptions): ChatDockState {
  const {
    defaultExpanded = false,
    persistExpandedKey,
    persistWidthKey = DOCK_WIDTH_STORAGE_KEY,
    persistFullWindow = false,
  } = options ?? {};
  const [expanded, setExpandedState] = React.useState<boolean>(() =>
    persistExpandedKey ? readStoredDockExpanded(persistExpandedKey, defaultExpanded) : defaultExpanded,
  );
  const [width, setWidth] = React.useState<number>(() => readStoredWidth(persistWidthKey));
  const [dragging, setDragging] = React.useState(false);
  const [fullWindow, setFullWindowState] = React.useState<boolean>(() =>
    persistFullWindow ? readStoredDockFullWindow() : false,
  );
  const setExpanded = React.useCallback(
    (update: (prev: boolean) => boolean) => {
      setExpandedState((prev) => {
        const next = update(prev);
        if (persistExpandedKey) writeStoredDockExpanded(persistExpandedKey, next);
        return next;
      });
    },
    [persistExpandedKey],
  );

  const onResizePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        // Rail is right-anchored: dragging the left edge LEFT (clientX shrinks)
        // widens it, so the delta is (start − current).
        const next = clampDockWidth(startWidth + (startX - ev.clientX), window.innerWidth);
        setWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        const final = clampDockWidth(startWidth + (startX - ev.clientX), window.innerWidth);
        try {
          window.localStorage.setItem(persistWidthKey, String(Math.round(final)));
        } catch {
          /* private mode — width just won't persist */
        }
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width],
  );

  const setFullWindow = React.useCallback(
    (next: boolean) => {
      setFullWindowState(next);
      if (persistFullWindow) writeStoredDockFullWindow(next);
      if (next) setExpanded(() => true);
    },
    [persistFullWindow, setExpanded],
  );
  // Closing the drawer also leaves the full window: the next open is the rail.
  const toggle = React.useCallback(() => {
    setExpanded((v) => !v);
    setFullWindowState(false);
    if (persistFullWindow) writeStoredDockFullWindow(false);
  }, [setExpanded, persistFullWindow]);
  const expand = React.useCallback(() => setExpanded(() => true), [setExpanded]);
  const collapse = React.useCallback(() => {
    setExpanded(() => false);
    setFullWindowState(false);
    if (persistFullWindow) writeStoredDockFullWindow(false);
  }, [setExpanded, persistFullWindow]);

  return {
    expanded,
    width,
    dragging,
    toggle,
    expand,
    collapse,
    fullWindow,
    setFullWindow,
    onResizePointerDown,
  };
}

/**
 * The dock's default chat body, {@link ChatDockConversation}, is loaded on
 * first render rather than imported: it mounts `ChatPane`, which reaches the
 * whole `@object-ui/plugin-chatbot` chat UI, and this module's chrome is in
 * every console page load through `ConsoleLayout` (objectui#13410). The chunk
 * is fetched when a dock body first renders, i.e. when the dock is opened.
 * Until it arrives the body is empty, as it is while the agent catalog loads.
 */
const ChatDockConversation = React.lazy(() =>
  import('./ChatDockConversation.js').then((m) => ({ default: m.ChatDockConversation })),
);

/** objectstack#34608 — what the drawer shows, and the handoff it seeds (see `chatDockTarget.ts`). */
export interface ChatDockThreadProps {
  /** Absent → the ambient thread (see {@link ChatDockConversation}). */
  target?: ChatDockTarget;
  /** Replaces the target in place: a history row, a minted fresh thread, a binding. */
  onTargetChange?: (target: ChatDockTarget | undefined) => void;
  /** A Builder handoff to seed once as the build thread's first message. */
  handoff?: ChatDockHandoff;
}

export interface ChatDockPanelProps extends ChatDockThreadProps {
  dock: ChatDockState;
  /** Signed-in user id for the default (console ask) body. Unused with `children`. */
  userId?: string;
  apiBase?: string;
  /** `app.defaultAgent` for the default body's resolver. Unused with `children`. */
  defaultAgent?: string;
  /**
   * objectui#10926 — the current app's owning package, for the default body's
   * build-thread binding (see {@link ChatDockConversation}). Unused with
   * `children`.
   */
  appPackageId?: string;
  /**
   * objectstack#30043 — the page in view, forwarded to the default body as
   * `context.surface` (see {@link ChatDockConversation}). Unused with
   * `children`.
   */
  surfaceContext?: ChatSurfaceContext;
  /** objectui#8219 — the chip's display label for `surfaceContext.artifact`. Unused with `children`. */
  surfaceArtifactLabel?: string;
  /** Header title override; default "Assistant". */
  title?: string;
  /**
   * Body override. Default mounts {@link ChatDockConversation} (the console's
   * drawer thread, with its history). A caller may pass its own conversation
   * instead — the empty-catalog gate then lives in the caller, because the
   * default body's self-gate is bypassed, and there is no History button.
   */
  children?: React.ReactNode;
}

/**
 * The expanded drawer — pass into {@link AppShell} `rightRail` so the rail
 * reflows the main content. Only render this when `dock.expanded` (the caller
 * decides), so a collapsed dock contributes no flex child.
 *
 * objectstack#34608 — `dock.fullWindow` turns the SAME element into a fixed
 * layer over the whole window: the chat is not remounted (a streaming answer
 * keeps streaming), the page underneath stays mounted, and the address does not
 * change. The header's expand button becomes the restore button.
 */
export function ChatDockPanel({
  dock,
  userId,
  apiBase: apiBaseProp,
  defaultAgent,
  appPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  title,
  target,
  onTargetChange,
  handoff,
  children,
}: ChatDockPanelProps) {
  const { t } = useObjectTranslation();
  const apiBase = React.useMemo(() => resolveApiBase(apiBaseProp), [apiBaseProp]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const full = dock.fullWindow;
  const expandLabel = full
    ? t('console.ai.dock.restore', { defaultValue: 'Restore side panel' })
    : t('console.ai.dock.expand', { defaultValue: 'Expand' });
  return (
    <aside
      data-testid="chat-dock-panel"
      data-full-window={full ? 'true' : undefined}
      style={full ? undefined : { width: dock.width }}
      className={cn(
        full
          ? 'fixed inset-0 z-40 flex flex-col bg-background'
          : 'relative hidden h-full shrink-0 flex-col border-l bg-background md:flex',
        // Ease width changes (issue #2477 item 4). NOT while dragging: the width must track the pointer 1:1, so the
        // transition is suppressed for the duration of a resize drag.
        !full && !dock.dragging && 'transition-[width] duration-200 ease-out',
      )}
    >
      {/* Left-edge resize handle — the rail only. */}
      {full ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('console.ai.dock.resize', { defaultValue: 'Resize chat' })}
          onPointerDown={dock.onResizePointerDown}
          className={cn(
            'absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40',
            dock.dragging && 'bg-primary/50',
          )}
        />
      )}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <MessagesSquare className="size-3.5" />
          {title ?? t('console.ai.dock.title', { defaultValue: 'AI Assistant' })}
        </span>
        <span className="flex items-center gap-0.5">
          {/* ADR-0057 #8 — proactive AI usage indicator (hides itself when the
              usage endpoint is absent / returns nothing to show). */}
          <AiUsageIndicator apiBase={apiBase} />
          {/* The rail keeps the history behind this button; the full window
              shows it beside the chat. */}
          {!full && !children ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground', historyOpen && 'bg-accent text-foreground')}
              onClick={() => setHistoryOpen((v) => !v)}
              aria-pressed={historyOpen}
              aria-label={historyOpen
                ? t('console.ai.dock.backToChat', { defaultValue: 'Back to chat' })
                : t('console.ai.dock.history', { defaultValue: 'History' })}
              data-testid="chat-dock-history-toggle"
            >
              <History className="h-3.5 w-3.5" />
              {t('console.ai.dock.history', { defaultValue: 'History' })}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setHistoryOpen(false);
              dock.setFullWindow(!full);
            }}
            aria-label={expandLabel}
            title={expandLabel}
            aria-pressed={full}
            data-testid="chat-dock-maximize"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={dock.collapse}
            aria-label={t('console.ai.dock.collapse', { defaultValue: 'Collapse chat' })}
            data-testid="chat-dock-collapse"
          >
            {full ? <X className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </span>
      </div>
      {/* flex-col so an injected ChatPane child (its root is `flex min-h-0
          flex-1`, sized against `maxHeight:100%`) gets a bounded flex-column
          parent. Without it the child height falls back to `auto`, the
          messages region grows to fit all content, and the composer is pushed
          off the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {children ?? (
          <React.Suspense fallback={null}>
            <ChatDockConversation
              userId={userId}
              apiBase={apiBase}
              defaultAgent={defaultAgent}
              appPackageId={appPackageId}
              surfaceContext={surfaceContext}
              surfaceArtifactLabel={surfaceArtifactLabel}
              target={target}
              onTargetChange={onTargetChange}
              handoff={handoff}
              presentation={full ? 'full' : 'rail'}
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
            />
          </React.Suspense>
        )}
      </div>
    </aside>
  );
}

export interface ChatDockMobileSheetProps extends ChatDockThreadProps {
  /** Sheet visibility — decoupled from {@link ChatDockState} so callers can
   *  drive it from the dock (console) or a local state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  apiBase?: string;
  /** `app.defaultAgent` for the default body's resolver. Unused with `children`. */
  defaultAgent?: string;
  /** objectui#10926 — same contract as {@link ChatDockPanelProps.appPackageId}. */
  appPackageId?: string;
  /** objectstack#30043 — same contract as {@link ChatDockPanelProps.surfaceContext}. */
  surfaceContext?: ChatSurfaceContext;
  /** Same contract as {@link ChatDockPanelProps.surfaceArtifactLabel}. */
  surfaceArtifactLabel?: string;
  /** Header title override; default "Assistant". */
  title?: string;
  /** Body override — same contract as {@link ChatDockPanel}. */
  children?: React.ReactNode;
}

/**
 * The drawer's UNDER-`md` presentation: a bottom sheet over the page instead of
 * a side rail (there is no horizontal room to reflow into on a phone). Same
 * conversation, same body contract as {@link ChatDockPanel} — chrome only.
 * Rendered `md:hidden`, so across a live viewport resize exactly one of
 * sheet/rail is visible.
 *
 * objectstack#34608 — the sheet already takes the screen, so it has no expand
 * button; its History button shows the conversation history inside the sheet,
 * where the retired full page used to keep it.
 */
export function ChatDockMobileSheet({
  open,
  onOpenChange,
  userId,
  apiBase: apiBaseProp,
  defaultAgent,
  appPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  title,
  target,
  onTargetChange,
  handoff,
  children,
}: ChatDockMobileSheetProps) {
  const { t } = useObjectTranslation();
  const apiBase = React.useMemo(() => resolveApiBase(apiBaseProp), [apiBaseProp]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[85svh] flex-col gap-0 p-0 md:hidden"
        data-testid="chat-dock-mobile-sheet"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-2">
          {/* History sits NEXT TO THE TITLE (left), finger-sized, well clear of
              SheetContent's built-in close ✕ (absolute right-4) so a thumb can't
              confuse the two. `pr-8` still reserves room for that ✕. */}
          <div className="flex items-center gap-1 pr-8">
            <SheetTitle className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <MessagesSquare className="size-4" />
              {title ?? t('console.ai.dock.title', { defaultValue: 'AI Assistant' })}
            </SheetTitle>
            {/* ADR-0057 #8 — usage indicator, mirrored on the mobile sheet header. */}
            <AiUsageIndicator apiBase={apiBase} />
            {!children ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-9 gap-1 px-2 text-muted-foreground hover:text-foreground', historyOpen && 'bg-accent text-foreground')}
                onClick={() => setHistoryOpen((v) => !v)}
                aria-pressed={historyOpen}
                aria-label={historyOpen
                  ? t('console.ai.dock.backToChat', { defaultValue: 'Back to chat' })
                  : t('console.ai.dock.history', { defaultValue: 'History' })}
                data-testid="chat-dock-mobile-history-toggle"
              >
                <History className="h-4 w-4" />
                {t('console.ai.dock.history', { defaultValue: 'History' })}
              </Button>
            ) : null}
          </div>
          <SheetDescription className="sr-only">
            {t('console.ai.dock.description', { defaultValue: 'AI assistant chat' })}
          </SheetDescription>
        </SheetHeader>
        {/* flex-col — same bounded-height reason as the desktop dock body above. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {children ?? (
            <React.Suspense fallback={null}>
              <ChatDockConversation
                userId={userId}
                apiBase={apiBase}
                defaultAgent={defaultAgent}
                appPackageId={appPackageId}
                surfaceContext={surfaceContext}
                surfaceArtifactLabel={surfaceArtifactLabel}
                target={target}
                onTargetChange={onTargetChange}
                handoff={handoff}
                presentation="sheet"
                historyOpen={historyOpen}
                onHistoryOpenChange={setHistoryOpen}
              />
            </React.Suspense>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export interface ChatDockLauncherProps {
  onExpand: () => void;
  /** Merged onto the default classes — e.g. the Studio mobile launcher swaps
   *  the `hidden md:inline-flex` gate for an always-visible variant. */
  className?: string;
}

/**
 * The collapsed affordance — a fixed edge button that expands the dock. Rendered
 * only while collapsed, so it never overlaps the expanded rail. The console
 * retired it in P3b (the FAB is that surface's launcher); the Studio dock (P3c)
 * used it as its collapsed state until objectui#12725 gave Studio a right slot
 * that the top bar shows and hides. No shipped surface mounts it today.
 *
 * objectui#11666 — like the console FAB, it carries a marker while a proposed
 * plan awaits the user's approval (read off the assistant bus, which the chat
 * publishes to). Expanding the dock does not clear it; the plan's state does.
 */
export function ChatDockLauncher({ onExpand, className }: ChatDockLauncherProps) {
  const { t } = useObjectTranslation();
  const planPending = usePlanApprovalPending();
  const markerId = React.useId();
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onExpand}
      data-testid="chat-dock-launcher"
      aria-label={t('console.ai.dock.open', { defaultValue: 'Open assistant' })}
      title={t('console.ai.dock.open', { defaultValue: 'Open assistant' })}
      aria-describedby={planPending ? markerId : undefined}
      className={cn(
        'fixed right-0 top-1/2 z-40 hidden h-16 w-7 -translate-y-1/2 rounded-l-md rounded-r-none border-r-0 bg-background shadow-md md:inline-flex',
        className,
      )}
    >
      <MessagesSquare className="size-4" />
      {planPending ? (
        <span className="absolute left-1 top-1 flex size-2.5" data-testid="chat-dock-launcher-plan-pending">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-amber-500 ring-2 ring-background" />
          <span id={markerId} className="sr-only">
            {t('console.ai.dock.planAwaitingApproval')}
          </span>
        </span>
      ) : null}
    </Button>
  );
}
