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
import { ShareDialog } from '@object-ui/components';
import {
  useAgents,
  agentRouteName,
  isBuiltinAgentName,
  resolveAgentParam,
} from '@object-ui/plugin-chatbot/core';
import { ChatPane, type PendingFirstMessage } from '../console/ai/AiChatPage.js';
import { ConversationsSidebar } from '../console/ai/ConversationsSidebar.js';
import { resolvePublicShareBase } from '../console/organizations/resolveHomeUrl.js';
import { useChatConversation, type HydratedUIMessage } from '../hooks/index.js';
import { fetchConversation } from '../hooks/useChatConversation.js';
import { chatConversationScope, chatProductOfAgent } from '../hooks/chatScope.js';
import { resolveSurfaceAgent } from '../hooks/surfaceAgent.js';
import { isAiStudioEnabled } from '../runtime-config.js';
import type { ChatSurfaceContext } from './chatSurfaceContext.js';
import { useConversationFocus } from './chatFocus.js';
import {
  sameDockTarget,
  type ChatDockConversationActions,
  type ChatDockPresentation,
  type ChatDockTarget,
} from './chatDockTarget.js';
import { ChatDockControlProvider, useChatDockControl, type ChatDockControl } from './chatDockControl.js';

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
   * objectstack#30043 — the owning package (`_packageId`) of the app the
   * console is showing, sent as the turn's `context.activeApp`. Absent →
   * app-less.
   */
  appPackageId?: string;
  /**
   * objectstack#30043 — the page in view, as `context.surface` (cloud#1610's
   * shape; the layout reads it off the URL, see `consoleChatSurface`).
   * Re-read on every render and so on every send: navigating with the dock
   * open moves the next turn's surface. Absent → no `surface` key.
   */
  surfaceContext?: ChatSurfaceContext;
  /** objectui#8219 — the display label of `surfaceContext.artifact`, for the chip only. */
  surfaceArtifactLabel?: string;
  /**
   * objectstack#34608 — what the drawer shows (see `chatDockTarget.ts`).
   * Absent → the ambient thread described on {@link ChatDockConversation}.
   */
  target?: ChatDockTarget;
  /** Replaces the target in place: a picked history row or a minted fresh thread. */
  onTargetChange?: (target: ChatDockTarget | undefined) => void;
  /** Rail (history behind a button), full window (history beside the chat), or phone sheet. */
  presentation?: ChatDockPresentation;
  /** Rail and sheet only: the history list shown over the chat. */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  /**
   * objectstack#35445 — the drawer's title bar offers Share in its 「···」
   * menu. A host that passes this receives what that item acts on, and the
   * pane's own header row stops drawing it. The share dialog stays here; the
   * host opens it through the two props below, as it opens the history.
   */
  onActionsChange?: (actions: ChatDockConversationActions | undefined) => void;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
}

const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

/**
 * The drawer's chat body — resolves the agent + its P1 conversation and mounts
 * the shared {@link ChatPane}, with the conversation history beside it (full
 * window) or behind the header's History button (rail, sheet). Renders nothing
 * when the AI catalog is empty (OSS / no seat).
 *
 * With no target the drawer shows its AMBIENT thread, keyed per ADR-0057 on
 * the product alone: the ask thread is the same in every app (A2).
 *
 * objectstack#34608 — a target names the thread instead (a history row, an old
 * `/ai…` link, the agent launcher): its agent, conversation or a fresh start,
 * exactly as named.
 *
 * objectstack#35014 — a target belongs to the app it was opened in; the host
 * withholds it everywhere else, so the drawer's thread follows the app with
 * no prompt.
 */
