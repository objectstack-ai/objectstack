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
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { useServedAppLabel } from '../../hooks/useServedAppLabel.js';
import { toast } from 'sonner';
import { Package as PackageIcon, Sparkles as SparklesIcon } from 'lucide-react';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { isPlatformBuiltinApp } from '../../utils/platformApp.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { formatPublishFailures, type PublishFailure } from '../../views/studio-design/metadataError.js';
import { useMetadataClient } from '../../views/metadata-admin/useMetadata.js';
import { translateMetadataType } from '../../views/metadata-admin/i18n.js';
import { useMetadataLocale } from '../../views/metadata-admin/i18n.js';
import { fieldTypeName } from '../../views/metadata-admin/previews/fieldTypeName.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import { resolveKeyedI18nLabel } from '../../utils/index.js';
import { resolvePublicShareBase } from '../organizations/resolveHomeUrl.js';
import { ExcelImportBar } from './ExcelImportBar.js';
import { useChangeCardLabels } from './changeCardLabels.js';
import { PendingDraftsBar } from './PendingDraftsBar.js';
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  cn,
} from '@object-ui/components';
import { Bug, Check, ChevronDown, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Share2 } from 'lucide-react';
import {
  ChatbotEnhanced,
  useObjectChat,
  useAiModels,
  useHitlInChat,
  detectDraftResult,
  detectProposedPlan,
  detectBuilderHandoff,
  detectRecordHandoff,
  detectRecordWrite,
  detectAnswerSource,
  detectSampleDataCleanup,
  detectPackageRemoval,
  detectProposedChanges,
  detectReplayOutcome,
  detectAuthoringVerdict,
  detectBuiltAppPackage,
  buildProgressFromDraftReview,
  chartsFromParts,
  // The authoring/honest -> runtime message seam (objectui#4399 / PR #4416),
  // consumed here one hop up from the plugin's own renderers (objectui#4437).
  // See `runtimeMessages` below for why this host calls it exactly once.
  toRuntimeMessages,
  type ChatbotEnhancedToolInvocation,
  // The ENHANCED message shape — the one `<ChatbotEnhanced>` renders and the
  // one this file actually produces (`toolInvocations`, `buildProgress`).
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
  isBuildAgent,
  agentHasCapability,
  isAskAgent,
  publishHealthFromResponse,
  detectPendingApproval,
  type AgentDescriptor,
} from '@object-ui/plugin-chatbot/core';

import { AppHeader } from '../../layout/AppHeader.js';
import { readBuilderHandoffState, type BuilderHandoffState } from '../../layout/chatDockTarget.js';
import { useChatDockControl, useOpenAssistant } from '../../layout/chatDockControl.js';
import { markPreviewExit, usePreviewDrafts } from '../../preview/PreviewModeContext.js';
import { CONSOLE_TOP_BAR } from '../../layout/consoleTopBar.js';
import { armChatDockExpanded, readDockReturnLocation } from '../../layout/chatDockState.js';
import type { ChatSurfaceContext } from '../../layout/chatSurfaceContext.js';
import {
  useAdvertiseShortcut,
  type AdvertisedShortcut,
  type ShortcutLabelTranslate,
} from '../../chrome/advertisedShortcuts.js';
import { fetchPendingDraftCount } from '../../preview/draftStatus.js';
import { appPackageOf } from '../../preview/usePendingDrafts.js';
import { draftPreviewPath } from '../../preview/draftSurface.js';
import {
  emitCanvasInvalidate,
  emitMetadataRefresh,
  publishPlanApprovalPending,
  subscribeMetadataRefresh,
} from '../../assistant/assistantBus.js';
import { getRuntimeConfig, getUpgradeUrl, isAiStudioEnabled } from '../../runtime-config.js';
import { makerConvergedOnBuild, makerVisibleAgents } from '../../hooks/surfaceAgent.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
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
import { mainAreaDraftMove, type MainAreaDraftTarget } from './mainAreaDraft.js';
import { artifactStudioPath } from './artifactStudioPath.js';
import { studioChangesReviewTarget } from '../../views/studio-design/studioChangesLink.js';
import { BuildDebugDrawer } from './BuildDebugDrawer.js';
import { isConversationZh } from './conversationLanguage.js';
import {
  resolveAttachmentNoteText,
  resolveOutboundAgentText,
  type AttachmentNoteKey,
  type OutboundAgentTextKey,
} from './outboundAgentText.js';
import { resolveApiBase } from './resolveApiBase.js';
import { AiUnavailable } from './AiUnavailable.js';
import { recordWriteFormTarget } from '../../utils/recordFormAiDraft.js';
import { useUpload } from '@object-ui/fields';
import { isSpreadsheetAttachment, uploadChatAttachments, chatAttachmentNotes } from './chatAttachments.js';

/**
 * The app segment a record of `objectName` lives under: the object's owning
 * package, read from `/api/v1/meta/object/<name>` (`_packageId`), with `setup`
 * as the fallback shell for an object no package claims. Best-effort: a failed
 * read still lands on the record. Shared by the record hand-off (cloud#1658)
 * and the record-write card's form hand-off (cloud#3565).
 */
async function appOfObject(objectName: string): Promise<string> {
  try {
    const r = await fetch(`/api/v1/meta/object/${encodeURIComponent(objectName)}`, {
      credentials: 'include',
    });
    if (r.ok) {
      const j = (await r.json()) as { item?: { _packageId?: unknown } };
      if (typeof j?.item?._packageId === 'string' && j.item._packageId) return j.item._packageId;
    }
  } catch {
    /* resolution is best-effort; the caller's fallback still lands on the record */
  }
  return 'setup';
}

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
    // reloaded build conversation shows every tool "Running" forever (the
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
    let buildProgress: ReturnType<typeof buildProgressFromDraftReview>;
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
        // separate `tool` row) carries the ADR-0033 draft envelope. Rebuild
        // `draftReview` so the publish / preview / review affordances return,
        // and synthesize the "Built X" panel so the blueprint summary survives
        // a refresh (the live progress bar is transient and not persisted).
        const result =
          (part as { output?: unknown }).output ?? (part as { result?: unknown }).result;
        const draftReview = detectDraftResult(result);
        // The pre-build PLAN (propose_blueprint → blueprint_proposed) rides the
        // same merged tool result; lift it so the "Proposed plan" review card
        // survives a reload on this surface, not just in the floating chat.
        const proposedPlan = detectProposedPlan(result);
        // The ask-agent's structured decline (suggest_builder → build_handoff)
        // and the confirm-before-change preview (changes_proposed) ride the same
        // merged tool result. Lift both so the "Open in Builder →" handoff card
        // and the "确认修改" changes card survive a reload / cache restore — the
        // live floating-chat mapper (extractToolInvocations) already lifts all
        // four; this is its hydration counterpart.
        const builderHandoff = detectBuilderHandoff(result);
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
        const proposedChanges = detectProposedChanges(result);
        // objectui#5695 — a confirm-replay result becomes a terminal state on
        // the original 确认修改 card; it must never rehydrate as an ordinary
        // draft card (a rolled-back publish would get a live Publish button).
        // Mirrors the live mapper's suppression exactly, its one exception
        // included: a drafted whole-app build has no confirm card and keeps
        // its review, so the thread binds to the package it built
        // (objectstack#25887, mapMessages `replayedBuildReview`).
        const replayOutcome = detectReplayOutcome(toolCallId, result);
        const keepsDraftReview =
          !replayOutcome ||
          (replayOutcome.kind === 'drafted' && Boolean(detectBuiltAppPackage(result)));
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
        // `output` holds one envelope and a turn carrying both a draft and a
        // pending approval has to put its draft there — leaving the part key as
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
          ...(draftReview && keepsDraftReview ? { draftReview } : {}),
          ...(proposedPlan ? { proposedPlan } : {}),
          ...(builderHandoff ? { builderHandoff } : {}),
          ...(recordHandoff ? { recordHandoff } : {}),
          ...(recordWrite ? { recordWrite } : {}),
          ...(answerSource ? { answerSource } : {}),
          ...(sampleDataCleanup ? { sampleDataCleanup } : {}),
          ...(packageRemoval ? { packageRemoval } : {}),
          ...(proposedChanges ? { proposedChanges } : {}),
          ...(replayOutcome ? { replayOutcome } : {}),
          ...(part.errorText ? { errorText: String(part.errorText) } : {}),
        });
        if (!buildProgress) {
          const synthesized = buildProgressFromDraftReview(draftReview);
          if (synthesized) buildProgress = synthesized;
        }
      }
    }

    // objectstack#25908 — the answer's charts, read off the `data-chart`
    // parts the cache wrote or the `visualize_data` results the server
    // persisted, each at the offset into `content` where its part sat. The
    // live stream's chart part is never stored, so this is the only way a
    // chart survives a reload.
    const charts = message.role === 'assistant' ? chartsFromParts(message.parts) : undefined;

    return {
      id: message.id,
      role: message.role,
      content,
      ...(toolInvocations.length > 0 ? { toolInvocations } : {}),
      ...(buildProgress ? { buildProgress } : {}),
      ...(charts ? { charts } : {}),
    };
  });
}

/**
 * #2458 / ADR-0057 Amendment A1.a — the package a build conversation is bound to:
 * the explicit `?package=` edit target (ADR-0070) if present, else the most
 * recent package a build/draft in THIS thread produced (`draftReview` /
 * `builderHandoff` tool results, newest wins). `undefined` = not-yet-bound —
 * the magic-flow "New app" draft, which binds the moment its build mints a
 * package. Exported for unit testing.
 */
interface PackageBearingMessage {
  toolInvocations?: ReadonlyArray<{
    draftReview?: { packageId?: string };
    builderHandoff?: { packageId?: string };
  }>;
}
/**
 * objectstack#34610 — what the LAST turn drafted, read off its own tool
 * results: the newest draft review after the last user message, or null when
 * the turn drafted nothing. `items` are what it drafted; `packageId` is the
 * review's (absent when the producer named none); `materialized` is
 * ADR-0045's in-turn build. Exported for tests.
 */
export function turnDraftPackage(
  messages: readonly {
    role?: string;
    toolInvocations?: ReadonlyArray<{
      draftReview?: { packageId?: string; materialized?: boolean; items?: ReadonlyArray<{ type: string; name: string }> };
    }>;
  }[],
): { packageId?: string; materialized?: boolean; items: ReadonlyArray<{ type: string; name: string }> } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') return null;
    const tools = message.toolInvocations ?? [];
    for (let j = tools.length - 1; j >= 0; j--) {
      const dr = tools[j].draftReview;
      if (dr?.items && dr.items.length > 0) {
        return {
          items: dr.items,
          ...(dr.packageId ? { packageId: dr.packageId } : {}),
          ...(dr.materialized ? { materialized: true } : {}),
        };
      }
    }
  }
  return null;
}

