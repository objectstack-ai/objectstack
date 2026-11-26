/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ChatbotEnhanced — composed on top of vendored Vercel AI Elements
 * (src/elements/, MIT). Public props remain backwards compatible with the
 * previous custom implementation; internally we now get:
 *  - multi-line auto-growing prompt input (PromptInput)
 *  - smart reverse-stick scroll (Conversation + useStickToBottom)
 *  - message action toolbar surface (Message.actions slot)
 *  - tool-call visualisation (Tool* family)
 *  - reasoning / chain-of-thought collapsible (Reasoning*)
 *  - inline citations / sources panel (Sources*)
 *  - suggestion chips on empty state (Suggestion; wrapped in a flex-wrap row)
 *  - streaming markdown via streamdown (used by Message internals)
 */
import * as React from 'react';
import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { formatNumber, useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { AlertCircle, Copy, Check, RefreshCw, CornerDownLeft, Bot, Clock3, CheckCircle2, ChevronDown, XCircle, Loader2, TriangleAlert, Table2, WifiOff, Sparkles, Hourglass, Trash2 } from 'lucide-react';
import type { ChatStatus } from 'ai';
import {
  humanizeToolName,
  isRateLimitError,
  isUnsentSendError,
  parseAiQuotaError,
  summarizeChatError,
  unwrapToolResult,
  type ToolTitleTranslator,
} from './tool-display';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './elements/conversation';
import {
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  MessageResponse,
  type MessageProps,
} from './elements/message';
import { ListLinkContext, RecordLinkContext } from './recordLink';
import type { OpenListLink } from './recordLink';
import { isHitlContinuation } from './hitlContinuation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputHeader,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  type PromptInputMessage,
} from './elements/prompt-input';
import { Suggestion } from './elements/suggestion';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  type ToolStatusLabels,
} from './elements/tool';
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from './elements/reasoning';
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from './elements/sources';
import {
  detectPackageRemovedResult,
  type RecordWrite,
  type SampleDataCleanup,
  type PackageRemoval,
} from './mapMessages';
import type { DatasetProvenance, ObjectQuerySource, RecordCitationParsed } from '@objectstack/spec/ai';
import { AnswerSourceBlock } from './AnswerSource';
import { RecordCitations } from './RecordCitations';

/**
 * One chat message as `<ChatbotEnhanced>` RENDERS it — the runtime contract of
 * this package. Not `@object-ui/types`' `ChatMessage`, which is the JSON/SDUI
 * AUTHORING contract (`ChatbotSchema['messages']`); `toRuntimeMessages`
 * converts one into the other. Two meanings, two names (objectui#6349,
 * batch 5): this declaration used to be called `ChatMessage` too.
 */
export interface ChatbotEnhancedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  avatar?: string;
  avatarFallback?: string;
  /** Streaming flag — surfaces a shimmer cursor on the assistant bubble. */
  streaming?: boolean;
  /**
   * Tool invocations attached to this message. Mirrors the AI SDK's
   * `ToolUIPart` shape (see `vercel/ai` v3) so we can render them with the
   * vendored `<Tool>` element without any extra mapping.
   */
  toolInvocations?: ChatbotEnhancedToolInvocation[];
  /** Chain-of-thought / reasoning text emitted alongside the answer. */
  reasoning?: string;
  /** Optional citation / RAG sources for this assistant message. */
  sources?: ChatSource[];
  /** Optional backend trace id (e.g. `ai_traces.id`) for debugging. */
  traceId?: string;
  /**
   * Charts to render inline in the assistant bubble, lifted from the stream's
   * `data-chart` parts (emitted by the `visualize_data` tool via
   * `ctx.onProgress`). Each renders through the platform's SDUI `<chart>`
   * component, so an AI data answer can show a bar/line/pie chart rather than
   * only a wall of text.
   */
  charts?: ChatChart[];
  /**
   * The answer's verified record citations (ADR-0160 D9), lifted from the
   * message's `data-record-citations` part by `extractRecordCitations`. Drawn
   * as chips beside the "How this was computed" block; a click opens the
   * cited record at its section through `onOpenRecord`.
   */
  recordCitations?: RecordCitationParsed[];
}

/**
 * A chart lifted from a `data-chart` stream part. Mirrors the `schema` prop of
 * the SDUI `<chart>` renderer (plugin-charts `ChartRenderer`), so its chart
 * keys can be fed straight into `<SchemaRenderer schema={{ type: 'chart', … }} />`;
 * `textOffset` is the one key that places the chart in the bubble instead.
 */
export interface ChatChart {
  chartType?:
    | 'bar'
    | 'column'
    | 'horizontal-bar'
    | 'line'
    | 'area'
    | 'pie'
    | 'donut'
    | 'radar'
    | 'scatter';
  /** Optional chart title shown above the chart. */
  title?: string;
  /** Aggregated rows — one object per category. */
  data: Array<Record<string, unknown>>;
  /** Field name used for the category axis (x-axis / pie slices). */
  xAxisKey?: string;
  /** One entry per plotted measure. `dataKey` is the row column to read. */
  series: Array<{ dataKey: string; label?: string }>;
  /**
   * Where the chart sits in the answer: how many characters of the message's
   * `content` the stream produced before it (objectui#13492). The bubble
   * renders the text up to that point, then the chart, then the rest, so a
   * chart the model drew before writing its analysis shows first. Absent, or
   * past the end of `content`, the chart renders after all the text.
   * `mapMessages` sets it from the part order; it is a placement key and never
   * reaches the `<chart>` schema.
   */
  textOffset?: number;
}

/**
 * One tool invocation as `<ChatbotEnhanced>` RENDERS it: the AI SDK v6 states
 * (the three approval states included) plus the render-only keys
 * `mapMessages.ts` lifts out of tool results. Not `@object-ui/types`'
 * `ChatToolInvocation`, the AUTHORING face that refuses those states
 * (objectui#10018). Two meanings, two names (objectui#6349, batch 5): this
 * declaration used to be called `ChatToolInvocation` too.
 */
export interface ChatbotEnhancedToolInvocation {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  errorText?: string;
  /**
   * AI SDK v6 lifecycle states for a tool part. Defaults to
   * `output-available` when only `result` is present and `input-available`
   * when only `args` is present.
   */
  state?:
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied';
  /**
   * AI SDK v6 approval envelope, mirrored from `@object-ui/types`'
   * `ChatToolInvocation` (objectui#8442). The SDK requires it alongside the
   * three approval states; it is what carries a rehydrated pending approval's
   * identity and, once decided, the decision itself.
   *
   * ⚠️ Distinct from `pendingActionId` below and NOT a replacement for it:
   * this is the SDK's own request id, while `pendingActionId` is the
   * ObjectStack `pending_actions` row the REST approve/reject endpoints take.
   * The approval affordance is wired on the latter.
   */
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
    isAutomatic?: boolean;
    signature?: string;
  };
  /**
   * ObjectStack HITL extension. When the framework's `action-tools.ts`
   * proposes a destructive action that requires human approval, the tool
   * result carries `{ status: 'pending_approval', pendingActionId: 'pa_…' }`.
   * `mapMessages.ts` lifts that id here so chat UIs can call the
   * `POST /api/v1/ai/pending-actions/:id/{approve,reject}` REST endpoints
   * without parsing the tool result JSON themselves.
   */
  pendingActionId?: string;
  /**
   * cloud#1658 — the ask agent's `open_record` structured hand-off. Rendered as a "打开这条记录 →" action landing
   * on the record the agent already resolved.
   */
  recordHandoff?: {
    objectName: string;
    recordId: string;
    label?: string;
    reason?: string;
  };
  /**
   * cloud#3565 — the ONE-record write the user confirms on a card before it is
   * written (`create_record` / `update_record`). Rides the same pending
   * approval as `pendingActionId`; the card draws the record, old → new on an
   * update, and three buttons: 确认 / 打开完整表单 / 取消.
   */
  recordWrite?: RecordWrite;
  /**
   * The `source` block a data tool answered beside its result: what the
   * answer was computed from, drawn for every reader as the turn's collapsed
   * "How this was computed" block. Only this lifted copy is drawn there, never
   * `result` itself.
   */
  answerSource?: ObjectQuerySource | DatasetProvenance;
  /**
   * cloud#3565 — 「清理示例数据」: the tables and counts the seed ledger
   * recorded, listed on the card before the user confirms (the generic
   * Approve / Deny strip is the decision).
   */
  sampleDataCleanup?: SampleDataCleanup;
  /**
   * objectstack#31025 — 「删除软件包」: the objects with their row counts, the
   * other items by type, and whether the tables are dropped, listed on the card
   * before the user confirms (the generic Approve / Deny strip is the decision).
   */
  packageRemoval?: PackageRemoval;
}

export interface ChatSource {
  id?: string;
  title?: string;
  url: string;
}

/**
 * Localizable UI strings for the chat surface. Every field is optional and
 * falls back to an English default, keeping existing callers source-compatible.
 */
export interface ChatbotLabels {
  /** Empty-state heading shown before the first message. */
  emptyTitle?: string;
  /** Empty-state supporting line. */
  emptyDescription?: string;
  /** "Clear conversation" action label. */
  clear?: string;
  /** Trailing hint next to the send button (e.g. "to send"). */
  sendHint?: string;
  /**
   * objectui#12724 — the newline half of the composer's key hint, after
   * "Shift+↵" («↵ 发送 · Shift+↵ 换行»). Omitted, the hint names sending only.
   */
  newlineHint?: string;
  /** Compact agent activity heading shown in summary mode. */
  agentActivity?: string;
  /** Status label for completed tool work. */
  toolCompleted?: string;
  /** Status label for running tool work. */
  toolRunning?: string;
  /** Status label for tool work waiting for approval. */
  toolAwaitingApproval?: string;
  /** Status label for failed tool work. */
  toolFailed?: string;
  /** Helper text explaining that raw internals are hidden. */
  toolDetailsHidden?: string;
  /** Message action label for copying assistant text. */
  copy?: string;
  /** Message action label shown after a successful copy. */
  copied?: string;
  /** Message action label for regenerating the last assistant response. */
  regenerate?: string;
  /** Accessible label for the model picker. */
  model?: string;
  /** Accessible label for the submit button. */
  submit?: string;
  /** Accessible label for the attachment file picker. */
  uploadFiles?: string;
  /** Accessible label for the stop-streaming button. */
  stopResponse?: string;
  /**
   * Inline notice shown when a message couldn't be sent because of rate-limiting
   * (HTTP 429). The user's text is restored to the composer, so the copy should
   * reassure them it isn't lost — e.g. "You're sending too quickly — your message
   * is kept below, wait a moment and try again."
   */
  sendFailedRateLimited?: string;
  /**
   * Inline notice for any other send failure (network / 5xx). Like
   * {@link sendFailedRateLimited}, the text is restored, so reassure the user.
   */
  sendFailedGeneric?: string;
  /** Trace link label in debug mode. */
  trace?: string;
  /** Trace link tooltip in debug mode. */
  viewTrace?: string;
  /**
   * Shown beside a running turn once the server stream goes quiet (no bytes for
   * a few seconds) — e.g. "Waiting for server…". Honest stall cue, not a claim
   * of progress.
   */
  connectionWaiting?: string;
  /**
   * Shown when a running turn's stream has gone quiet past the threshold —
   * e.g. "Still working…". Pairs with the live elapsed timer so the user sees
   * both that we are waiting and for how long.
   */
  connectionStalledLabel?: string;
  /**
   * Shown when the browser reports it is offline (navigator.onLine === false)
   * mid-turn — e.g. "Connection lost — reconnecting…". The honest disconnect cue.
   */
  connectionOfflineLabel?: string;
}

export type ChatbotProcessVisibility = 'hidden' | 'summary' | 'debug';
export type ChatbotSurface = 'card' | 'plain';

