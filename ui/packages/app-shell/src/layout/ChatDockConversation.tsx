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
  agentHasCapability,
  agentRouteName,
  isAskAgent,
  isBuiltinAgentName,
  resolveAgentParam,
} from '@object-ui/plugin-chatbot/core';
import {
  ChatPane,
  isThreadBoundToPackage,
  type PendingFirstMessage,
} from '../console/ai/AiChatPage.js';
import { ConversationsSidebar } from '../console/ai/ConversationsSidebar.js';
import { BuildDebugDrawer } from '../console/ai/BuildDebugDrawer.js';
import { resolvePublicShareBase } from '../console/organizations/resolveHomeUrl.js';
import { useChatConversation, type HydratedUIMessage } from '../hooks/index.js';
import { fetchConversation } from '../hooks/useChatConversation.js';
import { chatConversationScope, chatProductOfAgent } from '../hooks/chatScope.js';
import { makerConvergedOnBuild, resolveSurfaceAgent } from '../hooks/surfaceAgent.js';
import { useCanAuthorMetadata } from '../hooks/useCanAuthorMetadata.js';
import { isAiStudioEnabled } from '../runtime-config.js';
import type { ChatSurfaceContext } from './chatSurfaceContext.js';
import {
  ambientAppPackage,
  sameDockTarget,
  type ChatDockHandoff,
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
   * objectui#10926 — the owning package (`_packageId`) of the app the console
   * is showing. Only a `build` thread binds to it, and only when it is
   * authorable (see {@link ChatDockConversation}). Absent → app-less.
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
  /** Replaces the target in place: a picked history row, a minted fresh thread, a binding. */
  onTargetChange?: (target: ChatDockTarget | undefined) => void;
  /** A Builder handoff to seed once as the build thread's first message. */
  handoff?: ChatDockHandoff;
  /** Rail (history behind a button), full window (history beside the chat), or phone sheet. */
  presentation?: ChatDockPresentation;
  /** Rail and sheet only: the history list shown over the chat. */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
}

const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

