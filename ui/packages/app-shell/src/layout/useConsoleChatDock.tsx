/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the console's one chat
 * container, hosted by each console layout (`ConsoleLayout` and `HomeLayout`):
 * the drawer's open / full-window state, what it shows, its keyboard toggle,
 * and the handle ({@link ChatDockControl}) the top-bar robot and the pages open
 * it through. Both layouts persist to the same per-tab keys, so moving between
 * Home and an app keeps the drawer as it was.
 *
 * Kept out of `ChatDock.tsx`'s lazy body: this module is in every console page
 * load, so it imports no chat code (objectui#13410).
 */
import * as React from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useIsMobile } from '@object-ui/components';
import { isBuildAgent } from '@object-ui/plugin-chatbot/core';
import { useAssistant } from '../assistant/assistantBus.js';
import { useChatDockState, ChatDockPanel, ChatDockMobileSheet } from './ChatDock.js';
import { matchChatDockShortcut, DOCK_EXPANDED_STORAGE_KEY } from './chatDockState.js';
import {
  ambientAppPackage,
  dockTargetFollowsApp,
  placeDockTarget,
  readBuilderHandoffState,
  readStoredDockTarget,
  sameDockTarget,
  writeStoredDockTarget,
  DOCK_HANDOFF_STATE_KEY,
  type BuilderHandoffState,
  type ChatDockHandoff,
  type ChatDockTarget,
} from './chatDockTarget.js';
import type { ChatDockControl } from './chatDockControl.js';
import type { ChatSurfaceContext } from './chatSurfaceContext.js';

export interface ConsoleChatDockOptions {
  /** The runtime serves AI (`useAiSurfaceEnabled`); off, nothing renders and there is no handle. */
  enabled: boolean;
  userId?: string;
  /** `app.defaultAgent` of the app in view. */
  defaultAgent?: string;
  /** The owning package of the app in view (absent on Home). */
  appPackageId?: string;
  /** objectstack#30043 — the page in view, as `context.surface`. */
  surfaceContext?: ChatSurfaceContext;
  surfaceArtifactLabel?: string;
  /**
   * ui ADR-0057 Amendment A4 — the app's AI inquiry page (`ai:chat`) is the
   * active route. While it is, the drawer is closed and its triggers are
   * inert: the keyboard toggle and the assistant bus open nothing, and
   * `open()` opens only a build hand-off ({@link opensBesideAskPage}). Leaving
   * the page shows the drawer as it was.
   */
  askPageActive?: boolean;
}

/**
 * ui ADR-0057 Amendment A4 — what the drawer may open on the AI inquiry page:
 * a build hand-off (a build target, or a Builder handoff), never a second
 * `ask` conversation beside the page's own.
 */
export function opensBesideAskPage(target: ChatDockTarget | null | undefined, handoff?: BuilderHandoffState): boolean {
  return hasHandoff(handoff) || Boolean(target?.agent && isBuildAgent(target.agent));
}

export interface ConsoleChatDock {
  /** The handle for the robot and the pages; `null` when AI is off. */
  control: ChatDockControl | null;
  /** The desktop drawer, for the layout's right rail; `undefined` while closed or on a phone. */
  rail: React.ReactNode;
  /** The phone presentation (a bottom sheet); `null` off a phone. */
  sheet: React.ReactNode;
}

/**
 * objectstack#37556 — the history entry (`location.key`) the phone sheet was
 * last shown open on, per tab (sessionStorage, like the drawer's own state).
 * Absent while the sheet is closed. Where sessionStorage throws (private
 * mode), the entry is kept in this module instead: it then lasts as long as
 * the page, which covers every in-app navigation, layout swaps included.
 */
const DOCK_SHEET_SHOWN_AT_STORAGE_KEY = 'ai-chat-dock-sheet-shown-at';
/** The width the drawer is a sheet below: `useIsMobile`'s breakpoint (`@object-ui/components`). */
const SHEET_WIDTH_BELOW = 768;
let sheetShownAtInMemory: string | null = null;

function readSheetShownAt(): string | null {
  try {
    return window.sessionStorage.getItem(DOCK_SHEET_SHOWN_AT_STORAGE_KEY);
  } catch {
    return sheetShownAtInMemory;
  }
}

function writeSheetShownAt(key: string | null): void {
  sheetShownAtInMemory = key;
  try {
    if (key === null) window.sessionStorage.removeItem(DOCK_SHEET_SHOWN_AT_STORAGE_KEY);
    else window.sessionStorage.setItem(DOCK_SHEET_SHOWN_AT_STORAGE_KEY, key);
  } catch {
    /* private mode: the module copy above stands in */
  }
}

function hasHandoff(state: BuilderHandoffState | undefined): state is BuilderHandoffState {
  return Boolean(state && (state.handoffPrompt || state.parentConversationId));
}