export interface ChatbotEnhancedProps extends React.HTMLAttributes<HTMLDivElement> {
  messages?: ChatbotEnhancedMessage[];
  placeholder?: string;
  /**
   * Send handler. Signature kept backwards compatible — `files` is the list
   * of attachments selected via the prompt-input action menu.
   */
  onSendMessage?: (message: string, files?: File[]) => void;
  onClear?: () => void;
  /** Stop the current streaming response */
  onStop?: () => void;
  /** Reload / retry the last assistant message */
  onReload?: () => void;
  /**
   * Called when the user clicks the upgrade / top-up CTA shown for an AI quota
   * refusal (429 from the cloud token guardrail). Hosts typically open the cloud
   * billing/pricing page. When omitted, no CTA button is shown.
   */
  onUpgrade?: () => void;
  disabled?: boolean;
  /**
   * Render a static, non-interactive transcript: hides the prompt-input
   * composer entirely so the conversation can be embedded in a public /
   * read-only surface (e.g. a `/s/:token` share page). The detailed tool
   * cards still render — but their action buttons stay hidden because the
   * host passes no `onSendMessage` callback, so the cards degrade to their
   * read-only/summary form.
   */
  readOnly?: boolean;
  /**
   * Whether the assistant is currently generating a response. While it is
   * true a message the user sends is queued until the turn ends.
   */
  isLoading?: boolean;
  /** Current streaming/API error */
  error?: Error;
  /**
   * objectstack#33562 — the text a not-sent `error` gives back to the
   * composer, when the host, not the composer, holds what was not sent: e.g.
   * two messages the host joined into one while it waited to send them. Read
   * once per not-sent error and only into an empty box, like the composer's
   * own text, but restored whichever way it was sent: a suggestion chip the
   * host held comes back too, where the composer alone restores only typed
   * text. Absent = the text the composer last typed and submitted.
   */
  unsentText?: string;
  showTimestamp?: boolean;
  /**
   * Render avatars beside each message (assistant gets a bot glyph, the user
   * gets their initial / image). Defaults to false to preserve the previous
   * minimal layout for existing callers.
   */
  showAvatars?: boolean;
  userAvatarUrl?: string;
  userAvatarFallback?: string;
  assistantAvatarUrl?: string;
  assistantAvatarFallback?: string;
  /**
   * Hide the internal "clear conversation" strip. Hosts that surface a clear
   * / new-chat control in their own chrome (e.g. a floating panel header) set
   * this to avoid a redundant second header row.
   */
  hideClearBar?: boolean;
  maxHeight?: string;
  /** Kept for back-compat — markdown is now always rendered by streamdown. */
  enableMarkdown?: boolean;
  /** Enable the attachment action menu. */
  enableFileUpload?: boolean;
  /** Comma-separated list (or accept string) forwarded to the file picker. */
  acceptedFileTypes?: string;
  /** Max file size in bytes (default 10 MB). */
  maxFileSize?: number;
  /**
   * Optional suggestion chips rendered on the empty conversation state.
   * Clicking a chip submits the message immediately.
   */
  suggestions?: string[];
  /**
   * Optional UI string overrides for localization. Each field falls back
   * to its English default, so existing callers keep working unchanged.
   */
  labels?: ChatbotLabels;
  /**
   * Available LLM models for the picker (sourced from
   * `GET /api/v1/ai/models` exposed by `@objectstack/service-ai`).
   */
  models?: ChatbotModelOption[];
  /** Currently selected model id (controlled). */
  selectedModelId?: string;
  /** Fired when the user picks a different model. */
  onModelChange?: (modelId: string) => void;
  /**
   * objectstack#33660 — the used share (0..1) of the environment's AI
   * allowance, as `GET /api/v1/ai/usage` answers it (`pool.fraction`). With it,
   * and a model that carries a `costMultiplier`, the model picker notes the
   * share left and what a costlier model does to it. Absent (usage not served,
   * unmetered, unknown) → the multipliers show alone.
   */
  allowanceUsedFraction?: number;
  /**
   * Optional banner rendered between the message-count strip and the
   * conversation. Used by shell-level UIs (e.g. Studio's assistant status
   * row) without forcing them to fork the whole component.
   */
  headerSlot?: React.ReactNode;
  /**
   * Optional overlay rendered absolute-positioned above the prompt input.
   * Intended for slash-command palettes / inline suggestion popups.
   */
  promptOverlaySlot?: React.ReactNode;
  /**
   * Optional row rendered IN FLOW at the top of the prompt area, directly
   * above the prompt input and inside the prompt's column. Unlike
   * {@link promptOverlaySlot} it takes layout space: the conversation above
   * shrinks to make room, so the row covers neither the input nor the last
   * message (objectui#12978 — the host's standing pending-drafts bar, which
   * used to float over the input's first line). Content that renders nothing
   * takes no space: the row is hidden while it is empty.
   */
  promptHeaderSlot?: React.ReactNode;
  /**
   * Fired on every keystroke in the prompt textarea (forwarded from the
   * AI Elements `PromptInputTextarea`). Lets callers drive a slash-command
   * palette without owning the textarea state.
   */
  onInputChange?: (value: string) => void;
  /**
   * When provided, tool parts in `approval-requested` state render Approve /
   * Deny buttons inside their body. The callback receives the tool's
   * `toolCallId` (use it to look up the AI SDK approval id if different).
   */
  onToolApprove?: (toolCallId: string, approved: boolean, reason?: string) => void;
  /** Label for the approve button (default "Approve"). */
  toolApproveLabel?: string;
  /** Label for the deny button (default "Deny"). */
  toolDenyLabel?: string;
  /** Reason text sent with a denial response (default "User denied the operation"). */
  toolDenyReason?: string;
  /**
   * Client-side overlay for HITL approval outcomes, keyed by `toolCallId`.
   * Driven by `useHitlInChat` (or any caller-owned map). When an entry is
   * present for a tool in `approval-requested` state, the inline buttons are
   * hidden and the configured message renders in their place — giving the
   * operator immediate feedback while the server processes the decision.
   */
  toolDecisions?: Record<string, ToolDecisionState>;
  /**
   * cloud#1658 — open the record an `open_record` hand-off points at. A
   * record citation's chip calls it too (ADR-0160 D9), with the `anchor` of
   * the body section it cites when it names one; the host opens the record at
   * that section.
   */
  onOpenRecord?: (handoff: { objectName: string; recordId: string; label?: string; reason?: string; anchor?: string }) => void;
  /**
   * objectstack#31869 — open the list a `/list/OBJECT` link in an answer
   * names: the object, and optionally a view and the Filter panel conditions.
   * The host resolves the app and builds the list address from these values.
   * Absent → a list link keeps the default link-safety dialog.
   */
  onOpenList?: OpenListLink;
  /** cloud#1658 — the record hand-off card's title. */
  recordHandoffTitleLabel?: string;
  /** cloud#1658 — the record hand-off card's action label. */
  recordHandoffOpenLabel?: string;
  /**
   * cloud#3565 — "打开完整表单" on a record-write card: the host opens the New
   * form prefilled with the card's values (create) or the record's edit form
   * (update). The pending write is cancelled first, so a record saved in the
   * form cannot be written a second time from the card. Absent → the button
   * is disabled.
   */
  onOpenRecordForm?: (write: RecordWrite) => void;
  /** cloud#3565 — the record-write card's title for a create, given the object's label (default "New {object}"). */
  recordWriteCreateTitle?: (objectLabel: string) => string;
  /** cloud#3565 — the record-write card's title for an update, given the object's label (default "Change {object}"). */
  recordWriteUpdateTitle?: (objectLabel: string) => string;
  /** cloud#3565 — the confirm button (default "Confirm"): writes the record as the user. */
  recordWriteConfirmLabel?: string;
  /** cloud#3565 — the open-form button (default "Open the full form"). */
  recordWriteOpenFormLabel?: string;
  /** cloud#3565 — the cancel button (default "Cancel"): nothing is written. */
  recordWriteCancelLabel?: string;
  /** cloud#3565 — the reason stored on a cancelled write (default "Cancelled from the card"). */
  recordWriteCancelReason?: string;
  /** cloud#3565 — the reason stored when the user opens the full form instead (default "Opened the full form instead"). */
  recordWriteOpenFormReason?: string;
  /** cloud#3565 — the label before the fields the server did not include (default "Not included"). */
  recordWriteDroppedLabel?: string;
  /** cloud#3565 — the card's state while the decision is in flight (default "Writing…"). */
  recordWriteSubmittingLabel?: string;
  /** cloud#3565 — the card's state once the record was written (default "Written"). */
  recordWriteWrittenLabel?: string;
  /** cloud#3565 — the card's state once the write was cancelled (default "Cancelled"). */
  recordWriteCancelledLabel?: string;
  /** cloud#3565 — the sample-data cleanup card's title (default "Remove the sample data"). */
  sampleDataCleanupTitleLabel?: string;
  /**
   * cloud#3565 — the sample-data cleanup card's warning that the removal cannot
   * be undone (default "Removed rows cannot be recovered."). Always shown: there
   * is no recycle bin until objectstack#3146 lands.
   */
  sampleDataCleanupIrreversibleLabel?: string;
  /** cloud#3565 — the line for the recorded rows the card does not list (shown when `absent` > 0). */
  sampleDataCleanupAbsentLabel?: (count: number) => string;
  /** cloud#3565 — the line for the recorded rows kept because someone edited them (shown when `edited` > 0). */
  sampleDataCleanupEditedLabel?: (count: number) => string;
  /** objectstack#31025 — the package-removal card's title, given the package's label. */
  packageRemovalTitleLabel?: (packageLabel: string) => string;
  /** objectstack#31025 — an object's row count on the package-removal card. */
  packageRemovalRowsLabel?: (count: number) => string;
  /** objectstack#31025 — what a draft object (no table yet) shows in place of a count. */
  packageRemovalDraftLabel?: string;
  /** objectstack#31025 — what a published object whose rows could not be counted shows in place of a count. */
  packageRemovalRowsUnknownLabel?: string;
  /** objectstack#31025 — the display name of a metadata type in the other-items list (default: the type itself). */
  packageRemovalItemTypeLabel?: (type: string) => string;
  /** objectstack#31025 — the total-rows line. */
  packageRemovalTotalLabel?: (count: number) => string;
  /** objectstack#31025 — the line saying the total is short by the objects that could not be counted (shown when above 0). */
  packageRemovalUncountedLabel?: (count: number) => string;
  /** objectstack#31025 — the destructive line, shown only when the tables are dropped. */
  packageRemovalPermanentLabel?: string;
  /** objectstack#31025 — the line shown when the tables and their records are kept. */
  packageRemovalKeptLabel?: string;
  /** objectstack#31025 — the outcome once the package was removed. */
  packageRemovalRemovedLabel?: string;
  /** objectstack#31025 — the outcome when some items could not be removed, given how many. */
  packageRemovalPartialLabel?: (failed: number) => string;
  /**
   * cloud#1610 — a small chip above the composer naming what the conversation
   * is currently ABOUT (「正在讨论：仪表盘 sales_overview」), so the context the
   * host sends to the agent is visible to the user instead of invisible
   * grounding. Display-only; absent = no chip.
   */
  surfaceContextLabel?: string;
  /**
   * objectui#8219 — the tooltip (`title`) of the {@link surfaceContextLabel}
   * chip. Per objectui#7254, what the chip READS is the display label, and the
   * internal identity (e.g. `dashboard · customer_dashboard`) stays REACHABLE
   * here instead of being printed at the reader. Display-only; ignored when
   * there is no `surfaceContextLabel`; absent = no `title`, as before.
   */
  surfaceContextTitle?: string;
  /**
   * Controls how agent internals are exposed. `summary` keeps end-user chat
   * readable by grouping repeated tool calls and hiding raw args/results.
   * Use `debug` for developer/admin trace views.
   *
   * @default 'summary'
   */
  processVisibility?: ChatbotProcessVisibility;
  /**
   * Visual chrome for the chat surface. `card` keeps the embeddable bordered
   * panel; `plain` removes panel chrome for full-page chat workspaces.
   *
   * @default 'card'
   */
  surface?: ChatbotSurface;
}

/**
 * `decision` says which button the operator pressed, and on an approved
 * `success` `result` is what the dispatcher answered (cloud#3565 — the
 * record-write card draws "written" and the record's link from them; the
 * generic approval strip reads `message` alone, as before).
 *
 * `held`: the confirmation was accepted, but a host policy holds the write
 * for an approval outside the conversation, so nothing has been written yet
 * (the spec's `held` approve outcome). Both cards draw "waiting for
 * approval" for it, never success wording; `result` is what the host
 * answered about the hold.
 */
export type ToolDecisionState =
  | { state: 'pending'; message?: string; decision?: 'approved' | 'rejected' }
  | { state: 'success'; message?: string; decision?: 'approved' | 'rejected'; result?: unknown }
  | { state: 'held'; message?: string; decision?: 'approved'; result?: unknown }
  | { state: 'error'; message: string; decision?: 'approved' | 'rejected' };

export interface ChatbotModelOption {
  id: string;
  label?: string;
  provider?: string;
  /**
   * objectstack#33660 — how much one message on this model draws on the AI
   * allowance, against one on the environment's default model (1). The picker
   * draws it as `×N` beside the label; absent → nothing is drawn.
   */
  costMultiplier?: number;
  /**
   * objectstack#35578 — the display name of the model's tier alone ('Fast'),
   * `AiModelsResponseSchema`'s `tierLabel`. The closed picker shows it in place
   * of `label`; the open list keeps `label`. Absent → the closed picker shows
   * `label`, as before.
   */
  tierLabel?: string;
}

/** A record-write card value as a person reads it: nothing, a list, or the value itself. */
function formatRecordWriteValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((v) => formatRecordWriteValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The record a confirmed write answered with — `{ status:'written', objectName,
 * recordId, label? }` from the dispatcher — so the card can link to it.
 */
function writtenRecordOf(
  result: unknown,
): { objectName: string; recordId: string; label?: string } | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;
  if (r.status !== 'written') return undefined;
  const objectName = typeof r.objectName === 'string' ? r.objectName : '';
  const recordId = typeof r.recordId === 'string' ? r.recordId : '';
  if (!objectName || !recordId) return undefined;
  return { objectName, recordId, ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}) };
}

/**
 * The plain surface's left/right gutter, keyed to the chat's own width (the
 * root is an `@container`), never to the viewport: a 16px gutter on both
 * sides, shared by the message list and the composer so messages, cards and
 * the input align. The gutter drops only once the container is wide enough
 * (`@3xl`, 48rem) that the centred `max-w-2xl` (42rem) column already keeps
 * more than 16px of margin on each side — the full-page chat at full width.
 */
const PLAIN_SURFACE_GUTTER = 'px-4 @3xl:px-0';

/**
 * An assistant turn on the plain surface spans the column below `@3xl`, so its
 * prose, tables and cards end on the same 16px gutter as the composer; at
 * full width it keeps the bubble's usual 95% cap.
 */
const PLAIN_SURFACE_ASSISTANT_WIDTH = 'max-w-full @3xl:max-w-[95%]';

/** The item a selected model none of the offered models carries is shown by. */
const OUTSIDE_MODELS = 'outside';

/** objectstack#33660 — a pick whose DRAWN cost multiplier is this or above asks before it applies. */
const EXPENSIVE_MODEL_MULTIPLIER = 20;

/**
 * objectstack#33660 — a model's cost multiplier as the picker draws it, or
 * `undefined` when it has none to draw (absent, non-finite or not positive).
 * At 1 and above it is rounded to two decimals; below 1 to two significant
 * digits, so a small positive multiplier never reads ×0. The ×20 question
 * compares this drawn value, so what the person reads and whether they are
 * asked always agree.
 */
function drawnMultiplierOf(model: ChatbotModelOption): number | undefined {
  const n = model.costMultiplier;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return n >= 1 ? Math.round(n * 100) / 100 : Number(n.toPrecision(2));
}

/**
 * objectui#11865 — the composer's model picker, drawn with the shared `Select`,
 * the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. What a pick writes is unchanged: `onPick` receives
 * the picked model's `id`, the string the native control's `change` carried,
 * and its accessible name is the same `aria-label`. Re-picking the current
 * model writes nothing, as it did there.
 *
 * - Items carry the model's INDEX, not its id, as the card's other pickers do.
 * - A selected id none of the offered models carries gets an item of its own,
 *   labelled with the id, so the trigger shows the model the host holds. The
 *   native control showed the first model there. Picking that item writes
 *   nothing.
 * - objectstack#33660: a model's `costMultiplier` is drawn as `×N` beside its
 *   label (none drawn when it has none). A pick whose drawn multiplier is
 *   {@link EXPENSIVE_MODEL_MULTIPLIER} or above asks once before it is written;
 *   Cancel writes nothing, and a model that leaves the list while asked is
 *   dropped. Every chat host renders this picker, so none can skip the question.
 * - objectstack#35445: the closed trigger shows the model's label alone. The
 *   multiplier stays on the list rows, where the choice is made.
 * - objectstack#35578: a model that carries a `tierLabel` shows it on the closed
 *   trigger in place of its label (the tier name alone); the label stays
 *   the trigger's title and the list row's text. Without one, the label as above.
 */
