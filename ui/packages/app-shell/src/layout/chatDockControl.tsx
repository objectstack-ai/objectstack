/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the handle on the console's one
 * chat container, the right-side drawer, for everything that opens it: the
 * top-bar robot (the only standing entry), the chat's own launcher and app
 * switcher, Home's "Build with AI".
 *
 * A layout that hosts the drawer (`ConsoleLayout`, `HomeLayout`) provides it.
 * Under no host — the Studio surface, or a host app that still mounts the
 * retired full page — {@link useOpenAssistant} falls back to the pre-drawer
 * address, which the console routes back into the drawer.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { agentRouteName } from '@object-ui/plugin-chatbot/core';
import { aiAddressOf, type BuilderHandoffState, type ChatDockTarget } from './chatDockTarget.js';

export interface ChatDockControl {
  /** True while the drawer is open (rail or maximized). */
  expanded: boolean;
  /** True while the drawer fills the window (maximized in place). */
  fullWindow: boolean;
  /**
   * Open the drawer if closed, close it if open — the assistant's entry (the
   * top-bar 「Ask AI」 button, the keyboard toggle). Closing is the user's
   * close; opening is {@link openEntry}'s (ui ADR-0057 Amendment A5).
   */
  toggle: () => void;
  /**
   * Open the drawer on `target`: absent, on whatever it shows now; `null`, on
   * its ambient thread. A handoff is held in memory and sent once as the
   * target thread's first message.
   */
  open: (target?: ChatDockTarget | null, handoff?: BuilderHandoffState) => void;
  /**
   * ui ADR-0057 Amendment A5 — open the drawer from the assistant's entry: a
   * new conversation after the user's own close (or the first time in the
   * tab), the same one after the console closed the phone sheet, the one shown
   * at the close while a write in it awaits approval; a build thread as it
   * was. `agent` is the agent the entry asks (Home's 「Ask AI」: `ask`).
   * Nothing happens while the drawer is open. Absent on a handle that is not
   * the console's (a test's, Studio's): such a caller opens with {@link open}.
   */
  openEntry?: (agent?: string) => void;
  /**
   * ui ADR-0057 Amendment A4 — the app's AI inquiry page is the active route:
   * the drawer's triggers are hidden there (the top-bar robot draws nothing)
   * and `open` opens only a build hand-off. Absent = false.
   */
  askPageActive?: boolean;
}

const ChatDockControlContext = React.createContext<ChatDockControl | null>(null);

/** Provided by a layout that hosts the drawer. */
export const ChatDockControlProvider = ChatDockControlContext.Provider;

/** The hosting layout's drawer handle; `null` outside one. */
export function useChatDockControl(): ChatDockControl | null {
  return React.useContext(ChatDockControlContext);
}

/**
 * Open the assistant on a target: in place, in the hosting layout's drawer; with
 * no host, by navigating to the target's pre-drawer address (the handoff rides
 * navigation state, never the URL).
 */
export function useOpenAssistant(): (target?: ChatDockTarget | null, handoff?: BuilderHandoffState) => void {
  const control = useChatDockControl();
  const navigate = useNavigate();
  return React.useCallback(
    (target?: ChatDockTarget | null, handoff?: BuilderHandoffState) => {
      if (control) {
        control.open(target, handoff);
        return;
      }
      const state: BuilderHandoffState = {};
      if (handoff?.handoffPrompt) state.handoffPrompt = handoff.handoffPrompt;
      if (handoff?.parentConversationId) state.parentConversationId = handoff.parentConversationId;
      const to = aiAddressOf(target ?? undefined, agentRouteName);
      if (Object.keys(state).length > 0) navigate(to, { state });
      else navigate(to);
    },
    [control, navigate],
  );
}
