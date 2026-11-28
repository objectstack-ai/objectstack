// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ChatPane — one conversation's chat column: the agent switcher row, the
 * `<ChatbotEnhanced>` thread and composer, and the send path. Mounted by
 * `AiChatPage` (full page) and by the console's chat drawer, keyed on the
 * conversation id. Split out of `AiChatPage.tsx` move-only (objectstack#37730);
 * importers keep reaching it through `AiChatPage.js`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAuth } from '@object-ui/auth';
import { translateMetadataType } from '../../views/metadata-admin/i18n.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Button,
} from '@object-ui/components';
import { Share2 } from 'lucide-react';
import {
  ChatbotEnhanced,
  useObjectChat,
  useAiModels,
  useHitlInChat,
  // The authoring/honest -> runtime message seam (objectui#4399 / PR #4416),
  // consumed here one hop up from the plugin's own renderers (objectui#4437).
  // See `runtimeMessages` below for why this host calls it exactly once.
  toRuntimeMessages,
  type ChatFilePart,
  // The plugin's RUNTIME chat-message contract under a local name; see the
  // import in `./aiChatHydration.ts` for why it is not the authoring type.
  type ChatbotEnhancedMessage as ChatMessage,
} from '@object-ui/plugin-chatbot';
// The side-effect-free names come through `/core` like every other app-shell
// import of them, so a test stubs each in one place (objectui#13410).
import {
  agentRouteName,
  agentHasCapability,
  type AgentDescriptor,
} from '@object-ui/plugin-chatbot/core';

import { useOpenAssistant } from '../../layout/chatDockControl.js';
import { publishPlanApprovalPending } from '../../assistant/assistantBus.js';
import { countWritesAwaitingApproval } from '../../assistant/writeApprovalPending.js';
import type { ChatSurfaceContext } from '../../layout/chatSurfaceContext.js';
import { buildFocusContext, type ConversationFocus } from '../../layout/chatFocus.js';
import { ChatFocusRow } from './ChatFocusRow.js';
import { getUpgradeUrl } from '../../runtime-config.js';
import { cloudConsoleUrl } from '../marketplace/marketplaceApi.js';
import {
  sanitizeChatMessagesForCache,
  writeConversationMessagesCache,
  type HydratedUIMessage,
} from '../../hooks/useChatConversation.js';
import { useReconcileOnError } from '../../hooks/useReconcileOnError.js';
import { useAiUsage } from '../../hooks/useAiUsage.js';
import { isConversationZh } from './conversationLanguage.js';
import { resolveAttachmentNoteText, type AttachmentNoteKey } from './outboundAgentText.js';
import { appOfObject } from './appOfObject.js';
import { RECORD_SECTION_OPENED_STATE } from '../../urlParams.js';
import { recordWriteFormTarget } from '../../utils/recordFormAiDraft.js';
import { useUpload } from '@object-ui/fields';
import { isSpreadsheetAttachment, uploadChatAttachments, chatAttachmentNotes } from './chatAttachments.js';
import { listLinkTarget, recordOpenTarget, nextSectionOpening } from './aiChatLinks.js';
import { documentHref } from '../../views/documentHref.js';
import { hydratedMessagesToChatMessages } from './aiChatHydration.js';
import { localizeAgentLabel, agentEmptyState, buildAgentSuggestions } from './agentCopy.js';
import { drawerSuggestions, type EmptyConversationSize } from './emptyConversationModel.js';
import { DrawerRecentConversations, EmptyConversation, EmptyConversationGreeting } from './EmptyConversation.js';
import {
  useDeferredFirstSend,
  useComposerDraftHandoff,
  type PendingFirstMessage,
} from './useDeferredFirstSend.js';