function ModelPicker({
  label,
  models,
  value,
  onPick,
  allowanceUsedFraction,
}: {
  label: string;
  models: ReadonlyArray<ChatbotModelOption>;
  value: string;
  onPick: (modelId: string) => void;
  allowanceUsedFraction?: number;
}) {
  const { t, language } = useObjectTranslation();
  // The id a ×20-or-above pick is waiting to apply; `null` while nothing is asked.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  // Read from the CURRENT list, so Confirm writes a model that is still offered
  // and the question states the multiplier the list draws for it now.
  const listed = confirmingId !== null ? models.find((m) => m.id === confirmingId) : undefined;
  const listedDrawn = listed ? drawnMultiplierOf(listed) : undefined;
  const confirming =
    listedDrawn !== undefined && listedDrawn >= EXPENSIVE_MODEL_MULTIPLIER ? listed : undefined;
  // The asked-about model left the list while the question was open, or the list
  // now draws it below the threshold or with no multiplier: drop the pick.
  if (confirmingId !== null && confirming === undefined) setConfirmingId(null);
  const at = models.findIndex((m) => m.id === value);
  // The model in force's full name (the title, and the list row's text) and what
  // the closed trigger shows: its tier name alone when it carries one.
  const inForce = at !== -1 ? (models[at].label ?? models[at].id) : value;
  const shown = at !== -1 ? (models[at].tierLabel ?? inForce) : value;
  // The drawn value is already rounded (drawnMultiplierOf); this only spells it,
  // with as many decimals as that rounding kept.
  const multiplierText = (n: number) =>
    formatNumber(n, {
      locale: language,
      maximumFractionDigits: n >= 1 ? 2 : Math.min(20, 1 - Math.floor(Math.log10(n))),
    });
  // The share of the allowance left, as the console's usage ring reads it; only
  // with usage served and a multiplier to set it against (rule D5: a fraction, never a count).
  const allowanceLeft =
    typeof allowanceUsedFraction === 'number' &&
    Number.isFinite(allowanceUsedFraction) &&
    models.some((m) => drawnMultiplierOf(m) !== undefined)
      ? formatNumber(Math.min(1, Math.max(0, 1 - allowanceUsedFraction)), {
          locale: language,
          style: 'percent',
          maximumFractionDigits: 0,
        })
      : undefined;
  return (
    <>
      <Select
        value={at !== -1 ? String(at) : OUTSIDE_MODELS}
        onValueChange={(token) => {
          // `undefined` for the outside item: it is the host's own model, so there is nothing to write.
          const picked = models[Number(token)];
          if (!picked) return;
          if ((drawnMultiplierOf(picked) ?? 0) >= EXPENSIVE_MODEL_MULTIPLIER) setConfirmingId(picked.id);
          else onPick(picked.id);
        }}
      >
        <SelectTrigger
          aria-label={label}
          title={inForce}
          className="h-7 w-auto min-w-0 max-w-[10rem] gap-1 px-2 text-xs text-muted-foreground hover:text-foreground focus:ring-1 focus:ring-offset-0"
        >
          {/* objectstack#35445 — the closed picker names the model in force and
              nothing else: no provider, no cost figure (the list, where the
              choice is made, carries those). Truncated, with the name on its title. */}
          <SelectValue>
            <span className="truncate" data-testid="model-picker-value">{shown}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {at === -1 && <SelectItem value={OUTSIDE_MODELS}>{value}</SelectItem>}
          {models.map((m, i) => {
            const drawn = drawnMultiplierOf(m);
            return (
              <SelectItem key={`${i}:${m.id}`} value={String(i)}>
                {m.label ?? m.id}
                {m.provider ? ` · ${m.provider}` : ''}
                {drawn !== undefined ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground" data-testid="model-cost-multiplier">
                    ×{multiplierText(drawn)}
                  </span>
                ) : null}
              </SelectItem>
            );
          })}
          {allowanceLeft !== undefined ? (
            <p
              className="mt-1 max-w-64 border-t px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground"
              data-testid="model-allowance-note"
            >
              {t('chatbot.modelPicker.allowanceNote', {
                left: allowanceLeft,
                defaultValue:
                  '{{left}} of your AI allowance is left. A model marked ×N uses it N times as fast as the default model.',
              })}
            </p>
          ) : null}
        </SelectContent>
      </Select>
      <AlertDialog open={confirming !== undefined} onOpenChange={(open) => { if (!open) setConfirmingId(null); }}>
        {confirming ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('chatbot.modelPicker.confirmTitle', {
                  model: confirming.label ?? confirming.id,
                  defaultValue: 'Switch to {{model}}?',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('chatbot.modelPicker.confirmBody', {
                  multiplier: multiplierText(listedDrawn ?? 0),
                  defaultValue:
                    'Each message on this model uses {{multiplier}} times as much of your AI allowance as one on the default model.',
                })}
                {allowanceLeft !== undefined
                  ? ` ${t('chatbot.modelPicker.confirmAllowance', {
                      left: allowanceLeft,
                      multiplier: multiplierText(listedDrawn ?? 0),
                      defaultValue: '{{left}} of it is left, and on this model it runs out {{multiplier}} times as fast.',
                    })}`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('chatbot.modelPicker.confirmCancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onPick(confirming.id);
                  setConfirmingId(null);
                }}
              >
                {t('chatbot.modelPicker.confirmAction', { defaultValue: 'Switch model' })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </>
  );
}

function formatMessageProps(role: ChatbotEnhancedMessage['role']): MessageProps['from'] {
  // The vendored Message only knows user/assistant — render system as assistant
  // (FloatingChatbotProvider already renders system messages inline elsewhere).
  return role === 'user' ? 'user' : 'assistant';
}

/**
 * Heuristic: does a tool/output string look like JSON we should syntax-highlight
 * (object / array literal) rather than render as markdown? Plain prose, code
 * fences, and inline backticks should NOT be rendered as JSON.
 */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  if (!(t.endsWith('}') || t.endsWith(']'))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

type ToolSummaryState = 'running' | 'awaiting' | 'completed' | 'failed';

interface ToolSummaryGroup {
  key: string;
  title: string;
  rawName: string;
  count: number;
  state: ToolSummaryState;
  errorText?: string;
}

export function getToolState(tool: ChatbotEnhancedToolInvocation): ToolSummaryState {
  const state =
    tool.state ??
    (tool.errorText
      ? 'output-error'
      : tool.result !== undefined
        ? 'output-available'
        : 'input-available');

  if (state === 'output-error' || state === 'output-denied') {
    return 'failed';
  }
  if (state === 'approval-requested' || state === 'approval-responded') {
    return 'awaiting';
  }
  if (state === 'output-available') {
    return 'completed';
  }
  return 'running';
}

function shouldRenderDetailedTool(tool: ChatbotEnhancedToolInvocation): boolean {
  const state = getToolState(tool);
  return (
    state === 'awaiting' ||
    state === 'failed' ||
    Boolean(tool.pendingActionId) ||
    Boolean(tool.recordHandoff)
  );
}

function getToolStateRank(state: ToolSummaryState): number {
  switch (state) {
    case 'failed':
      return 4;
    case 'awaiting':
      return 3;
    case 'running':
      return 2;
    case 'completed':
      return 1;
  }
}

/**
 * The conversation store persists tool-call-only assistant turns with an
 * internal placeholder as their text ("(called todo_write, propose_blueprint)"
 * / "(tool call)" / "(no content)"). On re-hydration that placeholder used to
 * render as a normal prose bubble — internal jargon spliced into the thread
 * (#772). Detect it so the renderer can collapse it to a quiet activity note.
 */
function isToolCallPlaceholder(content: string): boolean {
  return /^\((?:called [^)]*|tool call|no content)\)$/.test(content.trim());
}

/** One run of an assistant answer: a slice of its text, or the charts drawn at one point. */
type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'charts'; charts: ChatChart[] };

/**
 * objectui#13492 — an assistant answer in the order the stream produced it:
 * the text up to each chart's `textOffset`, the chart, then the text after.
 * The mapper used to flatten every text part into one `content` and every
 * `data-chart` part into one trailing `charts[]` block, so a chart the model
 * drew first still landed below six paragraphs of analysis.
 *
 * A chart without an offset (a host-built message, the legacy string-content
 * shape) or with one past the text's end trails all of it, which is exactly
 * the old layout. Charts at the same offset share one block, and a slice that
 * is only whitespace is dropped rather than painted as an empty answer box.
 */
function layoutAnswer(content: string, charts: ChatChart[] | undefined): AnswerBlock[] {
  const placed = (charts ?? [])
    .map((chart, order) => ({
      chart,
      order,
      at:
        typeof chart.textOffset === 'number' && Number.isFinite(chart.textOffset)
          ? Math.min(Math.max(chart.textOffset, 0), content.length)
          : content.length,
    }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const blocks: AnswerBlock[] = [];
  let cursor = 0;
  for (const { chart, at } of placed) {
    if (at > cursor) {
      const text = content.slice(cursor, at);
      if (text.trim().length > 0) blocks.push({ kind: 'text', text });
      cursor = at;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'charts') last.charts.push(chart);
    else blocks.push({ kind: 'charts', charts: [chart] });
  }
  const rest = content.slice(cursor);
  if (rest.trim().length > 0) blocks.push({ kind: 'text', text: rest });
  return blocks;
}

/** The charts drawn at one point of an assistant answer, each through the SDUI `<chart>`. */
function AnswerCharts({ charts }: { charts: ChatChart[] }) {
  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="chat-charts">
      {charts.map((chart, i) => (
        <div
          key={i}
          className="rounded-lg border bg-background p-3"
          // The chat bubble is `w-fit` (shrinks to content) while the
          // SDUI chart's ResponsiveContainer is `width:100%` — a
          // circular dependency. We give the chart a DEFINITE width
          // sized to the viewport (NOT the shrink-to-fit parent, which
          // would re-introduce the cycle) so recharts always measures a
          // stable, non-zero width and renders. Height comes from the
          // ChartContainer itself (h-[350px] / min-h 280).
          style={{ width: 'min(520px, 80vw)' }}
          data-testid="chat-chart"
        >
          {chart.title ? (
            <div className="mb-2 text-sm font-medium text-foreground">
              {chart.title}
            </div>
          ) : null}
          <SchemaRenderer
            schema={{
              type: 'chart',
              chartType: chart.chartType ?? 'bar',
              data: chart.data,
              xAxisKey: chart.xAxisKey,
              series: chart.series,
            } as never}
          />
        </div>
      ))}
    </div>
  );
}

function summarizeTools(
  tools: ChatbotEnhancedToolInvocation[],
  /**
   * objectui#7254 — the activity chips name the same tools the detailed cards
   * do, so they take the same `chatbot.tool.*` lookup. Optional so a
   * provider-less caller keeps the English title-caser it always had.
   */
  translateToolTitle?: ToolTitleTranslator,
): ToolSummaryGroup[] {
  const groups = new Map<string, ToolSummaryGroup>();

  for (const tool of tools) {
    const state = getToolState(tool);
    const key = `${tool.toolName}:${state}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.errorText = existing.errorText ?? tool.errorText;
      continue;
    }
    groups.set(key, {
      key,
      title: humanizeToolName(tool.toolName, translateToolTitle) || tool.toolName,
      rawName: tool.toolName,
      count: 1,
      state,
      errorText: tool.errorText,
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const byRank = getToolStateRank(b.state) - getToolStateRank(a.state);
    if (byRank !== 0) return byRank;
    return a.title.localeCompare(b.title);
  });
}

const ChatbotEnhanced = React.forwardRef<HTMLDivElement, ChatbotEnhancedProps>(
  (
    {
      className,
      messages = [],
      placeholder = 'Type your message...',
      onSendMessage,
      onClear,
      onStop,
      onReload,
      onUpgrade,
      disabled = false,
      readOnly = false,
      isLoading = false,
      error,
      unsentText,
      showTimestamp = false,
      showAvatars = false,
      userAvatarUrl,
      userAvatarFallback = 'You',
      assistantAvatarUrl,
      assistantAvatarFallback = 'AI',
      hideClearBar = false,
      maxHeight = '500px',
      enableMarkdown: _enableMarkdown = true,
      enableFileUpload = false,
      // Spreadsheets included (cloud#797 WS3): the AI build panel parses
      // .xlsx/.xlsm/.csv/.tsv attachments locally and briefs the agent — an
      // accept list without them made that whole flow unreachable from the UI
      // (the composer's type filter rejected the file before anything ran).
      acceptedFileTypes = 'image/*,.pdf,.doc,.docx,.txt,.csv,.tsv,.xlsx,.xlsm',
      maxFileSize = 10 * 1024 * 1024,
      suggestions,
      labels,
      models,
      selectedModelId,
      onModelChange,
      allowanceUsedFraction,
      headerSlot,
      promptOverlaySlot,
      promptHeaderSlot,
      onInputChange,
      onToolApprove,
      toolApproveLabel = 'Approve',
      toolDenyLabel = 'Deny',
      toolDenyReason = 'User denied the operation',
      toolDecisions,
      recordHandoffTitleLabel = 'Open this record',
      recordHandoffOpenLabel = 'Open record →',
      onOpenRecordForm,
      recordWriteCreateTitle = (objectLabel) => `New ${objectLabel}`,
      recordWriteUpdateTitle = (objectLabel) => `Change ${objectLabel}`,
      recordWriteConfirmLabel = 'Confirm',
      recordWriteOpenFormLabel = 'Open the full form',
      recordWriteCancelLabel = 'Cancel',
      recordWriteCancelReason = 'Cancelled from the card',
      recordWriteOpenFormReason = 'Opened the full form instead',
      recordWriteDroppedLabel = 'Not included',
      recordWriteSubmittingLabel = 'Writing…',
      recordWriteWrittenLabel = 'Written',
      recordWriteCancelledLabel = 'Cancelled',
      sampleDataCleanupTitleLabel = 'Remove the sample data',
      sampleDataCleanupIrreversibleLabel = 'Removed rows cannot be recovered.',
      sampleDataCleanupAbsentLabel = (count) =>
        `${count} recorded ${count === 1 ? 'row is' : 'rows are'} not listed: you cannot see ${count === 1 ? 'it' : 'them'}, or ${count === 1 ? 'it is' : 'they are'} already gone.`,
      sampleDataCleanupEditedLabel = (count) =>
        `${count} ${count === 1 ? 'row' : 'rows'} edited since being seeded ${count === 1 ? 'stays' : 'stay'}.`,
      packageRemovalTitleLabel = (packageLabel) => `Delete the package ${packageLabel}`,
      packageRemovalRowsLabel = (count) => `${count} ${count === 1 ? 'record' : 'records'}`,
      packageRemovalDraftLabel = 'Draft, no table',
      packageRemovalRowsUnknownLabel = 'Record count unavailable',
      packageRemovalItemTypeLabel = (type) => type,
      packageRemovalTotalLabel = (count) => `${count} ${count === 1 ? 'record' : 'records'} in total`,
      packageRemovalUncountedLabel = (count) =>
        `The total leaves out ${count} ${count === 1 ? 'object whose records' : 'objects whose records'} could not be counted.`,
      packageRemovalPermanentLabel = 'The tables are dropped permanently, with every record in them. Dropped tables do not go to the recycle bin and cannot be restored.',
      packageRemovalKeptLabel = 'The database tables and every record in them are kept; only the package is removed.',
      packageRemovalRemovedLabel = 'The package was deleted.',
      packageRemovalPartialLabel = (failed) =>
        `The package was partly deleted: ${failed} ${failed === 1 ? 'item was' : 'items were'} not removed.`,
      onOpenRecord,
      onOpenList,
      surfaceContextLabel,
      surfaceContextTitle,
      processVisibility = 'summary',
      surface = 'card',
      ...props
    },
    ref
  ) => {
    const promptStatus: ChatStatus = isLoading ? 'streaming' : 'ready';
    const isPlainSurface = surface === 'plain';
    const [copiedId, setCopiedId] = React.useState<string | null>(null);
    // Last text submitted from the composer — used to RESTORE it when a send is
    // rejected before it reaches the model (rate-limit / network), so the user
    // never loses what they typed. Set on submit, read by the restore effect.
    const lastSubmittedRef = React.useRef<string>('');
    // Guards the restore effect so it fires once per failure (not on every
    // re-render while the error sits in state).
    const restoredErrorRef = React.useRef<unknown>(null);

    // objectui#7254 — the pack lookup for every string this component owns.
    // `useSafeTranslate` is provider-safe: with no I18nProvider (tests,
    // standalone hosts) each call returns the English fallback passed beside
    // it, so nothing below can render a raw key.
    const tt = useSafeTranslate();
    // A confirmed write a host policy holds for an approver outside the
    // conversation (decision state `held`): both approval cards read this,
    // never success wording. Borrowed from the inbox's status label so the
    // badge and the card say the same words.
    const heldForApprovalLabel = tt('aiApprovals.statusHeld', 'Waiting for approval');
    // objectstack#32984 — a message typed during a running turn waits here.
    const queuedLabel = tt('chatbot.composer.queued', 'Sends when the current reply finishes');
    const queuedCancelLabel = tt('chatbot.composer.queuedCancel', 'Cancel');
    const { t: tCount, language: composerLanguage } = useObjectTranslation();

    // Resolve localizable strings once. Precedence is host `labels` prop ->
    // locale pack -> the English default this component always shipped, so a
    // console that already translates a string keeps winning and a host that
    // passes nothing now gets the user's language instead of English.
    const L = React.useMemo(
      () => ({
        emptyTitle: labels?.emptyTitle ?? 'Start a conversation',
        emptyDescription:
          labels?.emptyDescription ??
          'Ask anything — the assistant has access to your current app context.',
        clear: labels?.clear ?? 'Clear',
        sendHint: labels?.sendHint ?? 'to send',
        newlineHint: labels?.newlineHint,
        agentActivity: labels?.agentActivity ?? tt('chatbot.toolState.agentActivity', 'Agent activity'),
        toolCompleted: labels?.toolCompleted ?? tt('chatbot.toolState.completed', 'Completed'),
        toolRunning: labels?.toolRunning ?? tt('chatbot.toolState.running', 'Running'),
        toolAwaitingApproval:
          labels?.toolAwaitingApproval ?? tt('chatbot.toolState.awaitingApproval', 'Awaiting approval'),
        toolFailed: labels?.toolFailed ?? tt('chatbot.toolState.failed', 'Failed'),
        // The vendored `ToolHeader` badge's own vocabulary (objectui#7254). It
        // carried a private English table, so a fully Chinese conversation
        // still read "Awaiting Approval" / "Completed" on every card header
        // while the summary chips beside it were translated.
        toolPending: tt('chatbot.toolState.pending', 'Pending'),
        toolResponded: tt('chatbot.toolState.responded', 'Responded'),
        toolDenied: tt('chatbot.toolState.denied', 'Denied'),
        toolError: tt('chatbot.toolState.error', 'Error'),
        toolDetailsHidden:
          labels?.toolDetailsHidden ??
          'Detailed tool inputs and outputs are hidden in this view.',
        copy: labels?.copy ?? 'Copy',
        copied: labels?.copied ?? 'Copied',
        regenerate: labels?.regenerate ?? 'Regenerate',
        model: labels?.model ?? 'Model',
        // objectui#12145 — the composer's send / stop button and an
        // attachment's remove button are icon-only, so these are their
        // accessible names. With no host `labels` they read the pack: the
        // console's own keys for the two names it already passes, and the
        // record attachment list's key for the third — one key per name.
        submit: labels?.submit ?? tt('console.ai.submit', 'Submit'),
        uploadFiles: labels?.uploadFiles ?? 'Upload files',
        stopResponse: labels?.stopResponse ?? tt('console.ai.stopResponse', 'Stop response'),
        removeAttachment: tt('detail.removeAttachment', 'Remove attachment'),
        // objectstack#35445 — the composer's icon-only 「+」 (the attachment
        // menu) and the menu's one item are named for what they do.
        addAttachment: tt('chatbot.composer.addAttachment', 'Add attachment'),
        sendFailedRateLimited:
          labels?.sendFailedRateLimited ??
          "You're sending messages too quickly. Your message is kept below — wait a moment and try again.",
        sendFailedGeneric:
          labels?.sendFailedGeneric ??
          "Couldn't send your message. It's kept below — please try again.",
        trace: labels?.trace ?? 'trace',
        viewTrace: labels?.viewTrace ?? 'View trace',
        connectionWaiting: labels?.connectionWaiting ?? 'Waiting for server…',
        connectionStalledLabel: labels?.connectionStalledLabel ?? 'Still working…',
        connectionOfflineLabel: labels?.connectionOfflineLabel ?? 'Connection lost — reconnecting…',
      }),
      [labels, tt],
    );

    // The vendored `ToolHeader`'s badge vocabulary, keyed by the AI-SDK state
    // it renders. Same strings as the activity chips read from `L`, so the two
    // surfaces can no longer disagree about what "Completed" is called.
    const toolStatusLabels: ToolStatusLabels = React.useMemo(
      () => ({
        'input-streaming': L.toolPending,
        'input-available': L.toolRunning,
        'approval-requested': L.toolAwaitingApproval,
        'approval-responded': L.toolResponded,
        'output-available': L.toolCompleted,
        'output-error': L.toolError,
        'output-denied': L.toolDenied,
      }),
      [L],
    );

    /**
     * The thread's stick-to-bottom controls, reached from OUTSIDE the
     * `<Conversation>` subtree (the composer and the cards live beside it, so
     * `useStickToBottomContext()` is not available to them). `contextRef` is
     * the library's own escape hatch, which keeps `elements/conversation.tsx`
     * — a vendored ai-elements file — untouched.
     */
    const stickToBottomRef = React.useRef<StickToBottomContext | null>(null);

    /**
     * objectui#7480 — follow the thread to the bottom because the user just
     * SENT something.
     *
     * `StickToBottom` only auto-follows while the view is at the bottom: read a
     * long reply, and the lock is escaped. In the wide full-page maker a reply
     * usually still ends on screen, so the next send looks like it scrolls; in
     * the narrow assistant rail the same reply is two or three times taller, so
     * the lock is almost always escaped by the time the user types — and the
     * new user bubble, the tool steps and the streaming reply all land below
     * the fold with no sign the agent started. Same component, opposite
     * behaviour, purely because of the rail's width.
     *
     * Sending is an explicit request to see what happens next, so every send
     * path re-arms the lock here. This is deliberately NOT hooked to message
     * APPENDS: once re-armed, `StickToBottom` follows the stream on its own and
     * releases the moment the user scrolls up — so a user reading back through
     * the thread mid-answer is never yanked to the bottom.
     */
    const followThreadToBottom = React.useCallback(() => {
      stickToBottomRef.current?.scrollToBottom({ animation: 'smooth' });
    }, []);

    // The send a typed message makes once nothing holds it back.
    const sendTyped = React.useCallback(
      (text: string, files: File[] | undefined) => {
        // Remember the text so a rejected send can restore it (the composer's
        // own form.reset clears the box optimistically). A fresh attempt also
        // clears any prior send-failure restore guard.
        lastSubmittedRef.current = text;
        restoredErrorRef.current = null;
        onSendMessage?.(text, files);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    // objectstack#32984 — a message typed while a turn is running. The
    // composer used to go dead for the whole turn, and a message the user
    // pressed Enter on in that window was cleared from the box with nothing
    // sent and nothing shown. It now QUEUES: the composer stays live, the
    // message shows above it as waiting, and it is sent the moment the turn
    // ends (one per turn, in the order typed). 取消 puts it back in the box.
    const [queuedSends, setQueuedSends] = React.useState<
      ReadonlyArray<{ id: number; text: string; files?: File[] }>
    >([]);
    const queuedSeqRef = React.useRef(0);
    // objectstack#34463 — a picked, pasted or dropped file the composer
    // refuses for size is named to the user with the limit, instead of only
    // reaching `console.warn` while the file silently fails to attach. Cleared
    // by the next send or the notice's close button; a later refusal replaces it.
    // A file whose type `acceptedFileTypes` does not admit is named the same way,
    // with the accepted list. Refusals reported by ONE pick (a wrong-type file
    // and an over-size one) all show: the sentences of the same tick are joined.
    const [attachmentNotice, setAttachmentNotice] = React.useState<string | null>(null);
    const attachmentNoticeTickRef = React.useRef<string[] | null>(null);
    const handlePromptInputError = React.useCallback(
      (e: { code: string; message: string; files?: File[] }) => {
        let sentence: string | null = null;
        if (e.code === 'max_file_size' && e.files?.length) {
          sentence = tCount('chatbot.composer.fileTooLarge', {
            files: e.files.map((f) => f.name).join(', '),
            limit: formatSizeLimit(maxFileSize, composerLanguage),
            defaultValue: 'Not attached, over the {{limit}} limit: {{files}}',
          });
        } else if (e.code === 'accept' && e.files?.length) {
          const allowed = acceptedFileTypes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .join(', ');
          sentence = tCount('fields.file.typeNotAccepted', {
            name: e.files.map((f) => f.name).join(', '),
            accept: allowed,
            defaultValue: '"{{name}}" is not an accepted file type ({{accept}})',
          });
        }
        if (sentence === null) {
          console.warn('[plugin-chatbot] prompt-input error', e);
          return;
        }
        if (attachmentNoticeTickRef.current === null) {
          const tick: string[] = [];
          attachmentNoticeTickRef.current = tick;
          queueMicrotask(() => {
            if (attachmentNoticeTickRef.current === tick) attachmentNoticeTickRef.current = null;
          });
        }
        attachmentNoticeTickRef.current.push(sentence);
        setAttachmentNotice(attachmentNoticeTickRef.current.join(' '));
      },
      [tCount, maxFileSize, composerLanguage, acceptedFileTypes],
    );
    const handleSubmit = React.useCallback(
      (payload: PromptInputMessage) => {
        const hasText = Boolean(payload.text?.trim());
        const files = payload.files
          ?.map((f) => (f as unknown as { file?: File }).file)
          .filter(Boolean) as File[] | undefined;
        const hasFiles = Boolean(files && files.length > 0);
        if (!(hasText || hasFiles)) return;
        const text = payload.text?.trim() ?? '';
        setAttachmentNotice(null);
        if (isLoading) {
          queuedSeqRef.current += 1;
          const id = queuedSeqRef.current;
          setQueuedSends((prev) => [...prev, { id, text, ...(hasFiles ? { files } : {}) }]);
          return;
        }
        sendTyped(text, files);
      },
      [isLoading, sendTyped]
    );
    // The turn ended: send the oldest queued message. Its own turn holds the
    // rest until it ends too. On the next task, so a StrictMode effect re-run
    // (or a turn that restarts at once) cannot send it twice.
    React.useEffect(() => {
      if (isLoading || queuedSends.length === 0) return;
      const next = queuedSends[0];
      const timer = window.setTimeout(() => {
        setQueuedSends((prev) => (prev[0]?.id === next.id ? prev.slice(1) : prev));
        sendTyped(next.text, next.files);
      }, 0);
      return () => window.clearTimeout(timer);
    }, [isLoading, queuedSends, sendTyped]);
    const unqueueSend = React.useCallback(
      (id: number) => {
        const text = queuedSends.find((q) => q.id === id)?.text ?? '';
        setQueuedSends((prev) => prev.filter((q) => q.id !== id));
        // Back into the box, unless the user has typed something new there.
        const textarea = promptInputWrapRef.current?.querySelector('textarea');
        if (textarea && text && textarea.value.trim() === '') {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.focus();
        }
      },
      [queuedSends],
    );

    const handleSuggestionClick = React.useCallback(
      (text: string) => {
        // Not typed by the user — nothing to restore if this send is rejected
        // (see the send-failure effect below).
        lastSubmittedRef.current = '';
        onSendMessage?.(text);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    const promptInputWrapRef = React.useRef<HTMLDivElement>(null);

    // Restore the composer text when a send was REJECTED before reaching the
    // model (rate-limit / network — `notSent`). The composer's own form.reset
    // clears the box optimistically and the optimistic user bubble was rolled
    // back (useObjectChat), so without this the typed message would just vanish.
    // Runs once per failure and never clobbers text the user has since typed.
    React.useEffect(() => {
      if (!error || !isUnsentSendError(error)) return;
      if (restoredErrorRef.current === error) return;
      restoredErrorRef.current = error;
      // What is restored is what was NOT sent, never an older delivered prompt.
      // On its own the composer knows only text the user TYPED here:
      // `lastSubmittedRef` is written by `handleSubmit` alone and cleared by
      // every card-driven send (a suggestion chip), because those
      // send a canned message — leaving the ref stale refilled the composer
      // with the user's PREVIOUS prompt, a message that had already been
      // delivered and answered, reading as "resend this" (objectui#7253).
      // A host that held the message itself names it as `unsentText`
      // (objectstack#33562), and that text is restored too, whichever way it
      // was sent: what the composer last submitted may be only part of it,
      // and a suggestion chip's text the host held for a create that then
      // failed is the message that was not sent, not a stale one.
      const text = unsentText ?? lastSubmittedRef.current;
      if (!text) return;
      const textarea = promptInputWrapRef.current?.querySelector('textarea');
      if (textarea && textarea.value.trim() === '') {
        textarea.value = text;
        // Nudge the auto-grow sizing + any onInputChange listener.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
      }
    }, [error, unsentText]);

    const handleCopy = React.useCallback((message: ChatbotEnhancedMessage) => {
      void navigator.clipboard?.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === message.id ? null : prev)), 1500);
    }, []);

    const renderToolDetail = (tool: ChatbotEnhancedToolInvocation) => {
      const state =
        tool.state ??
        (tool.errorText
          ? 'output-error'
          : tool.result !== undefined
            ? 'output-available'
            : 'input-available');
      const partType = `tool-${tool.toolName}` as `tool-${string}`;
      const decision = toolDecisions?.[tool.toolCallId];
      const isAwaitingApproval =
        state === 'approval-requested' && Boolean(onToolApprove) && !decision;
      // cloud#3565 — a record-write card draws the record itself and its own
      // three buttons; the generic Approve / Deny strip, its decision line and
      // the raw payload stay out of the way.
      const isRecordWriteCard = Boolean(tool.recordWrite);
      const hidePendingPayload =
        state === 'approval-requested' && Boolean(tool.pendingActionId);
      // objectui#7254 / cloud#1658 — `humanizeToolName`'s translator seam has
      // existed since the tool titles were found untranslatable, but no call
      // site ever passed one, so every card header read English
      // ("Propose blueprint", "Apply edit", "Verify build") inside an otherwise
      // Chinese conversation. Unknown/custom tools still fall back to the same
      // English title-caser.
      const friendlyTitle = humanizeToolName(tool.toolName, tt);
      const renderableResult = unwrapToolResult(tool.result);
      const showRawName =
        processVisibility === 'debug' &&
        friendlyTitle &&
        friendlyTitle.toLowerCase() !== tool.toolName.toLowerCase();
      // Raw PARAMETERS/RESULT JSON is developer detail — only in `debug` mode,
      // or when a HITL approval needs the operator to see the exact payload.
      const showPayload =
        processVisibility === 'debug' ||
        (isAwaitingApproval && !isRecordWriteCard && !tool.sampleDataCleanup && !tool.packageRemoval);
      // A tool with no output yet is RUNNING — show a live elapsed timer next to
      // its title so a long tool call has a visible countdown, not a
      // static "Running" (issue #432).
      const isRunning = state === 'input-streaming' || state === 'input-available';
      const titleNode = (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span>{friendlyTitle || tool.toolName}</span>
          {showRawName ? (
            <code className="rounded bg-muted px-1 py-px text-[10px] font-mono text-muted-foreground">
              {tool.toolName}
            </code>
          ) : null}
          {isRunning ? <ToolRunningTimer offlineLabel={L.connectionOfflineLabel} /> : null}
        </span>
      );

      return (
        <Tool
          key={tool.toolCallId}
          defaultOpen={
            state === 'output-error' ||
            state === 'approval-requested' ||
            Boolean(tool.recordHandoff) ||
            Boolean(tool.recordWrite) ||
            Boolean(tool.packageRemoval)
          }
        >
          <ToolHeader
            type={partType}
            state={state}
            title={titleNode}
            statusLabels={toolStatusLabels}
          />
          <ToolContent>
            {showPayload && tool.args !== undefined ? (
              <ToolInput input={tool.args} />
            ) : null}
            {hidePendingPayload ? null : showPayload || state === 'output-error' ? (
              <SmartToolOutput
                output={renderableResult}
                errorText={tool.errorText}
              />
            ) : null}
            {decision && !isRecordWriteCard ? (
              <div
                className={
                  'flex items-center gap-2 p-3 border-t text-xs ' +
                  (decision.state === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : decision.state === 'success'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : decision.state === 'held'
                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'bg-muted/30 text-muted-foreground')
                }
                data-testid="tool-decision"
                data-state={decision.state}
              >
                {decision.state === 'held' ? (
                  <Hourglass className="size-3.5" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">
                    {decision.state === 'pending'
                      ? '...'
                      : decision.state === 'success'
                        ? 'OK'
                        : 'X'}
                  </span>
                )}
                <span>
                  {decision.state === 'held'
                    ? heldForApprovalLabel
                    : decision.message ??
                      (decision.state === 'pending'
                        ? 'Submitting decision...'
                        : decision.state === 'success'
                          ? 'Action approved and executed.'
                          : 'Decision failed.')}
                </span>
              </div>
            ) : null}
            {isAwaitingApproval && !isRecordWriteCard ? (
              <div className="flex gap-2 p-3 border-t bg-muted/30">
                <button
                  type="button"
                  onClick={() => onToolApprove?.(tool.toolCallId, true)}
                  className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {toolApproveLabel}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onToolApprove?.(
                      tool.toolCallId,
                      false,
                      toolDenyReason,
                    )
                  }
                  className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  {toolDenyLabel}
                </button>
              </div>
            ) : null}
            {/* cloud#3565 — 「清理示例数据」: what the seed ledger recorded, per
                table, so the user confirms a list rather than a payload, and
                that the removal cannot be undone (the maintainer's note on
                cloud#3565: no recycle bin until objectstack#3146). The rows
                the list leaves out — hidden from the user or already gone —
                and the rows kept because someone edited them are each said
                when there are any. The generic Approve / Deny strip below
                stays the decision. */}
            {tool.sampleDataCleanup ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="sample-data-cleanup"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Table2 className="size-3.5" />
                  {sampleDataCleanupTitleLabel}
                </span>
                <ul className="flex flex-col gap-0.5 text-xs" data-testid="sample-data-cleanup-tables">
                  {tool.sampleDataCleanup.tables.map((t) => (
                    <li key={t.objectName} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{t.label}</span>
                      <span className="tabular-nums text-muted-foreground">{t.count}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs font-medium text-destructive" data-testid="sample-data-cleanup-irreversible">
                  {sampleDataCleanupIrreversibleLabel}
                </p>
                {tool.sampleDataCleanup.edited > 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="sample-data-cleanup-edited">
                    {sampleDataCleanupEditedLabel(tool.sampleDataCleanup.edited)}
                  </p>
                ) : null}
                {tool.sampleDataCleanup.absent > 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="sample-data-cleanup-absent">
                    {sampleDataCleanupAbsentLabel(tool.sampleDataCleanup.absent)}
                  </p>
                ) : null}
              </div>
            ) : null}
            {/* objectstack#31025 — 「删除软件包」: what goes, per object with its
                row count, the other items by type, and the total, so the user
                confirms a list rather than a payload. A draft object has no
                table and an uncounted one says so; neither reads as 0. When the
                tables are dropped the card says they are gone for good and skip
                the recycle bin (the shape's `recycleBin: false`); when they are
                kept it says so. The generic Approve / Deny strip below stays the
                decision; once approved, the outcome says removed or partial. */}
            {tool.packageRemoval ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="package-removal"
                data-data={tool.packageRemoval.data}
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Trash2 className="size-3.5" />
                  {packageRemovalTitleLabel(tool.packageRemoval.label)}
                </span>
                {tool.packageRemoval.objects.length > 0 ? (
                  <ul className="flex flex-col gap-0.5 text-xs" data-testid="package-removal-objects">
                    {tool.packageRemoval.objects.map((o) => (
                      <li
                        key={o.name}
                        className="flex items-baseline justify-between gap-3"
                        data-testid={`package-removal-object-${o.name}`}
                      >
                        <span className="min-w-0 truncate">{o.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {o.rows !== undefined
                            ? packageRemovalRowsLabel(o.rows)
                            : o.draft
                              ? packageRemovalDraftLabel
                              : packageRemovalRowsUnknownLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {Object.keys(tool.packageRemoval.items).length > 0 ? (
                  <ul className="flex flex-col gap-0.5 text-xs" data-testid="package-removal-items">
                    {Object.entries(tool.packageRemoval.items).map(([type, n]) => (
                      <li
                        key={type}
                        className="flex items-baseline justify-between gap-3"
                        data-testid={`package-removal-item-${type}`}
                      >
                        <span className="min-w-0 truncate">{packageRemovalItemTypeLabel(type)}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs text-muted-foreground" data-testid="package-removal-total">
                  {packageRemovalTotalLabel(tool.packageRemoval.totalRows)}
                </p>
                {tool.packageRemoval.uncountedObjects > 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="package-removal-uncounted">
                    {packageRemovalUncountedLabel(tool.packageRemoval.uncountedObjects)}
                  </p>
                ) : null}
                {tool.packageRemoval.data === 'dropped' ? (
                  <p className="text-xs font-medium text-destructive" data-testid="package-removal-permanent">
                    {packageRemovalPermanentLabel}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground" data-testid="package-removal-kept">
                    {packageRemovalKeptLabel}
                  </p>
                )}
                {(() => {
                  const outcome =
                    decision?.state === 'success' && decision.decision === 'approved'
                      ? detectPackageRemovedResult(decision.result)
                      : undefined;
                  if (!outcome) return null;
                  return (
                    <p
                      className={
                        'text-xs font-medium ' +
                        (outcome.status === 'removed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400')
                      }
                      data-testid="package-removal-outcome"
                      data-state={outcome.status}
                    >
                      {outcome.status === 'removed'
                        ? packageRemovalRemovedLabel
                        : packageRemovalPartialLabel(outcome.failed)}
                    </p>
                  );
                })()}
              </div>
            ) : null}
            {/* cloud#3565 — the ONE-record write the user confirms. The card is
                the whole affordance: the record as it will be written (old → new
                on an update), what the server left out and why, and the three
                buttons the ruling names. 确认 approves the pending action, which
                writes AS THE USER; 取消 rejects it; 打开完整表单 rejects it too
                and hands the host the values, so a record saved in the form is
                never written a second time from here. */}
            {tool.recordWrite ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="record-write"
                data-operation={tool.recordWrite.operation}
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Sparkles className="size-3.5" />
                  {tool.recordWrite.operation === 'create'
                    ? recordWriteCreateTitle(tool.recordWrite.objectLabel)
                    : recordWriteUpdateTitle(tool.recordWrite.objectLabel)}
                  {tool.recordWrite.label ? (
                    <span className="font-normal text-muted-foreground">· {tool.recordWrite.label}</span>
                  ) : null}
                </span>
                {tool.recordWrite.reason ? (
                  <p className="text-xs text-muted-foreground">{tool.recordWrite.reason}</p>
                ) : null}
                <dl
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
                  data-testid="record-write-fields"
                >
                  {tool.recordWrite.fields.map((f) => (
                    <React.Fragment key={f.name}>
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="min-w-0 break-words" data-testid={`record-write-field-${f.name}`}>
                        {'current' in f ? (
                          <>
                            <span className="text-muted-foreground line-through">
                              {formatRecordWriteValue(f.current)}
                            </span>
                            <span aria-hidden="true"> → </span>
                          </>
                        ) : null}
                        <span className="font-medium">{formatRecordWriteValue(f.value)}</span>
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
                {tool.recordWrite.dropped.length > 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="record-write-dropped">
                    {recordWriteDroppedLabel}:{' '}
                    {tool.recordWrite.dropped
                      .map((d) => `${d.field} (${d.detail ?? d.reason.replace(/_/g, ' ')})`)
                      .join(', ')}
                  </p>
                ) : null}
                {decision ? (
                  <p
                    data-testid="record-write-decision"
                    data-state={decision.state}
                    className={
                      'inline-flex flex-wrap items-center gap-1.5 text-xs ' +
                      (decision.state === 'error'
                        ? 'text-destructive'
                        : decision.state === 'success'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : decision.state === 'held'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground')
                    }
                  >
                    {decision.state === 'error' ? (
                      <>
                        <XCircle className="size-3.5" />
                        {decision.message}
                      </>
                    ) : decision.state === 'held' ? (
                      <>
                        <Hourglass className="size-3.5" />
                        {heldForApprovalLabel}
                      </>
                    ) : decision.state === 'pending' ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        {recordWriteSubmittingLabel}
                      </>
                    ) : decision.decision === 'rejected' ? (
                      recordWriteCancelledLabel
                    ) : (
                      <>
                        <CheckCircle2 className="size-3.5" />
                        {recordWriteWrittenLabel}
                        {(() => {
                          const written = writtenRecordOf(decision.result);
                          return written && onOpenRecord ? (
                            <button
                              type="button"
                              onClick={() => onOpenRecord(written)}
                              data-testid="record-write-open-written"
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              {written.label ?? written.recordId}
                            </button>
                          ) : null;
                        })()}
                      </>
                    )}
                  </p>
                ) : null}
                {isAwaitingApproval ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onToolApprove?.(tool.toolCallId, true)}
                      data-testid="record-write-confirm"
                      className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      {recordWriteConfirmLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onToolApprove?.(tool.toolCallId, false, recordWriteOpenFormReason);
                        onOpenRecordForm?.(tool.recordWrite!);
                      }}
                      disabled={!onOpenRecordForm}
                      data-testid="record-write-open-form"
                      className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recordWriteOpenFormLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToolApprove?.(tool.toolCallId, false, recordWriteCancelReason)}
                      data-testid="record-write-cancel"
                      className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
                    >
                      {recordWriteCancelLabel}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* cloud#1658 — the record hand-off: the agent resolved the record a
                write request names but has no action to perform the change, so
                the card lands the user exactly there. No superseded logic on
                purpose: unlike a build prompt, an older record link stays
                correct — the record does not go stale because a newer hand-off
                exists. */}
            {tool.recordHandoff ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="record-handoff"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Sparkles className="size-3.5" />
                  {recordHandoffTitleLabel}
                </span>
                <p className="text-xs text-muted-foreground">
                  {tool.recordHandoff.label ?? tool.recordHandoff.objectName}
                  {tool.recordHandoff.reason ? ` — ${tool.recordHandoff.reason}` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenRecord?.(tool.recordHandoff!)}
                  disabled={!onOpenRecord}
                  data-testid="record-handoff-open"
                  className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recordHandoffOpenLabel}
                </button>
              </div>
            ) : null}
          </ToolContent>
        </Tool>
      );
    };

    return (
      <div
        ref={ref}
        className={cn(
          // The plain surface is a size container: its gutters follow the
          // width the chat is GIVEN (a ~420px dock or a full page), never the
          // viewport — see PLAIN_SURFACE_GUTTER.
          isPlainSurface
            ? '@container flex min-h-0 flex-col overflow-hidden bg-background'
            : 'flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background',
          className
        )}
        style={{ maxHeight }}
        {...props}
      >
        {onClear && !hideClearBar && messages.length > 0 && (
          <div
            className={cn(
              'flex items-center justify-end px-4 py-2',
              isPlainSurface ? 'bg-background' : 'border-b bg-muted/30',
            )}
          >
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {L.clear}
            </button>
          </div>
        )}

        {headerSlot ? (
          <div className={cn('shrink-0', !isPlainSurface && 'border-b bg-background/50')}>
            {headerSlot}
          </div>
        ) : null}

        <Conversation className="flex-1 min-h-0" contextRef={stickToBottomRef}>
          <ConversationContent
            className={cn(
              'space-y-4',
              isPlainSurface
                ? cn('mx-auto w-full max-w-2xl py-8', PLAIN_SURFACE_GUTTER)
                : 'px-4 py-3',
            )}
          >
            {messages.length === 0 ? (
              <ConversationEmptyState className="gap-3 px-0 py-8">
                <div className="flex size-9 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  {assistantAvatarUrl ? (
                    <img
                      src={assistantAvatarUrl}
                      alt=""
                      className="size-full rounded-md object-cover"
                    />
                  ) : (
                    <Bot className="size-4" />
                  )}
                </div>
                <div className="w-full max-w-full space-y-1">
                  <h3 className="text-sm font-medium text-foreground/90 break-words">{L.emptyTitle}</h3>
                  <p className="text-sm text-muted-foreground break-words">
                    {L.emptyDescription}
                  </p>
                </div>
                {suggestions && suggestions.length > 0 ? (
                  <div className="flex w-full max-w-full flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <Suggestion
                        key={s}
                        className="h-auto min-h-8 min-w-0 max-w-full whitespace-normal break-words rounded-full border-border/60 bg-background/80 px-3 py-1 text-left text-xs font-medium text-foreground/90 shadow-none hover:bg-muted/60"
                        suggestion={s}
                        onClick={handleSuggestionClick}
                      />
                    ))}
                  </div>
                ) : null}
              </ConversationEmptyState>
            ) : (
              messages.map((message) => {
                const isUser = message.role === 'user';
                // objectstack#30223 — the follow-up turn `useHitlInChat` sends
                // the model after 确认 / 取消 is not the person's words, so it
                // draws no bubble: live, after a reload, or on a shared
                // transcript. The model still received it.
                if (isUser && isHitlContinuation(message.content)) return null;
                const tools = message.toolInvocations ?? [];
                const reasoning = message.reasoning?.trim();
                const sources = message.sources ?? [];
                const summaryTools =
                  !isUser && processVisibility === 'summary'
                    ? tools.filter((tool) => !shouldRenderDetailedTool(tool))
                    : [];
                const detailedTools =
                  !isUser && processVisibility === 'debug'
                    ? tools
                    : !isUser && processVisibility !== 'debug'
                      ? tools.filter(shouldRenderDetailedTool)
                      : [];
                // Real, showable prose for this turn. Whitespace-only text and the
                // persisted "(called …)" tool-call placeholder are NOT visible
                // prose: the placeholder is a hydrated-history affordance (renders
                // as the quiet 执行过程 note only once the turn has ENDED), and a
                // lone whitespace part must never paint a blank bubble mid-stream.
                const hasVisibleProse =
                  !isUser &&
                  message.content.trim().length > 0 &&
                  !isToolCallPlaceholder(message.content);
                // Nothing is visible for this streaming turn yet → show the live
                // thinking indicator instead of dead air. Covers the ask-decline
                // wait (tool-call latency before `suggest_builder` lands): no
                // prose, no rendered tool row (summary chip / detailed card), no
                // shown reasoning (only surfaced in debug).
                const reasoningVisible = processVisibility === 'debug' && Boolean(reasoning);
                const isEmptyAssistantStreaming =
                  !isUser &&
                  Boolean(message.streaming) &&
                  !hasVisibleProse &&
                  summaryTools.length === 0 &&
                  detailedTools.length === 0 &&
                  !reasoningVisible;
                // objectui#10899 — does this turn already SHOW its activity (a
                // tool row, a build/design panel)? Then the quiet 执行过程 note
                // a hydrated tool-call placeholder turn falls back to says
                // nothing the row above it does not, and a reloaded multi-step
                // build printed it under every step. The note stays for a
                // placeholder turn with nothing else on screen (#772).
                const showsActivity =
                  summaryTools.length > 0 ||
                  detailedTools.length > 0;
                // objectui#13492 — the answer body in stream order; the
                // streaming cursor rides the last text run, where it sat when
                // the charts always trailed the text.
                const answerBlocks = isUser ? undefined : layoutAnswer(message.content, message.charts);
                let lastTextBlock = -1;
                answerBlocks?.forEach((block, i) => {
                  if (block.kind === 'text') lastTextBlock = i;
                });
                return (
                  <Message
                    key={message.id}
                    from={formatMessageProps(message.role)}
                    className={isPlainSurface && !isUser ? PLAIN_SURFACE_ASSISTANT_WIDTH : undefined}
                  >
                    <div
                      className={cn(
                        'flex w-full gap-2.5',
                        showAvatars
                          ? isUser
                            ? 'flex-row-reverse items-start'
                            : 'flex-row items-start'
                          : 'flex-col',
                      )}
                    >
                      {showAvatars ? (
                        <MessageAvatar
                          isUser={isUser}
                          url={isUser ? userAvatarUrl : assistantAvatarUrl}
                          fallback={isUser ? userAvatarFallback : assistantAvatarFallback}
                        />
                      ) : null}
                      <div
                        className={cn(
                          'flex min-w-0 flex-col gap-2',
                          showAvatars && !isUser && 'flex-1',
                        )}
                      >
                    <MessageContent>
                      {/* objectui#12724 — the phase line leads the turn, above
                          the design / build panel it summarizes. */}
                      {!isUser && processVisibility === 'summary' && summaryTools.length > 0 ? (
                        <ToolPhaseSummary
                          phaseKey={message.id}
                          streaming={Boolean(message.streaming)}
                          phaseTools={tools}
                          summaryTools={summaryTools}
                          translateToolTitle={tt}
                          labels={L}
                        />
                      ) : null}
                      {!isUser && processVisibility === 'debug' && reasoning ? (
                        <Reasoning
                          isStreaming={Boolean(message.streaming) && !message.content}
                          className="mb-2"
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{reasoning}</ReasoningContent>
                        </Reasoning>
                      ) : null}
                      {!isUser && detailedTools.length > 0
                        ? detailedTools.map((tool) => renderToolDetail(tool))
                        : null}
                      {isUser ? (
                        message.content ? (
                          <div className="whitespace-pre-wrap break-words">
                            {message.content}
                          </div>
                        ) : null
                      ) : isEmptyAssistantStreaming ? (
                        <ThinkingDots />
                      ) : !hasVisibleProse &&
                        !message.streaming &&
                        !showsActivity &&
                        isToolCallPlaceholder(message.content) ? (
                        // #772: a re-hydrated tool-call-only turn is persisted with
                        // an internal placeholder ("(called todo_write,
                        // propose_blueprint)"); render a quiet localized activity
                        // note instead of leaking it as prose. Only once the turn
                        // has ENDED — mid-stream the live tool row / ThinkingDots
                        // carry the status, so the static note never flashes.
                        <span
                          className="text-xs italic text-muted-foreground/70"
                          title={message.content}
                        >
                          {L.agentActivity}
                        </span>
                      ) : null}
                      {answerBlocks ? (
                        // objectui#13492 — the answer's text and charts in
                        // stream order (see `layoutAnswer`). A turn with no
                        // showable prose still draws its charts here, so a
                        // chart drawn before the first word keeps its place
                        // (and its mounted chart) once the text arrives.
                        // objectui#13032 — a long answer folds only once its
                        // stream has ended; the streaming flag tells it when.
                        // objectui#13037 — a record link in the answer opens
                        // the record through the same host opener as the
                        // `open_record` card.
                        // objectstack#31869 — a list link the same way,
                        // through the host's list opener.
                        <RecordLinkContext.Provider value={onOpenRecord ?? null}>
                        <ListLinkContext.Provider value={onOpenList ?? null}>
                          {answerBlocks.map((block, i) =>
                            block.kind === 'charts' ? (
                              <AnswerCharts key={i} charts={block.charts} />
                            ) : hasVisibleProse ? (
                              <React.Fragment key={i}>
                                <MessageResponse isAnimating={Boolean(message.streaming)}>
                                  {block.text}
                                </MessageResponse>
                                {message.streaming && i === lastTextBlock ? (
                                  <span
                                    aria-hidden
                                    className="ml-0.5 inline-block w-[2px] h-4 align-middle bg-current animate-pulse"
                                  />
                                ) : null}
                              </React.Fragment>
                            ) : null,
                          )}
                        </ListLinkContext.Provider>
                        </RecordLinkContext.Provider>
                      ) : null}
                      {!isUser ? (
                        <AnswerSourceBlock
                          sources={tools.flatMap((tool) =>
                            tool.answerSource
                              ? [{ key: tool.toolCallId, source: tool.answerSource }]
                              : [],
                          )}
                        />
                      ) : null}
                      {/* ADR-0160 D9 — the records the answer rests on. */}
                      {!isUser && message.recordCitations ? (
                        <RecordCitations citations={message.recordCitations} onOpenRecord={onOpenRecord} />
                      ) : null}
                      {!isUser && sources.length > 0 ? (
                        <Sources>
                          <SourcesTrigger count={sources.length} />
                          <SourcesContent>
                            {sources.map((s, i) => (
                              <Source
                                key={s.id ?? s.url ?? i}
                                href={s.url}
                                title={s.title ?? s.url}
                              />
                            ))}
                          </SourcesContent>
                        </Sources>
                      ) : null}
                      {showTimestamp && message.timestamp ? (
                        <div className="text-[10px] opacity-70 mt-1">{message.timestamp}</div>
                      ) : null}
                    </MessageContent>
                    {/* objectui#10899 — the copy / regenerate bar acts on this
                        turn's PROSE. A prose-less turn (a hydrated tool step
                        whose only text is the "(called …)" placeholder) has
                        nothing to copy — Copy would hand the user the internal
                        placeholder — and the invisible bar still took its full
                        height, which is the blank gap a reloaded build showed
                        under every step. */}
                    {!isUser && !isEmptyAssistantStreaming && hasVisibleProse ? (
                      <MessageActions className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <MessageAction
                          label={copiedId === message.id ? L.copied : L.copy}
                          tooltip={copiedId === message.id ? L.copied : L.copy}
                          onClick={() => handleCopy(message)}
                        >
                          {copiedId === message.id ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </MessageAction>
                        {onReload ? (
                          <MessageAction
                            label={L.regenerate}
                            tooltip={L.regenerate}
                            onClick={onReload}
                          >
                            <RefreshCw className="size-3.5" />
                          </MessageAction>
                        ) : null}
                        {processVisibility === 'debug' && message.traceId ? (
                          <a
                            href={`#trace/${message.traceId}`}
                            data-trace-id={message.traceId}
                            className="text-[10px] text-muted-foreground hover:text-foreground ml-1 underline"
                            title={L.viewTrace}
                          >
                            {L.trace}
                          </a>
                        ) : null}
                      </MessageActions>
                    ) : null}
                      </div>
                    </div>
                  </Message>
                );
              })
            )}
            {isLoading && !messages.some((message) => message.streaming) ? (
              <AssistantThinkingMessage
                showAvatar={showAvatars}
                assistantAvatarUrl={assistantAvatarUrl}
                assistantAvatarFallback={assistantAvatarFallback}
                waitingLabel={L.connectionWaiting}
                stalledLabel={L.connectionStalledLabel}
                offlineLabel={L.connectionOfflineLabel}
              />
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {error ? (
          // A never-sent failure (rate-limit / network) gets a friendly "your
          // message is kept" notice — the input was restored above, so a
          // "Response failed / Retry" banner (which regenerates the wrong turn
          // after rollback) would mislead. Quota 429s still use ErrorBanner so
          // its upgrade / top-up CTA shows; mid-stream failures keep Retry.
          isUnsentSendError(error) && !parseAiQuotaError(error) ? (
            <SendErrorNotice
              error={error}
              rateLimitedLabel={L.sendFailedRateLimited}
              genericLabel={L.sendFailedGeneric}
            />
          ) : (
            <ErrorBanner error={error} onReload={onReload} onUpgrade={onUpgrade} />
          )
        ) : null}

        {attachmentNotice && !readOnly ? (
          <ComposerNotice
            text={attachmentNotice}
            testId="chat-attachment-refused"
            closeLabel={tt('common.close', 'Close')}
            onClose={() => setAttachmentNotice(null)}
          />
        ) : null}

        {readOnly ? null : (
        <div
          ref={promptInputWrapRef}
          className={cn(
            'relative',
            isPlainSurface && cn('mx-auto w-full max-w-2xl pb-4', PLAIN_SURFACE_GUTTER),
          )}
        >
          {/* objectui#12978 — in flow, so it pushes the conversation up instead
              of covering the input; `empty:hidden` keeps a slot whose content
              renders nothing from leaving a gap above the input. */}
          {promptHeaderSlot ? (
            <div className="mb-2 flex empty:hidden" data-testid="prompt-header-slot">
              {promptHeaderSlot}
            </div>
          ) : null}
          {promptOverlaySlot ? (
            <div className="absolute bottom-full left-0 right-0 z-10 px-3 pb-1">
              {promptOverlaySlot}
            </div>
          ) : null}
          {queuedSends.length > 0 ? (
            <div className="mb-2 flex flex-col gap-1" data-testid="composer-queued">
              {queuedSends.map((q) => (
                <div
                  key={q.id}
                  className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-xs"
                  data-testid="composer-queued-item"
                  role="status"
                >
                  <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[11px] font-medium text-muted-foreground">{queuedLabel}</span>
                    <span className="whitespace-pre-wrap break-words text-foreground/90">{q.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => unqueueSend(q.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    data-testid="composer-queued-cancel"
                  >
                    {queuedCancelLabel}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <PromptInput
            accept={acceptedFileTypes}
            fileInputLabel={L.uploadFiles}
            maxFileSize={maxFileSize}
            onSubmit={handleSubmit}
            onError={handlePromptInputError}
          >
            {/* objectstack#35445 — the page in view sits on the input's top
                edge, inside its frame: it belongs to what the next message
                carries, and it never lies over the conversation. */}
            {surfaceContextLabel ? (
              <PromptInputHeader className="px-3 pt-2 pb-0" data-testid="surface-context-chip">
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={surfaceContextTitle}
                >
                  {surfaceContextLabel}
                </span>
              </PromptInputHeader>
            ) : null}
            {enableFileUpload ? (
              <PromptInputBody>
                <PromptInputAttachments>
                  {(attachment) => <PromptInputAttachment data={attachment} removeLabel={L.removeAttachment} />}
                </PromptInputAttachments>
              </PromptInputBody>
            ) : null}
            <PromptInputTextarea
              placeholder={placeholder}
              // objectstack#32984 — live during a turn: Enter queues (see
              // `queuedSends`) instead of going nowhere.
              disabled={disabled}
              onChange={
                onInputChange
                  ? (e) => onInputChange(e.currentTarget.value)
                  : undefined
              }
            />
            <PromptInputFooter>
              <PromptInputTools className="min-w-0">
                {enableFileUpload ? (
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger
                      aria-label={L.addAttachment}
                      title={L.addAttachment}
                      data-testid="composer-add-attachment"
                    />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments label={L.addAttachment} />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                ) : null}
                {/* Only a real CHOICE warrants a picker: free / single-model
                    envs (the backend returns one entry) get no dropdown — the
                    lone model is still sent via `selectedModelId`. */}
                {models && models.length > 1 ? (
                  <ModelPicker
                    label={L.model}
                    models={models}
                    value={selectedModelId ?? models[0].id}
                    onPick={(modelId) => onModelChange?.(modelId)}
                    allowanceUsedFraction={allowanceUsedFraction}
                  />
                ) : null}
                {/* #2458 UX#7 — the composer sends on PLAIN Enter (Shift+Enter =
                    newline); the old `⌘` glyph implied Cmd+Enter and misled users.
                    Show the real keys. */}
                {/* objectstack#35445 — one line: the hint never wraps, it gives way
                    (shrink-0 keeps it whole) and the model picker truncates. */}
                <span
                  className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground sm:inline-flex"
                  aria-hidden="true"
                  data-testid="composer-key-hint"
                >
                  <CornerDownLeft className="h-3 w-3" />
                  <span className="opacity-70">{L.sendHint}</span>
                  {L.newlineHint ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="opacity-70">Shift+</span>
                      <CornerDownLeft className="h-3 w-3" />
                      <span className="opacity-70" data-testid="composer-newline-hint">
                        {L.newlineHint}
                      </span>
                    </>
                  ) : null}
                </span>
              </PromptInputTools>
              <PromptInputSubmit
                aria-label={promptStatus === 'streaming' ? L.stopResponse : L.submit}
                status={promptStatus}
                disabled={disabled}
                onClick={promptStatus === 'streaming' ? onStop : undefined}
                type={promptStatus === 'streaming' ? 'button' : 'submit'}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
        )}

      </div>
    );
  }
);

ChatbotEnhanced.displayName = 'ChatbotEnhanced';

/**
 * Compact circular avatar shown beside a message when `showAvatars` is on.
 * Assistant → bot glyph (or image); user → initial (or image).
 */
function MessageAvatar({
  isUser,
  url,
  fallback,
}: {
  isUser: boolean;
  url?: string;
  fallback?: string;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-medium',
        isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary',
      )}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : isUser ? (
        (fallback?.trim()?.charAt(0)?.toUpperCase() || 'U')
      ) : (
        <Bot className="size-4" />
      )}
    </div>
  );
}

function AssistantThinkingMessage({
  showAvatar,
  assistantAvatarUrl,
  assistantAvatarFallback,
  waitingLabel,
  stalledLabel,
  offlineLabel,
}: {
  showAvatar: boolean;
  assistantAvatarUrl?: string;
  assistantAvatarFallback?: string;
  waitingLabel: string;
  stalledLabel: string;
  offlineLabel: string;
}) {
  return (
    <Message from="assistant" aria-live="polite">
      <div className={cn('flex w-full gap-2.5', showAvatar ? 'flex-row items-start' : 'flex-col')}>
        {showAvatar ? (
          <MessageAvatar
            isUser={false}
            url={assistantAvatarUrl}
            fallback={assistantAvatarFallback}
          />
        ) : null}
        <MessageContent className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ThinkingDots />
            {/* No server bytes yet for this turn → `pending`: shows a neutral
                "waiting" that escalates to amber if the first token never comes,
                never a false "receiving". */}
            <LivenessIndicator
              active
              pending
              activityKey={0}
              waitingLabel={waitingLabel}
              stalledLabel={stalledLabel}
              offlineLabel={offlineLabel}
            />
          </span>
        </MessageContent>
      </div>
    </Message>
  );
}

function ThinkingDots() {
  return (
    <>
      <span className="sr-only">Assistant is responding</span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
      </span>
    </>
  );
}

/** Format an elapsed-seconds count as `m:ss` (e.g. 42 → "0:42", 95 → "1:35"). */
function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * After this many seconds with no new bytes from the server, a running turn is
 * treated as "quiet" — we genuinely have not heard back, so the indicator says
 * so instead of implying progress. During an app build the server streams
 * `data-build-progress` parts every few seconds, so a healthy build stays under
 * this threshold; only real silence (pre-first-token wait, a stalled/dropped
 * stream) crosses it.
 */
const LIVENESS_QUIET_AFTER_SECONDS = 6;

export interface TurnLiveness {
  /** Whole-turn duration in seconds (since the indicator mounted). */
  elapsedSeconds: number;
  /** Seconds since the last real byte arrived from the server. */
  quietSeconds: number;
  /** True while bytes have arrived recently — an *observed* live stream. */
  live: boolean;
}

/**
 * Liveness derived from REAL stream activity, not a free-running clock.
 *
 * `activityKey` must change whenever actual data arrives from the server (a
 * streamed token, a tool delta, a `data-build-progress` update). We stamp the
 * arrival time when it changes; `live` is then a genuine "the server sent us
 * something in the last few seconds" signal — it goes false during true silence
 * (a stalled or dropped stream), so the UI can stop pretending the turn is
 * progressing. A 1s ticker keeps `quietSeconds` current between arrivals.
 * Everything freezes once `active` turns false, leaving the final duration.
 */
function useTurnLiveness(active: boolean, activityKey: string | number): TurnLiveness {
  const startRef = React.useRef<number>(0);
  const lastActivityRef = React.useRef<number>(0);
  const [seconds, setSeconds] = React.useState({ elapsed: 0, quiet: 0 });

  // Establish the time origin once, in an effect — keeps Date.now() out of
  // render so the derived seconds stay pure for the renderer. Runs before the
  // activity/tick effects below (effects fire in declaration order).
  React.useEffect(() => {
    const now = Date.now();
    startRef.current = now;
    lastActivityRef.current = now;
  }, []);

  // Real data arrived (activityKey changed) → stamp the arrival and zero the
  // quiet timer. Refs/Date.now() are touched only inside this effect, never
  // during render.
  React.useEffect(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    setSeconds({ elapsed: Math.floor((now - startRef.current) / 1000), quiet: 0 });
  }, [activityKey]);

  React.useEffect(() => {
    if (!active) return;
    const tick = () => {
      const now = Date.now();
      setSeconds({
        elapsed: Math.floor((now - startRef.current) / 1000),
        quiet: Math.floor((now - lastActivityRef.current) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  return {
    elapsedSeconds: seconds.elapsed,
    quietSeconds: seconds.quiet,
    live: seconds.quiet < LIVENESS_QUIET_AFTER_SECONDS,
  };
}

/**
 * True when the browser reports it is offline. Reads `navigator.onLine` and
 * tracks the window `online`/`offline` events, so a real network drop surfaces
 * IMMEDIATELY — before the stream-quiet timeout would otherwise infer it.
 */
function useIsOffline(): boolean {
  const [offline, setOffline] = React.useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return offline;
}

/**
 * Honest connection cue beside a running spinner. A LIVE `m:ss` timer is ALWAYS
 * shown (counting up from the first second, not only once bytes arrive) so the
 * user can always see the turn is progressing and for how long. Four states,
 * each a real fact about the stream:
 *
 *  - **offline** (red WifiOff) — `navigator.onLine` is false: the browser has
 *    no network. Surfaced instantly via the online/offline events.
 *  - **receiving** (emerald pulse) — bytes arrived from the server recently.
 *  - **waiting** (muted) — request in flight, nothing back yet (`pending`,
 *    e.g. before the first token). Neutral, never claims "receiving".
 *  - **stalled** (amber) — the stream has gone quiet past the threshold; the
 *    honest "we have not heard back for Ns" signal.
 *
 * A hard disconnect/error also surfaces via the chat error banner (with Retry).
 * `pending` selects waiting-vs-receiving wording: pass it when no server bytes
 * have been observed for this turn yet (the bare thinking state).
 */
function LivenessIndicator({
  active,
  activityKey,
  pending = false,
  waitingLabel,
  stalledLabel = 'Still working…',
  offlineLabel = 'Connection lost — reconnecting…',
}: {
  active: boolean;
  activityKey: string | number;
  pending?: boolean;
  waitingLabel: string;
  stalledLabel?: string;
  offlineLabel?: string;
}) {
  const { elapsedSeconds, quietSeconds, live } = useTurnLiveness(active, activityKey);
  const offline = useIsOffline();
  const tier: 'offline' | 'stalled' | 'receiving' | 'waiting' = offline
    ? 'offline'
    : !live
      ? 'stalled'
      : pending
        ? 'waiting'
        : 'receiving';
  const elapsed = formatElapsed(elapsedSeconds);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs tabular-nums',
        tier === 'offline'
          ? 'text-red-600 font-medium'
          : tier === 'stalled'
            ? 'text-amber-600 font-medium'
            : 'font-normal text-muted-foreground',
      )}
      aria-live="polite"
      data-liveness-tier={tier}
      title={
        tier === 'offline'
          ? `${offlineLabel} · ${elapsed} elapsed`
          : tier === 'receiving'
            ? `Receiving from server · ${elapsed} elapsed`
            : tier === 'stalled'
              ? `${stalledLabel} (${quietSeconds}s with no response) · ${elapsed} elapsed`
              : `${waitingLabel} · ${elapsed} elapsed`
      }
    >
      {tier === 'offline' ? (
        <WifiOff className="size-3 shrink-0" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            tier === 'receiving'
              ? 'bg-emerald-500 animate-pulse'
              : tier === 'stalled'
                ? 'bg-amber-500'
                : 'bg-muted-foreground/50 animate-pulse',
          )}
        />
      )}
      {/* The live count-up timer is ALWAYS visible (the "倒计时"): a turn never
          looks frozen, even before the first server byte. */}
      <Clock3 className="size-3 shrink-0" aria-hidden />
      <span>{elapsed}</span>
      {/* A short status label accompanies the timer in every state except the
          calm "receiving" one (where the green pulse already says data is
          flowing) — so "waiting", "still working" and "connection lost" read
          plainly instead of as a bare number. */}
      {tier === 'receiving' ? null : (
        <span>
          · {tier === 'offline' ? offlineLabel : tier === 'stalled' ? stalledLabel : waitingLabel}
        </span>
      )}
    </span>
  );
}

/**
 * Compact elapsed-timer + offline cue for a tool that is currently RUNNING
 * (issue #432) — e.g. the "Propose blueprint · Running" header. Counts up from
 * when the running card mounts so a long tool call (a blueprint can take tens of
 * seconds) shows a visible "倒计时" instead of a static "Running", and flips to a
 * red offline cue the moment the browser loses the network. Unlike the
 * stream-liveness indicator it never escalates to amber on quiet — a running
 * tool legitimately produces no client bytes while the server works.
 */
function ToolRunningTimer({ offlineLabel }: { offlineLabel: string }) {
  const [elapsed, setElapsed] = React.useState(0);
  const offline = useIsOffline();
  React.useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums',
        offline ? 'text-red-600 font-medium' : 'text-muted-foreground',
      )}
      aria-live="polite"
      data-tool-running-timer
    >
      {offline ? (
        <WifiOff className="size-3 shrink-0" aria-hidden />
      ) : (
        <Clock3 className="size-3 shrink-0" aria-hidden />
      )}
      <span>{formatElapsed(elapsed)}</span>
      {offline ? <span>· {offlineLabel}</span> : null}
    </span>
  );
}

