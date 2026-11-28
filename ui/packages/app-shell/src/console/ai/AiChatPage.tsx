// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AiChatPage — full-page ChatGPT-style AI surface.
 *
 * Mounted at `/ai` (new chat) and `/ai/:conversationId` (resume an existing
 * conversation). Left rail lists the signed-in user's `ai_conversations`;
 * right pane embeds `ChatbotEnhanced` wired to
 * `POST /api/v1/ai/agents/:name/chat`.
 *
 * Auto-persist is handled server-side in `@objectstack/service-ai`: as long
 * as the request body carries `conversationId`, the user + assistant + tool
 * turns are appended to `ai_messages` automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { CONSOLE_FULL_HEIGHT } from '../../layout/chromeBannerHost.js';
import { resolvePublicShareBase } from '../organizations/resolveHomeUrl.js';
import {
  Button,
  ShareDialog,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@object-ui/components';
import { PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
// The side-effect-free names come through `/core` like every other app-shell
// import of them, so a test stubs each in one place (objectui#13410).
import {
  useAgents,
  resolveDefaultAgentName,
  PLATFORM_DEFAULT_AGENT,
  agentRouteName,
  resolveAgentParam,
  isBuiltinAgentName,
} from '@object-ui/plugin-chatbot/core';

import { AppHeader } from '../../layout/AppHeader.js';
import { CONSOLE_TOP_BAR } from '../../layout/consoleTopBar.js';
import { armChatDockExpanded, readDockReturnLocation } from '../../layout/chatDockState.js';
import { useConversationFocus } from '../../layout/chatFocus.js';
import { useAdvertiseShortcut } from '../../chrome/advertisedShortcuts.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { useNavigationContext } from '../../context/NavigationContext.js';
import {
  fetchConversation,
  useChatConversation,
  type HydratedUIMessage,
} from '../../hooks/useChatConversation.js';
import { chatConversationScope, chatProductOfAgent } from '../../hooks/chatScope.js';
import { ConversationsSidebar } from './ConversationsSidebar.js';
import { resolveApiBase } from './resolveApiBase.js';
import { AiUnavailable } from './AiUnavailable.js';
import { ChatPane } from './ChatPane.js';
import { firstUserMessageText } from './aiChatHydration.js';
import {
  useCollapsibleChatsList,
  matchAiChatShortcut,
  NEW_CHAT_SHORTCUT,
  TOGGLE_CHATS_LIST_SHORTCUT,
  resolveCollapseToDockTarget,
} from './aiChatChrome.js';
import type { PendingFirstMessage } from './useDeferredFirstSend.js';

// objectstack#37730 — split out of this file move-only; re-exported by name so
// every import path that named this module keeps resolving.
export { ChatPane } from './ChatPane.js';
export { listLinkTarget, recordOpenTarget } from './aiChatLinks.js';
export { hydratedMessagesToChatMessages } from './aiChatHydration.js';
export { agentEmptyState, buildAgentSuggestions } from './agentCopy.js';
export {
  useCollapsibleChatsList,
  matchAiChatShortcut,
  NEW_CHAT_SHORTCUT,
  TOGGLE_CHATS_LIST_SHORTCUT,
  resolveCollapseToDockTarget,
} from './aiChatChrome.js';
export type { CollapsibleChatsList, AiChatShortcut } from './aiChatChrome.js';
export { useDeferredFirstSend, useComposerDraftHandoff } from './useDeferredFirstSend.js';
export type { PendingFirstMessage } from './useDeferredFirstSend.js';

// Lives in `./resolveApiBase` so the eagerly loaded dock chrome can call it
// without importing this module (objectui#13410); re-exported unchanged.
export { resolveApiBase };

export interface AiChatPageProps {
  /** Override the resolved AI service base URL. */
  apiBase?: string;
  /** Default agent to select on first render. */
  defaultAgent?: string;
}

/** Stable empty array for the stale-scope window (#2450) — a fresh `[]` per
 *  render would churn the pane's `initialMessages` identity for no reason. */
const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

// objectui#12493 — the ADR-0057 P4 Builder handoff travels as navigation state
// (or an in-memory drawer call), never in a URL: `BuilderHandoffState` and its
// reader live with the drawer's target grammar (objectstack#34608).

export function AiChatPage({ apiBase: apiBaseProp, defaultAgent: defaultAgentProp }: AiChatPageProps = {}) {
  const { user } = useAuth();
  const { t } = useObjectTranslation();
  const userId = user?.id;
  // The agent is BAKED INTO THE ROUTE now: `/ai/:agent[/:conversationId]`.
  // Deriving it from the path param (resolved against the live catalog) removes
  // the old `?agent=` query snapshot, which StrictMode's double-mount + the
  // `/ai`→`/ai/:id` URL rewrite used to drop (the metadata_assistant deep-link
  // bug). The dropdown is now a launcher that navigates between these routes.
  const { agent: agentSegment, conversationId: urlConversationId } =
    useParams<{ agent?: string; conversationId?: string }>();
  const [searchParams] = useSearchParams();
  const searchString = searchParams.toString();
  // Explicit new-conversation intent (`?new=1`, the sidebar's New button).
  // Read LIVE (not snapshotted): the button can be clicked again later from an
  // existing conversation, and the flag is stripped once the fresh id is
  // mirrored into the URL.
  const forceNewConversation = searchParams.get('new') !== null;
  const navigate = useNavigate();
  // objectui#7373 — both exits out of this page (the "no agent here" screen's
  // Home button, and the collapse-to-dock landing on a cold deep link) follow
  // the DECLARED landing. Undeclared deployments get the launcher, unchanged.
  const homePath = useHomePath();
  const { setContext } = useNavigationContext();

  useEffect(() => {
    setContext('home');
  }, [setContext]);

  const apiBase = useMemo(() => resolveApiBase(apiBaseProp), [apiBaseProp]);
  const env = (import.meta as any).env ?? {};
  const envDefaultAgent = env.VITE_AI_DEFAULT_AGENT as string | undefined;

  const { agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } =
    useAgents({ apiBase });
  const catalogNames = useMemo(() => agents.map((a) => a.name), [agents]);
  // Catalog resolved with no agent to talk to. The `/ai` route guard already
  // shows `AiUnavailable` itself when the runtime serves no agent (Community
  // Edition), so this is the secondary safety net: a deployment that reports AI enabled but serves
  // no agent (misconfig), a transient `/agents` failure, or a `VITE_AI_BASE_URL`
  // server that returns an empty list. Either way, degrade to a graceful state
  // instead of the agent-less echo chat (autoResponse) that ChatPane falls into.
  const noAgents = !agentsLoading && agents.length === 0;

  // Is the first path segment an agent? It is when it resolves to one (friendly
  // alias / new id / legacy id). When it doesn't, it's a legacy bare
  // `/ai/:conversationId` link (redirected below). `undefined` = catalog still
  // loading, so we can't tell yet and redirects must wait.
  const segmentIsAgent = useMemo<boolean | undefined>(() => {
    if (!agentSegment) return false;
    if (agents.length === 0) return undefined;
    return resolveAgentParam(agentSegment, catalogNames) !== undefined;
  }, [agentSegment, agents.length, catalogNames]);

  // Back-compat: the legacy deep-link `/ai?agent=metadata_assistant` (only
  // meaningful on a bare `/ai`, before the agent moved into the path). Honored
  // here, then stripped as the route is canonicalized to `/ai/:agent`.
  const legacyAgentParam = !agentSegment ? searchParams.get('agent') ?? undefined : undefined;

  // App/platform default — used for a bare `/ai` (respecting the legacy
  // `?agent=`), and as the endpoint while a legacy bare-id link is being
  // redirected to its real agent surface.
  const fallbackAgent = useMemo(
    () => resolveDefaultAgentName(agents, legacyAgentParam ?? defaultAgentProp ?? envDefaultAgent),
    [agents, legacyAgentParam, defaultAgentProp, envDefaultAgent],
  );

  // Resolved backend agent name for this surface (route agent wins; else default).
  const activeAgent = useMemo(() => {
    if (agents.length === 0) return undefined;
    if (agentSegment && segmentIsAgent) {
      return resolveAgentParam(agentSegment, catalogNames);
    }
    return fallbackAgent;
  }, [agents.length, agentSegment, segmentIsAgent, catalogNames, fallbackAgent]);
  const activeAgentRoute = activeAgent ? agentRouteName(activeAgent) : undefined;

  // A KNOWN built-in agent (build/ask/…) that the live catalog doesn't serve —
  // e.g. `/ai/build` on a deployment without the cloud AI Studio plugin. It's
  // an unavailable AGENT, not a conversation id, so we fall back to the default
  // surface instead of treating "build" as a chat to load.
  const unavailableKnownAgent = Boolean(
    agentSegment && segmentIsAgent === false && isBuiltinAgentName(agentSegment),
  );

  // A first segment that ISN'T an agent and ISN'T a known (unavailable) agent
  // name is a legacy bare conversation id.
  const legacyConversationId =
    agentSegment && segmentIsAgent === false && !unavailableKnownAgent ? agentSegment : undefined;

  const chatApi = activeAgent
    ? `${apiBase}/agents/${encodeURIComponent(activeAgent)}/chat`
    : undefined;

  // ADR-0057: key the conversation on `(user, app, product)`, not on surface.
  // The full page names no app, so its scope is the product alone.
  // `undefined` while the agent is still resolving.
  const chatScope = activeAgent
    ? chatConversationScope({ product: chatProductOfAgent(activeAgent) })
    : undefined;

  // The user the conversation resolves for (none until the agent is known).
  const conversationUserId = activeAgent ? userId : undefined;
  const {
    conversationId,
    conversationScope,
    initialMessages,
    ensureConversation,
    createError: conversationCreateError,
    conversationMetadata,
    createdConversationId,
  } = useChatConversation({
    // Gate resolution on the agent being known: resolving while `activeAgent`
    // is still undefined (catalog loading) would bind a SCOPELESS conversation
    // that the per-(user,scope) guard then sticks with — so the agent surface
    // would resume some other agent's last chat. Waiting one tick keys the
    // conversation to the right scope from the first resolve.
    userId: conversationUserId,
    scope: chatScope,
    apiBase,
    activeId: urlConversationId ?? legacyConversationId,
    forceNew: forceNewConversation,
  });

  // #2450 — feed <ChatPane> ONLY a scope-matched conversation. Right after a
  // launcher switch between agents, `conversationId` still holds the OLD
  // scope's id until the hook re-resolves — the same stale window the
  // URL-mirror below already guards. A pane mounted on that stale id is DOOMED
  // (it remounts the moment the id re-resolves), and the deferred first-send
  // replay could consume the held first message into it, where the send dies with
  // the unmount before reaching the wire (the observed zero-POST). Handing the
  // pane `undefined` during the window makes it mount as `…:pending`, hold the
  // stash, and replay exactly once in the correctly-scoped pane.
  const scopeMatched = conversationScope === chatScope;
  const paneConversationId = scopeMatched ? conversationId : undefined;
  const paneInitialMessages = scopeMatched ? initialMessages : EMPTY_INITIAL_MESSAGES;

  // Holds an empty-state first message submitted before the conversation id was
  // minted. Owned by the PAGE (not the keyed <ChatPane>) so it survives the
  // remount that the id-resolution triggers; the freshly-mounted pane replays it
  // via useDeferredFirstSend. See that hook for the full race.
  const pendingFirstMessageRef = useRef<PendingFirstMessage | null>(null);
  // ADR-0028 — the composer's picked model, owned by the PAGE for the same
  // reason: it must survive the keyed <ChatPane> remount, or the pane that
  // replays the first message sends (and shows) the default instead.
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  // objectstack#36999 — the conversation's focus, held here for the same
  // reason: the keyed pane remounts when the first send mints the id, and that
  // first turn must still carry the conversation's record. This page shows no
  // record of its own, so a new conversation here has none (ADR-0160 D6,
  // seventh amendment); one opened from history restores its own from this
  // tab or from its row's metadata (objectstack#37861).
  const conversationFocus = useConversationFocus(
    paneConversationId,
    conversationCreateError,
    null,
    scopeMatched ? conversationMetadata : undefined,
    undefined,
    createdConversationId,
  );
  // A first send creates the conversation: the id its create mints takes the
  // focus the conversation had at that send (and no other arriving id does).
  const { markSending: markFocusSending } = conversationFocus;
  const ensureConversationForSend = useCallback(() => {
    // With no user there is nothing to create: no mark, so no id that
    // arrives later takes the focus as this send's.
    if (conversationUserId) markFocusSending();
    return ensureConversation();
  }, [conversationUserId, markFocusSending, ensureConversation]);
  // ── Route canonicalization ──────────────────────────────────────────────
  // Back-compat redirects (the agent is now in the path): bare `/ai` → the
  // default agent surface (or the `?agent=` deep-link target); a legacy built-in
  // id in the agent slot → its friendly form. Custom agents already route by their own name and no-op here.
  // The `?new=1` intent is preserved; the consumed legacy `agent` param is
  // stripped so it doesn't linger in the canonical URL.
  useEffect(() => {
    if (agents.length === 0 || !activeAgent) return;
    const friendly = agentRouteName(activeAgent);
    const preserved = new URLSearchParams(searchString);
    preserved.delete('agent');
    const preservedQuery = preserved.toString() ? `?${preserved.toString()}` : '';
    if (!agentSegment) {
      navigate(`/ai/${friendly}${preservedQuery}`, { replace: true });
      return;
    }
    // A known agent that isn't deployed here (e.g. `/ai/build` with no cloud AI
    // Studio): land cleanly on the default surface rather than treating the
    // segment as a conversation id (which produced the junk `/ai/ask/build`).
    // objectstack#36969 — a conversation the address names comes along
    // (`/ai/build/ID` → `/ai/ask/ID`): where in-app building is closed the
    // build agent leaves the catalog, and its old threads must still open.
    if (unavailableKnownAgent) {
      const tail = urlConversationId ? `/${encodeURIComponent(urlConversationId)}` : '';
      navigate(`/ai/${friendly}${tail}${preservedQuery}`, { replace: true });
      return;
    }
    if (segmentIsAgent && agentSegment !== friendly) {
      const tail = urlConversationId ? `/${encodeURIComponent(urlConversationId)}` : '';
      navigate(`/ai/${friendly}${tail}${preservedQuery}`, { replace: true });
    }
  }, [agents.length, activeAgent, agentSegment, segmentIsAgent, unavailableKnownAgent, urlConversationId, searchString, navigate]);

  // ── Legacy `/ai/:conversationId` (bare id) ──────────────────────────────
  // Resolve the conversation's own agent and 301 to `/ai/:agent/:conversationId`
  // so old bookmarks keep working under the agent-scoped routes.
  useEffect(() => {
    if (legacyConversationId === undefined) return;
    let cancelled = false;
    (async () => {
      let convAgent: string | undefined;
      try {
        const conv = await fetchConversation(apiBase, legacyConversationId);
        convAgent = (conv as { agentId?: string } | null)?.agentId ?? undefined;
      } catch {
        /* gone / inaccessible — fall back to the default surface below */
      }
      if (cancelled) return;
      const resolved = resolveAgentParam(convAgent ?? '', catalogNames);
      const friendly = agentRouteName(resolved ?? activeAgent ?? PLATFORM_DEFAULT_AGENT);
      navigate(`/ai/${friendly}/${encodeURIComponent(legacyConversationId)}`, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [legacyConversationId, apiBase, catalogNames, activeAgent, navigate]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [titleHints, setTitleHints] = useState<Record<string, string>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);
  const { collapsed: chatsCollapsed, toggle: toggleChatsCollapsed } = useCollapsibleChatsList();
  // Keyboard shortcuts (ChatGPT/Claude parity): ⌘⇧O new chat, ⌘⇧S toggle list.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = matchAiChatShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'toggle-list') toggleChatsCollapsed();
      else navigate(activeAgentRoute ? `/ai/${activeAgentRoute}?new=1` : '/ai?new=1');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleChatsCollapsed, navigate, activeAgentRoute]);
  useAdvertiseShortcut(NEW_CHAT_SHORTCUT);
  useAdvertiseShortcut(TOGGLE_CHATS_LIST_SHORTCUT);
  const restApiBase = useMemo(
    () => apiBase.replace(/\/v1\/ai$/, '').replace(/\/ai$/, '') || '/api',
    [apiBase],
  );

  // Public share-link landing base. SharedRecordPage lives UNDER the console
  // SPA basename (e.g. `/_console/s/:token`), so the ShareDialog default of
  // `${origin}/s/:token` 404s for recipients. The mount comes from the one
  // console-mount resolver, which reads the injected `<base href>` — this used
  // to be a third hand-rolled copy of that resolution (objectui#4482).
  const publicShareBase = useMemo(() => resolvePublicShareBase(), []);

  // New-conversation race guard. On an IN-SPA `/ai?new=1` navigation the
  // URL-mirroring effect below fires in the SAME commit as the hook's effect,
  // with this render's (stale) `conversationId` still in its closure — the
  // hook's setConversationId(undefined) hasn't re-rendered yet. Unguarded, it
  // bounced straight back to `/ai/:oldId` and stripped the flag before the
  // fresh conversation existed (the New button looked like a no-op; a full
  // page load on the same URL worked because state starts empty). Snapshot
  // the id visible when the flag appears — a RENDER-phase ref write, so it's
  // set before any effect of this commit runs — and refuse to mirror that
  // exact id while the flag is up. The fresh id differs, mirrors normally,
  // and the navigation strips `?new=1`, which resets the snapshot.
  const staleNewTargetRef = useRef<{ id: string | undefined } | null>(null);
  if (forceNewConversation) {
    if (staleNewTargetRef.current === null) staleNewTargetRef.current = { id: conversationId };
  } else {
    staleNewTargetRef.current = null;
  }

  // After the hook resolves a real id for a fresh agent-surface visit, mirror
  // it into the URL (`/ai/:agent/:id`) so the sidebar's active-row + share +
  // refresh all work. Only fires on a real agent surface that has no id yet —
  // not while a bare `/ai` or a legacy bare id is still being redirected.
  useEffect(() => {
    if (!segmentIsAgent || urlConversationId || !conversationId || !activeAgentRoute) return;
    if (staleNewTargetRef.current && staleNewTargetRef.current.id === conversationId) return;
    // Don't mirror a conversation that belongs to the PREVIOUS scope: right
    // after a launcher switch, `conversationId` still holds the old scope's id
    // until the hook re-resolves under the new one. Mirroring it would write
    // it onto the new agent's URL and resume the wrong chat.
    if (conversationScope !== chatScope) return;
    // The consumed `agent`/`new` params are stripped by the rewrite.
    navigate(`/ai/${activeAgentRoute}/${conversationId}`, { replace: true });
  }, [segmentIsAgent, urlConversationId, conversationId, conversationScope, chatScope, activeAgentRoute, navigate]);

  const titledRef = useRef<Set<string>>(new Set());

  // A resumed conversation already has history; treat it as already-titled
  // so we don't clobber the original title on the next user turn.
  useEffect(() => {
    if (conversationId && initialMessages.length > 0) {
      titledRef.current.add(conversationId);
    }
  }, [conversationId, initialMessages.length]);

  useEffect(() => {
    if (!conversationId) return;
    const hint = firstUserMessageText(initialMessages);
    if (!hint) return;
    setTitleHints((current) =>
      current[conversationId] === hint ? current : { ...current, [conversationId]: hint },
    );
  }, [conversationId, initialMessages]);

  const handleSent = useCallback(
    (firstUserMessage?: string) => {
      // New user turn → bump sidebar list so the row's preview/timestamp refreshes.
      setRefreshKey((k) => k + 1);
      if (firstUserMessage && conversationId) {
        setTitleHints((current) => ({ ...current, [conversationId]: firstUserMessage }));
      }

      // Server now generates a concise LLM-summarised title fire-and-forget
      // after the first assistant turn lands (see service-ai
      // `summarizeConversation`). We don't PATCH a truncated preview from the
      // client anymore — that races the LLM and wins, which would block the
      // real title. Instead, bump the sidebar a couple of times so the new
      // title is picked up whenever the model finally responds.
      if (!firstUserMessage || !conversationId) return;
      if (titledRef.current.has(conversationId)) return;
      titledRef.current.add(conversationId);
      const bump = () => setRefreshKey((k) => k + 1);
      const t1 = setTimeout(bump, 2500);
      const t2 = setTimeout(bump, 6000);
      // Best-effort: if the component unmounts before the bumps fire, the
      // setRefreshKey call is a no-op so we don't bother tracking the timers.
      void t1;
      void t2;
    },
    [conversationId],
  );

  return (
    <div className={cn('flex w-full flex-col bg-background', CONSOLE_FULL_HEIGHT.svh)} data-testid="ai-chat-page">
      <header className={cn(CONSOLE_TOP_BAR, 'bg-background/95 backdrop-blur')}>
        {/* Mobile: open the chats list as a sheet. The DESKTOP collapse toggle
            is NOT in the top nav — it lives at the bottom-left of the chats
            column (see below), mirroring the app shell's sidebar toggle. Chat
            controls are meaningless with no agent, so hide in that state. */}
        {!noAgents && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 md:hidden"
            onClick={() => setMobileChatsOpen(true)}
            aria-label={t('console.ai.openChats')}
            data-testid="ai-chat-mobile-sidebar-trigger"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <AppHeader variant="home" />
        </div>
        {/* ADR-0057 P3c — "/ai = the ChatDock maximized": tuck this full-page
            surface back into the dock. Arms the dock to mount expanded, then
            returns to the exact page the user maximized from (remembered by
            the dock's own maximize handlers; falls back to history-back, then
            the declared home on a cold deep link) — the dock resolves the same
            (user, product) conversation scope, so it shows THE SAME THREAD.
            Visible on mobile too: under `md` the dock presents as a bottom
            sheet. */}
        {!noAgents && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            data-testid="ai-chat-collapse-to-dock"
            aria-label={t('console.ai.collapseToDock', { defaultValue: 'Collapse to side panel' })}
            title={t('console.ai.collapseToDock', { defaultValue: 'Collapse to side panel' })}
            onClick={() => {
              armChatDockExpanded();
              const target = resolveCollapseToDockTarget(
                (window.history.state as { idx?: unknown } | null)?.idx,
                readDockReturnLocation(),
                homePath,
              );
              if (target === -1) navigate(-1);
              else navigate(target);
            }}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        )}
      </header>
      {noAgents ? (
        <AiUnavailable
          hasError={Boolean(agentsError)}
          onRetry={refetchAgents}
          onHome={() => navigate(homePath)}
          t={t}
        />
      ) : (
      <>
      <Sheet open={mobileChatsOpen} onOpenChange={setMobileChatsOpen}>
        <SheetContent side="left" className="w-[320px] p-0 sm:max-w-[360px]" data-testid="ai-chat-mobile-sidebar">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('console.ai.chats')}</SheetTitle>
            <SheetDescription>{t('console.ai.chatsDescription')}</SheetDescription>
          </SheetHeader>
          <ConversationsSidebar
            userId={userId}
            apiBase={apiBase}
            activeAgent={activeAgent}
            refreshKey={refreshKey}
            titleHints={titleHints}
            className="h-full border-r-0"
            onNavigate={() => setMobileChatsOpen(false)}
          />
        </SheetContent>
      </Sheet>
      {conversationId && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          objectName="ai_conversations"
          recordId={conversationId}
          recordLabel="this conversation"
          apiBase={restApiBase}
          publicBaseUrl={publicShareBase}
        />
      )}
      {/* Uniform `bg-background` across the chat area: the centered chat column
          is `bg-background`, so a `bg-muted` backdrop here produced a hard
          seam between the column and its side gutters (read as accidental). The
          conversations sidebar keeps its own `bg-muted/30` for hierarchy. */}
      <div className="flex min-h-0 flex-1 w-full bg-background">
        {/* Desktop chats column. The collapse/expand control sits at the
            BOTTOM-LEFT (mirroring the app shell's sidebar toggle) rather than
            intruding into the top navigation bar. Collapsed → a slim rail with
            just the expand button; expanded → the list with the toggle in a
            footer. */}
        <div className="hidden shrink-0 flex-col border-r md:flex">
          {!chatsCollapsed && (
            <ConversationsSidebar
              userId={userId}
              apiBase={apiBase}
              activeAgent={activeAgent}
              refreshKey={refreshKey}
              titleHints={titleHints}
              className="w-72 min-h-0 flex-1 border-r-0"
            />
          )}
          <div className={cn('mt-auto p-2', chatsCollapsed ? 'w-12' : 'w-72 border-t')}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleChatsCollapsed}
              aria-label={
                chatsCollapsed
                  ? t('console.ai.showChats', { defaultValue: 'Show chats' })
                  : t('console.ai.hideChats', { defaultValue: 'Hide chats' })
              }
              title={
                chatsCollapsed
                  ? t('console.ai.showChats', { defaultValue: 'Show chats' })
                  : t('console.ai.hideChats', { defaultValue: 'Hide chats' })
              }
              data-testid="ai-chat-collapse-sidebar-trigger"
              aria-pressed={chatsCollapsed}
            >
              {chatsCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatPane
            key={`${chatApi ?? 'local'}:${paneConversationId ?? 'pending'}`}
            agents={agents}
            agentsLoading={agentsLoading}
            agentsError={agentsError}
            activeAgent={activeAgent}
            chatApi={chatApi}
            apiBase={apiBase}
            conversationId={paneConversationId}
            requestedConversationId={urlConversationId ?? legacyConversationId}
            conversationFocus={conversationFocus}
            initialMessages={paneInitialMessages}
            pendingFirstMessageRef={pendingFirstMessageRef}
            ensureConversation={ensureConversationForSend}
            conversationCreateError={conversationCreateError}
            selectedModelId={selectedModelId}
            onSelectedModelChange={setSelectedModelId}
            onSent={handleSent}
            onShare={() => setShareOpen(true)}
          />
        </main>
      </div>
      </>
      )}
    </div>
  );
}

export default AiChatPage;