interface ChatPaneProps {
  /**
   * cloud#1610 — what the user is currently discussing, derived by the HOST
   * from its route/selection (Studio: pillar + the ?surface= deep-link the
   * pillars already mirror — the URL is the single source of truth). Sent as
   * `context.surface` on every turn (the transport reads the body per send),
   * and surfaced to the user as a chip above the composer.
   */
  surfaceContext?: ChatSurfaceContext;
  /**
   * objectui#8219 — the display label of `surfaceContext.artifact`, when the
   * host knows it (Studio: the Interfaces pillar's open leaf). Display-only: the
   * "discussing" chip reads it, with the internal `type · name` pair on the
   * chip's tooltip (objectui#7254). Deliberately a SEPARATE prop and never part
   * of `surfaceContext` — that object is the `context.surface` data the agent
   * receives (cloud#1610), which this must not change. Absent = the chip reads
   * `type · name`, as before.
   */
  surfaceArtifactLabel?: string;
  /**
   * objectstack#36999 — the conversation's focus, held by the HOST (above the
   * pane it keys on the conversation id, so the first send still carries it;
   * see `useConversationFocus`). Drawn and sent only while the agent's catalog
   * row declares `capabilities.focus`: then every turn carries
   * `context.focus`, and the composer's context row replaces the page chip
   * ({@link ChatFocusRow}). Absent, or an agent that does not honour it →
   * nothing changes: no pin, no chip, no key.
   */
  conversationFocus?: ConversationFocus;
  agents: AgentDescriptor[];
  agentsLoading: boolean;
  agentsError: Error | undefined;
  activeAgent: string | undefined;
  chatApi: string | undefined;
  apiBase: string;
  conversationId: string | undefined;
  /** objectstack#33674 — the conversation the host asks `useChatConversation`
   *  for (its `activeId`: the deep link's id); absent when the host asks for
   *  none. A draft typed before this pane knew its id is carried into the
   *  replacing pane only while this is unchanged. See {@link useComposerDraftHandoff}. */
  requestedConversationId?: string;
  /**
   * objectstack#30043 — the app the user has selected, by its package: the
   * console app the dock sits in, whichever agent it runs. Sent as
   * `context.activeApp`; absent, the key is omitted, never a placeholder.
   */
  activeAppPackageId?: string;
  initialMessages: HydratedUIMessage[];
  /** Page-owned stash for a first message sent before the conversation id resolved
   *  (survives this pane's id-keyed remount). See {@link useDeferredFirstSend}. */
  pendingFirstMessageRef: React.MutableRefObject<PendingFirstMessage | null>;
  /** objectstack#32031 — creates the conversation on the first send (the host's
   *  `useChatConversation().ensureConversation`); no row exists before it.
   *  See {@link useDeferredFirstSend}. */
  ensureConversation?: () => unknown;
  /** objectstack#33420 — the host's `useChatConversation().createError`: the
   *  create the held first message waits on failed. See {@link useDeferredFirstSend}. */
  conversationCreateError?: Error;
  /**
   * ADR-0028 — the model the user picked in the composer, held by the HOST.
   * The pane is keyed on the conversation id and remounts when the first send
   * mints it, so a pick kept inside the pane would be dropped right then: the
   * replayed first message and every later turn would go out with the default
   * while the picker had shown the pick. A host that keys the pane passes this
   * pair; absent, the pane holds the pick itself for its own lifetime.
   */
  selectedModelId?: string;
  /** ADR-0028 — records a pick; paired with {@link ChatPaneProps.selectedModelId}. */
  onSelectedModelChange?: (modelId: string) => void;
  onSent: (firstUserMessage?: string) => void;
  onShare: () => void;
  /**
   * objectstack#34725 — the host draws the panel's one title bar itself, so
   * the pane omits its own header row: the agent switcher and Share. The host
   * then offers Share where it chooses.
   * @default false
   */
  hideHeader?: boolean;
  /**
   * objectstack#35445 — the host offers Share in its own title bar (the
   * console drawer's 「···」 menu), so the pane's header row does not draw it.
   * The rest of the row (the agent switcher) stays.
   * @default false
   */
  actionsInHost?: boolean;
  /**
   * objectstack#37862 — the host draws the shared empty conversation before
   * the first message (`EmptyConversation`): the greeting, what to ask, the
   * page's suggestions and 「最近会话」, `large` where the chat fills the
   * window and `compact` in the rail and the phone sheet. `userId` and
   * `onOpenConversation` list the recent conversations and open one where the
   * host shows conversations; without them the section is not drawn. Absent,
   * the pane keeps the chat's built-in empty state.
   */
  emptyConversation?: {
    size: EmptyConversationSize;
    userId?: string;
    onOpenConversation?: (conversation: { id: string; agentId?: string }) => void;
  };
}

