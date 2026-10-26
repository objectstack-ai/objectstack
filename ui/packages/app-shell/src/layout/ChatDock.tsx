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
 * conversation — the same thread the full-page `/ai` surface shows — so the dock
 * is a VIEW, not a new conversation. P3b retired the FAB into this dock's
 * launcher. P3c makes `/ai` the dock maximized (the header's maximize button ⇄
 * the page's collapse-to-dock button, same thread both ways) and auto-maximizes
 * the rail while the ADR-0037 Live Canvas is open. (P3c also reused the panel
 * under Studio; objectui#12725 moved the Studio copilot into that surface's own
 * right slot, `StudioRightSlot`, so the console is this panel's one host.)
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
import { Maximize2, MessagesSquare, PanelRightClose } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveApiBase } from '../console/ai/resolveApiBase.js';
import { AiUsageIndicator } from './AiUsageIndicator.js';
import { usePlanApprovalPending } from '../assistant/assistantBus.js';
import {
  clampDockWidth,
  maximizedDockWidth,
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
}

export interface ChatDockState {
  expanded: boolean;
  width: number;
  dragging: boolean;
  /** ADR-0037/P3c — true while the rail is canvas-maximized (see `maximize`). */
  maximized: boolean;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
  /**
   * Grow the rail to its widest legal width (Live Canvas needs room for the
   * chat + preview split). Transient: the pre-maximize width is remembered and
   * NEVER persisted over the user's chosen width.
   */
  maximize: () => void;
  /** Undo `maximize` — a no-op unless currently maximized (see doc below). */
  restore: () => void;
  /** Pointer-down on the rail's left-edge resize handle. */
  onResizePointerDown: (e: React.PointerEvent) => void;
}

/**
 * ChatDock open/collapsed + width state. Default COLLAPSED — the dock has zero
 * layout cost until invoked (preserving the FAB's virtue of not reflowing dense
 * data grids). Width persists to localStorage; the drag anchors the rail's LEFT
 * edge (dragging left widens it). All DOM reads happen in handlers, never render.
 *
 * P3c adds two orthogonal behaviors, both opt-in and both preserving the bare
 * `useChatDockState()` call unchanged:
 *  - `persistExpandedKey` round-trips expanded/collapsed through sessionStorage
 *    so the console rail survives in-tab navigation and the `/ai` page can arm
 *    it before navigating back ({@link armChatDockExpanded}).
 *  - `maximize`/`restore` implement the Live-Canvas "auto-maximize on canvas
 *    open, tuck on close" (ADR-0037 beside-the-chat preview needs width the
 *    rail doesn't have). `restore` is a NO-OP unless a maximize is actually
 *    latched: ChatPane reports `onCanvasOpenChange(false)` on mount (twice
 *    under StrictMode), and an unguarded restore would clobber the width on
 *    every dock open. A manual resize drag clears the latch — the user taking
 *    the handle wins over the automation, so the later canvas-close restore
 *    does nothing.
 */
export function useChatDockState(options?: ChatDockOptions): ChatDockState {
  const {
    defaultExpanded = false,
    persistExpandedKey,
    persistWidthKey = DOCK_WIDTH_STORAGE_KEY,
  } = options ?? {};
  const [expanded, setExpandedState] = React.useState<boolean>(() =>
    persistExpandedKey ? readStoredDockExpanded(persistExpandedKey, defaultExpanded) : defaultExpanded,
  );
  const [width, setWidth] = React.useState<number>(() => readStoredWidth(persistWidthKey));
  const [dragging, setDragging] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  // The latch and the width to return to when the canvas closes. Refs, not
  // state: they are only read inside handlers (never rendered), and the latch
  // must be checkable synchronously so a double-fired maximize/restore (React
  // StrictMode re-runs effects) can bail before touching the width.
  const maximizedRef = React.useRef(false);
  const prevWidthRef = React.useRef<number | null>(null);
  // Latest width, readable from the IDENTITY-STABLE maximize below. If
  // `maximize` closed over `width` (a [width] dep) its identity would change on
  // every drag move — and consumers key their canvas-open effect on the handler
  // identity, so each change would re-fire maximize mid-drag and snap the width
  // back to max, fighting the user. Render-phase ref sync keeps it current.
  const widthRef = React.useRef(width);
  widthRef.current = width;

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
      // Grabbing the handle is the user taking control of the width — drop the
      // canvas-maximize latch so the eventual canvas-close restore won't fight
      // them (their drag result stays, and gets persisted below as usual).
      maximizedRef.current = false;
      prevWidthRef.current = null;
      setMaximized(false);
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

  const maximize = React.useCallback(() => {
    if (maximizedRef.current) return; // already maximized — keep the original return width
    maximizedRef.current = true;
    prevWidthRef.current = widthRef.current;
    setWidth(maximizedDockWidth(window.innerWidth));
    setMaximized(true);
  }, []);

  const restore = React.useCallback(() => {
    // Not latched → nothing to undo. This guard is what makes ChatPane's
    // mount-time onCanvasOpenChange(false) (and StrictMode's double fire, and
    // a restore after a manual drag took the width over) harmless.
    if (!maximizedRef.current) return;
    maximizedRef.current = false;
    setWidth(prevWidthRef.current ?? readStoredWidth(persistWidthKey));
    prevWidthRef.current = null;
    setMaximized(false);
  }, [persistWidthKey]);

  const toggle = React.useCallback(() => setExpanded((v) => !v), [setExpanded]);
  const expand = React.useCallback(() => setExpanded(() => true), [setExpanded]);
  const collapse = React.useCallback(() => setExpanded(() => false), [setExpanded]);

  return {
    expanded,
    width,
    dragging,
    maximized,
    toggle,
    expand,
    collapse,
    maximize,
    restore,
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

export interface ChatDockPanelProps {
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
  /** Header title override; default "Assistant". */
  title?: string;
  /**
   * ADR-0057 P3c — render a maximize header button that opens the full-page
   * focus surface (`/ai…`) on the SAME thread. The caller supplies the
   * navigation because the right target is per-surface (console → `/ai`,
   * Studio → `/ai/build?package=…`). The default body's bound package
   * (objectui#10926) is passed along — `undefined` when the thread is
   * app-less, and always with a `children` body.
   */
  onMaximize?: (boundPackageId?: string) => void;
  /**
   * Body override. Default mounts {@link ChatDockConversation} (the console's
   * own thread — app-bound for `build` inside an authorable app, product-only
   * otherwise). A caller may pass its own conversation instead (the Studio
   * dock passed its package-scoped build thread until objectui#12725) — note
   * the empty-catalog gate then lives in the caller, because the default
   * body's self-gate is bypassed.
   */
  children?: React.ReactNode;
}

/**
 * The expanded rail — pass into {@link AppShell} `rightRail` so it reflows the
 * main content. Only render this when `dock.expanded` (the caller decides), so a
 * collapsed dock contributes no flex child.
 */
export function ChatDockPanel({
  dock,
  userId,
  apiBase: apiBaseProp,
  defaultAgent,
  appPackageId,
  title,
  onMaximize,
  children,
}: ChatDockPanelProps) {
  const { t } = useObjectTranslation();
  const apiBase = React.useMemo(() => resolveApiBase(apiBaseProp), [apiBaseProp]);
  const [boundPackageId, setBoundPackageId] = React.useState<string | undefined>(undefined);
  // ADR-0037/P3c — the default body auto-maximizes the rail while the Live
  // Canvas is open and tucks back when it closes (restore self-guards against
  // the mount-time false, StrictMode, and user-drag takeover).
  const handleCanvasOpenChange = React.useCallback(
    (open: boolean) => (open ? dock.maximize() : dock.restore()),
    [dock.maximize, dock.restore],
  );
  return (
    <aside
      data-testid="chat-dock-panel"
      style={{ width: dock.width }}
      className={cn(
        'relative hidden h-full shrink-0 flex-col border-l bg-background md:flex',
        // ADR-0037/P3c — animate the canvas auto-maximize / tuck so the rail
        // eases to its new width instead of snapping (issue #2477 item 4).
        // NOT while dragging: the width must track the pointer 1:1, so the
        // transition is suppressed for the duration of a resize drag.
        !dock.dragging && 'transition-[width] duration-200 ease-out',
      )}
    >
      {/* Left-edge resize handle. */}
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
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <MessagesSquare className="size-3.5" />
          {title ?? t('console.ai.dock.title', { defaultValue: 'Assistant' })}
        </span>
        <span className="flex items-center gap-0.5">
          {/* ADR-0057 #8 — proactive AI usage indicator (hides itself when the
              usage endpoint is absent / returns nothing to show). */}
          <AiUsageIndicator apiBase={apiBase} />
          {onMaximize ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onMaximize(boundPackageId)}
              aria-label={t('console.ai.dock.maximize', { defaultValue: 'Open full page' })}
              title={t('console.ai.dock.maximize', { defaultValue: 'Open full page' })}
              data-testid="chat-dock-maximize"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={dock.collapse}
            aria-label={t('console.ai.dock.collapse', { defaultValue: 'Collapse chat' })}
            data-testid="chat-dock-collapse"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </span>
      </div>
      {/* flex-col so an injected ChatPane child (its root is `flex min-h-0
          flex-1`, sized against `maxHeight:100%`) gets a bounded flex-column
          parent — mirrors the full-page `<main className="flex … flex-col">`.
          Without it the child height falls back to `auto`, the messages region
          grows to fit all content, and the composer is pushed off the bottom
          (the Studio build thread is always tall enough to trigger it). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {children ?? (
          <React.Suspense fallback={null}>
            <ChatDockConversation
              userId={userId}
              apiBase={apiBase}
              defaultAgent={defaultAgent}
              appPackageId={appPackageId}
              onCanvasOpenChange={handleCanvasOpenChange}
              onBoundPackageChange={setBoundPackageId}
            />
          </React.Suspense>
        )}
      </div>
    </aside>
  );
}

export interface ChatDockMobileSheetProps {
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
  /** Header title override; default "Assistant". */
  title?: string;
  /**
   * Open the full-page `/ai` surface (which on mobile already carries the
   * conversation-history sidebar + share). Runs DEFERRED — see the doc below
   * for why the sheet must close before this navigates. Receives the default
   * body's bound package, as {@link ChatDockPanelProps.onMaximize} does.
   */
  onMaximize?: (boundPackageId?: string) => void;
  /** Body override — same contract as {@link ChatDockPanel}. */
  children?: React.ReactNode;
}

/**
 * The dock's UNDER-`md` presentation: a bottom sheet over the page instead of a
 * side rail (there is no horizontal room to reflow into on a phone). Same
 * conversation, same body contract as {@link ChatDockPanel} — chrome only.
 * Rendered `md:hidden`, so across a live viewport resize exactly one of
 * sheet/rail is visible.
 *
 * The maximize button bridges to the full-page `/ai` — the mobile-native place
 * for conversation history + share (both already live there, so the sheet
 * needn't grow a second copy). This bridge is DEFERRED, not immediate: an
 * earlier cut navigated straight from the click and tore the still-OPEN Radix
 * sheet down mid-close — the route change unmounts the console synchronously,
 * so the scroll-lock / overlay never released and `/ai` landed blank-and-frozen
 * ("tap maximize → the chat's just gone", the bug that first removed this
 * button). The fix: the click only CLOSES the sheet (`onOpenChange(false)`);
 * once `open` has flipped false — after Radix's own child effects have released
 * the body on that same commit, and before this parent-level effect runs — we
 * navigate. So the sheet is already cleanly unmounted when the route changes.
 */
export function ChatDockMobileSheet({
  open,
  onOpenChange,
  userId,
  apiBase: apiBaseProp,
  defaultAgent,
  appPackageId,
  title,
  onMaximize,
  children,
}: ChatDockMobileSheetProps) {
  const { t } = useObjectTranslation();
  const apiBase = React.useMemo(() => resolveApiBase(apiBaseProp), [apiBaseProp]);
  const [boundPackageId, setBoundPackageId] = React.useState<string | undefined>(undefined);
  // Armed by the maximize click; fired once the sheet has actually closed.
  const pendingMaximizeRef = React.useRef(false);
  React.useEffect(() => {
    if (!open && pendingMaximizeRef.current) {
      pendingMaximizeRef.current = false;
      onMaximize?.(boundPackageId);
    }
  }, [open, onMaximize, boundPackageId]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[85svh] flex-col gap-0 p-0 md:hidden"
        data-testid="chat-dock-mobile-sheet"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-2">
          {/* Maximize sits NEXT TO THE TITLE (left), finger-sized, well clear of
              SheetContent's built-in close ✕ (absolute right-4) so a thumb can't
              confuse the two. `pr-8` still reserves room for that ✕. */}
          <div className="flex items-center gap-1 pr-8">
            <SheetTitle className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <MessagesSquare className="size-4" />
              {title ?? t('console.ai.dock.title', { defaultValue: 'Assistant' })}
            </SheetTitle>
            {/* ADR-0057 #8 — usage indicator, mirrored on the mobile sheet header. */}
            <AiUsageIndicator apiBase={apiBase} />
            {onMaximize ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                // Only CLOSE here — the deferred effect above navigates once the
                // sheet is cleanly shut (see the component doc).
                onClick={() => {
                  pendingMaximizeRef.current = true;
                  onOpenChange(false);
                }}
                aria-label={t('console.ai.dock.maximize', { defaultValue: 'Open full page' })}
                data-testid="chat-dock-mobile-maximize"
              >
                <Maximize2 className="h-4 w-4" />
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
                onBoundPackageChange={setBoundPackageId}
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
