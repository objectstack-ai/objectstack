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
 * state: no error, and nothing of it is shown.
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
import { Badge, Button, Textarea, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveNavItemLabel, type NavigationItem } from '@object-ui/layout';
import { resolveAgentParam, useAgents } from '@object-ui/plugin-chatbot/core';
import { ChatPane, type PendingFirstMessage } from './AiChatPage.js';
import { AiUnavailable } from './AiUnavailable.js';
import { resolveApiBase } from './resolveApiBase.js';
import {
  ASK_CONVERSATION_PARAM,
  askPageConversationScope,
  askPageCreateMetadata,
  conversationBelongsToAskPage,
  findAiChatNavEntry,
  readAiChatPageCopy,
} from './appAskPageModel.js';
import { useChatConversation, type HydratedUIMessage } from '../../hooks/useChatConversation.js';
import { fetchConversation } from '../../hooks/useChatConversation.js';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { matchAppBySegment } from '../../utils/appRoute.js';
import { PageHeader } from '../../layout/PageHeader.js';

const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

/** What the page knows about the conversation its address names. */
type RequestedVerdict = { id: string; verdict: 'checking' | 'ours' | 'foreign' };

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
  const title = copy.title ?? t('console.ai.empty.ask.title');
  const subtitle = copy.subtitle ?? t('console.ai.empty.ask.description');
  const placeholder = copy.placeholder ?? t('console.ai.askAnything');

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
      let ours = false;
      if (packageId) {
        try {
          ours = conversationBelongsToAskPage(await fetchConversation(apiBase, checking), packageId);
        } catch {
          ours = false;
        }
      }
      if (cancelled) return;
      setRequested((prev) => (prev?.id === checking ? { id: checking, verdict: ours ? 'ours' : 'foreign' } : prev));
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
  } else if (surface.isLoading || restoring) {
    body = <div className="flex-1" data-testid="app-ask-page-loading" aria-busy="true" />;
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
        title={title}
        subtitle={subtitle}
        placeholder={placeholder}
        suggestions={copy.suggestions}
        scopeLabel={t('console.ai.askPage.scopeBadge')}
        sendLabel={t('console.ai.submit')}
        onAsk={ask}
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
              {t('console.ai.newConversation')}
            </Button>
          ) : undefined
        }
      />
      {body}
    </div>
  );
}

function noop() {}

interface AskHomeProps {
  title: string;
  subtitle: string;
  placeholder: string;
  suggestions: string[];
  scopeLabel: string;
  sendLabel: string;
  onAsk: (text: string) => void;
}

/** The home state: the welcome, the large question box and the suggested questions. */
function AskHome({ title, subtitle, placeholder, suggestions, scopeLabel, sendLabel, onAsk }: AskHomeProps) {
  const [text, setText] = React.useState('');
  const submit = () => {
    if (text.trim()) onAsk(text);
  };
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10 sm:py-16" data-testid="app-ask-home">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="app-ask-title">
            {title}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground sm:text-base" data-testid="app-ask-subtitle">
            {subtitle}
          </p>
        </div>
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
        {suggestions.length > 0 ? (
          <div className={cn('grid w-full gap-2', suggestions.length > 1 && 'sm:grid-cols-2')} data-testid="app-ask-suggestions">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                className="h-auto justify-start whitespace-normal px-3 py-2 text-left text-sm font-normal"
                onClick={() => onAsk(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AppAskPage;
