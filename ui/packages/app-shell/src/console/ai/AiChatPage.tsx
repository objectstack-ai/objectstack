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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { CONSOLE_FULL_HEIGHT } from '../../layout/chromeBannerHost.js';
import { translateMetadataType } from '../../views/metadata-admin/i18n.js';
import { resolvePublicShareBase } from '../organizations/resolveHomeUrl.js';
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
  ShareDialog,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@object-ui/components';
import { PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Share2 } from 'lucide-react';
import {
  ChatbotEnhanced,
  useObjectChat,
  useAiModels,
  useHitlInChat,
  detectRecordHandoff,
  detectRecordWrite,
  detectAnswerSource,
  detectSampleDataCleanup,
  detectPackageRemoval,
  storedAnswerData,
  // The authoring/honest -> runtime message seam (objectui#4399 / PR #4416),
  // consumed here one hop up from the plugin's own renderers (objectui#4437).
  // See `runtimeMessages` below for why this host calls it exactly once.
  toRuntimeMessages,
  type ChatbotEnhancedToolInvocation,
  // The ENHANCED message shape — the one `<ChatbotEnhanced>` renders and the
  // one this file actually produces (`toolInvocations`, `charts`).
  //
  // `ChatbotEnhancedMessage` is the plugin's one name for its RUNTIME
  // chat-message contract, not an alias of anything. The plugin root publishes
  // no `ChatMessage` at all, so the bare name means only the `@object-ui/types`
  // AUTHORING contract (objectui#6349, batch 5). The `as ChatMessage` below is
  // a local rename only; this file never imports the authoring type.
  // History: the barrel once DECLARED a second, minimal `ChatMessage` of its
  // own (id/role/content/timestamp/avatar only) and the natural name resolved
  // to it, which is how this file once could not read `toolInvocations` off
  // its own function's return (objectui#4040; retired in objectui#4383 / PR
  // #4400). Pinned in the plugin's `chat-message-contract.test.ts`.
  type ChatFilePart,
  type ChatbotEnhancedMessage as ChatMessage,
} from '@object-ui/plugin-chatbot';
// The side-effect-free names come through `/core` like every other app-shell
// import of them, so a test stubs each in one place (objectui#13410).
import {
  useAgents,
  resolveDefaultAgentName,
  PLATFORM_DEFAULT_AGENT,
  agentRouteName,
  resolveAgentParam,
  isBuiltinAgentName,
  agentHasCapability,
  isAskAgent,
  detectPendingApproval,
  type AgentDescriptor,
} from '@object-ui/plugin-chatbot/core';

import { AppHeader } from '../../layout/AppHeader.js';
import { useOpenAssistant } from '../../layout/chatDockControl.js';
import { CONSOLE_TOP_BAR } from '../../layout/consoleTopBar.js';
import { armChatDockExpanded, readDockReturnLocation } from '../../layout/chatDockState.js';
import type { ChatSurfaceContext } from '../../layout/chatSurfaceContext.js';
import { buildFocusContext, useConversationFocus, type ConversationFocus } from '../../layout/chatFocus.js';
import { ChatFocusRow } from './ChatFocusRow.js';
import {
  useAdvertiseShortcut,
  type AdvertisedShortcut,
  type ShortcutLabelTranslate,
} from '../../chrome/advertisedShortcuts.js';
import { getUpgradeUrl } from '../../runtime-config.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { cloudConsoleUrl } from '../marketplace/marketplaceApi.js';
import { useNavigationContext } from '../../context/NavigationContext.js';
import {
  fetchConversation,
  sanitizeChatMessagesForCache,
  useChatConversation,
  writeConversationMessagesCache,
  type HydratedUIMessage,
  type HydratedUIMessagePart,
} from '../../hooks/useChatConversation.js';
import { useReconcileOnError } from '../../hooks/useReconcileOnError.js';
import { useAiUsage } from '../../hooks/useAiUsage.js';
import { chatConversationScope, chatProductOfAgent } from '../../hooks/chatScope.js';
import { ConversationsSidebar } from './ConversationsSidebar.js';
import { isConversationZh } from './conversationLanguage.js';
import { resolveAttachmentNoteText, type AttachmentNoteKey } from './outboundAgentText.js';
import { resolveApiBase } from './resolveApiBase.js';
import { appOfObject } from './appOfObject.js';
import { RECORD_SECTION_OPENED_STATE, RECORD_SECTION_PARAM } from '../../urlParams.js';
import { AiUnavailable } from './AiUnavailable.js';
import { recordWriteFormTarget } from '../../utils/recordFormAiDraft.js';
import { useUpload } from '@object-ui/fields';
import { isSpreadsheetAttachment, uploadChatAttachments, chatAttachmentNotes } from './chatAttachments.js';