export function deriveBoundPackageId(
  messages: readonly PackageBearingMessage[],
  editPackageId: string | undefined,
): string | undefined {
  if (editPackageId) return editPackageId;
  let latest: string | undefined;
  for (const message of messages) {
    for (const tool of message.toolInvocations ?? []) {
      const pkg = tool.draftReview?.packageId || tool.builderHandoff?.packageId;
      if (pkg) latest = pkg;
    }
  }
  return latest;
}

/**
 * ADR-0057 Amendment A1.b migration read — is a product-only (legacy-scope)
 * build thread bound to `packageId` by its OWN history (the latest
 * draft/handoff package)? The adopt predicate every `app:X:build` surface
 * that runs the migration read hands `useChatConversation`: the full page's
 * `?package=` entry and the console dock bound to the current app
 * (objectui#10926). One predicate, so whichever surface resolves first adopts
 * the same thread. Exported for that second caller.
 */
export function isThreadBoundToPackage(
  messages: HydratedUIMessage[],
  packageId: string,
): boolean {
  return (
    deriveBoundPackageId(
      hydratedMessagesToChatMessages(messages) as unknown as readonly PackageBearingMessage[],
      undefined,
    ) === packageId
  );
}

// #2466 / ADR-0057 Amendment A1.b — the switcher lists only authorable
// packages. Which apps are code-loaded platform built-ins is one criterion,
// shared with the first-run checklist (`utils/platformApp.ts`); re-exported
// here for the importers that already read it from this module.
export { isPlatformBuiltinApp };

/**
 * The app-metadata fields this surface reads. `useMetadata().apps` is loosely
 * typed and the provider grafts `_packageId` onto each app; narrowing to this
 * shape ONCE at the hook boundary lets the call sites read `.name` /
 * `.label` / `._packageId` without per-access `as` casts.
 */
