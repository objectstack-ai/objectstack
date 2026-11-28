// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppAskPage — an app's AI inquiry page, the built-in component an app places
 * on its menu as a `type: 'component'` entry with `componentRef: 'ai:chat'`
 * (ui ADR-0057 Amendment A4).
 *
 * Home state first: the entry's welcome title and subtitle, a large question
 * box with its placeholder, and up to four suggested questions, all from the
 * entry's `params` (`AiChatNavParamsSchema`), never from the URL; a key the
 * entry omits falls back to the platform's neutral copy. The first question
 * turns the same page into the conversation: the shared `ChatPane`, pinned to
 * the platform `ask` agent (a maker gets `ask` here too), bound to this app's
 * package (`context.activeApp`) under the key `app:PKG:ask`. The create
 * records `metadata.activePackageId`, and the page's address carries
 * `?c=ID` from then on, so a reload restores it. A `?c=` naming a
 * conversation that is not the caller's, or not this app's, opens the home
 * state: no error, and nothing of it is shown. Only a definite answer does: a
 * check that fails (the network, a 5xx) keeps `?c=` and offers a retry.
 *
 * An app with no package (`_packageId`) has nowhere to keep the page's
 * conversations, so the page says so instead of drawing a question box that
 * cannot start one.
 *
 * Below the question box the home state lists this app's recent
 * conversations: of the caller's newest list page, those this page created
 * for this package (`metadata.activePackageId`), the newest few
 * (`recentAskPageConversations`). A drawer thread is never one of them. Opening one
 * writes its `?c=`, so it is restored the way a reload restores it.
 *
 * The home state is the shared empty conversation (`EmptyConversation`,
 * objectstack#37862), large, with this page's own question box in its
 * composer slot: the drawer draws the same layout. Its heading is the entry's
 * declared title, else the time-of-day greeting; the entry's suggestions send.
 *
 * The page is the one ask conversation on its screen: while it is the active
 * route the console's drawer stays closed and its triggers are hidden or inert
 * (`useConsoleChatDock`'s `askPageActive`). A build hand-off from here still
 * opens the drawer.
 *
 * Registered lazily (`services/builtinComponents.tsx`): this module statically
 * reaches the chat UI, so ⛔ nothing in the eager console graph may import it.
 */

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUp, Plus, Sparkles } from 'lucide-react';
import { useAuth } from '@object-ui/auth';
import { Badge, Button, Empty, EmptyDescription, EmptyTitle, Textarea } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveNavItemLabel } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { resolveAgentParam, useAgents } from '@object-ui/plugin-chatbot/core';
import { ChatPane, type PendingFirstMessage } from './AiChatPage.js';
import { AiUnavailable } from './AiUnavailable.js';
import { resolveApiBase } from './resolveApiBase.js';
import {
  ASK_CONVERSATION_PARAM,
  ASK_RECENT_FETCH_LIMIT,
  askPageConversationScope,
  askPageCreateMetadata,
  conversationBelongsToAskPage,
  findAiChatNavEntry,
  readAiChatPageCopy,
  recentAskPageConversations,
} from './appAskPageModel.js';
import { useChatConversation, type HydratedUIMessage } from '../../hooks/useChatConversation.js';
import { fetchConversation, type ServerConversation } from '../../hooks/useChatConversation.js';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface.js';
import { useConversationList } from '../../hooks/useConversationList.js';
import { EmptyConversation, EmptyConversationGreeting, RecentConversationList } from './EmptyConversation.js';
import { appHomeSuggestions } from './emptyConversationModel.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { matchAppBySegment } from '../../utils/appRoute.js';
import { PageHeader } from '../../layout/PageHeader.js';

const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

/**
 * What the page knows about the conversation its address names. `failed`: the
 * check could not be answered (not a 403 or 404), so it is neither. `record`:
 * the check's read of an `ours` conversation, which the thread hydrates from,
 * so opening it reads its history once.
 */
type RequestedVerdict = {
  id: string;
  verdict: 'checking' | 'ours' | 'foreign' | 'failed';
  record?: ServerConversation;
};