/**
 * objectstack#31869 — the console address of the list a chat list link names:
 * `/apps/APP/OBJECT`, plus `view` and the Filter panel conditions under the
 * list route's own `uf__filter` param when the link carried them. Built from
 * the parsed values, so nothing of the href's own query string is forwarded.
 */
export function listLinkTarget(
  app: string,
  target: { objectName: string; view?: string; filter?: { logic: 'and' | 'or'; conditions: unknown[] } },
): string {
  const params = new URLSearchParams();
  if (target.view) params.set('view', target.view);
  if (target.filter) {
    params.set('uf__filter', JSON.stringify({ logic: target.filter.logic, conditions: target.filter.conditions }));
  }
  const query = params.toString();
  return `/apps/${encodeURIComponent(app)}/${encodeURIComponent(target.objectName)}${query ? `?${query}` : ''}`;
}

/**
 * cloud#1658, ADR-0160 D9 — the console address of a record the chat opens:
 * `/apps/APP/OBJECT/record/ID`, plus `?section=ANCHOR` (`RECORD_SECTION_PARAM`)
 * when a record citation names a section of the record's body. A link with no
 * anchor (an `open_record` hand-off, a record link in an answer) opens the
 * record as before.
 */
export function recordOpenTarget(
  app: string,
  target: { objectName: string; recordId: string; anchor?: string },
): string {
  const path = `/apps/${encodeURIComponent(app)}/${encodeURIComponent(target.objectName)}/record/${encodeURIComponent(target.recordId)}`;
  if (!target.anchor) return path;
  return `${path}?${new URLSearchParams({ [RECORD_SECTION_PARAM]: target.anchor }).toString()}`;
}

let sectionOpenings = 0;

/** A history-state value no earlier chip click of this page load carried. */
function nextSectionOpening(): string {
  sectionOpenings += 1;
  return `${Date.now().toString(36)}.${sectionOpenings}`;
}