interface MetadataAppItem {
  name: string;
  label?: Parameters<typeof resolveKeyedI18nLabel>[0];
  _packageId?: string;
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
  build: { key: 'console.ai.agentLabels.build', defaultValue: 'Build' },
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
 * Per-surface empty-state branding. The split gives each assistant its own
 * identity: the Build surface reads as authoring ("describe an app"), the Ask
 * surface as data Q&A ("ask about your records"). Keyed by friendly name; falls
 * back to the generic empty state for custom agents.
 */
export function agentEmptyState(
  t: (key: string, options?: Record<string, unknown>) => string,
  agentName: string | undefined,
  // ADR-0057 A1.b — when the build surface is opened to EDIT an existing app
  // (`?package=`), the empty-state guidance switches from "describe an app to
  // build" (magic flow) to "what do you want to change in <app>". `appLabel` is
  // the resolved app name, or undefined until metadata loads (never a raw
  // package id — see the caller).
  editContext?: { appLabel?: string },
): { title: string; description: string } {
  if (isBuildAgent(agentName)) {
    if (editContext) {
      return {
        title: editContext.appLabel
          ? t('console.ai.empty.editApp.title', {
              defaultValue: 'Editing “{{app}}”',
              app: editContext.appLabel,
            })
          : t('console.ai.empty.editApp.titleGeneric', { defaultValue: 'Edit this app' }),
        // objectstack#34608 item 4 — the maker's one composer answers data
        // questions too (build is a data superset, cloud#1673), so the empty
        // state offers both: asking about the app's data, and changing it.
        description: t('console.ai.empty.editApp.askOrChangeDescription', {
          defaultValue:
            'Ask about this app’s data — counts, lists and summaries — or tell me what to change, and I’ll modify the app in place: a field, an object, a view or a dashboard.',
        }),
      };
    }
    return {
      title: t('console.ai.empty.build.title', { defaultValue: 'Build with AI' }),
      description: t('console.ai.empty.build.description', {
        defaultValue:
          'Describe an app in plain language — I draft the objects, screens and sample data, then you review and publish.',
      }),
    };
  }
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
  // ADR-0070 "Edit with AI": the package the user opened to edit (from the app
  // list's per-app action). Forwarded to the build agent as `context.packageId`
  // so its metadata reads scope to that app and edits bind to it from the first
  // message (the agent seeds it as the conversation's active package).
  const editPackageId = searchParams.get('package')?.trim() || undefined;
  // ADR-0057 P4 — a build prompt handed off from the `ask` surface's
  // "Open in Builder →" (suggest_builder), carried as NAVIGATION STATE
  // (objectui#12493): the URL is never read for it, so no link can put a message
  // in the user's mouth. Seeded as the build surface's first message below, and
  // consumed from the history entry as it is seeded, so a reload never re-sends.
  const location = useLocation();
  const builderHandoff = useMemo(() => readBuilderHandoffState(location.state), [location.state]);
  const handoffPrompt = builderHandoff.handoffPrompt;
  // ADR-0057 P4 / cloud#817 — the source `ask` conversation id handed off to the
  // Builder alongside the prompt (same navigation state). Forwarded to ChatPane →
  // useObjectChat, which sends it as `context.parentConversationId` on the build
  // surface's FIRST turn so the agent starts with the ask thread as context
  // (never a cold start). The URL-mirror below navigates without state once the
  // build conversation id is minted, which drops it.
  const handoffParentConversationId = builderHandoff.parentConversationId;
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

  // cloud#1674 maker convergence — the ONE predicate for this page's ask→build
  // collapse (shared with ChatPane's launcher filter via surfaceAgent.ts).
  const canAuthorMetadata = useCanAuthorMetadata();
  const makerConverged = makerConvergedOnBuild(agents, canAuthorMetadata, isAiStudioEnabled());

  // App/platform default — used for a bare `/ai` (respecting the legacy
  // `?agent=`), and as the endpoint while a legacy bare-id link is being
  // redirected to its real agent surface.
  const fallbackAgent = useMemo(() => {
    const resolved = resolveDefaultAgentName(agents, legacyAgentParam ?? defaultAgentProp ?? envDefaultAgent);
    // cloud#1674 — a maker's bare `/ai` (or an ask-preferring `?agent=` link)
    // lands on the converged build composer: ask is no longer a start surface
    // for principals who can author. Custom-agent preferences pass through.
    if (makerConverged && isAskAgent(resolved)) {
      return resolveAgentParam('build', catalogNames) ?? resolved;
    }
    return resolved;
  }, [agents, legacyAgentParam, defaultAgentProp, envDefaultAgent, makerConverged, catalogNames]);

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
  // When this full-page surface was deep-linked to edit a package
  // (`/ai/build?package=X`, the ADR-0070 "Edit with AI" entry), it shares the
  // Studio copilot's `app:X:build` thread instead of forking a separate one; a
  // generic `/ai/:agent` visit (no `?package=`) degrades to the product alone,
  // unchanged from before. `undefined` while the agent is still resolving.
  const chatScope = activeAgent
    ? chatConversationScope({ appId: editPackageId, product: chatProductOfAgent(activeAgent) })
    : undefined;

  // A1.b migration read: an "Edit with AI" entry (`?package=X`) whose
  // `app:X:build` scope has never been cached may still have its thread under
  // the product-only key — a build conversation from before bind-on-create
  // shipped (or whose re-key never ran in this browser). Offer that thread to
  // the resolve; adopt it only if its own history is actually bound to X
  // (latest draft/handoff package), so an unrelated product-scoped thread
  // never gets hijacked into an app scope.
  const activeProduct = activeAgent ? chatProductOfAgent(activeAgent) : undefined;
  const legacyBuildScope =
    editPackageId && activeProduct === 'build' && chatScope !== activeProduct
      ? activeProduct
      : undefined;
  const adoptLegacyBuildThread = useCallback(
    (messages: HydratedUIMessage[]) =>
      editPackageId !== undefined && isThreadBoundToPackage(messages, editPackageId),
    [editPackageId],
  );

  const {
    conversationId,
    conversationScope,
    initialMessages,
    rekeyScope,
    ensureConversation,
    createError: conversationCreateError,
  } = useChatConversation({
    // Gate resolution on the agent being known: resolving while `activeAgent`
    // is still undefined (catalog loading) would bind a SCOPELESS conversation
    // that the per-(user,scope) guard then sticks with — so the agent surface
    // would resume some other agent's last chat. Waiting one tick keys the
    // conversation to the right scope from the first resolve.
    userId: activeAgent ? userId : undefined,
    scope: chatScope,
    apiBase,
    activeId: urlConversationId ?? legacyConversationId,
    forceNew: forceNewConversation,
    legacyScope: legacyBuildScope,
    adoptLegacy: legacyBuildScope ? adoptLegacyBuildThread : undefined,
  });

  // #2450 — feed <ChatPane> ONLY a scope-matched conversation. Right after a
  // launcher/handoff switch (ask→build), `conversationId` still holds the OLD
  // scope's id until the hook re-resolves — the same stale window the
  // URL-mirror below already guards. A pane mounted on that stale id is DOOMED
  // (it remounts the moment the id re-resolves), and the deferred first-send
  // replay could consume the handoff stash into it, where the send dies with
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
  // Bumped whenever the pending ref is set OUT OF BAND (the handoff seed below).
  // ChatPane's deferred-send replay lists this in its deps, so it re-runs and
  // fires the seed even when the conversation id was ALREADY minted. Without it a
  // seed that lands after the id resolves is never replayed — the swallow (the
  // replay otherwise only re-runs on id / doSend changes).
  const [pendingFirstMessageSeq, setPendingFirstMessageSeq] = useState(0);
  const stashPendingFirstMessage = useCallback((m: PendingFirstMessage) => {
    pendingFirstMessageRef.current = m;
    setPendingFirstMessageSeq((s) => s + 1);
  }, []);

  // ADR-0057 P4 — seed the handed-off build prompt as this surface's first
  // message; `useDeferredFirstSend` (in ChatPane) replays it once the id lands.
  // Gate on the ROUTE (`agentSegment`), known synchronously — NOT on the
  // async-resolved `activeAgent`, which can settle AFTER the id is minted and so
  // seed too late for the replay to see it (the swallow race, cloud#817 P4
  // follow-up #1). Arm once per history entry (`location.key`), so a SECOND
  // handoff re-seeds into the singleton build conversation (#2) even with the
  // same text.
  //
  // objectui#12493 — the prompt is CONSUMED from the history entry as it is
  // seeded: the entry's state is replaced by one without `handoffPrompt` (the
  // parent conversation id stays until the URL-mirror drops it). Browser
  // history keeps state across a reload, so without this a reload would send
  // the prompt again. Declared BEFORE the canonicalization and URL-mirror
  // effects so that, in a shared effect flush, their later navigations win
  // over this same-URL replace.
  const lastSeededHandoffKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!handoffPrompt || agentSegment !== 'build') return;
    if (lastSeededHandoffKeyRef.current === location.key) return;
    lastSeededHandoffKeyRef.current = location.key;
    // Target the stash at the BUILD pane (#2450): mid ask→build transition a
    // doomed pane (stale conversation id, about to remount) must not consume it.
    stashPendingFirstMessage({ content: handoffPrompt, targetAgentRoute: 'build' });
    const remaining: BuilderHandoffState | null = handoffParentConversationId
      ? { parentConversationId: handoffParentConversationId }
      : null;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: remaining },
    );
  }, [
    handoffPrompt,
    handoffParentConversationId,
    agentSegment,
    location.key,
    location.pathname,
    location.search,
    location.hash,
    navigate,
    stashPendingFirstMessage,
  ]);

  // ── Route canonicalization ──────────────────────────────────────────────
  // Back-compat redirects (the agent is now in the path): bare `/ai` → the
  // default agent surface (or the `?agent=` deep-link target); a legacy built-in
  // id in the agent slot (`/ai/metadata_assistant`) → its friendly form
  // (`/ai/build`). Custom agents already route by their own name and no-op here.
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
    if (unavailableKnownAgent) {
      navigate(`/ai/${friendly}${preservedQuery}`, { replace: true });
      return;
    }
    // cloud#1674 — a maker landing on BARE `/ai/ask` (no conversation) is
    // redirected to the converged build composer; ask stopped being a start
    // surface for authoring principals. WITH a conversation id the link keeps
    // working, so existing ask threads (sidebar rows, old deep links) still
    // open and render.
    if (makerConverged && segmentIsAgent && isAskAgent(activeAgent) && !urlConversationId) {
      navigate(`/ai/build${preservedQuery}`, { replace: true });
      return;
    }
    if (segmentIsAgent && agentSegment !== friendly) {
      const tail = urlConversationId ? `/${encodeURIComponent(urlConversationId)}` : '';
      navigate(`/ai/${friendly}${tail}${preservedQuery}`, { replace: true });
    }
  }, [agents.length, activeAgent, agentSegment, segmentIsAgent, unavailableKnownAgent, makerConverged, urlConversationId, searchString, navigate]);

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
  const [debugOpen, setDebugOpen] = useState(false);
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
    // Preserve the `?package=` binding (ADR-0070 "Edit with AI") across the
    // mirror. Without it the rewrite to `/ai/:agent/:conversationId` drops the
    // query, so `editPackageId` goes undefined and the conversation scope falls
    // back from `app:${package}:${product}` to the product alone (ADR-0057) —
    // which would then let a bare `/ai/build` visit resume this package-scoped
    // thread. The consumed `agent`/`new` params stay stripped as before.
    const pkgQuery = editPackageId ? `?package=${encodeURIComponent(editPackageId)}` : '';
    navigate(`/ai/${activeAgentRoute}/${conversationId}${pkgQuery}`, { replace: true });
  }, [segmentIsAgent, urlConversationId, conversationId, conversationScope, chatScope, activeAgentRoute, editPackageId, navigate]);

  // ── A1.b bind-on-create ─────────────────────────────────────────────────
  // The pane's build just minted (or its hydrated history reveals) package
  // `pkg` while this conversation is keyed product-only: re-key it to
  // `app:${pkg}:build` so a later "Edit with AI" entry for that app resumes
  // THIS thread (the untitled-document idiom — named on first save), then put
  // `?package=` on the URL so the scope survives a reload. Order matters:
  // `rekeyScope` flips `conversationScope` synchronously BEFORE the navigate
  // re-render recomputes `chatScope`, so the #2450 scope gate stays matched
  // and the mounted pane (and any in-flight stream) is never remounted.
  // Only fires with the conversation id already in the URL (post-mirror) —
  // the single-navigator rule: the URL-mirror effect above is dormant once
  // `urlConversationId` is set, so the two can never fight over the URL from
  // stale closures. Idempotent under StrictMode double-effects.
  const handlePackageBound = useCallback(
    (pkg: string) => {
      if (!pkg || editPackageId || activeProduct !== 'build' || !activeAgentRoute) return;
      // Re-key only a settled, scope-matched, product-only conversation whose
      // id already reached the URL.
      if (chatScope !== activeProduct || conversationScope !== chatScope) return;
      if (!conversationId || urlConversationId !== conversationId) return;
      rekeyScope(chatConversationScope({ appId: pkg, product: activeProduct }));
      navigate(
        `/ai/${activeAgentRoute}/${encodeURIComponent(conversationId)}?package=${encodeURIComponent(pkg)}`,
        { replace: true },
      );
    },
    [
      editPackageId,
      activeProduct,
      activeAgentRoute,
      chatScope,
      conversationScope,
      conversationId,
      urlConversationId,
      rekeyScope,
      navigate,
    ],
  );

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
    <div className="flex h-svh w-full flex-col bg-background" data-testid="ai-chat-page">
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
            includeAskConversations={makerConverged}
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
      {conversationId && agentHasCapability(agents, activeAgent, 'debug') && (
        <BuildDebugDrawer
          apiBase={apiBase}
          conversationId={conversationId}
          open={debugOpen}
          onOpenChange={setDebugOpen}
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
              includeAskConversations={makerConverged}
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
            editPackageId={editPackageId}
            onPackageBound={handlePackageBound}
            canBind={Boolean(urlConversationId)}
            parentHandoffConversationId={handoffParentConversationId}
            initialMessages={paneInitialMessages}
            pendingFirstMessageRef={pendingFirstMessageRef}
            pendingFirstMessageSeq={pendingFirstMessageSeq}
            ensureConversation={ensureConversation}
            conversationCreateError={conversationCreateError}
            selectedModelId={selectedModelId}
            onSelectedModelChange={setSelectedModelId}
            onSent={handleSent}
            onShare={() => setShareOpen(true)}
            onDebug={() => setDebugOpen(true)}
            showDebug={agentHasCapability(agents, activeAgent, 'debug')}
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
  /** ADR-0070 "Edit with AI": the package the user opened to edit (from `?package=`),
   *  forwarded to the build agent as `context.packageId` to scope it to that app. */
  editPackageId?: string;
  /**
   * objectstack#30043 — the app the user has selected, by its package: the
   * console app the dock sits in, whichever agent it runs. Sent as
   * `context.activeApp`; absent, `editPackageId` (the app picked for editing)
   * is the selection, and with neither the key is omitted, never a placeholder.
   */
  activeAppPackageId?: string;
  /** A1.b bind-on-create: fired when this pane's build history binds to a package
   *  while the surface has no `?package=` — the page re-keys the conversation to
   *  `app:${pkg}:build` and writes `?package=` onto the URL. */
  onPackageBound?: (pkg: string) => void;
  /** A1.b — true once the conversation id is mirrored into the URL. Binding is
   *  deferred until then (single-navigator rule vs the page's URL-mirror effect);
   *  keeping it in the bind effect's deps re-fires the notification when the
   *  mirror lands, covering a hydrated bound thread opened via bare `/ai/build`. */
  canBind?: boolean;
  /** ADR-0057 P4 / cloud#817 — source `ask` conversation id (from the handoff's navigation state),
   *  forwarded to the build agent's FIRST turn as `context.parentConversationId` so it
   *  starts with the ask thread as context. Undefined outside a handoff. */
  parentHandoffConversationId?: string;
  initialMessages: HydratedUIMessage[];
  /** Page-owned stash for a first message sent before the conversation id resolved
   *  (survives this pane's id-keyed remount). See {@link useDeferredFirstSend}. */
  pendingFirstMessageRef: React.MutableRefObject<PendingFirstMessage | null>;
  /** Bumps when the page seeds `pendingFirstMessageRef` out of band (handoff), so
   *  the deferred-send replay re-runs. See {@link useDeferredFirstSend}. */
  pendingFirstMessageSeq?: number;
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
  /** Opens the Build Doctor drawer (build agent only). */
  onDebug?: () => void;
  /** Show the Build Doctor button — true only for build-agent conversations. */
  showDebug?: boolean;
  /**
   * objectstack#34725 — the host draws the panel's one title bar itself (the
   * Studio right slot: 属性 | AI 助手, History, widen, Close), so the pane
   * omits its own header row: the agent switcher, the app chip, Share and the
   * Build Doctor button. The host then offers Share where it chooses.
   * @default false
   */
  hideHeader?: boolean;
  /**
   * objectstack#35445 — the host offers Share and the Build Doctor in its own
   * title bar (the console drawer's 「···」 menu), so the pane's header row
   * draws neither. The rest of the row (the agent switcher, the app chip) stays.
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
  editPackageId,
  activeAppPackageId,
  surfaceContext,
  surfaceArtifactLabel,
  onPackageBound,
  canBind,
  parentHandoffConversationId,
  initialMessages,
  pendingFirstMessageRef,
  pendingFirstMessageSeq,
  ensureConversation,
  conversationCreateError,
  selectedModelId: hostSelectedModelId,
  onSelectedModelChange,
  onSent,
  onShare,
  onDebug,
  showDebug,
  hideHeader = false,
  actionsInHost = false,
}: ChatPaneProps) {
  const { t, language } = useObjectTranslation();
  const navigate = useNavigate();
  // The advisory seam for this pane's draft-card publish. `useMetadataClient`
  // is the layer that hands the console's advisory toast renderer to the
  // client, so taking the client from here — rather than firing the route by
  // hand — is what makes the runtime authoring gate's per-draft findings reach
  // the author at all (objectui#10039).
  const metadataClient = useMetadataClient();
  // The agent dropdown is a LAUNCHER now (not an in-surface mode toggle): it
  // navigates to `/ai/:agent`, so it naturally lists custom agents and can stay
  // always-available. Shown only when there's more than one agent to switch to.
  //
  // cloud#1674 maker convergence: for an authoring-capable principal the
  // built-in `ask` leaves the launcher — build subsumes it (data superset since
  // cloud#1673), so Ask/Build stop being peer modes and the maker gets ONE
  // composer. Computed INSIDE ChatPane so every host (full `/ai` page, Studio
  // copilot, console dock) converges identically. Custom agents stay listed;
  // ask conversations stay openable — only the "start here" affordance goes.
  const canAuthorMetadata = useCanAuthorMetadata();
  const launcherAgents = makerVisibleAgents(agents, canAuthorMetadata, isAiStudioEnabled());
  const showAgentLauncher = launcherAgents.length > 1;

  // ADR-0057 P4 — the `ask` agent declined an authoring request (suggest_builder).
  // Open the full-page BUILD surface seeded with the handoff prompt, sent on
  // arrival because the user's click on the card is the action (ADR-0063
  // decline-and-redirect — an explicit, user-initiated switch, never a silent
  // re-route). The prompt rides NAVIGATION STATE, never the URL
  // (objectui#12493): only this in-app call can set it, so no link can make the
  // build agent receive a message the user did not send. Prefer the handoff's
  // own packageId, else this surface's edit package (`?package=` only scopes the
  // surface; it sends nothing). cloud#817: also carry THIS (ask) thread's id so
  // the Builder's first turn starts with the ask conversation as context.
  //
  // objectstack#34608 — inside the console's drawer this retargets the drawer
  // in place; under no drawer host it navigates to `/ai/build` as before.
  const openAssistant = useOpenAssistant();
  const openBuilder = useCallback(
    (handoff: { prompt: string; packageId?: string }) => {
      const pkg = handoff.packageId || editPackageId;
      const state: BuilderHandoffState = {};
      if (handoff.prompt) state.handoffPrompt = handoff.prompt;
      if (conversationId) state.parentConversationId = conversationId;
      openAssistant({ agent: 'build', packageId: pkg }, state);
    },
    [openAssistant, editPackageId, conversationId],
  );

  // cloud#1658 — land the user on the record an `open_record` hand-off names.
  // The payload has objectName + recordId but the canonical record route needs
  // the APP segment (`/apps/:app/:object/record/:id`), so resolve the object's
  // owning package on click — one same-origin metadata read — instead of
  // burdening the agent with an id it may not know. `setup` is the fallback
  // shell for an object no package claims.
  const openRecord = useCallback(
    async (handoff: { objectName: string; recordId: string }) => {
      const app = await appOfObject(handoff.objectName);
      navigate(
        `/apps/${encodeURIComponent(app)}/${encodeURIComponent(handoff.objectName)}/record/${encodeURIComponent(handoff.recordId)}`,
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

  // objectui#12894 — 查看变更并发布 on the applied card of a change the copilot
  // saved as a draft (cloud#2924): open Studio's 变更 drawer for the package
  // through its one declared way in, `?changes=review` (`studioChangesLink.ts`).
  // Inside that package's Studio (the copilot) the param goes onto the current
  // location, so the surface stays mounted; anywhere else (this full page, the
  // console dock) the link opens the package's Studio with the drawer open.
  const location = useLocation();
  const reviewDrafts = useCallback(
    (packageId: string) => {
      const target = studioChangesReviewTarget(packageId, location);
      navigate(target.to, { replace: target.replace });
    },
    [navigate, location],
  );

  // cloud#797 Excel→App: the attached spreadsheet the user can load real rows
  // from (into a built object) via ExcelImportBar. Set when a sheet is sent,
  // cleared on import/dismiss. `dataSource` drives the wizard's schema + import.
  const dataSource = useAdapter();
  // objectui#12894 — 撤销 on the same applied card: `POST
  // /packages/:id/discard-drafts`, which drops EVERY pending draft of the
  // package (the card asks first when others are pending). Through the SDK
  // client the console's adapter holds — `packages.discardDrafts`, typed by the
  // spec's `DiscardPackageDraftsResponse` — rather than a second bare fetch of
  // the route. A draft the server could not drop is a failure the card shows,
  // with the server's reason. Either way every pending-drafts surface re-reads
  // on the assistant bus's pulse, Studio's 变更 badge among them.
  const discardDrafts = useCallback(
    async (packageId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!dataSource) return { ok: false };
      try {
        const result = await dataSource.getClient().packages.discardDrafts(packageId);
        if (!result.success || result.failedCount > 0) {
          const reasons = result.failed.map((f) => `${f.type}/${f.name}: ${f.error}`).join('\n');
          return { ok: false, ...(reasons ? { error: reasons } : {}) };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, ...(e instanceof Error && e.message ? { error: e.message } : {}) };
      } finally {
        emitMetadataRefresh();
      }
    },
    [dataSource],
  );
  const [pendingSheet, setPendingSheet] = useState<File | null>(null);
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
  const selectedApp = activeAppPackageId || editPackageId || undefined;
  // The pick outlives this pane only when the host holds it (see the props).
  const [paneSelectedModelId, setPaneSelectedModelId] = useState<string | undefined>(undefined);
  const hostHoldsModel = onSelectedModelChange !== undefined;
  const selectedModelId = hostHoldsModel ? hostSelectedModelId : paneSelectedModelId;
  const setSelectedModelId = hostHoldsModel ? onSelectedModelChange : setPaneSelectedModelId;
  // The one value both the picker shows and the request sends.
  const effectiveModelId = selectedModelId ?? defaultModelId;

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
    // ADR-0057 P4 / cloud#817 — on a handoff, carry the ask thread as the build
    // agent's first-turn context (consumed once inside useObjectChat).
    parentConversationId: parentHandoffConversationId,
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
        // Tell the agent the environment's publish posture so its narration
        // matches reality (an auto-published build is live, not "to publish").
        autoPublishAiBuilds: getRuntimeConfig().features.autoPublishAiBuilds,
        // ADR-0070 "Edit with AI": scope the build agent to the app the user
        // opened to edit. Cloud seeds it as the conversation's active package.
        ...(editPackageId ? { packageId: editPackageId } : {}),
        // cloud#1610 — what the user is currently discussing (advisory; the
        // transport reads the body per send, so this stays fresh per turn).
        // The console dock sends the page in view too (objectstack#30043).
        ...(surfaceContext ? { surface: surfaceContext } : {}),
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
  // (`buildProgress`, `draftReview`, `pendingActionId`, …) is spread through.
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
  //     message's tool invocations — including the re-serialized draft envelope
  //     behind "Review N changes / Publish" — were dropped from the cache
  //     entirely. Folded, they survive the reload they exist to survive.
  // Not reachable from this page's own paths today (hydration and `mapMessages`
  // both produce runtime roles and v6 states already), so nothing on screen
  // moves; this closes the hole ahead of a value that can reach it.
  useEffect(() => {
    writeConversationMessagesCache(
      conversationId,
      sanitizeChatMessagesForCache(runtimeMessages),
    );
  }, [conversationId, runtimeMessages]);

  // #772 — the confirm-card SEND messages must match the CONVERSATION's
  // language, not the console UI locale: a Chinese thread under an English UI
  // was sending "Looks good — build it as proposed." into its own chat. The
  // gate (service-ai-studio) accepts both languages, so this is a cosmetic —
  // but jarring — mismatch. Button LABELS stay on the UI locale.
  //
  // That last clause is load-bearing: `planBuildingLabel` had drifted into this
  // gate (#2632) and shipped the plan card's only Chinese word to English-UI
  // readers while making the zh pack's `console.ai.planBuilding` unreachable for
  // zh conversations (#3837). Nothing but OUTBOUND message text belongs below —
  // a pin in `packages/i18n/src/__tests__/console-namespace-3546.test.tsx` fails
  // if a `*Label` rejoins the gate.
  //
  // #3896 — the OTHER half of that rule. These sites used to read
  // `convZh ? '<Chinese>' : t(key)`, and `t()` is the UI pack, so a zh console
  // holding an English conversation sent Chinese into an English thread, and the
  // ungated `planAnswerMessage` sent the UI locale in both directions.
  // `outboundAgentText` resolves all four from the `zh`/`en` packs by
  // conversation language and never consults the UI pack.
  // Fold-insensitive, measured: the probe reads `role === 'user'` and the text,
  // and the fold only maps `'tool'` -> `'assistant'` — it can neither create nor
  // destroy a user turn, and it leaves `content`/`parts` untouched.
  const convZh = useMemo(
    () => isConversationZh(runtimeMessages) || isConversationZh(initialMessages),
    [runtimeMessages, initialMessages],
  );
  const outboundText = useCallback(
    (key: OutboundAgentTextKey, vars?: Readonly<Record<string, string>>) =>
      resolveOutboundAgentText(convZh, key, vars),
    [convZh],
  );
  // The thread so far, read when a turn is prepared (objectstack#34461)
  // without making the send callbacks change identity on every message.
  const threadMessagesRef = useRef({ runtimeMessages, initialMessages });
  threadMessagesRef.current = { runtimeMessages, initialMessages };
  const planApproveMessage = outboundText('planApproveMessage');
  const planApproveDefaultsMessage = outboundText('planApproveDefaultsMessage');
  // Same rule for the granular change-confirm card. It used to send a hard-coded
  // Chinese sentence regardless of the conversation, so an English user clicking
  // Confirm flipped the agent into Chinese for the rest of the thread (#2884).
  const changesConfirmMessage = outboundText('changesConfirmMessage');
  // Verb column of the change rows. Unlike the message above these are LABELS,
  // so they follow the UI locale like every other label on the card.
  const changeVerbLabels = useMemo(
    () => ({
      create_object: t('console.ai.changeVerb.createObject', { defaultValue: 'Create object' }),
      add_field: t('console.ai.changeVerb.addField', { defaultValue: 'Add field' }),
      modify_field: t('console.ai.changeVerb.modifyField', { defaultValue: 'Modify field' }),
      delete_field: t('console.ai.changeVerb.deleteField', { defaultValue: 'Delete field' }),
      create_metadata: t('console.ai.changeVerb.createMetadata', { defaultValue: 'Create' }),
      update_metadata: t('console.ai.changeVerb.updateMetadata', { defaultValue: 'Modify' }),
      create_seed: t('console.ai.changeVerb.createSeed', { defaultValue: 'Generate sample data' }),
      create_package: t('console.ai.changeVerb.createPackage', { defaultValue: 'Create app package' }),
    }),
    [t],
  );

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
      // Retain the first sheet so ExcelImportBar can load its REAL rows into a
      // built object (cloud#797) — the agent got a brief; the user gets an
      // import affordance without re-picking the file.
      const firstSheet = attached.find(isSpreadsheetAttachment);
      if (firstSheet) setPendingSheet(firstSheet);
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
    [resetSuppression, sendMessage, onSent, prepareTurn, setPendingSheet],
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
    pendingSignal: pendingFirstMessageSeq,
    // #2450 — this pane's agent surface; a stash targeted at another surface
    // (the handoff seed → 'build') is held, never consumed here.
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

  // #2458 / ADR-0057 Amendment A1.a — the package this build conversation is
  // bound to, surfaced as a header chip so the edit blast-radius is always
  // visible (the Claude-Code-shows-the-repo idiom). The magic flow starts
  // unbound ("New app") and binds the moment its build mints a package.
  const isBuildSurface = activeAgent ? agentRouteName(activeAgent) === 'build' : false;
  const metadata = useMetadata();
  const { apps } = metadata;
  // Narrow the loosely-typed provider apps once (see MetadataAppItem) so the
  // derivations below read fields without per-access casts.
  const metadataApps = apps as MetadataAppItem[] | undefined;
  const { appLabel } = useServedAppLabel();
  // Fold-insensitive, measured: this walks every message irrespective of role
  // and reads `draftReview`/`builderHandoff`, which the adapter spreads through.
  const boundPackageId = useMemo(
    () => deriveBoundPackageId(runtimeMessages, editPackageId),
    [runtimeMessages, editPackageId],
  );
  // objectui#12965 — is this pane on one of its bound package's own Studio
  // pillars, i.e. hosted by that package's Studio copilot? The same reading the
  // applied card's review door makes (`reviewDrafts` above): the target
  // replaces the entry exactly when the location is already on that package's
  // Studio pillar. The full-page chat (`/ai/...`) and the console dock
  // (`/apps/...`) are never on one.
  const onBoundPackageStudio = boundPackageId
    ? studioChangesReviewTarget(boundPackageId, location).replace
    : false;
  const boundPackageLabel = useMemo(() => {
    if (!boundPackageId) return undefined;
    const app = (metadataApps ?? []).find(
      (a) => a._packageId === boundPackageId,
    );
    return app ? appLabel(app) : boundPackageId;
  }, [boundPackageId, metadataApps, appLabel, t]);

  // ADR-0057 A1.b edit mode — the resolved name of the app being EDITED
  // (`?package=`). Returns undefined until the app is found in metadata, so the
  // empty-state title falls back to a generic label rather than flashing a raw
  // package id (`app.xadv`) while metadata loads.
  const editAppLabel = useMemo(() => {
    if (!editPackageId) return undefined;
    const app = (metadataApps ?? []).find(
      (a) => a._packageId === editPackageId,
    );
    return app ? appLabel(app) : undefined;
  }, [editPackageId, metadataApps, appLabel, t]);

  // objectui#11658 — the plan card's extend-mode scope chip names the existing
  // app it would add to by that app's label; the plan carries its machine name.
  // An app not (yet) in metadata answers undefined and the chip shows the name.
  const resolveAppLabel = useCallback(
    (appName: string) => {
      const app = (metadataApps ?? []).find((a) => a.name === appName);
      return app ? appLabel(app) : undefined;
    },
    [metadataApps, appLabel, t],
  );

  // objectstack#32984 — the change card names objects, fields and field types
  // by their labels (the producer sends machine names only: 「字段
  // b6bl_quote_item · line_total · currency」). A name the published registry
  // does not know is read from the draft overlay (`useChangeCardLabels`); one
  // the change is about to create answers undefined, and the card then shows
  // the name as given. The revision moves when a message lands or a turn
  // starts or ends, which is when a change may have drafted a new name.
  const { resolveObjectLabel, resolveFieldLabel } = useChangeCardLabels(
    metadata,
    metadataClient,
    `${shownMessages.length}:${isLoading ? 'turn' : 'idle'}`,
  );
  const metadataLocale = useMetadataLocale();
  const resolveFieldTypeLabel = useCallback(
    (type: string) => {
      const name = fieldTypeName(type, metadataLocale);
      return name === type ? undefined : name;
    },
    [metadataLocale],
  );

  // Per-surface empty-state branding (Build = authoring, Ask = data Q&A). On the
  // build surface, `?package=` flips it to edit mode: "what do you want to
  // change in <app>" + change-oriented starters, instead of the from-scratch
  // magic-flow guidance. Computed here (not earlier) so it can read the app name.
  const editing = isBuildSurface && Boolean(editPackageId);
  // objectstack#34608 item 4 — bound to an app, the maker's starters lead with
  // two data questions before the change-oriented ones.
  const suggestions = useMemo<string[] | undefined>(() => {
    if (hydrated.length > 0) return undefined;
    const starters = buildAgentSuggestions(activeAgent, activeAgentLabel, t, editing);
    return editing ? [...editAppDataSuggestions(t), ...starters] : starters;
  }, [hydrated.length, activeAgent, activeAgentLabel, t, editing]);
  const emptyState = useMemo(
    () => agentEmptyState(t, activeAgent, editing ? { appLabel: editAppLabel } : undefined),
    [t, activeAgent, editing, editAppLabel],
  );

  // A1.b bind-on-create: report the binding to the page (which re-keys the
  // conversation and puts `?package=` on the URL). Deferred behind `canBind`
  // (the conversation id must be in the URL first — see ChatPaneProps) AND
  // behind the turn being idle: the binding draft lands mid-stream, but
  // re-keying then races the live stream (the scope-change refetch reads the
  // conversation BEFORE the server persists the turn, and a stream hiccup's
  // reconcile can then replace the live thread with that not-yet-persisted
  // EMPTY history — the blanked-pane failure seen live). Waiting for
  // `isLoading` to drop means the turn is fully persisted server-side, so
  // every post-bind read returns the real history; the chip binding a moment
  // after the build lands also matches the "named on first save" idiom. The
  // deps re-fire the notification on each gate opening (mirror landed, stream
  // ended, hydrated reload of a bound thread missing `?package=`).
  useEffect(() => {
    if (!isBuildSurface || !canBind || !boundPackageId || editPackageId || isLoading) return;
    onPackageBound?.(boundPackageId);
  }, [isBuildSurface, canBind, boundPackageId, editPackageId, isLoading, onPackageBound]);

  // ── objectstack#34610 — the draft is the main area ─────────────────────────
  // The build runs in the console's drawer, and what it builds shows in the
  // page beside it (ADR-0057 Amendment A3, ADR-0037 as amended): no nested
  // preview. Under a drawer host (`useChatDockControl`, the console and Home
  // shells) the main area moves to the app, in the regime the build is in
  // (ADR-0045): the real unpublished app for a materialized build or an app
  // not published yet, `?preview=draft` for changes to a published app. With
  // no drawer host (the Studio copilot, whose design surface already shows
  // the drafts) nothing moves; only the per-artifact refresh below runs.
  const dockControl = useChatDockControl();
  const showsMainArea = dockControl !== null;
  const mainAreaInPreview = usePreviewDrafts();
  // An app the registry lists as materialized-but-unpublished (ADR-0045)
  // takes no draft overlay: its changes materialize into it directly, and in
  // preview mode its own Publish bar would yield to an empty draft bar.
  const unpublishedApp = useCallback(
    (segment: string) =>
      (metadataApps ?? []).some(
        (a) => (a._packageId === segment || a.name === segment) && (a as { _unpublished?: unknown })._unpublished === true,
      ),
    [metadataApps],
  );
  // Only a turn THIS pane streamed moves the main area. The chat reports a
  // reopened conversation's drafts and materialized builds on mount too, and
  // opening an old thread from the history must not navigate the page.
  const liveTurnRef = useRef(false);
  useEffect(() => {
    if (isLoading) liveTurnRef.current = true;
  }, [isLoading]);
  // Keyed by the conversation: another conversation is another build session,
  // and its target (none yet) is not this one's.
  const [mainAreaState, setMainAreaState] = useState<{
    conversationId: string | undefined;
    target: MainAreaDraftTarget;
  } | null>(null);
  const mainAreaTarget =
    mainAreaState && mainAreaState.conversationId === conversationId ? mainAreaState.target : null;
  const shownTargetRef = useRef<MainAreaDraftTarget | null>(null);
  // Move the main area to the latest target. Entering draft mode on the page
  // the user is on is a query change and happens at once; a move to another
  // page waits for the turn to end (A1: the main area keeps its page until
  // the build binds, and the bind lands when the turn does), so a stream in
  // flight is never cut by a shell switch.
  useEffect(() => {
    if (!showsMainArea || !mainAreaTarget || shownTargetRef.current === mainAreaTarget) return;
    const move = mainAreaDraftMove(mainAreaTarget, location, mainAreaTarget.segment === activeAppPackageId);
    if (move && !move.replace && isLoading) return;
    shownTargetRef.current = mainAreaTarget;
    if (!move) return;
    if (move.leavesPreview) markPreviewExit();
    navigate(move.to, { replace: move.replace });
  }, [showsMainArea, mainAreaTarget, location, activeAppPackageId, isLoading, navigate]);
  const showAppInMainArea = useCallback(
    (packageId: string, opts: { materialized?: boolean; path?: string } = {}) => {
      // An edit to a code-shipped app is drafted into its customization pair
      // (ADR-0146): the app it shows in is the pair's base.
      const segment = appPackageOf(packageId);
      const materialized = opts.materialized === true || unpublishedApp(segment);
      setMainAreaState({
        conversationId,
        target: {
          segment,
          ...(materialized ? { materialized: true } : {}),
          ...(opts.path && !materialized ? { path: opts.path } : {}),
        },
      });
    },
    [unpublishedApp, conversationId],
  );
  // ADR-0037 Phase 2 — refresh in place per artifact: each drafted artifact is
  // announced on the assistant bus, and every metadata tree in preview mode
  // (the main area's) refetches that type. Coalesced (~200 ms) by type, so a
  // whole-app build is not an invalidation storm.
  const invalidateTimerRef = useRef<number | null>(null);
  const pendingInvalidationsRef = useRef<Map<string, { type: string; name: string }>>(new Map());
  useEffect(
    () => () => {
      if (invalidateTimerRef.current) window.clearTimeout(invalidateTimerRef.current);
    },
    [],
  );
  const queueInvalidations = useCallback((artifacts: ReadonlyArray<{ type: string; name: string }>) => {
    for (const a of artifacts) {
      if (!pendingInvalidationsRef.current.has(a.type)) pendingInvalidationsRef.current.set(a.type, a);
    }
    if (invalidateTimerRef.current) window.clearTimeout(invalidateTimerRef.current);
    invalidateTimerRef.current = window.setTimeout(() => {
      const batch = [...pendingInvalidationsRef.current.values()];
      pendingInvalidationsRef.current.clear();
      for (const inv of batch) emitCanvasInvalidate(inv);
    }, 200);
  }, []);
  const handleDraftArtifacts = useCallback(
    (artifacts: Array<{ type: string; name: string }>, appSegment?: string) => {
      queueInvalidations(artifacts);
      // The app the draft belongs to: the drafted set's own package, else the
      // package this conversation is bound to (an edit drafts no `app`).
      // Unbound (a new build before its package exists), the page stays.
      const segment = appSegment ?? boundPackageId;
      if (liveTurnRef.current && segment) showAppInMainArea(segment);
    },
    [boundPackageId, showAppInMainArea, queueInvalidations],
  );
  // ADR-0045: the build materialized — the real, unlisted app.
  const handleBuildMaterialized = useCallback(
    (appName: string, opts?: { appSegment?: string }) => {
      if (liveTurnRef.current) showAppInMainArea(opts?.appSegment ?? appName, { materialized: true });
    },
    [showAppInMainArea],
  );
  // A finished turn refreshes the main area once more (and every pending
  // count): an incremental edit can land without growing the drafted set, so
  // the per-artifact signal above does not always fire for it.
  //
  // objectstack#34610 — for the same reason a finished turn that drafted
  // shows its app in the main area itself: an edit that re-drafts an artifact
  // the conversation already listed (the object a build made, edited in the
  // next turn) never reaches `handleDraftArtifacts`, and read live it left the
  // main area out of draft mode with the edit pending.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const ended = prevLoadingRef.current && !isLoading;
    prevLoadingRef.current = isLoading;
    if (!ended) return;
    if (liveTurnRef.current) {
      const drafted = turnDraftPackage(messages);
      const segment = drafted?.packageId ?? (drafted ? boundPackageId : undefined);
      if (drafted && segment) {
        showAppInMainArea(segment, drafted.materialized ? { materialized: true } : {});
        // …and refreshes what it drafted, once the main area is in draft
        // mode (the coalescing delay outlasts the move).
        queueInvalidations(drafted.items);
      }
    }
    if (shownTargetRef.current) emitMetadataRefresh();
    // Re-runs on the other deps find no turn end (`prevLoadingRef` already
    // holds the current value), so only the end of a turn acts.
  }, [isLoading, messages, boundPackageId, showAppInMainArea, queueInvalidations]);

  // objectui#12724 — a finished build STAYS on the conversation. The
  // built-moment transition (objectui#5799) used to move the thread into the
  // Studio workbench the moment a whole-app build existed, and objectui#11658
  // pointed it at the running app; the maintainer's AiBuild ruling retires
  // both: the result card's 打开应用 / 在 Studio 中查看 buttons are the only
  // ways out, and the user picks one. What stays is the binding: the build's
  // package re-keys this conversation to `app:<pkg>:build` (A1.b), the key the
  // Studio dock resolves, so 在 Studio 中查看 resumes THIS thread. Derived from
  // the persisted envelopes (#2623 lesson: never canvasApp runtime state), so a
  // REOPENED built conversation binds too.
  const builtPackageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const tool of messages[i].toolInvocations ?? []) {
        // Posture-independent: read the raw envelope, not draftReview — an
        // auto-publish env rewrites the build envelope to status:'published'
        // and the drafted-only lift never fires there.
        const pkg = detectBuiltAppPackage(tool.result);
        if (pkg) return pkg;
        // objectui#10109 — an INCREMENTAL edit's draft review can list the `app`
        // it re-staged; the producer's `kind: 'edit'` says it is not a build.
        const dr = tool.draftReview;
        if (dr?.packageId && dr.kind !== 'edit' && dr.items?.some((it) => it.type === 'app')) {
          return dr.packageId;
        }
      }
    }
    return undefined;
  }, [messages]);
  useEffect(() => {
    if (!isBuildSurface || isLoading || !canBind || !builtPackageId) return;
    // Idempotent: the page's handler re-keys a product-only thread once and
    // ignores every later call.
    onPackageBound?.(builtPackageId);
  }, [isBuildSurface, isLoading, canBind, builtPackageId, onPackageBound]);

  // objectui#5801 — when a tool STAGES or PUBLISHES something, announce it on
  // the bus so every pending-drafts surface (Studio topbar, home banner, the
  // bar above this pane) converges immediately — previously an agent-staged
  // draft lit only the chat bar (its own idle refetch) while the Studio topbar
  // count stayed dark until a manual draft save. Precise on purpose: only tool
  // results that carry an authoring envelope emit (a drafted result's
  // `draftReview`, or a confirm-replay's `replayOutcome`), so an ordinary Q&A
  // turn does not trigger an env-wide registry refetch.
  //
  // objectui#12725 — announced the moment each result LANDS, not when its turn
  // ends. The draft is written before the tool answers (the envelope's own
  // `draftState` is read after that write), so the Studio 变更 badge can
  // count it while the agent is still narrating; waiting for the stream to
  // finish left the badge behind the chat card by the whole narration. Each
  // result is announced once, keyed by its message and its position in that
  // message: a streamed message is re-mapped on every chunk, and a tool part
  // without a `toolCallId` is given a fresh random one each time. The results
  // already in the thread when this pane mounts are history, not a landing.
  //
  // A `status: 'published'` result that is not a confirm-replay carries
  // neither: the chat lifts `draftReview` for `drafted` only and
  // `replayOutcome` for `replay_` ids only. Cloud's `maybeAutoPublish`
  // publishes in the turn and rewrites the tool's envelope to it, promoting
  // EVERY pending draft of the package, so the badge must re-read on it too
  // (objectui#12725). `detectAuthoringVerdict` is the chat package's one
  // reader of the authoring envelope, whatever its posture.
  const announcedAuthoringRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const authored: string[] = [];
    for (const message of messages) {
      (message.toolInvocations ?? []).forEach((tool, index) => {
        if (tool.draftReview || tool.replayOutcome || detectAuthoringVerdict(tool.result)) {
          authored.push(`${message.id}#${index}`);
        }
      });
    }
    const announced = announcedAuthoringRef.current;
    if (announced === null) {
      announcedAuthoringRef.current = new Set(authored);
      return;
    }
    let landed = false;
    for (const key of authored) {
      if (announced.has(key)) continue;
      announced.add(key);
      landed = true;
    }
    if (landed) emitMetadataRefresh();
  }, [messages]);

  // objectui#11666 — the launchers (console FAB, ChatDock edge launcher) show
  // a marker while a proposed plan awaits the user's approval, and they are on
  // screen only while this pane is NOT mounted. So the chat's own reading —
  // `ChatbotEnhanced` reports it from the producer its plan card renders — is
  // published on the assistant bus, per conversation and per user, and outlives
  // this pane's unmount. `undefined` until the chat has reported once, so a
  // mount never announces a reading it has not taken. Nothing here clears it on
  // open: an open re-reads the same thread and reports the same state.
  const { user: planApprovalUser } = useAuth();
  const planApprovalUserId = planApprovalUser?.id;
  // objectstack#25943 — the reading carries the count of items awaiting
  // confirmation too (Studio's right slot shows 「N 项待确认」).
  const [planApprovalPending, setPlanApprovalPending] = useState<boolean | undefined>(undefined);
  const [planApprovalCount, setPlanApprovalCount] = useState(0);
  const onPlanApprovalPendingChange = useCallback((pending: boolean, count: number) => {
    setPlanApprovalPending(pending);
    setPlanApprovalCount(count);
  }, []);
  useEffect(() => {
    if (!conversationId || planApprovalPending === undefined) return;
    publishPlanApprovalPending({
      userId: planApprovalUserId,
      conversationId,
      pending: planApprovalPending,
      count: planApprovalCount,
    });
  }, [planApprovalUserId, conversationId, planApprovalPending, planApprovalCount]);

  // A1.b switcher menu: every published app with a package identity, deduped
  // by package (apps sharing a package share the build thread — the scope is
  // per-package). Selecting one navigates to its Edit-with-AI surface, which
  // resumes (or mints) that app's own build conversation.
  const switchablePackages = useMemo(() => {
    const byPackage = new Map<string, string>();
    for (const app of metadataApps ?? []) {
      const pkg = app._packageId;
      // Skip platform built-ins (setup / account …): they're code-delivered
      // packages the build agent can't author, so they must not appear as
      // switch targets — A1.b lists authorable packages only.
      if (!pkg || byPackage.has(pkg) || isPlatformBuiltinApp(app)) {
        continue;
      }
      byPackage.set(pkg, appLabel(app));
    }
    return Array.from(byPackage, ([id, label]) => ({ id, label }));
  }, [metadataApps, appLabel, t]);

  const headerSlot = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 pb-2 pt-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showAgentLauncher ? (
          launcherAgents.length <= 3 ? (
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
                {launcherAgents.map((agent) => (
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
                {launcherAgents.map((agent) => (
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
        ) : (
          <span className="truncate text-xs font-medium text-foreground/85">
            {activeAgentLabel}
          </span>
        )}
        {isBuildSurface ? (
          // A1.b — the binding chip is a SWITCHER now: each app gets its own
          // build conversation (the scope is per-package), so picking one here
          // switches threads via its Edit-with-AI entry; "New app" opens a
          // fresh unbound draft (`?new=1` mints a separate thread).
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="ai-build-package-chip"
              title={boundPackageId}
              aria-label={t('console.ai.switchApp', { defaultValue: 'Switch app' })}
              className={cn(
                'inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/80',
                boundPackageId
                  ? 'bg-muted/40 text-foreground/80'
                  : 'border-dashed text-muted-foreground',
              )}
            >
              {boundPackageId ? (
                <>
                  <PackageIcon className="size-3 shrink-0" />
                  <span className="max-w-[10rem] truncate">{boundPackageLabel}</span>
                </>
              ) : (
                <>
                  <SparklesIcon className="size-3 shrink-0" />
                  {t('console.ai.newApp', { defaultValue: 'New app' })}
                </>
              )}
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('console.ai.switchAppLabel', { defaultValue: 'Build conversations by app' })}
              </DropdownMenuLabel>
              {switchablePackages.map((pkg) => (
                <DropdownMenuItem
                  key={pkg.id}
                  data-testid={`ai-build-package-option-${pkg.id}`}
                  className="text-xs"
                  onSelect={() => {
                    if (pkg.id !== boundPackageId) {
                      openAssistant({ agent: 'build', packageId: pkg.id });
                    }
                  }}
                >
                  <PackageIcon className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{pkg.label}</span>
                  {pkg.id === boundPackageId ? <Check className="size-3 shrink-0" /> : null}
                </DropdownMenuItem>
              ))}
              {switchablePackages.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                data-testid="ai-build-package-option-new"
                className="text-xs"
                onSelect={() => openAssistant({ agent: 'build', fresh: true })}
              >
                <SparklesIcon className="size-3 shrink-0" />
                {t('console.ai.newApp', { defaultValue: 'New app' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {actionsInHost ? null : (
      <div className="flex shrink-0 items-center gap-1">
        {showDebug && onDebug ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onDebug}
            disabled={!conversationId}
            aria-label={t('console.ai.buildDoctor')}
            data-testid="ai-chat-debug-button"
            title={conversationId ? t('console.ai.buildDoctorTitle') : t('console.ai.buildDoctorDisabledTitle')}
          >
            <Bug className="h-3.5 w-3.5" />
          </Button>
        ) : null}
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

  // objectui#5694 — the standing unpublished-changes line: shown while the
  // bound package has pending drafts, so it survives scrolling. It renders
  // nothing when the count is 0 or the conversation is unbound.
  // objectui#12965 — not drawn in the package's own Studio: there the Studio
  // top bar's 变更 and 发布 and the applied card's 查看变更并发布 are the ways
  // to review and publish (objectui#12725's ruled artboard draws no bar).
  // objectstack#34610 — it publishes nothing: it points to the shell's draft
  // bar, offers to show the draft when the main area is elsewhere, and shows
  // the receipt of a publish from that bar.
  const pendingDraftsBar =
    isBuildSurface && !onBoundPackageStudio ? (
      <PendingDraftsBar
        packageId={boundPackageId}
        idle={!isLoading}
        draftBarShown={mainAreaInPreview && Boolean(boundPackageId && appPackageOf(boundPackageId) === activeAppPackageId)}
        onShowDraft={showsMainArea && boundPackageId ? () => showAppInMainArea(boundPackageId) : undefined}
      />
    ) : null;

  return (
    <div ref={paneRef} className="relative flex min-h-0 flex-1 px-0">
      {/* Excel→App (cloud#797): float the real-data import affordance above the
          chat when a spreadsheet was attached. Absolute so it doesn't disturb
          the chat/canvas flex layout; the ImportWizard it opens is a modal. */}
      {pendingSheet && dataSource ? (
        <div className="pointer-events-none absolute top-2 left-0 right-0 z-20 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-3xl">
            <ExcelImportBar
              file={pendingSheet}
              dataSource={dataSource}
              onDone={() => setPendingSheet(null)}
            />
          </div>
        </div>
      ) : null}
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
        onOpenBuilder={openBuilder}
        onInputChange={noteComposerInput}
        // objectui#11667 — the ADR-0057 P4 handoff card's three strings. Left
        // unset, the component's English defaults rendered in every locale.
        builderHandoffTitleLabel={t('console.ai.builderHandoffTitle')}
        builderHandoffOpenLabel={t('console.ai.builderHandoffOpen')}
        builderHandoffSupersededTitle={t('console.ai.builderHandoffSuperseded')}
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
        headerSlot={hideHeader ? undefined : headerSlot}
        // objectui#12978 — the drafts line (`pendingDraftsBar` above) is a row
        // of the composer's own area, in
        // flow above the input. The bar used to float (`absolute bottom-20`)
        // over the chat, and on the full-page chat that put it over the
        // input's first line, hiding the placeholder and the first typed line;
        // in flow, the conversation gives up the room instead, at every width,
        // here and in the console dock, which mounts this same pane.
        promptHeaderSlot={pendingDraftsBar ?? undefined}
        messages={shownMessages}
        placeholder={
          activeAgent
            ? agentRouteName(activeAgent) === 'ask'
              // The generic "Ask {agent}…" doubles to "Ask Ask…" for the data-query
              // agent whose label IS "Ask". Use its purpose-built placeholder instead.
              ? t('console.ai.askAnything')
              // The build agent's composer names what the user can do, never
              // the agent ("Ask Build…" read as「向 构建 提问…」). Inside an app
              // (the build agent scoped to a package: the console dock in a
              // running app, the Studio dock, `/ai/build?package=`) that is
              // asking or changing the app (objectui#11658); outside one it is
              // describing the app to build (objectui#12724).
              : isBuildSurface
                ? editing
                  ? t('console.ai.askOrChangeApp')
                  : t('console.ai.describeAppToBuild')
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
          // Friendly in-progress feedback for the long, atomic propose_blueprint
          // call — a lead-in plus rotating hints so the wait reads as deliberate
          // design work, not a hang. Each hint is translated individually (the
          // established per-string pattern; avoids an i18n returnObjects array).
          designingPlanLabel: t('console.ai.designingPlan', { defaultValue: 'Designing your app…' }),
          designingPlanHints: [
            t('console.ai.designingPlanHint.data', { defaultValue: 'Mapping out the data you’ll track…' }),
            t('console.ai.designingPlanHint.objects', { defaultValue: 'Shaping objects and their fields…' }),
            t('console.ai.designingPlanHint.relations', { defaultValue: 'Connecting related records…' }),
            t('console.ai.designingPlanHint.lookups', { defaultValue: 'Setting up relationships and lookups…' }),
            t('console.ai.designingPlanHint.views', { defaultValue: 'Planning the screens and views…' }),
            t('console.ai.designingPlanHint.forms', { defaultValue: 'Laying out forms and lists…' }),
            t('console.ai.designingPlanHint.defaults', { defaultValue: 'Adding sensible defaults and validations…' }),
            t('console.ai.designingPlanHint.dashboard', { defaultValue: 'Sketching a dashboard to track it…' }),
            t('console.ai.designingPlanHint.review', { defaultValue: 'Double-checking the structure hangs together…' }),
            t('console.ai.designingPlanHint.finalize', { defaultValue: 'Pulling the plan together…' }),
          ],
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
        // objectui#12724 — the finished build card's PRIMARY action: an in-app
        // navigation into the app the agent just built, which lands on its
        // first navigation item (`/apps/<app>`'s declared landing).
        onOpenBuiltApp={(appName, appSegment) =>
          navigate(`/apps/${encodeURIComponent(appSegment ?? appName)}`)}
        openBuiltAppLabel={t('console.ai.openBuiltApp', { defaultValue: 'Open app' })}
        // The secondary door (在 Studio 中查看): Studio is the built app's
        // iteration home (direct edit + the same copilot conversation in the
        // dock, which the build's binding resumes). The package id is the
        // canvas segment (one package = one app).
        onDesignBuiltApp={(_appName, appSegment) => {
          const pkg = appSegment ?? boundPackageId;
          if (!pkg) return;
          navigate(`/studio/${encodeURIComponent(pkg)}/interfaces`);
        }}
        designBuiltAppLabel={t('console.ai.viewBuiltAppInStudio', { defaultValue: 'View in Studio' })}
        // Artifact deep links: every artifact the agent built gets a one-click
        // path to where it can be edited BY HAND (object → Data, flow →
        // Automations, dashboard/page/view/app → Interfaces). Returns null for
        // types with no direct-edit home (seed/dataset) → rendered as text.
        getArtifactAction={(artifact, appSegment) => {
          const path = artifactStudioPath(appSegment ?? boundPackageId, artifact);
          return path ? () => navigate(path) : null;
        }}
        // Live lifecycle truth for draft cards: the server's pending count per
        // package, so reloaded conversations show Published/Publish honestly.
        fetchPendingDraftCount={fetchPendingDraftCount}
        subscribeMetadataRefresh={subscribeMetadataRefresh}
        onPublishDrafts={async (packageId) => {
          // Promote the conversation's staged drafts to live (ADR-0033 gate —
          // the human still clicks). Same call as the floating chat + PackagesPage.
          //
          // objectui#10039 — through `MetadataClient`, not a bare `fetch`. The
          // route answers the runtime authoring gate's per-draft advisories on
          // each `published[]` element (objectstack#9343), and the client is
          // the seam that reports them: one advisory event per advised item,
          // into the same sink, renderer and wording every other write door
          // uses. A bare fetch had nothing to report THROUGH — so on the one
          // surface where the author never sees the metadata they are
          // publishing, the gate's findings were the thing that vanished.
          // Same move PR objectui#10038 made for the two
          // sibling call sites.
          try {
            const payload = (await metadataClient.publishPackageDrafts(packageId)) as
              | (Record<string, unknown> & {
                  success?: boolean;
                  outcome?: string;
                  error?: { message?: string };
                  failedCount?: number;
                  failed?: PublishFailure[];
                  seedApplied?: { success?: boolean; error?: string; errors?: unknown[] };
                })
              | null;
            // A non-2xx now throws inside the client with the server's own
            // message, caught below like any other failure. What is left here
            // is the 2xx batch verdict.
            // objectstack#33277 — `published_unregistered` answers `success:
            // false` over drafts that DID land (the registry refused an object,
            // whose warning the client has already reported): not a failure
            // here, as it was not while the server answered `published`.
            if (payload?.success === false && payload?.outcome !== 'published_unregistered') {
              // The status is no longer in hand — a non-2xx threw above — so
              // the last rung is a sentence rather than "HTTP 200".
              throw new Error(
                readEnvelopeFailureText(payload) ||
                  t('console.ai.publishFailed', { defaultValue: 'Publish failed' }),
              );
            }
            // One spelling for `failedCount` / `failed[]` / `seedApplied`: the
            // client unwraps the dispatcher's `{ success, data }` for this
            // route (the one route whose spec declaration says it arrives
            // inside one), so the enveloped and unenveloped compositions are
            // already reconciled before they get here.
            const failedCount = payload?.failedCount ?? 0;
            if (failedCount) {
              // framework 15.1+ (ADR-0067 D2): a failed batch is ALL-OR-NOTHING
              // (rolled back, nothing landed); `failed[]` carries the causal
              // item plus batch_aborted markers. Surface the reason — the old
              // `String(failedCount)` produced a toast that read just "3".
              const failedList = (payload?.failed ?? []) as PublishFailure[];
              throw new Error(
                failedList.length > 0 ? formatPublishFailures(failedList) : String(failedCount),
              );
            }
            // Surface a seed-load problem (reported under `seedApplied`, never
            // thrown) so "Published!" can't hide silently empty tables.
            //
            // The toast says the pack's sentence, the one the chat's
            // publish-health line says for the same failure (objectstack#32984:
            // user-facing text is the customer sentence). The loader's `error`
            // (engine text) and `errors[]` (structured rows) are for whoever
            // repairs the seed: they go to the console whole, never the toast,
            // and stay in the health line's technical details.
            const seedApplied = payload?.seedApplied;
            if (seedApplied && seedApplied.success === false) {
              console.warn('[app-shell] Published, but the seed failed to load:', {
                packageId,
                error: seedApplied.error,
                errors: seedApplied.errors,
              });
              toast.warning(
                t('console.ai.seedWarn', { defaultValue: 'Published, but some sample data failed to load.' }),
                { description: t('chatbot.build.health.seedFailed', { defaultValue: 'Sample data failed to load.' }) },
              );
            } else {
              toast.success(t('console.ai.publishOk', { defaultValue: 'Published — objects are now live.' }));
            }
            // The live registry just changed but the chat-card publish path
            // does not reload the page (unlike DraftPreviewBar). Pulse every
            // mounted MetadataProvider so open forms/views (incl. the canvas
            // preview) refetch the new schema instead of showing stale, empty
            // dropdowns until a manual reload.
            emitMetadataRefresh();
            // ADR-0038 L3 — hand the runtime verification (seedApplied +
            // probes) back to the chat so the Published card grows a
            // build-health line instead of claiming bare success.
            return { ok: true, health: publishHealthFromResponse(payload) };
          } catch (e) {
            toast.error(t('console.ai.publishFailed', { defaultValue: 'Publish failed' }), {
              description: e instanceof Error ? e.message : undefined,
            });
            return false;
          }
        }}
        // objectstack#34610 — the cards draw no Publish: the screen's one is
        // the shell's bar (the draft bar or the unpublished-app bar; in
        // Studio, its top bar), and the drafts line above points to it.
        // `onPublishDrafts` stays for auto-publish and the Published badge.
        publishFromShellBar
        // objectui#12894 — the applied card's two doors (handlers above). With
        // the review door wired, the card offers 查看变更并发布 in place of its
        // inline Publish; 撤销 is drawn only while the adapter is up.
        onReviewDrafts={reviewDrafts}
        onDiscardDrafts={dataSource ? discardDrafts : undefined}
        publishDraftsLabel={t('console.ai.publishDrafts', { defaultValue: 'Publish' })}
        publishedLabel={t('console.ai.published', { defaultValue: 'Published' })}
        nextStepsLabel={t('console.ai.nextSteps', { defaultValue: "What's next" })}
        planTitleLabel={t('console.ai.planTitle', { defaultValue: 'Proposed plan' })}
        resolveAppLabel={resolveAppLabel}
        resolveObjectLabel={resolveObjectLabel}
        resolveFieldLabel={resolveFieldLabel}
        resolveFieldTypeLabel={resolveFieldTypeLabel}
        planQuestionsLabel={t('console.ai.planQuestions', { defaultValue: 'Confirm before building' })}
        planAssumptionsLabel={t('console.ai.planAssumptions', { defaultValue: 'Assumptions' })}
        planDeferredLabel={t('console.ai.planDeferred', { defaultValue: 'Not yet built' })}
        planApproveHintLabel={t('console.ai.planApproveHint', {
          defaultValue: 'Reply to approve or adjust this plan.',
        })}
        planApproveLabel={t('console.ai.planApprove', { defaultValue: 'Build it' })}
        planAdjustLabel={t('console.ai.planAdjust', { defaultValue: 'Adjust' })}
        planBuiltLabel={t('console.ai.planBuilt', { defaultValue: 'Built' })}
        planBuildingLabel={t('console.ai.planBuilding', { defaultValue: 'Building…' })}
        planReadyLabel={t('console.ai.planReady', {
          defaultValue: 'The plan is ready. Build it now, or tell me what to adjust.',
        })}
        planApproveMessage={planApproveMessage}
        planApproveDefaultsMessage={planApproveDefaultsMessage}
        changesTitleLabel={t('console.ai.changesTitle', { defaultValue: 'Confirm changes' })}
        changesConfirmedLabel={t('console.ai.changesConfirmed', { defaultValue: 'Confirmed' })}
        changesConfirmLabel={t('console.ai.changesConfirm', { defaultValue: 'Confirm' })}
        changesConfirmHintLabel={t('console.ai.changesConfirmHint', {
          defaultValue: 'Reply to confirm or adjust this change.',
        })}
        changesConfirmMessage={changesConfirmMessage}
        changeVerbLabels={changeVerbLabels}
        changesApplyingLabel={t('console.ai.changesApplying', { defaultValue: 'Applying…' })}
        changesAppliedLabel={t('console.ai.changesApplied', { defaultValue: 'Applied' })}
        changesDraftedLabel={t('console.ai.changesDrafted', { defaultValue: 'Saved as draft' })}
        changesFailedLabel={t('console.ai.changesFailed', { defaultValue: 'Not applied' })}
        // objectui#8219 / objectui#7254 — the chip READS the artifact's display
        // label when the host has one, and keeps the internal `type · name`
        // pair REACHABLE on its tooltip. No label → the pair, as before.
        surfaceContextLabel={
          surfaceContext?.artifact
            ? t('console.ai.discussing', {
                defaultValue: 'Viewing: {{target}}',
                target:
                  surfaceArtifactLabel ||
                  `${surfaceContext.artifact.type} · ${surfaceContext.artifact.name}`,
              })
            : undefined
        }
        surfaceContextTitle={
          surfaceContext?.artifact
            ? `${surfaceContext.artifact.type} · ${surfaceContext.artifact.name}`
            : undefined
        }
        planAnswerMessage={(question, option) =>
          outboundText('planAnswerMessage', { question, option })
        }
        // objectstack#27480 — the two answers of the extend-or-new question an
        // `iterate_or_new` plan asks: outbound text, so the conversation's
        // language picks them, like every message above.
        planExtendExistingMessage={(app) => outboundText('planExtendExistingMessage', { app })}
        planBuildNewAppMessage={outboundText('planBuildNewAppMessage')}
        // Self-use "magic moment": when the plan enables it, publish the drafted
        // app automatically the moment the agent finishes — no manual click; the
        // user refreshes and sees it live WITH data. Same governed endpoint.
        autoPublishDrafts={getRuntimeConfig().features.autoPublishAiBuilds}
        // objectstack#34610 — each drafted artifact refreshes the main area in
        // place (ADR-0037 Phase 2) and, in a turn this pane streams, moves it
        // to the app (handlers above).
        onDraftArtifacts={handleDraftArtifacts}
        // A draft card's Preview puts the main area on what it drafted: the
        // app (`onPreviewDraftApp`), or the affected surface — a page, the
        // object's list on a view, the object's default list — at the path
        // `draftPreviewPath` builds in the app routed at the package id
        // (objectui#12968, ADR-0048). With no main area to move (the Studio
        // copilot, whose canvas shows the drafts) the cards draw no Preview.
        onPreviewDraftApp={
          showsMainArea
            ? (appName, opts) =>
                showAppInMainArea(opts?.appSegment ?? appName, { materialized: opts?.materialized === true })
            : undefined
        }
        onPreviewDraft={
          showsMainArea
            ? (items, { appSegment }) => showAppInMainArea(appSegment, { path: draftPreviewPath(items, appSegment) })
            : undefined
        }
        // ADR-0045: build materialized → the main area shows the real
        // (unlisted) app, whose own bar publishes it.
        onBuildMaterialized={handleBuildMaterialized}
        // objectui#11666 — mirrored onto the assistant bus (effect above).
        onPlanApprovalPendingChange={onPlanApprovalPendingChange}
        previewDraftLabel={t('console.ai.previewDraft', { defaultValue: 'Preview' })}
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

function metadataAssistantSuggestions(t: TranslationFn): string[] {
  // Creation-first starters: the authoring agent's job is to BUILD from a
  // natural-language description (the magic moment), so the empty-state nudges
  // toward "describe a system" rather than inspecting existing schema.
  //
  // cloud#1984 — these are the PRODUCT's own recommendations, so they may only
  // ask for what ADR-0112 v1 builds: objects, fields, views (grid / kanban /
  // calendar / gallery), pages, dashboards and sample data. No wording that
  // promises autonomous behaviour (alert / remind / notify / automate / status
  // workflow): v1 has no flows, actions or schedules, and the measured
  // behaviour is that the model silently DEGRADES such a request into a board
  // or a filtered view — so the chip promises an alert and delivers a page.
  // REVERT to the automation wording when ADR-0112 v2 re-adds flows and
  // actions. The `defaultValue`s below are byte-equal to the `en` pack.
  return [
    t('console.ai.suggestions.metadataAssistant.buildCrm', { defaultValue: 'Build a sales CRM — customers, contacts, and deals with a stage field, plus a dashboard that totals deal value by stage.' }),
    t('console.ai.suggestions.metadataAssistant.buildApp', { defaultValue: 'Create a project tracker — projects, tasks with owners and due dates, a board grouped by status, and a calendar of due dates.' }),
    t('console.ai.suggestions.metadataAssistant.buildFlow', { defaultValue: 'Design a support desk — tickets with priority and status fields, a board grouped by status, and links to customers.' }),
    t('console.ai.suggestions.metadataAssistant.buildInventory', { defaultValue: 'Build an inventory app — products, stock levels, suppliers, and a view that filters the items below their reorder point.' }),
    t('console.ai.suggestions.metadataAssistant.buildRecruiting', { defaultValue: 'Make an applicant tracker — candidates, open roles, an interview-stage field, and a board grouped by stage.' }),
  ];
}

function genericSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.generic.help', { defaultValue: 'What can you help me with?' }),
    t('console.ai.suggestions.generic.availableObjects', { defaultValue: 'List the available data objects.' }),
    t('console.ai.suggestions.generic.recentActivity', { defaultValue: 'Summarize my recent activity.' }),
  ];
}