export function useConsoleChatDock({
  enabled,
  userId,
  defaultAgent,
  appPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  askPageActive = false,
}: ConsoleChatDockOptions): ConsoleChatDock {
  const dock = useChatDockState({ persistExpandedKey: DOCK_EXPANDED_STORAGE_KEY, persistFullWindow: true });
  // Under `md` there is no horizontal room for the rail — the drawer presents
  // as a bottom sheet instead (same conversation, chrome only). The hook (not
  // the rail's `hidden md:` classes alone) decides which one MOUNTS, so the
  // phone never pays for an invisible rail's chat graph.
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  // What the drawer shows: per tab, so it survives navigation and a reload.
  // objectstack#35014 — and per app: every target is stamped with the app it
  // was opened in, and is shown only there or in the app it names
  // (`dockTargetFollowsApp`). Moving to another app shows that app's ambient
  // thread, automatically and with no prompt (the maintainer's ruling); the
  // target stays stored, so coming back shows it again. The app is read at the
  // moment of the call, not from a closure: a child's effect (the build that
  // binds a package and moves the page) can call in the commit that changes it.
  // A layout effect, because every layout effect of a commit runs before any
  // passive one, the children's included.
  const ambientApp = ambientAppPackage(appPackageId);
  const ambientAppRef = React.useRef(ambientApp);
  React.useLayoutEffect(() => {
    ambientAppRef.current = ambientApp;
  }, [ambientApp]);
  const [target, setTargetState] = React.useState<ChatDockTarget | undefined>(() =>
    placeDockTarget(readStoredDockTarget(), ambientApp),
  );
  const setTarget = React.useCallback((next: ChatDockTarget | undefined) => {
    const placed = placeDockTarget(next, ambientAppRef.current);
    setTargetState((prev) => (sameDockTarget(prev, placed) ? prev : placed));
    writeStoredDockTarget(placed);
  }, []);
  // A target this host found unplaced (an old `/ai…` link, stored before the
  // redirect knew its landing) is placed in the app it was first read in;
  // record that, so a later host (Home, another app) reads it as placed.
  React.useEffect(() => {
    if (target && !sameDockTarget(target, readStoredDockTarget())) writeStoredDockTarget(target);
  }, [target]);
  const shownTarget = target && dockTargetFollowsApp(target, ambientApp) ? target : undefined;
  // A Builder handoff is held in memory only (objectui#12493).
  const [handoff, setHandoff] = React.useState<ChatDockHandoff | undefined>(undefined);
  const handoffSeqRef = React.useRef(0);
  const holdHandoff = React.useCallback((state: BuilderHandoffState | undefined) => {
    if (hasHandoff(state)) {
      handoffSeqRef.current += 1;
      setHandoff({ seq: handoffSeqRef.current, state });
    } else {
      setHandoff(undefined);
    }
  }, []);

  const { expand, collapse, toggle, fullWindow, setFullWindow, expanded: storedExpanded } = dock;
  // ui ADR-0057 Amendment A4 — on the AI inquiry page the drawer is shown only
  // after a build hand-off opened it there; the stored open state is left as
  // it is, so the next page shows the drawer as the user left it.
  const [handoffOnAskPage, setHandoffOnAskPage] = React.useState(false);
  if (handoffOnAskPage && (!askPageActive || !storedExpanded)) setHandoffOnAskPage(false);
  const expanded = storedExpanded && (!askPageActive || handoffOnAskPage);
  const askPageActiveRef = React.useRef(askPageActive);
  React.useLayoutEffect(() => {
    askPageActiveRef.current = askPageActive;
  }, [askPageActive]);
  const open = React.useCallback(
    (next?: ChatDockTarget | null, nextHandoff?: BuilderHandoffState) => {
      if (askPageActiveRef.current) {
        if (!opensBesideAskPage(next, nextHandoff)) return;
        setHandoffOnAskPage(true);
      }
      if (next === null) setTarget(undefined);
      else if (next !== undefined) setTarget(next);
      holdHandoff(nextHandoff);
      expand();
    },
    [setTarget, holdHandoff, expand],
  );

  // A redirected old `/ai…` link hands its handoff over in navigation state;
  // take it once, then drop it from the history entry so a reload never
  // re-sends the prompt.
  React.useEffect(() => {
    if (!enabled) return;
    const raw = (location.state as Record<string, unknown> | null)?.[DOCK_HANDOFF_STATE_KEY];
    if (raw === undefined) return;
    holdHandoff(readBuilderHandoffState(raw));
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [enabled, location.key, location.state, location.pathname, location.search, location.hash, holdHandoff, navigate]);

  // Leaving the page (a record or list the chat opened, a link) drops the full
  // window back to the rail, so the page the user went to is what they see.
  const page = `${location.pathname}${location.search}`;
  const lastPageRef = React.useRef(page);
  React.useEffect(() => {
    if (lastPageRef.current === page) return;
    lastPageRef.current = page;
    if (fullWindow) setFullWindow(false);
  }, [page, fullWindow, setFullWindow]);

  // objectstack#37556 — on a phone the drawer is a sheet over the page, so a
  // page the chat opens (a citation chip's cited section, a record, a list)
  // stays hidden under it. A PUSH or POP away from the history entry the sheet
  // was shown on closes it, a PUSH onto the same URL included (clicking the
  // same chip again opens its section again); the conversation is kept, so
  // reopening shows it. A REPLACE (a page rewriting its own query, the handoff
  // hand-over above, an old `/ai…` link landing with the drawer armed open)
  // leaves it open. The entry is kept per tab, not in this hook: a chip that
  // opens another app's record, or leaves Home for an app, mounts another
  // layout, and this host with it. The desktop rail sits beside the page and
  // stays as it is.
  //
  // The move away is noted on the navigation itself, before the phone check:
  // `useIsMobile` answers `false` on a host's first render, and a page that
  // REPLACEs its address on mount (an app named by an alias moving to its
  // package address) lands in that same first commit, so by the time the host
  // knows it is on a phone the navigation type it sees is that REPLACE.
  //
  // At a desktop width there is no sheet, so the entry is dropped: a tablet
  // turned from portrait (sheet) to landscape (rail) and back does not close
  // the drawer on the turn. Desktop is read off the window, not `isMobile`,
  // whose first-render `false` would drop a phone's entry on every remount.
  const navigationType = useNavigationType();
  const movedAwayRef = React.useRef(false);
  React.useEffect(() => {
    if (!enabled) return;
    if (!isMobile && window.innerWidth >= SHEET_WIDTH_BELOW) {
      movedAwayRef.current = false;
      writeSheetShownAt(null);
      return;
    }
    const shownAt = readSheetShownAt();
    if (shownAt !== null && shownAt !== location.key && navigationType !== NavigationType.Replace) {
      movedAwayRef.current = true;
    }
    // A phone host's first render: `isMobile` is not measured yet.
    if (!isMobile) return;
    // ui ADR-0057 Amendment A4 — arriving on the AI inquiry page with the
    // sheet stored open closes it: the page hides it, and a phone sheet
    // closes on any move away anyway (above), so the next page must not
    // bring it back over itself. The desktop rail keeps its stored state.
    if (askPageActive && storedExpanded && !expanded) {
      movedAwayRef.current = false;
      writeSheetShownAt(null);
      collapse();
      return;
    }
    if (!expanded) {
      movedAwayRef.current = false;
      writeSheetShownAt(null);
      return;
    }
    if (movedAwayRef.current) {
      movedAwayRef.current = false;
      writeSheetShownAt(null);
      collapse();
      return;
    }
    writeSheetShownAt(location.key);
  }, [enabled, isMobile, expanded, storedExpanded, askPageActive, location.key, navigationType, collapse]);

  // A designer surface can ask the assistant to open through the assistant bus
  // (e.g. an "Ask AI" button).
  const { openSeq } = useAssistant();
  const seenOpenSeq = React.useRef(openSeq);
  React.useEffect(() => {
    if (openSeq === seenOpenSeq.current) return;
    seenOpenSeq.current = openSeq;
    if (enabled && !askPageActiveRef.current) expand();
  }, [openSeq, enabled, expand]);

  // ⌘/Ctrl+Shift+I toggles the drawer (composer-safe; see matchChatDockShortcut).
  // ui ADR-0057 Amendment A4 — inert on the AI inquiry page.
  React.useEffect(() => {
    if (!enabled || askPageActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchChatDockShortcut(e) !== 'toggle') return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, askPageActive, toggle]);

  const control = React.useMemo<ChatDockControl | null>(
    () => (enabled ? { expanded, fullWindow, toggle, open, askPageActive } : null),
    [enabled, expanded, fullWindow, toggle, open, askPageActive],
  );

  const thread = { target: shownTarget, onTargetChange: setTarget, handoff };
  const rail =
    enabled && expanded && !isMobile ? (
      <ChatDockPanel
        dock={dock}
        userId={userId}
        defaultAgent={defaultAgent}
        appPackageId={appPackageId}
        surfaceContext={surfaceContext}
        surfaceArtifactLabel={surfaceArtifactLabel}
        {...thread}
      />
    ) : undefined;
  const sheet =
    enabled && isMobile ? (
      <ChatDockMobileSheet
        open={expanded}
        onOpenChange={(next) => (next ? expand() : dock.collapse())}
        userId={userId}
        defaultAgent={defaultAgent}
        appPackageId={appPackageId}
        surfaceContext={surfaceContext}
        surfaceArtifactLabel={surfaceArtifactLabel}
        {...thread}
      />
    ) : null;
  return { control, rail, sheet };
}