function partString(part: HydratedUIMessagePart, key: string): string | undefined {
  const value = part[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The AI SDK approval envelope as the server persisted it on a tool part.
 *
 * `HydratedUIMessagePart` is an open record, so the envelope is REACHABLE here
 * but unverified. This narrows it to the declared shape and drops what does not
 * match rather than asserting a cast: `id` is the envelope's only required
 * member, so a value without a usable one is not an envelope at all.
 */
function partApproval(
  part: HydratedUIMessagePart,
): NonNullable<ChatbotEnhancedToolInvocation['approval']> | undefined {
  const raw = part.approval;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const envelope = raw as Record<string, unknown>;
  const id = envelope.id;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return {
    id,
    ...(typeof envelope.approved === 'boolean' ? { approved: envelope.approved } : {}),
    ...(typeof envelope.reason === 'string' ? { reason: envelope.reason } : {}),
    ...(typeof envelope.isAutomatic === 'boolean' ? { isAutomatic: envelope.isAutomatic } : {}),
    ...(typeof envelope.signature === 'string' ? { signature: envelope.signature } : {}),
  };
}

function partToolState(part: HydratedUIMessagePart): ChatbotEnhancedToolInvocation['state'] | undefined {
  const state = partString(part, 'state');
  switch (state) {
    // Hydrated history is never a live stream: the turn that drove these
    // tools has ENDED, so a dangling mid-stream state means the terminal
    // state was never snapshotted server-side — promote to Completed or a
    // reloaded conversation shows every tool "Running" forever (the
    // same incident mapMessages fixed for the floating-chat path).
    case 'input-streaming':
    case 'input-available':
      return 'output-available';
    case 'approval-requested':
    case 'approval-responded':
    case 'output-available':
    case 'output-error':
    case 'output-denied':
      return state;
    default:
      // No state at all: server-side conversations persist ModelMessage
      // `tool-call` content entries, which carry no UI state — contentToParts
      // passes them through as `tool-call` parts verbatim. In hydrated
      // history that turn has ended too, so stateless ≡ completed; returning
      // undefined here leaves the invocation state-less and the chip renders
      // "Running" forever (the live-verified gap left by the first fix).
      return 'output-available';
  }
}

/** Exported for tests — maps persisted/cached history to renderable messages. */
export function hydratedMessagesToChatMessages(messages: HydratedUIMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const toolInvocations: ChatbotEnhancedToolInvocation[] = [];
    const content = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('');

    if (message.role === 'assistant') {
      for (const part of message.parts) {
        if (!part.type.startsWith('tool-')) continue;
        const toolName = partString(part, 'toolName') ?? part.type.slice('tool-'.length);
        const toolCallId = partString(part, 'toolCallId') ?? `${message.id}-${toolName}`;
        const state = partToolState(part);
        // The tool RESULT (merged onto the call part by toUIMessages from the
        // separate `tool` row) carries the structured envelopes the cards read.
        // Each is lifted here as the live floating-chat mapper
        // (extractToolInvocations) lifts it, so a card survives a reload or a
        // cache restore.
        const result =
          (part as { output?: unknown }).output ?? (part as { result?: unknown }).result;
        const recordHandoff = detectRecordHandoff(result);
        // cloud#3565 — the record-write card rides the pending approval the
        // id below is lifted from; it must survive a reload like the rest.
        const recordWrite = detectRecordWrite(result);
        // objectstack#31868 — the data tools' `source` block, drawn as the
        // turn's "How this was computed" block; lifted here as the live mapper
        // lifts it, so the block survives a reload or a cache restore.
        const answerSource = detectAnswerSource(result);
        const sampleDataCleanup = detectSampleDataCleanup(result);
        const packageRemoval = detectPackageRemoval(result);
        // objectui#8442 — the two halves of an actionable approval, dropped
        // here until now, and they arrive from DIFFERENT places:
        //   * the AI SDK's `approval` envelope rides the persisted PART (the
        //     SDK's tool-part union requires it alongside the three approval
        //     states this mapper already carries through);
        //   * the ObjectStack `pendingActionId` rides the tool RESULT and is
        //     never persisted as a part key, so it is derived with the same
        //     detector the live mapper uses — one parse, so the hydrated path
        //     cannot disagree with the live one about the same envelope.
        // Without the id, `useHitlInChat` never indexes the invocation and the
        // operator's Approve / Reject has nothing to call.
        const approval = partApproval(part);
        // objectui#9232 — the envelope still decides wherever it has anything
        // to say; the part key is only consulted when it does not. That order
        // is what keeps this a single contract rather than two dialects: on the
        // SERVER path the id exists only inside the result, so `??` never
        // reaches its right-hand side and this line behaves exactly as
        // objectui#8442 left it. The fallback exists for the CACHE path, where
        // `output` holds one envelope and a turn carrying both another envelope
        // and a pending approval has to put that envelope there — leaving the part key as
        // the only place the id can ride. `sanitizeChatMessagesForCache` is the
        // only writer of that key.
        const pendingActionId =
          detectPendingApproval(result)?.pendingActionId ?? partString(part, 'pendingActionId');
        toolInvocations.push({
          toolCallId,
          toolName,
          ...(state ? { state } : {}),
          ...(result !== undefined ? { result } : {}),
          ...(approval ? { approval } : {}),
          ...(pendingActionId ? { pendingActionId } : {}),
          ...(recordHandoff ? { recordHandoff } : {}),
          ...(recordWrite ? { recordWrite } : {}),
          ...(answerSource ? { answerSource } : {}),
          ...(sampleDataCleanup ? { sampleDataCleanup } : {}),
          ...(packageRemoval ? { packageRemoval } : {}),
          ...(part.errorText ? { errorText: String(part.errorText) } : {}),
        });
      }
    }

    // objectstack#25908 — the answer's charts, read off the `data-chart`
    // parts the cache wrote or the `visualize_data` results the server
    // persisted, each at the offset into `content` where its part sat. The
    // live stream's chart part is never stored, so this is the only way a
    // chart survives a reload.
    // objectstack#37487 — with every other kept data part
    // (`STORED_ANSWER_DATA_PARTS`): the persisted, already-verified
    // `data-record-citations` list, drawn again as chips, never re-verified.
    const { charts, recordCitations } =
      message.role === 'assistant' ? storedAnswerData(message.parts) : {};

    return {
      id: message.id,
      role: message.role,
      content,
      ...(toolInvocations.length > 0 ? { toolInvocations } : {}),
      ...(charts ? { charts } : {}),
      ...(recordCitations ? { recordCitations } : {}),
    };
  });
}

