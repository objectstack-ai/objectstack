/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runtime contract `<ChatbotEnhanced>` renders: the message, tool-invocation,
 * label and prop types. `../ChatbotEnhanced` re-exports every one of them, and
 * that path stays the one importers use.
 */
import * as React from 'react';
import type { OpenListLink } from '../recordLink';
import type { RecordWrite, SampleDataCleanup, PackageRemoval } from '../mapMessages';
import type {
  DatasetProvenance,
  ObjectQuerySource,
  RecordCitationParsed,
} from '@objectstack/spec/ai';

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
   * objectstack#37862 — the host's own empty conversation, drawn in place of
   * the built-in one (the icon, {@link ChatbotLabels.emptyTitle},
   * {@link ChatbotLabels.emptyDescription} and {@link suggestions}) while the
   * conversation has no message. It gets the two things a suggestion can do:
   * `send` sends the text as a message, as a built-in chip does; `fill` puts
   * the text in the composer and focuses it, sending nothing.
   */
  renderEmptyState?: (actions: {
    send: (text: string) => void;
    fill: (text: string) => void;
  }) => React.ReactNode;
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

export interface TurnLiveness {
  /** Whole-turn duration in seconds (since the indicator mounted). */
  elapsedSeconds: number;
  /** Seconds since the last real byte arrived from the server. */
  quietSeconds: number;
  /** True while bytes have arrived recently — an *observed* live stream. */
  live: boolean;
}