/**
 * objectui#12724 — one step of a phase's collapsed line: a tool, folded over
 * every call of it in the turn, in the order the turn first called it.
 */
interface ToolPhaseStep {
  title: string;
  count: number;
}

/**
 * objectui#13038 — tools that are the agent's own plumbing, not a step the user
 * asked for: the phase line neither shows nor counts them. `load_tools` attaches
 * a deferred tool family to the build agent's call; on build every data question
 * pays one, so it read as "Load more tools" among the steps and inflated the count.
 *
 * A client list because nothing declares the role: the tool definition carries
 * only name, label, description and parameters, and the stream's tool part
 * carries no marker either. Module-private on purpose — it is this line's
 * presentation rule, not a contract another surface may read.
 */
const PLUMBING_TOOL_NAMES: ReadonlySet<string> = new Set(['load_tools']);

function isPlumbingTool(tool: ChatbotEnhancedToolInvocation): boolean {
  return PLUMBING_TOOL_NAMES.has(tool.toolName);
}

/** Fold a turn's tool calls into one step per tool, in first-call order. */
function foldToolPhaseSteps(
  tools: ChatbotEnhancedToolInvocation[],
  translateToolTitle?: ToolTitleTranslator,
): ToolPhaseStep[] {
  const steps = new Map<string, ToolPhaseStep>();
  for (const tool of tools) {
    if (isPlumbingTool(tool)) continue;
    const step = steps.get(tool.toolName);
    if (step) step.count += 1;
    else
      steps.set(tool.toolName, {
        title: humanizeToolName(tool.toolName, translateToolTitle) || tool.toolName,
        count: 1,
      });
  }
  return [...steps.values()];
}