function firstUserMessageText(messages: HydratedUIMessage[]): string | undefined {
  const message = messages.find((item) => item.role === 'user');
  const text = message?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  return text || undefined;
}

// Keyed by the FRIENDLY agent name (alias-group head) so the new id, the legacy
// id, and the route segment all localize to the same label.
const PLATFORM_AGENT_LABEL_KEYS: Record<string, { key: string; defaultValue: string }> = {
  ask: { key: 'console.ai.agentLabels.ask', defaultValue: 'Ask' },
};

function localizeAgentLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  agentName: string | undefined,
  fallback: string,
): string {
  const known = agentName ? PLATFORM_AGENT_LABEL_KEYS[agentRouteName(agentName)] : undefined;
  if (!known) return fallback;
  return t(known.key, { defaultValue: known.defaultValue });
}

/**
 * Per-surface empty-state branding: the Ask surface reads as data Q&A ("ask
 * about your records"). Keyed by friendly name; falls back to the generic
 * empty state for custom agents.
 */
export function agentEmptyState(
  t: (key: string, options?: Record<string, unknown>) => string,
  agentName: string | undefined,
): { title: string; description: string } {
  if (isAskAgent(agentName)) {
    return {
      title: t('console.ai.empty.ask.title', { defaultValue: 'Ask your data' }),
      description: t('console.ai.empty.ask.description', {
        defaultValue:
          'Ask questions about your records — counts, lists, and summaries across the data you can access.',
      }),
    };
  }
  return {
    title: t('console.ai.emptyTitle', { defaultValue: 'Start a conversation' }),
    description: t('console.ai.emptyDescription', {
      defaultValue: 'Ask anything — the assistant has access to your current app context.',
    }),
  };
}

// Lives in `./resolveApiBase` so the eagerly loaded dock chrome can call it
// without importing this module (objectui#13410); re-exported unchanged.
export { resolveApiBase };

export interface AiChatPageProps {
  /** Override the resolved AI service base URL. */
  apiBase?: string;
  /** Default agent to select on first render. */
  defaultAgent?: string;
}

const CHATS_COLLAPSED_STORAGE_KEY = 'ai-chats-collapsed';

export interface CollapsibleChatsList {
  /** Whether the desktop conversations list is currently hidden. */
  collapsed: boolean;
  /** User-driven collapse/expand; persists the preference. */
  toggle: () => void;
}

/**
 * State for the collapsible desktop conversations list. Exported for tests.
 * `toggle()` flips it and PERSISTS the preference (localStorage).
 *
 * objectstack#34610 — the Live Canvas split that used to tuck the list away
 * while a preview was open is gone (the draft is the main area now), so the
 * user's toggle is the only driver.
 */
export function useCollapsibleChatsList(): CollapsibleChatsList {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHATS_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHATS_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* private mode / disabled storage — preference just won't persist */
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

export type AiChatShortcut = 'toggle-list' | 'new-chat';

/**
 * Match a keydown to an AI-chat shortcut, mirroring ChatGPT/Claude:
 *  - ⌘/Ctrl+Shift+O → new chat
 *  - ⌘/Ctrl+Shift+S → toggle the conversations list
 *
 * Both use the ⌘/Ctrl+Shift modifier so they're safe to fire even while the
 * composer is focused (they can't be produced by ordinary typing). Pure +
 * exported for tests.
 */
export function matchAiChatShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): AiChatShortcut | null {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'o':
      return 'new-chat';
    case 's':
      return 'toggle-list';
    default:
      return null;
  }
}

/**
 * The two {@link matchAiChatShortcut} chords, advertised to the
 * keyboard-shortcuts dialog by `AiChatPage` beside the listener that calls it,
 * so they are listed only where that page is mounted (objectui#11674).
 */