export function ChatDockConversation({
  userId,
  apiBase,
  defaultAgent,
  appPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  target,
  onTargetChange,
  presentation = 'rail',
  historyOpen = false,
  onHistoryOpenChange,
  onActionsChange,
  shareOpen: shareOpenProp,
  onShareOpenChange,
}: ChatDockConversationProps) {
  const { agents, isLoading, error } = useAgents({ apiBase });
  const catalogNames = React.useMemo(() => agents.map((a) => a.name), [agents]);
  const aiStudioEnabled = isAiStudioEnabled();
  const ambientAgent = React.useMemo(
    () => resolveSurfaceAgent('default', { agents, appDefaultAgent: defaultAgent, aiStudioEnabled }),
    [agents, defaultAgent, aiStudioEnabled],
  );

  // ── The target's agent ──────────────────────────────────────────────────
  // A named agent the catalog serves wins. A lone segment that names no agent
  // and no built-in is a legacy bare conversation id (`/ai/ID`), resolved to
  // its own agent below. A built-in the catalog does not serve (`build` with no
  // AI Studio) falls back to the ambient agent rather than reading as an id.
  const targetAgent = target?.agent;
  const namedAgent =
    targetAgent && agents.length > 0 ? resolveAgentParam(targetAgent, catalogNames) : undefined;
  const legacyConversationId =
    targetAgent && agents.length > 0 && !namedAgent && !isBuiltinAgentName(targetAgent) && !target?.conversationId
      ? targetAgent
      : undefined;
  const activeAgent = namedAgent ?? ambientAgent;
  const activeAgentRoute = activeAgent ? agentRouteName(activeAgent) : undefined;

  React.useEffect(() => {
    if (!legacyConversationId) return;
    let cancelled = false;
    void (async () => {
      let convAgent: string | undefined;
      try {
        const conv = await fetchConversation(apiBase, legacyConversationId);
        convAgent = (conv as { agentId?: string } | null)?.agentId ?? undefined;
      } catch {
        /* gone or inaccessible — open it on the ambient agent; the pane settles empty */
      }
      if (cancelled) return;
      const resolved = resolveAgentParam(convAgent ?? '', catalogNames) ?? ambientAgent;
      onTargetChange?.({
        agent: resolved ? agentRouteName(resolved) : undefined,
        conversationId: legacyConversationId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [legacyConversationId, apiBase, catalogNames, ambientAgent, onTargetChange]);

  const chatApi = activeAgent
    ? `${apiBase}/agents/${encodeURIComponent(activeAgent)}/chat`
    : undefined;
  const product = chatProductOfAgent(activeAgent);
  const scope = activeAgent ? chatConversationScope({ product }) : undefined;
  const requestedConversationId = legacyConversationId ? undefined : target?.conversationId;
  const forceNew = Boolean(target?.fresh) && !requestedConversationId;
  // The user the conversation resolves for (none until the agent is known).
  const conversationUserId = activeAgent && !legacyConversationId ? userId : undefined;
  const {
    conversationId,
    conversationScope,
    initialMessages,
    ensureConversation,
    createError,
  } = useChatConversation({
    userId: conversationUserId,
    scope,
    apiBase,
    activeId: requestedConversationId,
    forceNew,
  });
  // #2450 — hand the pane only a scope-matched conversation. Switching agents
  // changes the scope while the dock stays mounted; until the hook
  // re-resolves, `conversationId` is still the previous agent's thread.
  const scopeMatched = conversationScope === scope;
  const paneConversationId = scopeMatched ? conversationId : undefined;
  const paneInitialMessages = scopeMatched ? initialMessages : EMPTY_INITIAL_MESSAGES;

  // ── A fresh target names its thread once the first send mints it ────────
  // Snapshot the id visible when the fresh target appears, and never record
  // that id: until the hook re-renders, `conversationId` can still be the
  // previous thread's. Derived state set during render (React re-renders
  // before committing), so no effect of this commit sees a missing snapshot.
  const [staleFresh, setStaleFresh] = React.useState<{ id: string | undefined } | null>(null);
  if (forceNew && staleFresh === null) setStaleFresh({ id: conversationId });
  else if (!forceNew && staleFresh !== null) setStaleFresh(null);
  React.useEffect(() => {
    if (!forceNew || !target || !paneConversationId) return;
    if (!staleFresh || staleFresh.id === paneConversationId) return;
    onTargetChange?.({
      agent: target.agent ?? activeAgentRoute,
      conversationId: paneConversationId,
      packageId: target.packageId,
    });
  }, [forceNew, target, paneConversationId, staleFresh, activeAgentRoute, onTargetChange]);

  const pendingFirstMessageRef = React.useRef<PendingFirstMessage | null>(null);
  // ADR-0028 — the composer's picked model, held here so it outlives the keyed
  // pane's remount when the first send mints the conversation.
  const [selectedModelId, setSelectedModelId] = React.useState<string | undefined>(undefined);
  // objectstack#36999 — the thread's focus (the record the user pinned it to),
  // held here for the same reason. It rides on the thread the scope resolved
  // and never re-keys it: a focus does not change which conversation the
  // drawer shows (ADR-0057 as amended for objectui#10926).
  // objectstack#37142 — keyed on the target too: a hand-off's carry goes to the
  // thread this target resolves, never to a history row or another app's
  // thread the user moves to before the first send.
  const focusTarget = React.useMemo(() => (target ? JSON.stringify(target) : undefined), [target]);
  const conversationFocus = useConversationFocus(paneConversationId, createError, focusTarget);
  // A first send creates the conversation: the id it mints takes the focus
  // pinned before it (and no other arriving id does).
  const { markSending: markFocusSending } = conversationFocus;
  const ensureConversationForSend = React.useCallback(() => {
    // With no user there is nothing to create: no mark, so no id that
    // arrives later takes the focus as this send's.
    if (conversationUserId) markFocusSending();
    return ensureConversation();
  }, [conversationUserId, markFocusSending, ensureConversation]);

  // ── The drawer's own controls over its thread ───────────────────────────
  // The launcher in the pane opens targets through the host. Picking the agent the ambient thread already runs goes
  // back to the ambient thread rather than an unbound copy of it.
  const host = useChatDockControl();
  const drawerControl = React.useMemo<ChatDockControl | null>(() => {
    if (!host) return null;
    return {
      ...host,
      open: (next, nextHandoff) => {
        const agentOnly =
          next?.agent && !next.conversationId && !next.packageId && !next.fresh && !nextHandoff
            ? next.agent
            : undefined;
        const backToAmbient =
          agentOnly !== undefined &&
          ambientAgent !== undefined &&
          resolveAgentParam(agentOnly, catalogNames) === ambientAgent;
        host.open(backToAmbient ? null : next, nextHandoff);
      },
    };
  }, [host, ambientAgent, catalogNames]);

  const startNewConversation = React.useCallback(() => {
    onTargetChange?.({ agent: activeAgentRoute, fresh: true });
    onHistoryOpenChange?.(false);
  }, [onTargetChange, activeAgentRoute, onHistoryOpenChange]);
  const openConversation = React.useCallback(
    (conversation: { id: string; agentId?: string }) => {
      const next: ChatDockTarget = {
        agent: conversation.agentId ? agentRouteName(conversation.agentId) : activeAgentRoute,
        conversationId: conversation.id,
      };
      if (!sameDockTarget(next, target)) onTargetChange?.(next);
      onHistoryOpenChange?.(false);
    },
    [activeAgentRoute, target, onTargetChange, onHistoryOpenChange],
  );

  // History freshness: a sent turn moves its row up, and the server titles a
  // new thread after its first answer, so the list is re-read a little later.
  const [refreshKey, setRefreshKey] = React.useState(0);
  const titledRef = React.useRef<Set<string>>(new Set());
  const handleSent = React.useCallback(
    (firstUserMessage?: string) => {
      setRefreshKey((k) => k + 1);
      if (!firstUserMessage || !conversationId || titledRef.current.has(conversationId)) return;
      titledRef.current.add(conversationId);
      setTimeout(() => setRefreshKey((k) => k + 1), 2500);
      setTimeout(() => setRefreshKey((k) => k + 1), 6000);
    },
    [conversationId],
  );

  // Share: the drawer's 「···」 menu offers it when its host takes it
  // (objectstack#35445), else the pane's header does.
  const [ownShareOpen, setOwnShareOpen] = React.useState(false);
  const shareOpen = shareOpenProp ?? ownShareOpen;
  const setShareOpen = onShareOpenChange ?? setOwnShareOpen;
  const actionsInHost = onActionsChange !== undefined;
  const restApiBase = React.useMemo(
    () => apiBase.replace(/\/v1\/ai$/, '').replace(/\/ai$/, '') || '/api',
    [apiBase],
  );
  const publicShareBase = React.useMemo(() => resolvePublicShareBase(), []);
  const emptyConversation = React.useMemo(
    () => ({
      size: presentation === 'full' ? ('large' as const) : ('compact' as const),
      userId,
      onOpenConversation: openConversation,
    }),
    [presentation, userId, openConversation],
  );
  const inert = !isLoading && agents.length === 0;
  React.useEffect(() => {
    onActionsChange?.(inert ? undefined : { conversationId, showDebug: false });
  }, [onActionsChange, inert, conversationId]);

  // OSS / no AI seat → the whole dock body is inert (the robot is gated too).
  if (inert) return null;

  const history = (
    <ConversationsSidebar
      userId={userId}
      apiBase={apiBase}
      activeAgent={activeAgent}
      refreshKey={refreshKey}
      activeConversationId={paneConversationId}
      onSelectConversation={openConversation}
      onNewConversation={startNewConversation}
      className={presentation === 'full' ? 'w-72 shrink-0 border-r' : 'border-r-0'}
    />
  );

  return (
    <ChatDockControlProvider value={drawerControl}>
      <div className="relative flex min-h-0 flex-1" data-testid="chat-dock-body" data-presentation={presentation}>
        {presentation === 'full' ? history : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatPane
            key={`${chatApi ?? 'local'}:${paneConversationId ?? 'pending'}`}
            agents={agents}
            agentsLoading={isLoading}
            agentsError={error}
            activeAgent={activeAgent}
            chatApi={chatApi}
            apiBase={apiBase}
            conversationId={paneConversationId}
            requestedConversationId={requestedConversationId}
            // objectstack#30043 — the app the dock sits in is the selected app,
            // whichever agent runs.
            activeAppPackageId={appPackageId}
            surfaceContext={surfaceContext}
            surfaceArtifactLabel={surfaceArtifactLabel}
            conversationFocus={conversationFocus}
            initialMessages={paneInitialMessages}
            pendingFirstMessageRef={pendingFirstMessageRef}
            ensureConversation={ensureConversationForSend}
            conversationCreateError={createError}
            selectedModelId={selectedModelId}
            onSelectedModelChange={setSelectedModelId}
            onSent={handleSent}
            onShare={() => setShareOpen(true)}
            actionsInHost={actionsInHost}
            // objectstack#37862 — the shared empty conversation: large where
            // the drawer fills the window, compact in the rail and the sheet;
            // a recent conversation opens here, as a history row does.
            emptyConversation={emptyConversation}
          />
        </div>
        {/* Rail and sheet: the history covers the chat while open; the pane
            stays mounted under it, so a streaming answer is never cut. */}
        {presentation !== 'full' && historyOpen ? (
          <div className="absolute inset-0 z-10 flex flex-col bg-background" data-testid="chat-dock-history">
            {history}
          </div>
        ) : null}
      </div>
      {conversationId ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          objectName="ai_conversations"
          recordId={conversationId}
          recordLabel="this conversation"
          apiBase={restApiBase}
          publicBaseUrl={publicShareBase}
        />
      ) : null}
    </ChatDockControlProvider>
  );
}