// ADR-0057 A1.b — edit-mode starters: when the build surface is bound to an
// existing app (`?package=`), nudge toward INCREMENTAL changes to that app
// rather than describing a new system from scratch.
//
// objectui#7709 — same rule as `metadataAssistantSuggestions()` above: these
// are the PRODUCT's own recommendations, so they may only ask for what
// ADR-0112 v1 BUILDS. The fourth chip used to be `addAutomation` ("an
// approval, a status flow, or a notification") and every capability it named
// is refused by v1 (cloud#1956 / PR #1970), so it now asks for sample data —
// `seed` IS on v1's whitelist, and having no data is what an existing app most
// often lacks. REVERT: when ADR-0112 v2 re-adds flows and actions, THIS chip's
// automation wording comes back as `addAutomation`. The `defaultValue`s below
// are byte-equal to the `en` pack.
function editAppSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.editApp.addField', { defaultValue: 'Add a field to one of the objects.' }),
    t('console.ai.suggestions.editApp.addObject', { defaultValue: 'Add a new object and relate it to an existing one.' }),
    t('console.ai.suggestions.editApp.addDashboard', { defaultValue: 'Add a dashboard for the key metrics.' }),
    t('console.ai.suggestions.editApp.addSampleData', {
      defaultValue: 'Fill the existing objects with realistic sample records so I can demo the app.',
    }),
  ];
}