export const NEW_CHAT_SHORTCUT: AdvertisedShortcut = {
  id: 'ai-new-chat',
  group: 'aiChat',
  chord: { key: 'o', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.newChat'),
};

export const TOGGLE_CHATS_LIST_SHORTCUT: AdvertisedShortcut = {
  id: 'ai-toggle-chats-list',
  group: 'aiChat',
  chord: { key: 's', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.toggleChatsList'),
};

/**
 * ADR-0057 P3c — where the "collapse to dock" affordance navigates, in
 * preference order:
 *
 *  1. The REMEMBERED maximize origin (`storedPath`, written by the dock's own
 *     maximize handlers at click time) — the exact page the user left, immune
 *     to in-page history churn (conversation switches push `/ai/...` entries,
 *     so blind history-back can land on a prior `/ai` URL instead of the
 *     console).
 *  2. History back, when react-router has an in-app entry to return to
 *     (`window.history.state.idx > 0` — the router stamps a monotonically
 *     increasing `idx` on entries it creates).
 *  3. `homePath` — the page was the entry point (deep link, fresh tab).
 *
 * `homePath` is a PARAMETER, not a literal, since objectui#7373: home is
 * whatever the deployment declared (`useHomePath()` at the call site), and on a
 * control plane the environment launcher is the wrong screen to land a customer
 * on. Required rather than defaulted, so a new call site cannot silently
 * reintroduce the literal this card removed.
 *
 * The dock itself is armed to open expanded separately
 * ({@link armChatDockExpanded}); this only picks the landing. Pure + exported
 * for tests.
 */
export function resolveCollapseToDockTarget(
  historyIdx: unknown,
  storedPath: string | undefined,
  homePath: string,
): string | -1 {
  if (storedPath) return storedPath;
  return typeof historyIdx === 'number' && historyIdx > 0 ? -1 : homePath;
}

/** A composer submission held until the conversation id that will carry it exists. */
/** Stable empty array for the stale-scope window (#2450) — a fresh `[]` per
 *  render would churn the pane's `initialMessages` identity for no reason. */
const EMPTY_INITIAL_MESSAGES: HydratedUIMessage[] = [];

// objectui#12493 — the ADR-0057 P4 Builder handoff travels as navigation state
// (or an in-memory drawer call), never in a URL: `BuilderHandoffState` and its
// reader live with the drawer's target grammar (objectstack#34608).

export interface PendingFirstMessage {
  content: string;
  files?: File[];
  /**
   * #2450 — the agent surface this stash is FOR (e.g. `'build'` for the
   * ADR-0057 handoff seed). The replay refuses to consume it in a pane bound to
   * a different agent, so a stash targeted at the Builder can never be eaten by
   * (and die in) an ask-surface pane mid route-transition. Absent = untargeted
   * (a user-typed first send), consumed by whichever pane replays first —
   * unchanged behavior.
   */
  targetAgentRoute?: string;
}

/**
 * Guards the empty-state FIRST send against the conversation-id remount race.
 *
 * On a fresh `/ai/:agent` the composer (and its suggestion chips) go live the
 * instant the agent resolves — BEFORE `POST /conversations` has minted the id.
 * `<ChatPane>` is keyed on that id (`…:pending` → `…:<id>`), so the moment it
 * resolves React UNMOUNTS the pane and mounts a fresh one. A first message
 * submitted in that window lives inside the doomed pane: its optimistic bubble
 * is discarded and the just-started `…/chat` request is aborted before it
 * reaches the wire — so it vanishes silently (input cleared, no bubble, no
 * error). Distinct from the #2047 path, where `…/chat` WAS sent and failed.
 *
 * The fix: when we have a server endpoint but no id yet, stash the send in a ref
 * the PAGE owns (so it outlives the pane remount) and replay it the moment an id
 * exists — in the freshly-mounted pane (or in place if no remount happened). A
 * send made once the id is present (the normal path, and every send after the
 * first) goes straight through. Local/echo mode (no `chatApi`) also sends
 * immediately, so the offline-demo bot keeps responding.
 *
 * Exported for unit testing.
 */
/** Two attachments are one file when they are the same object, or agree on name, size, type and lastModified. */
function isSameFile(a: File, b: File): boolean {
  return (
    a === b ||
    (a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified)
  );
}

/**
 * objectstack#32984 — is this submit a repeat of the held first message? The
 * same text and the same files, file for file; anything that differs joins.
 */
function isSameFirstSend(held: PendingFirstMessage, content: string, files?: File[]): boolean {
  const a = held.files ?? [];
  const b = files ?? [];
  return content === held.content && a.length === b.length && a.every((f, i) => isSameFile(f, b[i]));
}

export function useDeferredFirstSend(opts: {
  /** The chat endpoint — defined once an agent is resolved (server-backed mode). */
  chatApi: string | undefined;
  /** The conversation id; undefined while `POST /conversations` is in flight. */
  conversationId: string | undefined;
  /** Page-owned stash that OUTLIVES the keyed `<ChatPane>` remount. */
  pendingRef: React.MutableRefObject<PendingFirstMessage | null>;
  /** The real send (resetSuppression + sendMessage + onSent). */
  doSend: (content: string, files?: File[]) => void;
  /**
   * Bumped by the PAGE whenever it sets `pendingRef` out of band (the ADR-0057
   * handoff seed). Refs don't trigger effects, so without this the replay only
   * re-runs on id / doSend changes — and a seed that lands AFTER the id resolves
   * (the async agent-catalog race) would never fire (the swallow). Listing it in
   * the replay deps makes the seed reliably replay.
   */
  pendingSignal?: number;
  /**
   * #2450 — the agent surface THIS pane is bound to (route name, e.g.
   * `'build'`). A pending message stamped with a `targetAgentRoute` is only
   * consumed when it matches; a mismatched pane HOLDS the stash untouched so
   * the correctly-bound pane can replay it after the route transition settles.
   */
  agentRoute?: string;
  /**
   * objectstack#32031 — creates the conversation on the first send
   * (`useChatConversation().ensureConversation`). The host no longer mints a
   * row on mount, so a stash with no id ASKS for one: from the send itself,
   * and from the replay effect for a stash seeded out of band (the handoff).
   * Idempotent on the host side, so calling it again while the create is on
   * the wire makes no second row. Absent = wait for an id someone else makes.
   */
  ensureConversation?: () => unknown;
  /**
   * objectstack#33420 — told which message the user sent is waiting in the
   * stash (`null` once it is replayed or rolled back), so the pane draws it at
   * once. A stash targeted at an agent surface (the handoff seed) is not one
   * the user sent here, and is never reported. Also called on mount with the
   * stash a replaced pane left behind, so the message stays drawn across the
   * id-keyed remount.
   */
  onHeldChange?: (held: PendingFirstMessage | null) => void;
  /**
   * objectstack#33420 — the host's create failure (`useChatConversation`'s
   * `createError`). A new one drops the user's held message: it was never
   * sent, and the composer puts its text back in the box (the not-sent
   * rollback), so keeping it would send it twice with the next attempt.
   * objectstack#33562 — the box gets the whole held message, joined parts
   * included: the pane hands it to the composer as its `unsentText`.
   */
  createError?: Error;
}): (content: string, files?: File[]) => void {
  const { chatApi, conversationId, pendingRef, doSend, pendingSignal, agentRoute, ensureConversation, onHeldChange, createError } = opts;
  const apiMode = Boolean(chatApi);
  // Read through a ref: the replay effect must not re-run (or depend for
  // correctness) on the identity of a host callback — ui/AGENTS.md #10. Synced
  // in a layout effect, which runs before the replay effect below.
  const ensureConversationRef = useRef(ensureConversation);
  const onHeldChangeRef = useRef(onHeldChange);
  useLayoutEffect(() => {
    ensureConversationRef.current = ensureConversation;
    onHeldChangeRef.current = onHeldChange;
  }, [ensureConversation, onHeldChange]);
  // Only a committed pane is told: a send can reach a render React has not
  // committed (or has thrown away), and a state update there loses the render
  // the stash belongs to. The mount report below covers that pane once it commits.
  const committedRef = useRef(false);
  useLayoutEffect(() => {
    committedRef.current = true;
    return () => {
      committedRef.current = false;
    };
  }, []);
  const reportHeld = useCallback(() => {
    if (!committedRef.current) return;
    const held = pendingRef.current;
    onHeldChangeRef.current?.(held && !held.targetAgentRoute ? held : null);
  }, [pendingRef]);

  // A message held over from the pane this one replaced is drawn before the
  // first paint, so the id-keyed remount never shows an empty thread.
  useLayoutEffect(() => {
    if (apiMode && pendingRef.current) reportHeld();
  }, [apiMode, pendingRef, reportHeld]);

  // The create failed: the user's held message goes (its text is restored to
  // the composer by the host's not-sent rollback). A handoff seed is kept.
  useEffect(() => {
    if (!createError) return;
    const held = pendingRef.current;
    if (!held || held.targetAgentRoute) return;
    pendingRef.current = null;
    onHeldChangeRef.current?.(null);
  }, [createError, pendingRef]);

  // Replay a deferred first message the instant a conversation id exists — in
  // the freshly-mounted pane after the remount, or in place if none happened.
  // Clearing the ref before sending makes the replay fire at most once even
  // though `doSend` (and StrictMode's double-invoke) re-run this effect.
  useEffect(() => {
    if (!apiMode) return;
    const pending = pendingRef.current;
    if (!pending) return;
    // #2450 — a targeted stash (the handoff seed) must not be consumed by a
    // pane bound to another agent: mid ask→build transition a doomed pane can
    // replay first, and a send issued there dies with its unmount before it
    // reaches the wire. Hold the stash; the matching pane replays it.
    if (pending.targetAgentRoute && pending.targetAgentRoute !== agentRoute) return;
    // objectstack#32031 — no id yet: this stash is the first send, so ask the
    // host to create the conversation (covers a stash seeded out of band, which
    // never passed through the send callback below). Its id re-runs this effect.
    if (!conversationId) {
      void ensureConversationRef.current?.();
      return;
    }
    // objectstack#32031 — replay on the next task, never inside this effect.
    // The chat runtime stops its in-flight request when the pane's effects are
    // torn down (`useChat`'s cleanup calls `chat.stop()`), and React tears them
    // down right after this first run whenever it re-runs effects on mount
    // (StrictMode, i.e. every dev build) — so a send issued here was aborted
    // before it reached the wire and the first message vanished. That only
    // happened in the old race window; with the row created by the first send
    // it would be every first message. The timer is cleared with the effect,
    // so the replay fires once, from the pane whose effects stayed up; a pane
    // unmounted for real leaves the stash for the next one.
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      onHeldChangeRef.current?.(null);
      doSend(pending.content, pending.files);
    }, 0);
    return () => clearTimeout(timer);
  }, [apiMode, conversationId, pendingRef, doSend, pendingSignal, agentRoute]);

  return useCallback(
    (content: string, files?: File[]) => {
      // Server-backed, but the id is still being minted: sending now would be
      // lost — a convId-less `/chat` the server won't persist, or a request torn
      // down when the pane remounts as the id resolves. Stash it; the effect
      // above replays it once the id lands.
      if (apiMode && !conversationId) {
        // objectstack#32031 — the first send is now what creates the
        // conversation, so the create is on the wire for a moment after every
        // first send. A second submit inside that moment must not replace the
        // first message (it would be lost); the first one stands and is
        // replayed once the id lands, and the host's create is shared, so no
        // second row is made either. (A held handoff seed is still replaced
        // by what the user typed, as before.)
        // objectstack#32984 — nor may the second one vanish: it used to be
        // dropped without a word. It joins the held first message, which has
        // not left the client yet, so both reach the agent as the first turn.
        // A repeat of the held message (a doubled submit event: the same
        // text AND the same files) is not sent twice.
        const held = pendingRef.current;
        if (!held || held.targetAgentRoute) pendingRef.current = { content, files };
        else if (!isSameFirstSend(held, content, files)) {
          const heldFiles = held.files ?? [];
          const joined = [
            ...heldFiles,
            ...(files ?? []).filter((f) => !heldFiles.some((h) => isSameFile(h, f))),
          ];
          pendingRef.current = {
            content: [held.content, content].filter((part) => part.trim() !== '').join('\n\n'),
            files: joined.length > 0 ? joined : undefined,
          };
        }
        reportHeld();
        void ensureConversationRef.current?.();
        return;
      }
      doSend(content, files);
    },
    [apiMode, conversationId, pendingRef, doSend, reportHeld],
  );
}