/**
 * The drawer's chat body — resolves the agent + its P1 conversation and mounts
 * the shared {@link ChatPane}, with the conversation history beside it (full
 * window) or behind the header's History button (rail, sheet). Renders nothing
 * when the AI catalog is empty (OSS / no seat).
 *
 * With no target the drawer shows its AMBIENT thread, scoped per ADR-0057 as
 * amended for objectui#10926 (maintainer ruling 「绑定当前应用（推荐）」): inside
 * an AUTHORABLE app — its package is not a `com.objectstack.*` built-in, the
 * A1.b switcher's own predicate — a `build` thread binds to that app.
 * `editPackageId` is the app's package, the scope is `app:PKG:build`, the key
 * the Studio copilot resolves, so the two show ONE thread; the chip, the empty
 * state and the agent context (`context.packageId`) name the app. `ask` stays
 * ambient, and outside an authorable app the key is the product alone. The
 * product-only thread is never cleared: it stays under its own key and in the
 * history, and — through the A1.b migration read — it is adopted into the
 * app's scope only when its own history is bound to that app.
 *
 * objectstack#34608 — a target names the thread instead (a history row, an old
 * `/ai…` link, "Edit with AI", the agent launcher): its agent, conversation,
 * package or a fresh start, exactly as named — a target never infers the app.
 * A new build stays UNBOUND until the build creates its package (ADR-0057 A1),
 * and then re-keys to that app in place (A1.b bind-on-create).
 *
 * objectstack#35014 — a target belongs to the app it was opened in (or the app
 * it names); the host withholds it everywhere else, so the drawer's thread
 * follows the app with no prompt. `ask` stays ambient (A2): its key carries no
 * app, so the ask thread is the same in every app.
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
  handoff,
  presentation = 'rail',
  historyOpen = false,
  onHistoryOpenChange,
}: ChatDockConversationProps) {
  const { agents, isLoading, error } = useAgents({ apiBase });
  const catalogNames = React.useMemo(() => agents.map((a) => a.name), [agents]);
  // cloud#1674 maker convergence — the console dock is a maker surface, so an
  // authoring-capable principal's ambient thread upgrades ask→build inside the
  // ONE resolver; business sessions keep the ask ambient thread unchanged.
  const canAuthorMetadata = useCanAuthorMetadata();
  const aiStudioEnabled = isAiStudioEnabled();
  const makerConverged = makerConvergedOnBuild(agents, canAuthorMetadata, aiStudioEnabled);
  const ambientAgent = React.useMemo(
    () =>
      resolveSurfaceAgent('default', {
        agents,
        appDefaultAgent: defaultAgent,
        aiStudioEnabled,
        canAuthorMetadata,
      }),
    [agents, defaultAgent, aiStudioEnabled, canAuthorMetadata],
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
  let activeAgent = ambientAgent;
  if (namedAgent) {
    // cloud#1674 — a maker opening the bare ask agent lands on the converged
    // build composer; an existing ask conversation still opens on its own agent.
    activeAgent =
      makerConverged && isAskAgent(namedAgent) && !target?.conversationId
        ? resolveAgentParam('build', catalogNames) ?? namedAgent
        : namedAgent;
  }
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
  const ambientPackageId = ambientAppPackage(appPackageId);
  // objectstack#35014 — a target reaches this body only in the app it belongs
  // to: the host (`useConsoleChatDock`) hands it down there and nowhere else,
  // so moving to another app arrives here as "no target" and the new app's
  // ambient thread resolves below.
  const editPackageId =
    product === 'build' ? (target ? target.packageId : ambientPackageId) : undefined;
  const scope = activeAgent
    ? chatConversationScope({ appId: editPackageId, product })
    : undefined;
  const adoptLegacyBuildThread = React.useCallback(
    (messages: HydratedUIMessage[]) =>
      editPackageId !== undefined && isThreadBoundToPackage(messages, editPackageId),
    [editPackageId],
  );
  const requestedConversationId = legacyConversationId ? undefined : target?.conversationId;
  const forceNew = Boolean(target?.fresh) && !requestedConversationId;
  const {
    conversationId,
    conversationScope,
    initialMessages,
    ensureConversation,
    createError,
    rekeyScope,
  } = useChatConversation({
    userId: activeAgent && !legacyConversationId ? userId : undefined,
    scope,
    apiBase,
    activeId: requestedConversationId,
    forceNew,
    legacyScope: editPackageId && !target ? product : undefined,
    adoptLegacy: editPackageId && !target ? adoptLegacyBuildThread : undefined,
  });
  // #2450 — hand the pane only a scope-matched conversation. Moving between
  // apps changes the scope while the dock stays mounted; until the hook
  // re-resolves, `conversationId` is still the previous app's thread, and a
  // pane mounted on it would pair that thread with the new app's package.
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

  // ── A1.b bind-on-create ─────────────────────────────────────────────────
  // The build just minted (or its history reveals) package `pkg` while this
  // thread is keyed product-only: re-key it to `app:PKG:build` first (the
  // scope flips synchronously, so the #2450 gate stays matched and the pane is
  // never remounted), then name the package on the target.
  const handlePackageBound = React.useCallback(
    (pkg: string) => {
      if (!pkg || editPackageId || product !== 'build' || !activeAgentRoute) return;
      if (scope !== product || conversationScope !== scope || !conversationId) return;
      rekeyScope(chatConversationScope({ appId: pkg, product }));
      onTargetChange?.({ agent: activeAgentRoute, conversationId, packageId: pkg });
    },
    [editPackageId, product, activeAgentRoute, scope, conversationScope, conversationId, rekeyScope, onTargetChange],
  );

  const pendingFirstMessageRef = React.useRef<PendingFirstMessage | null>(null);
  const [pendingFirstMessageSeq, setPendingFirstMessageSeq] = React.useState(0);
  // ADR-0057 P4 — seed a handed-off build prompt as the build thread's first
  // message, once per handoff; the pane's deferred-send replay sends it when
  // the id lands. Targeted at the build agent (#2450), so a pane still bound to
  // the previous agent mid-switch never consumes it.
  const seededHandoffRef = React.useRef(0);
  React.useEffect(() => {
    const prompt = handoff?.state.handoffPrompt;
    if (!handoff || !prompt || seededHandoffRef.current === handoff.seq) return;
    seededHandoffRef.current = handoff.seq;
    pendingFirstMessageRef.current = { content: prompt, targetAgentRoute: 'build' };
    setPendingFirstMessageSeq((s) => s + 1);
  }, [handoff]);
  // ADR-0028 — the composer's picked model, held here so it outlives the keyed
  // pane's remount when the first send mints the conversation.
  const [selectedModelId, setSelectedModelId] = React.useState<string | undefined>(undefined);

  // ── The drawer's own controls over its thread ───────────────────────────
  // The launcher, the app switcher and the handoff in the pane open targets
  // through the host. Picking the agent the ambient thread already runs goes
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
    onTargetChange?.({ agent: activeAgentRoute, packageId: editPackageId, fresh: true });
    onHistoryOpenChange?.(false);
  }, [onTargetChange, activeAgentRoute, editPackageId, onHistoryOpenChange]);
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

  // Share and the Build Doctor, which the pane's header offers.
  const [shareOpen, setShareOpen] = React.useState(false);
  const [debugOpen, setDebugOpen] = React.useState(false);
  const restApiBase = React.useMemo(
    () => apiBase.replace(/\/v1\/ai$/, '').replace(/\/ai$/, '') || '/api',
    [apiBase],
  );
  const publicShareBase = React.useMemo(() => resolvePublicShareBase(), []);
  const showDebug = agentHasCapability(agents, activeAgent, 'debug');

  // OSS / no AI seat → the whole dock body is inert (the robot is gated too).
  if (!isLoading && agents.length === 0) return null;

  const history = (
    <ConversationsSidebar
      userId={userId}
      apiBase={apiBase}
      activeAgent={activeAgent}
      includeAskConversations={makerConverged}
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
            editPackageId={editPackageId}
            onPackageBound={handlePackageBound}
            canBind={Boolean(paneConversationId)}
            parentHandoffConversationId={handoff?.state.parentConversationId}
            // objectstack#30043 — the app the dock sits in is the selected app,
            // whichever agent runs and whether or not a build thread binds to it.
            activeAppPackageId={appPackageId}
            surfaceContext={surfaceContext}
            surfaceArtifactLabel={surfaceArtifactLabel}
            initialMessages={paneInitialMessages}
            pendingFirstMessageRef={pendingFirstMessageRef}
            pendingFirstMessageSeq={pendingFirstMessageSeq}
            ensureConversation={ensureConversation}
            conversationCreateError={createError}
            selectedModelId={selectedModelId}
            onSelectedModelChange={setSelectedModelId}
            onSent={handleSent}
            onShare={() => setShareOpen(true)}
            onDebug={() => setDebugOpen(true)}
            showDebug={showDebug}
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
      {conversationId && showDebug ? (
        <BuildDebugDrawer
          apiBase={apiBase}
          conversationId={conversationId}
          open={debugOpen}
          onOpenChange={setDebugOpen}
        />
      ) : null}
    </ChatDockControlProvider>
  );
}