/**
 * objectstack#34608 item 4 — the data-question starters the build agent offers
 * beside its edit chips when bound to an app: the maker's composer answers data
 * questions too. Reuses the data agent's own strings.
 */
export function editAppDataSuggestions(t: TranslationFn): string[] {
  return [
    t('console.ai.suggestions.dataChat.recentRecords', { defaultValue: 'List the 5 most recently created records.' }),
    t('console.ai.suggestions.dataChat.recordCounts', { defaultValue: 'Count records for each object.' }),
  ];
}

export function buildAgentSuggestions(
  agentName: string | undefined,
  agentLabel: string,
  t: TranslationFn,
  // ADR-0057 A1.b — the build surface is editing an existing app, so offer
  // change-oriented starters instead of the from-scratch authoring ones.
  editing = false,
): string[] {
  // Alias-aware: `ask`/`data_chat` → data starters, `build`/`metadata_assistant`
  // → authoring starters (edit-mode variant when bound to an app). Custom agents
  // fall back to a name/label heuristic.
  if (isAskAgent(agentName)) return dataChatSuggestions(t);
  if (isBuildAgent(agentName)) return editing ? editAppSuggestions(t) : metadataAssistantSuggestions(t);
  const lower = (agentName ?? agentLabel).toLowerCase();
  if (lower.includes('data')) return dataChatSuggestions(t);
  if (lower.includes('metadata')) return metadataAssistantSuggestions(t);
  return genericSuggestions(t);
}

export default AiChatPage;