/** Composer text a `…:pending` pane hands to the pane that replaces it. */
interface ComposerDraftHandoff {
  text: string;
  /** The chat endpoint the text was typed for. */
  chatApi: string | undefined;
  /** The conversation the host was asking for when the text was last typed. */
  requestedConversationId: string | undefined;
  /** The replaced box had focus, so typing goes on in the new one. */
  focused: boolean;
}

/**
 * Keyed by the host's page-owned first-message stash: the one object a host
 * keeps across the pane's id-keyed remount, and its own, so two hosts never
 * trade drafts. An entry lives for one commit only (see
 * {@link useComposerDraftHandoff}).
 */
const composerDraftHandoffs = new WeakMap<object, ComposerDraftHandoff>();

/**
 * objectstack#33674 — the text typed (and not sent) into the composer of a
 * pane that does not know its conversation yet survives the remount that
 * follows when the id lands: the conversation GET of a deep link answering, or
 * the create of a new conversation answering. `<ChatPane>` stays keyed on the
 * id, because everything else in it (the chat runtime, its messages) belongs
 * to one conversation; only the composer's text is carried.
 *
 * The replaced pane writes the text as it unmounts and the new pane reads it
 * as it mounts. React runs both in the same commit, so the hand-off is never
 * read later: a microtask drops an entry no pane took. Only a pending pane
 * hands text on, and only to a pane on the same endpoint whose host still asks
 * for the conversation it asked for when the text was last typed, so opening
 * another conversation leaves the draft behind, as before. The new box gets
 * the same text with the cursor at its end, and focus when the old box had it.
 * Nothing is sent.
 *
 * Returns the composer's `onInputChange`, which records what the host was
 * asking for when the user typed.
 */