export function ChatPane({
  agents,
  agentsLoading,
  agentsError,
  activeAgent,
  chatApi,
  apiBase,
  conversationId,
  requestedConversationId,
  activeAppPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  conversationFocus,
  initialMessages,
  pendingFirstMessageRef,
  ensureConversation,
  conversationCreateError,
  selectedModelId: hostSelectedModelId,
  onSelectedModelChange,
  onSent,
  onShare,
  hideHeader = false,
  actionsInHost = false,
  emptyConversation,
}: ChatPaneProps) {
  const { t, language } = useObjectTranslation();
  const navigate = useNavigate();
  // The agent dropdown is a LAUNCHER now (not an in-surface mode toggle): it
  // navigates to `/ai/:agent`, so it naturally lists custom agents and can stay
  // always-available. Shown only when there's more than one agent to switch to.
  // objectstack#34608 — inside the console's drawer a pick retargets the
  // drawer in place; under no drawer host it navigates.
  const showAgentLauncher = agents.length > 1;
  const openAssistant = useOpenAssistant();

  // cloud#1658 — land the user on the record an `open_record` hand-off names.
  // The payload has objectName + recordId but the canonical record route needs
  // the APP segment (`/apps/:app/:object/record/:id`), so resolve the object's
  // owning package on click — one same-origin metadata read — instead of
  // burdening the agent with an id it may not know. `setup` is the fallback
  // shell for an object no package claims.
  //
  // ADR-0160 D9 — a record citation's chip passes the `anchor` of the body
  // section it cites; it rides as `?section=` (`RECORD_SECTION_PARAM`), and
  // the record page opens at that heading. The record opened is always the
  // citation's own `object`/`id`, the pack's root record. Each click carries a
  // fresh `RECORD_SECTION_OPENED_STATE`, so clicking the same chip again opens
  // the section again.
  const openRecord = useCallback(
    async (handoff: { objectName: string; recordId: string; anchor?: string }) => {
      const app = await appOfObject(handoff.objectName);
      navigate(
        recordOpenTarget(app, handoff),
        handoff.anchor ? { state: { [RECORD_SECTION_OPENED_STATE]: nextSectionOpening() } } : undefined,
      );
    },
    [navigate],
  );

  // objectstack#31869 — a `/list/OBJECT` link in an answer opens that list.
  // The address is BUILT here from the parsed values, never copied from the
  // href: the view by name, and the Filter panel conditions under the list
  // route's own param (`uf__filter`, `LIST_FILTER_PARAM` in
  // `views/userFilterUrlState.ts`, spelled out so this chunk does not load
  // that module). The list page then judges the conditions itself: a field
  // this reader cannot read refuses the whole filter, with a notice.
  const openList = useCallback(
    async (target: { objectName: string; view?: string; filter?: { logic: 'and' | 'or'; conditions: unknown[] } }) => {
      const app = await appOfObject(target.objectName);
      navigate(listLinkTarget(app, target));
    },
    [navigate],
  );

  // cloud#3565 — 打开完整表单 on a record-write card. A create opens the New
  // form with the card's values in the ROUTER STATE of this navigation, never
  // the query string: a chat draft carries contact details, and a URL is
  // copied, shared and logged (objectstack#28104, `recordFormAiDraft.ts`).
  // The form marks each of those fields 「AI 建议」 until the person edits
  // it, and opens unsaved; the form's own defaults fill the rest. An update
  // opens the record's edit form on the stored record with the card's
  // proposed values in the same router state (objectstack#28106): the form
  // applies each as an unsaved change, before → after, marked 「AI 建议」 with
  // a per-field revert. The card cancelled the pending write before calling
  // this, so a record saved here is never written a second time.
  const openRecordForm = useCallback(
    async (write: {
      operation: 'create' | 'update';
      objectName: string;
      recordId?: string;
      fields: Array<{ name: string; value: unknown }>;
    }) => {
      const target = recordWriteFormTarget(write, await appOfObject(write.objectName));
      navigate(target.to, target.state ? { state: target.state } : undefined);
    },
    [navigate],
  );

  // A draft review card's Studio links (the `data-draft-review` part) open in
  // the app, so a live-only card is still there when the person comes back;
  // the anchor's href carries the router's basename for a new tab.
  const routerRootHref = useHref('/');
  const openReviewLink = useCallback((path: string) => navigate(path), [navigate]);
  const reviewLinkHref = useCallback((path: string) => documentHref(routerRootHref, path), [routerRootHref]);

  // The pane's root, measured by the composer-draft handoff below.
  const paneRef = useRef<HTMLDivElement | null>(null);
  // objectstack#33674 — what is typed into the composer before this pane knows
  // its conversation outlives the id-keyed remount. See useComposerDraftHandoff.
  const noteComposerInput = useComposerDraftHandoff({
    hostStash: pendingFirstMessageRef,
    containerRef: paneRef,
    chatApi,
    conversationId,
    requestedConversationId,
  });
  const activeAgentLabel = useMemo<string>(() => {
    const found = agents.find((a) => a.name === activeAgent);
    return localizeAgentLabel(t, activeAgent, found?.label ?? activeAgent ?? t('console.ai.assistant'));
  }, [agents, activeAgent, t]);

  const hydrated = useMemo<ChatMessage[]>(() => {
    return hydratedMessagesToChatMessages(initialMessages);
  }, [initialMessages]);

  // `suggestions` + `emptyState` are computed AFTER the bound-package label
  // below (ADR-0057 A1.b edit mode needs the app name), near boundPackageLabel.

  // ADR-0013 D2: reconcile a stream-transport failure instead of blindly
  // retrying. Shared across chat surfaces — see useReconcileOnError.
  const { errorSuppressed, handleChatError, setMessagesRef, resetSuppression } =
    useReconcileOnError({ chatApi, conversationId });

  // ADR-0028: plan-filtered selectable AI model on the full-page Build/Ask
  // surface. The footer <select> in ChatbotEnhanced renders only for 2+ models,
  // so free / single-model envs see nothing. Mirrors ConsoleFloatingChatbot;
  // the chosen model rides each request via useObjectChat's `model` below.
  // objectui#12508 — asked only once the agent catalog names an agent: the
  // pane mounts while the catalog is still loading, and a server without an
  // AI service answers that catalog empty and `/models` with a 501.
  const { models: aiModels, defaultModelId } = useAiModels({ apiBase, enabled: agents.length > 0 });
  // objectstack#33660 — the allowance the picker sets each model's multiplier
  // against. Asked only once some model carries a multiplier: without one the
  // picker has nothing to say about the allowance.
  const { usage: aiUsage } = useAiUsage({
    apiBase,
    enabled: aiModels.some((m) => m.costMultiplier !== undefined),
  });
  const allowanceUsedFraction =
    aiUsage && !aiUsage.pool.unmetered && aiUsage.pool.fraction !== null ? aiUsage.pool.fraction : undefined;
  const selectedApp = activeAppPackageId || undefined;
  // The pick outlives this pane only when the host holds it (see the props).
  const [paneSelectedModelId, setPaneSelectedModelId] = useState<string | undefined>(undefined);
  const hostHoldsModel = onSelectedModelChange !== undefined;
  const selectedModelId = hostHoldsModel ? hostSelectedModelId : paneSelectedModelId;
  const setSelectedModelId = hostHoldsModel ? onSelectedModelChange : setPaneSelectedModelId;
  // The one value both the picker shows and the request sends.
  const effectiveModelId = selectedModelId ?? defaultModelId;
  // objectstack#36999 — the focus is drawn and sent only where the agent says
  // it honours it: a chip the server ignores would mislead.
  const focusHonoured =
    conversationFocus !== undefined && agentHasCapability(agents, activeAgent, 'focus');

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    stop,
    reload,
    clear,
    setMessages,
  } = useObjectChat({
    api: chatApi,
    conversationId,
    // ADR-0028: the user's picked model (or the env default) rides each request.
    model: effectiveModelId,
    onError: handleChatError,
    body: {
      context: {
        // objectstack#30043 — the app the user has selected, never a constant:
        // the agent was told "AI" while the user stood in their CRM. Omitted
        // when nothing is selected.
        ...(selectedApp ? { activeApp: selectedApp } : {}),
        agentName: activeAgent,
        // cloud#1610 — what the user is currently discussing (advisory; the
        // transport reads the body per send, so this stays fresh per turn).
        // The console dock sends the page in view too (objectstack#30043).
        ...(surfaceContext ? { surface: surfaceContext } : {}),
        // objectstack#36999 — the record the conversation is pinned to, on
        // EVERY turn while it is pinned (the body is the authority; nothing
        // the server stored replaces it). No key at all otherwise.
        ...buildFocusContext(conversationFocus?.focus, focusHonoured),
        // The language this console renders in, so a reply that names a card
        // control names it as the card draws it. Only `Accept-Language` reaches
        // the server otherwise; the server validates the value itself.
        uiLocale: language,
      },
    },
    initialMessages: hydrated,
    autoResponse: !chatApi,
    autoResponseText: "Thanks for your message! I'm here to help.",
    autoResponseDelay: 600,
  });

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  // ── The one conversion: where the hook's values enter this page's
  // runtime-typed world (objectui#4437) ──────────────────────────────────────
  //
  // `useObjectChat` returns `ObjectChatMessage[]` — the shape BOTH of its modes
  // really produce (objectui#4424 / PR #4436): wide where local mode is wide,
  // so it keeps the authored `'tool'` role and the legacy
  // `'partial-call'`/`'call'`/`'result'` tool states. Everything below this
  // line wants the RUNTIME shape instead, and used to say so with five
  // `as ChatMessage[]` casts. A cast erases the whole difference rather than
  // the intentional part of it: a new authored role, or a newly required
  // runtime key, kept compiling at all five sites and surfaced as behaviour.
  //
  // `toRuntimeMessages` is the same seam the plugin's own three renderers use
  // (`renderer.tsx`, objectui#4399), with each narrowing decision named and
  // tested in `chatMessageAdapter.ts`: `'tool'` renders as an assistant bubble,
  // legacy tool states map to their v6 equivalents, and every render-only key
  // (`charts`, `recordCitations`, `pendingActionId`, …) is spread through.
  // Memoized on `messages` exactly as those renderers do, so this array's
  // identity is neither more nor less stable than the hook's own output.
  //
  // All four consumers below take the converted array. The one that is
  // fold-SENSITIVE is the cache write, and it is sensitive in the direction it
  // wants — see the comment on that effect.
  const runtimeMessages = useMemo(() => toRuntimeMessages(messages), [messages]);

  // The cache write is the one measured behaviour change of objectui#4437, and
  // it is a fix: `sanitizeChatMessagesForCache` declares its parameter's role as
  // `'user' | 'assistant' | 'system'` — it has always ASKED for folded roles,
  // and the cast is what let an unfolded `'tool'` past that declaration. Two
  // consequences, both measured on a message set carrying a `'tool'` role:
  //   - the entry was cached as `role: 'tool'`, which `readMessageCache`'s own
  //     validator then rejects, so the message vanished on a cache-fallback
  //     reload. Folded, it restores as the assistant bubble it renders as.
  //   - sanitize gates tool serialization on `role === 'assistant'`, so that
  //     message's tool invocations — including the pending approval a card
  //     acts on — were dropped from the cache entirely. Folded, they survive
  //     the reload they exist to survive.
  // Not reachable from this page's own paths today (hydration and `mapMessages`
  // both produce runtime roles and v6 states already), so nothing on screen
  // moves; this closes the hole ahead of a value that can reach it.
  useEffect(() => {
    writeConversationMessagesCache(
      conversationId,
      sanitizeChatMessagesForCache(runtimeMessages),
    );
  }, [conversationId, runtimeMessages]);

  // The thread so far, read when a turn is prepared (objectstack#34461)
  // without making the send callbacks change identity on every message.
  const threadMessagesRef = useRef({ runtimeMessages, initialMessages });
  threadMessagesRef.current = { runtimeMessages, initialMessages };
  const hitl = useHitlInChat({
    messages: runtimeMessages,
    apiBase,
    continueConversation: (prompt) => {
      sendMessage(prompt);
    },
  });

  // ui ADR-0057 Amendment A5, row 3 — a write the AI proposed that still waits
  // for this user's approval is published per conversation to the assistant
  // bus, where it outlives this pane: the drawer's host reads it when the
  // drawer is next opened from the entry, and reopens this conversation.
  const { user } = useAuth();
  const approvalOwner = user?.id;
  const writesAwaiting = countWritesAwaitingApproval(runtimeMessages, hitl.decisions);
  useEffect(() => {
    if (!conversationId) return;
    publishPlanApprovalPending({
      userId: approvalOwner,
      conversationId,
      pending: writesAwaiting > 0,
      count: writesAwaiting,
    });
  }, [approvalOwner, conversationId, writesAwaiting]);

  // The real send, shared by a normal submit and by the deferred-first-message
  // replay below (resetSuppression → send → onSent, in that order).
  //
  // Spreadsheet attachments (cloud#797 WS3): historically every attachment was
  // silently dropped between the composer and the transport. Excel/CSV files
  // are now parsed CLIENT-side (plugin-grid's importParsers; the bytes never
  // leave the page) and the agent is briefed with a compact structured block —
  // headers + first sample rows + row count — appended to the user's text. The
  // agent's solution-design skill takes it from there (match an object, offer
  // missing fields, point at the object list's Import action).
  //
  // Images and PDFs (objectstack#32749, ruling A) are uploaded to storage as
  // the signed-in user, bound to no record, and ride the turn as AI SDK file
  // parts carrying their `sys_file` id (`chatAttachments.ts`). Any other
  // attachment, and one over the cap or whose upload failed, is named in the
  // turn's text as not read, never dropped silently.
  //
  // objectstack#34462 — a turn with attachments is not ready to send until its
  // uploads (and its sheet parse) settle, which takes seconds for a large
  // photo, while a turn without one sends at once. So every turn is handed to
  // `sendMessage` in the order the user sent it: a turn sent while an earlier
  // one is still being prepared waits behind it. While any turn is being
  // prepared the composer reads as busy (`preparingTurn`, folded into the
  // pane's `isLoading` below), so a message typed meanwhile queues there, as
  // it does during a running reply, instead of reaching the agent first.
  const { upload } = useUpload();
  const [preparingTurn, setPreparingTurn] = useState(false);
  const preparingCountRef = useRef(0);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  /** The turn's text and file parts, once its attachments are read. Never rejects. */
  const prepareTurn = useCallback(
    async (
      content: string,
      files: File[],
    ): Promise<{ text: string; parts?: readonly ChatFilePart[]; sentText: string }> => {
      const sheets = files.filter(isSpreadsheetAttachment);
      const nonSheets = files.filter((f) => !isSpreadsheetAttachment(f));
      // objectstack#34461 — the notes follow the conversation's language, as
      // all outbound text does: the turn's own words decide it, as they will
      // once the turn is in the thread; a turn with no words takes the
      // thread's language so far.
      const thread = threadMessagesRef.current;
      const zh = content.trim()
        ? isConversationZh([{ role: 'user', content }])
        : isConversationZh(thread.runtimeMessages) || isConversationZh(thread.initialMessages);
      const note = (key: AttachmentNoteKey, vars: Readonly<Record<string, string>>) =>
        resolveAttachmentNoteText(zh, key, vars);
      let merged = content;
      if (sheets.length > 0) {
        const cap = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
        const line = (r: string[]) =>
          r.slice(0, 12).map((c) => cap(String(c ?? '')).replace(/\s+/g, ' ')).join(' | ');
        for (const f of sheets.slice(0, 2)) {
          try {
            const { parseSpreadsheetFile } = await import('@object-ui/plugin-grid');
            const rows = await parseSpreadsheetFile(f);
            const headers = rows[0] ?? [];
            const samples = rows.slice(1, 4);
            merged += [
              `\n\n${note('sheetBrief', {
                name: f.name,
                rows: String(Math.max(0, rows.length - 1)),
                columns: String(headers.length),
              })}`,
              note('sheetHeaders', { cells: line(headers) }),
              ...samples.map((r, i) => note('sheetSample', { n: String(i + 1), cells: line(r) })),
            ].join('\n');
          } catch (err) {
            merged += `\n\n${note('sheetParseFailed', {
              name: f.name,
              reason: err instanceof Error ? err.message : 'unknown',
            })}`;
          }
        }
        if (sheets.length > 2) merged += `\n\n${note('sheetsNotRead', { count: String(sheets.length - 2) })}`;
      }
      // What `onSent` is told: the sheet brief is part of it, the file notes
      // are not (as before objectstack#34462).
      const sentText = merged;
      if (nonSheets.length === 0) return { text: merged, sentText };
      const outcome = await uploadChatAttachments(nonSheets, upload, window.location.href);
      return { text: merged + chatAttachmentNotes(outcome, zh), parts: outcome.parts, sentText };
    },
    [upload],
  );
  const doSend = useCallback(
    (content: string, files?: File[]) => {
      resetSuppression();
      const attached = files ?? [];
      // Nothing to read and nothing waiting ahead of it: send at once.
      if (attached.length === 0 && preparingCountRef.current === 0) {
        sendMessage(content);
        onSent(content);
        return;
      }
      preparingCountRef.current += 1;
      setPreparingTurn(true);
      // The reading starts now, so two turns' uploads overlap; the send waits
      // for the turn ahead of it.
      const prepared =
        attached.length > 0
          ? prepareTurn(content, attached).catch(() => ({ text: content, parts: undefined, sentText: content }))
          : Promise.resolve({ text: content, parts: undefined, sentText: content });
      const ahead = sendChainRef.current;
      const turn = (async () => {
        const { text, parts, sentText } = await prepared;
        await ahead;
        resetSuppression();
        if (parts && parts.length > 0) sendMessage(text, undefined, parts);
        else sendMessage(text);
        onSent(sentText);
      })()
        .catch(() => undefined)
        .finally(() => {
          preparingCountRef.current -= 1;
          if (preparingCountRef.current === 0) setPreparingTurn(false);
        });
      sendChainRef.current = turn;
    },
    [resetSuppression, sendMessage, onSent, prepareTurn],
  );

  // Guards the empty-state first send against the conversation-id remount race:
  // a send made before the id is minted is stashed in the page-owned ref and
  // replayed once the id lands, so the magic-moment first message reliably
  // reaches `…/chat` instead of being dropped. See useDeferredFirstSend.
  const [heldFirstMessage, setHeldFirstMessage] = useState<PendingFirstMessage | null>(null);
  const handleSend = useDeferredFirstSend({
    chatApi,
    conversationId,
    pendingRef: pendingFirstMessageRef,
    doSend,
    // #2450 — this pane's agent surface; a stash targeted at another surface
    // is held, never consumed here.
    agentRoute: activeAgent ? agentRouteName(activeAgent) : undefined,
    ensureConversation,
    onHeldChange: setHeldFirstMessage,
    createError: conversationCreateError,
  });
  // objectstack#33420 — the thread as drawn: a first message waiting on the
  // conversation's create shows at once, as the user's bubble with the
  // assistant's thinking dots under it, the way a sent message looks before
  // its first token.
  const shownMessages = useMemo<ChatMessage[]>(
    () =>
      heldFirstMessage
        ? [
            ...runtimeMessages,
            { id: 'held-first-message', role: 'user', content: heldFirstMessage.content },
            { id: 'held-first-message-reply', role: 'assistant', content: '', streaming: true },
          ]
        : runtimeMessages,
    [runtimeMessages, heldFirstMessage],
  );

  const suggestions = useMemo<string[] | undefined>(
    () => (hydrated.length > 0 ? undefined : buildAgentSuggestions(activeAgent, activeAgentLabel, t)),
    [hydrated.length, activeAgent, activeAgentLabel, t],
  );
  const emptyState = useMemo(() => agentEmptyState(t, activeAgent), [t, activeAgent]);

  // objectstack#37862 — the shared empty conversation, where the host asks for
  // it. The page's suggestions read the surface the agent is sent; one about
  // the record in view fills the composer, the rest send.
  const emptySuggestions = useMemo(
    () =>
      emptyConversation
        ? drawerSuggestions(t, { agentName: activeAgent, agentLabel: activeAgentLabel, surface: surfaceContext })
        : [],
    [emptyConversation, t, activeAgent, activeAgentLabel, surfaceContext],
  );
  const emptySize = emptyConversation?.size;
  const recentUserId = emptyConversation?.userId;
  const openRecentConversation = emptyConversation?.onOpenConversation;
  const renderEmptyState = useMemo(() => {
    if (!emptySize) return undefined;
    return (actions: { send: (text: string) => void; fill: (text: string) => void }) => (
      <EmptyConversation
        size={emptySize}
        heading={<EmptyConversationGreeting />}
        subtitle={emptyState.description}
        suggestions={emptySuggestions}
        onSuggestion={(suggestion) =>
          suggestion.mode === 'fill' ? actions.fill(suggestion.text) : actions.send(suggestion.text)
        }
        recent={
          recentUserId && openRecentConversation ? (
            <DrawerRecentConversations
              size={emptySize}
              userId={recentUserId}
              apiBase={apiBase}
              agentName={activeAgent}
              onOpen={openRecentConversation}
            />
          ) : null
        }
      />
    );
  }, [emptySize, emptyState.description, emptySuggestions, recentUserId, openRecentConversation, apiBase, activeAgent]);

  // objectstack#37146 — with one launchable agent there is nothing to switch,
  // so the row names no agent (it read only 「提问」 once the in-app build
  // entry closed). Where the host lifts Share into its own title bar (the
  // drawer, objectstack#35445) and nothing else is left — no switcher, no
  // offline note — the row is not drawn at all, so no empty band or border
  // remains.
  const headerHasContent = showAgentLauncher || !actionsInHost || Boolean(agentsError);

  const headerSlot = (
    <div
      data-testid="ai-chat-header"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 pb-2 pt-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showAgentLauncher ? (
          agents.length <= 3 ? (
            // Claude-Code-style segmented switcher (mirrors the floating
            // assistant) so Ask/Build read as visible peer modes, not a hidden
            // dropdown. Each tab navigates to that agent's surface. Falls back
            // to the Select when many custom agents would overflow the header.
            <Tabs
              value={activeAgent}
              onValueChange={(name) => openAssistant({ agent: name })}
            >
              <TabsList
                className="h-7 gap-0.5 p-0.5"
                data-testid="ai-chat-agent-picker"
                aria-label={t('console.ai.switchAssistant', { defaultValue: 'Switch assistant' })}
              >
                {agents.map((agent) => (
                  <TabsTrigger
                    key={agent.name}
                    value={agent.name}
                    disabled={agentsLoading}
                    title={agent.description || undefined}
                    className="h-6 px-2.5 text-xs"
                  >
                    {localizeAgentLabel(t, agent.name, agent.label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <Select
              value={activeAgent}
              onValueChange={(name) => openAssistant({ agent: name })}
              disabled={agentsLoading}
            >
              <SelectTrigger
                className="h-7 w-auto min-w-0 border-0 bg-transparent px-1.5 text-xs shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-border/80 focus-visible:ring-offset-0 sm:min-w-[160px]"
                data-testid="ai-chat-agent-picker"
                aria-label={t('console.ai.switchAssistant', { defaultValue: 'Switch assistant' })}
              >
                <SelectValue placeholder={t('console.ai.chooseAgent', { defaultValue: 'Choose assistant…' })} />
              </SelectTrigger>
              <SelectContent align="start">
                {agents.map((agent) => (
                  <SelectItem key={agent.name} value={agent.name} className="text-xs">
                    <span className="font-medium">
                      {localizeAgentLabel(t, agent.name, agent.label)}
                    </span>
                    {agent.description ? (
                      <span className="block text-muted-foreground text-xs truncate max-w-[260px]">
                        {agent.description}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : null}
      </div>
      {actionsInHost ? null : (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onShare}
          disabled={!conversationId}
          aria-label={t('console.ai.share')}
          data-testid="ai-chat-share-button"
          title={conversationId ? t('console.ai.shareTitle') : t('console.ai.shareDisabledTitle')}
        >
          <Share2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      )}
      {agentsError ? (
        <span
          className="basis-full text-xs text-amber-700 dark:text-amber-400"
          title={agentsError.message}
        >
          {t('console.ai.offlineDemoMode')}
        </span>
      ) : null}
    </div>
  );

  // objectui#8219 / objectui#7254 — the page chip READS the artifact's display
  // label when the host has one, and keeps the internal `type · name` pair
  // REACHABLE on its tooltip. No label → the pair, as before.
  const surfaceChipTitle = surfaceContext?.artifact
    ? `${surfaceContext.artifact.type} · ${surfaceContext.artifact.name}`
    : undefined;
  const surfaceChipLabel = surfaceContext?.artifact
    ? t('console.ai.discussing', {
        defaultValue: 'Viewing: {{target}}',
        target: surfaceArtifactLabel || surfaceChipTitle,
      })
    : undefined;
  // objectstack#36999 — while the agent honours a focus, the composer's
  // context row (the page chip with its pin, or the pinned record's chip) is
  // drawn here instead of the composer's text-only page chip.
  const focusRow =
    focusHonoured && conversationFocus ? (
      <ChatFocusRow
        focus={conversationFocus}
        surface={surfaceContext}
        surfaceLabel={surfaceChipLabel}
        surfaceTitle={surfaceChipTitle}
      />
    ) : null;

  return (
    <div ref={paneRef} className="relative flex min-h-0 flex-1 px-0">
      {/* objectui#12725 — `min-w-0`: the column is a flex item, and a flex
          item's automatic minimum width is its content's min-content width.
          A tool card's one-line summary (`truncate`, nowrap) contributes its
          whole text to that, so the column outgrew the Studio copilot's
          300 px slot at a 1010 px window and the share button, the bubbles'
          ends and the send button were cut (a one-off reading, on
          objectui#12725). Bounded by its parent, the column follows the slot
          and the summary truncates as it was written to. */}
      <div
        data-chat-column
        className="flex min-h-0 min-w-0 flex-1 justify-center"
      >
      <ChatbotEnhanced
        className="min-h-0 flex-1 bg-background md:max-w-5xl"
        // The paywall exit: the control plane's declared upgrade entry when
        // served (objectstack#34622), else its origin. Neither ⇒ an undefined
        // `onUpgrade` renders NO upgrade button, which is the honest state for
        // a runtime with no control plane behind it (objectui#7253).
        onUpgrade={
          (getUpgradeUrl() ?? cloudConsoleUrl())
            ? () => window.open(getUpgradeUrl() ?? cloudConsoleUrl(), '_blank', 'noopener,noreferrer')
            : undefined
        }
        onInputChange={noteComposerInput}
        onOpenRecord={openRecord}
        onOpenList={openList}
        onOpenReviewLink={openReviewLink}
        reviewLinkHref={reviewLinkHref}
        // cloud#3565 — the record-write card's three buttons and its states.
        onOpenRecordForm={openRecordForm}
        recordWriteCreateTitle={(objectLabel) => t('console.ai.recordWriteCreateTitle', { object: objectLabel })}
        recordWriteUpdateTitle={(objectLabel) => t('console.ai.recordWriteUpdateTitle', { object: objectLabel })}
        recordWriteConfirmLabel={t('console.ai.recordWriteConfirm')}
        recordWriteOpenFormLabel={t('console.ai.recordWriteOpenForm')}
        recordWriteCancelLabel={t('console.ai.recordWriteCancel')}
        recordWriteCancelReason={t('console.ai.recordWriteCancelReason')}
        recordWriteOpenFormReason={t('console.ai.recordWriteOpenFormReason')}
        recordWriteDroppedLabel={t('console.ai.recordWriteDropped')}
        recordWriteSubmittingLabel={t('console.ai.recordWriteSubmitting')}
        recordWriteWrittenLabel={t('console.ai.recordWriteWritten')}
        recordWriteCancelledLabel={t('console.ai.recordWriteCancelled')}
        sampleDataCleanupTitleLabel={t('console.ai.sampleDataCleanupTitle')}
        sampleDataCleanupIrreversibleLabel={t('console.ai.sampleDataCleanupIrreversible')}
        sampleDataCleanupAbsentLabel={(count) => t('console.ai.sampleDataCleanupAbsent', { count })}
        sampleDataCleanupEditedLabel={(count) => t('console.ai.sampleDataCleanupEdited', { count })}
        // objectstack#31025 — the package-removal card; type names are the
        // ones the Studio Delete package dialog shows.
        packageRemovalTitleLabel={(packageLabel) => t('console.ai.packageRemovalTitle', { package: packageLabel })}
        packageRemovalRowsLabel={(count) => t('console.ai.packageRemovalRows', { count })}
        packageRemovalDraftLabel={t('console.ai.packageRemovalDraft')}
        packageRemovalRowsUnknownLabel={t('console.ai.packageRemovalRowsUnknown')}
        packageRemovalItemTypeLabel={(type) => translateMetadataType(type, language)}
        packageRemovalTotalLabel={(count) => t('console.ai.packageRemovalTotal', { count })}
        packageRemovalUncountedLabel={(count) => t('console.ai.packageRemovalUncounted', { count })}
        packageRemovalPermanentLabel={t('console.ai.packageRemovalPermanent')}
        packageRemovalKeptLabel={t('console.ai.packageRemovalKept')}
        packageRemovalRemovedLabel={t('console.ai.packageRemovalRemoved')}
        packageRemovalPartialLabel={(failed) => t('console.ai.packageRemovalPartial', { count: failed })}
        surface="plain"
        maxHeight="100%"
        headerSlot={hideHeader || !headerHasContent ? undefined : headerSlot}
        // objectstack#36999 — the focus row is a row of the composer's own
        // area, in flow above the input.
        promptHeaderSlot={focusRow ?? undefined}
        messages={shownMessages}
        // Keys the question card's skip marks to this conversation.
        conversationId={conversationId}
        placeholder={
          activeAgent
            ? agentRouteName(activeAgent) === 'ask'
              // The generic "Ask {agent}…" doubles to "Ask Ask…" for the data-query
              // agent whose label IS "Ask". Use its purpose-built placeholder instead.
              ? t('console.ai.askAnything')
              : t('console.ai.askAgent', { agent: activeAgentLabel })
            : agentsLoading
              ? t('console.ai.loadingAgents')
              : t('console.ai.askAnything')
        }
        labels={{
          emptyTitle: emptyState.title,
          emptyDescription: emptyState.description,
          clear: t('console.ai.clearConversation'),
          sendHint: t('console.ai.sendHint'),
          // objectui#12724 — the footer reads「↵ 发送 · Shift+↵ 换行」.
          newlineHint: t('console.ai.newlineHint'),
          agentActivity: t('console.ai.agentActivity'),
          toolCompleted: t('console.ai.toolCompleted'),
          toolRunning: t('console.ai.toolRunning'),
          toolAwaitingApproval: t('console.ai.toolAwaitingApproval'),
          toolFailed: t('console.ai.toolFailed'),
          connectionWaiting: t('console.ai.connectionWaiting', { defaultValue: 'Waiting for server…' }),
          connectionStalledLabel: t('console.ai.connectionStalled', { defaultValue: 'Still working…' }),
          connectionOfflineLabel: t('console.ai.connectionOffline', { defaultValue: 'Connection lost — reconnecting…' }),
          toolDetailsHidden: t('console.ai.toolDetailsHidden'),
          copy: t('console.ai.copy'),
          copied: t('console.ai.copied'),
          regenerate: t('console.ai.regenerate'),
          model: t('console.ai.model'),
          submit: t('console.ai.submit'),
          uploadFiles: t('console.ai.uploadFiles'),
          stopResponse: t('console.ai.stopResponse'),
          sendFailedRateLimited: t('console.ai.sendFailedRateLimited', {
            defaultValue:
              "You're sending messages too quickly. Your message is kept below — wait a moment and try again.",
          }),
          sendFailedGeneric: t('console.ai.sendFailedGeneric', {
            defaultValue: "Couldn't send your message. It's kept below — please try again.",
          }),
          trace: t('console.ai.trace'),
          viewTrace: t('console.ai.viewTrace'),
        }}
        // ADR-0028: selectable AI model — ChatbotEnhanced renders the footer
        // <select> only when 2+ models are offered (free / single-model envs
        // see none). The picked model flows to useObjectChat above.
        models={aiModels}
        selectedModelId={effectiveModelId}
        onModelChange={setSelectedModelId}
        allowanceUsedFraction={allowanceUsedFraction}
        suggestions={suggestions}
        renderEmptyState={renderEmptyState}
        onSendMessage={handleSend}
        // objectstack#32749 — the attach button and the attachment chips: the
        // send reads spreadsheets, images and PDFs (see `doSend`), and a file
        // pasted or dropped without them was attached unseen.
        enableFileUpload
        onClear={clear}
        hideClearBar
        onStop={isLoading ? stop : undefined}
        onReload={reload}
        // objectstack#34462 — busy while a turn's attachments are still being
        // read, too: a message typed then queues behind that turn.
        isLoading={isLoading || preparingTurn}
        // objectstack#33420 — a failed create is a send that never left the
        // client: the composer's not-sent notice and text restore answer it.
        error={conversationCreateError ?? (errorSuppressed ? undefined : error)}
        // objectstack#33562 — what that failed create held back is the whole
        // held first message: a second send made during the wait joined it, and
        // the composer only knows the part it last submitted. Read in the
        // render the error arrives in, before the held message is dropped.
        unsentText={conversationCreateError ? heldFirstMessage?.content : undefined}
        enableMarkdown
        onToolApprove={hitl.decide}
        toolDecisions={hitl.decisions}
        // objectui#11667 — the inline HITL decision card. The two buttons borrow
        // the AI Approvals inbox's keys: the same decision on the same pending
        // action through the same endpoint, so the two surfaces say it alike.
        toolApproveLabel={t('aiApprovals.approveAndExecute')}
        toolDenyLabel={t('aiApprovals.reject')}
        // The deny reason is stored as the pending action's `rejection_reason`
        // and read as prose: by people in the AI Approvals inbox (which writes
        // free text in any language into the same field) and by the model on
        // its next turn. No code parses it, so it follows the UI locale.
        toolDenyReason={t('console.ai.toolDenyReason')}
        // The page chip (see `surfaceChipLabel` above); the focus row draws it
        // instead while the agent honours a focus (objectstack#36999).
        surfaceContextLabel={focusRow ? undefined : surfaceChipLabel}
        surfaceContextTitle={focusRow ? undefined : surfaceChipTitle}
        data-testid="ai-chat-panel"
      />
      </div>
    </div>
  );
}
