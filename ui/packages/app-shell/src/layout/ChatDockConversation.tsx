/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The ChatDock's default body, split out of `ChatDock.tsx` so the dock chrome
 * can load it on first render (objectui#13410). This module statically reaches
 * `ChatPane` and through it the whole `@object-ui/plugin-chatbot` chat UI;
 * ⛔ nothing in the eager console graph may import it statically, or that UI
 * rejoins every first page load. `ChatDock.tsx` reaches it through `lazy()`.
 */

import * as React from 'react';
import { useAgents } from '@object-ui/plugin-chatbot/core';
import {
  ChatPane,
  isPlatformBuiltinApp,
  isThreadBoundToPackage,
  type PendingFirstMessage,
} from '../console/ai/AiChatPage.js';
import { useChatConversation, type HydratedUIMessage } from '../hooks/index.js';
import { chatConversationScope, chatProductOfAgent } from '../hooks/chatScope.js';
import { resolveSurfaceAgent } from '../hooks/surfaceAgent.js';
import { useCanAuthorMetadata } from '../hooks/useCanAuthorMetadata.js';
import { isAiStudioEnabled } from '../runtime-config.js';

export interface ChatDockConversationProps {
  userId: string | undefined;
  apiBase: string;
  /**
   * `app.defaultAgent` of the active app — forwarded to the ONE resolver
   * (bounded to ask/build there), so the dock honors the same per-app default
   * the FAB always did. Absent → the surface default (`ask`).
   */
  defaultAgent?: string;
  /**
   * objectui#10926 — the owning package (`_packageId`) of the app the console
   * is showing. Only a `build` thread binds to it, and only when it is
   * authorable (see {@link ChatDockConversation}). Absent → app-less.
   */
  appPackageId?: string;
  /** ADR-0037/P3c — the Live Canvas open/close seam, forwarded to ChatPane. */
  onCanvasOpenChange?: (open: boolean) => void;
  /**
   * objectui#10926 — reports the package the build thread is bound to
   * (`undefined` = app-less), so the chrome's maximize opens that app's build
   * surface instead of the bare `/ai`.
   */
  onBoundPackageChange?: (packageId: string | undefined) => void;
}

const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

/**
 * The dock's chat body — resolves the surface agent + its P1 conversation and
 * mounts the shared {@link ChatPane}. Mirrors StudioAiCopilot's minimal embed on
 * the `default` surface. Renders nothing when the AI catalog is empty (OSS / no
 * seat).
 *
 * The scope follows ADR-0057 as amended for objectui#10926 (maintainer ruling
 * 「绑定当前应用（推荐）」): inside an AUTHORABLE app — its package is not a
 * `com.objectstack.*` built-in, the A1.b switcher's own predicate — a `build`
 * thread binds to that app. `editPackageId` is the app's package, the scope is
 * `app:PKG:build`, the key the Studio copilot and `/ai/build?package=PKG`
 * resolve, so the three show ONE thread; the chip, the empty state and the
 * agent context (`context.packageId`) name the app. `ask` stays ambient, and
 * outside an authorable app the key is the product alone, as before. The
 * product-only thread is never cleared: it stays under its own key and in the
 * `/ai` sidebar, and — through the same A1.b migration read the full page runs
 * — it is adopted into the app's scope only when its own history is bound to
 * that app.
 */
export function ChatDockConversation({
  userId,
  apiBase,
  defaultAgent,
  appPackageId,
  onCanvasOpenChange,
  onBoundPackageChange,
}: ChatDockConversationProps) {
  const { agents, isLoading, error } = useAgents({ apiBase });
  // cloud#1674 maker convergence — the console dock is a maker surface, so an
  // authoring-capable principal's ambient thread upgrades ask→build inside the
  // ONE resolver; business sessions keep the ask ambient thread unchanged.
  const canAuthorMetadata = useCanAuthorMetadata();
  const activeAgent = React.useMemo(
    () =>
      resolveSurfaceAgent('default', {
        agents,
        appDefaultAgent: defaultAgent,
        aiStudioEnabled: isAiStudioEnabled(),
        canAuthorMetadata,
      }),
    [agents, defaultAgent, canAuthorMetadata],
  );
  const chatApi = activeAgent
    ? `${apiBase}/agents/${encodeURIComponent(activeAgent)}/chat`
    : undefined;
  const product = chatProductOfAgent(activeAgent);
  const editPackageId =
    product === 'build' && appPackageId && !isPlatformBuiltinApp({ _packageId: appPackageId })
      ? appPackageId
      : undefined;
  const scope = activeAgent
    ? chatConversationScope({ appId: editPackageId, product })
    : undefined;
  const adoptLegacyBuildThread = React.useCallback(
    (messages: HydratedUIMessage[]) =>
      editPackageId !== undefined && isThreadBoundToPackage(messages, editPackageId),
    [editPackageId],
  );
  const { conversationId, conversationScope, initialMessages } = useChatConversation({
    userId: activeAgent ? userId : undefined,
    scope,
    apiBase,
    activeId: undefined,
    forceNew: false,
    legacyScope: editPackageId ? product : undefined,
    adoptLegacy: editPackageId ? adoptLegacyBuildThread : undefined,
  });
  // #2450 — hand the pane only a scope-matched conversation. Moving between
  // apps changes the scope while the dock stays mounted; until the hook
  // re-resolves, `conversationId` is still the previous app's thread, and a
  // pane mounted on it would pair that thread with the new app's package.
  const scopeMatched = conversationScope === scope;
  const paneConversationId = scopeMatched ? conversationId : undefined;
  const paneInitialMessages = scopeMatched ? initialMessages : EMPTY_INITIAL_MESSAGES;
  React.useEffect(() => {
    onBoundPackageChange?.(editPackageId);
  }, [editPackageId, onBoundPackageChange]);
  const pendingFirstMessageRef = React.useRef<PendingFirstMessage | null>(null);

  // OSS / no AI seat → the whole dock body is inert (the launcher is gated too).
  if (!isLoading && agents.length === 0) return null;

  return (
    <ChatPane
      key={`${chatApi ?? 'local'}:${paneConversationId ?? 'pending'}`}
      agents={agents}
      agentsLoading={isLoading}
      agentsError={error}
      activeAgent={activeAgent}
      chatApi={chatApi}
      apiBase={apiBase}
      conversationId={paneConversationId}
      editPackageId={editPackageId}
      initialMessages={paneInitialMessages}
      pendingFirstMessageRef={pendingFirstMessageRef}
      onSent={() => {}}
      onShare={() => {}}
      showDebug={false}
      onCanvasOpenChange={onCanvasOpenChange}
    />
  );
}