export function useComposerDraftHandoff(opts: {
  /** The host's page-owned stash (`pendingFirstMessageRef`), the hand-off's key. */
  hostStash: object;
  /** The pane's root element; the composer is the `message` textarea inside it. */
  containerRef: React.RefObject<HTMLElement | null>;
  chatApi: string | undefined;
  conversationId: string | undefined;
  /** The conversation the host asks `useChatConversation` for (its `activeId`). */
  requestedConversationId: string | undefined;
}): () => void {
  const { hostStash, containerRef, chatApi, conversationId, requestedConversationId } = opts;
  const requestedRef = useRef(requestedConversationId);
  const typedForRef = useRef(requestedConversationId);
  useLayoutEffect(() => {
    requestedRef.current = requestedConversationId;
  }, [requestedConversationId]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const composerBox = () => container?.querySelector<HTMLTextAreaElement>('textarea[name="message"]') ?? null;
    const handoff = composerDraftHandoffs.get(hostStash);
    composerDraftHandoffs.delete(hostStash);
    if (
      handoff &&
      conversationId &&
      handoff.chatApi === chatApi &&
      handoff.requestedConversationId === requestedRef.current
    ) {
      const box = composerBox();
      if (box && box.value === '') {
        box.value = handoff.text;
        box.setSelectionRange(handoff.text.length, handoff.text.length);
        if (handoff.focused) box.focus();
      }
    }
    return () => {
      if (conversationId) return;
      const box = composerBox();
      if (!box || box.value.trim() === '') return;
      const entry: ComposerDraftHandoff = {
        text: box.value,
        chatApi,
        requestedConversationId: typedForRef.current,
        focused: box.ownerDocument.activeElement === box,
      };
      composerDraftHandoffs.set(hostStash, entry);
      queueMicrotask(() => {
        if (composerDraftHandoffs.get(hostStash) === entry) composerDraftHandoffs.delete(hostStash);
      });
    };
  }, [hostStash, containerRef, chatApi, conversationId]);
  return useCallback(() => {
    typedForRef.current = requestedRef.current;
  }, []);
}

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
  // first turn must still carry the record the user pinned.
  const conversationFocus = useConversationFocus(paneConversationId, conversationCreateError);
  // A first send creates the conversation: the id it mints takes the focus
  // pinned before it (and no other arriving id does).
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

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

function dataChatSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.dataChat.userCount', { defaultValue: 'How many users are in the system? List their emails.' }),
    t('console.ai.suggestions.dataChat.recentRecords', { defaultValue: 'List the 5 most recently created records.' }),
    t('console.ai.suggestions.dataChat.recordCounts', { defaultValue: 'Count records for each object.' }),
  ];
}

function genericSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.generic.help', { defaultValue: 'What can you help me with?' }),
    t('console.ai.suggestions.generic.availableObjects', { defaultValue: 'List the available data objects.' }),
    t('console.ai.suggestions.generic.recentActivity', { defaultValue: 'Summarize my recent activity.' }),
  ];
}

export function buildAgentSuggestions(
  agentName: string | undefined,
  agentLabel: string,
  t: TranslationFn,
): string[] {
  // Alias-aware: `ask`/`data_chat` → data starters. Custom agents fall back to
  // a name/label heuristic.
  if (isAskAgent(agentName)) return dataChatSuggestions(t);
  const lower = (agentName ?? agentLabel).toLowerCase();
  if (lower.includes('data')) return dataChatSuggestions(t);
  return genericSuggestions(t);
}

export default AiChatPage;
