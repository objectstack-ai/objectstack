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
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '@object-ui/components';
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
}

export interface ConsoleChatDock {
  /** The handle for the robot and the pages; `null` when AI is off. */
  control: ChatDockControl | null;
  /** The desktop drawer, for the layout's right rail; `undefined` while closed or on a phone. */
  rail: React.ReactNode;
  /** The phone presentation (a bottom sheet); `null` off a phone. */
  sheet: React.ReactNode;
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

  const { expand, toggle, fullWindow, setFullWindow, expanded } = dock;
  const open = React.useCallback(
    (next?: ChatDockTarget | null, nextHandoff?: BuilderHandoffState) => {
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

  // A designer surface can ask the assistant to open through the assistant bus
  // (e.g. an "Ask AI" button).
  const { openSeq } = useAssistant();
  const seenOpenSeq = React.useRef(openSeq);
  React.useEffect(() => {
    if (openSeq === seenOpenSeq.current) return;
    seenOpenSeq.current = openSeq;
    if (enabled) expand();
  }, [openSeq, enabled, expand]);

  // ⌘/Ctrl+Shift+I toggles the drawer (composer-safe; see matchChatDockShortcut).
  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchChatDockShortcut(e) !== 'toggle') return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, toggle]);

  const control = React.useMemo<ChatDockControl | null>(
    () => (enabled ? { expanded, fullWindow, toggle, open } : null),
    [enabled, expanded, fullWindow, toggle, open],
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