/**
 * Wall-clock span of each phase, keyed by its message id. Measured here, while
 * the turn streams, because no producer persists a duration: a turn reopened
 * from history has no entry, and its line simply omits the time. Module-scoped
 * so a pane remount mid-turn keeps the clock it started.
 */
const phaseClock = new Map<string, { start: number; end?: number }>();

function usePhaseElapsed(key: string, running: boolean): number | undefined {
  // The clock is read in effects only (render stays pure); `now` is the last
  // reading, refreshed once a second while the phase runs.
  const [now, setNow] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (!running) {
      const entry = phaseClock.get(key);
      if (entry && entry.end === undefined) entry.end = Date.now();
      setNow(Date.now());
      return undefined;
    }
    const entry = phaseClock.get(key);
    if (!entry) phaseClock.set(key, { start: Date.now() });
    else entry.end = undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [key, running]);
  const entry = phaseClock.get(key);
  if (!entry || now === undefined) return undefined;
  return Math.max(0, Math.floor(((entry.end ?? now) - entry.start) / 1000));
}

/**
 * objectui#12724 — a turn's tool activity as ONE collapsed line per phase
 * (「设计方案 · 4 步 · 0:48 · 读取编写规范 · 列出对象 ×3 …」), with a chevron
 * that expands the per-tool rows (`ToolActivitySummary`). Repeated calls of a
 * tool fold into one step with a count. The line opens on its step count. The rows open on their
 * own while a step runs, waits or failed, so a live timer or an error is never
 * hidden behind the chevron; the user's own toggle wins after that.
 */