export function AppAskPage() {
  const { t, language } = useObjectTranslation();
  const navigate = useNavigate();
  const homePath = useHomePath();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id;

  // ── The app, its `ai:chat` entry and the entry's copy ───────────────────
  const metadata = useMetadata();
  const { currentAppName } = useNavigationContext();
  const routeParams = useParams();
  const app = matchAppBySegment(
    (metadata.apps ?? []) as Array<Record<string, unknown>>,
    currentAppName || routeParams.appName,
  );
  const packageId = typeof app?._packageId === 'string' ? app._packageId : undefined;
  const entry = React.useMemo(() => findAiChatNavEntry(app), [app]);
  const copy = React.useMemo(() => readAiChatPageCopy(entry), [entry]);
  const pageLabel = entry ? resolveNavItemLabel(entry as unknown as NavigationItem, t, undefined, language) : '';
  // The page header's name when the entry has no label: the declared title,
  // else the neutral one. The home state's heading greets instead (below).
  const title = copy.title ?? t('console.ai.empty.ask.title', { defaultValue: 'Ask your data' });
  const subtitle = copy.subtitle ?? t('console.ai.empty.ask.description', {
      defaultValue:
        'Ask questions about your records — counts, lists, and summaries across the data you can access.',
    });
  const placeholder = copy.placeholder ?? t('console.ai.askAnything', { defaultValue: 'Ask anything…' });

  // ── The agent: always the platform `ask` ────────────────────────────────
  const apiBase = React.useMemo(() => resolveApiBase(), []);
  const surface = useAiSurfaceEnabled();
  const { agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents({ apiBase });
  const catalogNames = React.useMemo(() => agents.map((a) => a.name), [agents]);
  const askAgent = agents.length > 0 ? resolveAgentParam('ask', catalogNames) : undefined;
  const chatApi = askAgent ? `${apiBase}/agents/${encodeURIComponent(askAgent)}/chat` : undefined;
  const unavailable = !surface.isLoading && !surface.enabled && !agentsLoading;

  // ── The conversation the address names (`?c=`) ──────────────────────────
  const requestedId = searchParams.get(ASK_CONVERSATION_PARAM)?.trim() || undefined;
  // Ids this page created: they are this app's by construction, so the
  // address the page writes for them is never re-checked.
  const ownIdsRef = React.useRef<Set<string>>(new Set());
  const [requested, setRequested] = React.useState<RequestedVerdict | undefined>(undefined);
  if (requestedId && requested?.id !== requestedId) {
    setRequested({ id: requestedId, verdict: ownIdsRef.current.has(requestedId) ? 'ours' : 'checking' });
  } else if (!requestedId && requested) {
    setRequested(undefined);
  }
  const checking = requested?.verdict === 'checking' ? requested.id : undefined;
  React.useEffect(() => {
    if (!checking) return;
    let cancelled = false;
    void (async () => {
      let next: RequestedVerdict = { id: checking, verdict: 'foreign' };
      if (packageId) {
        try {
          // `null` is the server's definite "gone, or not the caller's" (404, 403).
          const conversation = await fetchConversation(apiBase, checking);
          if (conversation && conversationBelongsToAskPage(conversation, packageId)) {
            next = { id: checking, verdict: 'ours', record: conversation };
          }
        } catch {
          next = { id: checking, verdict: 'failed' };
        }
      }
      if (cancelled) return;
      setRequested((prev) => (prev?.id === checking ? next : prev));
    })();
    return () => {
      cancelled = true;
    };
  }, [checking, apiBase, packageId]);
  // A foreign `?c=` leaves the address: the page opens its home state.
  const foreign = requested?.verdict === 'foreign' ? requested.id : undefined;
  React.useEffect(() => {
    if (!foreign) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get(ASK_CONVERSATION_PARAM) === foreign) next.delete(ASK_CONVERSATION_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [foreign, setSearchParams]);
  const activeId = requested?.verdict === 'ours' ? requested.id : undefined;
  const restoreFailed = requested?.verdict === 'failed';
  const retryRestore = React.useCallback(() => {
    setRequested((prev) => (prev?.verdict === 'failed' ? { id: prev.id, verdict: 'checking' } : prev));
  }, []);

  // ── The page's thread ───────────────────────────────────────────────────
  // `started`: the first question was asked on the home state, so the pane is
  // up while its conversation is created.
  const [started, setStarted] = React.useState(false);
  const scope = packageId ? askPageConversationScope(packageId) : undefined;
  const createMetadata = React.useMemo(
    () => (packageId ? askPageCreateMetadata(packageId) : undefined),
    [packageId],
  );
  const {
    conversationId,
    conversationScope,
    initialMessages,
    isLoading: conversationLoading,
    ensureConversation,
    createError,
  } = useChatConversation({
    userId: askAgent && scope ? userId : undefined,
    scope,
    apiBase,
    activeId,
    activeRecord: requested?.verdict === 'ours' ? requested.record : undefined,
    // The home state is a new question: never the last cached thread.
    forceNew: !activeId,
    createMetadata,
  });
  const scopeMatched = conversationScope === scope;
  const paneConversationId = scopeMatched ? conversationId : undefined;
  const paneInitialMessages = scopeMatched ? initialMessages : EMPTY_INITIAL_MESSAGES;

  // The first send created the conversation: the address names it from now on.
  React.useEffect(() => {
    if (!started || !paneConversationId || requestedId === paneConversationId) return;
    ownIdsRef.current.add(paneConversationId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(ASK_CONVERSATION_PARAM, paneConversationId);
        return next;
      },
      { replace: true },
    );
  }, [started, paneConversationId, requestedId, setSearchParams]);

  const pendingFirstMessageRef = React.useRef<PendingFirstMessage | null>(null);
  const [selectedModelId, setSelectedModelId] = React.useState<string | undefined>(undefined);
  const ask = React.useCallback((text: string) => {
    const content = text.trim();
    if (!content) return;
    pendingFirstMessageRef.current = { content };
    setStarted(true);
  }, []);
  const startOver = React.useCallback(() => {
    pendingFirstMessageRef.current = null;
    setStarted(false);
    setSelectedModelId(undefined);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(ASK_CONVERSATION_PARAM);
        return next;
      },
    );
  }, [setSearchParams]);
  // A recent conversation opens through its `?c=`: the restore path above
  // judges it like any other address.
  const openRecent = React.useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(ASK_CONVERSATION_PARAM, id);
        return next;
      });
    },
    [setSearchParams],
  );

  // ── What the page draws ─────────────────────────────────────────────────
  const restoring = Boolean(checking) || (Boolean(activeId) && !started && conversationLoading);
  const inConversation = started || Boolean(activeId);
  let body: React.ReactNode;
  if (unavailable || (!surface.isLoading && surface.enabled && !agentsLoading && !askAgent)) {
    body = (
      <AiUnavailable
        hasError={Boolean(agentsError)}
        onRetry={refetchAgents}
        onHome={() => navigate(homePath)}
        t={t}
      />
    );
  } else if (!surface.isLoading && !packageId) {
    body = (
      <AskNotice
        title={t('console.ai.askPage.noPackageTitle', { defaultValue: "This app can't keep conversations here" })}
        description={t('console.ai.askPage.noPackageDescription', {
          defaultValue: "This page keeps its conversations with the app's package, and this app isn't part of one.",
        })}
        testId="app-ask-page-no-package"
      />
    );
  } else if (surface.isLoading || restoring) {
    body = <div className="flex-1" data-testid="app-ask-page-loading" aria-busy="true" />;
  } else if (restoreFailed) {
    body = (
      <AskNotice
        title={t('console.ai.askPage.restoreFailedTitle', { defaultValue: "Couldn't open this conversation" })}
        description={t('console.ai.askPage.restoreFailedDescription', {
          defaultValue: "It couldn't be read just now. Try again, or ask a new question.",
        })}
        testId="app-ask-page-restore-failed"
      >
        <Button variant="outline" onClick={retryRestore} data-testid="app-ask-page-restore-retry">
          {t('console.ai.askPage.restoreRetry', { defaultValue: 'Try again' })}
        </Button>
        <Button variant="ghost" onClick={startOver} data-testid="app-ask-page-restore-new">
          {t('console.ai.newConversation', { defaultValue: 'New conversation' })}
        </Button>
      </AskNotice>
    );
  } else if (inConversation) {
    body = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="app-ask-page-conversation">
        <ChatPane
          key={`${chatApi ?? 'local'}:${paneConversationId ?? 'pending'}`}
          agents={agents}
          agentsLoading={agentsLoading}
          agentsError={agentsError}
          activeAgent={askAgent}
          chatApi={chatApi}
          apiBase={apiBase}
          conversationId={paneConversationId}
          requestedConversationId={activeId}
          activeAppPackageId={packageId}
          initialMessages={paneInitialMessages}
          pendingFirstMessageRef={pendingFirstMessageRef}
          ensureConversation={ensureConversation}
          conversationCreateError={createError}
          selectedModelId={selectedModelId}
          onSelectedModelChange={setSelectedModelId}
          onSent={noop}
          onShare={noop}
          hideHeader
        />
      </div>
    );
  } else {
    body = (
      <AskHome
        heading={copy.title ?? <EmptyConversationGreeting />}
        subtitle={subtitle}
        placeholder={placeholder}
        suggestions={copy.suggestions}
        scopeLabel={t('console.ai.askPage.scopeBadge', { defaultValue: 'Answers prefer this app' })}
        sendLabel={t('console.ai.submit', { defaultValue: 'Submit' })}
        onAsk={ask}
        recent={
          packageId && userId ? (
            <RecentAskConversations userId={userId} apiBase={apiBase} packageId={packageId} onOpen={openRecent} />
          ) : null
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="app-ask-page">
      <PageHeader
        posture="list"
        title={pageLabel || title}
        icon={<Sparkles className="h-4 w-4" />}
        actions={
          inConversation && !unavailable ? (
            <Button variant="outline" size="sm" onClick={startOver} data-testid="app-ask-page-new">
              <Plus className="mr-1 h-4 w-4" />
              {t('console.ai.newConversation', { defaultValue: 'New conversation' })}
            </Button>
          ) : undefined
        }
      />
      {body}
    </div>
  );
}

function noop() {}

/** A state the page explains in place of its question box: a title, a sentence, and its ways on. */
function AskNotice({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6" data-testid={testId}>
      <Empty>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        {children ? <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">{children}</div> : null}
      </Empty>
    </div>
  );
}

interface AskHomeProps {
  heading: React.ReactNode;
  subtitle: string;
  placeholder: string;
  suggestions: string[];
  scopeLabel: string;
  sendLabel: string;
  onAsk: (text: string) => void;
  /** The recent-conversations section, drawn below the suggestions. */
  recent?: React.ReactNode;
}

/**
 * The home state: the shared empty conversation, large, with this page's
 * question box in its composer slot. The entry's suggestions send.
 */
function AskHome({ heading, subtitle, placeholder, suggestions, scopeLabel, sendLabel, onAsk, recent }: AskHomeProps) {
  const [text, setText] = React.useState('');
  const submit = () => {
    if (text.trim()) onAsk(text);
  };
  const homeSuggestions = React.useMemo(() => appHomeSuggestions(suggestions), [suggestions]);
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto" data-testid="app-ask-home">
      <EmptyConversation
        size="large"
        heading={heading}
        subtitle={subtitle}
        suggestions={homeSuggestions}
        onSuggestion={(suggestion) => onAsk(suggestion.text)}
        recent={recent}
        composer={
          <form
            className="w-full rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              rows={3}
              className="min-h-24 resize-none border-0 bg-transparent p-1 text-base shadow-none focus-visible:ring-0"
              data-testid="app-ask-input"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge variant="secondary" className="font-normal" data-testid="app-ask-scope">
                {scopeLabel}
              </Badge>
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 rounded-full"
                disabled={!text.trim()}
                aria-label={sendLabel}
                data-testid="app-ask-send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </form>
        }
      />
    </div>
  );
}

interface RecentAskConversationsProps {
  userId: string;
  apiBase: string;
  packageId: string;
  onOpen: (id: string) => void;
}

/**
 * This app's recent conversations on the home state, newest first, each with
 * its title and when it was last active; an empty state when there are none.
 * Mounted with the home state, so each return to it reads the list afresh.
 */
function RecentAskConversations({ userId, apiBase, packageId, onOpen }: RecentAskConversationsProps) {
  const { t } = useObjectTranslation();
  // Only the rows listed here read their missing previews: never one detail
  // read per untitled row of the whole page.
  const { conversations, isLoading, error } = useConversationList({
    userId,
    apiBase,
    limit: ASK_RECENT_FETCH_LIMIT,
    refreshKey: packageId,
    selectBackfillRows: (rows) => recentAskPageConversations(rows, packageId),
  });
  const recent = React.useMemo(() => recentAskPageConversations(conversations, packageId), [conversations, packageId]);
  // A list that has not answered, or failed, draws nothing: never an empty state it cannot vouch for.
  if (isLoading || error) return null;
  return (
    <RecentConversationList
      size="large"
      conversations={recent}
      emptyText={t('console.ai.askPage.recentEmpty', { defaultValue: 'Questions you ask here will appear here.' })}
      onOpen={(conversation) => onOpen(conversation.id)}
    />
  );
}

export default AppAskPage;