function ToolPhaseSummary({
  phaseKey,
  streaming,
  phaseTools,
  summaryTools,
  translateToolTitle,
  labels,
}: {
  phaseKey: string;
  streaming: boolean;
  /** Every tool the turn called — the phase's name, steps and state. */
  phaseTools: ChatbotEnhancedToolInvocation[];
  /** The tools the summary strip shows — the expanded rows. */
  summaryTools: ChatbotEnhancedToolInvocation[];
  translateToolTitle?: ToolTitleTranslator;
  labels: ToolActivitySummaryLabels;
}) {
  const { t } = useObjectTranslation();
  // The line's steps speak for the whole turn — every tool it called,
  // including the ones that render their own card below (the plan, a draft, an
  // approval) — while its state and the expanded rows are the summary strip's:
  // a step that waits on the user already says so on its own card (the plan's
  // 等待确认), so it does not hold the line open. A turn whose every tool has
  // its own card draws no line (the host gates on the summary strip), so a lone
  // card is never named twice.
  // A plumbing call (objectui#13038) is no step of the user's: it leaves the
  // expanded rows as well as the line, so it is shown nowhere in the phase.
  const groups = summarizeTools(
    summaryTools.filter((tool) => !isPlumbingTool(tool)),
    translateToolTitle,
  );
  const steps = foldToolPhaseSteps(phaseTools, translateToolTitle);
  const has = (state: ToolSummaryState) => groups.some((g) => g.state === state);
  const lineState: ToolSummaryState = has('failed')
    ? 'failed'
    : has('awaiting')
      ? 'awaiting'
      : has('running')
        ? 'running'
        : 'completed';
  const [toggled, setToggled] = React.useState<boolean | null>(null);
  const expanded = toggled ?? lineState !== 'completed';
  const elapsed = usePhaseElapsed(phaseKey, streaming || lineState === 'running');
  const headline = [
    t('chatbot.phase.stepCount', { count: steps.length, defaultValue: '{{count}} steps' }),
    ...(elapsed !== undefined ? [formatElapsed(elapsed)] : []),
  ].join(' · ');
  const stepText = steps
    .map((step) => (step.count > 1 ? `${step.title} ×${step.count}` : step.title))
    .join(' · ');
  // The host draws this line only when the summary strip has a row; with the
  // plumbing gone that gate is re-read here. A phase that so far called only
  // plumbing (or plumbing beside tools with their own card) draws no line,
  // rather than "0 steps" over an empty step list or a lone card named twice.
  // Hooks above still ran, so the phase clock started with the turn.
  if (groups.length === 0) return null;
  return (
    <div className="not-prose mb-2" data-testid="tool-phase">
      <div
        className="flex min-h-6 min-w-0 items-center gap-2 text-xs text-muted-foreground"
        data-testid="tool-phase-line"
      >
        <ToolSummaryIcon state={lineState} />
        {!expanded ? <span className="sr-only">{getToolSummaryStatus(lineState, labels)}</span> : null}
        <span className="shrink-0 font-medium text-foreground" data-testid="tool-phase-headline">
          {headline}
        </span>
        <span className="min-w-0 truncate" title={stepText} data-testid="tool-phase-steps">
          {stepText}
        </span>
        {groups.length > 0 ? (
        <button
          type="button"
          onClick={() => setToggled(!expanded)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('chatbot.phase.collapse', { defaultValue: 'Hide steps' })
              : t('chatbot.phase.expand', { defaultValue: 'Show steps' })
          }
          className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
          data-testid="tool-phase-toggle"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
        ) : null}
      </div>
      {expanded && groups.length > 0 ? (
        <div className="mt-1" data-testid="tool-phase-steps-expanded">
          <ToolActivitySummary groups={groups} labels={labels} />
        </div>
      ) : null}
    </div>
  );
}

interface ToolActivitySummaryLabels {
  toolCompleted: string;
  toolRunning: string;
  toolAwaitingApproval: string;
  toolFailed: string;
  connectionOfflineLabel: string;
}

function ToolActivitySummary({
  groups,
  labels,
}: {
  groups: ToolSummaryGroup[];
  labels: ToolActivitySummaryLabels;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="not-prose mb-2 border-l border-border/70 pl-3">
      <div className="space-y-1">
        {groups.map((group) => (
          <div
            key={group.key}
            className="flex min-h-6 items-center justify-between gap-3 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ToolSummaryIcon state={group.state} />
              <span className="truncate font-medium text-foreground">
                {group.title}
              </span>
              {group.count > 1 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  x{group.count}
                </span>
              ) : null}
            </div>
            {group.state === 'running' ? (
              // A running tool shows a LIVE elapsed timer instead of a static
              // "Running", and a red offline cue if the network drops (issue #432).
              <ToolRunningTimer offlineLabel={labels.connectionOfflineLabel} />
            ) : (
              <span
                className={cn(
                  'shrink-0 text-[10px] font-medium',
                  group.state === 'failed'
                    ? 'text-destructive'
                    : group.state === 'completed'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground',
                )}
              >
                {getToolSummaryStatus(group.state, labels)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolSummaryIcon({ state }: { state: ToolSummaryState }) {
  if (state === 'failed') {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  if (state === 'completed') {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  }
  return <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />;
}

function getToolSummaryStatus(
  state: ToolSummaryState,
  labels: ToolActivitySummaryLabels,
) {
  switch (state) {
    case 'failed':
      return labels.toolFailed;
    case 'awaiting':
      return labels.toolAwaitingApproval;
    case 'running':
      return labels.toolRunning;
    case 'completed':
      return labels.toolCompleted;
  }
}

/**
 * Inline notice for a message that couldn't be SENT (rejected before reaching
 * the model — rate-limit 429 / network / 5xx). Distinct from {@link ErrorBanner}
 * (a streamed response that failed): here the typed text has been restored to
 * the composer, so the copy reassures the user it isn't lost rather than
 * offering a Retry that would regenerate the wrong (rolled-back) turn. A
 * rate-limit gets the "you're sending too quickly" wording; anything else the
 * generic one.
 */
function SendErrorNotice({
  error,
  rateLimitedLabel,
  genericLabel,
}: {
  error: Error;
  rateLimitedLabel: string;
  genericLabel: string;
}) {
  const text = React.useMemo(
    () => (isRateLimitError(error) ? rateLimitedLabel : genericLabel),
    [error, rateLimitedLabel, genericLabel],
  );
  return <ComposerNotice text={text} testId="chat-send-error" />;
}

/**
 * The amber band above the composer that tells the user why something they
 * did there did not go through — an unsent message ({@link SendErrorNotice})
 * or a refused attachment (objectstack#34463). `onClose` adds a close button.
 */
function ComposerNotice({
  text,
  testId,
  closeLabel,
  onClose,
}: {
  text: string;
  testId: string;
  closeLabel?: string;
  onClose?: () => void;
}) {
  return (
    <div className="border-t bg-background px-3 py-2 text-sm" role="alert" data-testid={testId}>
      <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 break-words leading-snug">{text}</div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A byte count as the user's locale spells a size, in the largest binary unit
 * it reaches (`10 * 1024 * 1024` → "10 MB"), for the composer's size-limit notice.
 */
function formatSizeLimit(bytes: number, locale: string): string {
  const units = [
    ['gigabyte', 1024 ** 3],
    ['megabyte', 1024 ** 2],
    ['kilobyte', 1024],
  ] as const;
  const spell = (unit: string, value: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value);
  for (const [unit, size] of units) {
    if (bytes >= size) return spell(unit, bytes / size);
  }
  return spell('byte', bytes);
}

/**
 * The server-owned AI-quota refusal copy, resolved for the console's ACTIVE
 * language, plus the verb its next step calls for. `null` when the error is not
 * a quota refusal.
 *
 * Shared by the composer banner and the confirm card's blocked state
 * (objectui#7253) so one 429 can never be described by two different sentences
 * on the same screen. The server sends both a localized `message` (zh) and
 * `messageEn`; that pair is server-owned, so we still choose between them — by
 * the in-app locale, not `navigator.language`, which ignored the locale
 * switcher entirely (objectui#2871).
 *
 * The title and the action follow the refusal's own next-step flags, never a
 * default: `topUp` offers a credit pack, `upgrade` offers the plan upgrade, and
 * a refusal with neither (a paid plan's five-hour pace, a developer
 * organization) gets a neutral title and NO action — waiting is the only exit,
 * and the server's sentence already says when it frees up.
 */
function useAiQuotaCopy(
  error: unknown,
): { title: string; text: string; cta: string | null } | null {
  const { language } = useObjectTranslation();
  const tt = useSafeTranslate();
  const quota = React.useMemo(() => parseAiQuotaError(error), [error]);
  if (!quota) return null;
  const isZh = language.toLowerCase().startsWith('zh');
  return {
    text:
      (isZh ? quota.message : quota.messageEn ?? quota.message) ||
      tt('chatbotQuota.fallbackMessage', 'You have reached your AI quota.'),
    title:
      quota.upgrade && !quota.topUp
        ? tt('chatbotQuota.title', 'Upgrade needed')
        : tt('chatbotQuota.limitTitle', 'AI limit reached'),
    cta: quota.topUp
      ? tt('chatbotQuota.buyCredits', 'Buy a credit pack')
      : quota.upgrade
        ? tt('chatbotQuota.upgradePlan', 'Upgrade plan')
        : null,
  };
}

function ErrorBanner({
  error,
  onReload,
  onUpgrade,
}: {
  error: Error;
  onReload?: () => void;
  onUpgrade?: () => void;
}) {
  // `tt` (not the bare `t`) because this banner is the surface that renders
  // when things are already broken, including in hosts that mount the chat
  // WITHOUT an I18nProvider — where a bare `t(key)` returns the raw key and the
  // user would read "chatbotError.title" instead of an error message.
  const tt = useSafeTranslate();
  const quota = useAiQuotaCopy(error);
  const { summary, details } = React.useMemo(() => summarizeChatError(error), [error]);
  const [expanded, setExpanded] = React.useState(false);

  // AI quota refusal (429 from the cloud token guardrail) -> an amber notice
  // with the upgrade / top-up action the refusal names (none when it names
  // neither) instead of a red "Response failed" banner. Copy resolved by the
  // shared helper, which the confirm card's blocked state reads too.
  if (quota) {
    const { title, text, cta } = quota;
    return (
      <div className="border-t bg-background px-3 py-2 text-sm" role="alert">
        <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug text-foreground">{title}</div>
              <div className="mt-0.5 break-words leading-snug text-muted-foreground">{text}</div>
            </div>
            {onUpgrade && cta ? (
              <button
                type="button"
                onClick={onUpgrade}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-amber-400/50 bg-background px-2 text-xs font-medium text-amber-700 hover:bg-amber-100/60 dark:text-amber-300"
              >
                {cta}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-t bg-background px-3 py-2 text-sm"
      role="alert"
    >
      <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-foreground">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-snug text-destructive">
              {tt('chatbotError.title', 'Response failed')}
            </div>
            <div className="mt-0.5 break-words leading-snug text-muted-foreground">
              {summary || tt('chatbotError.fallbackDetail', 'Something went wrong. Please try again.')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {details ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-foreground"
                aria-expanded={expanded}
              >
                {expanded
                  ? tt('chatbotError.hide', 'Hide')
                  : tt('chatbotError.details', 'Details')}
              </button>
            ) : null}
            {onReload ? (
              <button
                type="button"
                onClick={onReload}
                className="inline-flex h-7 items-center rounded-md border border-destructive/30 bg-background px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                {tt('chatbotError.retry', 'Retry')}
              </button>
            ) : null}
          </div>
        </div>
        {expanded && details ? (
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border bg-background px-2 py-1 font-mono text-[11px] leading-snug text-muted-foreground">
            {details}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tool result renderer. The vendored `<ToolOutput>` blindly wraps every string
 * in a JSON-highlighted `<CodeBlock>`, which mangles plain text / markdown
 * results from tools (e.g. "Created task 42" or a bullet list). This wrapper
 *
 *  - renders plain-text / markdown strings via `<MessageResponse>` (streamdown)
 *  - falls through to the vendored `<ToolOutput>` for real JSON objects/arrays
 *    and for strings that actually look like JSON literals
 *  - preserves error rendering unchanged
 */
function SmartToolOutput({
  output,
  errorText,
}: {
  output: unknown;
  errorText?: string;
}) {
  if (errorText) {
    return <ToolOutput output={undefined} errorText={errorText} />;
  }
  if (output == null || output === '') return null;
  if (typeof output === 'string' && !looksLikeJson(output)) {
    return (
      <div className="space-y-2 p-4">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Result
        </h4>
        <div className="overflow-x-auto rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
          <MessageResponse>{output}</MessageResponse>
        </div>
      </div>
    );
  }
  return <ToolOutput output={output as never} errorText={undefined} />;
}

export { ChatbotEnhanced };
